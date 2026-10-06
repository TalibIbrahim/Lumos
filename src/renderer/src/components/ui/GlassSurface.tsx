import React, { useEffect, useState, useRef, useId } from 'react'
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
 * Exact React Bits Glass Surface Component (reactbits.dev)
 * Generates an authentic optical refraction SVG displacement lens with chromatic aberration.
 */
export const GlassSurface: React.FC<GlassSurfaceProps> = ({
  children,
  width,
  height,
  borderRadius = 20,
  borderWidth = 0.07,
  brightness = 50,
  opacity = 0.93,
  blur = 11,
  displace = 2.5,
  backgroundOpacity = 0.04,
  saturation = 1.2,
  distortionScale = -180,
  redOffset = 2,
  greenOffset = 2,
  blueOffset = 2,
  xChannel = 'R',
  yChannel = 'G',
  mixBlendMode = 'difference',
  className = '',
  style = {},
  intensity,
  borderIntensity: _borderIntensity,
  glowColor,
  glowOpacity = 0,
  interactive = false,
  onClick
}) => {
  const rawId = useId()
  const uniqueId = rawId.replace(/:/g, '-')
  const filterId = `glass-filter-${uniqueId}`
  const redGradId = `red-grad-${uniqueId}`
  const blueGradId = `blue-grad-${uniqueId}`

  const [svgSupported, setSvgSupported] = useState(false)

  const containerRef = useRef<HTMLDivElement>(null)
  const feImageRef = useRef<SVGElement>(null)
  const redChannelRef = useRef<SVGFEDisplacementMapElement>(null)
  const greenChannelRef = useRef<SVGFEDisplacementMapElement>(null)
  const blueChannelRef = useRef<SVGFEDisplacementMapElement>(null)
  const gaussianBlurRef = useRef<SVGFEGaussianBlurElement>(null)

  // Map intensity if provided
  const effectiveBgOpacity =
    backgroundOpacity ??
    (intensity === 'subtle' ? 0.02 : intensity === 'deep' ? 0.12 : intensity === 'elevated' ? 0.16 : 0.06)

  const generateDisplacementMap = (): string => {
    const rect = containerRef.current?.getBoundingClientRect()
    const actualWidth = Math.max(10, Math.round(rect?.width || 200))
    const actualHeight = Math.max(10, Math.round(rect?.height || 80))
    const edgeSize = Math.min(actualWidth, actualHeight) * (borderWidth * 0.5)

    const svgContent = `
      <svg viewBox="0 0 ${actualWidth} ${actualHeight}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="${redGradId}" x1="100%" y1="0%" x2="0%" y2="0%">
            <stop offset="0%" stop-color="#0000"/>
            <stop offset="100%" stop-color="red"/>
          </linearGradient>
          <linearGradient id="${blueGradId}" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stop-color="#0000"/>
            <stop offset="100%" stop-color="blue"/>
          </linearGradient>
        </defs>
        <rect x="0" y="0" width="${actualWidth}" height="${actualHeight}" fill="black"></rect>
        <rect x="0" y="0" width="${actualWidth}" height="${actualHeight}" rx="${borderRadius}" fill="url(#${redGradId})" />
        <rect x="0" y="0" width="${actualWidth}" height="${actualHeight}" rx="${borderRadius}" fill="url(#${blueGradId})" style="mix-blend-mode: ${mixBlendMode}" />
        <rect x="${edgeSize}" y="${edgeSize}" width="${actualWidth - edgeSize * 2}" height="${actualHeight - edgeSize * 2}" rx="${borderRadius}" fill="hsl(0 0% ${brightness}% / ${opacity})" style="filter:blur(${blur}px)" />
      </svg>
    `

    return `data:image/svg+xml,${encodeURIComponent(svgContent)}`
  }

  const updateDisplacementMap = (): void => {
    if (feImageRef.current) {
      feImageRef.current.setAttribute('href', generateDisplacementMap())
    }
  }

  useEffect(() => {
    updateDisplacementMap()
    const channels = [
      { ref: redChannelRef, offset: redOffset },
      { ref: greenChannelRef, offset: greenOffset },
      { ref: blueChannelRef, offset: blueOffset }
    ]
    channels.forEach(({ ref, offset }) => {
      if (ref.current) {
        ref.current.setAttribute('scale', (distortionScale + offset).toString())
        ref.current.setAttribute('xChannelSelector', xChannel)
        ref.current.setAttribute('yChannelSelector', yChannel)
      }
    })

    if (gaussianBlurRef.current) {
      gaussianBlurRef.current.setAttribute('stdDeviation', displace.toString())
    }
  }, [
    width,
    height,
    borderRadius,
    borderWidth,
    brightness,
    opacity,
    blur,
    displace,
    distortionScale,
    redOffset,
    greenOffset,
    blueOffset,
    xChannel,
    yChannel,
    mixBlendMode
  ])

  useEffect(() => {
    if (!containerRef.current) return

    const resizeObserver = new ResizeObserver(() => {
      setTimeout(updateDisplacementMap, 0)
    })

    resizeObserver.observe(containerRef.current)

    return () => {
      resizeObserver.disconnect()
    }
  }, [])

  useEffect(() => {
    setTimeout(updateDisplacementMap, 0)
  }, [width, height])

  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      setSvgSupported(false)
      return
    }

    const isWebkit = /Safari/.test(navigator.userAgent) && !/Chrome/.test(navigator.userAgent)
    const isFirefox = /Firefox/.test(navigator.userAgent)

    if (isWebkit || isFirefox) {
      setSvgSupported(false)
      return
    }

    const div = document.createElement('div')
    div.style.backdropFilter = `url(#${filterId})`
    setSvgSupported(div.style.backdropFilter !== '')
  }, [filterId])

  const containerStyle: React.CSSProperties = {
    ...style,
    width: width !== undefined ? (typeof width === 'number' ? `${width}px` : width) : undefined,
    height: height !== undefined ? (typeof height === 'number' ? `${height}px` : height) : undefined,
    borderRadius: `${borderRadius}px`,
    // @ts-expect-error custom css variables
    '--glass-frost': effectiveBgOpacity,
    '--glass-saturation': saturation,
    '--filter-id': `url(#${filterId})`
  }

  return (
    <div
      ref={containerRef}
      onClick={onClick}
      className={`glass-surface ${svgSupported ? 'glass-surface--svg' : 'glass-surface--fallback'} ${
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

      {/* SVG Displacement Filter definition */}
      <svg className="glass-surface__filter" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <filter id={filterId} colorInterpolationFilters="sRGB" x="0%" y="0%" width="100%" height="100%">
            {/* @ts-expect-error feImage href */}
            <feImage ref={feImageRef} x="0" y="0" width="100%" height="100%" preserveAspectRatio="none" result="map" />

            <feDisplacementMap ref={redChannelRef} in="SourceGraphic" in2="map" id="redchannel" result="dispRed" />
            <feColorMatrix
              in="dispRed"
              type="matrix"
              values="1 0 0 0 0
                      0 0 0 0 0
                      0 0 0 0 0
                      0 0 0 1 0"
              result="red"
            />

            <feDisplacementMap
              ref={greenChannelRef}
              in="SourceGraphic"
              in2="map"
              id="greenchannel"
              result="dispGreen"
            />
            <feColorMatrix
              in="dispGreen"
              type="matrix"
              values="0 0 0 0 0
                      0 1 0 0 0
                      0 0 0 0 0
                      0 0 0 1 0"
              result="green"
            />

            <feDisplacementMap ref={blueChannelRef} in="SourceGraphic" in2="map" id="bluechannel" result="dispBlue" />
            <feColorMatrix
              in="dispBlue"
              type="matrix"
              values="0 0 0 0 0
                      0 0 0 0 0
                      0 0 1 0 0
                      0 0 0 1 0"
              result="blue"
            />

            <feBlend in="red" in2="green" mode="screen" result="rg" />
            <feBlend in="rg" in2="blue" mode="screen" result="output" />
            <feGaussianBlur ref={gaussianBlurRef} in="output" stdDeviation="2.5" />
          </filter>
        </defs>
      </svg>

      <div className="glass-surface__content">{children}</div>
    </div>
  )
}

export default GlassSurface
