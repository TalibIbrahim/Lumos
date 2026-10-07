import { describe, it, expect, vi, afterEach } from 'vitest'
import { EventEmitter } from 'events'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

vi.mock('electron', () => ({
  BrowserWindow: class {},
  desktopCapturer: {},
  ipcMain: new EventEmitter(),
  session: {},
  screen: { getAllDisplays: () => [], getPrimaryDisplay: () => ({ id: 1 }), on: () => {}, removeListener: () => {} },
  app: undefined
}))
vi.mock('@electron-toolkit/utils', () => ({ is: { dev: false } }))

import { EffectManager, PausedNotice } from '../main/effects/EffectManager'
import { ScreenSyncEffect } from '../main/effects/screen/ScreenSyncEffect'
import { ScreenSource, ScreenSourceConfig, renderSample } from '../main/effects/screen/source'
import { MusicEffect } from '../main/effects/music/MusicEffect'
import { SimulatedMusicSource, MusicSource } from '../main/effects/music/capture'
import { AlbumEffect } from '../main/effects/album/AlbumEffect'
import { AwayEffect, PowerSource } from '../main/effects/away/AwayEffect'
import { SystemMonitor } from '../main/system/systemMonitor'
import { extractColors } from '../shared/color/dominant'
import { Frame, ScreenAnalyzer, ZoneColor } from '../shared/screen/analysis'
import { createMockLights, flushMicrotasks } from './helpers/mockLights'

/** A capture source the test drives by hand. */
class FakeSource extends EventEmitter implements ScreenSource {
  config: ScreenSourceConfig | null = null
  running = false
  start(config: ScreenSourceConfig): void {
    this.config = config
    this.running = true
    this.emit('status', { state: 'running' })
  }
  configure(config: ScreenSourceConfig): void {
    this.config = config
  }
  stop(): void {
    this.running = false
  }
  frame(zones: Record<string, ZoneColor>, sceneCut = false): void {
    this.emit('result', { at: Date.now(), zones, sceneCut, black: false, bars: { top: 0, bottom: 0, left: 0, right: 0 } })
  }
}

class FakePower extends EventEmitter implements PowerSource {
  idle = 0
  getSystemIdleTime(): number {
    return this.idle
  }
}

const neutral = (luminance = 0.3): ZoneColor => ({ h: 30, s: 0, luminance, vivid: false })
const green: ZoneColor = { h: 110, s: 90, luminance: 0.8, vivid: true }
const blue: ZoneColor = { h: 225, s: 85, luminance: 0.5, vivid: true }

function setup() {
  vi.useFakeTimers()
  const { lights, log } = createMockLights(2)
  lights[0].position = 'left'
  lights[1].position = 'right'
  const source = { getAllLights: () => lights, getIsDemoMode: () => false }
  const manager = new EffectManager(source, mkdtempSync(join(tmpdir(), 'lumos-screen-')))
  const monitor = new SystemMonitor(() => null)
  monitor.setSimulated(true)
  const power = new FakePower()
  const fake = new FakeSource()
  const screen = new ScreenSyncEffect(manager.getHost(), () => fake, power, monitor, () => {})
  const music = new MusicEffect(manager.getHost(), (): MusicSource => new SimulatedMusicSource(), () => {})
  const album = new AlbumEffect(manager.getHost(), monitor, async (rgba, w, h) => extractColors(rgba, w, h))
  const away = new AwayEffect(manager.getHost(), power, monitor)
  for (const e of [screen, music, album, away]) manager.register(e)
  manager.attachLights()
  return { manager, lights, log, fake, screen, power, monitor }
}

async function advance(ms: number, step = 33): Promise<void> {
  for (let t = 0; t < ms; t += step) {
    vi.advanceTimersByTime(step)
    await flushMicrotasks()
  }
}

afterEach(() => vi.useRealTimers())

describe('Screen Sync with mock bulbs', () => {
  it('an explosion on the right turns the right bulb green and leaves the left bulb neutral', async () => {
    const { manager, lights, fake } = setup()
    await manager.setEnabled('screen', true)
    fake.frame({ 'mock-1': neutral(0.25), 'mock-2': neutral(0.25) })
    await advance(800)
    const leftBefore = { ...lights[0].lastSentOutput! }

    fake.frame({ 'mock-1': neutral(0.25), 'mock-2': green })
    await advance(200)
    const right = lights[1].lastSentOutput!
    expect(right.mode).toBe('colour')
    expect(Math.abs(right.h - 110)).toBeLessThan(15)
    expect(right.brightness).toBeGreaterThan(70)
    const left = lights[0].lastSentOutput!
    expect(left.mode).toBe('white')
    expect(left.brightness).toBe(leftBefore.brightness)
    await manager.shutdown()
  })

  it('reaches the bulb within about 150 ms of a big change', async () => {
    const { manager, lights, fake } = setup()
    await manager.setEnabled('screen', true)
    fake.frame({ 'mock-1': neutral(0.1), 'mock-2': neutral(0.1) })
    await advance(1000)
    fake.frame({ 'mock-1': neutral(0.1), 'mock-2': green })
    await advance(150)
    expect(lights[1].lastSentOutput!.mode).toBe('colour')
    await manager.shutdown()
  })

  it('stays within the rate budget and drops stale frames', async () => {
    const { manager, log, fake } = setup()
    await manager.setEnabled('screen', true)
    log.length = 0
    let frames = 0
    for (let t = 0; t < 3000; t += 50) {
      const hue = (t / 10) % 360
      fake.frame({ 'mock-1': { h: hue, s: 90, luminance: 0.5 + 0.4 * Math.sin(t / 200), vivid: true }, 'mock-2': { h: (hue + 180) % 360, s: 90, luminance: 0.6, vivid: true } })
      frames++
      await advance(50, 25)
    }
    for (const id of ['mock-1', 'mock-2']) {
      const sent = log.filter((c) => c.lightId === id).length
      expect(sent).toBeLessThanOrEqual(12 * 3 + 3)
      expect(sent).toBeLessThan(frames * 2)
    }
    await manager.shutdown()
  })

  it('does not send changes too small to notice', async () => {
    const { manager, log, fake } = setup()
    await manager.setEnabled('screen', true)
    fake.frame({ 'mock-1': blue, 'mock-2': blue })
    await advance(2000)
    log.length = 0
    for (let i = 0; i < 30; i++) {
      fake.frame({ 'mock-1': { ...blue, h: 225 + (i % 2), luminance: 0.5 + (i % 2) * 0.004 }, 'mock-2': blue })
      await advance(66)
    }
    expect(log.length).toBe(0)
    await manager.shutdown()
  })

  it('stopping restores the previous state of the lights smoothly', async () => {
    const { manager, lights, fake } = setup()
    await manager.setEnabled('screen', true)
    fake.frame({ 'mock-1': green, 'mock-2': green })
    await advance(1000)
    expect(lights[0].lastSentOutput!.mode).toBe('colour')
    await manager.setEnabled('screen', false)
    await advance(300)
    // Part way through the fade
    const mid = lights[0].lastSentOutput!
    expect(mid.mode === 'colour' || mid.brightness !== 80).toBe(true)
    await advance(1500)
    expect(lights[0].lastSentOutput!.mode).toBe('white')
    expect(lights[0].lastSentOutput!.brightness).toBe(80)
    expect(fake.running).toBe(false)
    await manager.shutdown()
  })

  it('asks for positions when no light has one', async () => {
    const { manager, lights, screen } = setup()
    lights[0].position = undefined
    lights[1].position = undefined
    await manager.setEnabled('screen', true)
    await advance(1100)
    expect(screen.snapshot().info.issue).toBe('no-positions')
    expect(screen.getStatus()).toBe('waiting')
    await manager.shutdown()
  })

  it('stops capturing while the computer is locked', async () => {
    const { manager, lights, fake, power } = setup()
    await manager.setEnabled('screen', true)
    fake.frame({ 'mock-1': green, 'mock-2': green })
    await advance(800)
    power.emit('lock-screen')
    expect(fake.running).toBe(false)
    await advance(1500)
    expect(lights[0].lastSentOutput!.mode).toBe('white')
    power.emit('unlock-screen')
    expect(fake.running).toBe(true)
    await manager.shutdown()
  })
})

describe('Screen Sync handover', () => {
  it('takes lights over from Music, says so through the top layer, and hands them back', async () => {
    const { manager, fake } = setup()
    await manager.setEnabled('music', true)
    await advance(1500)
    expect(manager.compositor.getTopLayerId('mock-1')).toBe('music')

    await manager.setEnabled('screen', true)
    fake.frame({ 'mock-1': blue, 'mock-2': blue })
    await advance(100)
    expect(manager.compositor.getTopLayerId('mock-1')).toBe('screen')
    expect(manager.compositor.getTopLayerId('mock-2')).toBe('screen')

    await manager.setEnabled('screen', false)
    await advance(100)
    expect(manager.compositor.getTopLayerId('mock-1')).toBe('music')
    await manager.shutdown()
  })

  it('a light without a position keeps following Music', async () => {
    const { manager, lights, fake } = setup()
    lights[1].position = undefined
    await manager.setEnabled('music', true)
    await manager.setEnabled('screen', true)
    fake.frame({ 'mock-1': blue })
    await advance(500)
    expect(manager.compositor.getTopLayerId('mock-1')).toBe('screen')
    expect(manager.compositor.getTopLayerId('mock-2')).toBe('music')
    await manager.shutdown()
  })

  it('takes over from Album color without a visible jump', async () => {
    const { manager, lights, fake, monitor } = setup()
    await manager.setEnabled('album', true)
    const art = new Uint8Array(8 * 8 * 4)
    for (let i = 0; i < 64; i++) art.set([230, 40, 40, 255], i * 4)
    monitor.pushMedia({ status: 'Playing', key: 'aa', thumbnail: { width: 8, height: 8, rgba: art } })
    await advance(2000)
    const before = lights[0].lastSentOutput!.h
    await manager.setEnabled('screen', true)
    fake.frame({ 'mock-1': blue, 'mock-2': blue })
    // First frames of the handover are close to where Album color left off
    await advance(66)
    const firstStep = lights[0].lastSentOutput!
    const dist = Math.min(Math.abs(firstStep.h - before), 360 - Math.abs(firstStep.h - before))
    expect(dist).toBeLessThan(60)
    await advance(1500)
    expect(manager.compositor.getTopLayerId('mock-1')).toBe('screen')
    await manager.shutdown()
  })

  it('away dimming stays on top of Screen Sync', async () => {
    const { manager, fake, power } = setup()
    const away = manager.get('away')!
    away.updateSettings({ stayOnDuringMedia: false, idleMinutes: 1 })
    await manager.setEnabled('away', true)
    await manager.setEnabled('screen', true)
    fake.frame({ 'mock-1': green, 'mock-2': green })
    await advance(500)
    power.idle = 120
    await advance(20000, 100)
    expect(manager.compositor.getTopLayerId('mock-1')).toBe('away')
    await manager.shutdown()
  })

  it('switching a light on or off by hand does not pause Screen Sync', async () => {
    const { manager, lights, fake } = setup()
    await manager.setEnabled('screen', true)
    fake.frame({ 'mock-1': green, 'mock-2': green })
    await advance(500)
    const notices: PausedNotice[] = []
    manager.on('paused', (n: PausedNotice) => notices.push(n))
    manager.markManual(['mock-1'], 'power')
    await lights[0].setPower(false)
    await advance(200)
    expect(lights[0].lastSentOutput!.power).toBe(false)
    manager.markManual(['mock-1'], 'power')
    await lights[0].setPower(true)
    await advance(300)
    expect(notices).toHaveLength(0)
    expect(manager.compositor.getTopLayerId('mock-1')).toBe('screen')
    expect(lights[0].lastSentOutput!.mode).toBe('colour')
    await manager.shutdown()
  })

  it('a light changed by hand leaves Screen Sync with a notice', async () => {
    const { manager, lights, fake } = setup()
    await manager.setEnabled('screen', true)
    fake.frame({ 'mock-1': green, 'mock-2': green })
    await advance(500)
    const notices: PausedNotice[] = []
    manager.on('paused', (n: PausedNotice) => notices.push(n))
    manager.markManual(['mock-1'])
    await lights[0].setColorTemp(90)
    await advance(200)
    expect(notices.map((n) => n.effectId)).toEqual(['screen'])
    expect(manager.compositor.getTopLayerId('mock-1')).toBeNull()
    expect(manager.compositor.getTopLayerId('mock-2')).toBe('screen')
    await manager.shutdown()
  })
})

describe('Screen Sync demo sequence', () => {
  it('the built-in sample turns the right light green during the explosion', () => {
    const f: Frame = { width: 160, height: 90, data: new Uint8Array(160 * 90 * 4) }
    const a = new ScreenAnalyzer([
      { lightId: 'L', position: 'left' },
      { lightId: 'R', position: 'right' }
    ])
    renderSample(f, 7.5)
    const r = a.process(f, 0)!
    expect(r.zones.R.vivid).toBe(true)
    expect(Math.abs(r.zones.R.h - 115)).toBeLessThan(25)
    expect(r.zones.L.vivid).toBe(false)

    renderSample(f, 15)
    const film = a.process(f, 2000)!
    expect(film.zones.L.vivid).toBe(true)
  })
})
