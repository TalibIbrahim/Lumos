import React, { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Upload,
  Sparkles,
  Lightbulb,
  FileCode,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  ExternalLink,
  Loader2,
  Zap,
  ShieldCheck
} from 'lucide-react'
import { GlassSurface } from './ui/GlassSurface'
import { GlassButton } from './ui/GlassButton'
import { LumosLogo } from './ui/LumosLogo'
import { springs } from '../lib/constants'

export interface OnboardingViewProps {
  onComplete: () => void
  onExploreDemo: () => void
}

export const OnboardingView: React.FC<OnboardingViewProps> = ({
  onComplete,
  onExploreDemo
}) => {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [detectedLights, setDetectedLights] = useState<
    Array<{ id: string; name: string; product: string }>
  >([])
  const [isDragOver, setIsDragOver] = useState(false)
  const [jsonText, setJsonText] = useState('')
  const [showPasteMode, setShowPasteMode] = useState(false)

  const handlePickFile = async (): Promise<void> => {
    setError(null)
    setLoading(true)
    try {
      const api = window.lumos || window.lumen
      if (!api) return

      const result = await api.pickAndImportDevicesFile()
      if (result.canceled) {
        setLoading(false)
        return
      }

      if (result.success && result.lights && result.lights.length > 0) {
        setDetectedLights(result.lights)
      } else {
        setError(result.error || 'No compatible lights found in file')
      }
    } catch (err: any) {
      setError(err?.message || 'Error importing file')
    } finally {
      setLoading(false)
    }
  }

  const handleSavePastedJson = async (): Promise<void> => {
    if (!jsonText.trim()) return
    setError(null)
    setLoading(true)
    try {
      const api = window.lumos || window.lumen
      if (!api) return

      const result = await api.saveImportedDevices(jsonText)
      if (result.success) {
        onComplete()
      } else {
        setError(result.error || 'Failed validating JSON structure')
      }
    } catch (err: any) {
      setError(err?.message || 'Invalid JSON format')
    } finally {
      setLoading(false)
    }
  }

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>): Promise<void> => {
    e.preventDefault()
    setIsDragOver(false)
    setError(null)

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0]
      const reader = new FileReader()
      reader.onload = async (event) => {
        const text = String(event.target?.result || '')
        if (text) {
          setLoading(true)
          try {
            const api = window.lumos || window.lumen
            if (api) {
              const res = await api.saveImportedDevices(text)
              if (res.success) {
                onComplete()
              } else {
                setError(res.error || 'No valid smart lights detected in dropped file')
              }
            }
          } catch (err: any) {
            setError(err?.message || 'Failed reading dropped file')
          } finally {
            setLoading(false)
          }
        }
      }
      reader.readAsText(file)
    }
  }

  const handleOpenDocumentation = (): void => {
    const api = window.lumos || window.lumen
    const url = 'https://github.com/TalibIbrahim/Lumos#setup-for-your-own-lights'
    if (api?.openExternalUrl) {
      api.openExternalUrl(url)
    } else {
      window.open(url, '_blank')
    }
  }

  return (
    <div className="flex-1 flex flex-col items-center justify-center min-h-screen px-6 py-12 max-w-4xl mx-auto select-none">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={springs.default}
        className="w-full flex flex-col items-center gap-8"
      >
        {/* Brand Header */}
        <div className="flex flex-col items-center text-center gap-3">
          <div className="relative flex items-center justify-center">
            <LumosLogo size={56} active={true} glow={true} />
          </div>
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white font-sans">
              Welcome to Lumos
            </h1>
            <p className="text-sm text-zinc-400 max-w-md">
              Sub-50ms local control for Tuya smart lights with Apple HomeKit support
            </p>
          </div>
        </div>

        {/* Action Containers */}
        <div className="w-full grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* Card 1: Import Devices */}
          <GlassSurface
            intensity="elevated"
            borderIntensity="bright"
            borderRadius={24}
            className="p-6 flex flex-col justify-between gap-5"
          >
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-white/[0.08] border border-white/[0.1] flex items-center justify-center text-amber-300">
                  <Upload className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-base font-semibold text-white tracking-tight">
                    Import Configuration
                  </h2>
                  <p className="text-xs text-zinc-400">
                    Connect your local hardware via TinyTuya
                  </p>
                </div>
              </div>

              <div
                onDragOver={(e) => {
                  e.preventDefault()
                  setIsDragOver(true)
                }}
                onDragLeave={() => setIsDragOver(false)}
                onDrop={handleDrop}
                className={`mt-2 p-5 rounded-2xl border-2 border-dashed transition-colors flex flex-col items-center justify-center gap-3 text-center ${
                  isDragOver
                    ? 'border-amber-400/80 bg-amber-400/[0.06]'
                    : 'border-white/[0.12] bg-zinc-950/40 hover:border-white/[0.2]'
                }`}
              >
                <FileCode className="w-8 h-8 text-zinc-400" />
                <div className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-zinc-200">
                    Drag and drop your devices.json here
                  </span>
                  <span className="text-[11px] text-zinc-400">
                    Generated via TinyTuya wizard scan
                  </span>
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <GlassButton
                    variant="prominent"
                    size="sm"
                    onClick={handlePickFile}
                    disabled={loading}
                    className="flex items-center gap-2"
                  >
                    {loading ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Upload className="w-3.5 h-3.5" />
                    )}
                    <span>Browse File</span>
                  </GlassButton>
                  <GlassButton
                    variant="subtle"
                    size="sm"
                    onClick={() => setShowPasteMode(!showPasteMode)}
                  >
                    {showPasteMode ? 'Cancel' : 'Paste JSON'}
                  </GlassButton>
                </div>
              </div>

              {/* Paste JSON Mode */}
              <AnimatePresence>
                {showPasteMode && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={springs.snappy}
                    className="flex flex-col gap-2 pt-2"
                  >
                    <textarea
                      value={jsonText}
                      onChange={(e) => setJsonText(e.target.value)}
                      placeholder='Paste [{"id": "...", "key": "...", ...}]'
                      rows={4}
                      className="w-full rounded-xl bg-zinc-950/80 border border-white/10 p-3 text-xs font-mono text-zinc-300 placeholder:text-zinc-600 focus:outline-none focus:border-amber-400/50"
                    />
                    <GlassButton
                      variant="standard"
                      size="sm"
                      onClick={handleSavePastedJson}
                      disabled={loading || !jsonText.trim()}
                      className="self-end"
                    >
                      <span>Validate and Save</span>
                    </GlassButton>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Detected Lights Confirmation */}
              {detectedLights.length > 0 && (
                <div className="p-3.5 rounded-xl bg-emerald-950/30 border border-emerald-500/30 flex flex-col gap-2">
                  <div className="flex items-center gap-2 text-xs font-medium text-emerald-300">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    <span>{detectedLights.length} lights detected and verified!</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto no-scrollbar">
                    {detectedLights.map((l) => (
                      <span
                        key={l.id}
                        className="px-2 py-0.5 rounded-md bg-white/[0.06] text-[11px] font-mono text-zinc-300"
                      >
                        {l.name}
                      </span>
                    ))}
                  </div>
                  <GlassButton
                    variant="prominent"
                    size="sm"
                    onClick={onComplete}
                    className="mt-1 self-end flex items-center gap-1.5"
                  >
                    <span>Launch Lumos</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </GlassButton>
                </div>
              )}

              {/* Error Notice */}
              {error && (
                <div className="p-3 rounded-xl bg-rose-950/30 border border-rose-500/30 flex items-center gap-2 text-xs text-rose-300">
                  <AlertCircle className="w-4 h-4 flex-shrink-0 text-rose-400" />
                  <span>{error}</span>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-white/[0.06] text-[11px] text-zinc-400">
              <span className="flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5 text-zinc-400" />
                Local storage only
              </span>
              <button
                type="button"
                onClick={handleOpenDocumentation}
                className="flex items-center gap-1 text-amber-300 hover:text-amber-200 cursor-pointer transition-colors"
              >
                <span>TinyTuya Setup Guide</span>
                <ExternalLink className="w-3 h-3" />
              </button>
            </div>
          </GlassSurface>

          {/* Card 2: Demo Mode */}
          <GlassSurface
            intensity="elevated"
            borderIntensity="standard"
            borderRadius={24}
            className="p-6 flex flex-col justify-between gap-5"
          >
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-white/[0.08] border border-white/[0.1] flex items-center justify-center text-amber-300">
                  <Sparkles className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-base font-semibold text-white tracking-tight">
                    Explore Demo Mode
                  </h2>
                  <p className="text-xs text-zinc-400">
                    Test Lumos with simulated smart bulbs
                  </p>
                </div>
              </div>

              <div className="p-4 rounded-2xl bg-zinc-950/40 border border-white/[0.06] flex flex-col gap-3">
                <div className="flex items-center gap-2.5 text-xs text-zinc-300">
                  <Lightbulb className="w-4 h-4 text-amber-400 flex-shrink-0" />
                  <span>Pre-configured living room, office, and studio fixtures</span>
                </div>
                <div className="flex items-center gap-2.5 text-xs text-zinc-300">
                  <Zap className="w-4 h-4 text-amber-400 flex-shrink-0" />
                  <span>Experience instant sliders, color wheels, and animations</span>
                </div>
                <div className="flex items-center gap-2.5 text-xs text-zinc-300">
                  <ShieldCheck className="w-4 h-4 text-amber-400 flex-shrink-0" />
                  <span>Zero network requests or device requirements</span>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-3 pt-2">
              <GlassButton
                variant="prominent"
                size="md"
                onClick={onExploreDemo}
                className="w-full flex items-center justify-center gap-2"
              >
                <Sparkles className="w-4 h-4" />
                <span>Explore with Demo Lights</span>
              </GlassButton>
              <p className="text-[11px] text-zinc-400 text-center">
                You can import your real devices at any time from Settings.
              </p>
            </div>
          </GlassSurface>
        </div>
      </motion.div>
    </div>
  )
}

export default OnboardingView
