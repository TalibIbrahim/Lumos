import React, { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Power,
  SlidersHorizontal,
  Edit2,
  FolderInput,
  EyeOff,
  X,
  Check
} from 'lucide-react'
import { GlassSurface } from './ui/GlassSurface'
import { GlassButton } from './ui/GlassButton'
import { NormalizedLightState, RoomGroup } from '../types'
import { springs } from '../lib/constants'

export interface TileContextMenuProps {
  isOpen: boolean
  position: { x: number; y: number }
  light: NormalizedLightState | null
  rooms: RoomGroup[]
  onClose: () => void
  onTogglePower: (id: string) => void
  onOpenDetails: (light: NormalizedLightState) => void
  onUpdateMetadata: (id: string, meta: { customName?: string; room?: string; hidden?: boolean }) => void
}

/**
 * Lumos Accessory Tile Context Menu:
 * - Exactly 5 items or fewer:
 *    1. Turn Off / Turn On (power toggle)
 *    2. Rename Light
 *    3. Move to Room...
 *    4. Hide Accessory
 *    5. Accessory Details
 *    5. Accessory Details
 * - Layer 4 material: 24px backdrop blur, squircle radius 12px, border 1px solid rgba(255, 255, 255, 0.12)
 * - Esc to dismiss, outside click to dismiss
 * - Viewport bounds clamping
 */
export const TileContextMenu: React.FC<TileContextMenuProps> = ({
  isOpen,
  position,
  light,
  rooms,
  onClose,
  onTogglePower,
  onOpenDetails,
  onUpdateMetadata
}) => {
  const menuRef = useRef<HTMLDivElement>(null)
  const [adjustedPos, setAdjustedPos] = useState({ x: 0, y: 0 })

  // Sub-dialog modal state for Rename & Move to Room
  const [activeModal, setActiveModal] = useState<'rename' | 'move' | null>(null)
  const [newName, setNewName] = useState('')
  const [selectedRoom, setSelectedRoom] = useState('')

  // Sync rename and room state when light changes
  useEffect(() => {
    if (light) {
      setNewName(light.customName || light.name)
      setSelectedRoom(light.room || '')
    }
  }, [light])

  // Viewport clamping
  useEffect(() => {
    if (!isOpen) {
      setActiveModal(null)
      return
    }

    const menuWidth = 220
    const menuHeight = 180
    const pad = 12

    let x = position.x
    let y = position.y

    if (x + menuWidth > window.innerWidth - pad) {
      x = window.innerWidth - menuWidth - pad
    }
    if (x < pad) x = pad

    if (y + menuHeight > window.innerHeight - pad) {
      y = window.innerHeight - menuHeight - pad
    }
    if (y < pad) y = pad

    setAdjustedPos({ x, y })
  }, [isOpen, position])

  // Esc key and click outside dismissal
  useEffect(() => {
    if (!isOpen) return

    const handlePointerDown = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (activeModal) {
          setActiveModal(null)
        } else {
          onClose()
        }
      }
    }

    window.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen, activeModal, onClose])

  if (!isOpen || !light) return null

  const handleSaveRename = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = newName.trim()
    if (!trimmed) return
    onUpdateMetadata(light.id, { customName: trimmed })
    setActiveModal(null)
    onClose()
  }

  const handleSaveRoomMove = (roomName: string) => {
    onUpdateMetadata(light.id, { room: roomName })
    setActiveModal(null)
    onClose()
  }

  const handleHideAccessory = () => {
    onUpdateMetadata(light.id, { hidden: true })
    onClose()
  }

  return (
    <>
      {/* 5-Item Context Menu */}
      {!activeModal && (
        <div
          ref={menuRef}
          style={{
            position: 'fixed',
            left: adjustedPos.x,
            top: adjustedPos.y,
            zIndex: 60
          }}
          className="w-[210px] rounded-xl bg-[#141418]/95 backdrop-blur-[24px] border border-white/[0.12] shadow-2xl shadow-black/80 p-1 flex flex-col gap-0.5 select-none"
        >
          {/* Item 1: Power Toggle */}
          <button
            type="button"
            onClick={() => {
              onTogglePower(light.id)
              onClose()
            }}
            className="w-full h-8 px-2.5 rounded-md flex items-center justify-between text-[13px] font-medium text-zinc-200 hover:text-white hover:bg-white/[0.08] transition-colors text-left outline-none"
          >
            <div className="flex items-center gap-2">
              <Power className="w-3.5 h-3.5 text-zinc-400" />
              <span>{light.power ? 'Turn Off' : 'Turn On'}</span>
            </div>
            <span className="text-[11px] font-mono text-zinc-500">Space</span>
          </button>

          {/* Item 2: Rename */}
          <button
            type="button"
            onClick={() => setActiveModal('rename')}
            className="w-full h-8 px-2.5 rounded-md flex items-center gap-2 text-[13px] font-medium text-zinc-200 hover:text-white hover:bg-white/[0.08] transition-colors text-left outline-none"
          >
            <Edit2 className="w-3.5 h-3.5 text-zinc-400" />
            <span>Rename Light</span>
          </button>

          {/* Item 3: Move to Room */}
          <button
            type="button"
            onClick={() => setActiveModal('move')}
            className="w-full h-8 px-2.5 rounded-md flex items-center gap-2 text-[13px] font-medium text-zinc-200 hover:text-white hover:bg-white/[0.08] transition-colors text-left outline-none"
          >
            <FolderInput className="w-3.5 h-3.5 text-zinc-400" />
            <span>Move to Room...</span>
          </button>

          {/* Item 4: Details */}
          <button
            type="button"
            onClick={() => {
              onOpenDetails(light)
              onClose()
            }}
            className="w-full h-8 px-2.5 rounded-md flex items-center justify-between text-[13px] font-medium text-zinc-200 hover:text-white hover:bg-white/[0.08] transition-colors text-left outline-none"
          >
            <div className="flex items-center gap-2">
              <SlidersHorizontal className="w-3.5 h-3.5 text-zinc-400" />
              <span>Accessory Details</span>
            </div>
            <span className="text-[11px] font-mono text-zinc-500">Enter</span>
          </button>

          <div className="h-px bg-white/[0.06] my-0.5" />

          {/* Item 5: Hide Accessory (Destructive styling) */}
          <button
            type="button"
            onClick={handleHideAccessory}
            className="w-full h-8 px-2.5 rounded-md flex items-center gap-2 text-[13px] font-medium text-rose-400 hover:text-rose-200 hover:bg-rose-500/10 transition-colors text-left outline-none"
          >
            <EyeOff className="w-3.5 h-3.5 text-rose-400" />
            <span>Hide Accessory</span>
          </button>
        </div>
      )}

      {/* Sub-modal: Rename Accessory */}
      <AnimatePresence>
        {activeModal === 'rename' && (
          <div className="fixed inset-0 z-70 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={onClose}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={springs.snappy}
              className="relative z-10 w-full max-w-sm rounded-2xl overflow-hidden shadow-2xl shadow-black/80"
            >
              <GlassSurface intensity="elevated" className="p-5 flex flex-col gap-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-white tracking-tight">
                    Rename Accessory
                  </h3>
                  <button
                    onClick={() => setActiveModal(null)}
                    className="text-zinc-400 hover:text-white transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <form onSubmit={handleSaveRename} className="flex flex-col gap-3">
                  <input
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="Accessory Name"
                    autoFocus
                    className="w-full bg-zinc-900 border border-white/10 rounded-xl px-3.5 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-amber-400/80 transition-colors"
                  />
                  <div className="flex items-center justify-end gap-2 pt-1">
                    <GlassButton
                      variant="subtle"
                      size="sm"
                      type="button"
                      onClick={() => setActiveModal(null)}
                    >
                      Cancel
                    </GlassButton>
                    <GlassButton
                      variant="prominent"
                      size="sm"
                      type="submit"
                      disabled={!newName.trim()}
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>Save</span>
                    </GlassButton>
                  </div>
                </form>
              </GlassSurface>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Sub-modal: Move to Room */}
      <AnimatePresence>
        {activeModal === 'move' && (
          <div className="fixed inset-0 z-70 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={onClose}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={springs.snappy}
              className="relative z-10 w-full max-w-sm rounded-2xl overflow-hidden shadow-2xl shadow-black/80"
            >
              <GlassSurface intensity="elevated" className="p-5 flex flex-col gap-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-white tracking-tight">
                      Move to Room
                    </h3>
                    <p className="text-xs text-zinc-400">
                      Select destination room for {light.customName || light.name}
                    </p>
                  </div>
                  <button
                    onClick={() => setActiveModal(null)}
                    className="text-zinc-400 hover:text-white transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="flex flex-col gap-1 max-h-56 overflow-y-auto no-scrollbar">
                  <button
                    type="button"
                    onClick={() => handleSaveRoomMove('')}
                    className={`w-full px-3 py-2 rounded-xl text-xs font-medium flex items-center justify-between transition-colors ${
                      !selectedRoom
                        ? 'bg-amber-400/20 text-amber-300'
                        : 'text-zinc-300 hover:bg-white/[0.06] hover:text-white'
                    }`}
                  >
                    <span>None (Ungrouped)</span>
                    {!selectedRoom && <Check className="w-3.5 h-3.5 text-amber-300" />}
                  </button>

                  {rooms.map((room) => {
                    const isCurrent =
                      selectedRoom === room.name || selectedRoom === room.id
                    return (
                      <button
                        key={room.id}
                        type="button"
                        onClick={() => handleSaveRoomMove(room.name)}
                        className={`w-full px-3 py-2 rounded-xl text-xs font-medium flex items-center justify-between transition-colors ${
                          isCurrent
                            ? 'bg-amber-400/20 text-amber-300'
                            : 'text-zinc-300 hover:bg-white/[0.06] hover:text-white'
                        }`}
                      >
                        <span>{room.name}</span>
                        {isCurrent && <Check className="w-3.5 h-3.5 text-amber-300" />}
                      </button>
                    )
                  })}
                </div>
              </GlassSurface>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  )
}

export default TileContextMenu
