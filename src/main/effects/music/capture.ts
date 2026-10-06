import { EventEmitter } from 'events'
import { join } from 'path'
import { BrowserWindow, desktopCapturer, ipcMain, session, IpcMainEvent } from 'electron'
import { is } from '@electron-toolkit/utils'
import type { MusicFeatures } from '../../../shared/audio/analysis'
import { asObj } from '../validate'
import { sanitizeFeatures } from './features'

export interface CaptureConfig {
  sensitivity: number
  minBeatIntervalMs: number
}

export interface MusicSource extends EventEmitter {
  start(config: CaptureConfig): void
  configure(config: CaptureConfig): void
  stop(): void
}

const PARTITION = 'lumos-audio-analysis'

let handlerInstalled = false

/**
 * Runs the hidden analysis page. System output is captured with Electron's
 * loopback support for getDisplayMedia on Windows; the page reports features
 * only. The window exists only while the Music effect runs.
 */
export class LoopbackMusicSource extends EventEmitter implements MusicSource {
  private win: BrowserWindow | null = null
  private config: CaptureConfig = { sensitivity: 0.6, minBeatIntervalMs: 400 }
  private readonly onFeatures = (event: IpcMainEvent, raw: unknown): void => {
    if (!this.win || event.sender !== this.win.webContents) return
    const features = sanitizeFeatures(raw)
    if (features) this.emit('features', features)
  }
  private readonly onStatus = (event: IpcMainEvent, raw: unknown): void => {
    if (!this.win || event.sender !== this.win.webContents) return
    const o = asObj(raw)
    if (o.state === 'running') this.emit('status', { state: 'running' })
    else this.emit('status', { state: 'error', message: typeof o.message === 'string' ? o.message.slice(0, 200) : 'Audio capture failed' })
  }

  public start(config: CaptureConfig): void {
    this.config = config
    if (this.win) return
    if (process.platform !== 'win32') {
      this.emit('status', { state: 'error', message: 'System audio capture is only available on Windows' })
      return
    }
    const ses = session.fromPartition(PARTITION)
    if (!handlerInstalled) {
      ses.setDisplayMediaRequestHandler((_request, callback) => {
        desktopCapturer
          .getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } })
          .then((sources) => {
            if (sources.length === 0) callback({})
            else callback({ video: sources[0], audio: 'loopback' })
          })
          .catch(() => callback({}))
      })
      // Nothing else is ever granted to the analysis page
      ses.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'media'))
      handlerInstalled = true
    }

    ipcMain.on('audio-features', this.onFeatures)
    ipcMain.on('audio-status', this.onStatus)

    const win = new BrowserWindow({
      show: false,
      width: 200,
      height: 200,
      skipTaskbar: true,
      webPreferences: {
        preload: join(__dirname, '../preload/audio.js'),
        partition: PARTITION,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false
      }
    })
    this.win = win
    win.webContents.on('did-finish-load', () => win.webContents.send('audio-config', this.config))
    win.webContents.on('render-process-gone', () => {
      this.emit('status', { state: 'error', message: 'Audio analysis stopped unexpectedly' })
      this.stop()
    })
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    win.webContents.on('will-navigate', (e) => e.preventDefault())

    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/audio.html`)
    } else {
      win.loadFile(join(__dirname, '../renderer/audio.html'))
    }
  }

  public configure(config: CaptureConfig): void {
    this.config = config
    if (this.win && !this.win.isDestroyed()) this.win.webContents.send('audio-config', config)
  }

  public stop(): void {
    ipcMain.removeListener('audio-features', this.onFeatures)
    ipcMain.removeListener('audio-status', this.onStatus)
    const win = this.win
    this.win = null
    if (win && !win.isDestroyed()) win.destroy()
  }
}

/**
 * Demo mode source: a steady 120 BPM track with gentle loudness changes, so
 * the effect can be shown without real audio.
 */
export class SimulatedMusicSource extends EventEmitter implements MusicSource {
  private timer: NodeJS.Timeout | null = null
  private t0 = 0
  private lastBeat = 0

  public start(): void {
    if (this.timer) return
    this.t0 = Date.now()
    this.lastBeat = this.t0
    this.emit('status', { state: 'running' })
    this.timer = setInterval(() => {
      const now = Date.now()
      const elapsed = (now - this.t0) / 1000
      const beat = now - this.lastBeat >= 500
      if (beat) this.lastBeat = now
      const swell = 0.55 + 0.25 * Math.sin(elapsed / 6)
      this.emit('features', {
        loudness: swell,
        low: beat ? 0.9 : Math.max(0, 0.9 - ((now - this.lastBeat) / 500) * 0.8),
        beat,
        beatStrength: beat ? 0.8 : 0,
        tempo: elapsed > 3 ? 120 : null,
        energy: 0.6,
        silent: false
      } satisfies MusicFeatures)
    }, 33)
  }

  public configure(): void {
    // The simulation ignores tuning
  }

  public stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }
}
