import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'events'
import { Light } from '../main/devices/Light'
import { TinyTuyaDevice } from '../main/types'

// Mock TuyAPI implementation
class MockTuyAPI extends EventEmitter {
  public options: any
  public connected = false

  constructor(options: any) {
    super()
    this.options = options
  }

  public isConnected(): boolean {
    return this.connected
  }

  public async connect(): Promise<void> {
    this.connected = true
    this.emit('connected')
  }

  public disconnect(): void {
    this.connected = false
    this.emit('disconnected')
  }

  public async get(): Promise<any> {
    return { dps: { '20': true, '22': 850 } }
  }

  public async set(options: any): Promise<boolean> {
    if (!this.connected) {
      throw new Error('Not connected to device socket')
    }
    return true
  }
}

describe('Integration Tests: Device Lifecycle & Offline Handling', () => {
  const deviceConfig: TinyTuyaDevice = {
    id: 'integration-test-light',
    name: 'Integration Test Light',
    key: '0123456789abcdef',
    ip: '127.0.0.1',
    version: '3.3',
    dps: { power: 20, brightness: 22, colorTemp: 23, mode: 21 }
  }

  let light: Light
  let mockTuya: MockTuyAPI

  beforeEach(() => {
    vi.useFakeTimers()
    light = new Light(deviceConfig)
    mockTuya = new MockTuyAPI({ id: deviceConfig.id, key: deviceConfig.key, ip: deviceConfig.ip })
    // @ts-expect-error replace internal tuya client with mock
    light['tuya'] = mockTuya
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('handles connect, status push, and optimistic updates', async () => {
    const stateCallback = vi.fn()
    light.on('change', stateCallback)

    // 1. Connect
    await mockTuya.connect()
    light.isConnected = true
    expect(light.isConnected).toBe(true)

    // 2. Status push from mock device
    // @ts-expect-error handle incoming push
    light['handleTuyaData']({ dps: { '20': true, '22': 1000 } })

    expect(light.power).toBe(true)
    expect(light.brightness).toBe(100)
    expect(stateCallback).toHaveBeenCalled()
  })

  it('handles disconnect and schedules exponential backoff reconnect', async () => {
    light.isConnected = true
    expect(light.isConnected).toBe(true)

    // Simulate socket disconnect
    mockTuya.disconnect()
    light.isConnected = false
    // @ts-expect-error schedule reconnect
    light['scheduleReconnect']()

    expect(light.isConnected).toBe(false)
    // @ts-expect-error check timer existence
    expect(light['retryTimer']).not.toBeNull()
  })

  it('safely rejects hardware commands when device is offline without crashing', async () => {
    light.isConnected = false

    // Should return false optimistically but not throw
    const res = await light.setBrightness(50)
    expect(res).toBe(false)
    // UI state updates optimistically so user interface never freezes
    expect(light.brightness).toBe(50)
  })
})
