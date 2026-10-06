import { ColorHS } from '../types'

/**
 * Maps normalized Color Temperature (0-100) to Kelvin and RGB
 * 0   = 2200K Candlelight Warm Amber (rgb(255, 147, 41))
 * 50  = 4000K Neutral Soft White (rgb(255, 214, 170))
 * 100 = 6500K Cool Sky Daylight (rgb(201, 226, 255))
 */
export function cctToRgb(cct: number): { r: number; g: number; b: number; hex: string } {
  const t = Math.max(0, Math.min(100, cct)) / 100

  let r = 255
  let g = 255
  let b = 255

  if (t <= 0.5) {
    const factor = t / 0.5
    r = 255
    g = Math.round(147 + (214 - 147) * factor)
    b = Math.round(41 + (170 - 41) * factor)
  } else {
    const factor = (t - 0.5) / 0.5
    r = Math.round(255 + (201 - 255) * factor)
    g = Math.round(214 + (226 - 214) * factor)
    b = Math.round(170 + (255 - 170) * factor)
  }

  const toHex = (n: number) => n.toString(16).padStart(2, '0')
  return { r, g, b, hex: `#${toHex(r)}${toHex(g)}${toHex(b)}` }
}

/**
 * Converts HSV (H: 0-360, S: 0-100, V: 0-100) to RGB and Hex
 */
export function hsvToRgb(h: number, s: number, v: number): { r: number; g: number; b: number; hex: string } {
  const normH = ((h % 360) + 360) % 360
  const normS = Math.max(0, Math.min(100, s)) / 100
  const normV = Math.max(0, Math.min(100, v)) / 100

  const c = normV * normS
  const x = c * (1 - Math.abs(((normH / 60) % 2) - 1))
  const m = normV - c

  let rPrime = 0
  let gPrime = 0
  let bPrime = 0

  if (normH >= 0 && normH < 60) {
    rPrime = c
    gPrime = x
  } else if (normH >= 60 && normH < 120) {
    rPrime = x
    gPrime = c
  } else if (normH >= 120 && normH < 180) {
    gPrime = c
    bPrime = x
  } else if (normH >= 180 && normH < 240) {
    gPrime = x
    bPrime = c
  } else if (normH >= 240 && normH < 300) {
    rPrime = x
    bPrime = c
  } else {
    rPrime = c
    bPrime = x
  }

  const r = Math.round((rPrime + m) * 255)
  const g = Math.round((gPrime + m) * 255)
  const b = Math.round((bPrime + m) * 255)
  const toHex = (n: number) => n.toString(16).padStart(2, '0')

  return { r, g, b, hex: `#${toHex(r)}${toHex(g)}${toHex(b)}` }
}

/**
 * Returns bulb color RGB, hex and dark tone based on light state
 */
export function getBulbColor(
  power: boolean,
  mode: string,
  colorTemp: number,
  color?: ColorHS
): { r: number; g: number; b: number; hex: string; darkHex: string } {
  if (!power) {
    return { r: 18, g: 18, b: 21, hex: '#121215', darkHex: '#09090b' }
  }

  if (mode === 'colour' && color) {
    const rgb = hsvToRgb(color.h, color.s, 100)
    // Dark tone of the colour
    const darkR = Math.round(rgb.r * 0.15)
    const darkG = Math.round(rgb.g * 0.15)
    const darkB = Math.round(rgb.b * 0.15)
    const toHex = (n: number) => n.toString(16).padStart(2, '0')
    return {
      ...rgb,
      darkHex: `#${toHex(darkR)}${toHex(darkG)}${toHex(darkB)}`
    }
  }

  const rgb = cctToRgb(colorTemp)
  const darkR = Math.round(rgb.r * 0.18)
  const darkG = Math.round(rgb.g * 0.18)
  const darkB = Math.round(rgb.b * 0.18)
  const toHex = (n: number) => n.toString(16).padStart(2, '0')
  return {
    ...rgb,
    darkHex: `#${toHex(darkR)}${toHex(darkG)}${toHex(darkB)}`
  }
}

/**
 * Calculates standard perceived luminance (0 to 1) from sRGB values
 */
export function getLuminance(r: number, g: number, b: number): number {
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255
}

/**
 * Determines whether an illuminated light tile surface is bright enough
 * to require a high-contrast deep black (#09090B) text/icon flip (WCAG AA/AAA).
 */
export function isLightSurface(
  power: boolean,
  brightness: number,
  mode: string,
  colorTemp: number,
  color?: ColorHS
): boolean {
  if (!power || brightness < 45) return false
  const { r, g, b } = getBulbColor(true, mode, colorTemp, color)
  const lum = getLuminance(r, g, b)
  // When brightness is high and color tone has high luminance (warm white, soft white, daylight, yellow/pastel)
  const surfaceBrightness = lum * (brightness / 100)
  return surfaceBrightness >= 0.46
}

export interface TileGlowStyleResult {
  glowColor: string
  glowOpacity: number
  tileBackground: string
  boxShadow: string
  accentColor: string
  isBright: boolean
  rgb: { r: number; g: number; b: number }
}

/**
 * Generates dynamic gradient and glow styling for a light tile adhering to Apple HIG & Lumos Design System
 */
export function getTileGlowStyle(
  power: boolean,
  brightness: number,
  mode: string,
  colorTemp: number,
  color?: ColorHS
): TileGlowStyleResult {
  if (!power || brightness <= 0) {
    return {
      glowColor: 'transparent',
      glowOpacity: 0,
      tileBackground: 'rgba(24, 24, 28, 0.65)',
      boxShadow: '0 2px 8px rgba(0, 0, 0, 0.35)',
      accentColor: 'rgb(113, 113, 122)', // zinc-500
      isBright: false,
      rgb: { r: 113, g: 113, b: 122 }
    }
  }

  const { r, g, b, hex } = getBulbColor(true, mode, colorTemp, color)
  const briRatio = Math.max(0.05, Math.min(1, brightness / 100))
  const isBright = isLightSurface(power, brightness, mode, colorTemp, color)

  // Outer ambient bleed glow matching Apple Home & Lumos design spec
  const glowAlpha = Math.min(0.75, Math.max(0.15, briRatio * 0.70)).toFixed(2)
  const glowPastEdgeAlpha = (briRatio * 0.42).toFixed(2)
  const rimAlpha = (briRatio * 0.22 + 0.10).toFixed(2)

  // Box-shadow: Specular rim + diffuse ambient glow past edge (0 0 28px)
  const boxShadow = [
    `0 0 0 1px rgba(255, 255, 255, ${rimAlpha})`,
    `0 0 28px rgba(${r}, ${g}, ${b}, ${glowPastEdgeAlpha})`,
    `0 8px 32px -4px rgba(${r}, ${g}, ${b}, ${glowAlpha})`,
    '0 2px 12px 0 rgba(0, 0, 0, 0.40)'
  ].join(', ')

  // Radial Card Gradient Fill from Design Guide 3.2
  const topAlpha = (briRatio * 0.65 + 0.25).toFixed(2)
  const midAlpha = (briRatio * 0.35 + 0.12).toFixed(2)
  const tileBackground = `radial-gradient(ellipse 140% 110% at 50% 0%, rgba(${r}, ${g}, ${b}, ${topAlpha}) 0%, rgba(${r}, ${g}, ${b}, ${midAlpha}) 55%, rgba(24, 24, 28, 0.85) 100%)`

  const glowColor = `radial-gradient(ellipse at 50% 40%, rgba(${r}, ${g}, ${b}, 0.9) 0%, rgba(${r}, ${g}, ${b}, 0.35) 45%, transparent 75%)`

  return {
    glowColor,
    glowOpacity: Number(glowAlpha),
    tileBackground,
    boxShadow,
    accentColor: hex,
    isBright,
    rgb: { r, g, b }
  }
}
