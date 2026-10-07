import React from 'react'
import '../GlassSurface.css'

export interface GlassSurfaceProps {
  children?: React.ReactNode
  width?: number | string
  height?: number | string
  borderRadius?: number
  borderWidth?: number
  brightness?: number
  opacity?: number
  blur?: number
  displace?: number
  backgroundOpacity?: number
  saturation?: number
  distortionScale?: number
  redOffset?: number
  greenOffset?: number
  blueOffset?: number
  xChannel?: 'R' | 'G' | 'B' | 'A'
  yChannel?: 'R' | 'G' | 'B' | 'A'
  mixBlendMode?: string
  className?: string
  style?: React.CSSProperties
  intensity?: 'subtle' | 'medium' | 'deep' | 'elevated'
  borderIntensity?: 'faint' | 'standard' | 'bright'
  glowColor?: string
  glowOpacity?: number
  interactive?: boolean
  onClick?: React.MouseEventHandler<HTMLDivElement>
}

/**
 * React Bits Glass Surface, drawn as a plain backdrop blur.
 *
 * The original refracts what is behind it with an SVG displacement filter. That filter runs again on every
 * redraw behind the glass, which made drags stutter, so the refraction was removed. The lens props stay in
 * the interface so existing call sites keep working, but they no longer have any effect.
 */
export const GlassSurface: React.FC<GlassSurfaceProps> = ({
  children,
  width,
  height,
  borderRadius = 20,
  backgroundOpacity = 0.04,
  saturation = 1.2,
  className = '',
  style = {},
  intensity,
  glowColor,
  glowOpacity = 0,
  interactive = false,
  onClick
}) => {
  // Map intensity if provided
  const effectiveBgOpacity =
    backgroundOpacity ??
    (intensity === 'subtle' ? 0.02 : intensity === 'deep' ? 0.12 : intensity === 'elevated' ? 0.16 : 0.06)

  const containerStyle: React.CSSProperties = {
    ...style,
    width: width !== undefined ? (typeof width === 'number' ? `${width}px` : width) : undefined,
    height: height !== undefined ? (typeof height === 'number' ? `${height}px` : height) : undefined,
    borderRadius: `${borderRadius}px`,
    // @ts-expect-error custom css variables
    '--glass-frost': effectiveBgOpacity,
    '--glass-saturation': saturation
  }

  return (
    <div
      onClick={onClick}
      className={`glass-surface glass-surface--blur ${
        interactive ? 'cursor-pointer active:scale-[0.98] transition-transform' : ''
      } ${className}`}
      style={containerStyle}
    >
      {/* Optional ambient glow behind glass */}
      {glowColor && glowOpacity > 0 && (
        <span
          aria-hidden="true"
          className="absolute -inset-2 pointer-events-none transition-opacity duration-300 blur-2xl -z-10"
          style={{
            background: glowColor,
            opacity: glowOpacity
          }}
        />
      )}

      <div className="glass-surface__content">{children}</div>
    </div>
  )
}

export default GlassSurface
