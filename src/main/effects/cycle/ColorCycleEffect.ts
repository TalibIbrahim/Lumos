import { Effect, EffectHost, EffectSettingsBase } from '../Effect'
import { ComposeContext, Layer, LayerPriority } from '../compositor'
import { LightOutput, asAdjustable } from '../output'
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
    this.host.compositor.addLayer(this, FADE_MS)
    this.setStatus('active', 'Cycling through the colour spectrum')
    this.host.compositor.wake()
  }

  protected onStop(): void {
    this.host.compositor.removeLayer(this.id, FADE_MS)
  }

  protected onSettingsChanged(): void {
    this.host.compositor.invalidate(this.targetIds())
    this.host.compositor.wake()
  }

  private targetIds(): string[] {
    return this.host.getLights().map((l) => l.id).filter((id) => this.isTarget(id))
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

    const h = colorCycleHue(
      ctx.now,
      this.settings.speed,
      this.settings.reverse,
      this.settings.wave,
      ctx.index,
      ctx.count
    )

    const targetBri = this.settings.brightness
    const brightness = ctx.reduceIntensity ? Math.min(targetBri, 70) : targetBri

    return {
      ...asAdjustable(below),
      power: true,
      mode: 'colour',
      h,
      s: this.settings.saturation,
      brightness
    }
  }
}
