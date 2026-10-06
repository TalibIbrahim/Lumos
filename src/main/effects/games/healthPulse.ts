import { ComposeContext, Layer, LayerPriority } from '../compositor'
import { LightOutput, asAdjustable, clamp, lerp, luminance } from '../output'
import { HueSat } from '../validate'

/** Cycle length at the threshold. */
export const PULSE_SLOW_MS = 2500
/** Cycle length near zero health. */
export const PULSE_FAST_MS = 700
/** Fade in when the pulse begins. */
const ENVELOPE_IN_MS = 800
/** Length of the solid dim red shown on death. */
export const DEATH_HOLD_MS = 2000

/**
 * Cycle length for a health fraction below the threshold: about 2.5 s at the
 * threshold, speeding up linearly to about 0.7 s near zero. Never faster than
 * the flash-rate cap allows (one brightness rise per cycle).
 */
export function pulsePeriodMs(health: number, threshold: number, maxFlashesPerSecond = 3): number {
  const t = threshold > 0 ? clamp(health / threshold, 0, 1) : 0
  const period = lerp(PULSE_FAST_MS, PULSE_SLOW_MS, t)
  return Math.max(period, 1000 / Math.max(1, maxFlashesPerSecond))
}

export interface HealthInput {
  inMatch: boolean
  alive: boolean
  health: number // 0..1
}

type Mode = 'idle' | 'pulse' | 'death'

/**
 * Shows a slow red pulse while health is low and a brief dim red on death.
 * The pulse is a smooth wave, not an on/off flash, and its phase is carried
 * across speed changes so the rhythm never jumps.
 */
export class HealthPulseLayer implements Layer {
  readonly id = 'games-health'
  readonly label = 'Low health'
  readonly priority = LayerPriority.GameOverlay

  private mode: Mode = 'idle'
  private health = 1
  private phase = 0
  private lastTick = 0
  private pulseStartedAt = 0
  private deathUntil = 0

  constructor(
    private appliesFn: (lightId: string) => boolean,
    private options: () => { threshold: number; color: HueSat; maxFlashesPerSecond: number },
    /** Called when the layer stops affecting lights, so the caller can fade them back. */
    private onRelease: (fadeMs: number) => void,
    private onEngage: () => void
  ) {}

  appliesTo(lightId: string): boolean {
    return this.mode !== 'idle' && this.appliesFn(lightId)
  }

  public isActive(): boolean {
    return this.mode !== 'idle'
  }

  /** Feeds the latest health reading. */
  public update(input: HealthInput, now: number): void {
    const { threshold } = this.options()
    const prev = this.mode

    if (!input.inMatch) {
      this.setMode('idle', now)
    } else if (!input.alive) {
      if (prev !== 'death' && prev !== 'idle') {
        this.deathUntil = now + DEATH_HOLD_MS
        this.setMode('death', now)
      } else if (prev === 'idle' && this.health > 0) {
        // Died without passing through low health (a one-shot)
        this.deathUntil = now + DEATH_HOLD_MS
        this.setMode('death', now)
      }
    } else if (input.health * 100 < threshold) {
      this.setMode('pulse', now)
    } else {
      this.setMode('idle', now)
    }
    this.health = input.inMatch ? input.health : 1
  }

  private setMode(mode: Mode, now: number): void {
    if (mode === this.mode) return
    const was = this.mode
    this.mode = mode
    if (mode === 'pulse') {
      this.pulseStartedAt = now
      this.phase = 0
      this.lastTick = now
    }
    if (mode === 'idle') {
      // Healing or respawning eases back to the state underneath
      this.onRelease(was === 'death' ? 1200 : 1000)
    } else if (was === 'idle') {
      this.onEngage()
    }
  }

  compose(below: LightOutput, ctx: ComposeContext): LightOutput | null {
    const { color } = this.options()
    const now = ctx.now
    const base = asAdjustable(below)
    const peakCap = ctx.reduceIntensity ? 70 : 100

    if (this.mode === 'death') {
      if (now >= this.deathUntil) {
        // The hold is over; release on the next health update or frame
        return null
      }
      return { ...base, power: true, mode: 'colour', h: color.h, s: color.s, brightness: 15 }
    }
    if (this.mode !== 'pulse') return null

    this.advance(now)
    const envelope = clamp((now - this.pulseStartedAt) / ENVELOPE_IN_MS, 0, 1)
    // Raised cosine: smooth, with no hard edges
    const wave = (1 - Math.cos(this.phase * Math.PI * 2)) / 2
    const low = ctx.reduceIntensity ? 35 : 12
    const high = Math.max(low + 10, Math.min(peakCap, Math.max(luminance(below), 60)))
    const pulseBrightness = lerp(low, high, wave)
    const brightness = lerp(Math.max(luminance(below), 1), pulseBrightness, envelope)
    return { ...base, power: true, mode: 'colour', h: color.h, s: color.s, brightness }
  }

  private advance(now: number): void {
    if (now <= this.lastTick) return
    const { threshold, maxFlashesPerSecond } = this.options()
    const period = pulsePeriodMs(this.health * 100, threshold, maxFlashesPerSecond)
    this.phase = (this.phase + (now - this.lastTick) / period) % 1
    this.lastTick = now
  }

  isAnimating(now: number): boolean {
    if (this.mode === 'pulse') return true
    if (this.mode === 'death') {
      if (now >= this.deathUntil) {
        this.setMode('idle', now)
        return false
      }
      return true
    }
    return false
  }

  public reset(now: number): void {
    this.setMode('idle', now)
    this.health = 1
  }
}
