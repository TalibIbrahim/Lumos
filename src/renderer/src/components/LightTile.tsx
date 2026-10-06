import React, { useRef, useState, useMemo, useEffect } from 'react'
import { motion } from 'framer-motion'
import {
  Lightbulb,
  SlidersHorizontal,
  WifiOff,
  Palette
} from 'lucide-react'
import { GlassButton } from './ui/GlassButton'
import { NormalizedLightState } from '../types'
import { offlineLabel } from '../lib/connection'
import { getTileGlowStyle } from '../lib/color'
import { springs } from '../lib/constants'

export interface LightTileProps {
  light: NormalizedLightState
  onToggle: (id: string) => void
  onBrightnessChange: (id: string, value: number) => void
  onOpenDetail: (light: NormalizedLightState) => void
  onContextMenu?: (pos: { clientX: number; clientY: number }, light: NormalizedLightState) => void
  isFocused?: boolean
}

/**
 * Lumos Accessory Tile
 * Apple Home-Grade Accessory Tile:
 * - Proportions: Compact rounded squircle rectangle (~114px height, aspect ratio ~1.45:1)
 * - Off state: Quiet translucent graphite (rgba(24, 24, 28, 0.65)), muted icon, secondary text "Off"
 * - On state: Tile surface brightens into bulb's real color (Kelvin or RGB hue)
 * - Ambient soft glow past edge (box-shadow 0 0 28px rgba(R, G, B, alpha))
 * - Luminance-aware contrast flip: bright tone flips text and icon to deep black (#09090B) (WCAG AA/AAA)
 * - Offline state: Distinct disabled style, WifiOff alert icon, "No response" text
 * - Interactions:
 *   - Tap toggles power
 *   - 1:1 vertical drag adjusts brightness directly (with live percentage readout and rising fill)
 *   - Press and hold (or clicking info icon) opens the detail sheet
 *   - Right-click / long-press opens 5-item TileContextMenu
 *   - Keyboard: Space toggles, Enter opens detail, visible 2px focus ring
 */
const LightTileComponent: React.FC<LightTileProps> = ({
  light,
  onToggle,
  onBrightnessChange,
  onOpenDetail,
  onContextMenu,
  isFocused = false
}) => {
  const { id, name, online, power, brightness, colorTemp, mode, color, customName } = light
  const offlineText = offlineLabel(light.connectionIssue)
  const displayName = customName || name

  // Direct manipulation drag state
  const [localBri, setLocalBri] = useState<number>(brightness)
  const [isDragging, setIsDragging] = useState(false)
  const isPointerDownRef = useRef(false)
  const startYRef = useRef(0)
  const startBriRef = useRef(brightness)
  const hasMovedRef = useRef(false)
  const startTimeRef = useRef(0)
  const longPressTimerRef = useRef<NodeJS.Timeout | null>(null)
  const throttleTimerRef = useRef<NodeJS.Timeout | null>(null)
  const tileRef = useRef<HTMLDivElement>(null)

  // Keep local brightness in sync with external updates when not dragging
  useEffect(() => {
    if (!isDragging) {
      setLocalBri(brightness)
    }
  }, [brightness, isDragging])

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current)
      if (throttleTimerRef.current) clearTimeout(throttleTimerRef.current)
    }
  }, [])

  // Auto-focus support for keyboard grid traversal
  useEffect(() => {
    if (isFocused && tileRef.current) {
      tileRef.current.focus()
    }
  }, [isFocused])

  // Compute live visual style and luminance contrast
  const effectiveBri = power ? (isDragging ? localBri : brightness) : 0
  const glow = useMemo(() => {
    return getTileGlowStyle(power, effectiveBri, mode, colorTemp, color)
  }, [power, effectiveBri, mode, colorTemp, color])

  // Human-readable mode/Kelvin status label
  const modeLabel = useMemo(() => {
    if (!power) return 'Off'
    if (mode === 'colour') return 'Color'
    if (colorTemp <= 20) return 'Candlelight'
    if (colorTemp <= 40) return 'Warm White'
    if (colorTemp <= 65) return 'Neutral'
    return 'Daylight'
  }, [power, mode, colorTemp])

  // Direct manipulation pointer handlers
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!online || e.button !== 0) return // Left mouse button only for direct drag & tap
    isPointerDownRef.current = true
    startYRef.current = e.clientY
    startBriRef.current = power ? brightness : 100
    hasMovedRef.current = false
    startTimeRef.current = Date.now()

    // Press and hold (500ms): triggers detail sheet (or long-press context menu if on touch)
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current)
    longPressTimerRef.current = setTimeout(() => {
      if (!hasMovedRef.current && isPointerDownRef.current) {
        isPointerDownRef.current = false
        // Provide tactile detail sheet presentation on hold
        onOpenDetail(light)
      }
    }, 500)
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isPointerDownRef.current || !online) return

    const deltaY = startYRef.current - e.clientY // up = positive, down = negative

    // Claim gesture when movement exceeds 5px threshold
    if (!hasMovedRef.current && Math.abs(deltaY) > 5) {
      hasMovedRef.current = true
      setIsDragging(true)
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current)
        longPressTimerRef.current = null
      }
      try {
        e.currentTarget.setPointerCapture(e.pointerId)
      } catch {
        // Safe fallback if pointer capture unsupported
      }
    }

    if (hasMovedRef.current) {
      // 120px vertical travel maps 1:1 across 0-100% brightness
      const deltaPercent = (deltaY / 120) * 100
      const nextBri = Math.max(1, Math.min(100, Math.round(startBriRef.current + deltaPercent)))
      setLocalBri(nextBri)

      // Throttle IPC network commit to 50ms intervals for responsive hardware feedback
      if (throttleTimerRef.current) clearTimeout(throttleTimerRef.current)
      throttleTimerRef.current = setTimeout(() => {
        onBrightnessChange(id, nextBri)
      }, 50)
    }
  }

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isPointerDownRef.current) return
    isPointerDownRef.current = false

    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }

    if (hasMovedRef.current) {
      // Commit final drag brightness value
      setIsDragging(false)
      try {
        e.currentTarget.releasePointerCapture(e.pointerId)
      } catch {
        // Safe fallback
      }
      if (throttleTimerRef.current) clearTimeout(throttleTimerRef.current)
      onBrightnessChange(id, localBri)
    } else {
      // Clean tap interaction: toggle power state
      const duration = Date.now() - startTimeRef.current
      if (duration < 450) {
        onToggle(id)
      }
    }
  }

  const handlePointerCancel = () => {
    isPointerDownRef.current = false
    setIsDragging(false)
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current)
    if (throttleTimerRef.current) clearTimeout(throttleTimerRef.current)
  }

  // Keyboard navigation & accessibility
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault()
      if (online) onToggle(id)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      onOpenDetail(light)
    }
  }

  // Determine contrast role
  const isLightMode = power && online && glow.isBright

  return (
    <div className="relative group select-none">
      <motion.div
        ref={tileRef}
        role="switch"
        aria-checked={power}
        aria-label={`${displayName}, ${online ? (power ? `On, ${effectiveBri} percent brightness` : 'Off') : offlineText}`}
        data-light-id={id}
        tabIndex={online ? 0 : -1}
        onKeyDown={handleKeyDown}
        whileHover={online ? { scale: 1.015, y: -1 } : undefined}
        whileTap={online && !isDragging ? { scale: 0.97 } : undefined}
        transition={springs.cardHover}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onContextMenu={(e) => {
          e.preventDefault()
          e.stopPropagation()
          if (longPressTimerRef.current) {
            clearTimeout(longPressTimerRef.current)
            longPressTimerRef.current = null
          }
          onContextMenu?.({ clientX: e.clientX, clientY: e.clientY }, light)
        }}
        style={{
          background: online
            ? power
              ? glow.tileBackground
              : 'rgba(24, 24, 28, 0.65)'
            : 'rgba(20, 20, 24, 0.40)',
          boxShadow: online ? (power ? glow.boxShadow : '0 2px 8px rgba(0, 0, 0, 0.35)') : 'none',
          borderColor: online
            ? power
              ? isLightMode
                ? 'rgba(0, 0, 0, 0.16)'
                : 'rgba(255, 255, 255, 0.22)'
              : 'rgba(255, 255, 255, 0.08)'
            : 'rgba(244, 63, 94, 0.30)'
        }}
        className={`relative h-[114px] rounded-[20px] overflow-hidden transition-all duration-300 border outline-none cursor-pointer focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black ${
          !online ? 'cursor-not-allowed border-dashed' : 'backdrop-blur-xl'
        }`}
      >
        {/* Dynamic Vertical Dimmer Fill Bar */}
        {power && online && (
          <div
            aria-hidden="true"
            className="absolute inset-x-0 bottom-0 pointer-events-none transition-all duration-75"
            style={{
              height: `${effectiveBri}%`,
              background: isLightMode
                ? 'linear-gradient(to top, rgba(0, 0, 0, 0.09) 0%, rgba(0, 0, 0, 0.02) 100%)'
                : 'linear-gradient(to top, rgba(255, 255, 255, 0.16) 0%, rgba(255, 255, 255, 0.04) 100%)'
            }}
          />
        )}

        {/* Specular Top-Edge Reflection Sheen */}
        <div
          aria-hidden="true"
          className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent pointer-events-none"
        />

        {/* Tile Content Layout */}
        <div className="relative z-10 h-full p-3.5 flex flex-col justify-between">
          {/* Top Row: Icon + Affordance / Live Percentage */}
          <div className="flex items-center justify-between">
            {/* Left: Tactical Icon Container */}
            <div
              className={`w-8.5 h-8.5 rounded-full flex items-center justify-center transition-colors duration-200 ${
                !online
                  ? 'bg-rose-500/15 text-rose-400 border border-rose-500/20'
                  : power
                  ? 'bg-white/20 text-white shadow-sm'
                  : 'bg-white/[0.06] text-zinc-500 border border-white/[0.06]'
              }`}
            >
              {!online ? (
                <WifiOff className="w-4 h-4" />
              ) : mode === 'colour' ? (
                <Palette className="w-4 h-4" />
              ) : (
                <Lightbulb
                  className={`w-4 h-4 ${power ? 'fill-current' : ''}`}
                />
              )}
            </div>

            {/* Right: Live Drag Badge or Info Expansion Affordance */}
            <div
              className="flex items-center gap-1.5"
              onPointerDown={(e) => e.stopPropagation()}
              onPointerUp={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              {!isDragging && online && light.effect && (
                <span
                  className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-black/30 text-amber-200 border border-amber-300/25 max-w-[96px] truncate"
                  title={`${light.effect} is shaping this light`}
                >
                  {light.effect}
                </span>
              )}
              {isDragging ? (
                <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded-full shadow-sm bg-white/20 text-white">
                  {localBri}%
                </span>
              ) : online ? (
                <GlassButton
                  variant="subtle"
                  size="icon-sm"
                  title="Accessory details"
                  aria-label={`Open details for ${displayName}`}
                  onPointerDown={(e) => e.stopPropagation()}
                  onPointerUp={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation()
                    onOpenDetail(light)
                  }}
                >
                  <SlidersHorizontal className="w-3.5 h-3.5 text-zinc-400 group-hover:text-white" />
                </GlassButton>
              ) : (
                <span className="text-[10px] font-medium text-rose-400/90 bg-rose-500/10 px-2 py-0.5 rounded-full border border-rose-500/20">
                  {offlineText}
                </span>
              )}
            </div>
          </div>

          {/* Bottom Row: Typography Hierarchy */}
          <div className="flex flex-col min-w-0 pr-1">
            <h3
              className={`text-[14px] font-semibold tracking-tight leading-tight truncate transition-colors duration-200 ${
                !online
                  ? 'text-zinc-500'
                  : power
                  ? 'text-white'
                  : 'text-zinc-300'
              }`}
            >
              {displayName}
            </h3>

            <p
              className={`text-[12px] font-normal leading-tight truncate pt-0.5 transition-colors duration-200 ${
                !online
                  ? 'text-rose-400/80 font-medium'
                  : power
                  ? 'text-zinc-300'
                  : 'text-zinc-500'
              }`}
            >
              {!online
                ? offlineText
                : power
                ? `${effectiveBri}% · ${modeLabel}`
                : 'Off'}
            </p>
          </div>
        </div>
      </motion.div>
    </div>
  )
}

export const LightTile = React.memo(LightTileComponent)
export default LightTile
