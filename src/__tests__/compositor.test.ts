import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { Compositor, Layer, LayerPriority, ComposeContext } from '../main/effects/compositor'
import { FlashGuard } from '../main/effects/safety'
import { LightOutput, blendOutput, lerpHue, outputsEqual } from '../main/effects/output'
import { Effect, EffectSettingsBase } from '../main/effects/Effect'
import { EffectManager, PausedNotice } from '../main/effects/EffectManager'
import { FlashLayer } from '../main/effects/flash'
import { createMockLights, flushMicrotasks, sendsFor } from './helpers/mockLights'
import type { Light } from '../main/devices/Light'

/** A layer with a fixed transform, for exercising the compositor. */
class TestLayer implements Layer {
  animating = false
  constructor(
    readonly id: string,
    readonly priority: LayerPriority,
    private fn: (below: LightOutput, ctx: ComposeContext) => LightOutput | null,
    private targets: string[] | 'all' = 'all',
    readonly label = id
  ) {}
  appliesTo(id: string): boolean {
    return this.targets === 'all' || this.targets.includes(id)
  }
  compose(below: LightOutput, ctx: ComposeContext): LightOutput | null {
    return this.fn(below, ctx)
  }
  isAnimating(): boolean {
    return this.animating
  }
}

const red = (below: LightOutput): LightOutput => ({ ...below, power: true, mode: 'colour', h: 0, s: 100 })
const dim = (factor: number) => (below: LightOutput): LightOutput => ({ ...below, brightness: below.brightness * factor })

describe('Compositor: layer priority and composition', () => {
  let compositor: Compositor
  let lights: Light[]

  beforeEach(() => {
    vi.useFakeTimers()
    ;({ lights } = createMockLights(2))
    compositor = new Compositor({ ratePerSecond: 12 })
    compositor.attach(lights)
  })
  afterEach(() => {
    compositor.destroy()
    vi.useRealTimers()
  })

  it('applies layers lowest priority first so the highest priority ends on top', () => {
    compositor.addLayer(new TestLayer('album', LayerPriority.NowPlaying, red))
    compositor.addLayer(new TestLayer('idle', LayerPriority.Idle, dim(0.25)))
    const out = compositor.getOutput('mock-1')!
    expect(out.mode).toBe('colour')
    expect(out.h).toBe(0)
    expect(out.brightness).toBe(20) // 80 * 0.25
    expect(compositor.getTopLayerId('mock-1')).toBe('idle')
  })

  it('order of adding layers does not matter', () => {
    compositor.addLayer(new TestLayer('idle', LayerPriority.Idle, dim(0.25)))
    compositor.addLayer(new TestLayer('album', LayerPriority.NowPlaying, red))
    expect(compositor.getOutput('mock-1')!.brightness).toBe(20)
    expect(compositor.getOutput('mock-1')!.mode).toBe('colour')
  })

  it('a layer passing through (null) leaves the state below untouched', () => {
    compositor.addLayer(new TestLayer('noop', LayerPriority.Music, () => null))
    expect(outputsEqual(compositor.getOutput('mock-1'), lights[0].baseOutput())).toBe(true)
    expect(compositor.getTopLayerId('mock-1')).toBeNull()
  })

  it('only affects targeted lights', () => {
    compositor.addLayer(new TestLayer('album', LayerPriority.NowPlaying, red, ['mock-2']))
    expect(compositor.getOutput('mock-1')!.mode).toBe('white')
    expect(compositor.getOutput('mock-2')!.mode).toBe('colour')
  })

  it('reports the active effect label on the light state', () => {
    compositor.addLayer(new TestLayer('album', LayerPriority.NowPlaying, red, 'all', 'Album color'))
    expect(lights[0].getState().effect).toBe('Album color')
    compositor.removeLayer('album')
    expect(lights[0].getState().effect).toBeUndefined()
  })
})

describe('Compositor: restore behavior', () => {
  let compositor: Compositor
  let lights: Light[]

  beforeEach(() => {
    vi.useFakeTimers()
    ;({ lights } = createMockLights(1))
    compositor = new Compositor()
    compositor.attach(lights)
  })
  afterEach(() => {
    compositor.destroy()
    vi.useRealTimers()
  })

  it('restores to the state composed underneath, not a snapshot taken when the overlay began', async () => {
    compositor.addLayer(new TestLayer('album', LayerPriority.NowPlaying, (b) => ({ ...red(b), h: 200 })))
    compositor.addLayer(new TestLayer('flash', LayerPriority.GameOverlay, red))
    expect(compositor.getOutput('mock-1')!.h).toBe(0)

    // While the flash is up, the base changes (an automation dims the light)
    await lights[0].setBrightness(30)
    vi.advanceTimersByTime(500)

    compositor.removeLayer('flash')
    const out = compositor.getOutput('mock-1')!
    expect(out.h).toBe(200) // album colour underneath, not the pre-flash snapshot
    expect(out.brightness).toBe(30) // the new base brightness
  })

  it('fades back over the requested duration with easing', () => {
    compositor.addLayer(new TestLayer('dim', LayerPriority.Idle, dim(0)))
    vi.advanceTimersByTime(200)
    expect(compositor.getOutput('mock-1')!.brightness).toBe(0)

    compositor.removeLayer('dim', 1000)
    vi.advanceTimersByTime(500)
    const mid = compositor.getOutput('mock-1')!.brightness
    expect(mid).toBeGreaterThan(20)
    expect(mid).toBeLessThan(60)

    vi.advanceTimersByTime(600)
    expect(compositor.getOutput('mock-1')!.brightness).toBe(80)
  })

  it('ignores device reports that echo effect output', () => {
    compositor.addLayer(new TestLayer('album', LayerPriority.NowPlaying, red))
    // The bulb reports the red it was told to show
    // @ts-expect-error simulate a device report
    lights[0]['handleTuyaData']({ dps: { '21': 'colour', '24': '000003e8 03e8'.replace(' ', '') } })
    expect(lights[0].mode).toBe('white')
    expect(lights[0].brightness).toBe(80)
  })

  it('accepts device reports again once effects are gone', () => {
    compositor.addLayer(new TestLayer('album', LayerPriority.NowPlaying, red))
    compositor.removeLayer('album')
    vi.advanceTimersByTime(2500)
    // @ts-expect-error simulate a device report
    lights[0]['handleTuyaData']({ dps: { '22': 505 } })
    expect(lights[0].brightness).toBe(50)
  })

  it('releaseAll sends the base state immediately', async () => {
    compositor.addLayer(new TestLayer('album', LayerPriority.NowPlaying, red))
    expect(lights[0].lastSentOutput!.mode).toBe('colour')
    await compositor.releaseAll()
    expect(lights[0].lastSentOutput!.mode).toBe('white')
    expect(lights[0].lastSentOutput!.brightness).toBe(80)
  })
})

describe('Compositor: rate budget and stale frames', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('never exceeds the per-device budget while an animation runs', async () => {
    const { lights, log } = createMockLights(1)
    const compositor = new Compositor({ ratePerSecond: 12, frameMs: 16 })
    compositor.attach(lights)
    const layer = new TestLayer('wave', LayerPriority.Music, (b, ctx) => ({
      ...b,
      brightness: 50 + 40 * Math.sin(ctx.now / 50)
    }))
    layer.animating = true
    compositor.addLayer(layer)

    log.length = 0
    for (let i = 0; i < 2000 / 16; i++) {
      vi.advanceTimersByTime(16)
      await flushMicrotasks()
    }
    // 2 seconds at 12 per second plus the burst allowance
    expect(log.length).toBeLessThanOrEqual(12 * 2 + 2)
    expect(log.length).toBeGreaterThanOrEqual(12 * 2 - 2)
    compositor.destroy()
  })

  it('sends the latest value after a deferral, not the dropped one', async () => {
    const { lights, log } = createMockLights(1)
    const compositor = new Compositor({ ratePerSecond: 4 })
    compositor.attach(lights)
    log.length = 0

    for (const v of [10, 20, 30, 40, 50, 60]) await lights[0].setBrightness(v)
    vi.advanceTimersByTime(1000)
    await flushMicrotasks()

    const last = log[log.length - 1]
    expect(lights[0].denormalizeBrightness(Number(last.data['22']))).toBe(60)
    expect(log.length).toBeLessThan(6)
    compositor.destroy()
  })

  it('sends a single manual command immediately', async () => {
    const { lights, log } = createMockLights(1)
    const compositor = new Compositor()
    compositor.attach(lights)
    log.length = 0
    await lights[0].setPower(false)
    expect(log.length).toBe(1)
    expect(log[0].data).toEqual({ '20': false })
    compositor.destroy()
  })

  it('does not touch the bulb when nothing changed', async () => {
    const { lights, log } = createMockLights(1)
    const compositor = new Compositor()
    compositor.attach(lights)
    log.length = 0
    compositor.invalidate()
    expect(log.length).toBe(0)
    compositor.destroy()
  })

  it('idle compositor schedules no timers', () => {
    const { lights } = createMockLights(3)
    const compositor = new Compositor()
    compositor.attach(lights)
    compositor.addLayer(new TestLayer('static', LayerPriority.NowPlaying, red))
    expect(vi.getTimerCount()).toBe(0)
    compositor.destroy()
  })
})

describe('Compositor: offline and reconnect', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('skips offline bulbs and resends effect output in full when they return', async () => {
    const { lights, log } = createMockLights(1)
    const compositor = new Compositor()
    compositor.attach(lights)
    lights[0].isConnected = false
    log.length = 0

    compositor.addLayer(new TestLayer('album', LayerPriority.NowPlaying, red))
    expect(log.length).toBe(0)

    lights[0].isConnected = true
    lights[0].emit('online')
    await flushMicrotasks()
    expect(log.length).toBe(1)
    expect(log[0].data['21']).toBe('colour')
    expect(log[0].data['20']).toBe(true)
    compositor.destroy()
  })
})

describe('Safety: flash-rate cap', () => {
  it('lets at most the configured number of flashes through per second', () => {
    const guard = new FlashGuard({ maxPerSecond: 3 })
    const low: LightOutput = { power: true, mode: 'white', brightness: 10, colorTemp: 50, h: 0, s: 0 }
    const high: LightOutput = { ...low, brightness: 100 }
    let passed = 0
    for (let i = 0; i < 6; i++) {
      const out = guard.apply('a', low, high, 1000 + i * 100)
      if (out.brightness === 100) passed++
    }
    expect(passed).toBe(3)
    // A second later the window has moved on
    expect(guard.apply('a', low, high, 2500).brightness).toBe(100)
  })

  it('cannot be configured above three per second', () => {
    const guard = new FlashGuard({ maxPerSecond: 10 })
    expect(guard.getMaxPerSecond()).toBe(3)
    guard.configure({ maxPerSecond: 50 })
    expect(guard.getMaxPerSecond()).toBe(3)
  })

  it('treats large hue jumps on saturated colours as flashes', () => {
    const guard = new FlashGuard({ maxPerSecond: 1 })
    const a: LightOutput = { power: true, mode: 'colour', brightness: 80, colorTemp: 50, h: 0, s: 100 }
    const b: LightOutput = { ...a, h: 180 }
    expect(guard.apply('x', a, b, 0).h).toBe(180)
    expect(guard.apply('x', b, a, 100).h).toBe(180) // held at previous hue
  })

  it('reduced intensity limits every sudden rise', () => {
    const guard = new FlashGuard({ reduceIntensity: true })
    const low: LightOutput = { power: true, mode: 'white', brightness: 10, colorTemp: 50, h: 0, s: 0 }
    expect(guard.apply('a', low, { ...low, brightness: 100 }, 0).brightness).toBeLessThan(35)
  })

  it('a flash layer cycle is never shorter than the cap allows', () => {
    const layer = new FlashLayer(
      { label: 'x', targets: ['a'], color: null, count: 6, onMs: 40, offMs: 40, includeOff: true },
      0,
      3
    )
    // 6 flashes at no more than 3 per second take at least 2 seconds
    expect(layer.durationMs()).toBeGreaterThanOrEqual(1998)
  })

  it('the compositor never sends more than three flashes per second from an aggressive layer', async () => {
    vi.useFakeTimers()
    const { lights, log } = createMockLights(1)
    const compositor = new Compositor({ ratePerSecond: 20, frameMs: 16 })
    compositor.attach(lights)
    const strobe = new TestLayer('strobe', LayerPriority.GameOverlay, (b, ctx) => ({
      ...b,
      brightness: Math.floor(ctx.now / 50) % 2 === 0 ? 100 : 5
    }))
    strobe.animating = true
    compositor.addLayer(strobe)
    log.length = 0

    let prev = 80
    const rises: number[] = []
    for (let i = 0; i < 3000 / 16; i++) {
      vi.advanceTimersByTime(16)
      await flushMicrotasks()
    }
    for (const c of log) {
      const raw = c.data['22']
      if (raw === undefined) continue
      const v = lights[0].denormalizeBrightness(Number(raw))
      if (v - prev >= 25) rises.push(c.at)
      prev = v
    }
    // The layer asks for ten flashes per second; some must get through, never more than three a second
    expect(rises.length).toBeGreaterThanOrEqual(6)
    for (const t of rises) {
      expect(rises.filter((x) => x >= t && x < t + 1000).length).toBeLessThanOrEqual(3)
    }
    compositor.destroy()
    vi.useRealTimers()
  })
})

describe('Output math', () => {
  it('interpolates hue along the shortest arc', () => {
    expect(lerpHue(350, 10, 0.5)).toBeCloseTo(0, 5)
    expect(lerpHue(10, 350, 0.5)).toBeCloseTo(0, 5)
    expect(lerpHue(0, 90, 0.5)).toBeCloseTo(45, 5)
  })

  it('fades power changes through brightness', () => {
    const on: LightOutput = { power: true, mode: 'white', brightness: 80, colorTemp: 50, h: 0, s: 0 }
    const off: LightOutput = { ...on, power: false }
    const mid = blendOutput(on, off, 0.5)
    expect(mid.power).toBe(true)
    expect(mid.brightness).toBeCloseTo(40, 5)
    expect(blendOutput(on, off, 1).power).toBe(false)
  })
})

/** A minimal ambient effect to test the manual hand-off. */
class AmbientTestEffect extends Effect {
  readonly id = 'ambient-test'
  readonly label = 'Ambient test'
  readonly description = ''
  readonly ambient = true
  private layer: TestLayer
  constructor(host: ConstructorParameters<typeof Effect>[0]) {
    super(host)
    this.init()
    this.layer = new TestLayer('ambient-test', LayerPriority.Music, red)
    this.layer.appliesTo = (id: string) => this.isTarget(id)
  }
  defaults(): EffectSettingsBase {
    return { enabled: false, targets: 'all' }
  }
  sanitize(raw: unknown): EffectSettingsBase {
    const o = (raw || {}) as Record<string, unknown>
    return { enabled: o.enabled === true, targets: 'all' }
  }
  protected onStart(): void {
    this.host.compositor.addLayer(this.layer)
    this.setStatus('active')
  }
  protected onStop(): void {
    this.host.compositor.removeLayer(this.layer.id)
  }
}

describe('EffectManager: manual control', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('pauses ambient effects on a light changed by hand, notifies, and resumes on request', async () => {
    const { lights } = createMockLights(2)
    const source = { getAllLights: () => lights, getIsDemoMode: () => false }
    const manager = new EffectManager(source, mkdtempSync(join(tmpdir(), 'lumos-fx-')))
    const effect = new AmbientTestEffect(manager.getHost())
    manager.register(effect)
    manager.attachLights()
    await manager.setEnabled('ambient-test', true)
    expect(manager.compositor.getOutput('mock-1')!.mode).toBe('colour')

    const notices: PausedNotice[] = []
    manager.on('paused', (n: PausedNotice) => notices.push(n))

    manager.markManual(['mock-1'])
    await lights[0].setColorTemp(10)
    await flushMicrotasks()

    expect(notices).toHaveLength(1)
    expect(notices[0].effectLabel).toBe('Ambient test')
    expect(notices[0].lightNames).toEqual(['Mock 1'])
    expect(manager.compositor.getOutput('mock-1')!.mode).toBe('white')
    expect(manager.compositor.getOutput('mock-1')!.colorTemp).toBe(10)
    // The other light keeps the effect
    expect(manager.compositor.getOutput('mock-2')!.mode).toBe('colour')

    manager.resumeLight('ambient-test', ['mock-1'])
    vi.advanceTimersByTime(700)
    expect(manager.compositor.getOutput('mock-1')!.mode).toBe('colour')
    await manager.shutdown()
  })

  it('persists settings and keeps an enabled effect enabled across restarts', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lumos-fx-'))
    const { lights } = createMockLights(1)
    const source = { getAllLights: () => lights, getIsDemoMode: () => false }

    const first = new EffectManager(source, dir)
    first.register(new AmbientTestEffect(first.getHost()))
    first.attachLights()
    await first.setEnabled('ambient-test', true)
    first.updateGlobal({ ratePerSecond: 8, maxFlashesPerSecond: 99 })
    await first.shutdown()

    const second = new EffectManager(source, dir)
    const effect = new AmbientTestEffect(second.getHost())
    second.register(effect)
    expect(effect.isEnabled()).toBe(true)
    expect(second.getGlobal().ratePerSecond).toBe(8)
    expect(second.getGlobal().maxFlashesPerSecond).toBe(3)
    await second.shutdown()
  })

  it('reads a settings file saved with a byte order mark', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lumos-fx-'))
    const bom = String.fromCharCode(0xfeff)
    writeFileSync(join(dir, 'effects.json'), bom + JSON.stringify({ global: { ratePerSecond: 6 }, effects: { 'ambient-test': { enabled: true } } }))
    const { lights } = createMockLights(1)
    const manager = new EffectManager({ getAllLights: () => lights, getIsDemoMode: () => false }, dir)
    const effect = new AmbientTestEffect(manager.getHost())
    manager.register(effect)
    expect(manager.getGlobal().ratePerSecond).toBe(6)
    expect(effect.isEnabled()).toBe(true)
    await manager.shutdown()
  })

  it('quitting with an effect active returns bulbs to their base state', async () => {
    const { lights } = createMockLights(1)
    const source = { getAllLights: () => lights, getIsDemoMode: () => false }
    const manager = new EffectManager(source, mkdtempSync(join(tmpdir(), 'lumos-fx-')))
    manager.register(new AmbientTestEffect(manager.getHost()))
    manager.attachLights()
    await manager.setEnabled('ambient-test', true)
    expect(lights[0].lastSentOutput!.mode).toBe('colour')
    await manager.shutdown()
    expect(lights[0].lastSentOutput!.mode).toBe('white')
  })
})

describe('Flash layer', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('flashes on top of the composed state and then restores it', async () => {
    const { lights, log } = createMockLights(1)
    const compositor = new Compositor({ ratePerSecond: 12, frameMs: 16 })
    compositor.attach(lights)
    const flash = new FlashLayer(
      { label: 'Goal', targets: ['mock-1'], color: { h: 120, s: 100 }, count: 2, onMs: 250, offMs: 250, includeOff: false },
      Date.now(),
      3
    )
    compositor.addLayer(flash)
    expect(compositor.getOutput('mock-1')!.h).toBe(120)
    expect(compositor.getOutput('mock-1')!.brightness).toBe(100)

    for (let i = 0; i < 100; i++) {
      vi.advanceTimersByTime(16)
      await flushMicrotasks()
    }
    expect(compositor.hasLayer(flash.id)).toBe(false)
    expect(lights[0].lastSentOutput!.mode).toBe('white')
    expect(lights[0].lastSentOutput!.brightness).toBe(80)
    expect(log.length).toBeGreaterThan(2)
    compositor.destroy()
  })
})

describe('Light: base state commands keep their original shape', () => {
  it('brightness on a white light sends only the brightness', async () => {
    const { lights, log } = createMockLights(1)
    await lights[0].setBrightness(50)
    expect(log[0].data).toEqual({ '22': 505 })
  })

  it('dimming a colour light keeps the colour', async () => {
    const { lights, log } = createMockLights(1)
    await lights[0].setColor(240, 100, 80)
    log.length = 0
    await lights[0].setBrightness(40)
    expect(Object.keys(log[0].data)).toEqual(['24'])
    expect(lights[0].mode).toBe('colour')
  })

  it('turning back on after an off frame restates the mode, so a bulb left in colour returns to white', async () => {
    const { lights, log } = createMockLights(1)
    const colour = { power: true, mode: 'colour' as const, brightness: 40, colorTemp: 50, h: 30, s: 40 }
    await lights[0].sendOutput(colour)
    // An off frame that still names the white mode, as the base state would
    await lights[0].sendOutput({ power: false, mode: 'white', brightness: 40, colorTemp: 50, h: 30, s: 40 })
    log.length = 0
    await lights[0].sendOutput({ power: true, mode: 'white', brightness: 40, colorTemp: 50, h: 30, s: 40 })
    expect(log[0].data['21']).toBe('white')
    expect(log[0].data['20']).toBe(true)
  })

  it('colour output on a white-only bulb becomes white at the same level', async () => {
    const { lights, log } = createMockLights(1, { colour: false })
    await lights[0].sendOutput({ power: true, mode: 'colour', brightness: 60, colorTemp: 50, h: 0, s: 100 })
    expect(log[0].data['24']).toBeUndefined()
    expect(lights[0].denormalizeBrightness(Number(log[0].data['22']))).toBe(60)
  })
})
