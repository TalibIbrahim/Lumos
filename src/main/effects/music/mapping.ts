import { clamp, lerp, lerpHue } from '../output'
import { FLASH_RISE_THRESHOLD } from '../safety'
import type { HueSat } from '../validate'

export type PaletteName = 'aurora' | 'sunset' | 'ocean' | 'neon' | 'custom'

export const PALETTES: Record<Exclude<PaletteName, 'custom'>, HueSat[]> = {
  aurora: [
    { h: 165, s: 90 },
    { h: 195, s: 85 },
    { h: 275, s: 80 }
  ],
  sunset: [
    { h: 12, s: 95 },
    { h: 32, s: 95 },
    { h: 330, s: 80 }
  ],
  ocean: [
    { h: 185, s: 90 },
    { h: 210, s: 95 },
    { h: 240, s: 85 }
  ],
  neon: [
    { h: 300, s: 100 },
    { h: 180, s: 100 },
    { h: 55, s: 100 }
  ]
}

/** Colour at a position along a looping palette (position wraps at 1). */
export function paletteColor(palette: HueSat[], position: number): HueSat {
  if (palette.length === 0) return { h: 0, s: 0 }
  if (palette.length === 1) return palette[0]
  const p = ((position % 1) + 1) % 1
  const scaled = p * palette.length
  const i = Math.floor(scaled)
  const t = scaled - i
  const a = palette[i % palette.length]
  const b = palette[(i + 1) % palette.length]
  // Uniform linear progression along the hue arc for constant, unnoticeable drift
  return { h: lerpHue(a.h, b.h, t), s: lerp(a.s, b.s, t) }
}

/** Palette cycles per second for a drift setting (0..1) and track energy (0..1). */
export function driftRate(drift: number, energy: number): number {
  return (0.004 + clamp(drift, 0, 1) * 0.05) * (0.5 + clamp(energy, 0, 1))
}

/**
 * Beat pulse envelope at a time after a beat. Attack uses a smooth sinusoidal
 * curve so changes rise organically into the peak; decay follows the tempo so
 * pulses at fast tempos still separate without strobing.
 */
export function pulseEnvelope(msSinceBeat: number, strength: number, tempo: number | null): number {
  if (msSinceBeat < 0) return 0
  const attack = 60
  if (msSinceBeat < attack) {
    const p = msSinceBeat / attack
    return strength * (0.5 - 0.5 * Math.cos(Math.PI * p))
  }
  const interval = tempo ? 60000 / tempo : 500
  const tau = clamp(interval * 0.35, 150, 450)
  return strength * Math.exp(-(msSinceBeat - attack) / tau)
}

/**
 * Brightness for a light given the level underneath, the current pulse and
 * low-band levels, and the pulse depth (0..1). The light dips below its level
 * between beats and rises toward full on a beat.
 */
export function pulseBrightness(baseLevel: number, pulse: number, low: number, depth: number): number {
  const d = clamp(depth, 0, 1)
  const floor = baseLevel * (1 - d * 0.7)
  const peak = Math.min(100, baseLevel + d * (100 - baseLevel))
  const drive = Math.max(pulse, low * 0.35)
  return clamp(lerp(floor, peak, clamp(drive, 0, 1)), 1, 100)
}

/** How long a drop holds every light at full white before the colours come back. */
export const DROP_BURST_MS = 350
/** After a drop, every beat hits full brightness for this long. */
export const DROP_SECTION_MS = 16000

/**
 * Party style beat envelope: the hit lands at once and falls away quickly,
 * so the lights snap to the beat and sit dark in between. Inside the section
 * after a drop every beat is a full hit regardless of its strength.
 */
export function partyEnvelope(msSinceBeat: number, strength: number, tempo: number | null, afterDrop: boolean): number {
  if (msSinceBeat < 0) return 0
  // Strong beats are full hits; softer ones land a little lower
  const peak = afterDrop ? 1 : Math.min(1, 0.6 + 0.55 * clamp(strength, 0, 1))
  // Held long enough that the next command to the bulb carries the peak
  const hold = 120
  if (msSinceBeat < hold) return peak
  const interval = tempo ? 60000 / tempo : 500
  const tau = clamp(interval * 0.22, 90, 250)
  return peak * Math.exp(-(msSinceBeat - hold) / tau)
}

/**
 * Party style brightness: a deep floor between beats (set by the pulse depth,
 * 0..1) and full brightness on a full hit.
 */
export function partyBrightness(baseLevel: number, pulse: number, low: number, depth: number): number {
  const d = clamp(depth, 0, 1)
  const floor = clamp(baseLevel * (1 - d * 0.9), 3, 100)
  const drive = Math.max(pulse, low * 0.25)
  return clamp(lerp(floor, 100, clamp(drive, 0, 1)), 1, 100)
}

/**
 * Party style colour: the palette steps to its next colour on each beat. With
 * the wave on, neighbouring lights sit one colour apart.
 */
export function partyColor(palette: HueSat[], step: number, index: number, wave: boolean): HueSat {
  if (palette.length === 0) return { h: 0, s: 0 }
  const i = (step + (wave ? index : 0)) % palette.length
  return palette[(i + palette.length) % palette.length]
}

/**
 * Bass envelope: for bass hits and sub-bass groove.
 * Attack is smooth (120 ms) and decay is long and gentle (tau = 450..900 ms)
 * so changes feel organic, rolling, and calm rather than frantic.
 */
export function bassEnvelope(msSinceBeat: number, strength: number, tempo: number | null): number {
  if (msSinceBeat < 0) return 0
  const attack = 120
  if (msSinceBeat < attack) return strength * (msSinceBeat / attack)
  const interval = tempo ? 60000 / tempo : 600
  const tau = clamp(interval * 0.75, 450, 900)
  return strength * Math.exp(-(msSinceBeat - attack) / tau)
}

/**
 * Bass brightness: primarily driven by low-band energy (sub-bass).
 * On beat drops (isDropBurst), brightness surges to 100% MAX.
 * In normal play, changes are gentle, rolling, and weighted by sub-bass energy.
 */
export function bassBrightness(
  baseLevel: number,
  low: number,
  pulse: number,
  depth: number,
  isDropBurst: boolean
): number {
  if (isDropBurst) return 100
  const d = clamp(depth, 0, 1)
  const floor = baseLevel * (1 - d * 0.45)
  const peak = Math.min(100, Math.max(baseLevel, 60) + d * (100 - baseLevel))
  const bassDrive = clamp(low * 0.75 + pulse * 0.25, 0, 1)
  return clamp(lerp(floor, peak, bassDrive), 1, 100)
}

export type MusicStyle = 'smooth' | 'party' | 'bass'

/**
 * Continuous temporal smoother for music lighting.
 * Smooths brightness rises and falls along organic exponential curves, rate-limits
 * single-frame brightness rises so FlashGuard never clamps or stair-steps, and
 * glides hue along the shortest arc so color transitions are gradual and unnoticeable.
 */
export class MusicSmoother {
  private currentBri: number | null = null
  private currentH: number | null = null
  private currentS: number | null = null
  private lastAt = 0

  public update(
    target: { h: number; s: number; brightness: number },
    now: number,
    style: MusicStyle = 'smooth'
  ): { h: number; s: number; brightness: number } {
    if (this.currentBri === null || this.lastAt === 0) {
      this.currentBri = target.brightness
      this.currentH = target.h
      this.currentS = target.s
      this.lastAt = now
      return target
    }
    const dt = Math.max(0, Math.min(1.0, (now - this.lastAt) / 1000))
    this.lastAt = now
    if (dt === 0) {
      return {
        h: Math.round(this.currentH!),
        s: Math.round(this.currentS!),
        brightness: Math.round(this.currentBri)
      }
    }

    const isRising = target.brightness > this.currentBri

    if (style === 'party') {
      this.currentBri = target.brightness
    } else {
      // Style-adapted time constants:
      // Smooth: gentle organic rise, analogue decay
      // Bass: rolling, deep sub-bass inertia
      const tauBri = style === 'bass' ? (isRising ? 0.14 : 0.35) : (isRising ? 0.10 : 0.26)
      const aBri = 1 - Math.exp(-dt / tauBri)
      const rawBri = lerp(this.currentBri, target.brightness, aBri)

      // Rate-limit the single-frame rise strictly below FLASH_RISE_THRESHOLD (25 points).
      // This guarantees FlashGuard never clips, preventing 24-point staircase stepping.
      const maxRise = FLASH_RISE_THRESHOLD - 1
      this.currentBri = isRising ? Math.min(this.currentBri + maxRise, rawBri) : rawBri
    }

    // Smooth hue along shortest arc so color changes are gradual and unnoticeable
    const tauHue = style === 'party' ? 0.18 : 0.26
    const aHue = 1 - Math.exp(-dt / tauHue)
    this.currentH = lerpHue(this.currentH!, target.h, aHue)

    // Smooth saturation
    const aSat = 1 - Math.exp(-dt / 0.24)
    this.currentS = lerp(this.currentS!, target.s, aSat)

    return {
      h: Math.round(((this.currentH % 360) + 360) % 360),
      s: Math.round(clamp(this.currentS, 0, 100)),
      brightness: Math.round(clamp(this.currentBri, 1, 100))
    }
  }

  public reset(): void {
    this.currentBri = null
    this.currentH = null
    this.currentS = null
    this.lastAt = 0
  }
}
