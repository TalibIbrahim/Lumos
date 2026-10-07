import React from 'react'
import { motion } from 'framer-motion'
import { LightTile } from './LightTile'
import { NormalizedLightState } from '../types'
import { springs } from '../lib/constants'

interface TileCellProps {
  light: NormalizedLightState
  onToggle: (id: string) => void
  onBrightnessChange: (id: string, value: number) => void
  onOpenDetail: (light: NormalizedLightState) => void
  onContextMenu?: (pos: { clientX: number; clientY: number }, light: NormalizedLightState) => void
  isFocused: boolean
  /** Turns off the layout and enter/exit motion. */
  reduceMotion?: boolean
  /** Changes whenever the set of tiles in the grid changes, so every cell re-renders and animates into place. */
  layoutKey: string
  /** Set by AnimatePresence in popLayout mode to measure the cell as it leaves. */
  ref?: React.Ref<HTMLDivElement>
}

/**
 * One animated grid cell. Memoized so a change to one light re-renders only its own
 * cell: a layout-animated cell that re-renders makes the animation library measure
 * the page, which is costly on every state update.
 */
const TileCellComponent: React.FC<TileCellProps> = ({
  light,
  onToggle,
  onBrightnessChange,
  onOpenDetail,
  onContextMenu,
  isFocused,
  reduceMotion = false,
  ref
}) => (
  <motion.div
    ref={ref}
    layout={!reduceMotion}
    initial={reduceMotion ? undefined : { opacity: 0, scale: 0.96 }}
    animate={{ opacity: 1, scale: 1 }}
    exit={reduceMotion ? undefined : { opacity: 0, scale: 0.94 }}
    transition={springs.default}
  >
    <LightTile
      light={light}
      onToggle={onToggle}
      onBrightnessChange={onBrightnessChange}
      onOpenDetail={onOpenDetail}
      onContextMenu={onContextMenu}
      isFocused={isFocused}
    />
  </motion.div>
)

export const TileCell = React.memo(TileCellComponent)

/** Identifies the set and order of tiles in a grid. */
export const tileLayoutKey = (lights: NormalizedLightState[]): string => lights.map((l) => l.id).join('|')
