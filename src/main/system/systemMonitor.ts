import { EventEmitter } from 'events'
import { app } from 'electron'
import { spawn, ChildProcessWithoutNullStreams } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import { asObj, num, str } from '../effects/validate'

export type PlaybackStatus = 'Playing' | 'Paused' | 'Stopped' | 'None' | 'Other'

export interface MediaThumbnail {
  width: number
  height: number
  /** RGBA bytes, width * height * 4 long. */
  rgba: Uint8Array
}

export interface MediaState {
  status: PlaybackStatus
  /** Opaque track identity; titles and artists are never exposed. */
  key: string | null
  thumbnail: MediaThumbnail | null
}

export interface SystemState {
  /** Output level peak over the last sample window, 0..1, or -1 if unavailable. */
  peak: number
  fullscreen: boolean
}

const MAX_LINE = 64 * 1024
const MAX_THUMB_SIDE = 64

/** Parses one line from the helper. Returns null for anything malformed. */
export function parseHelperLine(
  line: string
): { kind: 'media'; media: MediaState } | { kind: 'sys'; sys: SystemState } | { kind: 'other' } | null {
  if (line.length === 0 || line.length > MAX_LINE) return null
  let raw: unknown
  try {
    raw = JSON.parse(line)
  } catch {
    return null
  }
  const o = asObj(raw)
  if (o.t === 'sys') {
    return {
      kind: 'sys',
      sys: { peak: num(o.peak, -1, -1, 1), fullscreen: o.fullscreen === true }
    }
  }
  if (o.t === 'media') {
    const s = str(o.status, 'None', 20)
    const known: readonly string[] = ['Playing', 'Paused', 'Stopped', 'None']
    const status: PlaybackStatus = known.includes(s) ? (s as PlaybackStatus) : 'Other'
    const key = typeof o.key === 'string' && /^[0-9a-f]{1,64}$/.test(o.key) ? o.key : null
    let thumbnail: MediaThumbnail | null = null
    if (typeof o.thumb === 'string') {
      const w = num(o.w, 0, 0, MAX_THUMB_SIDE)
      const h = num(o.h, 0, 0, MAX_THUMB_SIDE)
      const bytes = Buffer.from(o.thumb, 'base64')
      if (w > 0 && h > 0 && Number.isInteger(w) && Number.isInteger(h) && bytes.length === w * h * 4) {
        thumbnail = { width: w, height: h, rgba: new Uint8Array(bytes) }
      }
    }
    return { kind: 'media', media: { status, key, thumbnail } }
  }
  if (o.t === 'ready' || o.t === 'error') return { kind: 'other' }
  return null
}

export function resolveHelperPath(): string | null {
  if (process.platform !== 'win32') return null
  const candidates: string[] = []
  try {
    if (app?.isPackaged) candidates.push(join(process.resourcesPath, 'media-helper', 'LumosMediaHelper.exe'))
    if (app?.getAppPath) candidates.push(join(app.getAppPath(), 'resources', 'media-helper', 'LumosMediaHelper.exe'))
  } catch {
    // Not running under Electron
  }
  candidates.push(join(process.cwd(), 'resources', 'media-helper', 'LumosMediaHelper.exe'))
  return candidates.find((p) => existsSync(p)) ?? null
}

/**
 * Supplies media session and system activity state to effects. The helper
 * process only runs while at least one effect has acquired the monitor.
 * A simulated source can be pushed in for demo mode.
 */
export class SystemMonitor extends EventEmitter {
  private consumers = new Set<string>()
  private child: ChildProcessWithoutNullStreams | null = null
  private restartTimer: NodeJS.Timeout | null = null
  private backoffMs = 1000
  private buffer = ''
  private media: MediaState = { status: 'None', key: null, thumbnail: null }
  private sys: SystemState = { peak: -1, fullscreen: false }
  private lastAudibleAt = 0
  private available: boolean | null = null
  private error = ''
  private simulated = false

  constructor(private helperPath: () => string | null = resolveHelperPath) {
    super()
  }

  public acquire(consumer: string): void {
    this.consumers.add(consumer)
    if (!this.simulated) this.ensureRunning()
  }

  public release(consumer: string): void {
    this.consumers.delete(consumer)
    if (this.consumers.size === 0) this.stopChild()
  }

  public getMedia(): MediaState {
    return this.media
  }

  public getSystem(): SystemState {
    return this.sys
  }

  /** True if audio was heard on the output device within the window. */
  public isAudible(windowMs = 4000, now = Date.now()): boolean {
    return now - this.lastAudibleAt < windowMs
  }

  /** null until the helper has been tried; false when it cannot run here. */
  public isAvailable(): boolean | null {
    return this.simulated ? true : this.available
  }

  public getError(): string {
    return this.error
  }

  /** Demo mode: stop the helper and accept pushed state instead. */
  public setSimulated(on: boolean): void {
    this.simulated = on
    if (on) this.stopChild()
    else if (this.consumers.size > 0) this.ensureRunning()
  }

  public pushMedia(media: MediaState): void {
    this.media = media
    this.emit('media', media)
  }

  public pushSystem(sys: SystemState, now = Date.now()): void {
    this.sys = sys
    if (sys.peak > 0.01) this.lastAudibleAt = now
    this.emit('sys', sys)
  }

  private ensureRunning(): void {
    if (this.child || this.restartTimer || this.consumers.size === 0) return
    const path = this.helperPath()
    if (!path) {
      this.available = false
      this.error = process.platform === 'win32' ? 'The media helper is missing from this build' : 'Only available on Windows'
      this.emit('availability', false)
      return
    }
    try {
      const child = spawn(path, ['--interval', '1000'], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
      this.child = child
      this.buffer = ''
      child.stdout.setEncoding('utf8')
      child.stdout.on('data', (chunk: string) => this.onData(chunk))
      child.stderr.on('data', () => {
        // Diagnostics only; never contains track details
      })
      child.on('error', (err) => {
        this.error = err.message
        this.available = false
        this.emit('availability', false)
      })
      child.on('exit', () => {
        this.child = null
        if (this.consumers.size > 0 && !this.simulated) this.scheduleRestart()
      })
    } catch (err) {
      this.available = false
      this.error = err instanceof Error ? err.message : 'Could not start the media helper'
      this.emit('availability', false)
    }
  }

  private scheduleRestart(): void {
    if (this.restartTimer) return
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null
      this.ensureRunning()
    }, this.backoffMs)
    this.backoffMs = Math.min(this.backoffMs * 2, 30000)
  }

  private onData(chunk: string): void {
    this.buffer += chunk
    if (this.buffer.length > MAX_LINE * 4) {
      // A runaway line; drop it rather than grow without bound
      this.buffer = ''
      return
    }
    let idx: number
    while ((idx = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, idx).trim()
      this.buffer = this.buffer.slice(idx + 1)
      const parsed = parseHelperLine(line)
      if (!parsed) continue
      if (this.available !== true) {
        this.available = true
        this.error = ''
        this.backoffMs = 1000
        this.emit('availability', true)
      }
      if (parsed.kind === 'sys') this.pushSystem(parsed.sys)
      else if (parsed.kind === 'media') {
        // Keep the last thumbnail for the same track; the helper only sends it on change
        const media =
          parsed.media.thumbnail || parsed.media.key !== this.media.key
            ? parsed.media
            : { ...parsed.media, thumbnail: this.media.thumbnail }
        this.pushMedia(media)
      }
    }
  }

  private stopChild(): void {
    if (this.restartTimer) {
      clearTimeout(this.restartTimer)
      this.restartTimer = null
    }
    const child = this.child
    this.child = null
    if (child) {
      try {
        child.stdin.end()
      } catch {
        // already closed
      }
      setTimeout(() => {
        if (child.exitCode === null) child.kill()
      }, 1500).unref?.()
    }
  }

  public destroy(): void {
    this.consumers.clear()
    this.stopChild()
    this.removeAllListeners()
  }
}

export const systemMonitor = new SystemMonitor()
