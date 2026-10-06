/**
 * Energy estimation. Tuya bulbs do not report their power draw, so Lumos
 * estimates it from what each bulb is showing:
 *
 *   watts = rated watts x level(brightness) x mode factor, and 0 when off
 *
 *   level(b)    = 0.08 + 0.92 x b^1.4   (b from 0 to 1). LED drivers keep a
 *                 small base load at low dim levels and draw a little less
 *                 than proportionally in the middle of the range.
 *   mode factor = 1.0 for white, 0.55 for colour. Colour mode drives only the
 *                 RGB emitters, which together draw less than the white ones
 *                 at full output.
 *
 * Offline bulbs count as using nothing because their state is unknown.
 * Every figure derived from this is an estimate.
 */

export const DEFAULT_RATED_WATTS = 9

export interface PowerState {
  online: boolean
  power: boolean
  mode: string
  brightness: number // 0..100
}

export function brightnessLevel(brightness: number): number {
  const b = Math.max(0, Math.min(1, brightness / 100))
  return 0.08 + 0.92 * Math.pow(b, 1.4)
}

export function estimateWatts(state: PowerState, ratedWatts: number): number {
  if (!state.online || !state.power || ratedWatts <= 0) return 0
  const factor = state.mode === 'colour' ? 0.55 : 1
  return ratedWatts * brightnessLevel(state.brightness) * factor
}

/** Local calendar day key, YYYY-MM-DD. */
export function dayKey(ms: number): string {
  const d = new Date(ms)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Start of the next local day after ms. */
function nextMidnight(ms: number): number {
  const d = new Date(ms)
  d.setHours(24, 0, 0, 0)
  return d.getTime()
}

/** Daily totals: day -> light id -> [watt hours, seconds on]. */
export type DailyTotals = Record<string, Record<string, [number, number]>>

/**
 * Adds a constant draw between two times, split at local midnight so each day
 * receives only its share.
 */
export function accumulate(days: DailyTotals, lightId: string, startMs: number, endMs: number, watts: number): void {
  if (!(endMs > startMs)) return
  let t = startMs
  while (t < endMs) {
    const boundary = Math.min(endMs, nextMidnight(t))
    const seconds = (boundary - t) / 1000
    const key = dayKey(t)
    const day = (days[key] ||= {})
    const entry = (day[lightId] ||= [0, 0])
    entry[0] += (watts * seconds) / 3600
    if (watts > 0) entry[1] += seconds
    t = boundary
  }
}

/** Removes days older than the given number of days before now. */
export function prune(days: DailyTotals, keepDays: number, now: number): void {
  const cutoff = dayKey(now - keepDays * 86400000)
  for (const key of Object.keys(days)) if (key < cutoff) delete days[key]
}

/** The last n local day keys ending today, oldest first. */
export function lastDays(n: number, now: number): string[] {
  const keys: string[] = []
  const d = new Date(now)
  d.setHours(12, 0, 0, 0)
  for (let i = n - 1; i >= 0; i--) {
    const x = new Date(d)
    x.setDate(d.getDate() - i)
    keys.push(dayKey(x.getTime()))
  }
  return keys
}
