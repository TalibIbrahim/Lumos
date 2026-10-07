import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createCipheriv, randomBytes } from 'crypto'
import { writeFileAtomic } from '../main/atomicWrite'
import { isLocalHost } from '../main/hostCheck'
import { SecureChannel } from '../main/remote/secure'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe('atomic writes', () => {
  it('replaces the content and leaves no temporary file behind', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lumos-atomic-'))
    dirs.push(dir)
    const file = join(dir, 'lumos-store.json')
    writeFileSync(file, 'old')
    writeFileAtomic(file, '{"a":1}')
    expect(readFileSync(file, 'utf-8')).toBe('{"a":1}')
    expect(existsSync(`${file}.tmp`)).toBe(false)
  })
})

describe('webhook Host check', () => {
  it('accepts local names with or without a port', () => {
    for (const h of ['127.0.0.1', '127.0.0.1:8989', 'localhost:8989', 'LOCALHOST', '[::1]:8989']) expect(isLocalHost(h)).toBe(true)
  })
  it('rejects anything else, including a rebinding domain', () => {
    for (const h of [undefined, '', 'evil.example', 'evil.example:8989', '127.0.0.1.evil.example', 'localhost.evil.example:80', '127.0.0.1:99999x']) {
      expect(isLocalHost(h)).toBe(false)
    }
  })
})

describe('secure channel payloads', () => {
  const frameFor = (key: SecureChannel, payload: unknown): Buffer => {
    const k = (key as unknown as { key: Buffer }).key
    const iv = randomBytes(12)
    const c = createCipheriv('aes-256-gcm', k, iv)
    const body = Buffer.concat([c.update(Buffer.from(JSON.stringify(payload), 'utf8')), c.final()])
    return Buffer.concat([iv, body, c.getAuthTag()])
  }
  it('drops authenticated frames whose message is not an object', () => {
    const ch = new SecureChannel('t', 'a', 'b')
    for (const [i, m] of [null, 5, 'x', [1, 2], true].entries()) expect(ch.open(frameFor(ch, { s: i + 1, m }))).toBeNull()
    expect(ch.open(frameFor(ch, null))).toBeNull()
    expect(ch.open(frameFor(ch, { s: 99, m: { t: 'send' } }))).toEqual({ t: 'send' })
  })
})
