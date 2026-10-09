import { describe, it, expect, vi } from 'vitest'
import { Light, setBulbProtection } from '../main/devices/Light'
import { TinyTuyaDevice } from '../main/types'
import { lumosColorTempToMireds, miredsToLumosColorTemp } from '../main/homekit'
import { cctToRgb, hsvToRgb } from '../renderer/src/lib/color'
import { latencyTracker } from '../main/latency'
import * as arpModule from '../main/devices/arp'

describe('Unit Tests: DPS Mapping & Range Scaling', () => {
  const mockDeviceWithMapping: TinyTuyaDevice = {
    id: 'test-device-1',
    name: 'Smart Test Bulb',
    key: '0123456789abcdef',
    ip: '192.0.2.50',
    version: '3.3',
    mapping: {
      '20': { code: 'switch_led', type: 'Boolean', values: {} },
      '21': { code: 'work_mode', type: 'Enum', values: { range: ['white', 'colour', 'scene'] } },
      '22': { code: 'bright_value_v2', type: 'Integer', values: { min: 10, max: 1000, scale: 0, step: 1 } },
      '23': { code: 'temp_value_v2', type: 'Integer', values: { min: 0, max: 1000, scale: 0, step: 1 } },
      '24': { code: 'colour_data_v2', type: 'String', values: {} },
      '25': { code: 'scene_data', type: 'String', values: {} },
      '26': { code: 'countdown_1', type: 'Integer', values: { min: 0, max: 86400 } }
    }
  }

  it('correctly derives DPS IDs and capabilities from device mapping', () => {
    const light = new Light(mockDeviceWithMapping)
    expect(light.dpsMap.power).toBe(20)
    expect(light.dpsMap.mode).toBe(21)
    expect(light.dpsMap.brightness).toBe(22)
    expect(light.dpsMap.minBrightness).toBe(10)
    expect(light.dpsMap.maxBrightness).toBe(1000)
    expect(light.dpsMap.colorTemp).toBe(23)
    expect(light.dpsMap.minColorTemp).toBe(0)
    expect(light.dpsMap.maxColorTemp).toBe(1000)
    expect(light.dpsMap.color).toBe(24)
    expect(light.dpsMap.scene).toBe(25)
    expect(light.dpsMap.countdown).toBe(26)

    expect(light.capabilities.hasPower).toBe(true)
    expect(light.capabilities.hasBrightness).toBe(true)
    expect(light.capabilities.hasColorTemp).toBe(true)
    expect(light.capabilities.hasColor).toBe(true)
    expect(light.capabilities.hasScenes).toBe(true)
    expect(light.capabilities.hasCountdown).toBe(true)
  })

  it('accurately normalizes and denormalizes brightness across custom ranges', () => {
    const light = new Light(mockDeviceWithMapping)
    // 0% -> minBrightness (10), 100% -> maxBrightness (1000)
    expect(light.normalizeBrightness(0)).toBe(10)
    expect(light.normalizeBrightness(100)).toBe(1000)
    expect(light.normalizeBrightness(50)).toBe(505)

    // Denormalization
    expect(light.denormalizeBrightness(10)).toBe(0)
    expect(light.denormalizeBrightness(1000)).toBe(100)
    expect(light.denormalizeBrightness(505)).toBe(50)
  })

  it('accurately normalizes and denormalizes color temperature across custom ranges', () => {
    const light = new Light(mockDeviceWithMapping)
    expect(light.normalizeColorTemp(0)).toBe(0)
    expect(light.normalizeColorTemp(100)).toBe(1000)
    expect(light.normalizeColorTemp(50)).toBe(500)

    expect(light.denormalizeColorTemp(0)).toBe(0)
    expect(light.denormalizeColorTemp(1000)).toBe(100)
    expect(light.denormalizeColorTemp(500)).toBe(50)
  })
})

describe('Unit Tests: Color & Mired Conversions', () => {
  it('converts Lumos colorTemp (0-100) to HomeKit mireds (500-140) and back', () => {
    // 0% Lumos (warmest amber) -> 500 mireds
    expect(lumosColorTempToMireds(0)).toBe(500)
    // 100% Lumos (coolest daylight) -> 140 mireds
    expect(lumosColorTempToMireds(100)).toBe(140)
    // 50% Lumos (neutral white) -> 320 mireds
    expect(lumosColorTempToMireds(50)).toBe(320)

    // Reverse conversion
    expect(miredsToLumosColorTemp(500)).toBe(0)
    expect(miredsToLumosColorTemp(140)).toBe(100)
    expect(miredsToLumosColorTemp(320)).toBe(50)
  })

  it('converts CCT percentages to RGB and hex codes', () => {
    const warm = cctToRgb(0)
    expect(warm.r).toBe(255)
    expect(warm.g).toBe(147)
    expect(warm.b).toBe(41)
    expect(warm.hex).toBe('#ff9329')

    const neutral = cctToRgb(50)
    expect(neutral.r).toBe(255)
    expect(neutral.g).toBe(214)
    expect(neutral.b).toBe(170)
    expect(neutral.hex).toBe('#ffd6aa')

    const cool = cctToRgb(100)
    expect(cool.r).toBe(201)
    expect(cool.g).toBe(226)
    expect(cool.b).toBe(255)
    expect(cool.hex).toBe('#c9e2ff')
  })

  it('converts HSV coordinates to RGB and hex codes', () => {
    const red = hsvToRgb(0, 100, 100)
    expect(red.r).toBe(255)
    expect(red.g).toBe(0)
    expect(red.b).toBe(0)

    const green = hsvToRgb(120, 100, 100)
    expect(green.r).toBe(0)
    expect(green.g).toBe(255)
    expect(green.b).toBe(0)

    const blue = hsvToRgb(240, 100, 100)
    expect(blue.r).toBe(0)
    expect(blue.g).toBe(0)
    expect(blue.b).toBe(255)
  })
})

describe('Unit Tests: Command Coalescing & Latency Tracking', () => {
  it('tracks latency metrics and calculates p50 and p95 accurately', () => {
    latencyTracker.reset()
    // Add 10 samples: 10, 20, 30, 40, 50, 60, 70, 80, 90, 100 ms
    for (let i = 1; i <= 10; i++) {
      latencyTracker.record('test_cmd', 'bulb-1', i * 10)
    }

    const stats = latencyTracker.getStats()
    expect(stats.count).toBe(10)
    expect(stats.min).toBe(10)
    expect(stats.max).toBe(100)
    expect(stats.avg).toBe(55)
    expect(stats.p50).toBe(60)
    expect(stats.p95).toBe(100)
  })

  it('coalesces intermediate rapid slider values in command queue', async () => {
    const mockDevice: TinyTuyaDevice = {
      id: 'test-coalesce-device',
      name: 'Coalesce Bulb',
      key: 'abcdef1234567890',
      ip: '192.0.2.99',
      version: '3.3'
    }

    const light = new Light(mockDevice)
    light.isConnected = true

    const setMock = vi.fn().mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
      return true
    })

    // @ts-expect-error mock tuya client
    light['tuya'] = { set: setMock }

    // Fire 4 rapid brightness adjustments
    const p1 = light.setBrightness(20)
    const p2 = light.setBrightness(40)
    const p3 = light.setBrightness(60)
    const p4 = light.setBrightness(80)

    await Promise.all([p1, p2, p3, p4])

    expect(setMock.mock.calls.length).toBeLessThan(4)
    expect(light.brightness).toBe(80)
  })
})

describe('Unit Tests: ARP Resolution & Dynamic IP Recovery', () => {
  it('prefers live ARP IP over stale configured IP when MAC is present', () => {
    const arpSpy = vi.spyOn(arpModule, 'resolveIpFromMac').mockReturnValue('192.0.2.200')

    const light = new Light({
      id: 'test-arp-device',
      name: 'ARP Bulb',
      key: 'abcdef1234567890',
      ip: '192.0.2.100',
      mac: '00:11:22:33:44:55',
      version: '3.5'
    })

    expect(light.ip).toBe('192.0.2.200')
    arpSpy.mockRestore()
  })
})

describe('Bulb protection', () => {
  const device: TinyTuyaDevice = { id: 'protect-device', name: 'Protected Bulb', key: 'abcdef1234567890', ip: '192.0.2.98', version: '3.3' }

  it('limits every light to 2 writes per second and 1 power change every 2 seconds, ending on the latest values', async () => {
    vi.useFakeTimers()
    setBulbProtection(true)
    try {
      const light = new Light(device)
      light.isConnected = true
      const sent: Array<{ at: number; data: Record<string, unknown> }> = []
      // @ts-expect-error mock tuya client
      light['tuya'] = { set: vi.fn(async (o: { data: Record<string, unknown> }) => { sent.push({ at: Date.now(), data: o.data }) }) }
      const t0 = Date.now()
      // A drag: 30 brightness changes over 600 ms, with a power toggle in the middle
      for (let i = 1; i <= 30; i++) {
        void light.setBrightness(i * 3)
        if (i === 10) void light.setPower(false)
        if (i === 12) void light.setPower(true)
        await vi.advanceTimersByTimeAsync(20)
      }
      await vi.advanceTimersByTimeAsync(5000)
      for (let i = 1; i < sent.length; i++) expect(sent[i].at - sent[i - 1].at).toBeGreaterThanOrEqual(500)
      // Power changes (not repeats of the same state) are at least 2 s apart
      const changes: number[] = []
      let prev: unknown = undefined
      for (const w of sent) {
        const k = '20' in w.data ? '20' : '1' in w.data ? '1' : null
        if (k && w.data[k] !== prev) {
          if (prev !== undefined) changes.push(w.at)
          prev = w.data[k]
        }
      }
      for (let i = 1; i < changes.length; i++) expect(changes[i] - changes[i - 1]).toBeGreaterThanOrEqual(2000)
      expect(sent.length).toBeLessThanOrEqual(5)
      // The last brightness sent is the latest one asked for
      const last = [...sent].reverse().find((w) => Object.keys(w.data).some((k) => k !== '20' && k !== '1'))
      expect(last).toBeDefined()
      expect(light.brightness).toBe(90)
      expect(Date.now() - t0).toBeGreaterThan(0)
    } finally {
      setBulbProtection(false)
      vi.useRealTimers()
    }
  })

  it('sends straight away when protection is off', async () => {
    const light = new Light(device)
    light.isConnected = true
    const set = vi.fn(async () => true)
    // @ts-expect-error mock tuya client
    light['tuya'] = { set }
    await light.setBrightness(30)
    await light.setBrightness(60)
    expect(set).toHaveBeenCalledTimes(2)
  })

  it('atomically sets brightness, colorTemp, and mode via applyPresetState', async () => {
    const light = new Light(device)
    light.isConnected = true
    // Simulate previous state where user set brightness to 100% in white mode
    await light.setBrightness(100)

    const set = vi.fn(async () => true)
    // @ts-expect-error mock tuya client
    light['tuya'] = { set }

    await light.applyPresetState({
      power: true,
      mode: 'white',
      brightness: 5,
      colorTemp: 0
    })

    expect(light.brightness).toBe(5)
    expect(light.colorTemp).toBe(0)
    expect(light.mode).toBe('white')
    expect(light.power).toBe(true)

    expect(set).toHaveBeenCalledTimes(1)
    const callArg = set.mock.calls[0][0]
    expect(callArg.multiple).toBe(true)
    // In device mapping: 20 is power, 21 is mode, 22 is brightness, 23 is colorTemp
    expect(callArg.data['20']).toBe(true)
    expect(callArg.data['21']).toBe('white')
    expect(callArg.data['22']).toBe(light.normalizeBrightness(5))
    expect(callArg.data['23']).toBe(light.normalizeColorTemp(0))
  })
})
