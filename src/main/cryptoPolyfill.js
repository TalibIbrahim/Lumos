import crypto from 'crypto'
import { ChaCha20Poly1305 } from '@stablelib/chacha20poly1305'

const origCreateCipheriv = crypto.createCipheriv
const origCreateDecipheriv = crypto.createDecipheriv
const origGetCiphers = crypto.getCiphers

// Ensure chacha20-poly1305 is recognized in getCiphers
crypto.getCiphers = function () {
  const list = origGetCiphers.call(this)
  if (!list.includes('chacha20-poly1305')) {
    list.push('chacha20-poly1305')
  }
  return list
}

// Polyfill createCipheriv for chacha20-poly1305 in Electron / BoringSSL environments
crypto.createCipheriv = function (algorithm, key, nonce, options) {
  if (typeof algorithm === 'string' && algorithm.toLowerCase() === 'chacha20-poly1305') {
    let aad = null
    let authTag = null
    const cipher = new ChaCha20Poly1305(key)
    return {
      setAAD(buf) {
        aad = buf
        return this
      },
      update(plaintext) {
        const sealed = cipher.seal(nonce, plaintext, aad || undefined)
        const ciphertext = Buffer.from(sealed.slice(0, sealed.length - 16))
        authTag = Buffer.from(sealed.slice(sealed.length - 16))
        return ciphertext
      },
      final() {
        return Buffer.alloc(0)
      },
      getAuthTag() {
        return authTag
      }
    }
  }
  return origCreateCipheriv.call(this, algorithm, key, nonce, options)
}

// Polyfill createDecipheriv for chacha20-poly1305 in Electron / BoringSSL environments
crypto.createDecipheriv = function (algorithm, key, nonce, options) {
  if (typeof algorithm === 'string' && algorithm.toLowerCase() === 'chacha20-poly1305') {
    let aad = null
    let authTag = null
    let verified = false
    const cipher = new ChaCha20Poly1305(key)
    return {
      setAAD(buf) {
        aad = buf
        return this
      },
      setAuthTag(buf) {
        authTag = buf
        return this
      },
      update(ciphertext) {
        if (!authTag) throw new Error('Auth tag not set')
        const sealed = Buffer.concat([ciphertext, authTag])
        const opened = cipher.open(nonce, sealed, aad || undefined)
        if (!opened) throw new Error('Unsupported state or unable to authenticate data')
        verified = true
        return Buffer.from(opened)
      },
      final() {
        if (!verified) throw new Error('Unsupported state or unable to authenticate data')
        return Buffer.alloc(0)
      }
    }
  }
  return origCreateDecipheriv.call(this, algorithm, key, nonce, options)
}
