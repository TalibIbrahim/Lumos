import { describe, it, expect, afterAll } from 'vitest'
import { Light } from '../../main/devices/Light'
import { Compositor } from '../../main/effects/compositor'
import { TinyTuyaDevice } from '../../main/types'

/**
 * Command pipeline latency measurement.
 * Measures the time from a public control call to the moment the device client
 * receives the command (pipeline latency), and to the moment the simulated
 * device acknowledges it (end-to-end with a fixed 20 ms simulated network).
 *
 * Skipped by default. Run with: LUMOS_PERF=1 npx vitest run src/__tests__/perf
 */
const RUN = process.env.LUMOS_PERF === '1'
const NETWORK_MS = 20

const device: TinyTuyaDevice = {
  id: 'perf-light',
  name: 'Perf Light',
  key: '0123456789abcdef',
  ip: '192.0.2.200',
  version: '3.3',
  mapping: {
    '20': { code: 'switch_led', type: 'Boolean' },
    '21': { code: 'work_mode', type: 'Enum', values: { range: ['white', 'colour'] } },
    '22': { code: 'bright_value_v2', type: 'Integer', values: { min: 10, max: 1000 } },
    '23': { code: 'temp_value_v2', type: 'Integer', values: { min: 0, max: 1000 } },
    '24': { code: 'colour_data_v2', type: 'String' }
  }
}

function pct(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b)
  return Math.round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] * 100) / 100
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

const compositors: Compositor[] = []
afterAll(() => compositors.forEach((c) => c.destroy()))

function makeLight(onSet: (data: Record<string, unknown>) => void): Light {
  const light = new Light(device)
  light.isConnected = true
  if (process.env.LUMOS_PERF_DIRECT !== '1') {
    // Production path: every command goes through the compositor
    const compositor = new Compositor()
    compositor.attach([light])
    compositors.push(compositor)
  }
  // @ts-expect-error replace device client with a simulated one
  light['tuya'] = {
    set: async (opts: { data: Record<string, unknown> }) => {
      onSet(opts.data)
      await sleep(NETWORK_MS)
      return true
    },
    isConnected: () => true,
    disconnect: () => {}
  }
  return light
}

describe.skipIf(!RUN)('Perf: command pipeline latency', () => {
  it('discrete commands (spaced 120 ms)', async () => {
    let dispatchAt = 0
    const light = makeLight(() => {
      dispatchAt = performance.now()
    })

    const pipeline: number[] = []
    const endToEnd: number[] = []
    for (let i = 0; i < 60; i++) {
      const t0 = performance.now()
      await light.setBrightness(20 + (i % 60))
      const t1 = performance.now()
      pipeline.push(dispatchAt - t0)
      endToEnd.push(t1 - t0)
      await sleep(120)
    }

    console.log(
      `[perf] discrete: pipeline p50=${pct(pipeline, 0.5)}ms p95=${pct(pipeline, 0.95)}ms | end-to-end p50=${pct(endToEnd, 0.5)}ms p95=${pct(endToEnd, 0.95)}ms`
    )
    expect(pipeline.length).toBe(60)
  }, 30000)

  it('discrete commands while Music animates other lights', async () => {
    if (process.env.LUMOS_PERF_DIRECT === '1') return
    // Music-style animation on four other bulbs sharing the same compositor and event loop
    const lights: Light[] = []
    let dispatchAt = 0
    const target = makeLight(() => {
      dispatchAt = performance.now()
    })
    const compositor = compositors[compositors.length - 1]
    for (let i = 0; i < 4; i++) {
      const l = new Light({ ...device, id: `perf-other-${i}` })
      l.isConnected = true
      l.power = true
      // @ts-expect-error simulated device client
      l['tuya'] = { set: async () => { await sleep(NETWORK_MS); return true }, isConnected: () => true, disconnect: () => {} }
      lights.push(l)
    }
    compositor.attach([target, ...lights])
    const music = {
      id: 'music',
      label: 'Music',
      priority: 3,
      appliesTo: (id: string) => id !== target.id,
      compose: (below: any, ctx: any) => ({
        ...below,
        power: true,
        mode: 'colour',
        h: (ctx.now / 20) % 360,
        s: 90,
        brightness: 40 + 40 * Math.abs(Math.sin(ctx.now / 250))
      }),
      isAnimating: () => true
    }
    compositor.addLayer(music as any)

    const pipeline: number[] = []
    const endToEnd: number[] = []
    for (let i = 0; i < 60; i++) {
      const t0 = performance.now()
      await target.setBrightness(20 + (i % 60))
      const t1 = performance.now()
      pipeline.push(dispatchAt - t0)
      endToEnd.push(t1 - t0)
      await sleep(120)
    }
    compositor.removeLayer('music')
    console.log(
      `[perf] discrete with music: pipeline p50=${pct(pipeline, 0.5)}ms p95=${pct(pipeline, 0.95)}ms | end-to-end p50=${pct(endToEnd, 0.5)}ms p95=${pct(endToEnd, 0.95)}ms`
    )
    expect(pipeline.length).toBe(60)
  }, 30000)

  it('slider stream (60 Hz for 3 s): staleness of each dispatched value', async () => {
    const sentAt = new Map<number, number>()
    const staleness: number[] = []
    const light = makeLight((data) => {
      const raw = Number(data['22'])
      if (!Number.isNaN(raw)) {
        const value = light.denormalizeBrightness(raw)
        const issued = sentAt.get(value)
        if (issued !== undefined) staleness.push(performance.now() - issued)
      }
    })

    const start = performance.now()
    let v = 1
    while (performance.now() - start < 3000) {
      v = v >= 100 ? 1 : v + 1
      sentAt.set(v, performance.now())
      light.setBrightness(v)
      await sleep(16)
    }
    await sleep(300)

    console.log(
      `[perf] stream: dispatched=${staleness.length} staleness p50=${pct(staleness, 0.5)}ms p95=${pct(staleness, 0.95)}ms`
    )
    expect(staleness.length).toBeGreaterThan(0)
  }, 30000)
})
