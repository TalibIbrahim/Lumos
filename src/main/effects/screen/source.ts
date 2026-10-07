import { EventEmitter } from 'events'
import { join } from 'path'
import { BrowserWindow, desktopCapturer, ipcMain, nativeImage, screen, session, IpcMainEvent } from 'electron'
import { is } from '@electron-toolkit/utils'
import { Placement, ScreenAnalyzer, Frame, activeArea, zonesFor } from '../../../shared/screen/analysis'
import { sanitizeResult, sanitizeStats } from './validate'

export interface ScreenSourceConfig {
  displayId: string // '' means the primary display
  placements: Placement[]
  edgeShare: number
  ignoreBars: boolean
  preview: boolean
}

export interface DisplayInfo {
  id: string
  label: string
  primary: boolean
  width: number
  height: number
  scaleFactor: number
}

/**
 * A source of analysed screen frames. Emits:
 *  'result' (FrameResult), 'stats' (ScreenStats), 'preview' (ScreenPreview),
 *  'status' ({ state: 'running' | 'error', reason?, message? }), 'display' (DisplayInfo)
 */
export interface ScreenSource extends EventEmitter {
  start(config: ScreenSourceConfig): void
  configure(config: ScreenSourceConfig): void
  stop(): void
}

export function listDisplays(): DisplayInfo[] {
  try {
    const primary = screen.getPrimaryDisplay().id
    return screen.getAllDisplays().map((d, i) => ({
      id: String(d.id),
      label: (d as { label?: string }).label || `Display ${i + 1}`,
      primary: d.id === primary,
      width: Math.round(d.size.width * d.scaleFactor),
      height: Math.round(d.size.height * d.scaleFactor),
      scaleFactor: d.scaleFactor
    }))
  } catch {
    return []
  }
}

const PARTITION = 'lumos-screen-capture'
let permissionsSet = false

/**
 * Runs the hidden capture page for one display. The window exists only while
 * Screen Sync runs. It follows the chosen display through resolution changes
 * and falls back to the primary display if the chosen one disconnects.
 */
export class DisplayScreenSource extends EventEmitter implements ScreenSource {
  private win: BrowserWindow | null = null
  private config: ScreenSourceConfig | null = null
  private sourceId = ''
  private displayId = ''
  /** Bumped to make the capture page restart, for example after a resolution change. */
  private generation = 0
  private readonly onResult = (e: IpcMainEvent, raw: unknown): void => {
    if (!this.isOurs(e)) return
    const r = sanitizeResult(raw)
    if (r) this.emit('result', r)
  }
  private readonly onStats = (e: IpcMainEvent, raw: unknown): void => {
    if (!this.isOurs(e)) return
    const s = sanitizeStats(raw)
    if (s) this.emit('stats', s)
  }
  private readonly onPreview = (e: IpcMainEvent, raw: unknown): void => {
    if (!this.isOurs(e) || !this.config?.preview) return
    const p = raw as { image?: unknown }
    if (typeof p?.image === 'string' && p.image.startsWith('data:image/jpeg;base64,') && p.image.length < 200000) {
      this.emit('preview', raw)
    }
  }
  private readonly onStatus = (e: IpcMainEvent, raw: unknown): void => {
    if (!this.isOurs(e)) return
    const s = (raw || {}) as { state?: unknown; reason?: unknown; message?: unknown }
    if (s.state === 'running') this.emit('status', { state: 'running' })
    else if (s.reason === 'display-lost') void this.refreshSource(true)
    else this.emit('status', { state: 'error', reason: 'capture-failed', message: typeof s.message === 'string' ? s.message.slice(0, 200) : '' })
  }
  private readonly onDisplaysChanged = (): void => void this.refreshSource(false)

  private isOurs(e: IpcMainEvent): boolean {
    return Boolean(this.win && !this.win.isDestroyed() && e.sender === this.win.webContents)
  }

  public start(config: ScreenSourceConfig): void {
    this.config = config
    if (this.win) return
    const ses = session.fromPartition(PARTITION)
    if (!permissionsSet) {
      ses.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'media'))
      ses.setPermissionCheckHandler((_wc, permission) => permission === 'media')
      permissionsSet = true
    }
    ipcMain.on('screen-result', this.onResult)
    ipcMain.on('screen-stats', this.onStats)
    ipcMain.on('screen-preview', this.onPreview)
    ipcMain.on('screen-status', this.onStatus)
    screen.on('display-removed', this.onDisplaysChanged)
    screen.on('display-added', this.onDisplaysChanged)
    screen.on('display-metrics-changed', this.onDisplaysChanged)

    const win = new BrowserWindow({
      show: false,
      width: 200,
      height: 120,
      skipTaskbar: true,
      webPreferences: {
        preload: join(__dirname, '../preload/screen.js'),
        partition: PARTITION,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false
      }
    })
    this.win = win
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    win.webContents.on('will-navigate', (ev) => ev.preventDefault())
    win.webContents.on('did-finish-load', () => void this.refreshSource(true))
    win.webContents.on('render-process-gone', () => {
      this.emit('status', { state: 'error', reason: 'capture-failed', message: 'Screen analysis stopped unexpectedly' })
      this.stop()
    })
    if (is.dev && process.env['ELECTRON_RENDERER_URL']) win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/screen.html`)
    else win.loadFile(join(__dirname, '../renderer/screen.html'))
  }

  public configure(config: ScreenSourceConfig): void {
    const displayChanged = config.displayId !== this.config?.displayId
    this.config = config
    if (displayChanged) void this.refreshSource(true)
    else this.sendConfig()
  }

  public stop(): void {
    ipcMain.removeListener('screen-result', this.onResult)
    ipcMain.removeListener('screen-stats', this.onStats)
    ipcMain.removeListener('screen-preview', this.onPreview)
    ipcMain.removeListener('screen-status', this.onStatus)
    screen.removeListener('display-removed', this.onDisplaysChanged)
    screen.removeListener('display-added', this.onDisplaysChanged)
    screen.removeListener('display-metrics-changed', this.onDisplaysChanged)
    const win = this.win
    this.win = null
    this.sourceId = ''
    if (win && !win.isDestroyed()) win.destroy()
  }

  /** Picks the capture source for the chosen display, falling back to the primary one. */
  private async refreshSource(force: boolean): Promise<void> {
    if (!this.win || !this.config) return
    const displays = listDisplays()
    const wanted = this.config.displayId && displays.some((d) => d.id === this.config!.displayId) ? this.config.displayId : ''
    const target = wanted || displays.find((d) => d.primary)?.id || displays[0]?.id || ''
    let sources: Electron.DesktopCapturerSource[] = []
    try {
      sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } })
    } catch {
      sources = []
    }
    const source = sources.find((s) => s.display_id === target) || sources[0]
    if (!source) {
      this.emit('status', { state: 'error', reason: 'no-display', message: '' })
      return
    }
    const info = displays.find((d) => d.id === (source.display_id || target))
    if (info) this.emit('display', info)
    if (this.config.displayId && !wanted) this.emit('status', { state: 'error', reason: 'display-missing', message: '' })
    if (force || source.id !== this.sourceId || target !== this.displayId) {
      this.sourceId = source.id
      this.displayId = target
      // A new source id makes the page restart capture
      this.sendConfig(force)
    } else {
      this.sendConfig()
    }
  }

  private sendConfig(restart = false): void {
    if (!this.win || this.win.isDestroyed() || !this.config || !this.sourceId) return
    if (restart) this.generation++
    this.win.webContents.send('screen-config', {
      sourceId: this.sourceId,
      generation: this.generation,
      placements: this.config.placements,
      edgeShare: this.config.edgeShare,
      ignoreBars: this.config.ignoreBars,
      preview: this.config.preview
    })
  }
}

/**
 * Demo mode: a built-in sample sequence (a sunset, a green explosion on the
 * right, a dark night scene, and a letterboxed film), analysed exactly like
 * real frames, so Screen Sync can be shown without content.
 */
export class SampleScreenSource extends EventEmitter implements ScreenSource {
  private timer: NodeJS.Timeout | null = null
  private analyzer = new ScreenAnalyzer()
  private t0 = 0
  private frame: Frame = { width: 160, height: 90, data: new Uint8Array(160 * 90 * 4) }
  private config: ScreenSourceConfig | null = null
  private lastBars = { top: 0, bottom: 0, left: 0, right: 0 }
  private lastPreviewAt = 0
  private lastStatsAt = 0
  private analysed = 0
  private analysisMs = 0

  public start(config: ScreenSourceConfig): void {
    this.configure(config)
    if (this.timer) return
    this.t0 = Date.now()
    this.emit('status', { state: 'running' })
    this.emit('display', { id: 'sample', label: 'Sample sequence', primary: true, width: 1920, height: 1080, scaleFactor: 1 })
    this.timer = setInterval(() => this.tick(), 66)
  }

  public configure(config: ScreenSourceConfig): void {
    this.config = config
    this.analyzer.placements = config.placements
    this.analyzer.edgeShare = config.edgeShare
    this.analyzer.ignoreBars = config.ignoreBars
  }

  public stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  private tick(): void {
    const t = ((Date.now() - this.t0) / 1000) % 20
    renderSample(this.frame, t)
    const now = Date.now()
    const t0 = performance.now()
    const r = this.analyzer.process(this.frame, now)
    this.analysisMs += performance.now() - t0
    this.analysed++
    if (r) {
      this.lastBars = r.bars
      this.emit('result', r)
    }
    if (now - this.lastStatsAt >= 1000) {
      this.emit('stats', { at: now, analysedPerSecond: this.analysed, analysisMs: this.analysed ? this.analysisMs / this.analysed : 0, blackMs: 0, stillMs: 0, sinceFrameMs: 0 })
      this.lastStatsAt = now
      this.analysed = 0
      this.analysisMs = 0
    }
    if (this.config?.preview && now - this.lastPreviewAt >= 500) {
      this.lastPreviewAt = now
      this.emitPreview()
    }
  }

  /** Same preview shape as real capture, encoded here because the sample has no page. */
  private emitPreview(): void {
    if (!this.config) return
    try {
      const { width, height, data } = this.frame
      const bgra = Buffer.alloc(width * height * 4)
      for (let i = 0; i < width * height; i++) {
        bgra[i * 4] = data[i * 4 + 2]
        bgra[i * 4 + 1] = data[i * 4 + 1]
        bgra[i * 4 + 2] = data[i * 4]
        bgra[i * 4 + 3] = 255
      }
      const jpeg = nativeImage.createFromBitmap(bgra, { width, height }).toJPEG(70)
      const zones: Record<string, unknown> = {}
      for (const [id, r] of zonesFor(this.config.placements, activeArea(this.frame, this.lastBars), this.config.edgeShare)) zones[id] = r
      this.emit('preview', { image: `data:image/jpeg;base64,${jpeg.toString('base64')}`, width, height, zones, bars: this.lastBars })
    } catch {
      // No preview outside the app (for example in tests)
    }
  }
}

/** Draws the sample sequence at time t (seconds, looping every 20 s). */
export function renderSample(f: Frame, t: number): void {
  const { width: w, height: h, data } = f
  const set = (x: number, y: number, r: number, g: number, b: number): void => {
    const i = (y * w + x) * 4
    data[i] = r
    data[i + 1] = g
    data[i + 2] = b
    data[i + 3] = 255
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = x / w
      const v = y / h
      if (t < 5) {
        // Sunset: warm orange on the left fading to pink on the right
        const k = 0.75 + 0.25 * Math.sin(t)
        set(x, y, 240 * k, (140 - 60 * u) * k, (40 + 120 * u) * k * (1 - v * 0.4))
      } else if (t < 8) {
        // Neutral street, green explosion growing on the right
        const burst = Math.max(0, 1 - Math.hypot(u - 0.85, v - 0.5) / (0.15 + (t - 5) * 0.1))
        set(x, y, 70 + 40 * burst, 68 + 180 * burst, 64 + 20 * burst)
      } else if (t < 13) {
        // Dark night, a dim blue moon on the left
        const moon = Math.max(0, 1 - Math.hypot(u - 0.2, v - 0.3) / 0.12)
        set(x, y, 8 + 30 * moon, 10 + 50 * moon, 25 + 140 * moon)
      } else {
        // A 2.39:1 film: bars top and bottom around teal and orange
        if (y < 11 || y >= h - 11) set(x, y, 0, 0, 0)
        else set(x, y, u < 0.5 ? 20 : 230, u < 0.5 ? 150 : 120, u < 0.5 ? 160 : 40)
      }
    }
  }
}
