/**
 * Counter-Strike 2 Game State Integration.
 *
 * The game reads gamestate_integration_*.cfg files from game\csgo\cfg at launch
 * and POSTs JSON game state to the configured uri. The "auth" block from the
 * file is echoed back in every payload, which lets the listener reject anything
 * that did not come from the game.
 */
import { EventEmitter } from 'events'
import http from 'http'
import { join } from 'path'
import { asObj, isObj, num, str } from '../validate'
import { findSteamGame } from './installs'

export const CS2_DEFAULT_PORT = 3123
export const CS2_CONFIG_NAME = 'gamestate_integration_lumos.cfg'
const MAX_BODY = 256 * 1024
/** The game is considered closed when no post arrives for this long (heartbeat is 10 s). */
const SILENCE_MS = 25000

export function buildGsiConfig(port: number, token: string): string {
  return [
    '"Lumos lighting"',
    '{',
    `  "uri" "http://127.0.0.1:${port}/"`,
    '  "timeout" "1.1"',
    '  "buffer" "0.0"',
    '  "throttle" "0.1"',
    '  "heartbeat" "10.0"',
    '  "auth"',
    '  {',
    `    "token" "${token}"`,
    '  }',
    '  "data"',
    '  {',
    '    "provider" "1"',
    '    "map" "1"',
    '    "round" "1"',
    '    "player_id" "1"',
    '    "player_state" "1"',
    '  }',
    '}',
    ''
  ].join('\r\n')
}

export function cs2ConfigPaths(): string[] {
  return findSteamGame('Counter-Strike Global Offensive').map((g) => join(g, 'game', 'csgo', 'cfg', CS2_CONFIG_NAME))
}

export interface Cs2State {
  /** In a live round on a map, playing (not in the menu or typing). */
  inMatch: boolean
  /** The reported player is the local player, not someone being spectated. */
  isLocalPlayer: boolean
  alive: boolean
  /** 0..1 */
  health: number
}

/**
 * Parses a game state payload. Returns null if it is malformed or the token
 * does not match.
 */
export function parseCs2Payload(body: string, token: string): Cs2State | null {
  if (body.length === 0 || body.length > MAX_BODY) return null
  let raw: unknown
  try {
    raw = JSON.parse(body)
  } catch {
    return null
  }
  if (!isObj(raw)) return null
  const auth = asObj(raw.auth)
  if (typeof auth.token !== 'string' || auth.token !== token) return null

  const provider = asObj(raw.provider)
  const map = asObj(raw.map)
  const player = asObj(raw.player)
  const state = asObj(player.state)
  const providerId = str(provider.steamid, '', 32)
  const playerId = str(player.steamid, '', 32)
  const isLocalPlayer = providerId !== '' && providerId === playerId
  const phase = str(map.phase, '', 20)
  const activity = str(player.activity, '', 20)
  const hasHealth = typeof state.health === 'number'
  const health = num(state.health, 0, 0, 100) / 100

  return {
    inMatch: phase === 'live' && activity === 'playing' && hasHealth,
    isLocalPlayer,
    alive: hasHealth && health > 0,
    health
  }
}

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])

/** Loopback HTTP listener that receives game state posts. */
export class Cs2Listener extends EventEmitter {
  private server: http.Server | null = null
  private silenceTimer: NodeJS.Timeout | null = null
  private lastPostAt = 0

  constructor(
    private port: number,
    private token: string
  ) {
    super()
  }

  public isListening(): boolean {
    return this.server?.listening === true
  }

  public getLastPostAt(): number {
    return this.lastPostAt
  }

  public start(): Promise<void> {
    if (this.server) return Promise.resolve()
    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => this.handle(req, res))
      server.on('error', (err) => {
        this.server = null
        reject(err)
        this.emit('error', err)
      })
      server.listen(this.port, '127.0.0.1', () => {
        this.server = server
        resolve()
      })
    })
  }

  public stop(): void {
    if (this.silenceTimer) clearTimeout(this.silenceTimer)
    this.silenceTimer = null
    const server = this.server
    this.server = null
    if (server) {
      server.closeAllConnections?.()
      server.close()
    }
  }

  private handle(req: http.IncomingMessage, res: http.ServerResponse): void {
    if (!LOOPBACK.has(req.socket.remoteAddress || '') || req.method !== 'POST') {
      res.writeHead(404)
      res.end()
      return
    }
    let body = ''
    let tooLarge = false
    req.setEncoding('utf8')
    req.on('data', (chunk: string) => {
      if (tooLarge) return
      body += chunk
      if (body.length > MAX_BODY) {
        tooLarge = true
        res.writeHead(413)
        res.end()
        req.destroy()
      }
    })
    req.on('end', () => {
      if (tooLarge) return
      const state = parseCs2Payload(body, this.token)
      // Always answer quickly; the game will not send again until it gets a 2xx.
      res.writeHead(state ? 200 : 401)
      res.end()
      if (!state) return
      this.lastPostAt = Date.now()
      this.armSilenceTimer()
      this.emit('state', state)
    })
  }

  private armSilenceTimer(): void {
    if (this.silenceTimer) clearTimeout(this.silenceTimer)
    this.silenceTimer = setTimeout(() => {
      this.silenceTimer = null
      this.emit('closed')
    }, SILENCE_MS)
  }
}
