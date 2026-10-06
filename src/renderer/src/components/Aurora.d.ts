import React from 'react'

export interface AuroraProps {
  colorStops?: string[]
  amplitude?: number
  blend?: number
  speed?: number
  time?: number
  lightMode?: boolean
}

declare const Aurora: React.FC<AuroraProps>
export default Aurora
