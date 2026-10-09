import { Effect, EffectHost, EffectSettingsBase } from '../Effect'
import { ComposeContext, Layer, LayerPriority } from '../compositor'
import { LightOutput, asAdjustable, luminance } from '../output'
import { asObj, bool, int, targets } from '../validate'
import type { MusicFeatures } from '../../../shared/audio/analysis'
import type { MusicSource } from '../music/capture'
import { flameFlicker, fireplaceOutput } from './fireLogic'

export interface FireplaceSettings extends EffectSettingsBase {
  /** Maximum flame brightness intensity (10..100, default 80). */
  intensity: number
  /** Speed of flame movement and flicker (10..100, default 50). */
  flameSpeed: number
  /** Whether the flame flares up with computer audio / bass energy (default true). */
  acoustic: boolean
  /** Offsets hearth flicker phase across lights so each dances independently (default true). */
  wave: boolean
}

const FADE_MS = 1500

/**
 * Procedural organic hearth flame and ember glow effect.
 * Produces deep charcoal ember tones and dancing golden flames, with optional
 * acoustic reactivity that flares brightness on audio swells.
 */
export class FireplaceEffect extends Effect<FireplaceSettings> implements Layer {
  readonly id = 'fireplace'
  readonly label = 'Acoustic Fireplace'
  readonly voiceName = 'Fireplace'
  readonly description = 'Warm organic flame and ember glow with acoustic reactivity to sound on this computer.'
  readonly ambient = true
  readonly priority = LayerPriority.Ambient

  private source: MusicSource | null = null
  private audioEnergy = 0

  constructor(
    host: EffectHost,
    private createSource: (demo: boolean) => MusicSource
  ) {
    super(host)
    this.init()
  }

  defaults(): FireplaceSettings {
    return {
      enabled: false,
      targets: 'all',
      intensity: 80,
      flameSpeed: 50,
      acoustic: true,
      wave: true
    }
  }

  sanitize(raw: unknown): FireplaceSettings {
    const o = asObj(raw)
    const d = this.defaults()
    return {
      enabled: bool(o.enabled, false),
      targets: targets(o.targets),
      intensity: int(o.intensity, d.intensity, 10, 100),
      flameSpeed: int(o.flameSpeed, d.flameSpeed, 10, 100),
      acoustic: bool(o.acoustic, d.acoustic),
      wave: bool(o.wave, d.wave)
    }
  }

  protected onStart(): void {
    this.audioEnergy = 0
    if (this.settings.acoustic) {
      this.startAudioSource()
    }
    this.host.compositor.addLayer(this, FADE_MS)
    this.setStatus('active', 'Embers glowing and dancing')
    this.host.compositor.wake()
  }

  protected onStop(): void {
    this.stopAudioSource()
    this.host.compositor.removeLayer(this.id, FADE_MS)
  }

  protected onSettingsChanged(prev: FireplaceSettings): void {
    if (this.settings.acoustic !== prev.acoustic) {
      if (this.settings.acoustic) this.startAudioSource()
      else this.stopAudioSource()
    }
    this.host.compositor.invalidate(this.targetIds())
    this.host.compositor.wake()
  }

  private startAudioSource(): void {
    if (this.source) return
    try {
      const source = this.createSource(this.host.isDemo())
      this.source = source
      source.on('features', (f: MusicFeatures) => {
        if (!this.running) return
        // Low band and overall energy feed the flame
        this.audioEnergy = f.silent ? 0 : Math.max(f.low * 0.8, f.loudness * 0.6)
      })
      source.start({ sensitivity: 0.6, minBeatIntervalMs: 250 })
    } catch {
      // Audio capture unavailable, continues in pure procedural mode
      this.source = null
    }
  }

  private stopAudioSource(): void {
    if (this.source) {
      try {
        this.source.stop()
        this.source.removeAllListeners()
      } catch {
        // ignore stop error
      }
      this.source = null
    }
    this.audioEnergy = 0
  }

  private targetIds(): string[] {
    return this.host.getLights().map((l) => l.id).filter((id) => this.isTarget(id))
  }

  // --- Layer ---

  appliesTo(lightId: string): boolean {
    return this.running && this.isTarget(lightId) && !this.host.claimedByOther(this.id, lightId) && !this.paused.has(lightId)
  }

  isAnimating(): boolean {
    return this.running
  }

  compose(below: LightOutput, ctx: ComposeContext): LightOutput | null {
    if (!this.running || !below.power) return null
    if (!ctx.capabilities.hasColor) return null

    const phase = this.settings.wave && ctx.count > 1 ? ctx.index * 1.8 : 0
    const params = flameFlicker(ctx.now, this.settings.flameSpeed, phase)
    const baseBri = luminance(below)

    const flame = fireplaceOutput(
      baseBri,
      params,
      this.audioEnergy,
      this.settings.acoustic,
      this.settings.intensity
    )

    const brightness = ctx.reduceIntensity ? Math.min(flame.brightness, 60) : flame.brightness

    return {
      ...asAdjustable(below),
      power: true,
      mode: 'colour',
      h: flame.h,
      s: flame.s,
      brightness
    }
  }
}
