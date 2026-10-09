import { Effect, EffectHost, EffectSettingsBase } from '../Effect'
import { ComposeContext, Layer, LayerPriority } from '../compositor'
import { LightOutput, asAdjustable } from '../output'
import { asObj, bool, int, oneOf, str, targets } from '../validate'
import type { FrameResult, Placement } from '../../../shared/screen/analysis'
import type { SystemMonitor } from '../../system/systemMonitor'
import type { Light } from '../../devices/Light'
import type { PowerSource } from '../away/AwayEffect'
import { DisplayInfo, ScreenSource, ScreenSourceConfig, listDisplays } from './source'
import type { ScreenStats } from './validate'
import {
  BrightnessLimiter,
  MovieRamp,
  MOVIE_CEILING,
  MOVIE_RISE_PER_S,
  BulbColor,
  MODE_RESPONSE,
  SyncMode,
  SyncTuning,
  ZoneSmoother,
  perceptibleChange,
  timeConstants,
  zoneToBulb
} from './mapping'

export const SHORTCUTS = ['', 'CommandOrControl+Alt+S', 'CommandOrControl+Shift+S', 'CommandOrControl+Alt+L'] as const
export type Shortcut = (typeof SHORTCUTS)[number]

export interface ScreenSyncSettings extends EffectSettingsBase {
  mode: SyncMode
  responseSpeed: number
  saturation: number
  minBrightness: number
  maxBrightness: number
  /** Always output at maximum brightness, bypassing luminance dimming. */
  fullBrightness: boolean
  /** Width of the edge strips, in percent of the picture. */
  edgeWidth: number
  intensity: number
  ignoreBars: boolean
  dimDarkScenes: boolean
  limiter: boolean
  /** Movie mode: always colour, matched to the picture, off in dark scenes. */
  colourOnly: boolean
  /** Movie mode: turn off in dark scenes (otherwise they stay dim). */
  movieOffInDark: boolean
  /** Movie mode: share of Maximum brightness never exceeded, in percent. */
  movieCeiling: number
  /** Movie mode: the most brightness can rise per second, in points. */
  movieRise: number
  /** Movie mode: when Screen Sync stops, fade the lights back slowly and through darkness. */
  movieSlowStop: boolean
  /** '' captures the primary display. */
  displayId: string
  /** Global keyboard shortcut that toggles Screen Sync, or '' for none. */
  shortcut: Shortcut
}

/** Something on screen that stops Screen Sync from working well, shown in the UI. */
export type ScreenIssue =
  | 'no-positions'
  | 'all-paused'
  | 'protected'
  | 'exclusive'
  | 'display-missing'
  | 'capture-failed'
  | 'no-frames'
  | null

const START_FADE_MS = 600
const STOP_FADE_MS = 900
/** Movie mode hands the lights back this slowly, so a bright white never snaps on while you watch. */
const MOVIE_STOP_FADE_MS = 6000
/** Movie mode brings the lights in from darkness this slowly when Screen Sync starts. */
const MOVIE_START_FADE_MS = 3000
/** A picture that stays black this long while the computer is clearly in use suggests protected video. */
const BLACK_ALERT_MS = 4000
/** No frames for this long: the display is asleep or capture stalled. */
const NO_FRAMES_MS = 5000
const PREVIEW_SECONDS = 30
const LATENCY_SAMPLES = 40

/**
 * Screen Sync: lights follow the colours at the edges of the screen. Each
 * light with a position samples its part of the picture; analysis runs in a
 * hidden page, and this effect smooths the result and hands it to the
 * compositor, which sends it within each bulb's rate budget.
 *
 * Among ambient effects it comes first: on the lights it drives, Music and
 * Album color step aside, and they take over again with a fade when it stops.
 */
export class ScreenSyncEffect extends Effect<ScreenSyncSettings> implements Layer {
  readonly id = 'screen'
  readonly label = 'Screen Sync'
  readonly voiceName = 'Screen Sync'
  readonly description = 'Your lights follow the colours at the edges of your screen while you watch or play.'
  readonly ambient = true
  readonly priority = LayerPriority.ScreenSync

  private source: ScreenSource | null = null
  private placements: Placement[] = []
  private smoothers = new Map<string, ZoneSmoother>()
  private limiters = new Map<string, BrightnessLimiter>()
  private ramps = new Map<string, MovieRamp>()
  private emitted = new Map<string, BulbColor>()
  private lastFrameAt = 0
  private stats: ScreenStats | null = null
  private display: DisplayInfo | null = null
  private issue: ScreenIssue = null
  private captureError = ''
  private locked = false
  private previewUntil = 0
  private latencies: number[] = []
  private ackTimes: number[] = []
  private pendingFrame = new Map<string, number>()
  private ackListeners = new Map<Light, (ms: number) => void>()
  private statsTimer: NodeJS.Timeout | null = null
  private readonly powerListeners: Array<[string, () => void]>

  constructor(
    host: EffectHost,
    private createSource: (demo: boolean) => ScreenSource,
    private power: PowerSource,
    private monitor: SystemMonitor,
    private emitLive: (payload: unknown) => void,
    private clock: () => number = Date.now
  ) {
    super(host)
    this.init()
    this.powerListeners = [
      ['lock-screen', () => this.setLocked(true)],
      ['unlock-screen', () => this.setLocked(false)],
      ['suspend', () => this.setLocked(true)],
      ['resume', () => this.setLocked(false)]
    ]
  }

  defaults(): ScreenSyncSettings {
    return {
      enabled: false,
      targets: 'all',
      mode: 'cinema',
      responseSpeed: MODE_RESPONSE.cinema,
      saturation: 25,
      minBrightness: 8,
      maxBrightness: 100,
      fullBrightness: false,
      edgeWidth: 18,
      intensity: 100,
      ignoreBars: true,
      dimDarkScenes: true,
      limiter: true,
      colourOnly: false,
      movieOffInDark: true,
      movieCeiling: MOVIE_CEILING,
      movieRise: MOVIE_RISE_PER_S,
      movieSlowStop: true,
      displayId: '',
      shortcut: ''
    }
  }

  sanitize(raw: unknown): ScreenSyncSettings {
    const o = asObj(raw)
    const d = this.defaults()
    const mode = oneOf(o.mode, ['cinema', 'gaming', 'custom'] as const, d.mode)
    const minB = int(o.minBrightness, d.minBrightness, 0, 60)
    return {
      enabled: bool(o.enabled, false),
      targets: targets(o.targets),
      mode,
      responseSpeed: mode === 'custom' ? int(o.responseSpeed, d.responseSpeed, 0, 100) : MODE_RESPONSE[mode],
      saturation: int(o.saturation, d.saturation, 0, 100),
      minBrightness: minB,
      maxBrightness: Math.max(minB + 5, int(o.maxBrightness, d.maxBrightness, 10, 100)),
      fullBrightness: bool(o.fullBrightness, d.fullBrightness),
      edgeWidth: int(o.edgeWidth, d.edgeWidth, 5, 40),
      intensity: int(o.intensity, d.intensity, 10, 100),
      ignoreBars: bool(o.ignoreBars, d.ignoreBars),
      dimDarkScenes: bool(o.dimDarkScenes, d.dimDarkScenes),
      limiter: bool(o.limiter, d.limiter),
      colourOnly: bool(o.colourOnly, d.colourOnly),
      movieOffInDark: bool(o.movieOffInDark, d.movieOffInDark),
      movieCeiling: int(o.movieCeiling, d.movieCeiling, 10, 100),
      movieRise: int(o.movieRise, d.movieRise, 5, 100),
      movieSlowStop: bool(o.movieSlowStop, d.movieSlowStop),
      displayId: str(o.displayId, '', 40),
      shortcut: oneOf(o.shortcut, SHORTCUTS, d.shortcut)
    }
  }

  private tuning(): SyncTuning {
    const s = this.settings
    return {
      responseSpeed: s.responseSpeed,
      saturation: s.saturation,
      minBrightness: s.minBrightness,
      maxBrightness: s.maxBrightness,
      fullBrightness: s.fullBrightness,
      intensity: s.intensity,
      dimDarkScenes: s.dimDarkScenes,
      limiter: s.limiter,
      colourOnly: s.colourOnly,
      movieOffInDark: s.movieOffInDark,
      movieCeiling: s.movieCeiling,
      movieRise: s.movieRise
    }
  }

  // --- Lifecycle ---

  protected onStart(): void {
    for (const [event, fn] of this.powerListeners) this.power.on(event as 'lock-screen', fn)
    this.monitor.acquire(this.id)
    this.host.compositor.addLayer(this)
    this.attachAckListeners()
    this.refreshPlacements()
    this.startSource()
    this.statsTimer = setInterval(() => this.checkHealth(), 1000)
    this.updateStatus()
  }

  private startFadeMs(): number {
    return this.settings.colourOnly ? MOVIE_START_FADE_MS : START_FADE_MS
  }

  protected onStop(): void {
    for (const [event, fn] of this.powerListeners) this.power.removeListener(event, fn)
    this.monitor.release(this.id)
    this.stopSource()
    if (this.statsTimer) clearInterval(this.statsTimer)
    this.statsTimer = null
    this.detachAckListeners()
    const driven = this.drivenLightIds()
    this.clearState()
    this.locked = false
    // Hand the lights back to whatever is underneath, with a fade
    const slow = this.settings.colourOnly && this.settings.movieSlowStop
    this.host.compositor.removeLayer(this.id, slow ? MOVIE_STOP_FADE_MS : STOP_FADE_MS, slow)
    this.host.compositor.invalidate(driven, slow ? MOVIE_STOP_FADE_MS : STOP_FADE_MS, slow)
  }

  protected onSettingsChanged(): void {
    this.refreshPlacements(true)
    this.host.compositor.invalidate(this.drivenLightIds())
  }

  public onLightsChanged(): void {
    if (!this.running) return
    this.attachAckListeners()
    this.refreshPlacements()
  }

  private startSource(): void {
    if (this.source || this.locked) return
    const source = this.createSource(this.host.isDemo())
    this.source = source
    source.on('result', (r: FrameResult) => this.onResult(r))
    source.on('stats', (s: ScreenStats) => (this.stats = s))
    source.on('display', (d: DisplayInfo) => {
      this.display = d
      this.host.changed()
    })
    source.on('preview', (p: Record<string, unknown>) => {
      if (this.clock() < this.previewUntil) this.emitLive({ ...p, colors: this.currentColors() })
    })
    source.on('status', (s: { state: string; reason?: string; message?: string }) => {
      if (s.state === 'running') {
        this.captureError = ''
        if (this.issue === 'capture-failed' || this.issue === 'display-missing') this.issue = null
      } else if (s.reason === 'display-missing') {
        this.issue = 'display-missing'
      } else {
        this.issue = 'capture-failed'
        this.captureError = s.message || ''
      }
      this.updateStatus()
    })
    source.start(this.sourceConfig())
  }

  private stopSource(): void {
    this.source?.stop()
    this.source?.removeAllListeners()
    this.source = null
  }

  private clearState(): void {
    this.smoothers.clear()
    this.limiters.clear()
    this.ramps.clear()
    this.emitted.clear()
    this.pendingFrame.clear()
    this.lastFrameAt = 0
    this.stats = null
  }

  private setLocked(locked: boolean): void {
    if (!this.running || this.locked === locked) return
    this.locked = locked
    if (locked) {
      // Nothing to capture while locked or asleep: stop completely
      const driven = this.drivenLightIds()
      this.stopSource()
      this.clearState()
      const slow = this.settings.colourOnly && this.settings.movieSlowStop
      this.host.compositor.invalidate(driven, slow ? MOVIE_STOP_FADE_MS : STOP_FADE_MS, slow)
    } else {
      this.startSource()
    }
    this.updateStatus()
  }

  // --- Placements ---

  private lightsWithPositions(): Light[] {
    return this.host.getLights().filter((l) => this.isTarget(l.id) && l.position)
  }

  private refreshPlacements(force = false): void {
    const next = this.lightsWithPositions().map((l) => ({ lightId: l.id, position: l.position! }))
    const same = !force && next.length === this.placements.length && next.every((p, i) => p.lightId === this.placements[i].lightId && p.position === this.placements[i].position)
    if (same) return
    const removed = this.placements.filter((p) => !next.some((n) => n.lightId === p.lightId)).map((p) => p.lightId)
    this.placements = next
    for (const id of removed) {
      this.smoothers.delete(id)
      this.emitted.delete(id)
    }
    this.source?.configure(this.sourceConfig())
    if (removed.length) this.host.compositor.invalidate(removed, this.startFadeMs(), this.settings.colourOnly)
    this.updateStatus()
  }

  private sourceConfig(): ScreenSourceConfig {
    return {
      displayId: this.settings.displayId,
      placements: this.placements,
      edgeShare: this.settings.edgeWidth / 100,
      ignoreBars: this.settings.ignoreBars,
      preview: this.clock() < this.previewUntil
    }
  }

  // --- Frames ---

  private onResult(r: FrameResult): void {
    if (!this.running || this.locked) return
    const now = this.clock()
    const tc = timeConstants(this.settings.responseSpeed)
    const newlyDriven: string[] = []
    for (const [id, zone] of Object.entries(r.zones)) {
      if (!this.placements.some((p) => p.lightId === id)) continue
      let s = this.smoothers.get(id)
      if (!s) {
        s = new ZoneSmoother()
        this.smoothers.set(id, s)
        newlyDriven.push(id)
      }
      s.update(zone, now, r.sceneCut, tc)
    }
    this.lastFrameAt = r.at
    if (newlyDriven.length) {
      // Take lights over from whatever showed before with a fade
      this.host.compositor.invalidate(newlyDriven, this.startFadeMs(), this.settings.colourOnly)
      this.updateStatus()
    }
    this.host.compositor.wake()
  }

  // --- Layer ---

  /**
   * Lights Screen Sync has been showing colours on. Not filtered by target,
   * because at stop the effect no longer counts as running and the lights
   * still need to be handed back with a fade.
   */
  private drivenLightIds(): string[] {
    return Array.from(this.smoothers.keys())
  }

  public claims(lightId: string): boolean {
    return this.running && !this.locked && this.smoothers.has(lightId) && this.isTarget(lightId)
  }

  appliesTo(lightId: string): boolean {
    return this.claims(lightId)
  }

  isAnimating(): boolean {
    return this.running && !this.locked && this.smoothers.size > 0
  }

  compose(below: LightOutput, ctx: ComposeContext): LightOutput | null {
    if (!below.power) return null
    const state = this.smoothers.get(ctx.lightId)?.sample(ctx.now)
    if (!state) return null
    const tuning = this.tuning()
    let bulb = zoneToBulb(state, tuning)
    if (tuning.colourOnly) {
      let ramp = this.ramps.get(ctx.lightId)
      if (!ramp) {
        ramp = new MovieRamp()
        this.ramps.set(ctx.lightId, ramp)
      }
      bulb = { ...bulb, brightness: Math.round(ramp.apply(bulb.brightness, ctx.now, tuning.movieRise)) }
    }
    const prev = this.emitted.get(ctx.lightId) ?? null
    if (tuning.limiter) {
      let limiter = this.limiters.get(ctx.lightId)
      if (!limiter) {
        limiter = new BrightnessLimiter()
        this.limiters.set(ctx.lightId, limiter)
      }
      bulb = { ...bulb, brightness: Math.round(limiter.apply(prev?.brightness ?? null, bulb.brightness, ctx.now)) }
    }
    // Hold the last colour unless the change is one you would notice
    if (prev && !perceptibleChange(prev, bulb)) {
      bulb = prev
    } else {
      this.emitted.set(ctx.lightId, bulb)
      if (this.lastFrameAt) this.pendingFrame.set(ctx.lightId, this.lastFrameAt)
    }

    const base = asAdjustable(below)
    // An off frame keeps the mode the bulb is in, so the next on frame knows whether the mode has to change
    if (bulb.brightness < 1) return { ...base, power: false, mode: bulb.colour ? 'colour' : 'white', h: bulb.h, s: bulb.s }
    if (bulb.colour) return { ...base, power: true, mode: 'colour', h: bulb.h, s: bulb.s, brightness: bulb.brightness }
    return { ...base, power: true, mode: 'white', colorTemp: bulb.colorTemp, brightness: bulb.brightness }
  }

  // --- Latency ---

  private attachAckListeners(): void {
    this.detachAckListeners()
    for (const light of this.host.getLights()) {
      const fn = (ackMs: number): void => {
        this.ackTimes.push(ackMs)
        if (this.ackTimes.length > LATENCY_SAMPLES) this.ackTimes.shift()
        const frameAt = this.pendingFrame.get(light.id)
        if (!frameAt) return
        this.pendingFrame.delete(light.id)
        const e2e = this.clock() - frameAt
        if (e2e >= 0 && e2e < 5000) {
          this.latencies.push(e2e)
          if (this.latencies.length > LATENCY_SAMPLES) this.latencies.shift()
        }
      }
      light.on('ack', fn)
      this.ackListeners.set(light, fn)
    }
  }

  private detachAckListeners(): void {
    for (const [light, fn] of this.ackListeners) light.removeListener('ack', fn)
    this.ackListeners.clear()
  }

  private median(values: number[]): number | null {
    if (!values.length) return null
    const s = [...values].sort((a, b) => a - b)
    return Math.round(s[Math.floor(s.length / 2)])
  }

  // --- Health and status ---

  private checkHealth(): void {
    if (!this.running) return
    this.refreshPlacements()
    const st = this.stats
    let issue: ScreenIssue = this.issue === 'capture-failed' || this.issue === 'display-missing' ? this.issue : null
    if (!issue && this.placements.length === 0) {
      // Positioned lights that were changed by hand are paused, not missing
      const pausedWithPosition = this.host.getLights().some((l) => l.position && this.paused.has(l.id))
      issue = pausedWithPosition ? 'all-paused' : 'no-positions'
    }
    if (!issue && st && !this.host.isDemo()) {
      const exclusive = this.monitor.getSystem().exclusive
      const inUse = this.monitor.getMedia().status === 'Playing' || this.idleSeconds() < 60
      if (exclusive && (st.blackMs > BLACK_ALERT_MS || st.stillMs > NO_FRAMES_MS)) issue = 'exclusive'
      else if (st.blackMs > BLACK_ALERT_MS && inUse) issue = 'protected'
      else if (st.sinceFrameMs > NO_FRAMES_MS) issue = 'no-frames'
    }
    if (issue !== this.issue) {
      this.issue = issue
      this.updateStatus()
    }
    if (this.clock() < this.previewUntil || this.issue) this.host.changed()
  }

  private idleSeconds(): number {
    try {
      return this.power.getSystemIdleTime()
    } catch {
      return 0
    }
  }

  private updateStatus(): void {
    if (!this.running) return
    if (this.locked) return this.setStatus('waiting', 'Paused while the computer is locked')
    switch (this.issue) {
      case 'no-positions':
        return this.setStatus('waiting', 'Give your lights a position to start')
      case 'all-paused':
        return this.setStatus('waiting', 'Paused on the lights you changed by hand')
      case 'capture-failed':
        return this.setStatus('error', 'The screen could not be captured')
      case 'display-missing':
        return this.setStatus('waiting', 'The chosen display is not connected; using the main display')
      case 'protected':
        return this.setStatus('waiting', 'The picture looks black to Lumos')
      case 'exclusive':
        return this.setStatus('waiting', 'A full-screen game cannot be captured')
      case 'no-frames':
        return this.setStatus('waiting', 'Waiting for the screen')
    }
    if (this.smoothers.size === 0) return this.setStatus('waiting', 'Starting screen capture')
    this.setStatus('active', `Following ${this.display?.label ?? 'the screen'}`)
  }

  private currentColors(): Record<string, BulbColor> {
    return Object.fromEntries(this.emitted)
  }

  protected info(): Record<string, unknown> {
    const remote = (process.env.SESSIONNAME || '').toUpperCase().startsWith('RDP')
    return {
      issue: this.issue,
      captureError: this.captureError,
      display: this.display,
      placements: this.placements,
      colors: this.currentColors(),
      latencyMs: this.median(this.latencies),
      ackMs: this.median(this.ackTimes),
      analysisMs: this.stats ? Math.round(this.stats.analysisMs * 10) / 10 : null,
      framesPerSecond: this.stats?.analysedPerSecond ?? null,
      remoteSession: remote
    }
  }

  public async handleAction(action: string, payload: unknown): Promise<unknown> {
    const p = asObj(payload)
    if (action === 'displays') return this.host.isDemo() ? [] : listDisplays()
    if (action === 'preview') {
      this.previewUntil = p.on === true ? this.clock() + PREVIEW_SECONDS * 1000 : 0
      this.source?.configure(this.sourceConfig())
      return { ok: true }
    }
    return super.handleAction(action, payload)
  }
}
