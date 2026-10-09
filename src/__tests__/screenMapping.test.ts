import { describe, it, expect } from 'vitest'
import {
  ZoneSmoother,
  MovieRamp,
  BrightnessLimiter,
  zoneToBulb,
  perceptibleChange,
  timeConstants,
  MODE_RESPONSE,
  SyncTuning,
  WARM_NEUTRAL_TEMP
} from '../main/effects/screen/mapping'
import type { ZoneColor } from '../shared/screen/analysis'

const tuning: SyncTuning = {
  responseSpeed: MODE_RESPONSE.cinema,
  saturation: 20,
  minBrightness: 8,
  maxBrightness: 100,
  intensity: 100,
  dimDarkScenes: true,
  limiter: true
}
const tc = timeConstants(MODE_RESPONSE.cinema)
const neutralDim: ZoneColor = { h: 30, s: 0, luminance: 0.2, vivid: false }
const greenBurst: ZoneColor = { h: 110, s: 90, luminance: 0.75, vivid: true }
const blueSoft: ZoneColor = { h: 220, s: 70, luminance: 0.4, vivid: true }

describe('Screen Sync: attack and release', () => {
  it('a sudden explosion reaches the bulb within about 150 ms', () => {
    const z = new ZoneSmoother()
    z.update(neutralDim, 0, false, tc)
    z.update(greenBurst, 1000, false, tc)
    const at150 = z.sample(1150)!
    expect(at150.luminance).toBeGreaterThan(0.7)
    expect(at150.vivid).toBeGreaterThan(0.9)
  })

  it('gentle changes smooth over roughly half a second or more', () => {
    const z = new ZoneSmoother()
    z.update(blueSoft, 0, false, tc)
    z.update({ ...blueSoft, h: 235, luminance: 0.36 }, 1000, false, tc)
    const at150 = z.sample(1150)!
    expect(at150.luminance).toBeGreaterThan(0.37) // still well on its way
    const at2000 = z.sample(3000)!
    expect(at2000.luminance).toBeCloseTo(0.36, 2)
  })

  it('darkening releases more slowly than brightening attacks', () => {
    const up = new ZoneSmoother()
    up.update({ ...neutralDim, luminance: 0.1 }, 0, false, tc)
    up.update({ ...neutralDim, luminance: 0.9 }, 100, false, tc)
    const down = new ZoneSmoother()
    down.update({ ...neutralDim, luminance: 0.9 }, 0, false, tc)
    down.update({ ...neutralDim, luminance: 0.85 }, 100, false, tc)
    const upProgress = (up.sample(250)!.luminance - 0.1) / 0.8
    const downProgress = (0.9 - down.sample(250)!.luminance) / 0.05
    expect(upProgress).toBeGreaterThan(downProgress)
  })

  it('a scene cut snaps instead of fading', () => {
    const z = new ZoneSmoother()
    z.update(blueSoft, 0, false, tc)
    z.update({ ...neutralDim, luminance: 0.05 }, 1000, true, tc)
    expect(z.sample(1001)!.luminance).toBeCloseTo(0.05, 5)
  })

  it('gaming reacts faster than cinema', () => {
    expect(timeConstants(MODE_RESPONSE.gaming).releaseMs).toBeLessThan(timeConstants(MODE_RESPONSE.cinema).releaseMs)
  })
})

describe('Screen Sync: brightness and colour mapping', () => {
  const state = (luminance: number, vivid = 1, h = 110, s = 90) => ({ h, s, luminance, vivid })

  it('respects the floor and ceiling', () => {
    expect(zoneToBulb(state(0), tuning).brightness).toBe(8)
    expect(zoneToBulb(state(1), { ...tuning, maxBrightness: 70 }).brightness).toBe(70)
  })

  it('dark scenes dim without turning off, unless the floor is zero', () => {
    expect(zoneToBulb(state(0.01, 0), tuning).brightness).toBeGreaterThan(0)
    expect(zoneToBulb(state(0, 0), { ...tuning, minBrightness: 0 }).brightness).toBe(0)
  })

  it('keeps full brightness when dimming in dark scenes is off', () => {
    expect(zoneToBulb(state(0.05), { ...tuning, dimDarkScenes: false }).brightness).toBe(100)
  })

  it('locks to maximum brightness in full brightness mode even in dark scenes', () => {
    expect(zoneToBulb(state(0.02), { ...tuning, fullBrightness: true }).brightness).toBe(100)
    expect(zoneToBulb(state(0.02), { ...tuning, fullBrightness: true, maxBrightness: 80 }).brightness).toBe(80)
    expect(zoneToBulb(state(0.02), { ...tuning, fullBrightness: true, maxBrightness: 80, intensity: 50 }).brightness).toBe(40)
  })

  it('intensity scales everything down', () => {
    const half = zoneToBulb(state(1), { ...tuning, intensity: 50 })
    const fullOut = zoneToBulb(state(1), tuning)
    expect(half.brightness).toBeLessThan(fullOut.brightness)
    expect(half.s).toBeLessThan(fullOut.s)
  })

  it('grey zones become a warm neutral white', () => {
    const b = zoneToBulb(state(0.5, 0, 30, 0), tuning)
    expect(b.colour).toBe(false)
    expect(b.colorTemp).toBe(WARM_NEUTRAL_TEMP)
  })

  it('vivid zones get enough saturation to read as colour on a bulb', () => {
    expect(zoneToBulb(state(0.6, 1, 220, 40), tuning).s).toBeGreaterThanOrEqual(55)
  })

  it('only sends perceptible changes', () => {
    const a = zoneToBulb(state(0.5), tuning)
    expect(perceptibleChange(a, { ...a, brightness: a.brightness + 1 })).toBe(false)
    expect(perceptibleChange(a, { ...a, brightness: a.brightness + 3 })).toBe(true)
    expect(perceptibleChange(a, { ...a, h: a.h + 2 })).toBe(false)
    expect(perceptibleChange(a, { ...a, h: a.h + 10 })).toBe(true)
  })
})

describe('Screen Sync: brightness-change limiter', () => {
  it('allows one large swing, then softens rapid swings', () => {
    const l = new BrightnessLimiter()
    expect(l.apply(20, 90, 0)).toBe(90)
    expect(l.apply(90, 20, 100)).toBe(71) // too soon: limited to a small step
    expect(l.apply(71, 20, 500)).toBe(20) // after the interval it may swing again
  })

  it('never lets brightness alternate faster than about 2.5 times per second', () => {
    const l = new BrightnessLimiter()
    let prev = 20
    let swings = 0
    for (let t = 0; t < 1000; t += 50) {
      const want = Math.floor(t / 50) % 2 === 0 ? 100 : 5
      const out = l.apply(prev, want, t)
      if (Math.abs(out - prev) >= 20) swings++
      prev = out
    }
    expect(swings).toBeLessThanOrEqual(3)
  })
})

describe('Screen Sync: Movie mode (colour only)', () => {
  const movie: SyncTuning = { ...tuning, colourOnly: true }
  const settle = (zone: ZoneColor): ReturnType<typeof zoneToBulb> => {
    const z = new ZoneSmoother()
    z.update(zone, 0, false, tc)
    return zoneToBulb(z.sample(0)!, movie)
  }

  it('shows a bright warm-white area as a colour, not as plain white', () => {
    const b = settle({ h: 30, s: 0, luminance: 0.8, vivid: false, tintH: 32, tintS: 18 })
    expect(b.colour).toBe(true)
    expect(b.h).toBeGreaterThanOrEqual(25)
    expect(b.h).toBeLessThanOrEqual(35)
    expect(b.s).toBeGreaterThan(10)
    expect(b.brightness).toBeGreaterThan(40)
  })

  it('keeps the dominant colour of a vivid zone', () => {
    const b = settle(greenBurst)
    expect(b.colour).toBe(true)
    expect(b.h).toBeGreaterThan(100)
    expect(b.h).toBeLessThan(120)
  })

  it('turns the light off when the picture is dark, whatever the minimum brightness', () => {
    expect(settle({ h: 30, s: 0, luminance: 0.02, vivid: false, tintH: 30, tintS: 5 }).brightness).toBe(0)
    expect(settle({ h: 30, s: 0, luminance: 0, vivid: false }).brightness).toBe(0)
  })

  it('keeps a dim picture dim', () => {
    const b = settle({ h: 30, s: 0, luminance: 0.1, vivid: false, tintH: 30, tintS: 10 })
    expect(b.brightness).toBeGreaterThan(0)
    expect(b.brightness).toBeLessThan(30)
  })

  it('leaves the normal mapping alone when it is off', () => {
    const z = new ZoneSmoother()
    z.update({ h: 30, s: 0, luminance: 0.8, vivid: false, tintH: 32, tintS: 18 }, 0, false, tc)
    expect(zoneToBulb(z.sample(0)!, tuning).colour).toBe(false)
  })
})

describe('Screen Sync: Movie mode never dazzles', () => {
  it('stays below 60 percent of the maximum even for a white picture', () => {
    const z = new ZoneSmoother()
    z.update({ h: 30, s: 0, luminance: 1, vivid: false, tintH: 30, tintS: 0 }, 0, false, tc)
    expect(zoneToBulb(z.sample(0)!, { ...tuning, colourOnly: true }).brightness).toBeLessThanOrEqual(60)
  })

  it('brings the light up slowly after a dark scene and drops at once', () => {
    const r = new MovieRamp()
    expect(r.apply(0, 0)).toBe(0)
    expect(r.apply(60, 100)).toBeCloseTo(2.5, 1)
    expect(r.apply(60, 1100)).toBeCloseTo(27.5, 1)
    expect(r.apply(60, 3000)).toBe(60)
    expect(r.apply(5, 3010)).toBe(5)
  })

  it('starts a bright first frame at a gentle level', () => {
    expect(new MovieRamp().apply(60, 0)).toBeLessThanOrEqual(25)
  })
})

describe('Screen Sync: Movie mode options', () => {
  const dark: ZoneColor = { h: 30, s: 0, luminance: 0.01, vivid: false, tintH: 30, tintS: 5 }
  const bright: ZoneColor = { h: 30, s: 0, luminance: 1, vivid: false, tintH: 30, tintS: 0 }
  const out = (zone: ZoneColor, t: Partial<SyncTuning>): number => {
    const z = new ZoneSmoother()
    z.update(zone, 0, false, tc)
    return zoneToBulb(z.sample(0)!, { ...tuning, colourOnly: true, ...t }).brightness
  }

  it('keeps dark scenes dim at the minimum brightness when they are not allowed to go off', () => {
    expect(out(dark, { movieOffInDark: true })).toBe(0)
    expect(out(dark, { movieOffInDark: false, minBrightness: 8 })).toBe(8)
  })

  it('movie brightness sets the most the lights ever show', () => {
    expect(out(bright, { movieCeiling: 100 })).toBe(100)
    expect(out(bright, { movieCeiling: 30 })).toBe(30)
    expect(out(bright, { movieCeiling: 10, maxBrightness: 50 })).toBe(5)
  })

  it('rise speed controls how fast the lights get brighter', () => {
    const slow = new MovieRamp()
    const fast = new MovieRamp()
    slow.apply(0, 0, 10)
    fast.apply(0, 0, 80)
    expect(slow.apply(60, 1000, 10)).toBeCloseTo(10, 1)
    expect(fast.apply(60, 1000, 80)).toBeCloseTo(60, 1)
  })
})
