import net from 'net'
import os from 'os'
import TuyAPI from 'tuyapi'

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
  const candidates = (await scanForTuyaPorts()).filter((ip) => !skip.includes(ip) && !claimed.has(ip))
  for (const ip of candidates) {
    if (await verifyDevice(device, ip)) return ip
  }
  return null
}
