import { EventEmitter } from 'events'
import type { Light } from '../devices/Light'
import type { DeviceCapabilities } from '../types'
import { FlashGuard } from './safety'
import { LightOutput, blendOutput, easeInOutCubic, outputsEqual, quantize } from './output'

/**
 * Layer priorities. Lower numbers win: they are applied last, on top of
 * everything below them. The base state (manual control, scenes and
 * automations) sits underneath all layers.
 */
export enum LayerPriority {
  Idle = 1,
  GameOverlay = 2,
  Music = 3,
  NowPlaying = 4
}

export interface ComposeContext {
  now: number
  lightId: string
  capabilities: DeviceCapabilities
  /** The light's base state, before any layer. */
  base: LightOutput
  /** Position of this light among the lights the layer applies to, for wave offsets. */
  index: number
  count: number
  reduceIntensity: boolean
}

export interface Layer {
  readonly id: string
  readonly label: string
  readonly priority: LayerPriority
  appliesTo(lightId: string): boolean
  /** Returns the output to show given the output composed below, or null to pass it through. */
  compose(below: LightOutput, ctx: ComposeContext): LightOutput | null
  /** True while the layer's output changes over time and needs frames. */
  isAnimating(now: number): boolean
  /** Transient layers report true once done; the compositor then removes them. */
  isFinished?(now: number): boolean
  /** Fade used when a finished layer is removed. */
  releaseMs?: number
}

export interface CompositorOptions {
  /** Per-device command budget. */
  ratePerSecond: number
  /** Frame interval while something animates. */
  frameMs: number
  flashGuard: FlashGuard
  clock: () => number
}

interface Fade {
  from: LightOutput
  start: number
  duration: number
}

interface Channel {
  light: Light
  tokens: number
  lastRefill: number
  wakeTimer: NodeJS.Timeout | null
  fade: Fade | null
  lastComposed: LightOutput | null
  topLayer: Layer | null
  onOnline: () => void
}

/** Commands a device may receive back to back before the rate budget applies. */
const BURST = 2
/** How long device reports are ignored after an output that differs from the base state. */
const ECHO_WINDOW_MS = 2000

/**
 * The state compositor owns every write to the bulbs. Effects contribute
 * layers; base state changes arrive through each light's output sink. For each
 * light it composes base plus layers, applies fades and the flash-rate cap,
 * and sends the result within the per-device rate budget, dropping stale
 * frames rather than queueing them.
 */
export class Compositor extends EventEmitter {
  private channels = new Map<string, Channel>()
  private layers: Layer[] = []
  private loopTimer: NodeJS.Timeout | null = null
  private ratePerSecond: number
  private frameMs: number
  private guard: FlashGuard
  private clock: () => number
  private destroyed = false

  constructor(options: Partial<CompositorOptions> = {}) {
    super()
    this.ratePerSecond = Math.max(1, Math.min(30, options.ratePerSecond ?? 12))
    this.frameMs = Math.max(16, options.frameMs ?? 33)
    this.guard = options.flashGuard ?? new FlashGuard()
    this.clock = options.clock ?? Date.now
  }

  // --- Configuration ---

  public setRatePerSecond(rate: number): void {
    this.ratePerSecond = Math.max(1, Math.min(30, Math.round(rate)))
  }

  public getRatePerSecond(): number {
    return this.ratePerSecond
  }

  public getFlashGuard(): FlashGuard {
    return this.guard
  }

  // --- Lights ---

  /** Takes ownership of output for the given lights, replacing any previous set. */
  public attach(lights: Light[]): void {
    this.detachAll()
    const now = this.clock()
    for (const light of lights) {
      const ch: Channel = {
        light,
        tokens: BURST,
        lastRefill: now,
        wakeTimer: null,
        fade: null,
        lastComposed: null,
        topLayer: null,
        onOnline: () => this.handleOnline(light.id)
      }
      light.outputSink = (l) => this.handleBaseChange(l)
      light.on('online', ch.onOnline)
      this.channels.set(light.id, ch)
    }
    this.invalidate()
  }

  private detachAll(): void {
    for (const ch of this.channels.values()) {
      if (ch.wakeTimer) clearTimeout(ch.wakeTimer)
      ch.light.outputSink = undefined
      ch.light.activeEffect = undefined
      ch.light.removeListener('online', ch.onOnline)
      this.guard.forget(ch.light.id)
    }
    this.channels.clear()
  }

  public getLightIds(): string[] {
    return Array.from(this.channels.keys())
  }

  public getLight(id: string): Light | undefined {
    return this.channels.get(id)?.light
  }

  /** Last composed output for a light, for diagnostics and tests. */
  public getOutput(lightId: string): LightOutput | null {
    return this.channels.get(lightId)?.lastComposed ?? null
  }

  public getTopLayerId(lightId: string): string | null {
    return this.channels.get(lightId)?.topLayer?.id ?? null
  }

  // --- Layers ---

  public addLayer(layer: Layer, fadeMs = 0): void {
    this.layers = this.layers.filter((l) => l.id !== layer.id)
    this.layers.push(layer)
    // Apply lowest priority first so higher priority layers end up on top.
    this.layers.sort((a, b) => b.priority - a.priority)
    this.invalidate(this.lightsFor(layer), fadeMs)
  }

  public removeLayer(id: string, fadeMs = 0): void {
    const layer = this.layers.find((l) => l.id === id)
    if (!layer) return
    const affected = this.lightsFor(layer)
    this.layers = this.layers.filter((l) => l.id !== id)
    this.invalidate(affected, fadeMs)
  }

  public hasLayer(id: string): boolean {
    return this.layers.some((l) => l.id === id)
  }

  /**
   * Recomposes the given lights (all when omitted). With a fade, the change is
   * eased from whatever the lights currently show.
   */
  public invalidate(lightIds?: string[], fadeMs = 0): void {
    if (this.destroyed) return
    const now = this.clock()
    const ids = lightIds ?? Array.from(this.channels.keys())
    for (const id of ids) {
      const ch = this.channels.get(id)
      if (!ch) continue
      if (fadeMs > 0 && ch.lastComposed) {
        ch.fade = { from: ch.lastComposed, start: now, duration: fadeMs }
      }
      this.render(ch, now)
    }
    this.ensureLoop()
  }

  /** Called by layers that start animating so frames begin promptly. */
  public wake(): void {
    this.ensureLoop()
  }

  private lightsFor(layer: Layer): string[] {
    return Array.from(this.channels.keys()).filter((id) => layer.appliesTo(id))
  }

  // --- Composition ---

  private handleBaseChange(light: Light): Promise<boolean> {
    const ch = this.channels.get(light.id)
    if (!ch) return light.sendOutput(light.baseOutput())
    const result = this.render(ch, this.clock())
    this.ensureLoop()
    return result
  }

  private handleOnline(lightId: string): void {
    const ch = this.channels.get(lightId)
    if (!ch) return
    // The bulb may have lost effect output while offline; resend in full.
    if (ch.topLayer || ch.fade) {
      ch.light.invalidateOutput()
      this.render(ch, this.clock())
      this.ensureLoop()
    }
  }

  private compose(ch: Channel, now: number): { output: LightOutput; top: Layer | null } {
    const light = ch.light
    const base = light.baseOutput()
    let output = base
    let top: Layer | null = null
    for (const layer of this.layers) {
      if (!layer.appliesTo(light.id)) continue
      const targets = this.lightsFor(layer)
      const result = layer.compose(output, {
        now,
        lightId: light.id,
        capabilities: light.capabilities,
        base,
        index: Math.max(0, targets.indexOf(light.id)),
        count: Math.max(1, targets.length),
        reduceIntensity: this.guard.isReducedIntensity()
      })
      if (result) {
        output = result
        top = layer
      }
    }
    return { output, top }
  }

  private render(ch: Channel, now: number): Promise<boolean> {
    const light = ch.light
    const { output: target, top } = this.compose(ch, now)

    let output = target
    if (ch.fade) {
      const t = (now - ch.fade.start) / ch.fade.duration
      if (t >= 1) {
        ch.fade = null
      } else {
        output = blendOutput(ch.fade.from, target, easeInOutCubic(t))
      }
    }

    if (top !== ch.topLayer) {
      ch.topLayer = top
      const label = top?.label
      if (light.activeEffect !== label) {
        light.activeEffect = label
        light.emitState()
      }
      this.emit('top-layer', light.id, top?.id ?? null)
    }

    ch.lastComposed = output
    return this.submit(ch, output, now, Boolean(top || ch.fade))
  }

  private submit(ch: Channel, output: LightOutput, now: number, effectDriven: boolean): Promise<boolean> {
    const light = ch.light
    if (!light.isConnected && !light.isDemo) return Promise.resolve(false)

    const differsFromBase = !outputsEqual(output, light.baseOutput())
    if (differsFromBase || effectDriven) {
      light.suppressReportsUntil = Date.now() + ECHO_WINDOW_MS
    }

    if (outputsEqual(light.lastSentOutput, output) && !light.hasForcedFields()) {
      return Promise.resolve(true)
    }

    this.refill(ch, now)
    if (ch.tokens < 1) {
      this.scheduleWake(ch)
      return Promise.resolve(true)
    }

    let toSend = quantize(output)
    if (effectDriven) {
      toSend = this.guard.apply(light.id, light.lastSentOutput, toSend, now)
    }

    ch.tokens -= 1
    if (!outputsEqual(toSend, output)) {
      // The cap softened this frame; come back to finish the change gradually.
      this.scheduleWake(ch)
    }
    return light.sendOutput(toSend)
  }

  private refill(ch: Channel, now: number): void {
    const elapsed = Math.max(0, now - ch.lastRefill)
    ch.tokens = Math.min(BURST, ch.tokens + (elapsed * this.ratePerSecond) / 1000)
    ch.lastRefill = now
  }

  private scheduleWake(ch: Channel): void {
    if (ch.wakeTimer || this.destroyed) return
    const needed = Math.max(0, 1 - ch.tokens)
    const delay = Math.max(1, Math.ceil((needed * 1000) / this.ratePerSecond))
    ch.wakeTimer = setTimeout(() => {
      ch.wakeTimer = null
      // Latest wins: recompose now rather than sending the frame that was dropped.
      this.render(ch, this.clock())
    }, delay)
  }

  // --- Frame loop ---

  private needsFrames(now: number): boolean {
    for (const ch of this.channels.values()) {
      if (ch.fade) return true
    }
    return this.layers.some((l) => l.isAnimating(now) || Boolean(l.isFinished))
  }

  private ensureLoop(): void {
    if (this.loopTimer || this.destroyed) return
    if (!this.needsFrames(this.clock())) return
    this.loopTimer = setTimeout(() => this.tick(), this.frameMs)
  }

  private tick(): void {
    this.loopTimer = null
    if (this.destroyed) return
    const now = this.clock()

    for (const layer of [...this.layers]) {
      if (layer.isFinished?.(now)) {
        this.removeLayer(layer.id, layer.releaseMs ?? 300)
      }
    }

    const animating = this.layers.filter((l) => l.isAnimating(now))
    for (const ch of this.channels.values()) {
      if (ch.fade || animating.some((l) => l.appliesTo(ch.light.id))) {
        this.render(ch, now)
      }
    }
    this.ensureLoop()
  }

  /**
   * Drops every layer and sends each light its base state right away, outside
   * the rate budget. Used on quit so bulbs are not left showing an effect.
   */
  public async releaseAll(timeoutMs = 800): Promise<void> {
    this.layers = []
    const sends: Promise<boolean>[] = []
    for (const ch of this.channels.values()) {
      ch.fade = null
      if (ch.wakeTimer) {
        clearTimeout(ch.wakeTimer)
        ch.wakeTimer = null
      }
      const light = ch.light
      const base = light.baseOutput()
      if (outputsEqual(light.lastSentOutput, base)) continue
      if (!light.isConnected && !light.isDemo) continue
      sends.push(light.sendOutput(base).catch(() => false))
    }
    if (sends.length === 0) return
    await Promise.race([Promise.all(sends), new Promise((r) => setTimeout(r, timeoutMs))])
  }

  public destroy(): void {
    this.destroyed = true
    if (this.loopTimer) clearTimeout(this.loopTimer)
    this.loopTimer = null
    this.layers = []
    this.detachAll()
  }
}
