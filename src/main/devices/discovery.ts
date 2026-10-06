import net from 'net'
import os from 'os'
import dgram from 'dgram'
import { EventEmitter } from 'events'
import TuyAPI from 'tuyapi'
import { MessageParser } from 'tuyapi/lib/message-parser'
import { UDP_KEY } from 'tuyapi/lib/config'

/**
 * Finding lights whose address changed, for example after a power cut when
 * the router or hotspot hands out new addresses.
 *
 * Tuya bulbs on protocol 3.5 do not announce themselves where older discovery
 * listens, and the ARP table often has no entry for them, so Lumos scans the
 * local network for the Tuya port and confirms each candidate with the light's
 * own key. Only the light that answers with that key is accepted.
 */

const TUYA_PORT = 6668
const SCAN_CACHE_MS = 30000
const SKIP_INTERFACES = ['vethernet', 'virtualbox', 'vmware', 'loopback', 'bluetooth', 'wsl', 'hyper-v']

// --- Announcements ---
//
// Tuya lights announce themselves on the local network every few seconds:
// older protocols on UDP 6666 and 6667, protocol 3.5 on UDP 7000 (encrypted
// with a key every Tuya client knows). A light stops announcing while
// something is connected to it, so hearing a light means nothing holds it.

const ANNOUNCE_PORTS = [6666, 6667, 7000]
const MAX_ANNOUNCE_BYTES = 2048

export interface Announcement {
  id: string
  ip: string
  version: string
  at: number
}

const parsers: Record<string, MessageParser> = {}
const parserFor = (version: string): MessageParser =>
  (parsers[version] ||= new MessageParser({ key: UDP_KEY, version }))

/** Decodes one announcement packet. Returns null for anything that is not a valid Tuya announcement. */
export function decodeAnnouncement(packet: Buffer, at = Date.now()): Announcement | null {
  if (packet.length < 24 || packet.length > MAX_ANNOUNCE_BYTES) return null
  const prefix = packet.readUInt32BE(0)
  const versions = prefix === 0x00006699 ? ['3.5'] : prefix === 0x000055aa ? ['3.3', '3.1'] : []
  for (const version of versions) {
    try {
      const [first] = parserFor(version).parse(packet)
      let payload = first?.payload as Record<string, unknown> | Buffer | string | undefined
      // Decrypted 3.5 payloads come back as bytes with a binary prefix
      // (header padding or a return code) before the JSON object
      if (Buffer.isBuffer(payload) || typeof payload === 'string') {
        const text = payload.toString()
        const start = text.indexOf('{')
        const end = text.lastIndexOf('}')
        if (start < 0 || end <= start) continue
        payload = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>
      }
      if (!payload || typeof payload !== 'object') continue
      const id = payload.gwId
      const ip = payload.ip
      if (typeof id !== 'string' || !/^[A-Za-z0-9]{8,40}$/.test(id)) continue
      if (typeof ip !== 'string' || !/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) continue
      const v = typeof payload.version === 'string' && /^3\.[0-9]$/.test(payload.version) ? payload.version : version
      return { id, ip, version: v, at }
    } catch {
      // try the next format
    }
  }
  return null
}

/**
 * Listens for light announcements. Shared by every light; emits
 * 'announce' with each decoded announcement.
 */
export class AnnouncementListener extends EventEmitter {
  private sockets: dgram.Socket[] = []
  private latest = new Map<string, Announcement>()

  public start(): void {
    if (this.sockets.length > 0) return
    for (const port of ANNOUNCE_PORTS) {
      try {
        const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true })
        sock.on('message', (msg) => {
          const a = decodeAnnouncement(msg)
          if (!a) return
          this.latest.set(a.id, a)
          this.emit('announce', a)
        })
        // Another program may hold the port; announcements are a convenience
        sock.on('error', () => {})
        sock.bind(port)
        this.sockets.push(sock)
      } catch {
        // keep going with the other ports
      }
    }
  }

  public stop(): void {
    for (const s of this.sockets) {
      try {
        s.close()
      } catch {
        // already closed
      }
    }
    this.sockets = []
  }

  /** The latest announcement from a light, if heard within maxAgeMs. */
  public get(id: string, maxAgeMs = 30000, now = Date.now()): Announcement | null {
    const a = this.latest.get(id)
    return a && now - a.at <= maxAgeMs ? a : null
  }

  /** For tests. */
  public record(a: Announcement): void {
    this.latest.set(a.id, a)
    this.emit('announce', a)
  }
}

export const announcements = new AnnouncementListener()

/** Addresses held by lights this app is connected to, so they are not probed. */
const claimed = new Map<string, string>()

export function claimAddress(ip: string, lightId: string): void {
  claimed.set(ip, lightId)
}

export function releaseAddress(ip: string | undefined, lightId: string): void {
  if (ip && claimed.get(ip) === lightId) claimed.delete(ip)
}

/** The /24 networks of this computer's real network adapters, as "a.b.c" prefixes. */
export function localPrefixes(): string[] {
  const prefixes = new Set<string>()
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    const lower = name.toLowerCase()
    if (!list || SKIP_INTERFACES.some((s) => lower.includes(s))) continue
    for (const info of list) {
      if (info.internal || info.family !== 'IPv4' || info.address.startsWith('169.254.')) continue
      prefixes.add(info.address.split('.').slice(0, 3).join('.'))
    }
  }
  return Array.from(prefixes)
}

/** True if something accepts a TCP connection on the Tuya port. */
export function probeTcp(ip: string, timeoutMs = 1500): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.connect({ host: ip, port: TUYA_PORT, timeout: timeoutMs })
    let done = false
    const finish = (ok: boolean): void => {
      if (done) return
      done = true
      sock.destroy()
      resolve(ok)
    }
    sock.on('connect', () => finish(true))
    sock.on('timeout', () => finish(false))
    sock.on('error', () => finish(false))
  })
}

let scanCache: { at: number; result: Promise<string[]> } | null = null

/**
 * Addresses on the local networks with the Tuya port open. One scan is shared
 * by every light looking at the same time and reused for 30 seconds.
 */
export function scanForTuyaPorts(prefixes = localPrefixes(), timeoutMs = 2000): Promise<string[]> {
  if (scanCache && Date.now() - scanCache.at < SCAN_CACHE_MS) return scanCache.result
  const result = (async () => {
    const targets: string[] = []
    for (const p of prefixes) for (let i = 1; i <= 254; i++) targets.push(`${p}.${i}`)
    const open: string[] = []
    // Bounded concurrency keeps the scan light on the network
    const BATCH = 128
    for (let i = 0; i < targets.length; i += BATCH) {
      const batch = targets.slice(i, i + BATCH)
      const results = await Promise.all(batch.map((ip) => probeTcp(ip, timeoutMs)))
      results.forEach((ok, j) => ok && open.push(batch[j]))
    }
    return open
  })()
  scanCache = { at: Date.now(), result }
  return result
}

/** Forgets the shared scan, so the next search looks again. */
export function clearScanCache(): void {
  scanCache = null
}

export interface DeviceIdentity {
  id: string
  key: string
  version: string
}

/** True if the light at this address answers with this device's key. */
export async function verifyDevice(device: DeviceIdentity, ip: string, timeoutMs = 5000): Promise<boolean> {
  const client = new TuyAPI({ id: device.id, key: device.key, ip, version: device.version, issueGetOnConnect: false })
  client.on('error', () => {})
  const timeout = <T>(p: Promise<T>): Promise<T> =>
    Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs))])
  try {
    await timeout(client.connect())
    const res = await timeout(client.get({ schema: true }))
    return Boolean(res && typeof res === 'object')
  } catch {
    return false
  } finally {
    try {
      client.disconnect()
    } catch {
      // already closed
    }
  }
}

/**
 * Looks for a light on the local networks and returns its new address, or
 * null. Addresses already in use by other connected lights are skipped.
 */
export async function locateDevice(device: DeviceIdentity, skip: string[] = []): Promise<string | null> {
  // A light that announced itself recently is checked first, without a scan
  const heard = announcements.get(device.id)
  if (heard && !skip.includes(heard.ip) && (await verifyDevice({ ...device, version: heard.version }, heard.ip))) {
    return heard.ip
  }
  const candidates = (await scanForTuyaPorts()).filter((ip) => !skip.includes(ip) && !claimed.has(ip) && ip !== heard?.ip)
  for (const ip of candidates) {
    if (await verifyDevice(device, ip)) return ip
  }
  return null
}
