import React, { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Layers,
  Plus,
  Trash2,
  Power,
  X,
  Lightbulb,
  Check,
  FolderPlus
} from 'lucide-react'
import { GlassSurface } from './ui/GlassSurface'
import { GlassButton } from './ui/GlassButton'
import { NormalizedLightState, RoomGroup } from '../types'
import { springs } from '../lib/constants'

export interface RoomsSheetProps {
  isOpen: boolean
  onClose: () => void
  rooms: RoomGroup[]
  lights: NormalizedLightState[]
  onRefreshStore: () => void
  onDeleteRoomWithUndo?: (room: RoomGroup) => void
}

export const RoomsSheet: React.FC<RoomsSheetProps> = ({
  isOpen,
  onClose,
  rooms,
  lights,
  onRefreshStore,
  onDeleteRoomWithUndo
}) => {
  const [newRoomName, setNewRoomName] = useState('')
  const [selectedDeviceIdsForNew, setSelectedDeviceIdsForNew] = useState<string[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleToggleDeviceForNew = (id: string) => {
    setSelectedDeviceIdsForNew((prev) =>
      prev.includes(id) ? prev.filter((d) => d !== id) : [...prev, id]
    )
  }

  const handleCreateRoom = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = newRoomName.trim()
    if (!trimmed || isSubmitting) return

    setIsSubmitting(true)
    const api = window.lumos || window.lumen
    try {
      if (api?.saveRoom) {
        await api.saveRoom({
          name: trimmed,
          deviceIds: selectedDeviceIdsForNew
        })
        setNewRoomName('')
        setSelectedDeviceIdsForNew([])
        onRefreshStore()
      }
    } catch (err) {
      console.error('[RoomsSheet] Error creating room:', err)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDeleteRoom = async (room: RoomGroup) => {
    if (onDeleteRoomWithUndo) {
      onDeleteRoomWithUndo(room)
      return
    }
    const api = window.lumos || window.lumen
    if (!api?.deleteRoom) return
    try {
      await api.deleteRoom(room.id)
      onRefreshStore()
    } catch (err) {
      console.error('[RoomsSheet] Error deleting room:', err)
    }
  }

  const handleToggleRoomLight = async (room: RoomGroup, lightId: string) => {
    const api = window.lumos || window.lumen
    if (!api?.saveRoom) return
    const exists = room.deviceIds.includes(lightId)
    const nextDeviceIds = exists
      ? room.deviceIds.filter((id) => id !== lightId)
      : [...room.deviceIds, lightId]

    try {
      await api.saveRoom({
        id: room.id,
        name: room.name,
        deviceIds: nextDeviceIds
      })
      onRefreshStore()
    } catch (err) {
      console.error('[RoomsSheet] Error updating room fixtures:', err)
    }
  }

  const handleToggleRoomPower = async (room: RoomGroup) => {
    const api = window.lumos || window.lumen
    if (!api?.setGroupPower) return
    const roomLights = lights.filter((l) => room.deviceIds.includes(l.id))
    const anyOn = roomLights.some((l) => l.online && l.power)
    try {
      await api.setGroupPower(room.deviceIds, !anyOn)
      onRefreshStore()
    } catch (err) {
      console.error('[RoomsSheet] Error toggling room power:', err)
    }
  }

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
            className="absolute inset-0 bg-black/55 backdrop-blur-md"
          />

          {/* Modal Container */}
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 12 }}
            transition={springs.default}
            onClick={(e) => e.stopPropagation()}
            className="relative z-10 w-full max-w-2xl max-h-[85vh] rounded-3xl overflow-hidden flex flex-col shadow-2xl shadow-black/80"
          >
            <GlassSurface
              intensity="elevated"
              borderIntensity="bright"
              borderRadius={28}
              className="p-6 flex flex-col gap-5 max-h-[85vh] overflow-y-auto no-scrollbar"
            >
              {/* Header */}
              <div className="flex items-center justify-between border-b border-white/[0.08] pb-4">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-white/[0.08] border border-white/[0.1] flex items-center justify-center text-amber-300 shadow-inner">
                    <Layers className="w-4 h-4" />
                  </div>
                  <div>
                    <h2 className="text-base font-semibold text-white tracking-tight">
                      Room Management
                    </h2>
                    <p className="text-xs text-zinc-400">
                      Organize fixtures into designated zones and synchronized room groups.
                    </p>
                  </div>
                </div>

                <GlassButton
                  variant="subtle"
                  size="icon-sm"
                  onClick={onClose}
                  title="Close modal"
                >
                  <X className="w-3.5 h-3.5" />
                </GlassButton>
              </div>

              {/* Create Room Form */}
              <form
                onSubmit={handleCreateRoom}
                className="flex flex-col gap-3 p-4 rounded-2xl bg-zinc-950/50 border border-white/[0.08]"
              >
                <div className="flex items-center gap-2 text-xs font-semibold text-zinc-300 uppercase tracking-wider">
                  <FolderPlus className="w-3.5 h-3.5 text-amber-400" />
                  <span>Create New Room</span>
                </div>

                <div className="flex flex-col sm:flex-row gap-2.5">
                  <input
                    type="text"
                    value={newRoomName}
                    onChange={(e) => setNewRoomName(e.target.value)}
                    placeholder="Room name (e.g. Studio, Bedroom, Office)"
                    className="flex-1 bg-zinc-900/90 border border-white/10 rounded-xl px-3.5 py-2 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-amber-400/80 transition-colors"
                  />
                  <GlassButton
                    variant="prominent"
                    size="md"
                    type="submit"
                    disabled={!newRoomName.trim() || isSubmitting}
                    className="flex-shrink-0"
                  >
                    <Plus className="w-3.5 h-3.5 mr-1" />
                    <span>Add Room</span>
                  </GlassButton>
                </div>

                {/* Fixture Checkboxes for New Room */}
                {lights.length > 0 && (
                  <div className="flex flex-col gap-1.5 pt-1">
                    <span className="text-[11px] text-zinc-400">Assign fixtures to this room:</span>
                    <div className="flex flex-wrap gap-2">
                      {lights.map((l) => {
                        const isSelected = selectedDeviceIdsForNew.includes(l.id)
                        return (
                          <button
                            type="button"
                            key={l.id}
                            onClick={() => handleToggleDeviceForNew(l.id)}
                            className={`px-2.5 py-1 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all border ${
                              isSelected
                                ? 'bg-amber-400/20 border-amber-400/40 text-amber-200'
                                : 'bg-white/[0.04] border-white/[0.08] text-zinc-400 hover:text-zinc-200'
                            }`}
                          >
                            <Lightbulb className="w-3 h-3" />
                            <span>{l.customName || l.name}</span>
                            {isSelected && <Check className="w-3 h-3 text-amber-300" />}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}
              </form>

              {/* Existing Rooms List */}
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between px-1">
                  <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
                    Existing Rooms ({rooms.length})
                  </span>
                </div>

                {rooms.length === 0 ? (
                  <div className="p-8 text-center rounded-2xl bg-zinc-950/30 border border-white/[0.06] flex flex-col items-center gap-2">
                    <Layers className="w-7 h-7 text-zinc-600" />
                    <p className="text-xs text-zinc-400">
                      No rooms defined yet. Create your first room above to group fixtures together.
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-3">
                    {rooms.map((room) => {
                      const roomLights = lights.filter((l) => room.deviceIds.includes(l.id))
                      const anyOn = roomLights.some((l) => l.online && l.power)

                      return (
                        <div
                          key={room.id}
                          className="flex flex-col gap-3 p-4 rounded-2xl bg-zinc-950/50 border border-white/[0.08]"
                        >
                          {/* Room header row */}
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2.5">
                              <span className="font-semibold text-sm text-white tracking-tight">
                                {room.name}
                              </span>
                              <span className="px-2 py-0.5 rounded-full bg-white/[0.06] border border-white/[0.08] text-[10px] text-zinc-400 font-mono">
                                {roomLights.length} fixtures
                              </span>
                            </div>

                            <div className="flex items-center gap-2">
                              {/* Power Toggle for Room */}
                              {roomLights.length > 0 && (
                                <GlassButton
                                  variant={anyOn ? 'prominent' : 'standard'}
                                  size="sm"
                                  onClick={() => handleToggleRoomPower(room)}
                                  title={`Toggle all lights in ${room.name}`}
                                >
                                  <Power className="w-3.5 h-3.5 mr-1" />
                                  <span>{anyOn ? 'Turn Off' : 'Turn On'}</span>
                                </GlassButton>
                              )}

                              {/* Delete Room */}
                              <GlassButton
                                variant="destructive"
                                size="sm"
                                onClick={() => handleDeleteRoom(room)}
                                title={`Delete ${room.name}`}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </GlassButton>
                            </div>
                          </div>

                          {/* Fixture Membership Toggles */}
                          <div className="flex flex-col gap-1.5 pt-1 border-t border-white/[0.05]">
                            <span className="text-[11px] text-zinc-400">
                              Included fixtures:
                            </span>
                            <div className="flex flex-wrap gap-2">
                              {lights.map((light) => {
                                const inRoom = room.deviceIds.includes(light.id)
                                return (
                                  <button
                                    type="button"
                                    key={light.id}
                                    onClick={() => handleToggleRoomLight(room, light.id)}
                                    className={`px-2.5 py-1 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all border ${
                                      inRoom
                                        ? 'bg-emerald-500/15 border-emerald-500/35 text-emerald-200'
                                        : 'bg-white/[0.03] border-white/[0.06] text-zinc-500 hover:text-zinc-300'
                                    }`}
                                  >
                                    <Lightbulb className="w-3 h-3" />
                                    <span>{light.customName || light.name}</span>
                                    {inRoom && <Check className="w-3 h-3 text-emerald-400" />}
                                  </button>
                                )
                              })}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </GlassSurface>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}

export default RoomsSheet
