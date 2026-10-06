import React, { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  PanelLeft,
  MoreHorizontal,
  Zap,
  ZapOff,
  RefreshCw,
  RotateCw,
  Settings,
  Plus
} from 'lucide-react'
import { GlassButton } from './ui/GlassButton'
import { springs } from '../lib/constants'

export interface ToolbarProps {
  title: string
  subtitle: string
  isSidebarCollapsed: boolean
  isCompact: boolean
  onToggleSidebar: () => void
  // Primary Action Button (Add / Edit)
  primaryActionLabel?: string
  primaryActionIcon?: React.ComponentType<{ className?: string }>
  onPrimaryAction?: () => void
  // Power Action Button
  anyActive: boolean
  totalLights: number
  onTogglePower: () => void
  // Overflow Actions
  onScanSubnet: () => void
  onRefresh: () => void
  onOpenSettings: () => void
}

/**
 * Lumos Minimal Window Toolbar
 * - One-row minimal toolbar spanning the content side
 * - Left: Sidebar toggle button (when collapsed/compact), Large page title, status subtitle
 * - Middle: Electron draggable window region (-webkit-app-region: drag)
 * - Right: Action Glass Surface buttons (Add/Edit, Power toggle, Overflow menu)
 */
export const Toolbar: React.FC<ToolbarProps> = ({
  title,
  subtitle,
  isSidebarCollapsed,
  isCompact,
  onToggleSidebar,
  primaryActionLabel = 'Add',
  primaryActionIcon: PrimaryIcon = Plus,
  onPrimaryAction,
  anyActive,
  totalLights,
  onTogglePower,
  onScanSubnet,
  onRefresh,
  onOpenSettings
}) => {
  const [isOverflowOpen, setIsOverflowOpen] = useState(false)
  const overflowRef = useRef<HTMLDivElement>(null)

  // Dismiss overflow popover on outside click or Esc
  useEffect(() => {
    if (!isOverflowOpen) return

    const handlePointerDownOutside = (e: PointerEvent) => {
      if (overflowRef.current && !overflowRef.current.contains(e.target as Node)) {
        setIsOverflowOpen(false)
      }
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOverflowOpen(false)
      }
    }

    window.addEventListener('pointerdown', handlePointerDownOutside)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDownOutside)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOverflowOpen])

  return (
    <header className="relative z-30 w-full h-16 px-6 sm:px-8 flex items-center justify-between select-none">
      {/* Left Wing: Collapse Toggle + Large Title + Status Subtitle */}
      <div
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        className="flex items-center gap-3.5 flex-shrink-0"
      >
        {(isSidebarCollapsed || isCompact) && (
          <GlassButton
            variant="subtle"
            size="icon-sm"
            onClick={onToggleSidebar}
            title="Expand sidebar"
            aria-label="Expand sidebar"
          >
            <PanelLeft className="w-4 h-4 text-zinc-300" />
          </GlassButton>
        )}

        <div className="flex flex-col justify-center">
          <h1 className="text-[22px] sm:text-[24px] font-bold text-white tracking-[-0.025em] leading-tight">
            {title}
          </h1>
          <p className="text-[12px] font-normal text-zinc-400 tracking-[0.010em] leading-tight">
            {subtitle}
          </p>
        </div>
      </div>

      {/* Middle Drag Region */}
      <div
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
        className="flex-1 h-full min-w-8 cursor-move"
        aria-hidden="true"
      />

      {/* Right Wing: At Most THREE Glass Surface Buttons */}
      <div
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        className="flex items-center gap-2 flex-shrink-0"
      >
        {/* 1. Add / Edit Action Button */}
        {onPrimaryAction && (
          <GlassButton
            variant="prominent"
            size="sm"
            onClick={onPrimaryAction}
            title={primaryActionLabel}
          >
            <PrimaryIcon className="w-3.5 h-3.5" />
            <span className="hidden sm:inline font-medium">{primaryActionLabel}</span>
          </GlassButton>
        )}

        {/* 2. Power Toggle Button */}
        <GlassButton
          variant={anyActive ? 'prominent' : 'standard'}
          size="sm"
          onClick={onTogglePower}
          disabled={totalLights === 0}
          title={anyActive ? 'Turn off all fixtures in view' : 'Turn on all fixtures in view'}
        >
          {anyActive ? (
            <>
              <ZapOff className="w-3.5 h-3.5 text-amber-300" />
              <span className="hidden sm:inline font-medium">All Off</span>
            </>
          ) : (
            <>
              <Zap className="w-3.5 h-3.5 text-zinc-400" />
              <span className="hidden sm:inline font-medium">All On</span>
            </>
          )}
        </GlassButton>

        {/* 3. Overflow Button with Minimal Popover */}
        <div ref={overflowRef} className="relative">
          <GlassButton
            variant="subtle"
            size="icon-sm"
            onClick={() => setIsOverflowOpen((prev) => !prev)}
            title="More actions"
            aria-label="More actions"
            active={isOverflowOpen}
          >
            <MoreHorizontal className="w-4 h-4 text-zinc-300" />
          </GlassButton>

          {/* Minimal Popover (Max 3-4 items, NO nested submenus) */}
          <AnimatePresence>
            {isOverflowOpen && (
              <motion.div
                initial={{ opacity: 0, scale: 0.94, y: 6 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.94, y: 4 }}
                transition={springs.snappy}
                className="absolute right-0 top-full mt-2 w-48 rounded-xl bg-[#141418]/95 backdrop-blur-[24px] border border-white/[0.12] shadow-2xl shadow-black/80 p-1 flex flex-col gap-0.5 z-50 select-none"
              >
                <button
                  type="button"
                  onClick={() => {
                    setIsOverflowOpen(false)
                    onScanSubnet()
                  }}
                  className="w-full h-8 px-2.5 rounded-lg flex items-center gap-2.5 text-[13px] font-medium text-zinc-300 hover:text-white hover:bg-white/[0.08] transition-colors text-left outline-none"
                >
                  <RefreshCw className="w-3.5 h-3.5 text-zinc-400" />
                  <span>Scan Subnet</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setIsOverflowOpen(false)
                    onRefresh()
                  }}
                  className="w-full h-8 px-2.5 rounded-lg flex items-center gap-2.5 text-[13px] font-medium text-zinc-300 hover:text-white hover:bg-white/[0.08] transition-colors text-left outline-none"
                >
                  <RotateCw className="w-3.5 h-3.5 text-zinc-400" />
                  <span>Refresh Status</span>
                </button>

                <div className="h-px bg-white/[0.06] my-0.5" />

                <button
                  type="button"
                  onClick={() => {
                    setIsOverflowOpen(false)
                    onOpenSettings()
                  }}
                  className="w-full h-8 px-2.5 rounded-lg flex items-center gap-2.5 text-[13px] font-medium text-zinc-300 hover:text-white hover:bg-white/[0.08] transition-colors text-left outline-none"
                >
                  <Settings className="w-3.5 h-3.5 text-zinc-400" />
                  <span>Settings</span>
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </header>
  )
}

export default Toolbar
