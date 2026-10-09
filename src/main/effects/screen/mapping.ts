import { clamp, lerp, lerpHue, hueDistance } from '../output'
import type { ZoneColor } from '../../../shared/screen/analysis'

export type SyncMode = 'cinema' | 'gaming' | 'custom'

export interface SyncTuning {
  /** 0..100: higher reacts faster. Cinema and Gaming set it. */
  responseSpeed: number
  /** 0..100: extra saturation added to colours. */
  saturation: number
  /** Brightness floor and ceiling in percent. A floor of 0 lets lights turn off in black scenes. */
  minBrightness: number
  maxBrightness: number
  /** Always output at maximum brightness, bypassing luminance dimming. */
  fullBrightness?: boolean
  /** 0..100: scales brightness and colourfulness. */
  intensity: number
  dimDarkScenes: boolean
  limiter: boolean
  /**
   * Movie mode: the lights always show the colour of the picture, never a plain white, and go dark when the
   * picture is dark. The brightness floor and the dim setting do not apply.
   */
  colourOnly?: boolean
  /** Movie mode: turn the light off when the picture is dark. When false, dark scenes stay dim instead. */
  movieOffInDark?: boolean
  /** Movie mode: share of Maximum brightness that is never exceeded, 10..100. */
  movieCeiling?: number
  /** Movie mode: the most brightness can rise per second, in points. */
  movieRise?: number
}

export const MODE_RESPONSE: Record<Exclude<SyncMode, 'custom'>, number> = { cinema: 35, gaming: 85 }

/**
 * Time constants for a response speed. Attack applies to big or brightening
 * changes, release to everything else. At the Cinema setting a large change
 * settles in about 120 ms and gentle drifts in about 700 ms; at Gaming the
 * release is about 250 ms.
 */
export function timeConstants(responseSpeed: number): { attackMs: number; releaseMs: number } {
  const t = clamp(responseSpeed, 0, 100) / 100
  return { attackMs: Math.round(lerp(60, 25, t)), releaseMs: Math.round(lerp(900, 200, t)) }
}

export interface ZoneState {
  h: number
  s: number
  luminance: number
  vivid: number // 0..1, blends between neutral and colour
  /** The zone's average colour, used by Movie mode when nothing in the zone is vivid. */
  th: number
  ts: number
}

/** Large changes use the attack time constant. */
const BIG_LUMA = 0.12
const BIG_HUE = 40

/**
 * Smooths one zone over time: fast attack for big or brightening changes,
 * slower release for the rest, and a snap on scene cuts. It is sampled at
 * the compositor's frame rate, so motion stays smooth between analysed frames.
 */
export class ZoneSmoother {
  private current: ZoneState | null = null
  private target: ZoneState | null = null
  private tau = 400
  private lastAt = 0

  public update(zone: ZoneColor, now: number, sceneCut: boolean, tuning: { attackMs: number; releaseMs: number }): void {
    const next: ZoneState = { h: zone.h, s: zone.vivid ? zone.s : 0, luminance: zone.luminance, vivid: zone.vivid ? 1 : 0, th: zone.tintH ?? zone.h, ts: zone.tintS ?? 0 }
    if (!this.current || sceneCut) {
      this.current = { ...next }
      this.target = next
      this.lastAt = now
      return
    }
    this.advance(now)
    const cur = this.current
    const big =
      next.luminance - cur.luminance > BIG_LUMA * 0.5 ||
      Math.abs(next.luminance - cur.luminance) > BIG_LUMA ||
      (next.vivid > 0.5 && cur.vivid > 0.5 && hueDistance(next.h, cur.h) > BIG_HUE) ||
      Math.abs(next.vivid - cur.vivid) > 0.5
    this.tau = big ? tuning.attackMs : tuning.releaseMs
    this.target = next
  }

  /** Smoothed state at a moment, or null before the first frame. */
  public sample(now: number): ZoneState | null {
    this.advance(now)
    return this.current
  }

  private advance(now: number): void {
    if (!this.current || !this.target) return
    const dt = Math.max(0, now - this.lastAt)
    this.lastAt = now
    if (dt === 0) return
    const a = 1 - Math.exp(-dt / Math.max(1, this.tau))
    const c = this.current
    const t = this.target
    // Keep the old hue while fading in from neutral so the colour does not sweep
    const h = c.vivid < 0.05 ? t.h : t.vivid < 0.05 ? c.h : lerpHue(c.h, t.h, a)
    this.current = {
      h,
      s: lerp(c.s, t.s, a),
      luminance: lerp(c.luminance, t.luminance, a),
      vivid: lerp(c.vivid, t.vivid, a),
      th: lerpHue(c.th, t.th, a),
      ts: lerp(c.ts, t.ts, a)
    }
  }

  public reset(): void {
    this.current = null
    this.target = null
  }
}

export interface BulbColor {
  /** Colour mode when vivid, otherwise a warm neutral white. */
  colour: boolean
  h: number
  s: number
  brightness: number // percent; 0 means off
  colorTemp: number
}

/** The neutral used for grey and dark zones. */
export const WARM_NEUTRAL_TEMP = 25

/**
 * RGB bulbs render some hues off: yellows lean green and oranges lean yellow.
 * A small correction keeps colours closer to the screen.
 */
export function gamutHue(h: number): number {
  const x = ((h % 360) + 360) % 360
  if (x >= 20 && x < 75) return x - Math.sin(((x - 20) / 55) * Math.PI) * 8
  return x
}

/** Below this luminance the picture counts as dark and Movie mode turns the light off. */
export const MOVIE_DARK_LUMA = 0.04

/** Defaults: Movie mode stays at or below this percent of the Maximum brightness setting. */
export const MOVIE_CEILING = 60
/** Defaults: Movie mode brightness rises by at most this many points per second; it can fall at any speed. */
export const MOVIE_RISE_PER_S = 25

/** Movie mode: always a colour, matched to the picture, and dark when the picture is dark. */
function zoneToBulbMovie(z: ZoneState, tuning: SyncTuning): BulbColor {
  const intensity = clamp(tuning.intensity, 0, 100) / 100
  const ceiling = (clamp(tuning.maxBrightness, 0, 100) * clamp(tuning.movieCeiling ?? MOVIE_CEILING, 10, 100)) / 100
  const lit = clamp((z.luminance - MOVIE_DARK_LUMA) / (1 - MOVIE_DARK_LUMA), 0, 1)
  // With dark scenes allowed to go off the floor is zero; otherwise they keep the minimum brightness
  const floor = tuning.movieOffInDark === false ? Math.min(Math.max(1, clamp(tuning.minBrightness, 0, 100)), ceiling) : 0
  const brightness = clamp(
    (tuning.fullBrightness ? ceiling : floor + (ceiling - floor) * Math.pow(lit, 0.6)) * intensity,
    0,
    100
  )
  const boost = 1 + clamp(tuning.saturation, 0, 100) / 100
  // A vivid zone keeps its dominant colour; otherwise the zone's own average colour is used, so a warm
  // white scene stays warm instead of switching to a plain white
  const vividMix = clamp(z.vivid, 0, 1)
  const h = vividMix >= 0.5 ? z.h : z.th
  const sat = lerp(z.ts, Math.max(55, z.s * boost), vividMix)
  return {
    colour: true,
    h: Math.round(gamutHue(h)),
    s: Math.round(clamp(sat * (vividMix >= 0.5 ? 1 : boost), 0, 100)),
    brightness: Math.round(brightness),
    colorTemp: WARM_NEUTRAL_TEMP
  }
}

/** Maps a smoothed zone to what a bulb should show. */
export function zoneToBulb(z: ZoneState, tuning: SyncTuning): BulbColor {
  if (tuning.colourOnly) return zoneToBulbMovie(z, tuning)
  const intensity = clamp(tuning.intensity, 0, 100) / 100
  const floor = clamp(tuning.minBrightness, 0, 100)
  const ceiling = Math.max(floor, clamp(tuning.maxBrightness, 0, 100))
  let brightness: number
  if (tuning.fullBrightness) {
    brightness = ceiling * intensity
  } else {
    // Perceptual curve so mid tones are not too dim on the bulb
    const curve = Math.pow(clamp(z.luminance, 0, 1), 0.6)
    const level = tuning.dimDarkScenes ? curve : 1
    brightness = (floor + (ceiling - floor) * level) * intensity
    if (floor > 0) brightness = Math.max(Math.min(floor, ceiling) * Math.min(1, intensity + 0.0001), brightness)
  }
  brightness = clamp(brightness, 0, 100)

  // Bulbs need strong saturation to read as coloured
  const boost = 1 + clamp(tuning.saturation, 0, 100) / 100
  const vividSat = clamp(Math.max(55, z.s * boost), 0, 100) * Math.sqrt(Math.max(intensity, 0.0001))
  const colour = z.vivid >= 0.5
  return {
    colour,
    h: Math.round(gamutHue(z.h)),
    s: colour ? Math.round(lerp(0, vividSat, clamp((z.vivid - 0.5) * 2 + 0.5, 0, 1))) : 0,
    brightness: Math.round(brightness),
    colorTemp: WARM_NEUTRAL_TEMP
  }
}

/** True when the difference between two outputs is worth sending. */
export function perceptibleChange(a: BulbColor | null, b: BulbColor): boolean {
  if (!a) return true
  if (a.colour !== b.colour) return true
  if (Math.abs(a.brightness - b.brightness) >= 2) return true
  if ((a.brightness === 0) !== (b.brightness === 0)) return true
  if (b.colour && b.s > 15 && hueDistance(a.h, b.h) >= 4) return true
  if (b.colour && Math.abs(a.s - b.s) >= 5) return true
  return false
}

/** Swings of at least this many brightness points count as large. */
export const LIMITER_SWING = 20
/** At most one large swing per this many milliseconds. */
export const LIMITER_INTERVAL_MS = 400

/**
 * Brightness-change limiter: caps how often brightness can swing by a large
 * amount, in either direction, so rapid scene flashes cannot strobe. Works
 * alongside the app-wide flash-rate cap.
 */
/**
 * Keeps Movie mode from dazzling: a cut from a dark scene to a bright one brings the light up over a couple
 * of seconds instead of at once. Getting darker is never slowed down.
 */
export class MovieRamp {
  private level: number | null = null
  private at = 0

  public apply(target: number, now: number, risePerS: number = MOVIE_RISE_PER_S): number {
    if (this.level === null) {
      this.level = Math.min(target, risePerS)
    } else {
      const dt = Math.max(0, now - this.at) / 1000
      this.level = target <= this.level ? target : Math.min(target, this.level + risePerS * dt)
    }
    this.at = now
    return this.level
  }

  public reset(): void {
    this.level = null
  }
}

export class BrightnessLimiter {
  private lastSwingAt = -Infinity

  public apply(prev: number | null, next: number, now: number): number {
    if (prev === null) return next
    const delta = next - prev
    if (Math.abs(delta) < LIMITER_SWING) return next
    if (now - this.lastSwingAt < LIMITER_INTERVAL_MS) {
      return prev + Math.sign(delta) * (LIMITER_SWING - 1)
    }
    this.lastSwingAt = now
    return next
  }

  public reset(): void {
    this.lastSwingAt = -Infinity
  }
}
