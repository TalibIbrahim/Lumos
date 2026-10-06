import React, { useState, useEffect, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X,
  Power,
  Sun,
  Palette,
  Timer,
  Sparkles,
  Edit3,
  Check,
  EyeOff,
  Layers,
  Thermometer,
  Moon,
  Coffee,
  Briefcase,
  Flame,
  Zap
} from 'lucide-react'
import { GlassSurface } from './ui/GlassSurface'
import { GlassButton } from './ui/GlassButton'
import { CapsuleSlider } from './ui/CapsuleSlider'
import { ColorWheel } from './ui/ColorWheel'
import { NormalizedLightState, ColorHS, DeviceMetadata, RoomGroup } from '../types'
import { offlineLabel } from '../lib/connection'
import { springs } from '../lib/constants'
import { cctToRgb, hsvToRgb } from '../lib/color'

export interface LightDetailSheetProps {
  isOpen: boolean
  light: NormalizedLightState | null
  rooms?: RoomGroup[]
  onClose: () => void
  onToggle: (id: string) => void
  onBrightnessChange: (id: string, brightness: number) => void
  onColorTempChange: (id: string, colorTemp: number) => void
  onColorChange: (id: string, color: ColorHS) => void
  onModeChange: (id: string, mode: 'white' | 'colour') => void
  onSetScene?: (id: string, sceneNum: number) => void
  onSetCountdown?: (id: string, seconds: number) => void
  onUpdateMetadata?: (id: string, meta: Partial<DeviceMetadata>) => void
}

const HARDWARE_SCENES = [
  { num: 1, name: 'Night', icon: Moon },
  { num: 2, name: 'Read', icon: Coffee },
  { num: 3, name: 'Working', icon: Briefcase },
  { num: 4, name: 'Leisure', icon: Sparkles },
  { num: 5, name: 'Soft', icon: Flame },
  { num: 6, name: 'Colorful', icon: Palette },
  { num: 7, name: 'Dazzling', icon: Zap },
  { num: 8, name: 'Gorgeous', icon: Sun }
]

const KELVIN_PRESETS = [
  { kelvin: 2000, tempNorm: 0, label: 'Candlelight' },
  { kelvin: 2700, tempNorm: 15, label: 'Warm White' },
  { kelvin: 4000, tempNorm: 44, label: 'Neutral' },
  { kelvin: 5000, tempNorm: 67, label: 'Daylight' },
  { kelvin: 6500, tempNorm: 100, label: 'Cool Sky' }
]

const COUNTDOWN_PRESETS = [
  { label: '15m', seconds: 15 * 60 },
  { label: '30m', seconds: 30 * 60 },
  { label: '45m', seconds: 45 * 60 },
  { label: '60m', seconds: 60 * 60 }
]

/**
 * Lumos Accessory Detail Sheet
 * Apple Home-Grade Accessory Detail Sheet:
 * - Header: Accessory icon, name (inline rename affordance), room label, power toggle GlassButton, close GlassButton
 * - Hero: Large vertical brightness capsule slider (CapsuleSlider.tsx), centered, prominently showing percentage readout
 * - Below hero slider: Apple-style Segmented Control for "Temperature" and "Color" (if color supported)
 * - In Temperature mode: Continuous warm-to-cool Kelvin gradient track (2000K to 6500K) + Kelvin preset swatches
 * - In Color mode: Full spectrum chromatic wheel (ColorWheel.tsx)
 * - Secondary section: Grouped Apple inset style (Hardware Scenes, Room picker, Sleep timer, Hide accessory)
 */
export const LightDetailSheet: React.FC<LightDetailSheetProps> = ({
  isOpen,
  light,
  rooms = [],
  onClose,
  onToggle,
  onBrightnessChange,
  onColorTempChange,
  onColorChange,
  onModeChange,
  onSetScene,
  onSetCountdown,
  onUpdateMetadata
}) => {
  // Local edit states
  const [editingName, setEditingName] = useState(false)
  const [customNameInput, setCustomNameInput] = useState('')
  const [selectedRoom, setSelectedRoom] = useState<string>('')

  useEffect(() => {
    if (light) {
      setCustomNameInput(light.customName || light.name)
      setSelectedRoom(light.room || '')
      setEditingName(false)
    }
  }, [light])

  // Dismiss on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && isOpen) {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  // Calculate live bulb color hex for capsule slider fill & accents
  const activeColorHex = useMemo(() => {
    if (!light) return '#ffd6aa'
    if (light.mode === 'colour' && light.color && typeof light.color.h === 'number') {
      const h = light.color.h
      const s = typeof light.color.s === 'number' ? light.color.s : 100
      const v = typeof light.color.v === 'number' ? light.color.v : 100
      return hsvToRgb(h, s, v).hex
    }
    const ct = typeof light.colorTemp === 'number' ? light.colorTemp : 50
    return cctToRgb(ct).hex
  }, [light?.mode, light?.color?.h, light?.color?.s, light?.color?.v, light?.colorTemp])

  if (!isOpen || !light) return null

  const { id, name, online, power, brightness, colorTemp, mode, color, customName, countdown } = light
  const displayName = customName || name

  // Safe capabilities fallback
  const caps = light.capabilities ?? {
    hasPower: true,
    hasBrightness: true,
    hasColorTemp: true,
    hasColor: Boolean(color),
    hasScenes: true,
    hasCountdown: true
  }

  const handleSaveName = (): void => {
    if (onUpdateMetadata && customNameInput.trim()) {
      onUpdateMetadata(id, { customName: customNameInput.trim() })
    }
    setEditingName(false)
  }

  const handleRoomChange = async (roomName: string): Promise<void> => {
    setSelectedRoom(roomName)
    if (onUpdateMetadata) {
      onUpdateMetadata(id, { room: roomName })
    }

    const api = window.lumos || window.lumen
    if (api?.saveRoom && rooms) {
      for (const r of rooms) {
        const isTarget = r.name === roomName || r.id === roomName
        const contains = r.deviceIds.includes(id)
        if (isTarget && !contains) {
          await api.saveRoom({
            id: r.id,
            name: r.name,
            deviceIds: [...r.deviceIds, id]
          })
        } else if (!isTarget && contains) {
          await api.saveRoom({
            id: r.id,
            name: r.name,
            deviceIds: r.deviceIds.filter((devId) => devId !== id)
          })
        }
      }
    }
  }

  const handleToggleHide = (): void => {
    if (onUpdateMetadata) {
      onUpdateMetadata(id, { hidden: !light.hidden })
    }
  }

  const formatCountdown = (secs?: number): string => {
    if (!secs || secs <= 0) return ''
    const m = Math.floor(secs / 60)
    const s = secs % 60
    return `${m}m ${s > 0 ? `${s}s` : ''}`
  }

  // Room display label
  const roomLabel = light.room || 'Ungrouped'
  const currentKelvin = Math.round(2000 + ((colorTemp || 0) / 100) * (6500 - 2000))

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 select-none">
          {/* Backdrop Scrim */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={springs.snappy}
            onClick={onClose}
            className="absolute inset-0 bg-black/60 backdrop-blur-md"
          />

          {/* Centered Modal Container: Apple Home Detail Card */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 12 }}
            transition={springs.default}
            onClick={(e) => e.stopPropagation()}
            className="relative z-10 w-full max-w-[420px] max-h-[90vh] rounded-[28px] overflow-hidden flex flex-col shadow-2xl shadow-black/80"
          >
            <GlassSurface
              intensity="elevated"
              borderIntensity="bright"
              borderRadius={28}
              glowColor={power ? activeColorHex : undefined}
              glowOpacity={power ? 0.20 : 0}
              className="w-full h-full flex flex-col"
            >
              <div className="w-full h-full max-h-[90vh] flex flex-col p-5 sm:p-6 overflow-hidden">
                {/* Header: Accessory Icon, Name, Room Label, Power Toggle, Close */}
                <div className="flex items-center justify-between pb-3 border-b border-white/[0.08] flex-shrink-0">
                <div className="flex items-center gap-3 min-w-0">
                  {/* Accessory Icon Container */}
                  <div
                    className="w-9 h-9 rounded-full flex-shrink-0 flex items-center justify-center transition-colors shadow-sm"
                    style={{
                      backgroundColor: power ? `${activeColorHex}33` : 'rgba(255,255,255,0.06)',
                      color: power ? activeColorHex : '#71717a'
                    }}
                  >
                    {mode === 'colour' ? <Palette className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
                  </div>

                  {/* Name + Inline Rename + Room Label */}
                  <div className="flex flex-col min-w-0">
                    {editingName ? (
                      <div className="flex items-center gap-1.5">
                        <input
                          type="text"
                          value={customNameInput}
                          onChange={(e) => setCustomNameInput(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && handleSaveName()}
                          className="px-2 py-0.5 rounded-lg bg-zinc-950/80 border border-white/20 text-white text-sm font-semibold tracking-tight focus:outline-none focus:border-amber-400 w-32"
                          autoFocus
                        />
                        <GlassButton
                          variant="standard"
                          size="icon-sm"
                          onClick={handleSaveName}
                          title="Save name"
                        >
                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                        </GlassButton>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5 min-w-0">
                        <h2 className="text-[15px] font-semibold text-white tracking-tight truncate">
                          {displayName}
                        </h2>
                        <GlassButton
                          variant="subtle"
                          size="icon-sm"
                          onClick={() => setEditingName(true)}
                          title="Rename accessory"
                          className="flex-shrink-0"
                        >
                          <Edit3 className="w-3 h-3 text-zinc-400 hover:text-white" />
                        </GlassButton>
                      </div>
                    )}
                    <span className="text-[11px] text-zinc-400 truncate">
                      {roomLabel} · {online ? (power ? `${brightness}%` : 'Off') : offlineLabel(light.connectionIssue)}
                    </span>
                  </div>
                </div>

                {/* Right Header Actions: Power Toggle + Close */}
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <GlassButton
                    variant={power ? 'prominent' : 'standard'}
                    size="sm"
                    onClick={() => onToggle(id)}
                    disabled={!online}
                    title="Toggle power"
                  >
                    <Power className="w-3.5 h-3.5" />
                    <span>{power ? 'On' : 'Off'}</span>
                  </GlassButton>

                  <GlassButton
                    variant="subtle"
                    size="icon-sm"
                    onClick={onClose}
                    title="Close"
                    aria-label="Close"
                  >
                    <X className="w-4 h-4" />
                  </GlassButton>
                </div>
              </div>

              {/* Scrollable Content Container */}
              <div className="flex-1 overflow-y-auto no-scrollbar min-h-0 pt-4 pb-8 flex flex-col gap-5 text-zinc-100">
                {/* Hero: Large Vertical Brightness Capsule Slider (Centered) */}
                <div className="flex flex-col items-center justify-center py-1">
                  <CapsuleSlider
                    value={brightness}
                    onChange={(val) => onBrightnessChange(id, val)}
                    disabled={!online || !power}
                    fillColor={power ? activeColorHex : 'rgb(120, 120, 130)'}
                    height={190}
                    className="w-24 shadow-2xl"
                  />
                </div>

              {/* Apple-style Segmented Control: Temperature vs Color (if bulb supports color) */}
              {caps.hasColor && (
                <div className="relative p-1 rounded-xl bg-white/[0.06] border border-white/[0.08] flex items-center select-none">
                  <button
                    type="button"
                    onClick={() => onModeChange(id, 'white')}
                    disabled={!online || !power}
                    className={`relative z-10 flex-1 h-7 rounded-[8px] flex items-center justify-center gap-1.5 text-xs font-medium transition-colors ${
                      mode === 'white' ? 'text-white' : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    <Thermometer className="w-3.5 h-3.5" />
                    <span>Temperature</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => onModeChange(id, 'colour')}
                    disabled={!online || !power}
                    className={`relative z-10 flex-1 h-7 rounded-[8px] flex items-center justify-center gap-1.5 text-xs font-medium transition-colors ${
                      mode === 'colour' ? 'text-white' : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    <Palette className="w-3.5 h-3.5" />
                    <span>Color</span>
                  </button>

                  {/* Fluid Sliding Pill Background */}
                  <motion.div
                    layoutId="segmented-pill-mode"
                    transition={springs.snappy}
                    className="absolute top-1 bottom-1 rounded-[8px] bg-white/[0.14] border border-white/20 shadow-sm pointer-events-none"
                    style={{
                      left: mode === 'colour' ? '50%' : '4px',
                      right: mode === 'colour' ? '4px' : '50%'
                    }}
                  />
                </div>
              )}

              {/* Mode Controls: Temperature Mode or Color Mode */}
              {mode === 'colour' && caps.hasColor ? (
                <div className="p-3.5 rounded-2xl bg-white/[0.04] border border-white/[0.07]">
                  <ColorWheel
                    color={color}
                    onChange={(c) => onColorChange(id, c)}
                    disabled={!online || !power}
                  />
                </div>
              ) : (
                caps.hasColorTemp && (
                  <div className="flex flex-col gap-3 p-3.5 rounded-2xl bg-white/[0.04] border border-white/[0.07]">
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-1.5 text-zinc-300 font-medium">
                        <Thermometer className="w-3.5 h-3.5 text-amber-400" />
                        <span>Kelvin Spectrum</span>
                      </div>
                      <span className="font-mono text-zinc-400 text-[11px]">
                        {currentKelvin}K
                      </span>
                    </div>

                    {/* Continuous Warm-to-Cool Kelvin Gradient Track (2000K to 6500K) */}
                    <div className="relative h-7 w-full rounded-xl border border-white/10 shadow-inner overflow-hidden">
                      <input
                        type="range"
                        min="0"
                        max="100"
                        value={colorTemp}
                        disabled={!online || !power}
                        onChange={(e) => onColorTempChange(id, Number(e.target.value))}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10 disabled:pointer-events-none"
                      />
                      <div
                        className="w-full h-full"
                        style={{
                          background:
                            'linear-gradient(90deg, #ff9329 0%, #ffd6aa 35%, #fff1e0 60%, #c9e2ff 100%)'
                        }}
                      />
                      <div
                        className="absolute top-0 bottom-0 w-3 rounded-md bg-white border border-black/40 shadow-md pointer-events-none -ml-1.5"
                        style={{ left: `${colorTemp}%` }}
                      />
                    </div>

                    {/* Kelvin Preset Swatches */}
                    <div className="flex flex-wrap gap-2 pt-1">
                      {KELVIN_PRESETS.map((preset) => {
                        const isSelected = Math.abs(colorTemp - preset.tempNorm) < 8
                        return (
                          <GlassButton
                            key={preset.kelvin}
                            variant={isSelected ? 'prominent' : 'standard'}
                            size="sm"
                            className="flex-1 min-w-[96px]"
                            disabled={!online || !power}
                            onClick={() => onColorTempChange(id, preset.tempNorm)}
                          >
                            <span
                              className="w-2.5 h-2.5 rounded-full border border-black/30 mr-1.5 flex-shrink-0"
                              style={{ backgroundColor: cctToRgb(preset.tempNorm).hex }}
                            />
                            <span>{preset.label}</span>
                          </GlassButton>
                        )
                      })}
                    </div>
                  </div>
                )
              )}

              {/* Secondary Section (Apple Inset Grouped Style) */}
              <div className="flex flex-col rounded-2xl bg-white/[0.04] border border-white/[0.08] divide-y divide-white/[0.06] overflow-hidden text-xs">
                {/* Hardware Scenes (if supported) */}
                {caps.hasScenes && onSetScene && (
                  <div className="p-3.5 flex flex-col gap-2.5">
                    <div className="flex items-center gap-1.5 font-medium text-zinc-300">
                      <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                      <span>Hardware Scenes</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {HARDWARE_SCENES.map((scene) => {
                        const IconComp = scene.icon
                        return (
                          <GlassButton
                            key={scene.num}
                            variant={light.scene === scene.num ? 'prominent' : 'standard'}
                            size="sm"
                            disabled={!online || !power}
                            onClick={() => onSetScene(id, scene.num)}
                            className="w-full"
                          >
                            <IconComp className="w-3.5 h-3.5 mr-1.5 text-zinc-300 flex-shrink-0" />
                            <span className="truncate">{scene.name}</span>
                          </GlassButton>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* Room Assignment Row */}
                {rooms.length > 0 && (
                  <div className="p-3.5 flex items-center justify-between">
                    <div className="flex items-center gap-2 text-zinc-300 font-medium">
                      <Layers className="w-3.5 h-3.5 text-zinc-400" />
                      <span>Room</span>
                    </div>
                    <select
                      value={selectedRoom}
                      onChange={(e) => handleRoomChange(e.target.value)}
                      className="bg-zinc-900 border border-white/10 rounded-lg text-xs text-white px-2.5 py-1 focus:outline-none focus:border-amber-400"
                    >
                      <option value="">Ungrouped</option>
                      {rooms.map((r) => (
                        <option key={r.id} value={r.name}>
                          {r.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Hardware Countdown Timer (if supported) */}
                {caps.hasCountdown && onSetCountdown && (
                  <div className="p-3.5 flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-zinc-300 font-medium">
                        <Timer className="w-3.5 h-3.5 text-amber-400" />
                        <span>Sleep Timer</span>
                      </div>
                      {countdown && countdown > 0 && (
                        <span className="font-mono text-amber-300 text-[11px] animate-pulse">
                          {formatCountdown(countdown)}
                        </span>
                      )}
                    </div>
                    <div className="grid grid-cols-4 gap-2">
                      {COUNTDOWN_PRESETS.map((cp) => (
                        <GlassButton
                          key={cp.label}
                          variant="standard"
                          size="sm"
                          disabled={!online || !power}
                          onClick={() => onSetCountdown(id, cp.seconds)}
                          className="w-full"
                        >
                          <span>{cp.label}</span>
                        </GlassButton>
                      ))}
                    </div>
                    {countdown && countdown > 0 && (
                      <GlassButton
                        variant="destructive"
                        size="sm"
                        onClick={() => onSetCountdown(id, 0)}
                        className="w-full mt-1.5"
                      >
                        <span>Cancel Timer</span>
                      </GlassButton>
                    )}
                  </div>
                )}

                {/* Hide Accessory Row */}
                <div className="p-3.5 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-zinc-300 font-medium">
                    <EyeOff className="w-3.5 h-3.5 text-zinc-400" />
                    <span>Visibility</span>
                  </div>
                  <GlassButton
                    variant={light.hidden ? 'prominent' : 'subtle'}
                    size="sm"
                    onClick={handleToggleHide}
                    title={light.hidden ? 'Unhide accessory' : 'Hide accessory'}
                  >
                    <span>{light.hidden ? 'Hidden' : 'Hide Accessory'}</span>
                  </GlassButton>
                </div>
              </div>
            </div>
          </div>
        </GlassSurface>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}

export default LightDetailSheet
