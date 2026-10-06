/**
 * Dominant colour extraction for album art, tuned for what looks good on a
 * light bulb rather than what is most common in the image.
 *
 * 1. Quantize pixels into coarse RGB buckets.
 * 2. Discard near-black and near-grey pixels.
 * 3. Weight buckets by both prevalence and saturation.
 * 4. Boost saturation and clamp brightness of the winner so it reads vividly.
 * 5. Fall back to warm white when the art is essentially monochrome.
 */

export interface HSV {
  h: number // 0..360
  s: number // 0..100
  v: number // 0..100
}

export interface ExtractedColors {
  /** True when the art has no usable colour; use warm white instead. */
  monochrome: boolean
  /** The main colour, boosted for a bulb. */
  primary: HSV
  /** Up to three distinct colours, primary first. */
  palette: HSV[]
}

export const WARM_WHITE: HSV = { h: 32, s: 40, v: 85 }

export function rgbToHsv(r: number, g: number, b: number): HSV {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const d = max - min
  let h = 0
  if (d > 0) {
    if (max === rn) h = ((gn - bn) / d) % 6
    else if (max === gn) h = (bn - rn) / d + 2
    else h = (rn - gn) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  return { h, s: max === 0 ? 0 : (d / max) * 100, v: max * 100 }
}

function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}

/** Makes a colour vivid enough to read on a bulb. */
export function boostForBulb(c: HSV): HSV {
  return {
    h: Math.round(c.h) % 360,
    s: Math.round(Math.max(60, Math.min(100, c.s * 1.3 + 10))),
    v: Math.round(Math.max(65, Math.min(100, c.v * 1.2)))
  }
}

interface Bucket {
  count: number
  r: number
  g: number
  b: number
}

const BLACK_V = 18 // percent
const GREY_S = 20 // percent
/** Fraction of weighted pixels that must be colourful for art to count as colourful. */
const MIN_COLOURFUL_SHARE = 0.04

/**
 * Extracts colours from RGBA pixel data (for example a 48x48 thumbnail).
 * Alpha is ignored.
 */
export function extractColors(rgba: Uint8Array | Uint8ClampedArray, width: number, height: number): ExtractedColors {
  const total = width * height
  const buckets = new Map<number, Bucket>()
  let colourful = 0

  for (let i = 0; i < total; i++) {
    const r = rgba[i * 4]
    const g = rgba[i * 4 + 1]
    const b = rgba[i * 4 + 2]
    const hsv = rgbToHsv(r, g, b)
    if (hsv.v < BLACK_V || hsv.s < GREY_S) continue
    colourful++
    // 4 bits per channel: coarse enough to group shades, fine enough to separate hues
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4)
    const bucket = buckets.get(key)
    if (bucket) {
      bucket.count++
      bucket.r += r
      bucket.g += g
      bucket.b += b
    } else {
      buckets.set(key, { count: 1, r, g, b })
    }
  }

  if (total === 0 || colourful / total < MIN_COLOURFUL_SHARE) {
    return { monochrome: true, primary: WARM_WHITE, palette: [WARM_WHITE] }
  }

  // Merge buckets into hue groups so shades of one colour vote together
  const groups: Array<{ hsv: HSV; weight: number; count: number }> = []
  const scored = Array.from(buckets.values())
    .map((bk) => {
      const hsv = rgbToHsv(bk.r / bk.count, bk.g / bk.count, bk.b / bk.count)
      const sat = hsv.s / 100
      const val = hsv.v / 100
      // Prevalence times a preference for saturated, reasonably bright colour
      const weight = bk.count * (0.25 + sat * sat) * (0.5 + val * 0.5)
      return { hsv, weight, count: bk.count }
    })
    .sort((a, b) => b.weight - a.weight)

  for (const item of scored) {
    const group = groups.find((g) => hueDistance(g.hsv.h, item.hsv.h) < 24)
    if (group) {
      // Weighted circular mean keeps the group's hue stable
      const w1 = group.weight
      const w2 = item.weight
      const a1 = (group.hsv.h * Math.PI) / 180
      const a2 = (item.hsv.h * Math.PI) / 180
      const x = Math.cos(a1) * w1 + Math.cos(a2) * w2
      const y = Math.sin(a1) * w1 + Math.sin(a2) * w2
      group.hsv = {
        h: ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360,
        s: (group.hsv.s * w1 + item.hsv.s * w2) / (w1 + w2),
        v: (group.hsv.v * w1 + item.hsv.v * w2) / (w1 + w2)
      }
      group.weight += item.weight
      group.count += item.count
    } else {
      groups.push({ ...item })
    }
  }
  groups.sort((a, b) => b.weight - a.weight)

  const primary = boostForBulb(groups[0].hsv)
  const palette: HSV[] = [primary]
  const minShare = groups[0].weight * 0.12
  for (const g of groups.slice(1)) {
    if (palette.length >= 3) break
    if (g.weight < minShare) break
    if (palette.every((p) => hueDistance(p.h, g.hsv.h) >= 35)) palette.push(boostForBulb(g.hsv))
  }
  return { monochrome: false, primary, palette }
}
