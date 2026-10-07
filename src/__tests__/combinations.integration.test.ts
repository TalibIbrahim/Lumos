import { describe, it, expect, afterEach, vi } from 'vitest'
import { EventEmitter } from 'events'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { EffectManager, PausedNotice } from '../main/effects/EffectManager'
import { MusicEffect } from '../main/effects/music/MusicEffect'
import { SimulatedMusicSource, MusicSource } from '../main/effects/music/capture'
import { AlbumEffect } from '../main/effects/album/AlbumEffect'
import { AwayEffect, PowerSource } from '../main/effects/away/AwayEffect'
import { GamesEffect } from '../main/effects/games/GamesEffect'
import { SystemMonitor } from '../main/system/systemMonitor'
import { extractColors } from '../shared/color/dominant'
import { createMockLights, flushMicrotasks } from './helpers/mockLights'

// Vitest resolves 'electron' to its install path, so the capture module's
// Electron imports are stubbed; these tests use the simulated music source.
vi.mock('electron', () => ({
  BrowserWindow: class {},
  desktopCapturer: {},
  ipcMain: new EventEmitter(),
  session: {},
  app: undefined
}))
vi.mock('@electron-toolkit/utils', () => ({ is: { dev: false } }))

class FakePower extends EventEmitter implements PowerSource {
  idle = 0
  getSystemIdleTime(): number {
    return this.idle
  }
}

function setup() {
  vi.useFakeTimers()
  const { lights, log } = createMockLights(3)
  const source = { getAllLights: () => lights, getIsDemoMode: () => false }
  const manager = new EffectManager(source, mkdtempSync(join(tmpdir(), 'lumos-combo-')))
  const monitor = new SystemMonitor(() => null)
  monitor.setSimulated(true)
  const power = new FakePower()
  const music = new MusicEffect(manager.getHost(), (): MusicSource => new SimulatedMusicSource(), () => {})
  const album = new AlbumEffect(manager.getHost(), monitor, async (rgba, w, h) => extractColors(rgba, w, h))
  const away = new AwayEffect(manager.getHost(), power, monitor)
  const games = new GamesEffect(manager.getHost(), { leagueFetch: async () => Promise.reject(new Error('none')) })
  for (const e of [music, album, away, games]) manager.register(e)
  manager.attachLights()
  return { manager, lights, log, monitor, power, music, album, away, games }
}

async function advance(ms: number, step = 33): Promise<void> {
  for (let t = 0; t < ms; t += step) {
    vi.advanceTimersByTime(step)
    await flushMicrotasks()
  }
}

/** A solid-colour 8x8 thumbnail. */
function art(r: number, g: number, b: number) {
  const rgba = new Uint8Array(8 * 8 * 4)
  for (let i = 0; i < 64; i++) rgba.set([r, g, b, 255], i * 4)
  return { width: 8, height: 8, rgba }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('Combinations', () => {
  it('music with album colour: album supplies the hue, music the pulses', async () => {
    const { manager, lights, monitor, music } = setup()
    await manager.setEnabled('album', true)
    monitor.pushMedia({ status: 'Playing', key: 'aa11', thumbnail: art(20, 60, 230) }) // blue art
    await advance(2000)
    expect(manager.compositor.getTopLayerId(lights[0].id)).toBe('album')
    const albumHue = lights[0].lastSentOutput!.h

    await manager.setEnabled('music', true)
    await advance(3000)
    expect(music.getStatus()).toBe('active')
    expect(manager.compositor.getTopLayerId(lights[0].id)).toBe('music')
    const brightnesses = new Set<number>()
    for (let i = 0; i < 40; i++) {
      await advance(50)
      const out = lights[0].lastSentOutput!
      expect(Math.abs(out.h - albumHue)).toBeLessThanOrEqual(2)
      brightnesses.add(out.brightness)
    }
    expect(brightnesses.size).toBeGreaterThan(3)
    await manager.shutdown()
  })

  it('party style snaps to the beat, goes full white on a drop, and stays inside the flash cap', async () => {
    const { manager, lights, music } = setup()
    music.updateSettings({ style: 'party' })
    await manager.setEnabled('music', true)
    await advance(4000)
    expect(music.getStatus()).toBe('active')

    // Before the drop: beats reach full brightness, the floor between them is dark, and the colour steps
    const levels: number[] = []
    const hues = new Set<number>()
    for (let i = 0; i < 60; i++) {
      await advance(33)
      const out = lights[0].lastSentOutput!
      levels.push(out.brightness)
      if (out.mode === 'colour') hues.add(out.h)
    }
    expect(Math.max(...levels)).toBe(100)
    expect(Math.min(...levels)).toBeLessThan(40)
    expect(hues.size).toBeGreaterThan(1)

    // The simulated track breaks down at 30 seconds and drops at 34
    await advance(26000)
    let sawBurst = false
    const guard = manager.compositor.getFlashGuard()
    for (let i = 0; i < 150; i++) {
      await advance(33)
      const out = lights[0].lastSentOutput!
      if (out.mode === 'white' && out.brightness === 100) sawBurst = true
      // No light ever gets more sudden changes than the flash cap inside a second
      for (const light of lights) expect(guard.recentCount(light.id, Date.now())).toBeLessThanOrEqual(3)
    }
    expect(sawBurst).toBe(true)
    expect(music.snapshot().info.lastDropAt).not.toBeNull()
    await manager.shutdown()
  })

  it('idle during music dims on top of the music, and restores to music', async () => {
    const { manager, lights, power, away } = setup()
    away.updateSettings({ stayOnDuringMedia: false, idleMinutes: 1, dimPercent: 10 })
    await manager.setEnabled('music', true)
    await manager.setEnabled('away', true)
    await advance(2000)
    expect(manager.compositor.getTopLayerId(lights[0].id)).toBe('music')

    power.idle = 120
    await advance(20000)
    expect(manager.compositor.getTopLayerId(lights[0].id)).toBe('away')
    expect(lights[0].lastSentOutput!.brightness).toBeLessThanOrEqual(10)

    power.idle = 0
    await advance(4000)
    expect(manager.compositor.getTopLayerId(lights[0].id)).toBe('music')
    expect(lights[0].lastSentOutput!.mode).toBe('colour')
    await manager.shutdown()
  })

  it('shows a status line as soon as Away dimming starts', async () => {
    const { manager, away } = setup()
    await manager.setEnabled('away', true)
    expect(away.snapshot().statusDetail).toContain('inactivity')
    await manager.shutdown()
  })

  it('does not dim for inactivity while media plays', async () => {
    const { manager, lights, power, monitor, away } = setup()
    away.updateSettings({ idleMinutes: 1 })
    await manager.setEnabled('away', true)
    monitor.pushMedia({ status: 'Playing', key: 'bb22', thumbnail: null })
    power.idle = 600
    await advance(20000)
    expect(manager.compositor.getTopLayerId(lights[0].id)).toBeNull()
    expect(away.snapshot().statusDetail).toContain('media')
    await manager.shutdown()
  })

  it('a goal flash during music shows on top and hands back to the music', async () => {
    const { manager, lights, games } = setup()
    games.updateSettings({
      rocketLeague: { ...games.getSettings().rocketLeague, enabled: false, flashCount: 1, flashMs: 200 },
      cs2: { ...games.getSettings().cs2, enabled: false },
      league: { enabled: false }
    })
    await manager.setEnabled('music', true)
    await manager.setEnabled('games', true)
    await advance(2000)
    await games.handleAction('simulate', { event: 'goal-ours' })
    await advance(100)
    expect(lights[0].lastSentOutput!.h).toBe(130)
    await advance(2000)
    expect(manager.compositor.getTopLayerId(lights[0].id)).toBe('music')
    await manager.shutdown()
  })

  it('a manual change while away is kept on return, and music pauses for it with a notice', async () => {
    const { manager, lights, power, away } = setup()
    away.updateSettings({ stayOnDuringMedia: false, idleMinutes: 1, dimPercent: 10 })
    await manager.setEnabled('music', true)
    await manager.setEnabled('away', true)
    await advance(1500)
    power.idle = 120
    await advance(20000)
    expect(lights[1].lastSentOutput!.brightness).toBeLessThanOrEqual(10)

    const notices: PausedNotice[] = []
    manager.on('paused', (n: PausedNotice) => notices.push(n))
    // Someone sets light 2 from their phone while the computer is idle
    manager.markManual([lights[1].id])
    await lights[1].setColorTemp(90)
    await lights[1].setBrightness(65)
    await advance(500)
    expect(lights[1].lastSentOutput!.brightness).toBe(65)
    expect(lights[1].lastSentOutput!.mode).toBe('white')
    expect(notices.map((n) => n.effectId)).toEqual(['music'])

    power.idle = 0
    await advance(4000)
    // Back at the desk: light 2 keeps the manual setting, the others return to music
    expect(lights[1].lastSentOutput!.brightness).toBe(65)
    expect(lights[1].lastSentOutput!.colorTemp).toBe(90)
    expect(manager.compositor.getTopLayerId(lights[0].id)).toBe('music')
    await manager.shutdown()
  })

  it('a bulb going offline mid-effect is skipped and catches up when it returns', async () => {
    const { manager, lights, log } = setup()
    await manager.setEnabled('music', true)
    await advance(2000)
    lights[2].isConnected = false
    log.length = 0
    await advance(2000)
    expect(log.filter((c) => c.lightId === lights[2].id)).toHaveLength(0)
    expect(log.filter((c) => c.lightId === lights[0].id).length).toBeGreaterThan(5)
    lights[2].isConnected = true
    lights[2].emit('online')
    await advance(300)
    expect(log.filter((c) => c.lightId === lights[2].id).length).toBeGreaterThan(0)
    await manager.shutdown()
  })

  it('album colour fades back after playback stops for the configured delay', async () => {
    const { manager, lights, monitor, album } = setup()
    album.updateSettings({ stopDelaySeconds: 2 })
    await manager.setEnabled('album', true)
    monitor.pushMedia({ status: 'Playing', key: 'cc33', thumbnail: art(230, 40, 40) })
    await advance(2000)
    expect(lights[0].lastSentOutput!.mode).toBe('colour')
    monitor.pushMedia({ status: 'Paused', key: 'cc33', thumbnail: null })
    await advance(1500)
    expect(lights[0].lastSentOutput!.mode).toBe('colour')
    await advance(3000)
    expect(lights[0].lastSentOutput!.mode).toBe('white')
    await manager.shutdown()
  })

  it('black and white art gives warm white', async () => {
    const { manager, lights, monitor } = setup()
    await manager.setEnabled('album', true)
    monitor.pushMedia({ status: 'Playing', key: 'dd44', thumbnail: art(128, 128, 128) })
    await advance(2000)
    expect(lights[0].lastSentOutput!.mode).toBe('white')
    expect(lights[0].lastSentOutput!.colorTemp).toBe(15)
    await manager.shutdown()
  })
})
