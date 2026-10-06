import { EventEmitter } from 'events'
import http from 'http'
import dgram from 'dgram'
import WebSocket, { RawData } from 'ws'
import { Forwarder } from './registry'
import { FORWARDED_EVENTS } from './channels'
import { BEACON_PORT, HUB_PORT } from './RemoteHub'
import { SecureChannel, newNonce, proof, verifyProof } from './secure'

export interface HubLink {
  hubId: string
  hubName: string
  address: string
  port: number
  token: string
  clientId: string
}

export interface FoundHub {
  id: string
  name: string
  address: string
  port: number
}

export type LinkState = 'connecting' | 'connected' | 'disconnected'

const CALL_TIMEOUT_MS = 10000
const WAIT_FOR_CONNECTION_MS = 6000

/** Listens for hub beacons on the local network. */
export function discoverHubs(durationMs = 3500): Promise<FoundHub[]> {
  return new Promise((resolve) => {
    const found = new Map<string, FoundHub>()
    const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true })
    sock.on('message', (msg, rinfo) => {
      const hub = parseBeacon(msg, rinfo.address)
      if (hub) found.set(hub.id, hub)
    })
    sock.on('error', () => {})
    try {
      sock.bind(BEACON_PORT)
    } catch {
      // nothing to listen with; fall back to typing an address
    }
    setTimeout(() => {
      try {
        sock.close()
      } catch {
        // already closed
      }
      resolve(Array.from(found.values()))
    }, durationMs)
  })
}

function parseBeacon(msg: Buffer, address: string): FoundHub | null {
  if (msg.length > 1024) return null
  try {
    const o = JSON.parse(msg.toString('utf8'))
    if (o?.lumosHub !== 1 || typeof o.id !== 'string' || !/^[0-9a-f]{16,64}$/.test(o.id)) return null
    const port = Number(o.port)
    return {
      id: o.id,
      name: typeof o.name === 'string' ? o.name.slice(0, 64) : 'Lumos',
      address,
      port: Number.isInteger(port) && port > 0 && port < 65536 ? port : HUB_PORT
    }
  } catch {
    return null
  }
}

/** Pairs with a hub using the code it shows. Returns the details needed to connect. */
export function pairWithHub(
  address: string,
  port: number,
  code: string,
  clientId: string,
  clientName: string
): Promise<{ token: string; hubId: string; hubName: string }> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ code: code.trim(), clientId, clientName })
    const req = http.request(
      { host: address, port, path: '/lumos/pair', method: 'POST', timeout: 5000, headers: { 'Content-Type': 'application/json' } },
      (res) => {
        let data = ''
        res.setEncoding('utf8')
        res.on('data', (c: string) => {
          data += c
          if (data.length > 4096) req.destroy()
        })
        res.on('end', () => {
          try {
            const o = JSON.parse(data)
            if (res.statusCode === 200 && typeof o.token === 'string' && /^[0-9a-f]{64}$/.test(o.token) && typeof o.hubId === 'string') {
              resolve({ token: o.token, hubId: o.hubId, hubName: typeof o.hubName === 'string' ? o.hubName.slice(0, 64) : 'Lumos' })
            } else {
              reject(new Error(typeof o.error === 'string' ? o.error : 'Pairing failed'))
            }
          } catch {
            reject(new Error('That address is not a Lumos computer'))
          }
        })
      }
    )
    req.on('timeout', () => req.destroy(new Error('No answer from that address')))
    req.on('error', (err) => reject(new Error(err.message.includes('ECONNREFUSED') ? 'Lumos is not sharing its lights at that address' : 'No answer from that address')))
    req.end(body)
  })
}

/**
 * Connection from this computer to a hub. While active, this computer's
 * light, scene, effect, and energy actions are sent to the hub, and the hub's
 * live updates come back. It reconnects on its own, and if the hub's address
 * changes it follows the hub's beacon.
 */
export class RemoteClient extends EventEmitter implements Forwarder {
  private ws: WebSocket | null = null
  private channel: SecureChannel | null = null
  private state: LinkState = 'disconnected'
  private active = false
  private nextId = 1
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>()
  private reconnectTimer: NodeJS.Timeout | null = null
  private backoffMs = 1000
  private beaconSock: dgram.Socket | null = null
  private lastError = ''

  constructor(private link: HubLink) {
    super()
  }

  public getLink(): HubLink {
    return this.link
  }

  public getState(): LinkState {
    return this.state
  }

  public getError(): string {
    return this.lastError
  }

  public isActive(): boolean {
    return this.active
  }

  public start(): void {
    if (this.active) return
    this.active = true
    this.connect()
  }

  public stop(): void {
    this.active = false
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    this.stopBeaconWatch()
    const ws = this.ws
    this.ws = null
    this.channel = null
    if (ws) {
      ws.removeAllListeners()
      ws.on('error', () => {})
      ws.terminate()
    }
    for (const p of this.pending.values()) {
      clearTimeout(p.timer)
      p.reject(new Error('Disconnected'))
    }
    this.pending.clear()
    this.setState('disconnected')
  }

  public async invoke(channel: string, args: unknown[]): Promise<unknown> {
    if (this.state !== 'connected') await this.waitForConnection()
    const ws = this.ws
    const sec = this.channel
    if (!ws || !sec || this.state !== 'connected') throw new Error(`Cannot reach ${this.link.hubName}`)
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`${this.link.hubName} did not answer`))
      }, CALL_TIMEOUT_MS)
      this.pending.set(id, { resolve, reject, timer })
      ws.send(sec.seal({ t: 'call', id, channel, args }))
    })
  }

  public send(channel: string, args: unknown[]): void {
    if (this.state === 'connected' && this.ws && this.channel) this.ws.send(this.channel.seal({ t: 'send', channel, args }))
  }

  private waitForConnection(): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.removeListener('state', onState)
        resolve()
      }, WAIT_FOR_CONNECTION_MS)
      const onState = (s: LinkState): void => {
        if (s === 'connected') {
          clearTimeout(timer)
          this.removeListener('state', onState)
          resolve()
        }
      }
      this.on('state', onState)
    })
  }

  private connect(): void {
    if (!this.active || this.ws) return
    this.setState('connecting')
    const { address, port, clientId, token } = this.link
    let ws: WebSocket
    try {
      ws = new WebSocket(`ws://${address}:${port}/lumos/remote`, { handshakeTimeout: 4000, maxPayload: 1024 * 1024 })
    } catch {
      this.scheduleReconnect()
      return
    }
    this.ws = ws
    const clientNonce = newNonce()
    let hubNonce = ''

    ws.on('open', () => ws.send(JSON.stringify({ t: 'auth', clientId, nonce: clientNonce })))
    ws.on('message', (data: RawData, isBinary: boolean) => {
      const buf = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as ArrayBuffer)
      if (!this.channel) {
        let msg: Record<string, unknown>
        try {
          msg = JSON.parse(buf.toString('utf8'))
        } catch {
          return ws.terminate()
        }
        if (msg.t === 'challenge' && typeof msg.nonce === 'string') {
          hubNonce = msg.nonce
          ws.send(JSON.stringify({ t: 'proof', mac: proof(token, 'client', clientNonce, hubNonce) }))
        } else if (msg.t === 'ok' && hubNonce && verifyProof(proof(token, 'hub', clientNonce, hubNonce), msg.mac)) {
          this.channel = new SecureChannel(token, clientNonce, hubNonce)
          this.backoffMs = 1000
          this.lastError = ''
          if (typeof msg.hubName === 'string') this.link = { ...this.link, hubName: msg.hubName.slice(0, 64) }
          this.stopBeaconWatch()
          this.setState('connected')
        } else if (msg.t === 'denied') {
          this.lastError = `${this.link.hubName} no longer recognises this computer. Pair again.`
          this.emit('denied')
          ws.terminate()
        } else {
          ws.terminate()
        }
        return
      }
      if (!isBinary) return
      const msg = this.channel.open(buf) as Record<string, unknown> | null
      if (!msg) return
      if (msg.t === 'result' && typeof msg.id === 'number') {
        const p = this.pending.get(msg.id)
        if (!p) return
        this.pending.delete(msg.id)
        clearTimeout(p.timer)
        if (msg.ok) p.resolve(msg.value)
        else p.reject(new Error(typeof msg.error === 'string' ? msg.error : 'Failed'))
      } else if (msg.t === 'event' && typeof msg.channel === 'string' && FORWARDED_EVENTS.has(msg.channel)) {
        this.emit('event', msg.channel, msg.payload)
      }
    })
    ws.on('error', () => {})
    ws.on('close', () => {
      if (this.ws !== ws) return
      this.ws = null
      this.channel = null
      for (const p of this.pending.values()) {
        clearTimeout(p.timer)
        p.reject(new Error(`Lost connection to ${this.link.hubName}`))
      }
      this.pending.clear()
      this.setState('disconnected')
      this.scheduleReconnect()
    })
  }

  private scheduleReconnect(): void {
    if (!this.active || this.reconnectTimer) return
    this.startBeaconWatch()
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, this.backoffMs)
    this.backoffMs = Math.min(this.backoffMs * 2, 15000)
  }

  /** While disconnected, listen for the hub's beacon in case its address changed. */
  private startBeaconWatch(): void {
    if (this.beaconSock) return
    try {
      const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true })
      sock.on('message', (msg, rinfo) => {
        const hub = parseBeacon(msg, rinfo.address)
        if (!hub || hub.id !== this.link.hubId) return
        if (hub.address !== this.link.address || hub.port !== this.link.port) {
          this.link = { ...this.link, address: hub.address, port: hub.port }
          this.emit('address', hub.address, hub.port)
          // Try the new address straight away
          if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
          this.reconnectTimer = null
          this.backoffMs = 1000
          this.connect()
        }
      })
      sock.on('error', () => {})
      sock.bind(BEACON_PORT)
      this.beaconSock = sock
    } catch {
      this.beaconSock = null
    }
  }

  private stopBeaconWatch(): void {
    try {
      this.beaconSock?.close()
    } catch {
      // already closed
    }
    this.beaconSock = null
  }

  private setState(state: LinkState): void {
    if (this.state === state) return
    this.state = state
    this.emit('state', state)
  }
}
