import { LightOutput, luminance, hueDistance, clamp } from './output'

/** Hard ceiling for the flash-rate cap. Users can lower it but never raise it. */
export const MAX_FLASHES_PER_SECOND = 3

/**
 * Bulb protection: limits that hold for every light, whatever sends the command (the window,
 * Apple Home, the webhook, the tray, effects, or another computer). Commands in between are
 * merged so the light still ends on the latest value.
 */
export const PROTECTED_LIMITS = {
  /** Most writes to one light per second. */
  commandsPerSecond: 2,
  /** Most flashes per second on any light. */
  flashesPerSecond: 1,
  /** Shortest time between two power changes on one light. */
  powerChangeIntervalMs: 2000
} as const

/** A brightness rise of at least this many points within one frame counts as a flash. */
export const FLASH_RISE_THRESHOLD = 25

/** A hue jump of at least this many degrees on a saturated, visible colour counts as a flash. */
export const FLASH_HUE_THRESHOLD = 60

export interface FlashGuardOptions {
  maxPerSecond: number
  reduceIntensity: boolean
}

/**
 * Enforces the global flash-rate cap per light. A flash is a sudden rise in
 * brightness or a sudden large hue change between two consecutive outputs the
 * bulb actually receives. Once the cap is reached inside a one second window,
 * further sudden changes are softened into gradual ones instead of being sent.
 */
export class FlashGuard {
  private edges = new Map<string, number[]>()
  private maxPerSecond: number
  private reduceIntensity: boolean

  constructor(options: Partial<FlashGuardOptions> = {}) {
    this.maxPerSecond = clamp(Math.floor(options.maxPerSecond ?? MAX_FLASHES_PER_SECOND), 1, MAX_FLASHES_PER_SECOND)
    this.reduceIntensity = Boolean(options.reduceIntensity)
  }

  public configure(options: Partial<FlashGuardOptions>): void {
    if (options.maxPerSecond !== undefined) {
      this.maxPerSecond = clamp(Math.floor(options.maxPerSecond), 1, MAX_FLASHES_PER_SECOND)
    }
    if (options.reduceIntensity !== undefined) this.reduceIntensity = options.reduceIntensity
  }

  public getMaxPerSecond(): number {
    return this.maxPerSecond
  }

  public isReducedIntensity(): boolean {
    return this.reduceIntensity
  }

  /** Number of flashes recorded for a light in the trailing second. */
  public recentCount(lightId: string, now: number): number {
    const list = this.edges.get(lightId)
    if (!list) return 0
    return list.filter((t) => now - t < 1000).length
  }

  public forget(lightId: string): void {
    this.edges.delete(lightId)
  }

  /**
   * Returns the output that may be sent given the previous output the bulb
   * received. Records an edge when a flash is allowed through.
   */
  public apply(lightId: string, prev: LightOutput | null, next: LightOutput, now: number): LightOutput {
    if (!prev) return next

    const prevLum = luminance(prev)
    const nextLum = luminance(next)
    const rise = nextLum - prevLum
    const hueJump =
      prev.power &&
      next.power &&
      prev.mode === 'colour' &&
      next.mode === 'colour' &&
      next.s >= 40 &&
      nextLum >= 20 &&
      hueDistance(prev.h, next.h) >= FLASH_HUE_THRESHOLD

    // Reduced intensity limits every single-frame rise, flash or not.
    let limited = next
    if (this.reduceIntensity && rise > FLASH_RISE_THRESHOLD - 1) {
      limited = this.limitRise(prev, next)
    }

    const isFlash = rise >= FLASH_RISE_THRESHOLD || hueJump
    if (!isFlash || limited !== next) {
      return limited
    }

    const list = (this.edges.get(lightId) || []).filter((t) => now - t < 1000)
    if (list.length >= this.maxPerSecond) {
      this.edges.set(lightId, list)
      return this.limitRise(prev, next, hueJump)
    }

    list.push(now)
    this.edges.set(lightId, list)
    return next
  }

  private limitRise(prev: LightOutput, next: LightOutput, holdHue = false): LightOutput {
    const prevLum = luminance(prev)
    const capped = Math.min(luminance(next), prevLum + FLASH_RISE_THRESHOLD - 1)
    const out: LightOutput = { ...next }
    if (!prev.power && next.power) {
      out.power = capped >= 1
    }
    out.brightness = Math.max(out.power ? 1 : 0, capped)
    if (holdHue && prev.mode === 'colour') {
      out.h = prev.h
    }
    return out
  }
}
