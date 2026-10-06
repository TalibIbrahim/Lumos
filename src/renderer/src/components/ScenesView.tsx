import React, { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Sparkles,
  BookOpen,
  Coffee,
  Target,
  Moon,
  Sun,
  Flame,
  Palette,
  Zap,
  Tv,
  Laptop,
  Music,
  Heart,
  Plus,
  Trash2,
  Check,
  X,
  LucideIcon,
  ChevronRight,
  ChevronLeft
} from 'lucide-react'
import { GlassSurface } from './ui/GlassSurface'
import { GlassButton } from './ui/GlassButton'
import { Preset } from '../types'
import { springs, getKelvinColor } from '../lib/constants'

export interface ScenesViewProps {
  scenes: Preset[]
  onApplyScene: (sceneId: string) => void
  onSaveScene: (scene: Preset) => void
  onDeleteScene: (sceneId: string) => void
  isCreateOpen?: boolean
  onCloseCreate?: () => void
  onOpenCreate?: () => void
  onDeleteSceneWithUndo?: (scene: Preset) => void
}

const SCENE_ICONS: Record<string, LucideIcon> = {
  Sparkles,
  BookOpen,
  Coffee,
  Target,
  Moon,
  Sun,
  Flame,
  Palette,
  Zap,
  Tv,
  Laptop,
  Music,
  Heart
}

const AVAILABLE_ICON_KEYS = Object.keys(SCENE_ICONS)

/**
 * Lumos Apple Home-Style Scenes View
 * Displays high-tactile scene cards with halo backlights, tap to execute,
 * stepped creation sheet, and calm empty state.
 */
export const ScenesView: React.FC<ScenesViewProps> = ({
  scenes,
  onApplyScene,
  onSaveScene,
  onDeleteScene,
  isCreateOpen = false,
  onCloseCreate,
  onOpenCreate,
  onDeleteSceneWithUndo
}) => {
  const [internalCreate, setInternalCreate] = useState(false)
  const isCreating = isCreateOpen || internalCreate

  const handleCloseCreation = () => {
    setInternalCreate(false)
    setCreationStep(1)
    onCloseCreate?.()
  }

  // Active scene execution feedback
  const [lastAppliedId, setLastAppliedId] = useState<string | null>(null)

  // Stepped Creation Form State
  const [creationStep, setCreationStep] = useState<1 | 2>(1)
  const [name, setName] = useState('')
  const [selectedIcon, setSelectedIcon] = useState('Sparkles')
  const [brightness, setBrightness] = useState(80)
  const [colorTemp, setColorTemp] = useState(30) // 0-100 normalized
  const [mode, setMode] = useState<'white' | 'colour'>('white')

  const handleApply = (id: string) => {
    setLastAppliedId(id)
    onApplyScene(id)
    setTimeout(() => {
      setLastAppliedId((prev) => (prev === id ? null : prev))
    }, 1400)
  }

  const handleDelete = (scene: Preset) => {
    if (onDeleteSceneWithUndo) {
      onDeleteSceneWithUndo(scene)
    } else {
      onDeleteScene(scene.id)
    }
  }

  const handleSubmitCreate = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return

    const newScene: Preset = {
      id: 'scene-' + Date.now(),
      name: trimmed,
      icon: selectedIcon,
      brightness,
      colorTemp,
      mode
    }

    onSaveScene(newScene)
    setName('')
    setCreationStep(1)
    handleCloseCreation()
  }

  return (
    <div className="flex flex-col gap-6 w-full select-none max-w-5xl mx-auto pb-12">
      {/* Calm Apple Home Empty State */}
      {scenes.length === 0 ? (
        <div className="py-20 flex flex-col items-center justify-center text-center gap-3">
          <div className="w-14 h-14 rounded-2xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center text-zinc-500">
            <Sparkles className="w-6 h-6" />
          </div>
          <div className="flex flex-col gap-1 max-w-sm">
            <h3 className="text-base font-semibold text-white tracking-tight">
              No Scenes Created
            </h3>
            <p className="text-xs text-zinc-400">
              Scenes allow you to configure multiple lights to an ideal atmosphere with a single tap.
            </p>
          </div>
          <div className="pt-2">
            <GlassButton
              variant="prominent"
              size="md"
              onClick={() => {
                if (onOpenCreate) onOpenCreate()
                else setInternalCreate(true)
              }}
            >
              <Plus className="w-3.5 h-3.5 mr-1" />
              <span>Create Scene</span>
            </GlassButton>
          </div>
        </div>
      ) : (
        /* High-Tactile Scene Card Grid */
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {scenes.map((scene) => {
            const IconComp = SCENE_ICONS[scene.icon || ''] || Sparkles
            const isJustApplied = lastAppliedId === scene.id
            const kelvin = getKelvinColor(scene.colorTemp)

            return (
              <motion.div
                key={scene.id}
                whileTap={{ scale: 0.97 }}
                whileHover={{ y: -1 }}
                transition={springs.cardHover}
                className="group relative h-[100px] rounded-[18px] cursor-pointer"
                onClick={() => handleApply(scene.id)}
              >
                <div
                  className={`relative h-full p-3.5 rounded-[18px] border transition-all duration-300 flex flex-col justify-between overflow-hidden ${
                    isJustApplied
                      ? 'border-amber-400/60 bg-white/[0.14] shadow-lg shadow-amber-500/20'
                      : 'border-white/[0.08] bg-zinc-950/40 hover:bg-zinc-900/60 hover:border-white/[0.16] backdrop-blur-md'
                  }`}
                >
                  {/* Diffuse color halo backlight */}
                  <div
                    aria-hidden="true"
                    className="absolute inset-0 pointer-events-none opacity-20 group-hover:opacity-35 transition-opacity"
                    style={{
                      background: `radial-gradient(circle at 85% 15%, ${kelvin.hex}, transparent 70%)`
                    }}
                  />

                  {/* Top Row: Tactical Icon + Hover Delete */}
                  <div className="relative z-10 flex items-center justify-between">
                    <div
                      className={`w-8.5 h-8.5 rounded-full flex items-center justify-center transition-all ${
                        isJustApplied
                          ? 'bg-amber-400 text-zinc-950 shadow-md shadow-amber-400/40'
                          : 'bg-white/[0.08] text-white border border-white/[0.08]'
                      }`}
                    >
                      {isJustApplied ? (
                        <Check className="w-4 h-4 stroke-[3]" />
                      ) : (
                        <IconComp className="w-4 h-4" />
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleDelete(scene)
                      }}
                      title="Delete Scene"
                      aria-label={`Delete ${scene.name}`}
                      className="opacity-0 group-hover:opacity-100 w-7 h-7 rounded-lg flex items-center justify-center text-zinc-400 hover:text-rose-300 hover:bg-rose-500/20 transition-all"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Bottom Row: Name + Atmosphere Summary */}
                  <div className="relative z-10">
                    <h3 className="text-[14px] font-semibold text-white tracking-tight leading-tight truncate">
                      {scene.name}
                    </h3>
                    <p className="text-[11px] text-zinc-400 font-normal leading-tight pt-0.5">
                      {scene.brightness}% · {scene.mode === 'colour' ? 'Color' : `${Math.round(2000 + (scene.colorTemp / 100) * 4500)}K`}
                    </p>
                  </div>
                </div>
              </motion.div>
            )
          })}
        </div>
      )}

      {/* Stepped Creation Sheet */}
      <AnimatePresence>
        {isCreating && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={handleCloseCreation}
              className="fixed inset-0 bg-black/65 backdrop-blur-md"
            />

            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 12 }}
              transition={springs.default}
              onClick={(e) => e.stopPropagation()}
              className="relative z-10 w-full max-w-md rounded-[24px] overflow-hidden shadow-2xl shadow-black/80"
            >
              <GlassSurface intensity="elevated" className="p-6 flex flex-col gap-5">
                {/* Header with Step Indicator */}
                <div className="flex items-center justify-between pb-3 border-b border-white/[0.08]">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-xl bg-amber-400/10 border border-amber-400/20 flex items-center justify-center text-amber-300">
                      <Sparkles className="w-4 h-4" />
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-white tracking-tight">
                        {creationStep === 1 ? 'New Scene: Details' : 'New Scene: Lighting Atmosphere'}
                      </h3>
                      <p className="text-[11px] text-zinc-400">
                        Step {creationStep} of 2
                      </p>
                    </div>
                  </div>
                  <GlassButton
                    variant="subtle"
                    size="icon-sm"
                    onClick={handleCloseCreation}
                  >
                    <X className="w-3.5 h-3.5" />
                  </GlassButton>
                </div>

                <form onSubmit={handleSubmitCreate} className="flex flex-col gap-4">
                  {/* STEP 1: Name and Icon Selection */}
                  {creationStep === 1 && (
                    <div className="flex flex-col gap-4">
                      {/* Name Input */}
                      <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-medium text-white">Scene Name</label>
                        <input
                          type="text"
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          placeholder="e.g. Warm Reading, Focus, Relax"
                          autoFocus
                          className="w-full bg-zinc-900 border border-white/10 rounded-xl px-3.5 py-2 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-amber-400 transition-colors"
                        />
                      </div>

                      {/* Icon Grid */}
                      <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-medium text-white">Accessory Icon</label>
                        <div className="grid grid-cols-7 gap-1.5 p-2 rounded-xl bg-zinc-950/60 border border-white/[0.06]">
                          {AVAILABLE_ICON_KEYS.map((key) => {
                            const Icon = SCENE_ICONS[key]
                            const isSel = selectedIcon === key
                            return (
                              <button
                                type="button"
                                key={key}
                                onClick={() => setSelectedIcon(key)}
                                className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all ${
                                  isSel
                                    ? 'bg-amber-400 text-zinc-950 shadow-sm'
                                    : 'text-zinc-400 hover:text-white hover:bg-white/[0.08]'
                                }`}
                              >
                                <Icon className="w-4 h-4" />
                              </button>
                            )
                          })}
                        </div>
                      </div>

                      {/* Step 1 Actions */}
                      <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/[0.06]">
                        <GlassButton
                          variant="subtle"
                          size="sm"
                          type="button"
                          onClick={handleCloseCreation}
                        >
                          <span>Cancel</span>
                        </GlassButton>
                        <GlassButton
                          variant="prominent"
                          size="sm"
                          type="button"
                          disabled={!name.trim()}
                          onClick={() => setCreationStep(2)}
                        >
                          <span>Next</span>
                          <ChevronRight className="w-3.5 h-3.5 ml-1" />
                        </GlassButton>
                      </div>
                    </div>
                  )}

                  {/* STEP 2: Brightness and Kelvin Atmosphere */}
                  {creationStep === 2 && (
                    <div className="flex flex-col gap-4">
                      {/* Brightness Slider */}
                      <div className="flex flex-col gap-1.5">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-medium text-white">Brightness Level</span>
                          <span className="font-mono text-amber-300">{brightness}%</span>
                        </div>
                        <input
                          type="range"
                          min={5}
                          max={100}
                          value={brightness}
                          onChange={(e) => setBrightness(Number(e.target.value))}
                          className="w-full accent-amber-400 h-1.5 bg-white/10 rounded-lg cursor-pointer"
                        />
                      </div>

                      {/* Color Temperature Track */}
                      <div className="flex flex-col gap-1.5">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-medium text-white">Color Temperature</span>
                          <span className="font-mono text-zinc-400 text-[11px]">
                            {Math.round(2000 + (colorTemp / 100) * 4500)}K
                          </span>
                        </div>
                        <div className="relative h-6 w-full rounded-xl border border-white/10 overflow-hidden">
                          <input
                            type="range"
                            min={0}
                            max={100}
                            value={colorTemp}
                            onChange={(e) => {
                              setColorTemp(Number(e.target.value))
                              setMode('white')
                            }}
                            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                          />
                          <div
                            className="w-full h-full"
                            style={{
                              background:
                                'linear-gradient(90deg, #ff9329 0%, #ffd6aa 35%, #fff1e0 60%, #c9e2ff 100%)'
                            }}
                          />
                          <div
                            className="absolute top-0 bottom-0 w-3 rounded-md bg-white border border-black/40 pointer-events-none -ml-1.5"
                            style={{ left: `${colorTemp}%` }}
                          />
                        </div>
                      </div>

                      {/* Step 2 Actions */}
                      <div className="flex items-center justify-between pt-2 border-t border-white/[0.06]">
                        <GlassButton
                          variant="subtle"
                          size="sm"
                          type="button"
                          onClick={() => setCreationStep(1)}
                        >
                          <ChevronLeft className="w-3.5 h-3.5 mr-1" />
                          <span>Back</span>
                        </GlassButton>
                        <div className="flex items-center gap-2">
                          <GlassButton
                            variant="subtle"
                            size="sm"
                            type="button"
                            onClick={handleCloseCreation}
                          >
                            <span>Cancel</span>
                          </GlassButton>
                          <GlassButton
                            variant="prominent"
                            size="sm"
                            type="submit"
                          >
                            <Check className="w-3.5 h-3.5 mr-1" />
                            <span>Save Scene</span>
                          </GlassButton>
                        </div>
                      </div>
                    </div>
                  )}
                </form>
              </GlassSurface>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  )
}

export default ScenesView
