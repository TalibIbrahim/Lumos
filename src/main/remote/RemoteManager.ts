import { EventEmitter } from 'events'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'
import os from 'os'
import { randomBytes } from 'crypto'
import { RemoteHub, PairedClient, HUB_PORT, hubAddresses } from './RemoteHub'
import { RemoteClient, HubLink, discoverHubs, pairWithHub, FoundHub } from './RemoteClient'
import { setForwarder } from './registry'
import { asObj, str } from '../effects/validate'

export type RemoteRole = 'off' | 'hub' | 'client'

interface Stored {
  role: RemoteRole
  /** Identity of this computer, used by both roles. */
  id: string
  hubClients: PairedClient[]
  link: HubLink | null
}

export interface RemoteStateData {
  role: RemoteRole
  computerName: string
  hub: {
    running: boolean
    error: string
    port: number
    addresses: string[]
    code: string | null
    codeExpiresAt: number | null
    clients: Array<{ id: string; name: string; addedAt: number; connected: boolean }>
  }
  client: {
    hubName: string
    address: string
    state: 'connecting' | 'connected' | 'disconnected'
    error: string
  } | null
}

export interface RoleHooks {
  /** This computer starts controlling another computer's lights: let go of the bulbs. */
  enterClient(): Promise<void> | void
  /** Back to controlling the bulbs directly. */
  leaveClient(): Promise<void> | void
}

const isHex = (v: unknown, len?: number): v is string =>
  typeof v === 'string' && /^[0-9a-f]+$/.test(v) && (len === undefined || v.length === len)

/**
 * Control from more than one computer. Tuya bulbs accept one local connection
 * at a time, so one computer (the hub) keeps the bulbs and the others control
 * the lights through it instead of connecting to the bulbs themselves.
 */
export class RemoteManager extends EventEmitter {
  private data: Stored
  private hub: RemoteHub | null = null
  private client: RemoteClient | null = null
  private readonly filePath: string
  private readonly name = os.hostname().slice(0, 64) || 'Computer'

  constructor(
    dataDir: string,
    private hooks: RoleHooks
  ) {
    super()
    this.filePath = join(dataDir, 'remote.json')
    this.data = this.load()
    setForwarder({
      isActive: () => Boolean(this.client?.isActive()),
      invoke: (channel, args) => (this.client ? this.client.invoke(channel, args) : Promise.reject(new Error('Not connected'))),
      send: (channel, args) => this.client?.send(channel, args)
    })
  }

  public getRole(): RemoteRole {
    return this.data.role
  }

  public isClient(): boolean {
    return this.data.role === 'client' && this.data.link !== null
  }

  /** Starts whatever role was saved. Call once at launch, before lights connect. */
  public async start(): Promise<void> {
    if (this.data.role === 'hub') await this.startHub()
    if (this.isClient()) this.startClient()
  }

  public stop(): void {
    this.hub?.stop()
    this.client?.stop()
  }

  /** Live updates from this computer, passed on to computers controlling it. */
  public onLocalEvent(channel: string, payload: unknown): void {
    this.hub?.broadcast(channel, payload)
  }

  // --- Hub ---

  public async setHubEnabled(on: boolean): Promise<RemoteStateData> {
    if (on) {
      if (this.data.role === 'client') await this.leave()
      this.data.role = 'hub'
      this.save()
      await this.startHub()
      this.hub?.newPairingCode()
    } else if (this.data.role === 'hub') {
      this.data.role = 'off'
      this.save()
      this.hub?.stop()
      this.hub = null
    }
    this.changed()
    return this.getState()
  }

  public newPairingCode(): RemoteStateData {
    this.hub?.newPairingCode()
    return this.getState()
  }

  public removeClient(id: string): RemoteStateData {
    this.data.hubClients = this.data.hubClients.filter((c) => c.id !== id)
    this.save()
    this.hub?.dropClient(id)
    this.changed()
    return this.getState()
  }

  private async startHub(): Promise<void> {
    if (this.hub) return
    const hub = new RemoteHub(
      {
        getClients: () => this.data.hubClients,
        addClient: (c) => {
          this.data.hubClients = [...this.data.hubClients.filter((x) => x.id !== c.id), c]
          this.save()
        }
      },
      this.data.id,
      this.name,
      HUB_PORT
    )
    hub.on('changed', () => this.changed())
    this.hub = hub
    await hub.start()
  }

  // --- Client ---

  public discover(): Promise<FoundHub[]> {
    return discoverHubs()
  }

  /** Pairs with a hub and starts controlling its lights. */
  public async pair(address: string, port: number, code: string): Promise<RemoteStateData> {
    const addr = address.trim()
    if (!/^[0-9a-zA-Z.\-:]{1,253}$/.test(addr)) throw new Error('Enter the other computer’s address')
    if (!/^\d{6}$/.test(code.trim())) throw new Error('Enter the six-digit code shown on the other computer')
    const p = Number.isInteger(port) && port > 0 && port < 65536 ? port : HUB_PORT
    const result = await pairWithHub(addr, p, code, this.data.id, this.name)
    if (result.hubId === this.data.id) throw new Error('That is this computer')

    if (this.data.role === 'hub') {
      this.hub?.stop()
      this.hub = null
    }
    this.client?.stop()
    this.data.role = 'client'
    this.data.link = { hubId: result.hubId, hubName: result.hubName, address: addr, port: p, token: result.token, clientId: this.data.id }
    this.save()
    await this.hooks.enterClient()
    this.startClient()
    this.changed()
    return this.getState()
  }

  /** Stops controlling the other computer and goes back to the bulbs directly. */
  public async leave(): Promise<RemoteStateData> {
    if (this.data.role !== 'client') return this.getState()
    this.client?.stop()
    this.client = null
    this.data.role = 'off'
    this.data.link = null
    this.save()
    await this.hooks.leaveClient()
    this.changed()
    return this.getState()
  }

  private startClient(): void {
    if (!this.data.link || this.client) return
    const client = new RemoteClient(this.data.link)
    client.on('state', () => this.changed())
    client.on('event', (channel: string, payload: unknown) => this.emit('event', channel, payload))
    client.on('address', (address: string, port: number) => {
      if (this.data.link) {
        this.data.link = { ...this.data.link, address, port }
        this.save()
      }
    })
    client.on('denied', () => this.changed())
    this.client = client
    client.start()
  }

  // --- State ---

  public getState(): RemoteStateData {
    const code = this.hub?.isRunning() ? this.hub.getPairingCodeIfAny() : null
    const connected = new Set(this.hub?.connectedClientIds() ?? [])
    return {
      role: this.data.role,
      computerName: this.name,
      hub: {
        running: Boolean(this.hub?.isRunning()),
        error: this.hub?.getError() ?? '',
        port: HUB_PORT,
        addresses: this.data.role === 'hub' ? hubAddresses() : [],
        code: code?.code ?? null,
        codeExpiresAt: code?.expiresAt ?? null,
        clients: this.data.hubClients.map((c) => ({ id: c.id, name: c.name, addedAt: c.addedAt, connected: connected.has(c.id) }))
      },
      client:
        this.data.role === 'client' && this.data.link
          ? {
              hubName: this.client?.getLink().hubName ?? this.data.link.hubName,
              address: this.client?.getLink().address ?? this.data.link.address,
              state: this.client?.getState() ?? 'disconnected',
              error: this.client?.getError() ?? ''
            }
          : null
    }
  }

  private changed(): void {
    this.emit('status', this.getState())
  }

  private load(): Stored {
    const fresh: Stored = { role: 'off', id: randomBytes(16).toString('hex'), hubClients: [], link: null }
    if (!existsSync(this.filePath)) return fresh
    try {
      const o = asObj(JSON.parse(readFileSync(this.filePath, 'utf-8').trimStart()))
      const id = isHex(o.id, 32) ? o.id : fresh.id
      const clients = Array.isArray(o.hubClients)
        ? o.hubClients
            .map((c) => asObj(c))
            .filter((c) => isHex(c.id) && isHex(c.token, 64))
            .map((c) => ({ id: c.id as string, name: str(c.name, 'Computer', 64), token: c.token as string, addedAt: Number(c.addedAt) || 0 }))
        : []
      const l = asObj(o.link)
      const link: HubLink | null =
        isHex(l.hubId) && isHex(l.token, 64) && typeof l.address === 'string'
          ? {
              hubId: l.hubId,
              hubName: str(l.hubName, 'Lumos', 64),
              address: l.address.slice(0, 253),
              port: Number.isInteger(l.port) ? (l.port as number) : HUB_PORT,
              token: l.token,
              clientId: id
            }
          : null
      const role: RemoteRole = o.role === 'hub' ? 'hub' : o.role === 'client' && link ? 'client' : 'off'
      return { role, id, hubClients: clients, link }
    } catch {
      return fresh
    }
  }

  private save(): void {
    try {
      const tmp = `${this.filePath}.tmp`
      writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf-8')
      renameSync(tmp, this.filePath)
    } catch (err) {
      console.error('[Lumos Remote] Could not save settings:', err)
    }
  }
}
