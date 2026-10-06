/**
 * League of Legends Live Client Data API.
 *
 * During a game the client serves https://127.0.0.1:2999/liveclientdata/...
 * with a certificate issued by Riot's own root. Requests go to loopback only
 * and are verified against that pinned root rather than skipping verification.
 */
import { EventEmitter } from 'events'
import https from 'https'
import { asObj, isObj, num } from '../validate'
import { RIOT_ROOT_CERTIFICATE } from './riotCertificate'

export const LEAGUE_HOST = '127.0.0.1'
export const LEAGUE_PORT = 2999
const MAX_BODY = 512 * 1024
/** Poll interval during a game. Health changes are smoothed by the pulse anyway. */
export const LEAGUE_POLL_IN_GAME_MS = 500
/** Poll interval while no game is running. */
export const LEAGUE_POLL_IDLE_MS = 5000

export interface LeagueState {
  inMatch: boolean
  alive: boolean
  /** 0..1 */
  health: number
}

/** Parses /liveclientdata/activeplayer. Returns null if the payload is not usable. */
export function parseActivePlayer(body: string): LeagueState | null {
  if (body.length === 0 || body.length > MAX_BODY) return null
  let raw: unknown
  try {
    raw = JSON.parse(body)
  } catch {
    return null
  }
  if (!isObj(raw)) return null
  const stats = asObj(raw.championStats)
  if (typeof stats.currentHealth !== 'number' || typeof stats.maxHealth !== 'number') return null
  const max = num(stats.maxHealth, 0, 0, 1e6)
  const current = num(stats.currentHealth, 0, 0, 1e6)
  if (max <= 0) return null
  const health = Math.max(0, Math.min(1, current / max))
  return { inMatch: true, alive: current > 0, health }
}

export type LeagueFetch = (path: string) => Promise<{ status: number; body: string }>

/** The default fetcher: loopback HTTPS verified against Riot's root certificate. */
export function createLeagueFetch(): { fetch: LeagueFetch; destroy: () => void } {
  const agent = new https.Agent({
    ca: RIOT_ROOT_CERTIFICATE,
    keepAlive: true,
    maxSockets: 1,
    // The chain is verified against the pinned root above. The certificate is
    // not issued for the literal address 127.0.0.1, and the address is fixed
    // to loopback, so only the host name comparison is skipped.
    checkServerIdentity: () => undefined
  })
  const fetch: LeagueFetch = (path) =>
    new Promise((resolve, reject) => {
      const req = https.request(
        { host: LEAGUE_HOST, port: LEAGUE_PORT, path, method: 'GET', agent, timeout: 1500 },
        (res) => {
          let body = ''
          res.setEncoding('utf8')
          res.on('data', (chunk: string) => {
            body += chunk
            if (body.length > MAX_BODY) req.destroy(new Error('Response too large'))
          })
          res.on('end', () => resolve({ status: res.statusCode || 0, body }))
        }
      )
      req.on('timeout', () => req.destroy(new Error('Timed out')))
      req.on('error', reject)
      req.end()
    })
  return { fetch, destroy: () => agent.destroy() }
}

/**
 * Polls the active player's health while a game runs, and looks for a game at
 * a slow rate otherwise.
 */
export class LeaguePoller extends EventEmitter {
  private timer: NodeJS.Timeout | null = null
  private running = false
  private inGame = false
  private destroyFetch: (() => void) | null = null
  private fetcher: LeagueFetch | null = null

  /** A fetcher can be supplied for tests; otherwise the pinned loopback client is used. */
  constructor(private injected?: LeagueFetch) {
    super()
  }

  public isInGame(): boolean {
    return this.inGame
  }

  public start(): void {
    if (this.running) return
    this.running = true
    if (this.injected) {
      this.fetcher = this.injected
    } else {
      const f = createLeagueFetch()
      this.fetcher = f.fetch
      this.destroyFetch = f.destroy
    }
    this.poll()
  }

  public stop(): void {
    this.running = false
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.destroyFetch?.()
    this.destroyFetch = null
    this.fetcher = null
    this.setInGame(false)
  }

  private async poll(): Promise<void> {
    if (!this.running || !this.fetcher) return
    let state: LeagueState | null = null
    try {
      const res = await this.fetcher('/liveclientdata/activeplayer')
      if (res.status === 200) state = parseActivePlayer(res.body)
    } catch {
      state = null
    }
    if (!this.running) return
    this.setInGame(state !== null)
    if (state) this.emit('state', state)
    this.timer = setTimeout(() => this.poll(), this.inGame ? LEAGUE_POLL_IN_GAME_MS : LEAGUE_POLL_IDLE_MS)
  }

  private setInGame(on: boolean): void {
    if (this.inGame === on) return
    this.inGame = on
    this.emit(on ? 'connected' : 'closed')
  }
}
