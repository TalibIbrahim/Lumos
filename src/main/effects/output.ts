/**
 * Output state model shared by the compositor, layers, and device drivers.
 * An output is what a bulb should physically show, as opposed to the base
 * state (the user's intent), which is what the UI shows and what persists.
 */

export type OutputMode = 'white' | 'colour' | 'scene' | 'music'

export interface LightOutput {
  power: boolean
  mode: OutputMode
  brightness: number // 0-100, white brightness or colour value
  colorTemp: number // 0-100, 0 = warmest
  h: number // 0-360
  s: number // 0-100
  scene?: number
}

export type OutputField = 'power' | 'mode' | 'brightness' | 'colorTemp' | 'color' | 'scene'

export const OFF_OUTPUT: LightOutput = {
  power: false,
  mode: 'white',
  brightness: 0,
  colorTemp: 50,
  h: 0,
  s: 0
}

export const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v))
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t

export function easeInOutCubic(t: number): number {
  const x = clamp(t, 0, 1)
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2
}

/** Interpolates hue along the shortest arc. */
export function lerpHue(a: number, b: number, t: number): number {
  let d = (((b - a) % 360) + 540) % 360 - 180
  if (Math.abs(d) === 180) d = 180
  return (((a + d * t) % 360) + 360) % 360
}

export function hueDistance(a: number, b: number): number {
  const d = Math.abs((((a - b) % 360) + 360) % 360)
  return d > 180 ? 360 - d : d
}

/** Apparent light level, 0 when off. */
export function luminance(o: LightOutput): number {
  return o.power ? o.brightness : 0
}

export function isAdjustable(o: LightOutput): boolean {
  return o.mode === 'white' || o.mode === 'colour'
}

/**
 * Hardware scenes and music modes cannot be modulated, so layers that need to
 * change brightness or colour treat them as white at the base brightness.
 */
export function asAdjustable(o: LightOutput): LightOutput {
  if (isAdjustable(o)) return o
  return { ...o, mode: 'white', scene: undefined }
}

/** Approximates a white colour temperature as a hue and saturation. */
export function whiteAsColour(colorTemp: number): { h: number; s: number } {
  const t = clamp(colorTemp, 0, 100)
  if (t < 70) return { h: 30, s: Math.round(lerp(65, 8, t / 70)) }
  return { h: 210, s: Math.round(lerp(0, 15, (t - 70) / 30)) }
}

/** Rounds to the resolution the devices can represent. */
export function quantize(o: LightOutput): LightOutput {
  return {
    power: o.power,
    mode: o.mode,
    brightness: Math.round(clamp(o.brightness, 0, 100)),
    colorTemp: Math.round(clamp(o.colorTemp, 0, 100)),
    h: Math.round(((o.h % 360) + 360) % 360),
    s: Math.round(clamp(o.s, 0, 100)),
    scene: o.scene
  }
}

/** Fields whose physical effect differs between two quantized outputs. */
export function changedFields(prev: LightOutput | null, next: LightOutput): Set<OutputField> {
  const out = new Set<OutputField>()
  if (!prev) {
    out.add('power')
    if (next.power) {
      out.add('mode')
      if (next.mode === 'colour') out.add('color')
      else if (next.mode === 'white') {
        out.add('brightness')
        out.add('colorTemp')
      } else if (next.mode === 'scene') out.add('scene')
    }
    return out
  }
  if (prev.power !== next.power) out.add('power')
  if (!next.power) return out
  if (prev.mode !== next.mode) out.add('mode')
  if (next.mode === 'colour') {
    if (prev.mode !== 'colour' || prev.h !== next.h || prev.s !== next.s || prev.brightness !== next.brightness) {
      out.add('color')
    }
  } else if (next.mode === 'white') {
    if (prev.brightness !== next.brightness) out.add('brightness')
    if (prev.colorTemp !== next.colorTemp) out.add('colorTemp')
  } else if (next.mode === 'scene') {
    if (prev.mode !== 'scene' || prev.scene !== next.scene) out.add('scene')
  }
  return out
}

export function outputsEqual(a: LightOutput | null, b: LightOutput | null): boolean {
  if (!a || !b) return a === b
  return changedFields(quantize(a), quantize(b)).size === 0
}

/**
 * Blends two outputs. Off is treated as zero brightness so power changes fade.
 * White and colour are blended through an approximate colour for the white end.
 * Scene and music modes cannot be blended and switch at the end of the fade.
 */
export function blendOutput(a: LightOutput, b: LightOutput, t: number): LightOutput {
  const x = clamp(t, 0, 1)
  if (x >= 1) return b
  if (x <= 0) return a
  if (!isAdjustable(b)) return x < 1 ? { ...asAdjustable(a), power: a.power } : b

  const from = asAdjustable(a)
  const lumA = luminance(from)
  const lumB = luminance(b)
  const brightness = lerp(lumA, lumB, x)
  const power = a.power || b.power

  // Hue of an off endpoint should not drag the blend through unrelated colours.
  const fromColour = from.mode === 'colour' ? { h: from.h, s: from.s } : whiteAsColour(from.colorTemp)
  const toColour = b.mode === 'colour' ? { h: b.h, s: b.s } : whiteAsColour(b.colorTemp)

  if (from.mode === 'white' && b.mode === 'white') {
    return {
      power,
      mode: 'white',
      brightness: Math.max(power ? 1 : 0, brightness),
      colorTemp: lerp(from.colorTemp, b.colorTemp, x),
      h: b.h,
      s: b.s
    }
  }

  const hFrom = from.power ? fromColour.h : toColour.h
  const hTo = b.power ? toColour.h : fromColour.h
  return {
    power,
    mode: 'colour',
    brightness: Math.max(power ? 1 : 0, brightness),
    colorTemp: lerp(from.colorTemp, b.colorTemp, x),
    h: lerpHue(hFrom, hTo, x),
    s: lerp(from.power ? fromColour.s : toColour.s, b.power ? toColour.s : fromColour.s, x)
  }
}
