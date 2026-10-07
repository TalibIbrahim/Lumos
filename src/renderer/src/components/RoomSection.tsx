import React from 'react'
import { AnimatePresence } from 'framer-motion'
import { Power, Layers } from 'lucide-react'
import { GlassButton } from './ui/GlassButton'
import { TileCell, tileLayoutKey } from './TileCell'
import { NormalizedLightState, RoomGroup } from '../types'

interface RoomSectionProps {
  room: RoomGroup
  lights: NormalizedLightState[]
  onToggleLight: (id: string) => void
  onBrightnessChange: (id: string, value: number) => void
  onOpenDetail: (light: NormalizedLightState) => void
  onToggleRoom: (deviceIds: string[], on: boolean) => void
  onContextMenu?: (pos: { clientX: number; clientY: number }, light: NormalizedLightState) => void
  focusedLightId?: string | null
}

/**
 * Lumos Room Section
 * Apple Home-Grade Room Section:
 * - Clean header with status count
 * - Generous whitespace; consistent visual rhythm
 * - Content-aware responsive tile grid
 */
export const RoomSection: React.FC<RoomSectionProps> = ({
  room,
  lights,
  onToggleLight,
  onBrightnessChange,
  onOpenDetail,
  onToggleRoom,
  onContextMenu,
  focusedLightId
}) => {
  const roomLights = lights.filter(
    (l) => room.deviceIds.includes(l.id) || l.room === room.name || l.room === room.id
  )
  if (roomLights.length === 0) return null

  const activeLights = roomLights.filter((l) => l.online && l.power).length
  const anyOn = activeLights > 0
  const allDeviceIds = roomLights.map((l) => l.id)
  const layoutKey = tileLayoutKey(roomLights)

  return (
    <section className="flex flex-col gap-3.5 select-none">
      {/* Clean Room Section Header */}
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <Layers className="w-4 h-4 text-zinc-400" />
          <h2 className="text-[17px] font-semibold tracking-tight text-white">
            {room.name}
          </h2>
          <span className="px-2 py-0.5 rounded-full bg-white/[0.06] border border-white/[0.08] text-[11px] font-medium text-zinc-400">
            {activeLights}/{roomLights.length} On
          </span>
        </div>

        {/* Group Master Power Toggle */}
        <div className="flex items-center gap-2">
          <GlassButton
            variant={anyOn ? 'prominent' : 'standard'}
            size="sm"
            onClick={() => onToggleRoom(allDeviceIds, !anyOn)}
            className="text-xs font-medium"
            title={`Toggle all lights in ${room.name}`}
          >
            <Power className="w-3.5 h-3.5" />
            <span>{anyOn ? 'Turn Off' : 'Turn On'}</span>
          </GlassButton>
        </div>
      </div>

      {/* Grid of Light Tiles */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        <AnimatePresence mode="popLayout">
          {roomLights.map((light) => (
            <TileCell
              key={light.id}
              light={light}
              onToggle={onToggleLight}
              onBrightnessChange={onBrightnessChange}
              onOpenDetail={onOpenDetail}
              onContextMenu={onContextMenu}
              isFocused={focusedLightId === light.id}
              layoutKey={layoutKey}
            />
          ))}
        </AnimatePresence>
      </div>
    </section>
  )
}

export default RoomSection
