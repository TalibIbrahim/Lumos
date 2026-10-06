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
