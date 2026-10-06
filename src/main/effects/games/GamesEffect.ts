import { randomBytes } from 'crypto'
import { existsSync } from 'fs'
import { join, dirname } from 'path'
import { Effect, EffectHost, EffectSettingsBase } from '../Effect'
import { asObj, bool, hueSat, HueSat, int, str, targets } from '../validate'
import { HealthPulseLayer, HealthInput } from './healthPulse'
import {
  RL_DEFAULT_PORT,
  RL_PACKET_RATE,
  RlClient,
  RlEvent,
  RlMatchTracker,
  applyStatsApiSettings,
  readStatsApiSettings
} from './rocketLeague'
import { CS2_DEFAULT_PORT, Cs2Listener, Cs2State, buildGsiConfig, cs2ConfigPaths } from './cs2'
import { LeagueFetch, LeaguePoller, LeagueState } from './league'
import { findEpicGame, findSteamGame } from './installs'
import { readTextIfExists, revertGameConfig, writeGameConfig, backupPathFor } from './configFiles'
import { runFlash } from '../flash'

export interface RocketLeagueSettings {
  enabled: boolean
  playerName: string
  port: number
  useTeamColor: boolean
  ourGoalColor: HueSat
  theirGoalColor: HueSat
  neutralColor: HueSat
  flashCount: number
  flashMs: number
  cooldownSeconds: number
  matchStart: boolean
  matchEnd: boolean
  winColor: HueSat
  lossColor: HueSat
}

export interface GamesSettings extends EffectSettingsBase {
  rocketLeague: RocketLeagueSettings
  cs2: { enabled: boolean; port: number; token: string }
  league: { enabled: boolean }
  health: { threshold: number; color: HueSat }
  /** Whether lights that are off take part in goal flashes. */
  flashLightsThatAreOff: boolean
}

export interface InstallInfo {
  source: 'Steam' | 'Epic'
  path: string
  configPath: string
  /** Stats API enabled in the file. */
  configured: boolean
  hasBackup: boolean
}

type GameStatus = 'off' | 'waiting' | 'connected' | 'in-match' | 'error'

const GREEN: HueSat = { h: 130, s: 100 }
const RED: HueSat = { h: 0, s: 100 }
const NEUTRAL: HueSat = { h: 45, s: 30 }

function hexToHueSat(hex: string | null): HueSat | null {
  if (!hex) return null
  const r = parseInt(hex.slice(0, 2), 16) / 255
  const g = parseInt(hex.slice(2, 4), 16) / 255
  const b = parseInt(hex.slice(4, 6), 16) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  if (max === 0 || d / max < 0.15) return null // too grey to read as a team colour
  let h = 0
  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
  }
  return { h: Math.round((h * 60 + 360) % 360), s: 100 }
}

/**
 * Game integrations that use only official local interfaces: the Rocket League
 * Stats API, CS2 Game State Integration, and the League of Legends Live Client
 * Data API. No process memory is read and nothing is injected.
 */
export class GamesEffect extends Effect<GamesSettings> {
  readonly id = 'games'
  readonly label = 'Games'
  readonly voiceName = 'Game mode'
  readonly description = 'Flashes your lights for goals and pulses red when your health runs low.'

  private rl = new RlClient()
  private tracker = new RlMatchTracker('')
  private rlInMatch = false
  private lastFlashAt = 0
  private cs2: Cs2Listener | null = null
  private cs2Status: GameStatus = 'off'
  private cs2Error = ''
  private league: LeaguePoller
  private health: HealthPulseLayer
  private healthSource: 'cs2' | 'league' | null = null

  private clock: () => number

  constructor(host: EffectHost, deps: { clock?: () => number; leagueFetch?: LeagueFetch } = {}) {
    super(host)
    this.init()
    this.clock = deps.clock ?? Date.now
    this.league = new LeaguePoller(deps.leagueFetch)
    this.health = new HealthPulseLayer(
      (id) => this.isTarget(id),
      () => ({
        threshold: this.settings.health.threshold,
        color: this.settings.health.color,
        maxFlashesPerSecond: this.host.compositor.getFlashGuard().getMaxPerSecond()
      }),
      (fadeMs) => this.host.compositor.invalidate(this.targetIds(), fadeMs),
      () => {
        this.host.compositor.invalidate(this.targetIds())
        this.host.compositor.wake()
      }
    )
    this.rl.on('event', (e: RlEvent) => this.onRlEvent(e))
    this.rl.on('state', () => this.refreshStatus())
    this.league.on('state', (s: LeagueState) => this.onHealth('league', s))
    this.league.on('connected', () => this.refreshStatus())
    this.league.on('closed', () => this.onGameClosed('league'))
  }

  defaults(): GamesSettings {
    return {
      enabled: false,
      targets: 'all',
      rocketLeague: {
        enabled: true,
        playerName: '',
        port: RL_DEFAULT_PORT,
        useTeamColor: false,
        ourGoalColor: GREEN,
        theirGoalColor: RED,
        neutralColor: NEUTRAL,
        flashCount: 3,
        flashMs: 300,
        cooldownSeconds: 5,
        matchStart: false,
        matchEnd: true,
        winColor: GREEN,
        lossColor: RED
      },
      cs2: { enabled: true, port: CS2_DEFAULT_PORT, token: randomBytes(12).toString('hex') },
      league: { enabled: true },
      health: { threshold: 30, color: RED },
      flashLightsThatAreOff: false
    }
  }

  sanitize(raw: unknown): GamesSettings {
    const o = asObj(raw)
    const d = this.settings ?? this.defaults()
    const rl = asObj(o.rocketLeague)
    const drl = d.rocketLeague
    const cs = asObj(o.cs2)
    const lg = asObj(o.league)
    const hp = asObj(o.health)
    const token = typeof cs.token === 'string' && /^[0-9a-f]{16,64}$/.test(cs.token) ? cs.token : d.cs2.token
    return {
      enabled: bool(o.enabled, false),
      targets: targets(o.targets),
      rocketLeague: {
        enabled: bool(rl.enabled, drl.enabled),
        playerName: str(rl.playerName, drl.playerName, 64).trim(),
        port: int(rl.port, drl.port, 1024, 65535),
        useTeamColor: bool(rl.useTeamColor, drl.useTeamColor),
        ourGoalColor: hueSat(rl.ourGoalColor, drl.ourGoalColor),
        theirGoalColor: hueSat(rl.theirGoalColor, drl.theirGoalColor),
        neutralColor: hueSat(rl.neutralColor, drl.neutralColor),
        flashCount: int(rl.flashCount, drl.flashCount, 1, 6),
        flashMs: int(rl.flashMs, drl.flashMs, 150, 1000),
        cooldownSeconds: int(rl.cooldownSeconds, drl.cooldownSeconds, 0, 60),
        matchStart: bool(rl.matchStart, drl.matchStart),
        matchEnd: bool(rl.matchEnd, drl.matchEnd),
        winColor: hueSat(rl.winColor, drl.winColor),
        lossColor: hueSat(rl.lossColor, drl.lossColor)
      },
      cs2: { enabled: bool(cs.enabled, d.cs2.enabled), port: int(cs.port, d.cs2.port, 1024, 65535), token },
      league: { enabled: bool(lg.enabled, d.league.enabled) },
      health: { threshold: int(hp.threshold, d.health.threshold, 5, 90), color: hueSat(hp.color, d.health.color) },
      flashLightsThatAreOff: bool(o.flashLightsThatAreOff, d.flashLightsThatAreOff)
    }
  }

  protected async onStart(): Promise<void> {
    const s = this.settings
    this.tracker.setPlayerName(s.rocketLeague.playerName)
    this.host.compositor.addLayer(this.health)
    if (s.rocketLeague.enabled) this.rl.start(s.rocketLeague.port)
    if (s.league.enabled) this.league.start()
    if (s.cs2.enabled) await this.startCs2()
    this.refreshStatus()
  }

  protected onStop(): void {
    this.rl.stop()
    this.league.stop()
    this.cs2?.stop()
    this.cs2?.removeAllListeners()
    this.cs2 = null
    this.cs2Status = 'off'
    this.rlInMatch = false
    this.healthSource = null
    this.health.reset(this.clock())
    this.host.compositor.removeLayer(this.health.id, 600)
  }

  private async startCs2(): Promise<void> {
    const listener = new Cs2Listener(this.settings.cs2.port, this.settings.cs2.token)
    listener.on('state', (s: Cs2State) => {
      this.cs2Status = s.inMatch ? 'in-match' : 'connected'
      // Health of a spectated teammate is not yours
      this.onHealth('cs2', s.isLocalPlayer ? s : { ...s, inMatch: false })
    })
    listener.on('closed', () => this.onGameClosed('cs2'))
    this.cs2 = listener
    try {
      await listener.start()
      this.cs2Status = 'waiting'
      this.cs2Error = ''
    } catch (err) {
      this.cs2Status = 'error'
      const code = (err as NodeJS.ErrnoException)?.code
      this.cs2Error = code === 'EADDRINUSE' ? `Port ${this.settings.cs2.port} is in use by another app` : 'Could not listen for CS2'
    }
  }

  private targetIds(): string[] {
    return this.host.getLights().map((l) => l.id).filter((id) => this.isTarget(id))
  }

  // --- Health (CS2, League) ---

  private onHealth(source: 'cs2' | 'league', input: HealthInput): void {
    if (!this.running) return
    // One source at a time; whichever is in a match wins
    if (this.healthSource && this.healthSource !== source && this.health.isActive() && !input.inMatch) return
    if (input.inMatch) this.healthSource = source
    this.health.update(input, this.clock())
    this.refreshStatus()
  }

  private onGameClosed(source: 'cs2' | 'league'): void {
    if (source === 'cs2') this.cs2Status = this.cs2?.isListening() ? 'waiting' : this.cs2Status
    if (this.healthSource === source) {
      this.health.update({ inMatch: false, alive: true, health: 1 }, this.clock())
      this.healthSource = null
    }
    this.refreshStatus()
  }

  // --- Rocket League ---

  private onRlEvent(e: RlEvent): void {
    if (!this.running) return
    this.tracker.update(e)
    const rl = this.settings.rocketLeague
    if (e.type === 'state' && !this.rlInMatch) {
      this.rlInMatch = true
      this.refreshStatus()
    } else if (e.type === 'matchDestroyed') {
      this.rlInMatch = false
      this.refreshStatus()
    } else if (e.type === 'goal') {
      const outcome = this.tracker.goalOutcome(e.scorer)
      const teamColor = rl.useTeamColor ? hexToHueSat(this.tracker.teamColor(this.tracker.getMyTeam())) : null
      const color =
        outcome === 'ours' ? (teamColor ?? rl.ourGoalColor) : outcome === 'theirs' ? rl.theirGoalColor : rl.neutralColor
      this.flash(outcome === 'ours' ? 'Your goal' : outcome === 'theirs' ? 'Opponent goal' : 'Goal', color, rl.flashCount)
    } else if (e.type === 'matchEnded' && rl.matchEnd) {
      const outcome = this.tracker.matchOutcome(e.winnerTeamNum)
      if (outcome !== 'unknown') {
        this.flash(outcome === 'win' ? 'Win' : 'Loss', outcome === 'win' ? rl.winColor : rl.lossColor, 2, true)
      }
    } else if (e.type === 'matchStart' && rl.matchStart) {
      const teamColor = hexToHueSat(this.tracker.teamColor(this.tracker.getMyTeam()))
      this.flash('Kickoff', teamColor ?? rl.neutralColor, 1, true)
    }
  }

  /** Starts a goal style flash unless one ran within the cooldown. */
  private flash(label: string, color: HueSat, count: number, ignoreCooldown = false): boolean {
    const now = this.clock()
    const rl = this.settings.rocketLeague
    if (!ignoreCooldown && now - this.lastFlashAt < rl.cooldownSeconds * 1000) return false
    const ids = this.targetIds()
    if (ids.length === 0) return false
    this.lastFlashAt = now
    void runFlash(this.host.compositor, {
      label,
      targets: ids,
      color,
      count,
      onMs: rl.flashMs,
      offMs: rl.flashMs,
      includeOff: this.settings.flashLightsThatAreOff
    })
    return true
  }

  // --- Status ---

  private rlStatus(): GameStatus {
    if (!this.running || !this.settings.rocketLeague.enabled) return 'off'
    const c = this.rl.getState()
    if (c !== 'connected') return 'waiting'
    return this.rlInMatch ? 'in-match' : 'connected'
  }

  private leagueStatus(): GameStatus {
    if (!this.running || !this.settings.league.enabled) return 'off'
    return this.league.isInGame() ? 'in-match' : 'waiting'
  }

  private refreshStatus(): void {
    if (!this.running) return
    const statuses = [this.rlStatus(), this.cs2Status, this.leagueStatus()]
    if (this.health.isActive()) {
      this.setStatus('active', 'Low health')
    } else if (statuses.includes('in-match') || statuses.includes('connected')) {
      this.setStatus('active', 'Connected to a game')
    } else if (this.cs2Status === 'error' && statuses.every((s) => s === 'off' || s === 'error')) {
      this.setStatus('error', this.cs2Error)
    } else {
      this.setStatus('waiting', 'Waiting for a game')
    }
    this.host.changed()
  }

  protected info(): Record<string, unknown> {
    return {
      rocketLeague: { status: this.rlStatus(), team: this.tracker.getMyTeam() },
      cs2: { status: this.running && this.settings.cs2.enabled ? this.cs2Status : 'off', error: this.cs2Error },
      league: { status: this.leagueStatus() },
      health: this.health.isActive()
    }
  }

  // --- Setup actions ---

  public async handleAction(action: string, payload: unknown): Promise<unknown> {
    const p = asObj(payload)
    switch (action) {
      case 'rl-detect':
        return this.detectRocketLeague()
      case 'rl-enable': {
        const install = this.findInstall(str(p.path, '', 1024))
        const current = readTextIfExists(install.configPath) ?? ''
        const next = applyStatsApiSettings(current, {
          packetSendRate: RL_PACKET_RATE,
          port: this.settings.rocketLeague.port
        })
        const res = await writeGameConfig(install.configPath, next, join(this.host.dataDir, 'backups'))
        return { ...res, restartRequired: true, installs: this.detectRocketLeague() }
      }
      case 'rl-revert': {
        const install = this.findInstall(str(p.path, '', 1024))
        const result = await revertGameConfig(install.configPath, false)
        return { result, restartRequired: true, installs: this.detectRocketLeague() }
      }
      case 'cs2-detect':
        return this.detectCs2()
      case 'cs2-install': {
        const path = this.findCs2Path(str(p.path, '', 1024))
        const content = buildGsiConfig(this.settings.cs2.port, this.settings.cs2.token)
        const res = await writeGameConfig(path, content, join(this.host.dataDir, 'backups'))
        return { ...res, restartRequired: true, installs: this.detectCs2() }
      }
      case 'cs2-remove': {
        const path = this.findCs2Path(str(p.path, '', 1024))
        const result = await revertGameConfig(path, true)
        return { result, installs: this.detectCs2() }
      }
      case 'test-flash': {
        const rl = this.settings.rocketLeague
        const kind = str(p.kind, 'ours', 10)
        const color = kind === 'theirs' ? rl.theirGoalColor : kind === 'neutral' ? rl.neutralColor : rl.ourGoalColor
        return { started: this.flash('Test flash', color, rl.flashCount, true) }
      }
      case 'simulate':
        return this.simulate(p)
      default:
        return super.handleAction(action, payload)
    }
  }

  private findInstall(path: string): InstallInfo {
    const install = this.detectRocketLeague().find((i) => i.path === path)
    if (!install) throw new Error('That Rocket League install was not found')
    return install
  }

  private findCs2Path(path: string): string {
    const found = cs2ConfigPaths().find((p) => p === path)
    if (!found) throw new Error('That Counter-Strike 2 install was not found')
    return found
  }

  public detectRocketLeague(): InstallInfo[] {
    const installs: InstallInfo[] = []
    const add = (source: 'Steam' | 'Epic', path: string): void => {
      const configPath = join(path, 'TAGame', 'Config', 'DefaultStatsAPI.ini')
      const text = readTextIfExists(configPath)
      const settings = text ? readStatsApiSettings(text) : { packetSendRate: null, port: null }
      installs.push({
        source,
        path,
        configPath,
        configured: (settings.packetSendRate ?? 0) > 0,
        hasBackup: existsSync(backupPathFor(configPath))
      })
    }
    for (const p of findSteamGame('rocketleague')) add('Steam', p)
    for (const p of findEpicGame((name, app) => name === 'Rocket League' || app === 'Sugar')) add('Epic', p)
    return installs
  }

  public detectCs2(): Array<{ path: string; installed: boolean; gameFolder: string }> {
    return cs2ConfigPaths().map((path) => ({
      path,
      installed: existsSync(path),
      gameFolder: dirname(dirname(dirname(dirname(path))))
    }))
  }

  // --- Demo simulation ---

  private simulate(p: Record<string, unknown>): unknown {
    const now = this.clock()
    const event = str(p.event, '', 30)
    if (event === 'goal-ours' || event === 'goal-theirs') {
      this.tracker.setPlayerName('Demo Player')
      this.tracker.update({
        type: 'state',
        players: [{ name: 'Demo Player', teamNum: 0 }],
        teams: [
          { teamNum: 0, name: 'Blue', colorPrimary: '1873FF' },
          { teamNum: 1, name: 'Orange', colorPrimary: 'FF8A15' }
        ],
        replay: false
      })
      this.lastFlashAt = 0
      this.onRlEvent({ type: 'goal', scorer: { name: 'x', teamNum: event === 'goal-ours' ? 0 : 1 } })
      this.tracker.setPlayerName(this.settings.rocketLeague.playerName)
      return { ok: true }
    }
    if (event === 'health') {
      const health = Math.max(0, Math.min(1, Number(p.health ?? 0.2)))
      this.healthSource = 'league'
      this.health.update({ inMatch: true, alive: health > 0, health }, now)
      this.refreshStatus()
      return { ok: true }
    }
    if (event === 'health-end') {
      this.health.update({ inMatch: false, alive: true, health: 1 }, now)
      this.healthSource = null
      this.refreshStatus()
      return { ok: true }
    }
    throw new Error('Unknown simulation')
  }
}
