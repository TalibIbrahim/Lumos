import React from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Home,
  Layers,
  Sparkles,
  Clock,
  WandSparkles,
  Gauge,
  Settings,
  Plus,
  PanelLeftClose
} from 'lucide-react'
import { TrafficLights } from './ui/TrafficLights'
import { LumosLogo } from './ui/LumosLogo'
import { RoomGroup, NormalizedLightState } from '../types'
import { springs } from '../lib/constants'

export interface SidebarProps {
  currentView: string // 'home' | 'scenes' | 'automations' | roomId
  rooms: RoomGroup[]
  lights: NormalizedLightState[]
  sceneCount: number
  activeAutomationCount: number
  activeEffectCount: number
  onSelectView: (viewId: string) => void
  onAddRoom: () => void
  onOpenSettings: () => void
  isCollapsed: boolean
  isCompact: boolean
  onToggleCollapse: () => void
}

/**
 * Lumos Navigation Sidebar
 * 240px pinned translucent pane:
 * - Layer 1: Window Sidebar (surface-sidebar: rgba(14, 14, 18, 0.72) with 24px backdrop blur)
 * - Brand Lockup: TrafficLights, Lumos aperture mark, Outfit wordmark
 * - Navigation: Home, dynamic user Rooms with Add affordance, Scenes, Automations, Effects, Energy
 * - Bottom Pinned: Settings
 * - Responsive collapse behavior below 880px with accessible overlay scrim
 */
export const Sidebar: React.FC<SidebarProps> = ({
  currentView,
  rooms,
  lights,
  sceneCount,
  activeAutomationCount,
  activeEffectCount,
  onSelectView,
  onAddRoom,
  onOpenSettings,
  isCollapsed,
  isCompact,
  onToggleCollapse
}) => {
  // Aggregate light telemetry
  const totalActiveLights = lights.filter((l) => !l.hidden && l.online && l.power).length
  const anyLightsActive = totalActiveLights > 0

  // Count active lights per room
  const getRoomActiveCount = (room: RoomGroup): number => {
    return lights.filter(
      (l) =>
        !l.hidden &&
        l.online &&
        l.power &&
        (room.deviceIds.includes(l.id) || l.room === room.name || l.room === room.id)
    ).length
  }

  const sidebarContent = (
    <div className="w-[240px] h-full flex flex-col bg-[#0e0e12]/80 backdrop-blur-[24px] border-r border-white/[0.08] text-zinc-300 select-none">
      {/* Top Header Chrome: Traffic Lights + Brand Lockup */}
      <div className="pt-3.5 pb-3 px-4 flex items-center justify-between border-b border-white/[0.06]">
        <div className="flex items-center gap-3">
          <TrafficLights />
          <div className="h-4 w-px bg-white/10 mx-0.5" />
          <div
            style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
            className="flex items-center gap-2 cursor-move"
          >
            <div className="w-5.5 h-5.5 flex items-center justify-center">
              <LumosLogo size={20} active={anyLightsActive} glow={anyLightsActive} />
            </div>
            <span className="font-brand text-[15px] font-semibold text-white tracking-[-0.018em] leading-none">
              Lumos
            </span>
          </div>
        </div>

        {/* Compact mode close button */}
        {isCompact && (
          <button
            onClick={onToggleCollapse}
            title="Collapse sidebar"
            aria-label="Collapse sidebar"
            className="w-7 h-7 rounded-lg flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/[0.06] transition-colors"
          >
            <PanelLeftClose className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Navigation Scroll Area */}
      <div className="flex-1 overflow-y-auto px-2.5 py-3 flex flex-col gap-1 no-scrollbar">
        {/* Main: Home */}
        <button
          type="button"
          onClick={() => {
            onSelectView('home')
            if (isCompact) onToggleCollapse()
          }}
          className={`group w-full h-9 px-3 rounded-[10px] flex items-center justify-between transition-colors outline-none focus-visible:ring-2 focus-visible:ring-white/80 ${
            currentView === 'home'
              ? 'bg-white/[0.12] text-white shadow-sm'
              : 'text-zinc-300 hover:text-white hover:bg-white/[0.05]'
          }`}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <Home
              className={`w-4 h-4 transition-colors flex-shrink-0 ${
                currentView === 'home' ? 'text-amber-400' : 'text-zinc-400 group-hover:text-zinc-200'
              }`}
            />
            <span className="text-[13px] font-medium tracking-tight truncate">Home</span>
          </div>
          {totalActiveLights > 0 && (
            <span
              className={`text-xs font-mono px-1.5 py-0.5 rounded-full ${
                currentView === 'home'
                  ? 'bg-amber-400/20 text-amber-300'
                  : 'bg-white/[0.06] text-zinc-400'
              }`}
            >
              {totalActiveLights}
            </span>
          )}
        </button>

        {/* Section: Rooms */}
        <div className="pt-3 pb-1">
          <div className="flex items-center justify-between px-3 pb-1.5">
            <span className="text-[11px] font-semibold tracking-wider text-zinc-400 uppercase">
              Rooms
            </span>
            <button
              type="button"
              onClick={onAddRoom}
              title="Add Room"
              aria-label="Add Room"
              className="w-5 h-5 rounded flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/[0.08] transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="flex flex-col gap-0.5">
            {rooms.length === 0 ? (
              <div className="px-3 py-1.5 text-xs text-zinc-500 italic">No rooms yet</div>
            ) : (
              rooms.map((room) => {
                const isActive = currentView === `room-${room.id}`
                const activeCount = getRoomActiveCount(room)

                return (
                  <button
                    key={room.id}
                    type="button"
                    onClick={() => {
                      onSelectView(`room-${room.id}`)
                      if (isCompact) onToggleCollapse()
                    }}
                    className={`group w-full h-9 px-3 rounded-[10px] flex items-center justify-between transition-colors outline-none focus-visible:ring-2 focus-visible:ring-white/80 ${
                      isActive
                        ? 'bg-white/[0.12] text-white shadow-sm'
                        : 'text-zinc-300 hover:text-white hover:bg-white/[0.05]'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Layers
                        className={`w-4 h-4 transition-colors flex-shrink-0 ${
                          isActive
                            ? 'text-amber-400'
                            : 'text-zinc-400 group-hover:text-zinc-200'
                        }`}
                      />
                      <span className="text-[13px] font-medium tracking-tight truncate">
                        {room.name}
                      </span>
                    </div>

                    {activeCount > 0 ? (
                      <span
                        className={`text-xs font-mono px-1.5 py-0.5 rounded-full ${
                          isActive
                            ? 'bg-amber-400/20 text-amber-300'
                            : 'bg-white/[0.06] text-zinc-400'
                        }`}
                      >
                        {activeCount}
                      </span>
                    ) : (
                      <span className="text-xs font-mono text-zinc-400">
                        {room.deviceIds.length}
                      </span>
                    )}
                  </button>
                )
              })
            )}
          </div>
        </div>

        {/* Section: Scenes */}
        <button
          type="button"
          onClick={() => {
            onSelectView('scenes')
            if (isCompact) onToggleCollapse()
          }}
          className={`group w-full h-9 px-3 rounded-[10px] flex items-center justify-between transition-colors outline-none focus-visible:ring-2 focus-visible:ring-white/80 ${
            currentView === 'scenes'
              ? 'bg-white/[0.12] text-white shadow-sm'
              : 'text-zinc-300 hover:text-white hover:bg-white/[0.05]'
          }`}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <Sparkles
              className={`w-4 h-4 transition-colors flex-shrink-0 ${
                currentView === 'scenes'
                  ? 'text-amber-400'
                  : 'text-zinc-400 group-hover:text-zinc-200'
              }`}
            />
            <span className="text-[13px] font-medium tracking-tight truncate">Scenes</span>
          </div>
          {sceneCount > 0 && (
            <span className="text-xs font-mono text-zinc-400">{sceneCount}</span>
          )}
        </button>

        {/* Section: Automations */}
        <button
          type="button"
          onClick={() => {
            onSelectView('automations')
            if (isCompact) onToggleCollapse()
          }}
          className={`group w-full h-9 px-3 rounded-[10px] flex items-center justify-between transition-colors outline-none focus-visible:ring-2 focus-visible:ring-white/80 ${
            currentView === 'automations'
              ? 'bg-white/[0.12] text-white shadow-sm'
              : 'text-zinc-300 hover:text-white hover:bg-white/[0.05]'
          }`}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <Clock
              className={`w-4 h-4 transition-colors flex-shrink-0 ${
                currentView === 'automations'
                  ? 'text-amber-400'
                  : 'text-zinc-400 group-hover:text-zinc-200'
              }`}
            />
            <span className="text-[13px] font-medium tracking-tight truncate">
              Automations
            </span>
          </div>
          {activeAutomationCount > 0 && (
            <span className="text-xs font-mono px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300">
              {activeAutomationCount}
            </span>
          )}
        </button>

        {/* Section: Effects */}
        <button
          type="button"
          onClick={() => {
            onSelectView('effects')
            if (isCompact) onToggleCollapse()
          }}
          className={`group w-full h-9 px-3 rounded-[10px] flex items-center justify-between transition-colors outline-none focus-visible:ring-2 focus-visible:ring-white/80 ${
            currentView === 'effects'
              ? 'bg-white/[0.12] text-white shadow-sm'
              : 'text-zinc-300 hover:text-white hover:bg-white/[0.05]'
          }`}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <WandSparkles
              className={`w-4 h-4 transition-colors flex-shrink-0 ${
                currentView === 'effects'
                  ? 'text-amber-400'
                  : 'text-zinc-400 group-hover:text-zinc-200'
              }`}
            />
            <span className="text-[13px] font-medium tracking-tight truncate">Effects</span>
          </div>
          {activeEffectCount > 0 && (
            <span className="text-xs font-mono px-1.5 py-0.5 rounded-full bg-amber-400/20 text-amber-300">
              {activeEffectCount}
            </span>
          )}
        </button>

        {/* Section: Energy */}
        <button
          type="button"
          onClick={() => {
            onSelectView('energy')
            if (isCompact) onToggleCollapse()
          }}
          className={`group w-full h-9 px-3 rounded-[10px] flex items-center justify-between transition-colors outline-none focus-visible:ring-2 focus-visible:ring-white/80 ${
            currentView === 'energy'
              ? 'bg-white/[0.12] text-white shadow-sm'
              : 'text-zinc-300 hover:text-white hover:bg-white/[0.05]'
          }`}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <Gauge
              className={`w-4 h-4 transition-colors flex-shrink-0 ${
                currentView === 'energy'
                  ? 'text-amber-400'
                  : 'text-zinc-400 group-hover:text-zinc-200'
              }`}
            />
            <span className="text-[13px] font-medium tracking-tight truncate">Energy</span>
          </div>
        </button>
      </div>

      {/* Bottom Pinned: Settings */}
      <div className="p-2.5 border-t border-white/[0.06]">
        <button
          type="button"
          onClick={() => {
            onOpenSettings()
            if (isCompact) onToggleCollapse()
          }}
          className={`group w-full h-9 px-3 rounded-[10px] flex items-center gap-2.5 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-white/80 ${
            currentView === 'settings'
              ? 'bg-white/[0.12] text-white shadow-sm'
              : 'text-zinc-300 hover:text-white hover:bg-white/[0.05]'
          }`}
        >
          <Settings
            className={`w-4 h-4 transition-colors flex-shrink-0 ${
              currentView === 'settings'
                ? 'text-amber-400'
                : 'text-zinc-400 group-hover:text-zinc-200'
            }`}
          />
          <span className="text-[13px] font-medium tracking-tight">Settings</span>
        </button>
      </div>
    </div>
  )

  // In compact mode (<880px), render as overlay with scrim
  if (isCompact) {
    return (
      <AnimatePresence>
        {!isCollapsed && (
          <div className="fixed inset-0 z-50 flex">
            {/* Scrim */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={springs.snappy}
              onClick={onToggleCollapse}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm"
            />
            {/* Sliding Sidebar Drawer */}
            <motion.div
              initial={{ x: -240 }}
              animate={{ x: 0 }}
              exit={{ x: -240 }}
              transition={springs.default}
              className="relative z-10 h-full shadow-2xl"
            >
              {sidebarContent}
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    )
  }

  // Desktop mode: Collapsible inline column
  return (
    <motion.aside
      animate={{
        width: isCollapsed ? 0 : 240,
        opacity: isCollapsed ? 0 : 1
      }}
      transition={springs.default}
      className="relative flex-shrink-0 overflow-hidden h-screen"
    >
      {sidebarContent}
    </motion.aside>
  )
}

export default Sidebar
