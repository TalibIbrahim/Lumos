import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// The store reads its folder from Electron; point it at a temporary one
const dir = mkdtempSync(join(tmpdir(), 'lumos-idle-'))
vi.mock('electron', () => ({ app: { getPath: () => dir } }))

import { LumosStore } from '../main/store'
import { createThrottle } from '../renderer/src/lib/throttle'

/**
 * Background idle behaviour: nothing in the main process should wake up on a timer
 * unless something needs it, and repeated identical bulb reports should not cause work.
 */

interface FakeLight {
  id: string
  power: boolean
  brightness: number
  setPower: ReturnType<typeof vi.fn>
  setBrightness: ReturnType<typeof vi.fn>
  setColorTemp: ReturnType<typeof vi.fn>
}

function fakeLights(): FakeLight[] {
  return ['a', 'b'].map((id) => ({
    id,
    power: true,
    brightness: 80,
    setPower: vi.fn(async () => true),
    setBrightness: vi.fn(async () => true),
    setColorTemp: vi.fn(async () => true)
  }))
}

function storeWith(lights: FakeLight[]) {
  const store = new LumosStore()
  const manager = { getAllLights: () => lights, getLight: (id: string) => lights.find((l) => l.id === id) }
  const broadcast = vi.fn()
  store.init(manager as any, broadcast)
  return { store, broadcast }
}

describe('Idle: scheduler wakes only when something is scheduled', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 9, 7, 7, 29, 20)) // Wednesday 07:29:20 local time
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('sets no timer at all when nothing is scheduled', () => {
    const { store } = storeWith(fakeLights())
    for (const s of store.getData().schedules) store.deleteSchedule(s.id)
    store.cancelSleepTimer()
    store.saveSunriseAlarm(null)
    expect(vi.getTimerCount()).toBe(0)
    store.destroy()
  })

  it('wakes once a minute for a schedule and fires it in its minute', async () => {
    const lights = fakeLights()
    const { store } = storeWith(lights)
    store.saveSchedule({ id: 's1', name: 'Wake', enabled: true, time: '07:30', days: [3], action: 'off', targetType: 'all' })
    expect(vi.getTimerCount()).toBe(1)
    // Nothing runs before the minute starts
    await vi.advanceTimersByTimeAsync(30_000)
    expect(lights[0].setPower).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(10_100) // just after 07:30:00
    expect(lights[0].setPower).toHaveBeenCalledWith(false)
    expect(lights[1].setPower).toHaveBeenCalledWith(false)
    // Only the next minute's wake-up is pending, not a 5 second poll
    expect(vi.getTimerCount()).toBe(1)
    const fired = lights[0].setPower.mock.calls.length
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    expect(lights[0].setPower.mock.calls.length).toBe(fired)
    store.destroy()
  })

  it('steps a sleep timer every 5 seconds and stops when it ends', async () => {
    const lights = fakeLights()
    const { store } = storeWith(lights)
    store.startSleepTimer('all', undefined, 1)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(lights[0].setBrightness).toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(35_000)
    expect(lights[0].setPower).toHaveBeenCalledWith(false)
    expect(store.getData().sleepTimer).toBeNull()
    for (const s of store.getData().schedules) store.deleteSchedule(s.id)
    expect(vi.getTimerCount()).toBe(0)
    store.destroy()
  })

  it('does not save or broadcast when a bulb repeats the same state', () => {
    const { store, broadcast } = storeWith(fakeLights())
    const save = vi.spyOn(store, 'save')
    const state = { power: true, brightness: 50, colorTemp: 30, mode: 'white', color: { h: 0, s: 0, v: 50 } }
    store.recordLastState('a', state)
    vi.advanceTimersByTime(1500)
    expect(save).toHaveBeenCalledTimes(1)
    // Last states are not shown in the window, so they are saved without telling it
    expect(broadcast).not.toHaveBeenCalled()
    for (let i = 0; i < 20; i++) store.recordLastState('a', { ...state, color: { ...state.color } })
    vi.advanceTimersByTime(1500)
    expect(save).toHaveBeenCalledTimes(1)
    store.recordLastState('a', { ...state, brightness: 51 })
    vi.advanceTimersByTime(1500)
    expect(save).toHaveBeenCalledTimes(2)
    store.destroy()
  })
})

describe('Drag throttle', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('sends at most once per interval while values keep coming, and always sends the last one', () => {
    const sent: number[] = []
    const t = createThrottle(50, (v: number) => sent.push(v))
    // A drag: a new value every 8 ms for 400 ms
    for (let i = 1; i <= 50; i++) {
      t.call(i)
      vi.advanceTimersByTime(8)
    }
    vi.advanceTimersByTime(100)
    expect(sent[0]).toBe(1) // the first value goes at once
    expect(sent[sent.length - 1]).toBe(50) // the last value always arrives
    expect(sent.length).toBeGreaterThanOrEqual(7) // the bulb follows during the drag
    expect(sent.length).toBeLessThanOrEqual(10)
  })

  it('drops a waiting value on cancel and delivers it on flush', () => {
    const sent: number[] = []
    const t = createThrottle(50, (v: number) => sent.push(v))
    t.call(1)
    t.call(2)
    t.cancel()
    vi.advanceTimersByTime(100)
    expect(sent).toEqual([1])
    t.call(3)
    t.call(4)
    t.flush()
    expect(sent).toEqual([1, 3, 4])
  })
})
