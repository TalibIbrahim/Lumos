import { clamp, lerp } from '../output'

export interface FlameParams {
  heat: number // 0..1, flame core temperature (drives hue: 14° ember to 38° bright gold)
  flicker: number // 0..1, brightness modulation factor
}

export const MIN_EMBER_HUE = 14 // deep burning charcoal / ember red-orange
export const MAX_FLAME_HUE = 38 // golden flame

/**
 * Procedural harmonic multi-octave oscillation simulating organic flame motion.
 * Combines slow breathing (embers), medium licking flames, and fast micro-crackles.
 */
export function flameFlicker(nowMs: number, speed: number, phase: number): FlameParams {
  const s = clamp(speed, 10, 100) / 50 // 0.2 to 2.0x time rate
  const t = (nowMs / 1000) * s + phase

  // Octave 1: Slow underlying hearth breathing (0.35 Hz)
  const o1 = 0.5 + 0.5 * Math.sin(t * 2.2)

  // Octave 2: Mid-frequency flame tongues (1.1 Hz)
  const o2 = 0.5 + 0.5 * Math.sin(t * 6.9 + 1.2)

  // Octave 3: Faster micro-flicker (2.7 Hz)
  const o3 = 0.5 + 0.5 * Math.sin(t * 17.1 + 2.8)

  // Combined heat: biased towards embers with periodic rises
  const heat = clamp(0.25 * o1 + 0.45 * o2 + 0.3 * o3, 0, 1)

  // Combined flicker for brightness (gentle range 0.4..1.0 so light never cuts out)
  const flicker = clamp(0.4 + 0.35 * o2 + 0.25 * o3, 0.2, 1.0)

  return { heat, flicker }
}

/**
 * Computes color and brightness for a fireplace light.
 * If acoustic is active and audio energy is present, audio swells flare up
 * the heat and brightness.
 */
export function fireplaceOutput(
  baseLevel: number,
  params: FlameParams,
  audioEnergy: number,
  acoustic: boolean,
  intensity: number
): { h: number; s: number; brightness: number } {
  const normIntensity = clamp(intensity, 10, 100) / 100
  const effectiveBase = Math.max(20, baseLevel) * normIntensity

  let heat = params.heat
  let flare = 0

  if (acoustic && audioEnergy > 0) {
    const audio = clamp(audioEnergy, 0, 1)
    // Low-end rumble and musical peaks fuel the fire
    heat = clamp(heat * 0.65 + audio * 0.75, 0, 1)
    flare = audio * 0.35
  }

  // Hue transitions from deep ember red-orange (14°) to vibrant golden flame (38°)
  const h = Math.round(lerp(MIN_EMBER_HUE, MAX_FLAME_HUE, heat))
  // Rich saturation: 92% at ember stage, up to 98% in active flame
  const s = Math.round(lerp(96, 92, heat))

  // Brightness: ember floor up to flare peak
  const floor = effectiveBase * 0.45
  const peak = Math.min(100, effectiveBase * (1 + flare))
  const brightness = Math.round(clamp(lerp(floor, peak, clamp(params.flicker + flare, 0, 1)), 5, 100))

  return { h, s, brightness }
}
