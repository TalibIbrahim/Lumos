import { Effect, EffectHost, EffectSettingsBase } from '../Effect'
import { ComposeContext, Layer, LayerPriority } from '../compositor'
import { LightOutput, asAdjustable, clamp, lerp, lerpHue } from '../output'
import { asObj, bool, int, targets } from '../validate'

export interface ColorCycleSettings extends EffectSettingsBase {
  /** Seconds for a complete 360° color rotation (10..300, default 60). */
  speed: number
  /** Brightness level (1..100, default 100). */
  brightness: number
  /** Color saturation (1..100, default 100). */
  saturation: number
  /** Offsets colors across lights for a wave effect (default true). */
  wave: boolean
  /** Reverse rotation direction (default false). */
  reverse: boolean
}

const FADE_MS = 1000

/**
 * Calculates current hue in degrees (0..360) along the color wheel.
 * Pure and exported for direct unit testing.
 */
export function colorCycleHue(
  nowMs: number,
  speedSeconds: number,
  reverse: boolean,
  wave: boolean,
  index: number,
  count: number
): number {
  const periodMs = Math.max(1, speedSeconds) * 1000
  const progress = ((nowMs % periodMs) + periodMs) % periodMs / periodMs
  const baseHue = (reverse ? 1 - progress : progress) * 360
  const offset = wave && count > 1 ? (index / count) * 360 : 0
  return Math.round(((baseHue + offset) % 360 + 360) % 360)
}

/**
 * Continuous temporal smoother for Chroma Cycle lighting.
 * Smooths hue along the shortest arc on the 360° color wheel and interpolates
 * saturation and brightness with exponential relaxation, ensuring changes in
 * speed, wave, or direction are gradual, seamless, and completely unnoticeable.
 */
export class CycleSmoother {
  private currentH: number | null = null
  private currentS: number | null = null
  private currentBri: number | null = null
  private lastAt = 0

  public update(
    target: { h: number; s: number; brightness: number },
    now: number
  ): { h: number; s: number; brightness: number } {
    if (this.currentH === null || this.lastAt === 0) {
      this.currentH = target.h
      this.currentS = target.s
      this.currentBri = target.brightness
      this.lastAt = now
      return target
    }
    const dt = Math.max(0, Math.min(1.0, (now - this.lastAt) / 1000))
    this.lastAt = now
    if (dt === 0) {
      return {
        h: Math.round(this.currentH),
        s: Math.round(this.currentS!),
        brightness: Math.round(this.currentBri!)
      }
    }

    const tau = 0.22
    const a = 1 - Math.exp(-dt / tau)
    this.currentH = lerpHue(this.currentH, target.h, a)
    this.currentS = lerp(this.currentS!, target.s, a)
    this.currentBri = lerp(this.currentBri!, target.brightness, a)

    return {
      h: Math.round(((this.currentH % 360) + 360) % 360),
      s: Math.round(clamp(this.currentS, 0, 100)),
      brightness: Math.round(clamp(this.currentBri, 1, 100))
    }
  }

  public reset(): void {
    this.currentH = null
    this.currentS = null
    this.currentBri = null
    this.lastAt = 0
  }
}

/**
 * Smoothly cycles lights through the entire 360° color spectrum over time,
 * inspired by mechanical RGB keyboard lighting. Supports spectrum wave offsets
 * across multiple bulbs.
 */
export class ColorCycleEffect extends Effect<ColorCycleSettings> implements Layer {
  readonly id = 'cycle'
  readonly label = 'Chroma cycle'
  readonly voiceName = 'Chroma cycle'
  readonly description = 'Smoothly cycles your lights through the full color spectrum, with an optional wave across the room.'
  readonly ambient = true
  readonly priority = LayerPriority.Ambient

  private smoothers = new Map<string, CycleSmoother>()
  private phase = 0
  private lastAdvance = 0

  constructor(host: EffectHost) {
    super(host)
    this.init()
  }

  defaults(): ColorCycleSettings {
    return {
      enabled: false,
      targets: 'all',
      speed: 60,
      brightness: 100,
      saturation: 100,
      wave: true,
      reverse: false
    }
  }

  sanitize(raw: unknown): ColorCycleSettings {
    const o = asObj(raw)
    const d = this.defaults()
    return {
      enabled: bool(o.enabled, false),
      targets: targets(o.targets),
      speed: int(o.speed, d.speed, 10, 300),
      brightness: int(o.brightness, d.brightness, 1, 100),
      saturation: int(o.saturation, d.saturation, 1, 100),
      wave: bool(o.wave, d.wave),
      reverse: bool(o.reverse, d.reverse)
    }
  }

  protected onStart(): void {
    this.phase = 0
    this.lastAdvance = 0
    this.smoothers.clear()
    this.host.compositor.addLayer(this, FADE_MS)
    this.setStatus('active', 'Cycling through the colour spectrum')
    this.host.compositor.wake()
  }

  protected onStop(): void {
    this.smoothers.clear()
    this.host.compositor.removeLayer(this.id, FADE_MS)
  }

  protected onSettingsChanged(): void {
    this.host.compositor.invalidate(this.targetIds(), 600)
    this.host.compositor.wake()
  }

  private targetIds(): string[] {
    return this.host.getLights().map((l) => l.id).filter((id) => this.isTarget(id))
  }

  private advance(now: number): void {
    if (this.lastAdvance === 0) {
      this.lastAdvance = now
      return
    }
    const dt = Math.max(0, Math.min(1.0, (now - this.lastAdvance) / 1000))
    this.lastAdvance = now
    if (dt === 0) return
    const speed = Math.max(1, this.settings.speed)
    const delta = (dt / speed) * (this.settings.reverse ? -1 : 1)
    this.phase = ((this.phase + delta) % 1 + 1) % 1
  }

  // --- Layer ---

  appliesTo(lightId: string): boolean {
    return this.running && this.isTarget(lightId) && !this.host.claimedByOther(this.id, lightId) && !this.paused.has(lightId)
  }

  isAnimating(): boolean {
    return this.running
  }

  compose(below: LightOutput, ctx: ComposeContext): LightOutput | null {
    if (!this.running || !below.power) return null
    if (!ctx.capabilities.hasColor) return null

    this.advance(ctx.now)

    const offset = this.settings.wave && ctx.count > 1 ? ctx.index / ctx.count : 0
    const lightPhase = ((this.phase + offset) % 1 + 1) % 1
    const h = Math.round(((lightPhase * 360) % 360 + 360) % 360)

    const targetBri = this.settings.brightness
    const brightness = ctx.reduceIntensity ? Math.min(targetBri, 70) : targetBri

    let smoother = this.smoothers.get(ctx.lightId)
    if (!smoother) {
      smoother = new CycleSmoother()
      this.smoothers.set(ctx.lightId, smoother)
    }

    const smoothed = smoother.update(
      { h, s: this.settings.saturation, brightness },
      ctx.now
    )

    return {
      ...asAdjustable(below),
      power: true,
      mode: 'colour',
      h: smoothed.h,
      s: smoothed.s,
      brightness: smoothed.brightness
    }
  }
}
