import React, { useMemo } from 'react'
import Aurora from './Aurora'
import { NormalizedLightState } from '../types'
import { getBulbColor } from '../lib/color'

interface AmbientAuroraProps {
  lights: NormalizedLightState[]
}

export const AmbientAurora: React.FC<AmbientAuroraProps> = ({ lights }) => {
  const activeLights = useMemo(
    () => lights.filter((l) => l.online && l.power && l.brightness > 0),
    [lights]
  )

  const colorStops = useMemo(() => {
    if (activeLights.length === 0) {
      // Idle: radiant celestial northern lights — electric cyan, deep violet, and emerald
      return ['#00f0ff', '#7000ff', '#00ff88']
    }

    if (activeLights.length === 1) {
      const b = getBulbColor(
        true,
        activeLights[0].mode,
        activeLights[0].colorTemp,
        activeLights[0].color
      )
      return [b.hex, '#7000ff', b.hex]
    }

    // 2 or more lights: blend colors across stops
    const b0 = getBulbColor(
      true,
      activeLights[0].mode,
      activeLights[0].colorTemp,
      activeLights[0].color
    )
    const b1 = getBulbColor(
      true,
      activeLights[1].mode,
      activeLights[1].colorTemp,
      activeLights[1].color
    )
    const b2 = activeLights[2]
      ? getBulbColor(true, activeLights[2].mode, activeLights[2].colorTemp, activeLights[2].color)
      : b0

    return [b0.hex, b1.hex, b2.hex]
  }, [activeLights])

  const isAnyActive = activeLights.length > 0

  return (
    <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none bg-[#07070a]">
      {/* React Bits Aurora Canvas - visibly radiant and organic */}
      <div className="absolute inset-0 opacity-100">
        <Aurora
          colorStops={colorStops}
          amplitude={isAnyActive ? 1.1 : 0.95}
          blend={0.55}
          speed={isAnyActive ? 0.45 : 0.3}
        />
      </div>

      {/* Subtle spatial depth mesh */}
      <div
        className="absolute inset-0 opacity-[0.025] pointer-events-none"
        style={{
          backgroundImage: 'radial-gradient(rgba(255, 255, 255, 0.6) 1px, transparent 1px)',
          backgroundSize: '32px 32px'
        }}
      />
    </div>
  )
}
export default AmbientAurora
