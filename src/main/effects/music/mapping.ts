import { clamp, lerp, lerpHue } from '../output'
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
  // Ease between stops so the drift lingers on each colour
  const e = t * t * (3 - 2 * t)
  return { h: lerpHue(a.h, b.h, e), s: lerp(a.s, b.s, e) }
}

/** Palette cycles per second for a drift setting (0..1) and track energy (0..1). */
export function driftRate(drift: number, energy: number): number {
  return (0.004 + clamp(drift, 0, 1) * 0.05) * (0.5 + clamp(energy, 0, 1))
}

/**
 * Beat pulse envelope at a time after a beat. Attack is short enough that the
 * peak lands on the bulb's next command; decay follows the tempo so pulses
 * at fast tempos still separate, but never so fast that it reads as a strobe.
 */
export function pulseEnvelope(msSinceBeat: number, strength: number, tempo: number | null): number {
  if (msSinceBeat < 0) return 0
  const attack = 60
  if (msSinceBeat < attack) return strength * (msSinceBeat / attack)
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
