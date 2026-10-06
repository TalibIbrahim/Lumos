import { createCipheriv, createDecipheriv, createHmac, randomBytes, randomInt, timingSafeEqual } from 'crypto'

/**
 * Cryptography for control between computers.
 *
 * Pairing hands the other computer a random 256-bit token once. After that
 * the token never crosses the network: each connection proves knowledge of it
 * both ways with an HMAC challenge, derives a fresh session key from both
 * sides' nonces, and encrypts every message with AES-256-GCM. Each message
 * carries a sequence number that must increase, so recorded messages cannot
 * be replayed.
 */

export function newToken(): string {
  return randomBytes(32).toString('hex')
}

export function newNonce(): string {
  return randomBytes(16).toString('hex')
}

/** Six digits shown on the hub for pairing. */
export function newPairingCode(): string {
  return String(randomInt(0, 1000000)).padStart(6, '0')
}

function hmac(token: string, ...parts: string[]): Buffer {
  return createHmac('sha256', Buffer.from(token, 'hex')).update(parts.join('|')).digest()
}

export function proof(token: string, role: 'client' | 'hub', clientNonce: string, hubNonce: string): string {
  return hmac(token, role, clientNonce, hubNonce).toString('hex')
}

export function verifyProof(expected: string, given: unknown): boolean {
  if (typeof given !== 'string' || given.length !== expected.length) return false
  try {
    return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(given, 'hex'))
  } catch {
    return false
  }
}

/** Constant-time comparison for pairing codes. */
export function codesMatch(expected: string, given: unknown): boolean {
  if (typeof given !== 'string' || given.length !== expected.length) return false
  return timingSafeEqual(Buffer.from(expected), Buffer.from(given))
}

/** Encrypts and decrypts the messages of one connection. */
export class SecureChannel {
  private readonly key: Buffer
  private sendSeq = 0
  private lastReceivedSeq = 0

  constructor(token: string, clientNonce: string, hubNonce: string) {
    this.key = hmac(token, 'session', clientNonce, hubNonce)
  }

  public seal(message: unknown): Buffer {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', this.key, iv)
    const plain = Buffer.from(JSON.stringify({ s: ++this.sendSeq, m: message }), 'utf8')
    const body = Buffer.concat([cipher.update(plain), cipher.final()])
    return Buffer.concat([iv, body, cipher.getAuthTag()])
  }

  /** Returns the message, or null if it was tampered with, replayed, or malformed. */
  public open(frame: Buffer): unknown | null {
    if (frame.length < 12 + 16 + 2) return null
    try {
      const iv = frame.subarray(0, 12)
      const tag = frame.subarray(frame.length - 16)
      const body = frame.subarray(12, frame.length - 16)
      const decipher = createDecipheriv('aes-256-gcm', this.key, iv)
      decipher.setAuthTag(tag)
      const plain = Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8')
      const parsed = JSON.parse(plain) as { s?: unknown; m?: unknown }
      if (typeof parsed.s !== 'number' || parsed.s <= this.lastReceivedSeq) return null
      this.lastReceivedSeq = parsed.s
      return parsed.m ?? null
    } catch {
      return null
    }
  }
}

/** Private, link-local, and loopback addresses only. */
export function isPrivateAddress(address: string | undefined): boolean {
  if (!address) return false
  const ip = address.startsWith('::ffff:') ? address.slice(7) : address
  if (ip === '::1' || ip === '127.0.0.1') return true
  const m = ip.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/)
  if (!m) return /^fe80:/i.test(ip) || /^f[cd][0-9a-f]{2}:/i.test(ip)
  const [a, b] = [Number(m[1]), Number(m[2])]
  return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254)
}
