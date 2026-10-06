import React from 'react'
import {
  BookOpen,
  Coffee,
  Target,
  Moon,
  Sparkles,
  LucideIcon
} from 'lucide-react'
import { GlassButton } from './ui/GlassButton'
import { Preset } from '../types'

const ICON_MAP: Record<string, LucideIcon> = {
  BookOpen,
  Coffee,
  Target,
  Moon,
  Sparkles
}

interface PresetsBarProps {
  presets: Preset[]
  onApplyPreset: (presetId: string) => void
  disabled?: boolean
}

export const PresetsBar: React.FC<PresetsBarProps> = ({
  presets,
  onApplyPreset,
  disabled = false
}) => {
  return (
    <div className="w-full flex items-center gap-2.5 overflow-x-auto pb-1 select-none no-scrollbar">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-400 tracking-wider uppercase pr-1 pl-0.5">
        <Sparkles className="w-3.5 h-3.5 text-amber-400" />
        <span>Scenes</span>
      </div>

      {presets.map((preset) => {
        const IconComponent = (preset.icon && ICON_MAP[preset.icon]) || Sparkles
        return (
          <GlassButton
            key={preset.id}
            variant="standard"
            size="sm"
            disabled={disabled}
            onClick={() => onApplyPreset(preset.id)}
            className="flex-shrink-0 px-3 py-1.5 rounded-full border border-white/[0.08] hover:border-white/20 text-xs text-zinc-200 hover:text-white"
          >
            <IconComponent className="w-3.5 h-3.5 text-zinc-300" />
            <span className="font-medium">{preset.name}</span>
          </GlassButton>
        )
      })}
    </div>
  )
}
export default PresetsBar
