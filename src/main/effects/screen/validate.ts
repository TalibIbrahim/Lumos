import type { FrameResult, ZoneColor, Bars } from '../../../shared/screen/analysis'
import { asObj, bool, num } from '../validate'

export interface ScreenStats {
  at: number
  analysedPerSecond: number
  analysisMs: number
  /** How long the captured picture has been black, or 0. */
  blackMs: number
  /** How long the picture has not changed. */
  stillMs: number
  /** Time since the capturer last delivered a frame, or -1 before the first. */
  sinceFrameMs: number
}

function zone(raw: unknown): ZoneColor | null {
  const o = asObj(raw)
  if (typeof o.luminance !== 'number') return null
  const out: ZoneColor = { h: num(o.h, 0, 0, 360), s: num(o.s, 0, 0, 100), luminance: num(o.luminance, 0, 0, 1), vivid: bool(o.vivid, false) }
  if (typeof o.tintH === 'number' && typeof o.tintS === 'number') {
    out.tintH = num(o.tintH, 0, 0, 360)
    out.tintS = num(o.tintS, 0, 0, 100)
  }
  return out
}

/** Validates a frame result from the capture page. */
export function sanitizeResult(raw: unknown): FrameResult | null {
  const o = asObj(raw)
  const zonesIn = asObj(o.zones)
  const zones: Record<string, ZoneColor> = {}
  for (const [id, z] of Object.entries(zonesIn).slice(0, 64)) {
    if (id.length > 128) continue
    const v = zone(z)
    if (v) zones[id] = v
  }
  const b = asObj(o.bars)
  const bars: Bars = { top: num(b.top, 0, 0, 1000), bottom: num(b.bottom, 0, 0, 1000), left: num(b.left, 0, 0, 1000), right: num(b.right, 0, 0, 1000) }
  return { at: num(o.at, Date.now(), 0, 1e15), zones, sceneCut: bool(o.sceneCut, false), black: bool(o.black, false), bars }
}

export function sanitizeStats(raw: unknown): ScreenStats | null {
  const o = asObj(raw)
  if (typeof o.at !== 'number') return null
  return {
    at: o.at,
    analysedPerSecond: num(o.analysedPerSecond, 0, 0, 120),
    analysisMs: num(o.analysisMs, 0, 0, 10000),
    blackMs: num(o.blackMs, 0, 0, 1e9),
    stillMs: num(o.stillMs, 0, 0, 1e9),
    sinceFrameMs: num(o.sinceFrameMs, -1, -1, 1e9)
  }
}
