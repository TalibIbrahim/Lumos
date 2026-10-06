import React, { useMemo } from 'react'
import { NormalizedLightState } from '../types'
import { getBulbColor } from '../lib/color'

interface AmbientBackdropProps {
  lights: NormalizedLightState[]
}

/**
 * Static ambient background tinted by the lights that are on. It replaces
 * the animated WebGL aurora, which kept the GPU busy for as long as the window
 * was visible. These are plain gradients: drawn once, and redrawn only when
 * the light colours change.
 */
export const AmbientBackdrop: React.FC<AmbientBackdropProps> = ({ lights }) => {
  const stops = useMemo(() => {
    const active = lights.filter((l) => l.online && l.power && l.brightness > 0)
    if (active.length === 0) return ['#00f0ff', '#7000ff', '#00ff88']
    const hex = active.slice(0, 3).map((l) => getBulbColor(true, l.mode, l.colorTemp, l.color).hex)
    if (hex.length === 1) return [hex[0], '#7000ff', hex[0]]
    if (hex.length === 2) return [hex[0], hex[1], hex[0]]
    return hex
  }, [lights])

  const anyActive = lights.some((l) => l.online && l.power && l.brightness > 0)
  const strength = anyActive ? 0.34 : 0.2

  return (
    <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none bg-[#07070a]" aria-hidden="true">
      <div
        className="absolute inset-0 transition-opacity duration-700"
        style={{
          opacity: strength,
          background: [
            `radial-gradient(60% 55% at 12% 0%, ${stops[0]} 0%, transparent 70%)`,
            `radial-gradient(55% 50% at 55% -5%, ${stops[1]} 0%, transparent 72%)`,
            `radial-gradient(60% 55% at 95% 5%, ${stops[2]} 0%, transparent 70%)`
          ].join(', ')
        }}
      />
      {/* Subtle spatial depth mesh */}
      <div
        className="absolute inset-0 opacity-[0.025]"
        style={{
          backgroundImage: 'radial-gradient(rgba(255, 255, 255, 0.6) 1px, transparent 1px)',
          backgroundSize: '32px 32px'
        }}
      />
    </div>
  )
}

export default AmbientBackdrop
