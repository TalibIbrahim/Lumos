import { Effect, EffectHost, EffectSettingsBase, ManualOutcome } from '../Effect'
import { ComposeContext, Layer, LayerPriority } from '../compositor'
import { LightOutput, asAdjustable, luminance } from '../output'
import { asObj, bool, int, oneOf, targets } from '../validate'
import { AwayAction, AwayDecision, decideAway, nextIdleCheckMs } from './awayLogic'
import type { SystemMonitor } from '../../system/systemMonitor'

export interface AwaySettings extends EffectSettingsBase {
  idleMinutes: number
  idleAction: AwayAction
  /** Brightness, in percent, that lights dim to. */
  dimPercent: number
  lockAction: AwayAction | 'none'
  stayOnDuringMedia: boolean
  /** How the lights come back: a gentle fade or straight away. */
  restore: 'fade' | 'instant'
}

/** The part of Electron's powerMonitor this effect uses. */
export interface PowerSource {
  on(event: 'lock-screen' | 'unlock-screen' | 'suspend' | 'resume', listener: () => void): unknown
  removeListener(event: string, listener: () => void): unknown
  getSystemIdleTime(): number
}

const DIM_FADE_MS = 4000
const RESTORE_FADE_MS = 1500

/**
 * Dims or turns off lights when the computer is idle, locked, or asleep, and
 * brings them back when someone returns. The layer is a transform of the
 * state underneath, so restoring always lands on the current composed state,
 * including changes made by hand while away.
 */
export class AwayEffect extends Effect<AwaySettings> implements Layer {
  readonly id = 'away'
  readonly label = 'Away dimming'
  readonly voiceName = 'Away mode'
  readonly description = 'Dims your lights when you step away from the computer and brings them back when you return.'
  readonly priority = LayerPriority.Idle

  private decision: AwayDecision = { away: false, heldByMedia: false }
  private locked = false
  private suspended = false
  private simulatedIdle: number | null = null
  private released = new Set<string>()
  private pollTimer: NodeJS.Timeout | null = null
  private readonly listeners: Array<[string, () => void]>

  constructor(
    host: EffectHost,
    private power: PowerSource,
    private monitor: SystemMonitor
  ) {
    super(host)
    this.init()
    this.listeners = [
      ['lock-screen', () => this.setFlag('locked', true)],
      ['unlock-screen', () => this.setFlag('locked', false)],
      ['suspend', () => this.setFlag('suspended', true)],
      ['resume', () => this.setFlag('suspended', false)]
    ]
  }

  defaults(): AwaySettings {
    return {
      enabled: false,
      targets: 'all',
      idleMinutes: 5,
      idleAction: 'dim',
      dimPercent: 15,
      lockAction: 'dim',
      stayOnDuringMedia: true,
      restore: 'fade'
    }
  }

  sanitize(raw: unknown): AwaySettings {
    const o = asObj(raw)
    const d = this.defaults()
    return {
      enabled: bool(o.enabled, d.enabled),
      targets: targets(o.targets),
      idleMinutes: int(o.idleMinutes, d.idleMinutes, 1, 120),
      idleAction: oneOf(o.idleAction, ['dim', 'off'] as const, d.idleAction),
      dimPercent: int(o.dimPercent, d.dimPercent, 1, 80),
      lockAction: oneOf(o.lockAction, ['dim', 'off', 'none'] as const, d.lockAction),
      stayOnDuringMedia: bool(o.stayOnDuringMedia, d.stayOnDuringMedia),
      restore: oneOf(o.restore, ['fade', 'instant'] as const, d.restore)
    }
  }

  protected onStart(): void {
    for (const [event, fn] of this.listeners) this.power.on(event as 'lock-screen', fn)
    if (this.settings.stayOnDuringMedia) this.monitor.acquire(this.id)
    this.host.compositor.addLayer(this)
    // Forced so the status line is filled in from the start
    this.evaluate(true)
  }

  protected onStop(): void {
    for (const [event, fn] of this.listeners) this.power.removeListener(event, fn)
    this.monitor.release(this.id)
    if (this.pollTimer) clearTimeout(this.pollTimer)
    this.pollTimer = null
    const wasAway = this.decision.away
    this.decision = { away: false, heldByMedia: false }
    this.released.clear()
    this.host.compositor.removeLayer(this.id, wasAway ? RESTORE_FADE_MS : 0)
  }

  protected onSettingsChanged(): void {
    if (this.settings.stayOnDuringMedia) this.monitor.acquire(this.id)
    else this.monitor.release(this.id)
    this.evaluate(true)
  }

  // --- Layer ---

  appliesTo(lightId: string): boolean {
    return this.decision.away && this.isTarget(lightId) && !this.released.has(lightId)
  }

  compose(below: LightOutput, ctx: ComposeContext): LightOutput | null {
    void ctx
    if (!this.decision.away || !below.power) return null
    if (this.decision.action === 'off') return { ...below, power: false }
    const target = Math.min(luminance(below), this.settings.dimPercent)
    return { ...asAdjustable(below), brightness: Math.max(1, target) }
  }

  isAnimating(): boolean {
    return false
  }

  // --- Behaviour ---

  public onManualChange(lightId: string): ManualOutcome {
    // A light changed by hand (for example from a phone) while away keeps the
    // new setting; it is released until everyone is back.
    if (this.decision.away && this.isTarget(lightId) && !this.released.has(lightId)) {
      this.released.add(lightId)
      return 'released'
    }
    return null
  }

  private setFlag(flag: 'locked' | 'suspended', value: boolean): void {
    this[flag] = value
    this.evaluate()
  }

  private mediaActive(): boolean {
    if (!this.settings.stayOnDuringMedia) return false
    const media = this.monitor.getMedia()
    const sys = this.monitor.getSystem()
    return media.status === 'Playing' || sys.fullscreen || this.monitor.isAudible()
  }

  private idleSeconds(): number {
    if (this.simulatedIdle !== null) return this.simulatedIdle
    try {
      return this.power.getSystemIdleTime()
    } catch {
      return 0
    }
  }

  private evaluate(force = false): void {
    if (!this.running) return
    const idle = this.idleSeconds()
    const next = decideAway(
      { idleSeconds: idle, locked: this.locked, suspended: this.suspended, mediaActive: this.mediaActive() },
      this.settings
    )
    const changed =
      force ||
      next.away !== this.decision.away ||
      (next.away && this.decision.away && next.action !== this.decision.action) ||
      (!next.away && !this.decision.away && next.heldByMedia !== this.decision.heldByMedia)

    if (changed) {
      const wasAway = this.decision.away
      const affected = this.host.getLights().map((l) => l.id).filter((id) => this.isTarget(id))
      this.decision = next
      if (!next.away) this.released.clear()
      const fade = next.away
        ? next.reason === 'suspend'
          ? 0 // the machine is going to sleep; there is no time for a fade
          : DIM_FADE_MS
        : wasAway && this.settings.restore === 'fade'
          ? RESTORE_FADE_MS
          : 0
      this.host.compositor.invalidate(affected, fade)
      this.updateStatus()
    }

    if (this.pollTimer) clearTimeout(this.pollTimer)
    this.pollTimer = setTimeout(
      () => {
        this.pollTimer = null
        this.evaluate()
      },
      nextIdleCheckMs(idle, this.settings.idleMinutes, this.decision.away || this.locked)
    )
  }

  private updateStatus(): void {
    const d = this.decision
    if (d.away) {
      const why = d.reason === 'idle' ? 'You are away' : d.reason === 'lock' ? 'The computer is locked' : 'The computer is asleep'
      this.setStatus('active', `${why}; lights ${d.action === 'off' ? 'off' : 'dimmed'}`)
    } else if (d.heldByMedia) {
      this.setStatus('waiting', 'Staying on while media plays')
    } else {
      this.setStatus('waiting', `Dims after ${this.settings.idleMinutes} min of inactivity`)
    }
  }

  protected info(): Record<string, unknown> {
    return {
      away: this.decision.away,
      reason: this.decision.away ? this.decision.reason : null,
      mediaHelper: this.monitor.isAvailable(),
      releasedLights: Array.from(this.released)
    }
  }

  /** Demo mode and tests: pretend the computer has been idle for the given seconds. */
  public async handleAction(action: string, payload: unknown): Promise<unknown> {
    if (action === 'simulate') {
      const o = asObj(payload)
      this.simulatedIdle = o.away === true ? this.settings.idleMinutes * 60 + 1 : o.away === false ? 0 : null
      this.evaluate()
      return { away: this.decision.away }
    }
    return super.handleAction(action, payload)
  }
}
