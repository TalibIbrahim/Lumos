/**
 * Rocket League Stats API.
 *
 * The game broadcasts JSON over a local WebSocket (default port 49123) once
 * PacketSendRate in <Install Dir>\TAGame\Config\DefaultStatsAPI.ini is above
 * zero. Every message is { "Event": string, "Data": object }. Field names here
 * follow the official Stats API reference.
 */
import { EventEmitter } from 'events'
import WebSocket from 'ws'
import { asObj, isObj, num, str } from '../validate'

export const RL_DEFAULT_PORT = 49123
/** Used only when the shipped file has no section of its own to add the keys to. */
export const RL_STATS_SECTION = 'TAGame.MatchStatsExporter_TA'
/** Packets per second we ask for. Events are sent on the tick they happen regardless. */
export const RL_PACKET_RATE = 10
const MAX_MESSAGE_BYTES = 1024 * 1024

export interface RlPlayerRef {
  name: string
  teamNum: number
}

export interface RlPlayer extends RlPlayerRef {
  /**
   * The API includes live car details (boost, speed and so on) only for
   * players on your own team, or for everyone when you spectate.
   */
  detailed: boolean
}

export interface RlTeam {
  teamNum: number
  name: string
  colorPrimary: string | null // hex without '#'
}

export type RlEvent =
  | { type: 'state'; players: RlPlayer[]; teams: RlTeam[]; replay: boolean; target: RlPlayerRef | null }
  | { type: 'goal'; scorer: RlPlayerRef | null }
  | { type: 'matchEnded'; winnerTeamNum: number | null }
  | { type: 'matchStart' }
  | { type: 'matchDestroyed' }
  | { type: 'other'; name: string }

function playerRef(v: unknown): RlPlayerRef | null {
  if (!isObj(v)) return null
  const teamNum = num(v.TeamNum, -1, -1, 255)
  if (teamNum < 0) return null
  return { name: str(v.Name, '', 64), teamNum: Math.round(teamNum) }
}

/** Fields the API sends only for your own team (or for everyone while spectating). */
const DETAIL_FIELDS = ['Boost', 'Speed', 'bHasCar', 'bBoosting', 'bOnGround']

function player(v: unknown): RlPlayer | null {
  const ref = playerRef(v)
  if (!ref || !isObj(v)) return null
  return { ...ref, detailed: DETAIL_FIELDS.some((k) => k in v) }
}

/** Parses one Stats API message. Returns null for anything malformed. */
export function parseRlMessage(raw: string): RlEvent | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_MESSAGE_BYTES) return null
  let msg: unknown
  try {
    msg = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isObj(msg) || typeof msg.Event !== 'string') return null
  let data: unknown = msg.Data
  // Be tolerant of Data arriving as an encoded JSON string
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data)
    } catch {
      return null
    }
  }
  const d = asObj(data)

  switch (msg.Event) {
    case 'UpdateState': {
      const players = Array.isArray(d.Players)
        ? d.Players.slice(0, 16).map(player).filter((p): p is RlPlayer => p !== null)
        : []
      const game = asObj(d.Game)
      const targetRef = game.bHasTarget === true ? playerRef(game.Target) : null
      // An empty name means the camera is not following anyone
      const target = targetRef && targetRef.name ? targetRef : null
      const teams: RlTeam[] = Array.isArray(game.Teams)
        ? game.Teams.slice(0, 4)
            .filter(isObj)
            .map((t) => ({
              teamNum: Math.round(num(t.TeamNum, -1, -1, 255)),
              name: str(t.Name, '', 64),
              colorPrimary: typeof t.ColorPrimary === 'string' && /^[0-9a-fA-F]{6}$/.test(t.ColorPrimary) ? t.ColorPrimary : null
            }))
            .filter((t) => t.teamNum >= 0)
        : []
      return { type: 'state', players, teams, replay: game.bReplay === true, target }
    }
    case 'GoalScored':
      return { type: 'goal', scorer: playerRef(d.Scorer) }
    case 'MatchEnded': {
      const w = num(d.WinnerTeamNum, -1, -1, 255)
      return { type: 'matchEnded', winnerTeamNum: w >= 0 ? Math.round(w) : null }
    }
    case 'MatchInitialized':
      return { type: 'matchStart' }
    case 'MatchDestroyed':
      return { type: 'matchDestroyed' }
    default:
      return { type: 'other', name: msg.Event.slice(0, 40) }
  }
}

export type GoalOutcome = 'ours' | 'theirs' | 'unknown'

/** How the user's team was worked out, shown in the settings. */
export type TeamSource = 'name' | 'team-data' | 'camera' | null

/** Lower case with clan tags, brackets, symbols, and spaces removed, for forgiving name matching. */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\[[^\]]*\]|\([^)]*\)|\{[^}]*\}|<[^>]*>/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, '')
}

function nameMatches(playerName: string, wanted: string): boolean {
  const a = normalizeName(playerName)
  const b = normalizeName(wanted)
  if (!a || !b) return false
  // A clan tag written without brackets ("TAG Name") still matches "Name"
  return a === b || (b.length >= 3 && (a.endsWith(b) || a.startsWith(b))) || (a.length >= 3 && (b.endsWith(a) || b.startsWith(a)))
}

/**
 * Remembers which team the user is on and the team colours for the current
 * match. The team is found, in order of preference, from:
 *  1. the in-game name, if the user gave one and it matches a player;
 *  2. the API's live car details, which it sends only for your own team;
 *  3. the player the camera follows, which is you while you play.
 */
export class RlMatchTracker {
  private myTeam: number | null = null
  private source: TeamSource = null
  private teams: RlTeam[] = []

  constructor(private playerName: string) {}

  public setPlayerName(name: string): void {
    this.playerName = name
    this.myTeam = null
    this.source = null
  }

  public update(event: RlEvent): void {
    if (event.type === 'state') {
      if (event.teams.length > 0) this.teams = event.teams
      const found = this.detect(event)
      if (found) {
        this.myTeam = found.team
        this.source = found.source
      }
    } else if (event.type === 'matchDestroyed') {
      this.myTeam = null
      this.source = null
      this.teams = []
    }
  }

  private detect(e: Extract<RlEvent, { type: 'state' }>): { team: number; source: TeamSource } | null {
    const wanted = this.playerName.trim()
    if (wanted) {
      const me = e.players.find((p) => nameMatches(p.name, wanted))
      if (me && me.teamNum <= 1) return { team: me.teamNum, source: 'name' }
    }
    const detailedTeams = new Set(e.players.filter((p) => p.detailed && p.teamNum <= 1).map((p) => p.teamNum))
    const otherTeamHasPlayers = e.players.some((p) => p.teamNum <= 1 && !detailedTeams.has(p.teamNum))
    // Only one team has car details, and the other team is in the match: that is your team
    if (detailedTeams.size === 1 && otherTeamHasPlayers) {
      return { team: Array.from(detailedTeams)[0], source: 'team-data' }
    }
    // Replays move the camera to other players, so it only counts during play
    if (!e.replay && e.target && e.target.teamNum <= 1 && this.source !== 'team-data' && this.source !== 'name') {
      return { team: e.target.teamNum, source: 'camera' }
    }
    return null
  }

  public getSource(): TeamSource {
    return this.source
  }

  public getMyTeam(): number | null {
    return this.myTeam
  }

  public teamName(teamNum: number | null): string | null {
    if (teamNum === null) return null
    return this.teams.find((t) => t.teamNum === teamNum)?.name || (teamNum === 0 ? 'Blue' : teamNum === 1 ? 'Orange' : null)
  }

  public teamColor(teamNum: number | null): string | null {
    if (teamNum === null) return null
    return this.teams.find((t) => t.teamNum === teamNum)?.colorPrimary ?? null
  }

  public goalOutcome(scorer: RlPlayerRef | null): GoalOutcome {
    if (this.myTeam === null || !scorer) return 'unknown'
    return scorer.teamNum === this.myTeam ? 'ours' : 'theirs'
  }

  public matchOutcome(winnerTeamNum: number | null): 'win' | 'loss' | 'unknown' {
    if (this.myTeam === null || winnerTeamNum === null) return 'unknown'
    return winnerTeamNum === this.myTeam ? 'win' : 'loss'
  }
}

// --- DefaultStatsAPI.ini ---

export interface StatsApiSettings {
  packetSendRate: number | null
  port: number | null
}

export function readStatsApiSettings(text: string): StatsApiSettings {
  const get = (key: string): number | null => {
    const m = text.match(new RegExp(`^\\s*${key}\\s*=\\s*([0-9.]+)\\s*$`, 'mi'))
    return m ? Number(m[1]) : null
  }
  return { packetSendRate: get('PacketSendRate'), port: get('Port') }
}

/**
 * Sets PacketSendRate and Port, editing the existing lines in place so the
 * file's own section and other settings are untouched. Keys that are missing
 * are added under the section that holds the other key, or under the Stats API
 * section when the file has neither.
 */
export function applyStatsApiSettings(text: string, settings: { packetSendRate: number; port: number }): string {
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const lines = text.length > 0 ? text.split(/\r?\n/) : []
  const values: Record<string, string> = {
    packetsendrate: String(settings.packetSendRate),
    port: String(Math.round(settings.port))
  }
  const names: Record<string, string> = { packetsendrate: 'PacketSendRate', port: 'Port' }
  const seen = new Set<string>()
  let keySectionIndex = -1
  let currentSection = -1

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (/^\s*\[.*\]\s*$/.test(line)) {
      currentSection = i
      continue
    }
    const m = line.match(/^(\s*)(PacketSendRate|Port)(\s*=\s*)(.*)$/i)
    if (m) {
      const key = m[2].toLowerCase()
      lines[i] = `${m[1]}${m[2]}${m[3]}${values[key]}`
      seen.add(key)
      if (keySectionIndex < 0) keySectionIndex = currentSection
    }
  }

  const missing = Object.keys(values).filter((k) => !seen.has(k))
  if (missing.length === 0) return lines.join(eol)

  const additions = missing.map((k) => `${names[k]}=${values[k]}`)
  let insertAt = keySectionIndex >= 0 ? keySectionIndex + 1 : -1
  if (insertAt < 0) {
    const header = lines.findIndex((l) => l.trim().toLowerCase() === `[${RL_STATS_SECTION.toLowerCase()}]`)
    if (header >= 0) insertAt = header + 1
  }
  if (insertAt >= 0) {
    lines.splice(insertAt, 0, ...additions)
  } else {
    while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop()
    if (lines.length > 0) lines.push('')
    lines.push(`[${RL_STATS_SECTION}]`, ...additions, '')
  }
  return lines.join(eol)
}

// --- Client ---

export type RlConnection = 'disconnected' | 'connecting' | 'connected'

/**
 * Connects to the Stats API socket and reconnects with backoff, so it picks
 * the game up when it launches and lets go cleanly when it closes.
 */
export class RlClient extends EventEmitter {
  private ws: WebSocket | null = null
  private timer: NodeJS.Timeout | null = null
  private backoffMs = 1000
  private stopped = true
  private state: RlConnection = 'disconnected'

  constructor(private port = RL_DEFAULT_PORT) {
    super()
  }

  public getState(): RlConnection {
    return this.state
  }

  public start(port = this.port): void {
    this.port = port
    this.stopped = false
    this.connect()
  }

  public stop(): void {
    this.stopped = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    const ws = this.ws
    this.ws = null
    if (ws) {
      ws.removeAllListeners()
      ws.on('error', () => {})
      try {
        ws.terminate()
      } catch {
        // already closed
      }
    }
    this.setState('disconnected')
  }

  private connect(): void {
    if (this.stopped || this.ws) return
    this.setState('connecting')
    let ws: WebSocket
    try {
      ws = new WebSocket(`ws://127.0.0.1:${this.port}`, { maxPayload: MAX_MESSAGE_BYTES, handshakeTimeout: 3000 })
    } catch {
      this.scheduleReconnect()
      return
    }
    this.ws = ws
    ws.on('open', () => {
      this.backoffMs = 1000
      this.setState('connected')
    })
    ws.on('message', (data: WebSocket.RawData) => {
      const text = Array.isArray(data) ? Buffer.concat(data).toString('utf8') : data.toString()
      const event = parseRlMessage(text)
      if (event) this.emit('event', event)
    })
    ws.on('error', () => {
      // Expected while the game is closed; 'close' follows
    })
    ws.on('close', () => {
      if (this.ws === ws) this.ws = null
      this.setState('disconnected')
      this.scheduleReconnect()
    })
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.timer) return
    this.timer = setTimeout(() => {
      this.timer = null
      this.connect()
    }, this.backoffMs)
    // Look for the game every few seconds at most; it may launch any time.
    this.backoffMs = Math.min(this.backoffMs * 2, 8000)
  }

  private setState(state: RlConnection): void {
    if (this.state === state) return
    this.state = state
    this.emit('state', state)
  }
}
