import { Effect, EffectHost, EffectSettingsBase } from '../Effect'
import { ComposeContext, Layer, LayerPriority } from '../compositor'
import { LightOutput, asAdjustable, luminance } from '../output'
import { asObj, bool, int, targets } from '../validate'
import type { ExtractedColors } from '../../../shared/color/dominant'
import type { MediaState, SystemMonitor } from '../../system/systemMonitor'
import type { Extractor } from './extractor'

export interface AlbumSettings extends EffectSettingsBase {
  /** Spread up to three colours from the art across the lights. */
  spreadColors: boolean
  /** Seconds after playback stops or pauses before the lights return. */
  stopDelaySeconds: number
}

const CROSSFADE_MS = 1500
const MIN_BRIGHTNESS = 25
const CACHE_SIZE = 24

/**
 * Tints lights with the colour of the album art for whatever is playing on
 * this computer, read from the Windows media session. Thumbnails stay in
 * memory only and track details are never logged.
 */
export class AlbumEffect extends Effect<AlbumSettings> implements Layer {
  readonly id = 'album'
  readonly label = 'Album color'
  readonly voiceName = 'Album color'
  readonly description = 'Tints your lights with the colours of the album art that is playing.'
  readonly ambient = true
  readonly priority = LayerPriority.NowPlaying

  private colors: ExtractedColors | null = null
  private currentKey: string | null = null
  private cache = new Map<string, ExtractedColors>()
  private stopTimer: NodeJS.Timeout | null = null
  private readonly onMedia = (m: MediaState): void => void this.handleMedia(m)
  private readonly onAvailability = (ok: boolean): void => {
    if (!ok) this.setStatus('error', this.monitor.getError() || 'Media session is not available')
  }

  constructor(
    host: EffectHost,
    private monitor: SystemMonitor,
    private extract: Extractor
  ) {
    super(host)
    this.init()
  }

  defaults(): AlbumSettings {
    return { enabled: false, targets: 'all', spreadColors: true, stopDelaySeconds: 10 }
  }

  sanitize(raw: unknown): AlbumSettings {
    const o = asObj(raw)
    const d = this.defaults()
    return {
      enabled: bool(o.enabled, false),
      targets: targets(o.targets),
      spreadColors: bool(o.spreadColors, d.spreadColors),
      stopDelaySeconds: int(o.stopDelaySeconds, d.stopDelaySeconds, 0, 300)
    }
  }

  protected onStart(): void {
    this.monitor.on('media', this.onMedia)
    this.monitor.on('availability', this.onAvailability)
    this.monitor.acquire(this.id)
    this.host.compositor.addLayer(this)
    this.setStatus('waiting', 'Waiting for something to play')
    void this.handleMedia(this.monitor.getMedia())
  }

  protected onStop(): void {
    this.monitor.removeListener('media', this.onMedia)
    this.monitor.removeListener('availability', this.onAvailability)
    this.monitor.release(this.id)
    if (this.stopTimer) clearTimeout(this.stopTimer)
    this.stopTimer = null
    const had = this.colors !== null
    this.colors = null
    this.currentKey = null
    this.host.compositor.removeLayer(this.id, had ? CROSSFADE_MS : 0)
  }

  protected onSettingsChanged(): void {
    this.host.compositor.invalidate(this.targetIds(), CROSSFADE_MS)
  }

  private targetIds(): string[] {
    return this.host.getLights().map((l) => l.id).filter((id) => this.isTarget(id))
  }

  private async handleMedia(m: MediaState): Promise<void> {
    if (!this.running) return
    if (m.status !== 'Playing') {
      if (this.colors && !this.stopTimer) {
        this.stopTimer = setTimeout(() => {
          this.stopTimer = null
          this.colors = null
          this.currentKey = null
          this.host.compositor.invalidate(this.targetIds(), CROSSFADE_MS)
          this.setStatus('waiting', 'Waiting for something to play')
        }, this.settings.stopDelaySeconds * 1000)
      }
      return
    }

    if (this.stopTimer) {
      clearTimeout(this.stopTimer)
      this.stopTimer = null
    }
    if (m.key === this.currentKey && this.colors) return

    let colors = m.key ? this.cache.get(m.key) : undefined
    if (!colors && m.thumbnail) {
      try {
        colors = await this.extract(m.thumbnail.rgba, m.thumbnail.width, m.thumbnail.height)
      } catch {
        colors = undefined
      }
      if (colors && m.key) this.remember(m.key, colors)
    }
    if (!this.running) return
    if (!colors) {
      // No art yet; the helper sends it when it becomes available
      if (!this.colors) this.setStatus('waiting', 'Playing, but no album art yet')
      return
    }

    this.currentKey = m.key
    this.colors = colors
    this.host.compositor.invalidate(this.targetIds(), CROSSFADE_MS)
    this.setStatus('active', colors.monochrome ? 'Warm white for black and white art' : 'Matching the album art')
  }

  private remember(key: string, colors: ExtractedColors): void {
    this.cache.delete(key)
    this.cache.set(key, colors)
    while (this.cache.size > CACHE_SIZE) {
      const oldest = this.cache.keys().next().value
      if (oldest === undefined) break
      this.cache.delete(oldest)
    }
  }

  // --- Layer ---

  appliesTo(lightId: string): boolean {
    return this.colors !== null && this.isTarget(lightId) && !this.host.claimedByOther(this.id, lightId)
  }

  isAnimating(): boolean {
    return false
  }

  compose(below: LightOutput, ctx: ComposeContext): LightOutput | null {
    const colors = this.colors
    if (!colors || !below.power) return null
    const base = asAdjustable(below)
    const brightness = Math.max(MIN_BRIGHTNESS, luminance(below))
    if (colors.monochrome) {
      return { ...base, mode: 'white', colorTemp: 15, brightness }
    }
    const palette = this.settings.spreadColors ? colors.palette : [colors.primary]
    const c = palette[ctx.index % palette.length]
    return { ...base, mode: 'colour', h: c.h, s: c.s, brightness }
  }

  protected info(): Record<string, unknown> {
    const c = this.colors
    return {
      helper: this.monitor.isAvailable(),
      colors: c && !c.monochrome ? c.palette.map((p) => ({ h: p.h, s: p.s })) : [],
      monochrome: c?.monochrome ?? false
    }
  }

  /** Demo mode: pretend a track with the given colours is playing. */
  public async handleAction(action: string, payload: unknown): Promise<unknown> {
    if (action === 'simulate') {
      const o = asObj(payload)
      if (o.playing === false) {
        await this.handleMedia({ status: 'Paused', key: null, thumbnail: null })
        return { ok: true }
      }
      const hue = Number(o.hue ?? Math.floor(Math.random() * 360)) % 360
      const colors: ExtractedColors = {
        monochrome: false,
        primary: { h: hue, s: 90, v: 90 },
        palette: [
          { h: hue, s: 90, v: 90 },
          { h: (hue + 40) % 360, s: 85, v: 90 },
          { h: (hue + 300) % 360, s: 80, v: 90 }
        ]
      }
      const key = `demo${hue}`
      this.remember(key, colors)
      await this.handleMedia({ status: 'Playing', key, thumbnail: null })
      return { ok: true }
    }
    return super.handleAction(action, payload)
  }
}
