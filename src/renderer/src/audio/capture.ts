/**
 * Hidden audio analysis page for the Music reactive effect.
 *
 * Captures system output through Electron's loopback support for
 * getDisplayMedia, analyzes it here (off the main process), and sends only
 * compact analysis features back. No audio is recorded, stored, or sent.
 */
import { MusicAnalyzer } from '../../../shared/audio/analysis'

interface AudioCaptureConfig {
  sensitivity: number
  minBeatIntervalMs: number
}

interface LumosAudioBridge {
  onConfig: (callback: (config: AudioCaptureConfig) => void) => void
  sendFeatures: (features: unknown) => void
  sendStatus: (status: { state: 'running' | 'error'; message?: string }) => void
}

declare global {
  interface Window {
    lumosAudio: LumosAudioBridge
  }
}

const FRAME_SIZE = 1024
// Analyze one frame every HOP samples: about 31 frames per second at 48 kHz.
const HOP = 1536

// The worklet mixes channels to mono and posts one analysis frame per hop.
const WORKLET = `
class LumosCapture extends AudioWorkletProcessor {
  constructor() {
    super()
    this.frame = new Float32Array(${FRAME_SIZE})
    this.pos = 0
    this.sinceFrame = 0
  }
  process(inputs) {
    const input = inputs[0]
    if (!input || input.length === 0) return true
    const len = input[0].length
    for (let i = 0; i < len; i++) {
      let s = 0
      for (let c = 0; c < input.length; c++) s += input[c][i]
      this.frame[this.pos] = s / input.length
      this.pos = (this.pos + 1) % ${FRAME_SIZE}
    }
    this.sinceFrame += len
    if (this.sinceFrame >= ${HOP}) {
      this.sinceFrame = 0
      const out = new Float32Array(${FRAME_SIZE})
      out.set(this.frame.subarray(this.pos))
      out.set(this.frame.subarray(0, this.pos), ${FRAME_SIZE} - this.pos)
      this.port.postMessage(out, [out.buffer])
    }
    return true
  }
}
registerProcessor('lumos-capture', LumosCapture)
`

let analyzer: MusicAnalyzer | null = null
let pendingConfig: AudioCaptureConfig | null = null

window.lumosAudio.onConfig((config) => {
  pendingConfig = config
  analyzer?.configure({ sensitivity: config.sensitivity, minBeatIntervalMs: config.minBeatIntervalMs })
})

async function start(): Promise<void> {
  // The main process answers this request with the screen plus loopback audio.
  const stream = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true })
  for (const track of stream.getVideoTracks()) track.stop()
  const audioTracks = stream.getAudioTracks()
  if (audioTracks.length === 0) throw new Error('System audio capture is not available')

  const ctx = new AudioContext({ latencyHint: 'playback' })
  analyzer = new MusicAnalyzer({ sampleRate: ctx.sampleRate, frameSize: FRAME_SIZE })
  if (pendingConfig) {
    analyzer.configure({ sensitivity: pendingConfig.sensitivity, minBeatIntervalMs: pendingConfig.minBeatIntervalMs })
  }

  const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }))
  await ctx.audioWorklet.addModule(url)
  URL.revokeObjectURL(url)

  const source = ctx.createMediaStreamSource(new MediaStream(audioTracks))
  const node = new AudioWorkletNode(ctx, 'lumos-capture', { numberOfOutputs: 1 })
  // A muted sink keeps the graph running without playing anything back.
  const mute = ctx.createGain()
  mute.gain.value = 0
  source.connect(node)
  node.connect(mute)
  mute.connect(ctx.destination)

  node.port.onmessage = (event: MessageEvent<Float32Array>) => {
    if (!analyzer) return
    const features = analyzer.process(event.data, performance.now())
    window.lumosAudio.sendFeatures(features)
  }

  for (const track of audioTracks) {
    track.addEventListener('ended', () => {
      window.lumosAudio.sendStatus({ state: 'error', message: 'System audio capture stopped' })
    })
  }
  window.lumosAudio.sendStatus({ state: 'running' })
}

start().catch((err: unknown) => {
  window.lumosAudio.sendStatus({
    state: 'error',
    message: err instanceof Error ? err.message : 'Could not capture system audio'
  })
})
