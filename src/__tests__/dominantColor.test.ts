import { describe, it, expect } from 'vitest'
import sharp from 'sharp'
import { join } from 'path'
import { extractColors, rgbToHsv, WARM_WHITE } from '../shared/color/dominant'

const FIXTURES = join(__dirname, 'fixtures', 'art')

/** Decodes a fixture the way the media helper does: a 48x48 RGBA thumbnail. */
async function load(name: string): Promise<{ data: Uint8Array; w: number; h: number }> {
  const { data, info } = await sharp(join(FIXTURES, name))
    .resize(48, 48, { fit: 'fill' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  return { data: new Uint8Array(data), w: info.width, h: info.height }
}

const hueDist = (a: number, b: number): number => {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}

describe('Album colour extraction on fixture images', () => {
  it('colourful art: picks the dominant blue and offers the orange as a second colour', async () => {
    const { data, w, h } = await load('colorful.png')
    const result = extractColors(data, w, h)
    expect(result.monochrome).toBe(false)
    expect(hueDist(result.primary.h, 225)).toBeLessThan(20)
    expect(result.primary.s).toBeGreaterThanOrEqual(60)
    expect(result.primary.v).toBeGreaterThanOrEqual(65)
    expect(result.palette.length).toBeGreaterThanOrEqual(2)
    expect(result.palette.some((c) => hueDist(c.h, 26) < 20)).toBe(true)
  })

  it('grey art falls back to warm white', async () => {
    const { data, w, h } = await load('gray.png')
    const result = extractColors(data, w, h)
    expect(result.monochrome).toBe(true)
    expect(result.primary).toEqual(WARM_WHITE)
  })

  it('black and white art falls back to warm white', async () => {
    const { data, w, h } = await load('black-and-white.png')
    const result = extractColors(data, w, h)
    expect(result.monochrome).toBe(true)
  })

  it('discards near-black so a small vivid accent wins', async () => {
    const { data, w, h } = await load('dark-accent.png')
    const result = extractColors(data, w, h)
    expect(result.monochrome).toBe(false)
    expect(hueDist(result.primary.h, 355)).toBeLessThan(15)
    expect(result.primary.v).toBeGreaterThanOrEqual(65)
  })

  it('boosts dull colours so they read on a bulb', () => {
    // A muted teal, the whole image
    const px = new Uint8Array(16 * 16 * 4)
    for (let i = 0; i < 256; i++) px.set([70, 120, 115, 255], i * 4)
    const result = extractColors(px, 16, 16)
    const source = rgbToHsv(70, 120, 115)
    expect(result.primary.s).toBeGreaterThan(source.s)
    expect(result.primary.v).toBeGreaterThanOrEqual(65)
  })
})
