import React, { useState } from 'react'
import { X, Minus, Plus } from 'lucide-react'

export interface TrafficLightsProps {
  onMinimize?: () => void
  onMaximize?: () => void
  onClose?: () => void
  className?: string
}

/**
 * macOS Sequoia Style Traffic Light Window Controls
 * Replaces generic Windows chrome with an authentic, understated Apple material.
 */
export const TrafficLights: React.FC<TrafficLightsProps> = ({
  onMinimize,
  onMaximize,
  onClose,
  className = ''
}) => {
  const [isHovered, setIsHovered] = useState(false)

  const handleClose = () => {
    if (onClose) onClose()
    else (window.lumos || window.lumen)?.close()
  }

  const handleMinimize = () => {
    if (onMinimize) onMinimize()
    else (window.lumos || window.lumen)?.minimize()
  }

  const handleMaximize = () => {
    if (onMaximize) onMaximize()
    else (window.lumos || window.lumen)?.maximize()
  }

  return (
    <div
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      className={`flex items-center gap-2 px-1 select-none ${className}`}
    >
      {/* Close button */}
      <button
        onClick={handleClose}
        title="Close to Tray"
        aria-label="Close"
        className="group relative w-3 h-3 rounded-full bg-[#ff5f56] border border-[#e0443e] flex items-center justify-center transition-transform active:scale-90 focus:outline-none"
      >
        <X
          className={`w-2 h-2 text-[#4d0000] stroke-[2.5] transition-opacity duration-150 ${
            isHovered ? 'opacity-100' : 'opacity-0'
          }`}
        />
      </button>

      {/* Minimize button */}
      <button
        onClick={handleMinimize}
        title="Minimize"
        aria-label="Minimize"
        className="group relative w-3 h-3 rounded-full bg-[#ffbd2e] border border-[#dea123] flex items-center justify-center transition-transform active:scale-90 focus:outline-none"
      >
        <Minus
          className={`w-2 h-2 text-[#5c3c00] stroke-[2.5] transition-opacity duration-150 ${
            isHovered ? 'opacity-100' : 'opacity-0'
          }`}
        />
      </button>

      {/* Maximize button */}
      <button
        onClick={handleMaximize}
        title="Maximize"
        aria-label="Maximize"
        className="group relative w-3 h-3 rounded-full bg-[#27c93f] border border-[#1aab29] flex items-center justify-center transition-transform active:scale-90 focus:outline-none"
      >
        <Plus
          className={`w-2 h-2 text-[#004d11] stroke-[2.5] transition-opacity duration-150 ${
            isHovered ? 'opacity-100' : 'opacity-0'
          }`}
        />
      </button>
    </div>
  )
}
export default TrafficLights
