import { describe, it, expect, vi } from 'vitest'

// Count ARP reads and pings; answer like Windows does
const calls: string[] = []
vi.mock('child_process', () => ({
  execSync: () => {
    throw new Error('blocking call')
  },
  execFile: (file: string, _args: string[], _opts: unknown, cb: (err: Error | null, out: string) => void) => {
    calls.push(file)
    const out = file === 'arp' ? '  192.0.2.45           d8-c8-0c-2d-44-37     dynamic\n' : ''
    setTimeout(() => cb(null, out), 5)
  }
}))

import { findIpForMac, resolveIpFromMac } from '../main/devices/arp'

describe('ARP lookups do not block and are shared', () => {
  it('reads the table once for many lights at the same time, without blocking calls', async () => {
    expect(resolveIpFromMac('d8:c8:0c:2d:44:37')).toBeNull() // nothing read yet, and nothing run
    const results = await Promise.all([
      findIpForMac('d8:c8:0c:2d:44:37'),
      findIpForMac('D8-C8-0C-2D-44-37'),
      findIpForMac('d8:c8:0c:2d:44:37')
    ])
    expect(results).toEqual(['192.0.2.45', '192.0.2.45', '192.0.2.45'])
    expect(calls.filter((c) => c === 'arp')).toHaveLength(1)
    expect(resolveIpFromMac('d8:c8:0c:2d:44:37')).toBe('192.0.2.45')
  })
})
