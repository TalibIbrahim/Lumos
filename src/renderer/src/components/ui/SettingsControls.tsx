import React, { useEffect, useId } from 'react'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import { Check, X, LucideIcon } from 'lucide-react'
import { GlassSurface } from './GlassSurface'
import { GlassButton } from './GlassButton'
import { springs } from '../../lib/constants'
import { hsvToRgb } from '../../lib/color'
import { NormalizedLightState, EffectStatusName } from '../../types'

/**
 * Shared controls for the Effects and Energy pages. They follow the inset
 * grouped list style of the Settings sheet and use the Glass Surface and
 * Glass Button components as they are.
 */

export interface GlassSheetProps {
  isOpen: boolean
  onClose: () => void
  title: string
  subtitle?: string
  icon: LucideIcon
  children: React.ReactNode
}

/** A centred modal sheet with the same chrome as the Settings sheet. */
export const GlassSheet: React.FC<GlassSheetProps> = ({ isOpen, onClose, title, subtitle, icon: Icon, children }) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && isOpen) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, onClose])

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 select-none">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={springs.snappy}
            onClick={onClose}
            className="fixed inset-0 bg-black/65 backdrop-blur-md"
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={title}
            initial={{ opacity: 0, scale: 0.96, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 12 }}
            transition={springs.default}
            onClick={(e) => e.stopPropagation()}
            className="relative z-10 w-full max-w-xl max-h-[88vh] rounded-3xl overflow-hidden flex flex-col shadow-2xl shadow-black/80"
          >
            <GlassSurface intensity="elevated" borderIntensity="bright" borderRadius={28} className="w-full h-full flex flex-col">
              <div className="w-full h-full max-h-[88vh] flex flex-col p-6 overflow-hidden">
                <div className="flex items-center justify-between pb-4 border-b border-white/[0.08] flex-shrink-0">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-xl bg-white/[0.08] border border-white/[0.1] flex items-center justify-center text-amber-300 shadow-inner flex-shrink-0">
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <h2 className="text-base font-semibold text-white tracking-tight truncate">{title}</h2>
                      {subtitle && <p className="text-xs text-zinc-400 truncate">{subtitle}</p>}
                    </div>
                  </div>
                  <GlassButton variant="subtle" size="icon-sm" onClick={onClose} title="Close" aria-label="Close">
                    <X className="w-3.5 h-3.5" />
                  </GlassButton>
                </div>
                <div className="flex-1 overflow-y-auto no-scrollbar min-h-0 pt-4 pb-8 flex flex-col gap-6">{children}</div>
              </div>
            </GlassSurface>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}

/** A titled group of rows. */
export const Group: React.FC<{ title: string; footer?: React.ReactNode; children: React.ReactNode }> = ({
  title,
  footer,
  children
}) => (
  <div className="flex flex-col gap-2">
    <span className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider px-1">{title}</span>
    <div className="flex flex-col rounded-2xl bg-white/[0.04] border border-white/[0.07] divide-y divide-white/[0.06] overflow-hidden">
      {children}
    </div>
    {footer && <div className="text-[11px] text-zinc-500 leading-relaxed px-1">{footer}</div>}
  </div>
)

/** One row: a label on the left and a control on the right, or a control below. */
export const Row: React.FC<{
  label: string
  hint?: string
  children?: React.ReactNode
  stacked?: boolean
}> = ({ label, hint, children, stacked }) => (
  <div className={`px-4 py-3 flex ${stacked ? 'flex-col gap-2.5' : 'items-center justify-between gap-4'} min-h-12`}>
    <div className="flex flex-col min-w-0">
      <span className="text-xs font-medium text-white">{label}</span>
      {hint && <span className="text-[11px] text-zinc-500 leading-snug">{hint}</span>}
    </div>
    {children}
  </div>
)

/** On and off toggle in the style of the Settings sheet. */
export const ToggleButton: React.FC<{
  on: boolean
  onChange: (on: boolean) => void
  disabled?: boolean
  labels?: [string, string]
  ariaLabel?: string
}> = ({ on, onChange, disabled, labels = ['On', 'Off'], ariaLabel }) => (
  <GlassButton
    variant={on ? 'prominent' : 'standard'}
    size="sm"
    disabled={disabled}
    role="switch"
    aria-checked={on}
    aria-label={ariaLabel}
    onClick={(e) => {
      e.stopPropagation()
      onChange(!on)
    }}
    className="text-xs flex-shrink-0"
  >
    <Check className={`w-3.5 h-3.5 ${on ? 'opacity-100' : 'opacity-0'}`} />
    <span>{on ? labels[0] : labels[1]}</span>
  </GlassButton>
)

/** Horizontal slider with its value shown alongside. */
export const RangeControl: React.FC<{
  value: number
  min: number
  max: number
  step?: number
  onChange: (v: number) => void
  onCommit?: (v: number) => void
  format?: (v: number) => string
  ariaLabel: string
  fill?: string
  disabled?: boolean
}> = ({ value, min, max, step = 1, onChange, onCommit, format, ariaLabel, fill, disabled }) => {
  const pct = ((value - min) / (max - min)) * 100
  return (
    <div className="flex items-center gap-3 w-full">
      <input
        type="range"
        className="lumos-range flex-1"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-label={ariaLabel}
        style={{ ['--range-pct' as string]: `${pct}%`, ...(fill ? { ['--range-fill' as string]: fill } : {}) }}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={(e) => onCommit?.(Number((e.target as HTMLInputElement).value))}
        onKeyUp={(e) => onCommit?.(Number((e.target as HTMLInputElement).value))}
      />
      <span className="text-xs font-mono text-zinc-300 w-14 text-right flex-shrink-0">{format ? format(value) : value}</span>
    </div>
  )
}

/** A row of mutually exclusive choices. */
export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  ariaLabel
}: {
  value: T
  options: Array<{ value: T; label: string }>
  onChange: (v: T) => void
  ariaLabel: string
}): React.ReactElement {
  const pillId = useId()
  const reduceMotion = useReducedMotion()
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="flex items-center h-9 p-[3px] rounded-[10px] bg-white/[0.06] flex-shrink-0">
      {options.map((o) => {
        const selected = o.value === value
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(o.value)}
            className={`relative h-[30px] min-w-9 px-3 rounded-lg text-xs font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-white/80 ${
              selected ? 'text-white' : 'text-zinc-400 hover:text-zinc-100'
            }`}
          >
            {selected && (
              <motion.span
                layoutId={reduceMotion ? undefined : `segmented-pill-${pillId}`}
                transition={{ type: 'spring', stiffness: 500, damping: 40, mass: 0.7 }}
                className="absolute inset-0 rounded-lg bg-white/[0.14] border-t border-white/20"
              />
            )}
            <span className="relative">{o.label}</span>
          </button>
        )
      })}
    </div>
  )
}

export const COLOR_CHOICES: Array<{ name: string; h: number; s: number }> = [
  { name: 'Red', h: 0, s: 100 },
  { name: 'Orange', h: 25, s: 100 },
  { name: 'Amber', h: 42, s: 100 },
  { name: 'Yellow', h: 58, s: 100 },
  { name: 'Green', h: 130, s: 100 },
  { name: 'Teal', h: 170, s: 90 },
  { name: 'Sky', h: 200, s: 95 },
  { name: 'Blue', h: 230, s: 100 },
  { name: 'Purple', h: 275, s: 90 },
  { name: 'Pink', h: 320, s: 85 }
]

export const swatchCss = (h: number, s: number): string => hsvToRgb(h, s, 100).hex

/** Colour choice as a row of swatches with plain names. */
export const ColorSwatches: React.FC<{
  value: { h: number; s: number }
  onChange: (c: { h: number; s: number }) => void
  ariaLabel: string
}> = ({ value, onChange, ariaLabel }) => {
  const closest = COLOR_CHOICES.reduce((best, c) => {
    const d = Math.min(Math.abs(c.h - value.h), 360 - Math.abs(c.h - value.h))
    const bd = Math.min(Math.abs(best.h - value.h), 360 - Math.abs(best.h - value.h))
    return d < bd ? c : best
  }, COLOR_CHOICES[0])
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="flex flex-wrap -mx-1.5">
      {COLOR_CHOICES.map((c) => {
        const selected = c.name === closest.name
        return (
          <button
            key={c.name}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={c.name}
            title={c.name}
            onClick={() => onChange({ h: c.h, s: c.s })}
            className="group w-9 h-9 flex items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-white/80"
          >
            <span
              className={`w-6 h-6 rounded-full border transition-transform ${
                selected ? 'border-white scale-110' : 'border-white/20 group-hover:scale-105'
              }`}
              style={{ background: swatchCss(c.h, c.s) }}
            />
          </button>
        )
      })}
    </div>
  )
}

/** Choose all lights or a specific set. */
export const LightPicker: React.FC<{
  lights: NormalizedLightState[]
  value: 'all' | string[]
  onChange: (v: 'all' | string[]) => void
}> = ({ lights, value, onChange }) => {
  const all = value === 'all'
  const selected = new Set(all ? lights.map((l) => l.id) : value)
  return (
    <div className="flex flex-col gap-2.5 w-full">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[11px] text-zinc-400">{all ? 'Every light, including ones added later' : `${selected.size} of ${lights.length} lights`}</span>
        <Segmented
          ariaLabel="Which lights"
          value={all ? 'all' : 'some'}
          options={[
            { value: 'all', label: 'All lights' },
            { value: 'some', label: 'Choose' }
          ]}
          onChange={(v) => onChange(v === 'all' ? 'all' : lights.map((l) => l.id))}
        />
      </div>
      {!all && (
        <div className="flex flex-wrap gap-1.5">
          {lights.map((l) => {
            const on = selected.has(l.id)
            return (
              <button
                key={l.id}
                type="button"
                role="checkbox"
                aria-checked={on}
                onClick={() => {
                  const next = new Set(selected)
                  if (on) next.delete(l.id)
                  else next.add(l.id)
                  onChange(lights.filter((x) => next.has(x.id)).map((x) => x.id))
                }}
                className={`h-9 px-3.5 rounded-full text-xs font-medium border transition-colors outline-none focus-visible:ring-2 focus-visible:ring-white/80 ${
                  on ? 'bg-amber-400/15 border-amber-400/40 text-amber-200' : 'bg-white/[0.03] border-white/[0.08] text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {l.customName || l.name}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

const STATUS_STYLE: Record<EffectStatusName, { label: string; cls: string; dot: string }> = {
  off: { label: 'Off', cls: 'bg-white/[0.05] text-zinc-400 border-white/[0.08]', dot: 'bg-zinc-500' },
  waiting: { label: 'Waiting', cls: 'bg-sky-500/10 text-sky-300 border-sky-400/20', dot: 'bg-sky-400' },
  active: { label: 'Active', cls: 'bg-emerald-500/10 text-emerald-300 border-emerald-400/25', dot: 'bg-emerald-400' },
  error: { label: 'Needs attention', cls: 'bg-rose-500/10 text-rose-300 border-rose-400/25', dot: 'bg-rose-400' }
}

export const StatusPill: React.FC<{ status: EffectStatusName; label?: string }> = ({ status, label }) => {
  const s = STATUS_STYLE[status]
  return (
    <span aria-live="polite" className={`inline-flex items-center gap-1.5 h-5 px-2 rounded-full border text-[10px] font-medium ${s.cls}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot} ${status === 'active' ? 'animate-pulse' : ''}`} />
      {label ?? s.label}
    </span>
  )
}

/** Short note shown in settings for effects that flash or pulse. */
export const PhotosensitivityNote: React.FC = () => (
  <p className="text-[11px] text-zinc-400 leading-relaxed rounded-xl bg-white/[0.03] border border-white/[0.06] px-3 py-2.5">
    Light that changes quickly can affect people with photosensitive epilepsy. Lumos never flashes more than three times
    per second, and you can lower that limit or turn on Reduce intensity in Effect safety. Turn the effect off if anyone
    feels unwell.
  </p>
)
