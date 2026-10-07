import type { MusicFeatures } from '../../../shared/audio/analysis'
import { asObj, bool, num } from '../validate'

/** Validates features from the analysis page before they reach the effect. */
export function sanitizeFeatures(raw: unknown): MusicFeatures | null {
  const o = asObj(raw)
  if (typeof o.loudness !== 'number') return null
  const tempo = typeof o.tempo === 'number' && Number.isFinite(o.tempo) ? num(o.tempo, 0, 30, 300) : null
  return {
    loudness: num(o.loudness, 0, 0, 1),
    low: num(o.low, 0, 0, 1),
    beat: bool(o.beat, false),
    beatStrength: num(o.beatStrength, 0, 0, 1),
    tempo,
    energy: num(o.energy, 0, 0, 1),
    silent: bool(o.silent, true),
    drop: bool(o.drop, false)
  }
}
