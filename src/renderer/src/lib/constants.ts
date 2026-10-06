/**
 * Spring physics configuration adhering strictly to Apple Design specifications:
 * - Critically damped (damping 1.0 / bounce 0) for ordinary UI
 * - Slightly under-damped (bounce 0.15-0.2) only when momentum is involved
 */
export const springs = {
  default: {
    type: 'spring' as const,
    bounce: 0,
    duration: 0.35
  },
  snappy: {
    type: 'spring' as const,
    bounce: 0,
    duration: 0.22
  },
  momentum: {
    type: 'spring' as const,
    bounce: 0.18,
    duration: 0.4
  },
  enter: {
    type: 'spring' as const,
    bounce: 0,
    duration: 0.32
  },
  cardHover: {
    type: 'spring' as const,
    bounce: 0,
    duration: 0.25
  },
  cardPress: {
    type: 'spring' as const,
    bounce: 0,
    duration: 0.15
  }
}

/**
 * Maps normalized Color Temperature (0-100) to RGB/Glow values.
 * 0   = 2200K Warm Amber / Candlelight (rgb(255, 147, 41))
 * 50  = 4000K Neutral Soft White       (rgb(255, 214, 170))
 * 100 = 6500K Cool Daylight Blue       (rgb(201, 226, 255))
 */
export function getKelvinColor(cct: number): { r: number; g: number; b: number; rgbString: string; hex: string } {
  const clamped = Math.max(0, Math.min(100, cct))
  const t = clamped / 100

  let r = 255
  let g = 255
  let b = 255

  if (t <= 0.5) {
    // Warm amber (255, 147, 41) to Neutral (255, 214, 170)
    const factor = t / 0.5
    r = 255
    g = Math.round(147 + (214 - 147) * factor)
    b = Math.round(41 + (170 - 41) * factor)
  } else {
    // Neutral (255, 214, 170) to Cool Daylight (201, 226, 255)
    const factor = (t - 0.5) / 0.5
    r = Math.round(255 + (201 - 255) * factor)
    g = Math.round(214 + (226 - 214) * factor)
    b = Math.round(170 + (255 - 170) * factor)
  }

  const toHex = (n: number): string => n.toString(16).padStart(2, '0')
  const hex = `#${toHex(r)}${toHex(g)}${toHex(b)}`
  const rgbString = `rgb(${r}, ${g}, ${b})`

  return { r, g, b, rgbString, hex }
}

/**
 * Creates dynamic radial / diffuse glow styling for active light cards
 */
export function getLightGlowStyle(power: boolean, brightness: number, colorTemp: number): {
  glowColor: string
  glowOpacity: number
  tintColor: string
} {
  if (!power || brightness <= 0) {
    return {
      glowColor: 'transparent',
      glowOpacity: 0,
      tintColor: 'rgb(161, 161, 170)' // zinc-400
    }
  }

  const { r, g, b } = getKelvinColor(colorTemp)
  // Scale opacity smoothly with brightness (0-100)
  const glowOpacity = Math.max(0.12, Math.min(0.75, (brightness / 100) * 0.7))
  const glowColor = `radial-gradient(ellipse at 50% 30%, rgba(${r}, ${g}, ${b}, 0.85) 0%, rgba(${r}, ${g}, ${b}, 0.25) 50%, transparent 75%)`
  const tintColor = `rgb(${r}, ${g}, ${b})`

  return { glowColor, glowOpacity, tintColor }
}

export interface KelvinPreset {
  kelvin: number
  tempNorm: number
  label: string
}

export const KELVIN_PRESETS: KelvinPreset[] = [
  { kelvin: 2200, tempNorm: 0, label: 'Candlelight' },
  { kelvin: 2700, tempNorm: 12, label: 'Warm' },
  { kelvin: 3000, tempNorm: 20, label: 'Soft White' },
  { kelvin: 4000, tempNorm: 42, label: 'Neutral' },
  { kelvin: 5000, tempNorm: 65, label: 'Daylight' },
  { kelvin: 6500, tempNorm: 100, label: 'Cool Sky' }
]
