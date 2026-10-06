import { Effect, EffectHost, EffectSettingsBase } from '../Effect'
import { ComposeContext, Layer, LayerPriority } from '../compositor'
import { LightOutput, asAdjustable, luminance, outputsEqual } from '../output'
import { MAX_FLASHES_PER_SECOND } from '../safety'
import { asObj, bool, hueSat, HueSat, int, oneOf, targets } from '../validate'
import type { MusicFeatures } from '../../../shared/audio/analysis'
import type { MusicSource } from './capture'
import { PALETTES, PaletteName, driftRate, paletteColor, pulseBrightness, pulseEnvelope } from './mapping'

export interface MusicSettings extends EffectSettingsBase {
  /** 0..100, how easily beats are detected. */
  sensitivity: number
  palette: PaletteName
  customColors: HueSat[]
  /** 0..100, how far brightness moves on a beat. */
  pulseDepth: number
  /** 0..100, how quickly colours drift through the palette. */
  driftSpeed: number
  maxBeatsPerSecond: number
  /** Offset colours across lights so they move like a wave. */
  wave: boolean
  /** Pause and restore the lights after this many seconds without sound. */
  silenceSeconds: number
}

const RESUME_FADE_MS = 800
const PAUSE_FADE_MS = 1500
const METER_INTERVAL_MS = 66

/**
 * Lights that follow the music playing on this computer. Beats become gentle
 * brightness pulses and the colour drifts through a palette. When Album color
 * is also on, its colour is used as the base hue and Music adds the pulses.
 */
export class MusicEffect extends Effect<MusicSettings> implements Layer {
  readonly id = 'music'
  readonly label = 'Music'
  readonly voiceName = 'Music mode'
  readonly description = 'Your lights pulse with the beat and drift through colours while music plays on this computer.'
  readonly ambient = true
  readonly priority = LayerPriority.Music

  private source: MusicSource | null = null
  private features: MusicFeatures | null = null
  private lastBeatAt = -Infinity
  private beatStrength = 0
  private position = 0
  private lastAdvance = 0
  private silentSince: number | null = null
  private quiet = true
  private meterUntil = 0
  private lastMeterAt = 0

  constructor(
    host: EffectHost,
    private createSource: (demo: boolean) => MusicSource,
    private emitLive: (payload: unknown) => void,
    private clock: () => number = Date.now
  ) {
    super(host)
    this.init()
  }

  defaults(): MusicSettings {
    return {
      enabled: false,
      targets: 'all',
      sensitivity: 60,
      palette: 'aurora',
      customColors: [
        { h: 280, s: 90 },
        { h: 200, s: 90 },
        { h: 330, s: 90 }
      ],
      pulseDepth: 50,
      driftSpeed: 40,
      maxBeatsPerSecond: 2,
      wave: true,
      silenceSeconds: 8
    }
  }

  sanitize(raw: unknown): MusicSettings {
    const o = asObj(raw)
    const d = this.defaults()
    const custom = Array.isArray(o.customColors)
      ? o.customColors.slice(0, 5).map((c) => hueSat(c, { h: 0, s: 90 }))
      : d.customColors
    return {
      enabled: bool(o.enabled, false),
      targets: targets(o.targets),
      sensitivity: int(o.sensitivity, d.sensitivity, 0, 100),
      palette: oneOf(o.palette, ['aurora', 'sunset', 'ocean', 'neon', 'custom'] as const, d.palette),
      customColors: custom.length >= 2 ? custom : d.customColors,
      pulseDepth: int(o.pulseDepth, d.pulseDepth, 0, 100),
      driftSpeed: int(o.driftSpeed, d.driftSpeed, 0, 100),
      maxBeatsPerSecond: int(o.maxBeatsPerSecond, d.maxBeatsPerSecond, 1, MAX_FLASHES_PER_SECOND),
      wave: bool(o.wave, d.wave),
      silenceSeconds: int(o.silenceSeconds, d.silenceSeconds, 2, 120)
    }
  }

  private captureConfig(): { sensitivity: number; minBeatIntervalMs: number } {
    const cap = Math.min(this.settings.maxBeatsPerSecond, this.host.compositor.getFlashGuard().getMaxPerSecond())
    return { sensitivity: this.settings.sensitivity / 100, minBeatIntervalMs: Math.ceil(1000 / cap) }
  }

  protected onStart(): void {
    this.quiet = true
    this.features = null
    this.silentSince = null
    this.position = Math.random()
    this.lastAdvance = this.clock()
    const source = this.createSource(this.host.isDemo())
    this.source = source
    source.on('features', (f: MusicFeatures) => this.onFeatures(f))
    source.on('status', (s: { state: string; message?: string }) => {
      if (s.state === 'error') this.setStatus('error', s.message || 'Audio capture failed')
      else if (this.quiet) this.setStatus('waiting', 'Listening for music')
    })
    this.host.compositor.addLayer(this)
    this.setStatus('waiting', 'Starting audio analysis')
    source.start(this.captureConfig())
  }

  protected onStop(): void {
    this.source?.stop()
    this.source?.removeAllListeners()
    this.source = null
    const wasPlaying = !this.quiet
    this.quiet = true
    this.host.compositor.removeLayer(this.id, wasPlaying ? PAUSE_FADE_MS : 0)
  }

  protected onSettingsChanged(): void {
    this.source?.configure(this.captureConfig())
    this.host.compositor.invalidate(this.targetIds())
  }

  private targetIds(): string[] {
    return this.host.getLights().map((l) => l.id).filter((id) => this.isTarget(id))
  }

  private onFeatures(f: MusicFeatures): void {
    if (!this.running) return
    const now = this.clock()
    this.features = f
    if (f.beat) {
      this.lastBeatAt = now
      this.beatStrength = Math.max(0.35, f.beatStrength)
    }

    if (f.silent) {
      if (this.silentSince === null) this.silentSince = now
      if (!this.quiet && now - this.silentSince >= this.settings.silenceSeconds * 1000) {
        this.quiet = true
        this.host.compositor.invalidate(this.targetIds(), PAUSE_FADE_MS)
        this.setStatus('waiting', 'Paused while nothing is playing')
      }
    } else {
      this.silentSince = null
      if (this.quiet) {
        this.quiet = false
        this.lastAdvance = now
        this.host.compositor.invalidate(this.targetIds(), RESUME_FADE_MS)
        this.host.compositor.wake()
        this.setStatus('active', 'Following the music')
      }
    }

    if (now < this.meterUntil && now - this.lastMeterAt >= METER_INTERVAL_MS) {
      this.lastMeterAt = now
      this.emitLive({ loudness: f.loudness, low: f.low, beat: f.beat, tempo: f.tempo, silent: f.silent })
    }
  }

  // --- Layer ---

  appliesTo(lightId: string): boolean {
    return !this.quiet && this.isTarget(lightId)
  }

  isAnimating(): boolean {
    return this.running && !this.quiet
  }

  compose(below: LightOutput, ctx: ComposeContext): LightOutput | null {
    if (this.quiet || !this.features || !below.power) return null
    const now = ctx.now
    this.advance(now)

    const depth = (this.settings.pulseDepth / 100) * (ctx.reduceIntensity ? 0.5 : 1)
    const pulse = pulseEnvelope(now - this.lastBeatAt, this.beatStrength, this.features.tempo)
    const brightness = pulseBrightness(luminance(below), pulse, this.features.low, depth)

    // Album colour (a colour layer underneath) supplies the hue; otherwise drift the palette.
    const fromAlbum = below.mode === 'colour' && !outputsEqual(below, ctx.base)
    let colour: HueSat
    if (fromAlbum) {
      colour = { h: below.h, s: below.s }
    } else {
      const palette = this.settings.palette === 'custom' ? this.settings.customColors : PALETTES[this.settings.palette]
      const offset = this.settings.wave && ctx.count > 1 ? (ctx.index / ctx.count) * 0.5 : 0
      colour = paletteColor(palette, this.position + offset)
    }
    return { ...asAdjustable(below), power: true, mode: 'colour', h: colour.h, s: colour.s, brightness }
  }

  private advance(now: number): void {
    if (now <= this.lastAdvance) return
    const dt = (now - this.lastAdvance) / 1000
    this.lastAdvance = now
    this.position = (this.position + dt * driftRate(this.settings.driftSpeed / 100, this.features?.energy ?? 0.5)) % 1
  }

  protected info(): Record<string, unknown> {
    return { tempo: this.features?.tempo ?? null, playing: !this.quiet }
  }

  public async handleAction(action: string, payload: unknown): Promise<unknown> {
    if (action === 'meter') {
      // The settings sheet asks for the live level while it is open
      this.meterUntil = asObj(payload).on === true ? this.clock() + 30000 : 0
      return { ok: true }
    }
    return super.handleAction(action, payload)
  }
}
