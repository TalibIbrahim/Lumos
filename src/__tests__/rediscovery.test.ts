import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * Lights that come back at a different address (for example after a power
 * cut) are found again, and lights held by another app are reported as such.
 */

const net = vi.hoisted(() => ({
  /** Address the bulb is really at; connections elsewhere fail. */
  bulbAt: '192.0.2.20',
  /** Addresses where something accepts TCP but will not talk (another controller holds the bulb). */
  busy: new Set<string>(),
  locateCalls: 0,
  persisted: [] as Array<{ id: string; ip: string }>,
  /** Latest announcement heard from the light, if any. */
  heard: null as null | { id: string; ip: string; version: string; at: number },
  /** When set, the light refuses our key even though it is reachable. */
  wrongKey: false
}))

vi.mock('tuyapi', async () => {
  const { EventEmitter } = await import('events')
  class FakeTuya extends EventEmitter {
    device: { ip?: string }
    connected = false
    constructor(opts: { ip?: string }) {
      super()
      this.device = { ip: opts.ip }
    }
    isConnected(): boolean {
      return this.connected
    }
    async connect(): Promise<boolean> {
      await Promise.resolve()
      if (this.device.ip !== net.bulbAt || net.wrongKey) throw new Error('connection timed out')
      this.connected = true
      this.emit('connected')
      return true
    }
    async get(): Promise<unknown> {
      return { dps: { '20': true } }
    }
    async set(): Promise<boolean> {
      return true
    }
    async find(): Promise<boolean> {
      return true
    }
    disconnect(): void {
      this.connected = false
    }
  }
  return { default: FakeTuya }
})

vi.mock('../main/devices/discovery', () => ({
  claimAddress: vi.fn(),
  releaseAddress: vi.fn(),
  clearScanCache: vi.fn(),
  probeTcp: vi.fn(async (ip: string) => net.busy.has(ip) || ip === net.bulbAt),
  locateDevice: vi.fn(async () => {
    net.locateCalls++
    return net.bulbAt
  }),
  announcements: { get: vi.fn(() => net.heard), on: vi.fn(), start: vi.fn(), stop: vi.fn() }
}))

vi.mock('../main/config', () => ({
  updatePersistedDeviceIp: (id: string, ip: string) => net.persisted.push({ id, ip }),
  loadDevicesConfig: () => []
}))

vi.mock('../main/devices/arp', () => ({ resolveIpFromMac: () => null }))

import { Light } from '../main/devices/Light'

const device = { id: 'moved-light', name: 'Right', key: '0123456789abcdef', ip: '192.0.2.207', version: '3.5' }

async function settle(ms = 0): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve()
  if (ms) await vi.advanceTimersByTimeAsync(ms)
}

describe('Finding lights whose address changed', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    net.bulbAt = '192.0.2.20'
    net.busy.clear()
    net.locateCalls = 0
    net.persisted = []
    net.heard = null
    net.wrongKey = false
  })
  afterEach(() => vi.useRealTimers())

  it('searches after repeated failures, connects at the new address, and saves it', async () => {
    const light = new Light(device)
    await light.connect()
    await settle()
    expect(light.isConnected).toBe(false)
    expect(net.locateCalls).toBe(0) // one failure is not enough to search

    await settle(2000) // the retry fails too, which triggers the search
    await settle(100)
    expect(net.locateCalls).toBe(1)
    expect(light.ip).toBe('192.0.2.20')
    expect(light.isConnected).toBe(true)
    expect(net.persisted).toContainEqual({ id: 'moved-light', ip: '192.0.2.20' })
    expect(light.getState().connectionIssue).toBeUndefined()
    light.disconnect()
  })

  it('reports a light that answers but will not talk as in use elsewhere', async () => {
    net.bulbAt = '192.0.2.99' // not where we look, and not found by the search either
    net.busy.add(device.ip)
    const { locateDevice } = await import('../main/devices/discovery')
    vi.mocked(locateDevice).mockResolvedValueOnce(null)

    const light = new Light(device)
    await light.connect()
    await settle()
    expect(light.getState().connectionIssue).toBe('busy')
    expect(light.getState().online).toBe(false)
    light.disconnect()
  })

  it('reports a light that does not answer at all as not responding', async () => {
    net.bulbAt = '192.0.2.99'
    const { locateDevice } = await import('../main/devices/discovery')
    vi.mocked(locateDevice).mockResolvedValue(null)

    const light = new Light(device)
    await light.connect()
    await settle()
    expect(light.getState().connectionIssue).toBe('unreachable')
    vi.mocked(locateDevice).mockImplementation(async () => {
      net.locateCalls++
      return net.bulbAt
    })
    light.disconnect()
  })

  it('does not search the network over and over while a light stays missing', async () => {
    net.bulbAt = '192.0.2.99'
    const { locateDevice } = await import('../main/devices/discovery')
    vi.mocked(locateDevice).mockImplementation(async () => {
      net.locateCalls++
      return null
    })

    const light = new Light(device)
    await light.connect()
    await settle(60000) // a minute of retries
    const afterOneMinute = net.locateCalls
    expect(afterOneMinute).toBeLessThanOrEqual(2)
    await settle(60000)
    expect(net.locateCalls - afterOneMinute).toBeLessThanOrEqual(1)
    light.disconnect()
    vi.mocked(locateDevice).mockImplementation(async () => {
      net.locateCalls++
      return net.bulbAt
    })
  })

  it('switches to the address a light announces and connects straight away', async () => {
    net.bulbAt = '192.0.2.77'
    const light = new Light(device)
    await light.connect()
    await settle()
    expect(light.isConnected).toBe(false)

    light.onAnnounced({ id: device.id, ip: '192.0.2.77', version: '3.5', at: Date.now() })
    await settle(10)
    expect(light.ip).toBe('192.0.2.77')
    expect(light.isConnected).toBe(true)
    light.disconnect()
  })

  it('reports a changed key when the light announces itself but will not talk', async () => {
    const { locateDevice } = await import('../main/devices/discovery')
    net.bulbAt = device.ip // reachable at the saved address...
    net.wrongKey = true // ...but our key no longer works
    net.heard = { id: device.id, ip: device.ip, version: '3.5', at: Date.now() }
    const before = net.locateCalls
    vi.mocked(locateDevice).mockClear()

    const light = new Light(device)
    await light.connect()
    await settle(2000)
    await settle(100)
    expect(light.getState().connectionIssue).toBe('key-mismatch')
    // It knows where the light is, so it does not scan the network
    expect(net.locateCalls).toBe(before)
    light.disconnect()
  })

  it('Refresh searches straight away', async () => {
    net.bulbAt = '192.0.2.99'
    const light = new Light(device)
    await light.connect()
    await settle()
    const before = net.locateCalls

    net.bulbAt = '192.0.2.31' // the light comes back elsewhere
    await light.reconnectNow()
    await settle(50)
    expect(net.locateCalls).toBe(before + 1)
    expect(light.isConnected).toBe(true)
    expect(light.ip).toBe('192.0.2.31')
    light.disconnect()
  })
})
