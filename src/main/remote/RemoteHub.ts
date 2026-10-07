import { EventEmitter } from 'events'
import http from 'http'
import dgram from 'dgram'
import os from 'os'
import { WebSocketServer, WebSocket, RawData } from 'ws'
import { invokeLocal } from './registry'
import { FORWARDED_EVENTS } from './channels'
import { SecureChannel, codesMatch, isPrivateAddress, newNonce, newPairingCode, newToken, proof, verifyProof } from './secure'

export const HUB_PORT = 8990
export const BEACON_PORT = 8991
const PAIR_CODE_TTL_MS = 10 * 60 * 1000
const MAX_FAILED_PAIRINGS = 5
const FAILED_PAIRING_WINDOW_MS = 10 * 60 * 1000
const BEACON_INTERVAL_MS = 7000
const MAX_MESSAGE = 1024 * 1024
const SKIP_INTERFACES = ['vethernet', 'virtualbox', 'vmware', 'loopback', 'bluetooth', 'wsl', 'hyper-v']

export interface PairedClient {
  id: string
  name: string
  token: string
  addedAt: number
}

export interface HubStore {
  getClients(): PairedClient[]
  addClient(client: PairedClient): void
}

interface Session {
  ws: WebSocket
  clientId: string
  channel: SecureChannel
}

const isId = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{16,64}$/.test(v)

/** Network addresses this hub can be reached at, for showing in Settings. */
export function hubAddresses(): string[] {
  const out: string[] = []
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    if (!list || SKIP_INTERFACES.some((s) => name.toLowerCase().includes(s))) continue
    for (const info of list) {
      if (!info.internal && info.family === 'IPv4' && !info.address.startsWith('169.254.')) out.push(info.address)
    }
  }
  return out
}

function broadcastAddresses(): string[] {
  const out = new Set<string>(['255.255.255.255'])
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    if (!list || SKIP_INTERFACES.some((s) => name.toLowerCase().includes(s))) continue
    for (const info of list) {
      if (info.internal || info.family !== 'IPv4' || info.address.startsWith('169.254.')) continue
      const ip = info.address.split('.').map(Number)
      const mask = info.netmask.split('.').map(Number)
      out.add(ip.map((o, i) => (o & mask[i]) | (~mask[i] & 255)).join('.'))
    }
  }
  return Array.from(out)
}

/**
 * Lets other computers on the local network control this computer's lights.
 * Pairing needs the six-digit code shown on this computer; every connection
 * after that is mutually authenticated and encrypted (see secure.ts). Only
 * private network addresses are accepted.
 */
export class RemoteHub extends EventEmitter {
  private server: http.Server | null = null
  private wss: WebSocketServer | null = null
  private beacon: dgram.Socket | null = null
  private beaconTimer: NodeJS.Timeout | null = null
  private pingTimer: NodeJS.Timeout | null = null
  private sessions = new Set<Session>()
  private code: { value: string; expiresAt: number } | null = null
  private failedPairings: number[] = []
  private lastError = ''

  constructor(
    private store: HubStore,
    private hubId: string,
    private hubName: string,
    private port = HUB_PORT
  ) {
    super()
  }

  public isRunning(): boolean {
    return this.server?.listening === true
  }

  public getError(): string {
    return this.lastError
  }

  public getPort(): number {
    return this.port
  }

  public connectedClientIds(): string[] {
    return Array.from(this.sessions).map((s) => s.clientId)
  }

  /** Current pairing code, creating one if needed. */
  public getPairingCode(): { code: string; expiresAt: number } {
    if (!this.code || Date.now() > this.code.expiresAt) this.newPairingCode()
    return { code: this.code!.value, expiresAt: this.code!.expiresAt }
  }

  /** Current pairing code without creating one. */
  public getPairingCodeIfAny(): { code: string; expiresAt: number } | null {
    if (!this.code || Date.now() > this.code.expiresAt) return null
    return { code: this.code.value, expiresAt: this.code.expiresAt }
  }

  public newPairingCode(): void {
    this.code = { value: newPairingCode(), expiresAt: Date.now() + PAIR_CODE_TTL_MS }
    this.emit('changed')
  }

  public start(): Promise<void> {
    if (this.server) return Promise.resolve()
    return new Promise((resolve) => {
      const server = http.createServer((req, res) => void this.handleHttp(req, res))
      const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE })
      server.on('upgrade', (req, socket, head) => {
        if (req.url !== '/lumos/remote' || !isPrivateAddress(req.socket.remoteAddress)) {
          socket.destroy()
          return
        }
        wss.handleUpgrade(req, socket, head, (ws) => this.handleConnection(ws))
      })
      server.on('error', (err: NodeJS.ErrnoException) => {
        this.lastError = err.code === 'EADDRINUSE' ? `Port ${this.port} is already in use` : err.message
        this.server = null
        this.emit('changed')
        resolve()
      })
      server.listen(this.port, '0.0.0.0', () => {
        this.server = server
        this.wss = wss
        this.lastError = ''
        this.startBeacon()
        this.pingTimer = setInterval(() => this.pingAll(), 20000)
        this.emit('changed')
        resolve()
      })
    })
  }

  public stop(): void {
    if (this.beaconTimer) clearInterval(this.beaconTimer)
    if (this.pingTimer) clearInterval(this.pingTimer)
    this.beaconTimer = null
    this.pingTimer = null
    try {
      this.beacon?.close()
    } catch {
      // already closed
    }
    this.beacon = null
    for (const s of this.sessions) s.ws.terminate()
    this.sessions.clear()
    this.wss?.close()
    this.wss = null
    this.server?.closeAllConnections?.()
    this.server?.close()
    this.server = null
    this.emit('changed')
  }

  /** Disconnects a computer that has been removed. */
  public dropClient(clientId: string): void {
    for (const s of this.sessions) if (s.clientId === clientId) s.ws.terminate()
  }

  /** Sends a live update to every connected computer. */
  public broadcast(channel: string, payload: unknown): void {
    if (!FORWARDED_EVENTS.has(channel)) return
    for (const s of this.sessions) {
      if (s.ws.readyState === WebSocket.OPEN) s.ws.send(s.channel.seal({ t: 'event', channel, payload }))
    }
  }

  // --- Pairing ---

  private async handleHttp(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const reply = (status: number, body: unknown): void => {
      res.writeHead(status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(body))
    }
    if (!isPrivateAddress(req.socket.remoteAddress)) return reply(403, { error: 'Forbidden' })
    if (req.method === 'GET' && req.url === '/lumos/hello') {
      return reply(200, { lumosHub: 1, id: this.hubId, name: this.hubName })
    }
    if (req.method !== 'POST' || req.url !== '/lumos/pair') return reply(404, { error: 'Not found' })

    const now = Date.now()
    this.failedPairings = this.failedPairings.filter((t) => now - t < FAILED_PAIRING_WINDOW_MS)
    if (this.failedPairings.length >= MAX_FAILED_PAIRINGS) {
      return reply(429, { error: 'Too many wrong codes. Try again in a few minutes.' })
    }

    let body: Record<string, unknown>
    try {
      body = JSON.parse(await readBody(req, 4096))
    } catch {
      return reply(400, { error: 'Invalid request' })
    }
    const code = this.code && now <= this.code.expiresAt ? this.code.value : null
    if (!code || !codesMatch(code, body.code)) {
      this.failedPairings.push(now)
      return reply(401, { error: code ? 'That code is not right' : 'Show a pairing code on the other computer first' })
    }
    if (!isId(body.clientId)) return reply(400, { error: 'Invalid request' })

    const token = newToken()
    const name = typeof body.clientName === 'string' && body.clientName.trim() ? body.clientName.trim().slice(0, 64) : 'Computer'
    this.store.addClient({ id: body.clientId, name, token, addedAt: now })
    // Each code works once
    this.code = null
    this.emit('changed')
    return reply(200, { token, hubId: this.hubId, hubName: this.hubName })
  }

  // --- Sessions ---

  private handleConnection(ws: WebSocket): void {
    let stage: 'auth' | 'proof' | 'ready' = 'auth'
    let clientNonce = ''
    const hubNonce = newNonce()
    let client: PairedClient | undefined
    let session: Session | null = null
    const deny = (): void => {
      try {
        ws.send(JSON.stringify({ t: 'denied' }))
      } catch {
        // ignore
      }
      ws.close()
    }
    const handshakeTimer = setTimeout(() => stage !== 'ready' && ws.terminate(), 10000)

    ws.on('message', (data: RawData, isBinary: boolean) => {
      const buf = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as ArrayBuffer)
      if (stage !== 'ready') {
        let msg: Record<string, unknown>
        try {
          msg = JSON.parse(buf.toString('utf8'))
        } catch {
          return deny()
        }
        if (stage === 'auth' && msg.t === 'auth' && isId(msg.clientId) && typeof msg.nonce === 'string' && /^[0-9a-f]{32}$/.test(msg.nonce)) {
          client = this.store.getClients().find((c) => c.id === msg.clientId)
          if (!client) return deny()
          clientNonce = msg.nonce
          stage = 'proof'
          ws.send(JSON.stringify({ t: 'challenge', nonce: hubNonce }))
          return
        }
        if (stage === 'proof' && msg.t === 'proof' && client) {
          const expected = proof(client.token, 'client', clientNonce, hubNonce)
          if (!verifyProof(expected, msg.mac)) return deny()
          stage = 'ready'
          clearTimeout(handshakeTimer)
          session = { ws, clientId: client.id, channel: new SecureChannel(client.token, clientNonce, hubNonce) }
          this.sessions.add(session)
          ws.send(JSON.stringify({ t: 'ok', mac: proof(client.token, 'hub', clientNonce, hubNonce), hubId: this.hubId, hubName: this.hubName }))
          this.emit('changed')
          return
        }
        return deny()
      }

      if (!isBinary || !session) return
      const msg = session.channel.open(buf) as Record<string, unknown> | null
      if (!msg || typeof msg.channel !== 'string' || !Array.isArray(msg.args)) return
      const s = session
      if (msg.t === 'send') {
        invokeLocal(msg.channel, msg.args).catch(() => {})
        return
      }
      if (msg.t === 'call' && typeof msg.id === 'number') {
        invokeLocal(msg.channel, msg.args)
          .then((value) => ({ t: 'result', id: msg.id, ok: true, value: value ?? null }))
          .catch((err: unknown) => ({ t: 'result', id: msg.id, ok: false, error: err instanceof Error ? err.message : 'Failed' }))
          .then((reply) => {
            if (s.ws.readyState === WebSocket.OPEN) s.ws.send(s.channel.seal(reply))
          })
      }
    })

    ws.on('pong', () => ((ws as WebSocket & { alive?: boolean }).alive = true))
    ws.on('error', () => {})
    ws.on('close', () => {
      clearTimeout(handshakeTimer)
      if (session) {
        this.sessions.delete(session)
        this.emit('changed')
      }
    })
  }

  private pingAll(): void {
    for (const s of this.sessions) {
      const w = s.ws as WebSocket & { alive?: boolean }
      if (w.alive === false) {
        w.terminate()
        continue
      }
      w.alive = false
      w.ping()
    }
  }

  // --- Discovery beacon ---

  private startBeacon(): void {
    try {
      const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true })
      sock.on('error', () => {})
      sock.bind(() => {
        try {
          sock.setBroadcast(true)
        } catch {
          // ignore
        }
      })
      this.beacon = sock
      const send = (): void => {
        const msg = Buffer.from(JSON.stringify({ lumosHub: 1, id: this.hubId, name: this.hubName, port: this.port }))
        for (const addr of broadcastAddresses()) sock.send(msg, BEACON_PORT, addr, () => {})
      }
      send()
      this.beaconTimer = setInterval(send, BEACON_INTERVAL_MS)
    } catch {
      // Discovery is a convenience; the address can still be typed in
    }
  }
}

function readBody(req: http.IncomingMessage, limit: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ''
    req.setEncoding('utf8')
    req.on('data', (chunk: string) => {
      data += chunk
      if (data.length > limit) {
        req.destroy()
        reject(new Error('Too large'))
      }
    })
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}
