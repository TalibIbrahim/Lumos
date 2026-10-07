import { describe, it, expect } from 'vitest'
import sharp from 'sharp'
import { join } from 'path'
import {
  Frame,
  ScreenAnalyzer,
  LetterboxTracker,
  activeArea,
  detectBars,
  isBlackFrame,
  zoneColor,
  zonesFor
} from '../shared/screen/analysis'

const FIXTURES = join(__dirname, 'fixtures', 'screen')

async function load(name: string): Promise<Frame> {
  const { data, info } = await sharp(join(FIXTURES, name)).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  return { width: info.width, height: info.height, data: new Uint8Array(data) }
}

function solid(r: number, g: number, b: number, w = 160, h = 90): Frame {
  const data = new Uint8Array(w * h * 4)
  for (let i = 0; i < w * h; i++) data.set([r, g, b, 255], i * 4)
  return { width: w, height: h, data }
}

const hueDist = (a: number, b: number): number => {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}

const full = { x0: 0, y0: 0, x1: 160, y1: 90 }

describe('Screen Sync: zones from light positions', () => {
  it('left and right sample strips along those edges', () => {
    const z = zonesFor(
      [
        { lightId: 'L', position: 'left' },
        { lightId: 'R', position: 'right' }
      ],
      full,
      0.2
    )
    expect(z.get('L')).toEqual({ x0: 0, x1: 32, y0: 0, y1: 90 })
    expect(z.get('R')).toEqual({ x0: 128, x1: 160, y0: 0, y1: 90 })
  })

  it('center samples the whole picture, top and bottom sample horizontal strips', () => {
    const z = zonesFor(
      [
        { lightId: 'C', position: 'center' },
        { lightId: 'T', position: 'top' },
        { lightId: 'B', position: 'bottom' }
      ],
      full,
      0.2
    )
    expect(z.get('C')).toEqual(full)
    expect(z.get('T')).toEqual({ x0: 0, x1: 160, y0: 0, y1: 18 })
    expect(z.get('B')).toEqual({ x0: 0, x1: 160, y0: 72, y1: 90 })
  })

  it('lights sharing a position split its region evenly', () => {
    const z = zonesFor(
      [
        { lightId: 'L1', position: 'left' },
        { lightId: 'L2', position: 'left' }
      ],
      full,
      0.2
    )
    expect(z.get('L1')).toEqual({ x0: 0, x1: 32, y0: 0, y1: 45 })
    expect(z.get('L2')).toEqual({ x0: 0, x1: 32, y0: 45, y1: 90 })
  })
})

describe('Screen Sync: letterbox detection', () => {
  it('finds the bars of a 2.39:1 film and excludes them', async () => {
    const f = await load('letterbox-239.png')
    const bars = detectBars(f)
    expect(bars.top).toBeGreaterThanOrEqual(10)
    expect(bars.top).toBeLessThanOrEqual(12)
    expect(bars.bottom).toBeGreaterThanOrEqual(10)
    expect(bars.left).toBe(0)
    expect(bars.right).toBe(0)
    // Without the bars the top strip reads the orange scene, not black
    const top = zoneColor(f, zonesFor([{ lightId: 'T', position: 'top' }], activeArea(f, bars), 0.15).get('T')!)
    expect(top.vivid).toBe(true)
    expect(hueDist(top.h, 28)).toBeLessThan(15)
  })

  it('does not treat an all-black frame as a letterbox', () => {
    expect(detectBars(solid(0, 0, 0))).toEqual({ top: 0, bottom: 0, left: 0, right: 0 })
  })

  it('adopts new bars only once they hold, and drops them straight away', () => {
    const t = new LetterboxTracker(1000)
    const bars = { top: 11, bottom: 11, left: 0, right: 0 }
    expect(t.update(bars, 0).top).toBe(0)
    expect(t.update(bars, 500).top).toBe(0)
    expect(t.update(bars, 1100).top).toBe(11)
    // Picture fills the frame again
    expect(t.update({ top: 0, bottom: 0, left: 0, right: 0 }, 1200).top).toBe(0)
  })
})

describe('Screen Sync: colour per zone', () => {
  it('green explosion on the right, neutral on the left', async () => {
    const f = await load('explosion-right-green.png')
    const z = zonesFor(
      [
        { lightId: 'left', position: 'left' },
        { lightId: 'right', position: 'right' }
      ],
      activeArea(f, detectBars(f)),
      0.2
    )
    const left = zoneColor(f, z.get('left')!)
    const right = zoneColor(f, z.get('right')!)
    expect(right.vivid).toBe(true)
    expect(hueDist(right.h, 110)).toBeLessThan(20)
    expect(right.s).toBeGreaterThan(60)
    expect(left.vivid).toBe(false)
    expect(right.luminance).toBeGreaterThan(left.luminance)
  })

  it('a colourful frame gives the dominant vivid colour, not a muddy average', async () => {
    const f = await load('colorful.png')
    const c = zoneColor(f, full)
    expect(c.vivid).toBe(true)
    expect(hueDist(c.h, 230)).toBeLessThan(12)
    expect(c.s).toBeGreaterThan(70)
  })

  it('grey, black and white frames fall back to a neutral', async () => {
    for (const name of ['gray.png', 'black.png', 'white.png']) {
      const c = zoneColor(await load(name), full)
      expect(c.vivid).toBe(false)
    }
    expect(zoneColor(await load('black.png'), full).luminance).toBeLessThan(0.02)
    expect(zoneColor(await load('white.png'), full).luminance).toBeGreaterThan(0.95)
  })

  it('recognises black frames', async () => {
    expect(isBlackFrame(await load('black.png'))).toBe(true)
    expect(isBlackFrame(await load('gray.png'))).toBe(false)
  })
})

describe('Screen Sync: frame-to-frame analysis', () => {
  const placements = [
    { lightId: 'left', position: 'left' as const },
    { lightId: 'right', position: 'right' as const }
  ]

  it('skips frames that barely changed', () => {
    const a = new ScreenAnalyzer(placements)
    expect(a.process(solid(40, 40, 200), 0)).not.toBeNull()
    expect(a.process(solid(40, 40, 201), 33)).toBeNull()
  })

  it('flags a scene cut when the picture changes all at once', () => {
    const a = new ScreenAnalyzer(placements)
    a.process(solid(10, 10, 10), 0)
    expect(a.process(solid(30, 30, 40), 33)?.sceneCut).toBe(false)
    expect(a.process(solid(240, 230, 220), 66)?.sceneCut).toBe(true)
  })

  it('reports colours per light', async () => {
    const a = new ScreenAnalyzer(placements)
    const r = a.process(await load('explosion-right-green.png'), 0)!
    expect(Object.keys(r.zones).sort()).toEqual(['left', 'right'])
    expect(r.zones.right.vivid).toBe(true)
  })
})

describe('Screen analysis: average colour for Movie mode', () => {
  it('reports the tint of a warm white zone that is not vivid', () => {
    const f = solid(255, 240, 215)
    const c = zoneColor(f, { x0: 0, y0: 0, x1: f.width, y1: f.height })
    expect(c.vivid).toBe(false)
    expect(c.tintS).toBeGreaterThan(8)
    expect(c.tintH).toBeGreaterThan(25)
    expect(c.tintH).toBeLessThan(50)
  })
})
