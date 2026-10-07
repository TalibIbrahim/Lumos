/**
 * Screen analysis for Screen Sync. Pure and allocation-light so it runs in
 * the hidden capture page at 10 to 20 frames per second and can be tested
 * with fixture frames.
 *
 * Frames are small RGBA images (about 160 by 90). Nothing here keeps or
 * returns pixel data beyond one tiny luma thumbnail used to notice changes.
 */

export interface Frame {
  width: number
  height: number
  /** RGBA, width * height * 4 bytes. */
  data: Uint8Array | Uint8ClampedArray
}

export interface Rect {
  x0: number
  y0: number
  x1: number // exclusive
  y1: number // exclusive
}

export interface Bars {
  top: number
  bottom: number
  left: number
  right: number
}

export type ScreenPosition = 'left' | 'right' | 'center' | 'top' | 'bottom'

export interface ZoneColor {
  /** Dominant vivid colour, 0-360 and 0-100. */
  h: number
  s: number
  /** Mean perceptual luminance of the zone, 0..1. */
  luminance: number
  /** False when the zone is grey or near black; use a warm neutral instead. */
  vivid: boolean
  /** Hue and saturation (0-360, 0-100) of the zone's plain average colour, for Movie mode. */
  tintH?: number
  tintS?: number
}

const luma = (r: number, g: number, b: number): number => 0.2126 * r + 0.7152 * g + 0.0722 * b

// --- Letterbox and pillarbox detection ---

/** A row or column is a bar when nearly all of its pixels are this dark (0-255 luma). */
const BAR_LUMA = 22
const BAR_FRACTION = 0.97
/** Bars never cover more than this share of a dimension per side. */
const MAX_BAR_SHARE = 0.35

function rowIsBar(f: Frame, y: number): boolean {
  let dark = 0
  for (let x = 0; x < f.width; x++) {
    const i = (y * f.width + x) * 4
    if (luma(f.data[i], f.data[i + 1], f.data[i + 2]) < BAR_LUMA) dark++
  }
  return dark >= f.width * BAR_FRACTION
}

function colIsBar(f: Frame, x: number, y0: number, y1: number): boolean {
  let dark = 0
  const n = Math.max(1, y1 - y0)
  for (let y = y0; y < y1; y++) {
    const i = (y * f.width + x) * 4
    if (luma(f.data[i], f.data[i + 1], f.data[i + 2]) < BAR_LUMA) dark++
  }
  return dark >= n * BAR_FRACTION
}

/**
 * Finds black bars at each edge. A frame that is black all over is a dark
 * scene, not a letterbox, so it reports no bars.
 */
export function detectBars(f: Frame): Bars {
  const maxH = Math.floor(f.height * MAX_BAR_SHARE)
  const maxW = Math.floor(f.width * MAX_BAR_SHARE)
  let top = 0
  while (top < maxH && rowIsBar(f, top)) top++
  let bottom = 0
  while (bottom < maxH && rowIsBar(f, f.height - 1 - bottom)) bottom++
  if (top >= maxH && bottom >= maxH) return { top: 0, bottom: 0, left: 0, right: 0 }
  const y0 = top
  const y1 = f.height - bottom
  let left = 0
  while (left < maxW && colIsBar(f, left, y0, y1)) left++
  let right = 0
  while (right < maxW && colIsBar(f, f.width - 1 - right, y0, y1)) right++
  if (left >= maxW && right >= maxW) return { top, bottom, left: 0, right: 0 }
  return { top, bottom, left, right }
}

/**
 * Keeps bar detection steady. New, larger bars are adopted only after they
 * hold for a moment, so a dark shot does not count as a letterbox; bars
 * shrink straight away when picture appears inside them.
 */
export class LetterboxTracker {
  private current: Bars = { top: 0, bottom: 0, left: 0, right: 0 }
  private candidate: Bars | null = null
  private candidateSince = 0

  constructor(private holdMs = 1000) {}

  public update(seen: Bars, now: number): Bars {
    const keys: Array<keyof Bars> = ['top', 'bottom', 'left', 'right']
    // Shrink immediately where content now reaches further
    let changed = false
    const next = { ...this.current }
    for (const k of keys) {
      if (seen[k] < next[k]) {
        next[k] = seen[k]
        changed = true
      }
    }
    if (changed) this.current = next

    const grows = keys.some((k) => seen[k] > this.current[k] + 1)
    if (!grows) {
      this.candidate = null
      return this.current
    }
    const same = this.candidate && keys.every((k) => Math.abs(this.candidate![k] - seen[k]) <= 1)
    if (!same) {
      this.candidate = { ...seen }
      this.candidateSince = now
    } else if (now - this.candidateSince >= this.holdMs) {
      this.current = { ...seen }
      this.candidate = null
    }
    return this.current
  }

  public reset(): void {
    this.current = { top: 0, bottom: 0, left: 0, right: 0 }
    this.candidate = null
  }
}

// --- Zones ---

export interface Placement {
  lightId: string
  position: ScreenPosition
}

/**
 * Screen regions for each light. Left and right sample vertical strips along
 * those edges, top and bottom sample horizontal strips, and center samples the
 * whole picture. Lights sharing a position split its region evenly, in order.
 */
export function zonesFor(placements: Placement[], active: Rect, edgeShare: number): Map<string, Rect> {
  const out = new Map<string, Rect>()
  const w = Math.max(1, active.x1 - active.x0)
  const h = Math.max(1, active.y1 - active.y0)
  const ew = Math.max(1, Math.round(w * Math.min(0.5, Math.max(0.03, edgeShare))))
  const eh = Math.max(1, Math.round(h * Math.min(0.5, Math.max(0.03, edgeShare))))
  const groups = new Map<ScreenPosition, string[]>()
  for (const p of placements) groups.set(p.position, [...(groups.get(p.position) || []), p.lightId])

  const splitV = (ids: string[], r: Rect): void =>
    ids.forEach((id, i) => {
      const y0 = r.y0 + Math.floor(((r.y1 - r.y0) * i) / ids.length)
      const y1 = r.y0 + Math.floor(((r.y1 - r.y0) * (i + 1)) / ids.length)
      out.set(id, { x0: r.x0, x1: r.x1, y0, y1: Math.max(y1, y0 + 1) })
    })
  const splitH = (ids: string[], r: Rect): void =>
    ids.forEach((id, i) => {
      const x0 = r.x0 + Math.floor(((r.x1 - r.x0) * i) / ids.length)
      const x1 = r.x0 + Math.floor(((r.x1 - r.x0) * (i + 1)) / ids.length)
      out.set(id, { y0: r.y0, y1: r.y1, x0, x1: Math.max(x1, x0 + 1) })
    })

  const g = (p: ScreenPosition): string[] => groups.get(p) || []
  splitV(g('left'), { x0: active.x0, x1: active.x0 + ew, y0: active.y0, y1: active.y1 })
  splitV(g('right'), { x0: active.x1 - ew, x1: active.x1, y0: active.y0, y1: active.y1 })
  splitH(g('top'), { x0: active.x0, x1: active.x1, y0: active.y0, y1: active.y0 + eh })
  splitH(g('bottom'), { x0: active.x0, x1: active.x1, y0: active.y1 - eh, y1: active.y1 })
  splitH(g('center'), active)
  return out
}

/** The picture area once bars are removed. */
export function activeArea(f: Frame, bars: Bars): Rect {
  const r = { x0: bars.left, y0: bars.top, x1: f.width - bars.right, y1: f.height - bars.bottom }
  if (r.x1 - r.x0 < 4 || r.y1 - r.y0 < 4) return { x0: 0, y0: 0, x1: f.width, y1: f.height }
  return r
}

// --- Colour per zone ---

const HUE_BINS = 36
const NEAR_BLACK = 0.08
/** Share of the zone that must be clearly coloured for the zone to count as vivid. */
const VIVID_SHARE = 0.03
const VIVID_SAT = 0.2

function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  let h = 0
  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  return [h, max === 0 ? 0 : d / max, max / 255]
}

/**
 * Colour of a zone. A plain average turns muddy, so pixels are weighted by
 * saturation and brightness and the dominant vivid hue wins. Zones that are
 * grey or nearly black are reported as not vivid, with their luminance.
 */
export function zoneColor(f: Frame, r: Rect): ZoneColor {
  const weights = new Float64Array(HUE_BINS)
  const sumR = new Float64Array(HUE_BINS)
  const sumG = new Float64Array(HUE_BINS)
  const sumB = new Float64Array(HUE_BINS)
  let lumSum = 0
  let count = 0
  let allR = 0
  let allG = 0
  let allB = 0
  for (let y = r.y0; y < r.y1; y++) {
    for (let x = r.x0; x < r.x1; x++) {
      const i = (y * f.width + x) * 4
      const R = f.data[i]
      const G = f.data[i + 1]
      const B = f.data[i + 2]
      lumSum += luma(R, G, B) / 255
      allR += R
      allG += G
      allB += B
      count++
      const [h, s, v] = rgbToHsv(R, G, B)
      if (v < NEAR_BLACK || s < 0.05) continue
      const w = Math.pow(s, 1.5) * Math.pow(v, 1.2)
      const bin = Math.min(HUE_BINS - 1, Math.floor((h / 360) * HUE_BINS))
      weights[bin] += w
      sumR[bin] += R * w
      sumG[bin] += G * w
      sumB[bin] += B * w
    }
  }
  const luminance = count ? lumSum / count : 0
  const [tH, tS] = count ? rgbToHsv(allR / count, allG / count, allB / count) : [30, 0]
  const tint = { tintH: Math.round(tH), tintS: Math.round(tS * 100) }

  // Dominant hue: the strongest window of three neighbouring bins
  let best = -1
  let bestW = 0
  for (let b = 0; b < HUE_BINS; b++) {
    const w = weights[(b + HUE_BINS - 1) % HUE_BINS] + weights[b] + weights[(b + 1) % HUE_BINS]
    if (w > bestW) {
      bestW = w
      best = b
    }
  }
  if (best < 0 || !count || bestW / count < VIVID_SHARE) return { h: 30, s: 0, luminance, vivid: false, ...tint }
  let R = 0
  let G = 0
  let B = 0
  let W = 0
  for (const b of [(best + HUE_BINS - 1) % HUE_BINS, best, (best + 1) % HUE_BINS]) {
    R += sumR[b]
    G += sumG[b]
    B += sumB[b]
    W += weights[b]
  }
  const [h, s] = rgbToHsv(R / W, G / W, B / W)
  if (s < VIVID_SAT) return { h: 30, s: 0, luminance, vivid: false, ...tint }
  return { h: Math.round(h), s: Math.round(s * 100), luminance, vivid: true, ...tint }
}

// --- Change and scene cuts ---

const THUMB_W = 40
const THUMB_H = 22

/** A tiny luma thumbnail used only to compare consecutive frames. */
export function lumaThumb(f: Frame): Float32Array {
  const out = new Float32Array(THUMB_W * THUMB_H)
  for (let ty = 0; ty < THUMB_H; ty++) {
    for (let tx = 0; tx < THUMB_W; tx++) {
      const x = Math.min(f.width - 1, Math.floor(((tx + 0.5) * f.width) / THUMB_W))
      const y = Math.min(f.height - 1, Math.floor(((ty + 0.5) * f.height) / THUMB_H))
      const i = (y * f.width + x) * 4
      out[ty * THUMB_W + tx] = luma(f.data[i], f.data[i + 1], f.data[i + 2]) / 255
    }
  }
  return out
}

/** Mean absolute luma difference between two thumbnails, 0..1. */
export function thumbDiff(a: Float32Array, b: Float32Array): number {
  let d = 0
  for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i])
  return d / a.length
}

/** Below this the frame is treated as unchanged and not analysed again. */
export const UNCHANGED_DIFF = 0.004
/** Above this the picture changed so much at once that it is a new scene. */
export const SCENE_CUT_DIFF = 0.2

/** True when almost every pixel is black. */
export function isBlackFrame(f: Frame): boolean {
  let dark = 0
  const n = f.width * f.height
  for (let i = 0; i < n; i++) {
    const j = i * 4
    if (luma(f.data[j], f.data[j + 1], f.data[j + 2]) < 6) dark++
  }
  return dark >= n * 0.995
}

export interface FrameResult {
  /** Wall-clock time the frame was captured. */
  at: number
  zones: Record<string, ZoneColor>
  sceneCut: boolean
  black: boolean
  bars: Bars
}

/**
 * Per-frame analysis with the state that spans frames: change detection,
 * scene cuts and steady letterbox detection. Returns null when the frame
 * barely changed and does not need new colours.
 */
export class ScreenAnalyzer {
  private prevThumb: Float32Array | null = null
  private letterbox = new LetterboxTracker()

  constructor(
    public placements: Placement[] = [],
    public edgeShare = 0.18,
    public ignoreBars = true
  ) {}

  public reset(): void {
    this.prevThumb = null
    this.letterbox.reset()
  }

  public process(f: Frame, at: number, force = false): FrameResult | null {
    const thumb = lumaThumb(f)
    const diff = this.prevThumb ? thumbDiff(this.prevThumb, thumb) : 1
    if (!force && this.prevThumb && diff < UNCHANGED_DIFF) return null
    const sceneCut = this.prevThumb !== null && diff >= SCENE_CUT_DIFF
    this.prevThumb = thumb

    const black = isBlackFrame(f)
    const bars = this.ignoreBars && !black ? this.letterbox.update(detectBars(f), at) : { top: 0, bottom: 0, left: 0, right: 0 }
    const area = activeArea(f, bars)
    const zones: Record<string, ZoneColor> = {}
    for (const [id, rect] of zonesFor(this.placements, area, this.edgeShare)) zones[id] = zoneColor(f, rect)
    return { at, zones, sceneCut, black, bars }
  }
}
