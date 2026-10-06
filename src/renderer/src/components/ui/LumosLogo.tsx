import React from 'react'

export interface LumosLogoProps extends React.SVGProps<SVGSVGElement> {
  size?: number
  active?: boolean
  glow?: boolean
  className?: string
}

/**
 * Lumos Precision Aperture Mark
 *
 * Minimal geometric identity for Lumos smart lighting.
 * Traces an architectural 270-degree collimator arc embracing
 * a central photon emitter core. Automatically interpolates between
 * quiet graphite (OFF) and luminous blackbody radiation (ON).
 */
export const LumosLogo: React.FC<LumosLogoProps> = ({
  size = 32,
  active = true,
  glow = true,
  className = '',
  ...props
}) => {
  const uniqueId = React.useId().replace(/:/g, '')
  const coreGradId = `lumos-core-${uniqueId}`
  const flareGradId = `lumos-flare-${uniqueId}`
  const rimGradId = `lumos-rim-${uniqueId}`
  const filterId = `lumos-glow-${uniqueId}`

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 32 32"
      width={size}
      height={size}
      fill="none"
      className={className}
      role="img"
      aria-label="Lumos Logo"
      {...props}
    >
      <defs>
        {/* Core radiation gradient */}
        <radialGradient id={coreGradId} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#fffef2" />
          <stop offset="28%" stopColor="#fde047" />
          <stop offset="65%" stopColor="#f59e0b" />
          <stop offset="92%" stopColor="#d97706" />
          <stop offset="100%" stopColor="#b45309" />
        </radialGradient>

        {/* Aperture flare for upper-right radiation */}
        <radialGradient id={flareGradId} cx="50%" cy="50%" r="50%" fx="65%" fy="35%">
          <stop offset="0%" stopColor="#fde047" stopOpacity={active ? 0.45 : 0} />
          <stop offset="50%" stopColor="#f59e0b" stopOpacity={active ? 0.18 : 0} />
          <stop offset="100%" stopColor="#d97706" stopOpacity={0} />
        </radialGradient>

        {/* Rim specular highlight gradient */}
        <linearGradient id={rimGradId} x1="20%" y1="80%" x2="80%" y2="20%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity={active ? 0.18 : 0.08} />
          <stop offset="50%" stopColor="#ffffff" stopOpacity={active ? 0.35 : 0.15} />
          <stop offset="80%" stopColor={active ? '#fed7aa' : '#ffffff'} stopOpacity={active ? 0.75 : 0.22} />
          <stop offset="100%" stopColor={active ? '#fde047' : '#ffffff'} stopOpacity={active ? 0.95 : 0.3} />
        </linearGradient>

        {/* Soft optical diffusion filter */}
        <filter id={filterId} x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="1.5" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Atmospheric emission aura (active only) */}
      {active && glow && (
        <>
          <circle cx="16" cy="16" r="10" fill={`url(#${flareGradId})`} />
          <path
            d="M 16 16 L 27.5 13.5 A 13 13 0 0 0 18.5 4.5 Z"
            fill={`url(#${flareGradId})`}
            opacity="0.8"
          />
        </>
      )}

      {/* Outer Collimator Arc (270-degree sweep) */}
      <path
        d="M 16 4 A 12 12 0 1 0 28 16"
        stroke={`url(#${rimGradId})`}
        strokeWidth="2.5"
        strokeLinecap="round"
      />

      {/* Inner specular reflection line */}
      <path
        d="M 16 6.5 A 9.5 9.5 0 1 0 25.5 16"
        stroke="#ffffff"
        strokeOpacity={active ? 0.16 : 0.06}
        strokeWidth="0.75"
        strokeLinecap="round"
      />

      {/* Emitter Core */}
      <g filter={active && glow ? `url(#${filterId})` : undefined}>
        <circle
          cx="16"
          cy="16"
          r="4.5"
          fill={active ? `url(#${coreGradId})` : '#27272a'}
          stroke={active ? undefined : 'rgba(255, 255, 255, 0.08)'}
          strokeWidth={active ? undefined : 0.75}
        />
      </g>

      {/* Hot glint on core */}
      {active && (
        <circle cx="14.8" cy="14.8" r="1.3" fill="#ffffff" fillOpacity="0.85" />
      )}
    </svg>
  )
}

export default LumosLogo

