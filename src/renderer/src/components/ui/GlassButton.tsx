import React from 'react'
import { motion, HTMLMotionProps } from 'framer-motion'
import { GlassSurface } from './GlassSurface'

export interface GlassButtonProps extends Omit<HTMLMotionProps<'button'>, 'children'> {
  children?: React.ReactNode
  variant?: 'standard' | 'prominent' | 'destructive' | 'subtle'
  size?: 'sm' | 'md' | 'lg' | 'icon' | 'icon-sm' | 'icon-lg'
  active?: boolean
  disabled?: boolean
  className?: string
  glowColor?: string
}

const springPress = { type: 'spring' as const, stiffness: 650, damping: 26, mass: 0.55 }

/**
 * Exact React Bits Glass Surface Button
 * Uses the reactbits.dev GlassSurface SVG displacement filter for true optical refraction.
 */
export const GlassButton: React.FC<GlassButtonProps> = ({
  children,
  variant = 'standard',
  size = 'md',
  active = false,
  disabled = false,
  className = '',
  glowColor,
  onClick,
  ...props
}) => {
  // Dimensions per size button matching reactbits.dev specifications
  const dimensions: Record<
    string,
    { height: number; width?: number; borderRadius: number; px: string; text: string }
  > = {
    sm: { height: 32, borderRadius: 16, px: 'px-3.5', text: 'text-xs' },
    md: { height: 38, borderRadius: 19, px: 'px-4.5', text: 'text-xs font-medium' },
    lg: { height: 44, borderRadius: 22, px: 'px-5', text: 'text-sm font-medium' },
    'icon-sm': { width: 32, height: 32, borderRadius: 12, px: 'p-0', text: 'text-xs' },
    icon: { width: 38, height: 38, borderRadius: 14, px: 'p-0', text: 'text-xs' },
    'icon-lg': { width: 44, height: 44, borderRadius: 16, px: 'p-0', text: 'text-sm' }
  }

  const dim = dimensions[size] || dimensions.md

  // Tint per variant
  const bgOpacity = active
    ? variant === 'prominent'
      ? 0.18
      : variant === 'destructive'
      ? 0.18
      : 0.12
    : variant === 'prominent'
    ? 0.08
    : variant === 'destructive'
    ? 0.08
    : variant === 'subtle'
    ? 0.02
    : 0.05

  const textColor = active
    ? variant === 'prominent'
      ? 'text-amber-200'
      : variant === 'destructive'
      ? 'text-rose-200'
      : 'text-white'
    : variant === 'prominent'
    ? 'text-amber-300 hover:text-amber-100'
    : variant === 'destructive'
    ? 'text-rose-300 hover:text-rose-100'
    : variant === 'subtle'
    ? 'text-zinc-400 hover:text-zinc-100'
    : 'text-zinc-300 hover:text-white'

  return (
    <motion.button
      whileTap={disabled ? undefined : { scale: 0.94 }}
      transition={springPress}
      disabled={disabled}
      onClick={disabled ? undefined : onClick}
      className={`relative inline-flex items-center justify-center p-0 border-0 bg-transparent focus:outline-none disabled:opacity-40 disabled:pointer-events-none select-none ${className}`}
      {...props}
    >
      <GlassSurface
        width={dim.width || 'auto'}
        height={dim.height}
        borderRadius={dim.borderRadius}
        distortionScale={active ? -120 : -180}
        brightness={active ? 60 : 48}
        opacity={active ? 0.96 : 0.92}
        backgroundOpacity={bgOpacity}
        glowColor={glowColor}
        glowOpacity={glowColor ? 0.3 : 0}
        className={`w-full h-full ${dim.px}`}
      >
        <span className={`inline-flex items-center justify-center gap-2 ${dim.text} ${textColor} tracking-tight`}>
          {children}
        </span>
      </GlassSurface>
    </motion.button>
  )
}

export default GlassButton
