import { describe, it, expect, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { EnergyTracker } from '../main/energy/EnergyTracker'

const dirs: string[] = []
const make = (): { dir: string; tracker: EnergyTracker } => {
  const dir = mkdtempSync(join(tmpdir(), 'lumos-energy-'))
  dirs.push(dir)
  return { dir, tracker: new EnergyTracker({ getAllLights: () => [] }, dir) }
}

afterEach(() => {
  vi.useRealTimers()
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe('energy tracking is opt in', () => {
  it('is off by default and does not start a timer', () => {
    vi.useFakeTimers()
    const { tracker } = make()
    tracker.start()
    expect(tracker.isEnabled()).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
    expect(tracker.report('today').enabled).toBe(false)
  })

  it('starts and stops with the setting and remembers it', () => {
    vi.useFakeTimers()
    const { dir, tracker } = make()
    tracker.setEnabled(true)
    expect(vi.getTimerCount()).toBe(1)
    expect(JSON.parse(readFileSync(join(dir, 'energy.json'), 'utf-8')).enabled).toBe(true)
    expect(new EnergyTracker({ getAllLights: () => [] }, dir).isEnabled()).toBe(true)
    tracker.setEnabled(false)
    expect(vi.getTimerCount()).toBe(0)
    expect(new EnergyTracker({ getAllLights: () => [] }, dir).isEnabled()).toBe(false)
  })
})
