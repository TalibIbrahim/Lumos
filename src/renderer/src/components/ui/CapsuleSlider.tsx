import React, { useRef, useState, useCallback, useEffect } from 'react'
import { Sun, LucideIcon } from 'lucide-react'
import { createThrottle, Throttle } from '../../lib/throttle'

interface CapsuleSliderProps {
  value: number // 0-100
  onChange: (value: number) => void
  onCommit?: (value: number) => void
  disabled?: boolean
  icon?: LucideIcon
  fillColor?: string
  height?: number
  className?: string
}

export const CapsuleSlider: React.FC<CapsuleSliderProps> = ({
  value,
  onChange,
  onCommit,
  disabled = false,
  icon: Icon = Sun,
  fillColor = 'rgb(255, 214, 170)',
  height = 280,
  className = ''
}) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const [localVal, setLocalVal] = useState(value)
  const [isScrubbing, setIsScrubbing] = useState(false)
  const isPointerDownRef = useRef(false)
  // The value reaches the bulb at most every 40 ms while scrubbing, and the last value always arrives
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const throttleRef = useRef<Throttle<[number]> | null>(null)
  if (!throttleRef.current) throttleRef.current = createThrottle(40, (v: number) => onChangeRef.current(v))

  useEffect(() => {
    if (!isScrubbing) {
      setLocalVal(value)
    }
  }, [value, isScrubbing])

  const calculateRatioFromPointer = useCallback((clientY: number) => {
    if (!containerRef.current) return 0
    const rect = containerRef.current.getBoundingClientRect()
    // bottom is 0%, top is 100%
    const relativeY = rect.bottom - clientY
    const ratio = Math.max(0, Math.min(1, relativeY / rect.height))
    return Math.round(ratio * 100)
  }, [])

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled) return
    isPointerDownRef.current = true
    setIsScrubbing(true)
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // ignore
    }

    const newVal = calculateRatioFromPointer(e.clientY)
    setLocalVal(newVal)
    throttleRef.current?.call(newVal)
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isPointerDownRef.current || disabled) return
    const newVal = calculateRatioFromPointer(e.clientY)
    setLocalVal(newVal)
    throttleRef.current?.call(newVal)
  }

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isPointerDownRef.current) return
    isPointerDownRef.current = false
    setIsScrubbing(false)
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      // ignore
    }

    throttleRef.current?.cancel()
    const newVal = calculateRatioFromPointer(e.clientY)
    onChange(newVal)
    if (onCommit) onCommit(newVal)
  }

  const handlePointerCancel = () => {
    isPointerDownRef.current = false
    setIsScrubbing(false)
    throttleRef.current?.cancel()
  }

  return (
    <div
      ref={containerRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      style={{ height: `${height}px` }}
      className={`relative w-28 rounded-3xl overflow-hidden cursor-ns-resize select-none border border-white/10 bg-zinc-900/70 backdrop-blur-2xl shadow-2xl transition-transform active:scale-[0.98] ${
        disabled ? 'opacity-40 pointer-events-none' : ''
      } ${className}`}
    >
      {/* Specular Top-Edge Sheen */}
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent pointer-events-none z-20"
      />

      {/* Luminous Fill Body */}
      <div
        aria-hidden="true"
        className="absolute inset-x-0 bottom-0 pointer-events-none transition-all duration-75"
        style={{
          height: `${localVal}%`,
          background: `linear-gradient(to top, ${fillColor}dd, ${fillColor})`
        }}
      />

      {/* Embedded Physical Controls & Readout */}
      <div className="relative z-10 h-full p-4 flex flex-col justify-between items-center pointer-events-none">
        {/* Percentage Number */}
        <span
          className="text-xl font-bold tracking-tight text-white drop-shadow-md pt-1 select-none"
          style={{ fontVariantNumeric: 'tabular-nums' }}
        >
          {localVal}%
        </span>

        {/* Tactical Icon */}
        <div className="w-10 h-10 rounded-full bg-black/20 backdrop-blur-md flex items-center justify-center text-white/90 shadow-inner">
          <Icon className="w-5 h-5 text-white" />
        </div>
      </div>
    </div>
  )
}
export default CapsuleSlider
