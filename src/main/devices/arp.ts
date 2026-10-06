import { execSync } from 'child_process'
import os from 'os'

/**
 * Parses the system ARP table to map MAC addresses to IP addresses.
 * Solves multi-NIC / dynamic DHCP reassignment limitations on local subnets.
 */
export function getArpTable(): Map<string, string> {
  const map = new Map<string, string>()
  try {
    const output = execSync('arp -a', { encoding: 'utf-8', timeout: 2000 })
    const lines = output.split('\n')
    for (const line of lines) {
      const match = line.trim().match(/(\d+\.\d+\.\d+\.\d+)\s+([0-9a-fA-F:-]{11,17})/)
      if (match) {
        const ip = match[1]
        const mac = match[2].toLowerCase().replace(/-/g, ':')
        map.set(mac, ip)
      }
    }
  } catch {
    // ARP command failure fallback
  }
  return map
}

function calculateBroadcast(ip: string, netmask: string): string {
  try {
    const ipParts = ip.split('.').map(Number)
    const maskParts = netmask.split('.').map(Number)
    if (ipParts.length === 4 && maskParts.length === 4) {
      const broadcastParts = ipParts.map((part, i) => (part | (~maskParts[i] & 255)))
      return broadcastParts.join('.')
    }
  } catch {
    // fallback
  }
  return ip.substring(0, ip.lastIndexOf('.')) + '.255'
}

export function refreshArpTable(): void {
  try {
    const ifaces = os.networkInterfaces()
    const targets: string[] = []

    for (const list of Object.values(ifaces)) {
      if (!list) continue
      for (const info of list) {
        if (!info.internal && info.family === 'IPv4' && !info.address.startsWith('169.254.')) {
          const bcast = calculateBroadcast(info.address, info.netmask || '255.255.255.0')
          if (!targets.includes(bcast)) {
            targets.push(bcast)
          }
        }
      }
    }

    if (process.platform === 'win32') {
      for (const target of targets.slice(0, 3)) {
        try {
          execSync(`ping -n 1 -w 200 ${target}`, { timeout: 600, stdio: 'ignore' })
        } catch {
          // ignore individual ping failure
        }
      }
    }
  } catch {
    // ignore
  }
}

export function resolveIpFromMac(mac?: string): string | null {
  if (!mac) return null
  const normalizedMac = mac.toLowerCase().replace(/-/g, ':').trim()
  let table = getArpTable()
  let resolved = table.get(normalizedMac)
  if (!resolved) {
    refreshArpTable()
    table = getArpTable()
    resolved = table.get(normalizedMac)
  }
  return resolved || null
}
