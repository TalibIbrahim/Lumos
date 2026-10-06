import { EventEmitter } from 'events'
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'fs'
import { join } from 'path'
import type { Light } from '../devices/Light'
import { Compositor } from './compositor'
import { Effect, EffectHost, EffectSnapshot } from './Effect'
import { FlashGuard, MAX_FLASHES_PER_SECOND } from './safety'
import { FlashSpec, runFlash } from './flash'
import { asObj, bool, int } from './validate'

export interface GlobalEffectSettings {
  /** Per-device command budget. */
  ratePerSecond: number
  /** Global flash-rate cap, never above MAX_FLASHES_PER_SECOND. */
  maxFlashesPerSecond: number
  reduceIntensity: boolean
  /** Effects that were on when the app closed start again on launch. */
  resumeOnLaunch: boolean
}

export const DEFAULT_GLOBAL_SETTINGS: GlobalEffectSettings = {
  ratePerSecond: 12,
  maxFlashesPerSecond: MAX_FLASHES_PER_SECOND,
  reduceIntensity: false,
  resumeOnLaunch: true
}

export interface EffectsSnapshot {
  global: GlobalEffectSettings
  effects: EffectSnapshot[]
}

export interface PausedNotice {
  effectId: string
  effectLabel: string
  lightIds: string[]
  lightNames: string[]
}

export interface LightSource {
  getAllLights(): Light[]
  getIsDemoMode(): boolean
}

export function sanitizeGlobal(raw: unknown): GlobalEffectSettings {
  const o = asObj(raw)
  const d = DEFAULT_GLOBAL_SETTINGS
  return {
    ratePerSecond: int(o.ratePerSecond, d.ratePerSecond, 2, 20),
    maxFlashesPerSecond: int(o.maxFlashesPerSecond, d.maxFlashesPerSecond, 1, MAX_FLASHES_PER_SECOND),
    reduceIntensity: bool(o.reduceIntensity, d.reduceIntensity),
    resumeOnLaunch: bool(o.resumeOnLaunch, d.resumeOnLaunch)
  }
}

/**
 * Owns the compositor and every effect: registration, persisted settings,
 * status broadcasts, and the hand-off between manual control and effects.
 */
export class EffectManager extends EventEmitter {
  readonly compositor: Compositor
  private effects = new Map<string, Effect>()
  private global: GlobalEffectSettings = { ...DEFAULT_GLOBAL_SETTINGS }
  private storedEffectSettings: Record<string, unknown> = {}
  private readonly filePath: string
  private readonly host: EffectHost
  private persistTimer: NodeJS.Timeout | null = null
  private changeTimer: NodeJS.Timeout | null = null
  private shuttingDown = false
  private demo: boolean | null = null
  private demoListeners: Array<(demo: boolean) => void> = []
  private shutdownHooks: Array<() => void> = []

  constructor(
    private lights: LightSource,
    dataDir: string
  ) {
    super()
    const guard = new FlashGuard()
    this.compositor = new Compositor({ flashGuard: guard })
    const effectsDir = join(dataDir, 'effects')
    try {
      if (!existsSync(effectsDir)) mkdirSync(effectsDir, { recursive: true })
    } catch {
      // Effects that need files report errors themselves
    }
    this.filePath = join(dataDir, 'effects.json')
    this.host = {
      compositor: this.compositor,
      getLights: () => this.lights.getAllLights(),
      isDemo: () => this.lights.getIsDemoMode(),
      changed: () => this.scheduleChanged(),
      persist: () => this.schedulePersist(),
      dataDir: effectsDir
    }
    this.load()
    this.applyGlobal()
  }

  public getHost(): EffectHost {
    return this.host
  }

  // --- Registration and lifecycle ---

  public register(effect: Effect): void {
    this.effects.set(effect.id, effect)
    const stored = this.storedEffectSettings[effect.id]
    if (stored !== undefined) {
      effect.loadSettings(stored)
      if (!this.global.resumeOnLaunch) {
        effect.loadSettings({ ...asObj(stored), enabled: false })
      }
    }
  }

  public get(id: string): Effect | undefined {
    return this.effects.get(id)
  }

  public list(): Effect[] {
    return Array.from(this.effects.values())
  }

  /** Hands the current lights to the compositor. Call after lights load or reload. */
  public attachLights(): void {
    this.compositor.attach(this.lights.getAllLights())
    const demo = this.lights.getIsDemoMode()
    if (demo !== this.demo) {
      const first = this.demo === null
      this.demo = demo
      for (const fn of this.demoListeners) fn(demo)
      // Effects pick real or simulated sources when they start
      if (!first) for (const effect of this.effects.values()) effect.restart()
    }
    for (const effect of this.effects.values()) effect.onLightsChanged()
    this.scheduleChanged()
  }

  public onDemoChange(fn: (demo: boolean) => void): void {
    this.demoListeners.push(fn)
  }

  public onShutdown(fn: () => void): void {
    this.shutdownHooks.push(fn)
  }

  /** Live data for an open settings sheet, such as the music level meter. */
  public emitLive(effectId: string, payload: unknown): void {
    this.emit('live', { effectId, payload })
  }

  /** Starts every effect whose persisted state is enabled. */
  public async startEnabled(): Promise<void> {
    for (const effect of this.effects.values()) {
      if (effect.isEnabled()) await effect.start()
    }
    this.scheduleChanged()
  }

  public async shutdown(): Promise<void> {
    this.shuttingDown = true
    for (const effect of this.effects.values()) effect.stop()
    await this.compositor.releaseAll()
    this.compositor.destroy()
    for (const fn of this.shutdownHooks) {
      try {
        fn()
      } catch {
        // keep shutting down
      }
    }
    if (this.changeTimer) clearTimeout(this.changeTimer)
    this.flushPersist()
  }

  // --- Commands ---

  public async setEnabled(id: string, on: boolean): Promise<EffectsSnapshot> {
    const effect = this.effects.get(id)
    if (!effect) throw new Error(`Unknown effect: ${id}`)
    await effect.setEnabled(Boolean(on))
    this.scheduleChanged()
    return this.snapshot()
  }

  public updateSettings(id: string, patch: unknown): EffectsSnapshot {
    const effect = this.effects.get(id)
    if (!effect) throw new Error(`Unknown effect: ${id}`)
    effect.updateSettings(asObj(patch))
    return this.snapshot()
  }

  public updateGlobal(patch: unknown): EffectsSnapshot {
    this.global = sanitizeGlobal({ ...this.global, ...asObj(patch) })
    this.applyGlobal()
    this.schedulePersist()
    this.scheduleChanged()
    return this.snapshot()
  }

  public getGlobal(): GlobalEffectSettings {
    return this.global
  }

  public resumeLight(effectId: string, lightIds: string[]): EffectsSnapshot {
    const effect = this.effects.get(effectId)
    if (effect) for (const id of lightIds) effect.resumeLight(id)
    return this.snapshot()
  }

  public async action(effectId: string, action: string, payload: unknown): Promise<unknown> {
    const effect = this.effects.get(effectId)
    if (!effect) throw new Error(`Unknown effect: ${effectId}`)
    return effect.handleAction(String(action), payload)
  }

  /** Runs a transient flash through the compositor. */
  public flash(spec: FlashSpec): Promise<void> {
    return runFlash(this.compositor, spec)
  }

  /**
   * Called before a light is changed by hand. Ambient effects let go of the
   * light and a notice is emitted so the UI can offer a one-click resume.
   */
  public markManual(lightIds: string[]): void {
    const notices = new Map<string, PausedNotice>()
    for (const id of lightIds) {
      for (const effect of this.effects.values()) {
        const outcome = effect.onManualChange(id)
        if (outcome === 'paused') {
          const light = this.lights.getAllLights().find((l) => l.id === id)
          const n = notices.get(effect.id) || {
            effectId: effect.id,
            effectLabel: effect.label,
            lightIds: [],
            lightNames: []
          }
          n.lightIds.push(id)
          n.lightNames.push(light?.customName || light?.name || 'Light')
          notices.set(effect.id, n)
        }
      }
    }
    for (const n of notices.values()) this.emit('paused', n)
    if (lightIds.length > 0) {
      // The manual change itself renders the light; this catches changes that
      // left the base state as it was.
      queueMicrotask(() => this.compositor.invalidate(lightIds))
    }
  }

  // --- Snapshot and broadcast ---

  public snapshot(): EffectsSnapshot {
    return {
      global: this.global,
      effects: Array.from(this.effects.values()).map((e) => e.snapshot())
    }
  }

  private scheduleChanged(): void {
    if (this.changeTimer || this.shuttingDown) return
    this.changeTimer = setTimeout(() => {
      this.changeTimer = null
      this.emit('snapshot', this.snapshot())
    }, 40)
  }

  // --- Persistence ---

  private applyGlobal(): void {
    this.compositor.setRatePerSecond(this.global.ratePerSecond)
    this.compositor.getFlashGuard().configure({
      maxPerSecond: this.global.maxFlashesPerSecond,
      reduceIntensity: this.global.reduceIntensity
    })
  }

  private load(): void {
    if (!existsSync(this.filePath)) return
    try {
      // Tolerate a byte order mark from files edited in other tools
      const parsed = asObj(JSON.parse(readFileSync(this.filePath, 'utf-8').trimStart()))
      this.global = sanitizeGlobal(parsed.global)
      this.storedEffectSettings = asObj(parsed.effects)
    } catch (err) {
      console.warn('[Lumos Effects] Could not read effect settings, using defaults:', err)
    }
  }

  private schedulePersist(): void {
    if (this.persistTimer) return
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null
      this.flushPersist()
    }, 300)
  }

  private flushPersist(): void {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer)
      this.persistTimer = null
    }
    const effects: Record<string, unknown> = { ...this.storedEffectSettings }
    for (const effect of this.effects.values()) effects[effect.id] = effect.getSettings()
    const data = { version: 1, global: this.global, effects }
    try {
      const tmp = `${this.filePath}.tmp`
      writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8')
      renameSync(tmp, this.filePath)
    } catch (err) {
      console.error('[Lumos Effects] Could not save effect settings:', err)
    }
  }
}
