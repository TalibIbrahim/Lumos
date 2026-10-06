import type { Light } from '../devices/Light'
import type { Compositor } from './compositor'

export type EffectStatus = 'off' | 'waiting' | 'active' | 'error'

export interface EffectSettingsBase {
  enabled: boolean
  /** 'all' or a list of light ids. */
  targets: 'all' | string[]
}

export interface EffectSnapshot {
  id: string
  label: string
  description: string
  status: EffectStatus
  statusDetail: string
  settings: EffectSettingsBase & Record<string, unknown>
  pausedLights: string[]
  info: Record<string, unknown>
}

export interface EffectHost {
  compositor: Compositor
  getLights(): Light[]
  isDemo(): boolean
  /** Asks the host to broadcast a fresh snapshot to the UI. */
  changed(): void
  /** Persists settings for this effect. */
  persist(): void
  /** Directory under the user data folder for effect-owned files. */
  dataDir: string
}

/** What happened to a light when the user changed it by hand. */
export type ManualOutcome = 'paused' | 'released' | null

/**
 * Base class for effects. An effect owns its settings, timers, sockets and
 * listeners, and contributes to the light output only through compositor
 * layers. Starting and stopping must be idempotent and must release everything.
 */
export abstract class Effect<S extends EffectSettingsBase = EffectSettingsBase> {
  abstract readonly id: string
  abstract readonly label: string
  abstract readonly description: string
  /** Name of the HomeKit switch, chosen to read naturally after "turn on". */
  readonly voiceName?: string
  /**
   * Ambient effects (music, album colour) give a light back to the user when
   * it is changed by hand, until the user resumes it.
   */
  readonly ambient: boolean = false

  protected settings!: S
  protected status: EffectStatus = 'off'
  protected statusDetail = ''
  protected paused = new Set<string>()
  protected running = false

  constructor(protected host: EffectHost) {}

  /** Must be called by subclasses' constructors after fields are initialized. */
  protected init(): void {
    this.settings = this.defaults()
  }

  abstract defaults(): S
  /** Validates and normalizes untrusted settings, filling gaps from defaults. */
  abstract sanitize(raw: unknown): S
  protected abstract onStart(): void | Promise<void>
  protected abstract onStop(): void
  /** Called when settings change while running. Default restarts the effect. */
  protected onSettingsChanged(prev: S): void {
    void prev
    this.restart()
  }

  public getSettings(): S {
    return this.settings
  }

  public isEnabled(): boolean {
    return this.settings.enabled
  }

  public isRunning(): boolean {
    return this.running
  }

  public loadSettings(raw: unknown): void {
    this.settings = this.sanitize(raw)
  }

  public updateSettings(patch: Record<string, unknown>): S {
    const prev = this.settings
    const merged = { ...prev, ...(patch && typeof patch === 'object' ? patch : {}) }
    // 'enabled' is controlled through setEnabled only
    merged.enabled = prev.enabled
    this.settings = this.sanitize(merged)
    this.host.persist()
    if (this.running) this.onSettingsChanged(prev)
    this.host.changed()
    return this.settings
  }

  public async setEnabled(on: boolean): Promise<void> {
    if (this.settings.enabled === on && this.running === on) return
    this.settings = { ...this.settings, enabled: on }
    this.host.persist()
    if (on) await this.start()
    else this.stop()
  }

  public async start(): Promise<void> {
    if (this.running) return
    this.running = true
    this.paused.clear()
    this.setStatus('waiting', '')
    try {
      await this.onStart()
    } catch (err) {
      this.setStatus('error', err instanceof Error ? err.message : 'Could not start')
    }
    this.host.changed()
  }

  public stop(): void {
    if (!this.running) return
    this.running = false
    try {
      this.onStop()
    } catch (err) {
      console.warn(`[Lumos Effects] ${this.id} stop error:`, err)
    }
    this.paused.clear()
    this.setStatus('off', '')
  }

  public restart(): void {
    if (!this.running) return
    this.stop()
    void this.start()
  }

  /** True when the effect should affect this light right now. */
  public isTarget(lightId: string): boolean {
    if (!this.running || this.paused.has(lightId)) return false
    const t = this.settings.targets
    return t === 'all' || t.includes(lightId)
  }

  /** Target lights that currently exist, in a stable order. */
  protected targetLights(): Light[] {
    return this.host.getLights().filter((l) => this.isTarget(l.id))
  }

  public onManualChange(lightId: string): ManualOutcome {
    if (!this.ambient || !this.isTarget(lightId) || this.status !== 'active') return null
    this.paused.add(lightId)
    this.host.changed()
    return 'paused'
  }

  public resumeLight(lightId: string): void {
    if (!this.paused.delete(lightId)) return
    this.host.compositor.invalidate([lightId], 600)
    this.host.changed()
  }

  public resumeAll(): void {
    const ids = Array.from(this.paused)
    this.paused.clear()
    this.host.compositor.invalidate(ids, 600)
    this.host.changed()
  }

  /** Called after the set of lights is reloaded. */
  public onLightsChanged(): void {
    // Default: nothing; layers query targets on every frame.
  }

  /** Effect-specific actions from the UI, such as installing a game config file. */
  public async handleAction(action: string, payload: unknown): Promise<unknown> {
    void payload
    throw new Error(`Unknown action: ${action}`)
  }

  /** Effect-specific information for the UI. */
  protected info(): Record<string, unknown> {
    return {}
  }

  protected setStatus(status: EffectStatus, detail = ''): void {
    if (this.status === status && this.statusDetail === detail) return
    this.status = status
    this.statusDetail = detail
    this.host.changed()
  }

  public getStatus(): EffectStatus {
    return this.status
  }

  public snapshot(): EffectSnapshot {
    return {
      id: this.id,
      label: this.label,
      description: this.description,
      status: this.status,
      statusDetail: this.statusDetail,
      settings: this.settings as EffectSettingsBase & Record<string, unknown>,
      pausedLights: Array.from(this.paused),
      info: this.info()
    }
  }
}
