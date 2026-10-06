import React, { useCallback, useRef } from 'react'
import { ColorHS } from '../../types'
import { hsvToRgb } from '../../lib/color'

interface ColorWheelProps {
  color?: ColorHS
  onChange: (color: ColorHS) => void
  disabled?: boolean
}

const PRESET_SWATCHES: Array<{ name: string; h: number; s: number }> = [
  { name: 'Candlelight', h: 30, s: 90 },
  { name: 'Amber Gold', h: 42, s: 95 },
  { name: 'Sunset', h: 12, s: 90 },
  { name: 'Crimson', h: 348, s: 85 },
  { name: 'Rose', h: 320, s: 80 },
  { name: 'Violet', h: 275, s: 85 },
  { name: 'Ocean Azure', h: 215, s: 90 },
  { name: 'Sky Cyan', h: 190, s: 85 },
  { name: 'Mint Green', h: 150, s: 80 },
  { name: 'Emerald', h: 120, s: 85 }
]

export const ColorWheel: React.FC<ColorWheelProps> = ({
  color = { h: 35, s: 90, v: 100 },
  onChange,
  disabled = false
}) => {
  const hueTrackRef = useRef<HTMLDivElement>(null)
  const satTrackRef = useRef<HTMLDivElement>(null)

  const safeColor = color || { h: 35, s: 90, v: 100 }
  const currentH = typeof safeColor.h === 'number' ? safeColor.h : 35
  const currentS = typeof safeColor.s === 'number' ? safeColor.s : 90
  const currentV = typeof safeColor.v === 'number' ? safeColor.v : 100

  const rgb = hsvToRgb(currentH, currentS, currentV)

  const handleHuePointer = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (disabled || !hueTrackRef.current) return
      const rect = hueTrackRef.current.getBoundingClientRect()
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
      const h = Math.round(ratio * 360)
      onChange({ h, s: currentS, v: currentV })
    },
    [disabled, currentS, currentV, onChange]
  )

  const handleSatPointer = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (disabled || !satTrackRef.current) return
      const rect = satTrackRef.current.getBoundingClientRect()
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
      const s = Math.round(ratio * 100)
      onChange({ h: currentH, s, v: currentV })
    },
    [disabled, currentH, currentV, onChange]
  )

  return (
    <div className={`flex flex-col gap-4 select-none ${disabled ? 'opacity-40 pointer-events-none' : ''}`}>
      {/* Live Color Preview & Value */}
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2.5">
          <div
            className="w-7 h-7 rounded-full border border-white/20 shadow-md transition-colors"
            style={{ backgroundColor: rgb.hex }}
          />
          <div>
            <span className="text-xs font-semibold text-white tracking-wide uppercase font-mono">
              {rgb.hex}
            </span>
            <p className="text-[10px] text-zinc-400 font-mono">
              H: {currentH}° • S: {currentS}%
            </p>
          </div>
        </div>
      </div>

      {/* Hue Gradient Scrub Bar */}
      <div className="flex flex-col gap-1.5">
        <div className="flex justify-between text-[11px] font-medium text-zinc-400">
          <span>Hue</span>
          <span>{currentH}°</span>
        </div>
        <div
          ref={hueTrackRef}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId)
            handleHuePointer(e)
          }}
          onPointerMove={(e) => {
            if (e.buttons > 0) handleHuePointer(e)
          }}
          className="relative h-6 w-full rounded-xl cursor-pointer border border-white/10 shadow-inner"
          style={{
            background:
              'linear-gradient(90deg, #ff0000 0%, #ffff00 17%, #00ff00 33%, #00ffff 50%, #0000ff 67%, #ff00ff 83%, #ff0000 100%)'
          }}
        >
          {/* Hue Marker */}
          <div
            className="absolute top-0 bottom-0 w-3 rounded-md bg-white border border-black/40 shadow-md pointer-events-none -ml-1.5 transition-all"
            style={{ left: `${(currentH / 360) * 100}%` }}
          />
        </div>
      </div>

      {/* Saturation Scrub Bar */}
      <div className="flex flex-col gap-1.5">
        <div className="flex justify-between text-[11px] font-medium text-zinc-400">
          <span>Saturation</span>
          <span>{currentS}%</span>
        </div>
        <div
          ref={satTrackRef}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId)
            handleSatPointer(e)
          }}
          onPointerMove={(e) => {
            if (e.buttons > 0) handleSatPointer(e)
          }}
          className="relative h-6 w-full rounded-xl cursor-pointer border border-white/10 shadow-inner overflow-hidden"
          style={{
            background: `linear-gradient(90deg, #ffffff, ${hsvToRgb(currentH, 100, 100).hex})`
          }}
        >
          {/* Saturation Marker */}
          <div
            className="absolute top-0 bottom-0 w-3 rounded-md bg-zinc-900 border border-white/60 shadow-md pointer-events-none -ml-1.5 transition-all"
            style={{ left: `${currentS}%` }}
          />
        </div>
      </div>

      {/* Calibrated Color Swatches */}
      <div className="flex flex-wrap gap-2.5 pt-1">
        {PRESET_SWATCHES.map((swatch) => {
          const swatchRgb = hsvToRgb(swatch.h, swatch.s, 100)
          const isSelected = Math.abs(currentH - swatch.h) < 10 && Math.abs(currentS - swatch.s) < 15
          return (
            <button
              type="button"
              key={swatch.name}
              onClick={() => onChange({ h: swatch.h, s: swatch.s, v: currentV })}
              className={`w-7 h-7 rounded-full transition-all duration-150 flex items-center justify-center border border-white/30 shadow-sm active:scale-95 focus:outline-none cursor-pointer ${
                isSelected
                  ? 'ring-2 ring-white ring-offset-2 ring-offset-zinc-900 scale-105'
                  : 'hover:scale-110 opacity-90 hover:opacity-100 hover:border-white/60'
              }`}
              style={{
                backgroundColor: swatchRgb.hex,
                boxShadow: isSelected
                  ? `0 0 10px ${swatchRgb.hex}99, inset 0 1px 1px rgba(255,255,255,0.6)`
                  : 'inset 0 1px 1px rgba(255,255,255,0.4), 0 2px 4px rgba(0,0,0,0.4)'
              }}
              title={swatch.name}
              aria-label={swatch.name}
            >
              {isSelected && (
                <span className="w-2 h-2 rounded-full bg-white shadow-sm ring-1 ring-black/20 pointer-events-none" />
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
export default ColorWheel
