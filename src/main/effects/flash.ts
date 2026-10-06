import { Compositor, ComposeContext, Layer, LayerPriority } from './compositor'
import { LightOutput, asAdjustable, lerp, luminance } from './output'
import { HueSat } from './validate'

export interface FlashSpec {
  label: string
  targets: string[]
  /** Colour of the flash; null flashes the light's current colour at full brightness. */
  color: HueSat | null
  count: number
  onMs: number
  offMs: number
  /** Whether lights that are off take part. */
  includeOff: boolean
  brightness?: number
  /** Fade back to the underlying state when done. */
  releaseMs?: number
  priority?: LayerPriority
}

let seq = 0

/**
 * A short sequence of flashes shown on top of the composed state. During the
 * "on" part of each cycle the light shows the flash colour at full brightness,
 * during the "off" part the same colour dimmed, and afterwards it eases back to
 * whatever the layers underneath compose at that time.
 */
export class FlashLayer implements Layer {
  readonly id: string
  readonly label: string
  readonly priority: LayerPriority
  readonly releaseMs: number
  private readonly start: number
  private readonly period: number
  private readonly targets: Set<string>
  private finishedResolvers: Array<() => void> = []

  constructor(
    private spec: FlashSpec,
    now: number,
    maxFlashesPerSecond: number
  ) {
    this.id = `flash-${++seq}`
    this.label = spec.label
    this.priority = spec.priority ?? LayerPriority.GameOverlay
    this.releaseMs = spec.releaseMs ?? 350
    this.start = now
    this.targets = new Set(spec.targets)
    // Each cycle contains one flash, so a cycle can never be shorter than the cap allows.
    const minPeriod = Math.ceil(1000 / Math.max(1, maxFlashesPerSecond))
    this.period = Math.max(minPeriod, spec.onMs + spec.offMs)
  }

  appliesTo(lightId: string): boolean {
    return this.targets.has(lightId)
  }

  compose(below: LightOutput, ctx: ComposeContext): LightOutput | null {
    if (!below.power && !this.spec.includeOff) return null
    const elapsed = ctx.now - this.start
    if (elapsed < 0 || elapsed >= this.duration()) return null

    const onMs = Math.min(this.spec.onMs, this.period - 1)
    const inOnPhase = elapsed % this.period < onMs
    const full = this.spec.brightness ?? 100
    const peak = ctx.reduceIntensity ? lerp(luminance(below), full, 0.55) : full
    const base = asAdjustable(below)

    const colour: LightOutput = this.spec.color
      ? { ...base, power: true, mode: 'colour', h: this.spec.color.h, s: this.spec.color.s, brightness: peak }
      : { ...base, power: true, brightness: peak }

    if (inOnPhase) return colour
    if (!below.power) return { ...colour, power: false, brightness: 0 }
    return { ...colour, brightness: Math.max(3, peak * 0.12) }
  }

  isAnimating(now: number): boolean {
    return now - this.start < this.duration()
  }

  isFinished(now: number): boolean {
    const done = now - this.start >= this.duration()
    if (done) this.resolveFinished()
    return done
  }

  /** Resolves once the flash has finished and been released. */
  finished(): Promise<void> {
    return new Promise((resolve) => this.finishedResolvers.push(resolve))
  }

  resolveFinished(): void {
    const list = this.finishedResolvers
    this.finishedResolvers = []
    for (const r of list) r()
  }

  durationMs(): number {
    return this.spec.count * this.period
  }

  private duration(): number {
    return this.durationMs()
  }
}

/** Runs a flash through the compositor and resolves when it has finished. */
export function runFlash(compositor: Compositor, spec: FlashSpec, clock: () => number = Date.now): Promise<void> {
  if (spec.targets.length === 0 || spec.count <= 0) return Promise.resolve()
  const layer = new FlashLayer(spec, clock(), compositor.getFlashGuard().getMaxPerSecond())
  const done = layer.finished()
  compositor.addLayer(layer)
  // Never leave a caller waiting if the layer is dropped, for example on reload.
  let timer: NodeJS.Timeout | null = null
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, layer.durationMs() + 2000)
  })
  return Promise.race([done, timeout]).finally(() => {
    if (timer) clearTimeout(timer)
  })
}
