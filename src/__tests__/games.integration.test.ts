import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import http from 'http'
import { AddressInfo } from 'net'
import { WebSocketServer, WebSocket } from 'ws'
import { EffectManager } from '../main/effects/EffectManager'
import { GamesEffect } from '../main/effects/games/GamesEffect'
import { LeagueFetch } from '../main/effects/games/league'
import { createMockLights, SentCommand } from './helpers/mockLights'
import type { Light } from '../main/devices/Light'

/**
 * Integration tests: the Games effect against a fake Rocket League Stats API
 * socket, fake CS2 game state posts, and a fake League Live Client endpoint,
 * driving mock bulbs through the real compositor.
 */

const fixture = (name: string): string => readFileSync(join(__dirname, 'fixtures', 'games', name), 'utf8')
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

async function waitFor(check: () => boolean, timeoutMs = 6000, what = 'condition'): Promise<void> {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for ${what}`)
    await sleep(25)
  }
}

async function freePort(): Promise<number> {
  const srv = http.createServer()
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()))
  const port = (srv.address() as AddressInfo).port
  await new Promise<void>((r) => srv.close(() => r()))
  return port
}

interface Rig {
  manager: EffectManager
  games: GamesEffect
  lights: Light[]
  log: SentCommand[]
}

function rig(leagueFetch?: LeagueFetch): Rig {
  const { lights, log } = createMockLights(2)
  const source = { getAllLights: () => lights, getIsDemoMode: () => false }
  const manager = new EffectManager(source, mkdtempSync(join(tmpdir(), 'lumos-games-')))
  const games = new GamesEffect(manager.getHost(), {
    // No game running unless a test supplies one
    leagueFetch: leagueFetch ?? (async () => Promise.reject(new Error('ECONNREFUSED')))
  })
  manager.register(games)
  manager.attachLights()
  return { manager, games, lights, log }
}

const info = (g: GamesEffect): Record<string, any> => g.snapshot().info as Record<string, any>

describe('Integration: Rocket League Stats API', () => {
  let wss: WebSocketServer
  let port: number
  let r: Rig

  beforeEach(async () => {
    port = await freePort()
    wss = new WebSocketServer({ port, host: '127.0.0.1' })
    r = rig()
    r.games.updateSettings({
      rocketLeague: {
        ...r.games.getSettings().rocketLeague,
        port,
        playerName: 'Driver One',
        flashCount: 1,
        flashMs: 150,
        cooldownSeconds: 0
      },
      cs2: { ...r.games.getSettings().cs2, enabled: false },
      league: { enabled: false }
    })
  })

  afterEach(async () => {
    await r.manager.shutdown()
    for (const c of wss.clients) c.terminate()
    await new Promise<void>((res) => wss.close(() => res()))
  })

  const broadcast = (text: string): void => {
    for (const c of wss.clients) if (c.readyState === WebSocket.OPEN) c.send(text)
  }

  it('connects, flashes on your goal, then restores the composed state', async () => {
    await r.manager.setEnabled('games', true)
    await waitFor(() => wss.clients.size > 0, 6000, 'client connection')
    await waitFor(() => info(r.games).rocketLeague.status !== 'waiting', 3000, 'connected status')

    broadcast(fixture('rl-update-state.json'))
    await waitFor(() => info(r.games).rocketLeague.team === 0, 3000, 'team detection')

    broadcast(fixture('rl-goal-blue.json'))
    await waitFor(() => r.lights[0].lastSentOutput?.mode === 'colour', 2000, 'flash colour')
    const flash = r.lights[0].lastSentOutput!
    expect(flash.h).toBe(130) // your goal: green
    expect(r.lights[0].getState().effect).toBe('Your goal')

    await waitFor(() => r.lights[0].lastSentOutput?.mode === 'white', 3000, 'restore')
    expect(r.lights[0].lastSentOutput!.brightness).toBe(80)
    expect(r.lights[0].mode).toBe('white') // the base state was never touched
  }, 20000)

  it('flashes the opponent colour for the other team, and neutral when the team is unknown', async () => {
    await r.manager.setEnabled('games', true)
    await waitFor(() => wss.clients.size > 0, 6000, 'client connection')

    broadcast(fixture('rl-update-state.json'))
    await sleep(100)
    broadcast(fixture('rl-goal-orange.json'))
    await waitFor(() => r.lights[0].lastSentOutput?.mode === 'colour', 2000, 'opponent flash')
    expect(r.lights[0].lastSentOutput!.h).toBe(0)
    await waitFor(() => r.lights[0].lastSentOutput?.mode === 'white', 3000, 'restore')

    // Unknown player name: neutral colour
    r.games.updateSettings({ rocketLeague: { ...r.games.getSettings().rocketLeague, playerName: 'Nobody' } })
    await waitFor(() => wss.clients.size > 0, 6000, 'reconnect after settings change')
    await sleep(200)
    broadcast(fixture('rl-update-state.json'))
    await sleep(100)
    broadcast(fixture('rl-goal-blue.json'))
    await waitFor(() => r.lights[0].lastSentOutput?.mode === 'colour', 2000, 'neutral flash')
    expect(r.lights[0].lastSentOutput!.h).toBe(45)
  }, 20000)

  it('ignores malformed messages without disconnecting', async () => {
    await r.manager.setEnabled('games', true)
    await waitFor(() => wss.clients.size > 0, 6000, 'client connection')
    broadcast('this is not json')
    broadcast('{"Event":"GoalScored","Data":"{broken"}')
    broadcast(JSON.stringify({ Event: 'GoalScored', Data: { Scorer: 'nope' } }))
    await sleep(300)
    expect(wss.clients.size).toBe(1)
    expect(r.games.getStatus()).not.toBe('error')
  }, 15000)

  it('reconnects with backoff when the game closes and launches again', async () => {
    await r.manager.setEnabled('games', true)
    await waitFor(() => wss.clients.size > 0, 6000, 'first connection')

    for (const c of wss.clients) c.terminate()
    await new Promise<void>((res) => wss.close(() => res()))
    await waitFor(() => info(r.games).rocketLeague.status === 'waiting', 3000, 'disconnected status')

    wss = new WebSocketServer({ port, host: '127.0.0.1' })
    await waitFor(() => wss.clients.size > 0, 10000, 'reconnection')
    await waitFor(() => info(r.games).rocketLeague.status === 'connected', 3000, 'connected status')
  }, 20000)
})

describe('Integration: CS2 Game State Integration', () => {
  let r: Rig
  let port: number

  beforeEach(async () => {
    port = await freePort()
    r = rig()
    r.games.updateSettings({
      rocketLeague: { ...r.games.getSettings().rocketLeague, enabled: false },
      cs2: { enabled: true, port, token: '0123456789abcdef0123' },
      league: { enabled: false }
    })
  })

  afterEach(async () => {
    await r.manager.shutdown()
  })

  const post = (body: string, path = '/'): Promise<number> =>
    new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port, path, method: 'POST' }, (res) => {
        res.resume()
        resolve(res.statusCode || 0)
      })
      req.on('error', reject)
      req.end(body)
    })

  it('pulses on low health, shows death, and releases on respawn', async () => {
    await r.manager.setEnabled('games', true)
    await waitFor(() => info(r.games).cs2.status === 'waiting', 3000, 'listener')

    expect(await post(fixture('cs2-live.json'))).toBe(200)
    await waitFor(() => r.lights[0].lastSentOutput?.mode === 'colour', 3000, 'pulse')
    expect(r.lights[0].lastSentOutput!.h).toBe(0)
    expect(r.games.getStatus()).toBe('active')

    // The pulse moves brightness over time
    const seen = new Set<number>()
    const start = Date.now()
    while (Date.now() - start < 2500) {
      seen.add(r.lights[0].lastSentOutput!.brightness)
      await sleep(50)
    }
    expect(seen.size).toBeGreaterThan(3)

    expect(await post(fixture('cs2-dead.json'))).toBe(200)
    await waitFor(() => r.lights[0].lastSentOutput?.brightness === 15, 2000, 'death hold')

    const respawn = JSON.parse(fixture('cs2-live.json'))
    respawn.player.state.health = 100
    expect(await post(JSON.stringify(respawn))).toBe(200)
    await waitFor(() => r.lights[0].lastSentOutput?.mode === 'white', 5000, 'release')
    expect(r.lights[0].lastSentOutput!.brightness).toBe(80)
  }, 20000)

  it('rejects posts with the wrong token and ignores spectated players', async () => {
    await r.manager.setEnabled('games', true)
    await waitFor(() => info(r.games).cs2.status === 'waiting', 3000, 'listener')
    const wrong = fixture('cs2-live.json').replace('0123456789abcdef0123', 'not-the-token')
    expect(await post(wrong)).toBe(401)
    expect(await post('{"oops":')).toBe(401)
    expect(await post(fixture('cs2-spectating.json'))).toBe(200)
    await sleep(400)
    expect(r.lights[0].lastSentOutput?.mode).toBe('white')
  }, 15000)

  it('stops listening when disabled', async () => {
    await r.manager.setEnabled('games', true)
    await waitFor(() => info(r.games).cs2.status === 'waiting', 3000, 'listener')
    await r.manager.setEnabled('games', false)
    await expect(post(fixture('cs2-live.json'))).rejects.toThrow()
  }, 15000)
})

describe('Integration: League of Legends Live Client', () => {
  it('connects when a game appears, pulses on low health, and lets go when it ends', async () => {
    let body: string | null = fixture('league-activeplayer.json') // 182 / 640 = 28 percent
    const fetcher: LeagueFetch = async () => {
      if (body === null) throw new Error('ECONNREFUSED')
      return { status: 200, body }
    }
    const r = rig(fetcher)
    r.games.updateSettings({
      rocketLeague: { ...r.games.getSettings().rocketLeague, enabled: false },
      cs2: { ...r.games.getSettings().cs2, enabled: false },
      league: { enabled: true }
    })
    await r.manager.setEnabled('games', true)
    await waitFor(() => info(r.games).league.status === 'in-match', 3000, 'game detected')
    await waitFor(() => r.lights[0].lastSentOutput?.mode === 'colour', 3000, 'pulse')

    body = null // the game closed
    await waitFor(() => info(r.games).league.status === 'waiting', 3000, 'game closed')
    await waitFor(() => r.lights[0].lastSentOutput?.mode === 'white', 5000, 'release')
    await r.manager.shutdown()
  }, 20000)
})
