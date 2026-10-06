import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import http from 'http'
import { AddressInfo } from 'net'
import { randomBytes } from 'crypto'
import { WebSocketServer } from 'ws'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn(), on: vi.fn() } }))

import { handle, on, invokeLocal } from '../main/remote/registry'
import { RemoteHub, PairedClient } from '../main/remote/RemoteHub'
import { RemoteClient, pairWithHub } from '../main/remote/RemoteClient'
import { SecureChannel, isPrivateAddress, newToken, proof } from '../main/remote/secure'

/**
 * A hub and a client talking over loopback: pairing, the authenticated and
 * encrypted session, forwarded actions, live updates, and the protections
 * around them.
 */

const calls: Array<{ channel: string; args: unknown[] }> = []
handle('get-status', async () => [{ id: 'light-1', name: 'Left', power: true }])
handle('set-power', async (_e, id: string, on: boolean) => {
  calls.push({ channel: 'set-power', args: [id, on] })
  return true
})
on('stream-brightness', (_e, id: string, value: number) => {
  calls.push({ channel: 'stream-brightness', args: [id, value] })
})
handle('window-close', async () => 'should never run remotely')

async function freePort(): Promise<number> {
  const srv = http.createServer()
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()))
  const port = (srv.address() as AddressInfo).port
  await new Promise<void>((r) => srv.close(() => r()))
  return port
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
async function waitFor(check: () => boolean, ms = 4000): Promise<void> {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > ms) throw new Error('timed out')
    await sleep(20)
  }
}

describe('Control from other computers', () => {
  let clients: PairedClient[]
  let hub: RemoteHub
  let port: number
  const hubId = randomBytes(16).toString('hex')
  const clientId = randomBytes(16).toString('hex')

  beforeEach(async () => {
    calls.length = 0
    clients = []
    port = await freePort()
    hub = new RemoteHub(
      { getClients: () => clients, addClient: (c) => (clients = [...clients.filter((x) => x.id !== c.id), c]) },
      hubId,
      'Desk PC',
      port
    )
    await hub.start()
  })

  afterEach(() => hub.stop())

  async function pairAndConnect(): Promise<RemoteClient> {
    hub.newPairingCode()
    const code = hub.getPairingCode().code
    const paired = await pairWithHub('127.0.0.1', port, code, clientId, 'Laptop')
    const client = new RemoteClient({ hubId: paired.hubId, hubName: paired.hubName, address: '127.0.0.1', port, token: paired.token, clientId })
    client.start()
    await waitFor(() => client.getState() === 'connected')
    return client
  }

  it('pairs with the code, connects, and forwards actions and results', async () => {
    const client = await pairAndConnect()
    expect(clients).toHaveLength(1)
    expect(clients[0].name).toBe('Laptop')
    expect(hub.connectedClientIds()).toEqual([clientId])

    expect(await client.invoke('get-status', [])).toEqual([{ id: 'light-1', name: 'Left', power: true }])
    expect(await client.invoke('set-power', ['light-1', false])).toBe(true)
    client.send('stream-brightness', ['light-1', 42])
    await waitFor(() => calls.length === 2)
    expect(calls).toEqual([
      { channel: 'set-power', args: ['light-1', false] },
      { channel: 'stream-brightness', args: ['light-1', 42] }
    ])
    client.stop()
  })

  it('pushes live updates from the hub to the client', async () => {
    const client = await pairAndConnect()
    const events: Array<[string, unknown]> = []
    client.on('event', (channel: string, payload: unknown) => events.push([channel, payload]))
    hub.broadcast('light-update', { id: 'light-1', power: false })
    hub.broadcast('not-an-event', { secret: true })
    await waitFor(() => events.length === 1)
    await sleep(100)
    expect(events).toEqual([['light-update', { id: 'light-1', power: false }]])
    client.stop()
  })

  it('refuses actions that are not shared', async () => {
    const client = await pairAndConnect()
    await expect(client.invoke('window-close', [])).rejects.toThrow('Not allowed')
    await expect(invokeLocal('window-close', [])).rejects.toThrow('Not allowed')
    client.stop()
  })

  it('a pairing code works once, and wrong codes are limited', async () => {
    hub.newPairingCode()
    const code = hub.getPairingCode().code
    await pairWithHub('127.0.0.1', port, code, clientId, 'Laptop')
    await expect(pairWithHub('127.0.0.1', port, code, clientId, 'Laptop')).rejects.toThrow()

    hub.newPairingCode()
    const good = hub.getPairingCode().code
    const wrong = good === '000000' ? '111111' : '000000'
    // Reusing the spent code above already counted as one failure
    for (let i = 0; i < 4; i++) await expect(pairWithHub('127.0.0.1', port, wrong, clientId, 'x')).rejects.toThrow('not right')
    // Locked out now, even with the right code
    await expect(pairWithHub('127.0.0.1', port, good, clientId, 'x')).rejects.toThrow('Too many')
  })

  it('rejects a computer that is not paired or does not know the token', async () => {
    await pairAndConnect().then((c) => c.stop())

    // Unknown computer
    const stranger = new RemoteClient({ hubId, hubName: 'Desk PC', address: '127.0.0.1', port, token: newToken(), clientId: randomBytes(16).toString('hex') })
    let denied = false
    stranger.on('denied', () => (denied = true))
    stranger.start()
    await waitFor(() => denied)
    expect(stranger.getState()).not.toBe('connected')
    stranger.stop()

    // Known id, wrong token: the proof does not match
    const impostor = new RemoteClient({ hubId, hubName: 'Desk PC', address: '127.0.0.1', port, token: newToken(), clientId })
    let impostorDenied = false
    impostor.on('denied', () => (impostorDenied = true))
    impostor.start()
    await waitFor(() => impostorDenied)
    expect(hub.connectedClientIds()).toEqual([])
    impostor.stop()
  })

  it('a hub that does not know the token is not trusted by the client', async () => {
    // A fake hub that answers the handshake without knowing the token
    const fakePort = await freePort()
    const fake = new WebSocketServer({ port: fakePort, host: '127.0.0.1' })
    fake.on('connection', (ws) => {
      ws.on('message', (m) => {
        const msg = JSON.parse(String(m))
        if (msg.t === 'auth') ws.send(JSON.stringify({ t: 'challenge', nonce: randomBytes(16).toString('hex') }))
        if (msg.t === 'proof') ws.send(JSON.stringify({ t: 'ok', mac: randomBytes(32).toString('hex') }))
      })
    })
    const client = new RemoteClient({ hubId, hubName: 'Desk PC', address: '127.0.0.1', port: fakePort, token: newToken(), clientId })
    client.start()
    await sleep(800)
    expect(client.getState()).not.toBe('connected')
    client.stop()
    await new Promise<void>((r) => fake.close(() => r()))
  })

  it('removing a computer disconnects it and it cannot reconnect', async () => {
    const client = await pairAndConnect()
    clients = []
    hub.dropClient(clientId)
    await waitFor(() => client.getState() !== 'connected')
    await sleep(1500)
    expect(client.getState()).not.toBe('connected')
    client.stop()
  })

  it('reconnects on its own when the hub comes back', async () => {
    const client = await pairAndConnect()
    hub.stop()
    await waitFor(() => client.getState() !== 'connected')
    await hub.start()
    await waitFor(() => client.getState() === 'connected', 8000)
    expect(await client.invoke('get-status', [])).toHaveLength(1)
    client.stop()
  }, 15000)
})

describe('Message security', () => {
  const token = newToken()
  const a = 'a'.repeat(32)
  const b = 'b'.repeat(32)

  it('round-trips messages and rejects replays and tampering', () => {
    const sender = new SecureChannel(token, a, b)
    const receiver = new SecureChannel(token, a, b)
    const frame = sender.seal({ hello: 1 })
    expect(receiver.open(frame)).toEqual({ hello: 1 })
    expect(receiver.open(frame)).toBeNull() // replayed

    const next = sender.seal({ hello: 2 })
    const tampered = Buffer.from(next)
    tampered[20] ^= 1
    expect(receiver.open(tampered)).toBeNull()
    expect(receiver.open(next)).toEqual({ hello: 2 })
  })

  it('a different token or nonce cannot read the messages', () => {
    const frame = new SecureChannel(token, a, b).seal({ secret: true })
    expect(new SecureChannel(newToken(), a, b).open(frame)).toBeNull()
    expect(new SecureChannel(token, b, a).open(frame)).toBeNull()
  })

  it('proofs differ by role, so one side cannot echo the other', () => {
    expect(proof(token, 'client', a, b)).not.toBe(proof(token, 'hub', a, b))
  })

  it('accepts only private network addresses', () => {
    for (const ip of ['192.168.137.1', '10.0.0.5', '172.20.1.1', '127.0.0.1', '::1', '::ffff:192.168.1.2', '169.254.3.4']) {
      expect(isPrivateAddress(ip)).toBe(true)
    }
    for (const ip of ['8.8.8.8', '172.32.0.1', '1.1.1.1', '::ffff:8.8.8.8', undefined]) {
      expect(isPrivateAddress(ip)).toBe(false)
    }
  })
})
