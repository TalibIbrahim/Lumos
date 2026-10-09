import { describe, it, expect } from 'vitest'
import net from 'net'
import os from 'os'
import {
  lumosColorTempToMireds,
  miredsToLumosColorTemp,
  detectLanInterfaces,
  checkPortAvailable,
  findAvailablePort
} from '../main/homekit'

describe('HomeKit Utilities', () => {
  describe('Color Temperature conversions', () => {
    it('maps 0 to 500 mireds (warm amber)', () => {
      expect(lumosColorTempToMireds(0)).toBe(500)
    })

    it('maps 100 to 140 mireds (cool daylight)', () => {
      expect(lumosColorTempToMireds(100)).toBe(140)
    })

    it('clamps values below 0 and above 100', () => {
      expect(lumosColorTempToMireds(-10)).toBe(500)
      expect(lumosColorTempToMireds(150)).toBe(140)
    })

    it('maps mireds back to lumos color temp', () => {
      expect(miredsToLumosColorTemp(500)).toBe(0)
      expect(miredsToLumosColorTemp(140)).toBe(100)
      expect(miredsToLumosColorTemp(320)).toBe(50)
    })

    it('clamps mireds input', () => {
      expect(miredsToLumosColorTemp(600)).toBe(0)
      expect(miredsToLumosColorTemp(100)).toBe(100)
    })
  })

  describe('detectLanInterfaces', () => {
    it('returns an array of strings without throwing and excludes VM switches', () => {
      const ifaces = detectLanInterfaces()
      expect(Array.isArray(ifaces)).toBe(true)
      for (const name of ifaces) {
        expect(typeof name).toBe('string')
        const lower = name.toLowerCase()
        expect(lower.includes('vethernet')).toBe(false)
        expect(lower.includes('virtualbox')).toBe(false)
        expect(lower.includes('vmware')).toBe(false)
        expect(lower.includes('loopback')).toBe(false)
        expect(lower.includes('bluetooth')).toBe(false)
        expect(lower.includes('wsl')).toBe(false)
      }
    })

    it('includes legitimate LAN and Mobile Hotspot interfaces while filtering VM adapters', () => {
      const original = os.networkInterfaces
      try {
        os.networkInterfaces = () => ({
          'Ethernet': [
            { address: '192.168.1.20', netmask: '255.255.255.0', family: 'IPv4', mac: '00:11:22:33:44:55', internal: false, cidr: '192.168.1.20/24' }
          ],
          'Local Area Connection* 10': [
            { address: '192.168.137.1', netmask: '255.255.255.0', family: 'IPv4', mac: '00:11:22:33:44:66', internal: false, cidr: '192.168.137.1/24' }
          ],
          'vEthernet (Default Switch)': [
            { address: '172.19.240.1', netmask: '255.255.240.0', family: 'IPv4', mac: '00:15:5d:00:00:01', internal: false, cidr: '172.19.240.1/20' }
          ],
          'VirtualBox Host-Only Ethernet Adapter': [
            { address: '192.168.56.1', netmask: '255.255.255.0', family: 'IPv4', mac: '0a:00:27:00:00:01', internal: false, cidr: '192.168.56.1/24' }
          ],
          'Bluetooth Network Connection': [
            { address: '192.168.2.1', netmask: '255.255.255.0', family: 'IPv4', mac: '00:11:22:33:44:77', internal: false, cidr: '192.168.2.1/24' }
          ],
          'Loopback Pseudo-Interface 1': [
            { address: '127.0.0.1', netmask: '255.0.0.0', family: 'IPv4', mac: '00:00:00:00:00:00', internal: true, cidr: '127.0.0.1/8' }
          ],
          'Local Area Connection* 9': [
            { address: '169.254.197.201', netmask: '255.255.0.0', family: 'IPv4', mac: '00:11:22:33:44:88', internal: false, cidr: '169.254.197.201/16' }
          ]
        })

        const ifaces = detectLanInterfaces()
        expect(ifaces).toContain('Ethernet')
        expect(ifaces).toContain('Local Area Connection* 10')
        expect(ifaces).not.toContain('vEthernet (Default Switch)')
        expect(ifaces).not.toContain('VirtualBox Host-Only Ethernet Adapter')
        expect(ifaces).not.toContain('Bluetooth Network Connection')
        expect(ifaces).not.toContain('Loopback Pseudo-Interface 1')
        expect(ifaces).not.toContain('Local Area Connection* 9')
      } finally {
        os.networkInterfaces = original
      }
    })
  })

  describe('Port availability and fallback', () => {
    it('detects available port', async () => {
      const isAvailable = await checkPortAvailable(51829)
      expect(typeof isAvailable).toBe('boolean')
    })

    it('detects when port is in use', async () => {
      const server = net.createServer()
      const testPort = await new Promise<number>((resolve, reject) => {
        server.once('error', reject)
        server.listen(0, '0.0.0.0', () => {
          const addr = server.address()
          resolve(typeof addr === 'object' && addr ? addr.port : 0)
        })
      })

      try {
        const isAvailable = await checkPortAvailable(testPort)
        expect(isAvailable).toBe(false)
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()))
      }
    })

    it('findAvailablePort falls back to another port when preferred port is occupied', async () => {
      const server = net.createServer()
      let occupiedPort = 51835
      for (let p = 51835; p <= 51850; p++) {
        const free = await checkPortAvailable(p)
        if (free) {
          occupiedPort = p
          break
        }
      }

      await new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(occupiedPort, '0.0.0.0', () => resolve())
      })

      try {
        const found = await findAvailablePort(occupiedPort)
        expect(found).not.toBe(occupiedPort)
        expect(found).toBeGreaterThan(0)
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()))
      }
    })
  })
})
