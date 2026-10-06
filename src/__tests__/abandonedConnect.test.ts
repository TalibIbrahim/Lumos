import { describe, it, expect } from 'vitest'
import { Light } from '../main/devices/Light'

/**
 * Regression: replacing a light's device client while a connection attempt
 * was still in progress left the old client without an error listener. When
 * that attempt timed out, tuyapi emitted "connection timed out" and the app
 * showed an uncaught exception dialog. Vitest fails this file if any error
 * escapes uncaught.
 */
describe('Replacing a connection attempt in progress', () => {
  it('does not throw when the abandoned attempt times out', async () => {
    // TEST-NET-1: nothing answers here, so the attempt hangs until tuyapi's 5 s timeout
    const light = new Light({ id: 'abandoned-test', name: 'Test', key: '0123456789abcdef', ip: '192.0.2.1', version: '3.5' })
    // @ts-expect-error reach the device client directly to start an attempt
    const first = light['tuya']
    const attempt = first.connect().catch(() => 'rejected')

    // What a retry or a search does: swap in a fresh client mid-attempt
    // @ts-expect-error private method
    light['initTuyaClient']()

    expect(await attempt).toBe('rejected')
    // Give the timeout's error event time to fire
    await new Promise((r) => setTimeout(r, 500))
    light.disconnect()
  }, 15000)
})
