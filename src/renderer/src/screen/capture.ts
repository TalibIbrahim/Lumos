/**
 * Hidden Screen Sync capture page.
 *
 * Captures one display through Electron's desktop capture, asking the
 * capturer for a small frame so scaling happens before pixels reach this
 * page, then reduces it to 160 by 90 and analyses it here, away from the
 * main process. Only zone colours and timing numbers are sent on. Frames are
 * never stored, sent, or logged; a small preview image is sent to the
 * settings sheet only while it is open.
 */
import { Frame, Placement, ScreenAnalyzer, activeArea, zonesFor } from '../../../shared/screen/analysis'

interface CaptureConfig {
  sourceId: string
  generation: number
  placements: Placement[]
  edgeShare: number
  ignoreBars: boolean
  preview: boolean
}

interface Bridge {
  onConfig: (cb: (config: CaptureConfig) => void) => void
  sendResult: (r: unknown) => void
  sendStats: (s: unknown) => void
  sendPreview: (p: unknown) => void
  sendStatus: (s: unknown) => void
}

declare global {
  interface Window {
    lumosScreen: Bridge
  }
}

const W = 160
const H = 90
/** Analysis rate: up to 15 per second while the picture moves, 10 when it is still. */
const FAST_MS = 66
const SLOW_MS = 100
const STILL_AFTER_MS = 1500
const PREVIEW_MS = 500

const bridge = window.lumosScreen
const canvas = new OffscreenCanvas(W, H)
const ctx = canvas.getContext('2d', { willReadFrequently: true })!
const analyzer = new ScreenAnalyzer()

let config: CaptureConfig | null = null
let stream: MediaStream | null = null
let video: HTMLVideoElement | null = null
let generation = -1
let lastAnalysed = 0
let lastChangeAt = 0
let lastPreviewAt = 0
let blackSince = 0
let analysedCount = 0
let analysisMsTotal = 0
let statsTimer: number | null = null
let lastFrameSeenAt = 0
let lastBars = { top: 0, bottom: 0, left: 0, right: 0 }

bridge.onConfig((next) => {
  config = next
  analyzer.placements = next.placements
  analyzer.edgeShare = next.edgeShare
  analyzer.ignoreBars = next.ignoreBars
  if (next.generation !== generation) {
    generation = next.generation
    void startCapture(next.sourceId)
  }
})

async function startCapture(id: string): Promise<void> {
  stopCapture()
  analyzer.reset()
  try {
    // The capturer scales down to at most 320 by 180 before frames arrive here
    const s = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: id,
          maxWidth: 320,
          maxHeight: 180,
          maxFrameRate: 15
        }
      } as unknown as MediaTrackConstraints
    })
    stream = s
    const track = s.getVideoTracks()[0]
    track.addEventListener('ended', () => bridge.sendStatus({ state: 'error', reason: 'display-lost' }))
    const v = document.createElement('video')
    v.muted = true
    v.srcObject = s
    await v.play()
    video = v
    bridge.sendStatus({ state: 'running' })
    scheduleFrame()
    if (statsTimer === null) statsTimer = window.setInterval(sendStats, 1000)
  } catch (err) {
    bridge.sendStatus({ state: 'error', reason: 'capture-failed', message: err instanceof Error ? err.message.slice(0, 200) : '' })
  }
}

function stopCapture(): void {
  for (const t of stream?.getTracks() ?? []) t.stop()
  stream = null
  if (video) {
    video.pause()
    video.srcObject = null
  }
  video = null
}

function scheduleFrame(): void {
  const v = video
  if (!v) return
  // Called only when the capturer delivers a new frame
  v.requestVideoFrameCallback(() => {
    onFrame()
    scheduleFrame()
  })
}

function onFrame(): void {
  const v = video
  if (!v || !config) return
  const now = Date.now()
  lastFrameSeenAt = now
  const interval = now - lastChangeAt > STILL_AFTER_MS ? SLOW_MS : FAST_MS
  if (now - lastAnalysed < interval) return
  lastAnalysed = now

  const t0 = performance.now()
  ctx.drawImage(v, 0, 0, W, H)
  const image = ctx.getImageData(0, 0, W, H)
  const frame: Frame = { width: W, height: H, data: image.data }
  const result = analyzer.process(frame, now)
  analysisMsTotal += performance.now() - t0
  analysedCount++

  if (result) {
    lastChangeAt = now
    lastBars = result.bars
    blackSince = result.black ? blackSince || now : 0
    bridge.sendResult(result)
  }
  if (config.preview && now - lastPreviewAt >= PREVIEW_MS) {
    lastPreviewAt = now
    void sendPreview(frame)
  }
}

async function sendPreview(frame: Frame): Promise<void> {
  if (!config) return
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.6 })
  const buf = new Uint8Array(await blob.arrayBuffer())
  let bin = ''
  for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i])
  const zones: Record<string, unknown> = {}
  for (const [id, r] of zonesFor(config.placements, activeArea(frame, lastBars), config.edgeShare)) zones[id] = r
  bridge.sendPreview({ image: `data:image/jpeg;base64,${btoa(bin)}`, width: W, height: H, zones, bars: lastBars })
}

function sendStats(): void {
  const now = Date.now()
  bridge.sendStats({
    at: now,
    analysedPerSecond: analysedCount,
    analysisMs: analysedCount ? analysisMsTotal / analysedCount : 0,
    blackMs: blackSince ? now - blackSince : 0,
    stillMs: lastChangeAt ? now - lastChangeAt : 0,
    sinceFrameMs: lastFrameSeenAt ? now - lastFrameSeenAt : -1
  })
  analysedCount = 0
  analysisMsTotal = 0
}
