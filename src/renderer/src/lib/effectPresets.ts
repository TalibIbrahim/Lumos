export interface EffectPreset {
  id: string
  name: string
  badge: string
  description: string
  settings: Record<string, unknown>
}

/**
 * Curated presets for each effect mode delivering optimal visual appeal.
 * Includes the film/movie preset from GEMINI.md, sub-bass drop tuning,
 * organic hearth glow, liquid keyboard wave, and competitive arena flashes.
 */
export const EFFECT_PRESETS: Record<string, EffectPreset> = {
  screen: {
    id: 'screen',
    name: 'Cinema Master',
    badge: 'Movie Mode',
    description:
      'Tuned for dark rooms and films: Movie mode on, 45% ceiling, 25 rise speed, letterbox filtering and slow dark transitions.',
    settings: {
      mode: 'cinema',
      colourOnly: true,
      movieCeiling: 45,
      movieRise: 25,
      movieSlowStop: true,
      movieOffInDark: true,
      maxBrightness: 70,
      minBrightness: 5,
      saturation: 25,
      edgeWidth: 18,
      intensity: 100,
      ignoreBars: true,
      limiter: true,
      dimDarkScenes: true,
      responseSpeed: 30
    }
  },
  music: {
    id: 'music',
    name: 'Deep Bass & Drop',
    badge: 'Bass Surge',
    description:
      'Gentle ambient transitions rolling with the bassline, neon palette, room wave offset, and instant 100% brightness surges on beat drops.',
    settings: {
      style: 'bass',
      sensitivity: 65,
      palette: 'neon',
      wave: true,
      pulseDepth: 65,
      driftSpeed: 40,
      silenceSeconds: 8,
      maxBeatsPerSecond: 2
    }
  },
  album: {
    id: 'album',
    name: 'Art Palette Spread',
    badge: 'Album Harmony',
    description:
      'Extracts dominant album artwork hues and spreads distinct harmony colors across your lights with smooth 15s fadeout on stop.',
    settings: {
      spreadColors: true,
      stopDelaySeconds: 15
    }
  },
  cycle: {
    id: 'cycle',
    name: 'Liquid Rainbow',
    badge: 'RGB Wave',
    description:
      'Silky 45-second full-spectrum 360° color flow at 100% saturation and brightness, with spatial rainbow wave offset between lights.',
    settings: {
      speed: 45,
      brightness: 100,
      saturation: 100,
      wave: true,
      reverse: false
    }
  },
  fireplace: {
    id: 'fireplace',
    name: 'Living Hearth',
    badge: 'Acoustic Glow',
    description:
      'Cozy ember glow and golden dancing flame flicker (85% intensity, flame speed 45) with multi-light spatial hearth phase and acoustic crackle reactivity.',
    settings: {
      intensity: 85,
      flameSpeed: 45,
      acoustic: true,
      wave: true
    }
  },
  away: {
    id: 'away',
    name: 'Smart Ambient Away',
    badge: 'Energy Saver',
    description:
      'Softly dims to 20% after 5 minutes of inactivity or screen lock, fading back smoothly when you return while leaving lights alone during movie playback.',
    settings: {
      idleMinutes: 5,
      idleAction: 'dim',
      lockAction: 'dim',
      dimPercent: 20,
      stayOnDuringMedia: true,
      restore: 'fade'
    }
  },
  games: {
    id: 'games',
    name: 'Competitive Arena',
    badge: 'Esports Glow',
    description:
      'Team-colored 3-flash celebrations for goals, kickoff and victory signals, and low-health warning pulses at 25% HP.',
    settings: {
      rocketLeague: {
        enabled: true,
        useTeamColor: true,
        flashCount: 3,
        flashMs: 350,
        cooldownSeconds: 4,
        matchStart: true,
        matchEnd: true
      },
      cs2: { enabled: true },
      league: { enabled: true },
      health: { threshold: 25, color: { h: 0, s: 100 } },
      flashLightsThatAreOff: false
    }
  }
}
