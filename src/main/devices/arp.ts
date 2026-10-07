import { execFile } from 'child_process'
import os from 'os'

/**
 * Maps MAC addresses to IP addresses from the system ARP table, to follow lights
 * whose DHCP address changed. Reading the table starts a process, so it never
 * blocks the main thread and one read is shared by every light for a few seconds.
 */

const CACHE_MS = 3000

let cached: { at: number; table: Map<string, string> } | null = null
let reading: Promise<Map<string, string>> | null = null
let refreshing: Promise<void> | null = null

const normalizeMac = (mac: string): string => mac.toLowerCase().replace(/-/g, ':').trim()

export function parseArpOutput(output: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const line of output.split('\n')) {
    const match = line.trim().match(/(\d+\.\d+\.\d+\.\d+)\s+([0-9a-fA-F:-]{11,17})/)
    if (match) map.set(normalizeMac(match[2]), match[1])
  }
  return map
}

function run(file: string, args: string[], timeout: number): Promise<string> {
  return new Promise((resolve) => {
    execFile(file, args, { encoding: 'utf-8', timeout, windowsHide: true }, (_err, stdout) => resolve(stdout || ''))
  })
}

/** The ARP table, read at most once every few seconds however many lights ask. */
export function getArpTable(maxAgeMs = CACHE_MS): Promise<Map<string, string>> {
  if (cached && Date.now() - cached.at <= maxAgeMs) return Promise.resolve(cached.table)
  if (!reading) {
    reading = run('arp', ['-a'], 2000).then((out) => {
      cached = { at: Date.now(), table: parseArpOutput(out) }
      reading = null
      return cached.table
    })
  }
  return reading
}

function calculateBroadcast(ip: string, netmask: string): string {
  try {
    const ipParts = ip.split('.').map(Number)
    const maskParts = netmask.split('.').map(Number)
    if (ipParts.length === 4 && maskParts.length === 4) {
      const broadcastParts = ipParts.map((part, i) => part | (~maskParts[i] & 255))
      return broadcastParts.join('.')
    }
  } catch {
    // fallback
  }
  return ip.substring(0, ip.lastIndexOf('.')) + '.255'
}

/** Pings each local broadcast address so the ARP table fills in. The pings run in parallel. */
export function refreshArpTable(): Promise<void> {
  if (refreshing) return refreshing
  const targets: string[] = []
  for (const list of Object.values(os.networkInterfaces())) {
    if (!list) continue
    for (const info of list) {
      if (!info.internal && info.family === 'IPv4' && !info.address.startsWith('169.254.')) {
        const bcast = calculateBroadcast(info.address, info.netmask || '255.255.255.0')
        if (!targets.includes(bcast)) targets.push(bcast)
      }
    }
  }
  if (process.platform !== 'win32') return Promise.resolve()
  refreshing = Promise.all(targets.slice(0, 3).map((t) => run('ping', ['-n', '1', '-w', '200', t], 600))).then(() => {
    refreshing = null
  })
  return refreshing
}

/** The address last seen for a MAC, from the most recent table read. Runs nothing. */
export function resolveIpFromMac(mac?: string): string | null {
  if (!mac || !cached) return null
  return cached.table.get(normalizeMac(mac)) || null
}

/** Looks a MAC up in the ARP table, pinging the local networks first if it is not there yet. */
export async function findIpForMac(mac?: string): Promise<string | null> {
  if (!mac) return null
  const key = normalizeMac(mac)
  let ip = (await getArpTable()).get(key)
  if (!ip) {
    await refreshArpTable()
    ip = (await getArpTable(0)).get(key)
  }
  return ip || null
}
