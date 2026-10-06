/**
 * Real-time music analysis used by the Music reactive effect. Pure and
 * allocation-light so it can run in a hidden renderer at a capped frame rate
 * and be unit tested with synthetic signals.
 *
 * Per frame: Hann-windowed FFT, a low-band (kick and bass) energy envelope,
 * spectral flux with an adaptive threshold for beat onsets, a rough tempo
 * from recent beat intervals, and an overall loudness measure.
 */

/** In-place radix-2 FFT. Lengths must be powers of two. */
export function fft(re: Float32Array, im: Float32Array): void {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      let t = re[i]
      re[i] = re[j]
      re[j] = t
      t = im[i]
      im[i] = im[j]
      im[j] = t
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len
    const wr = Math.cos(ang)
    const wi = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let cr = 1
      let ci = 0
      for (let k = 0; k < len / 2; k++) {
        const a = i + k
        const b = a + len / 2
        const xr = re[b] * cr - im[b] * ci
        const xi = re[b] * ci + im[b] * cr
        re[b] = re[a] - xr
        im[b] = im[a] - xi
        re[a] += xr
        im[a] += xi
        const ncr = cr * wr - ci * wi
        ci = cr * wi + ci * wr
        cr = ncr
      }
    }
  }
}

export interface MusicFeatures {
  /** Overall loudness, 0..1 (mapped from about -60 to 0 dBFS). */
  loudness: number
  /** Low-band envelope, 0..1, normalized to recent peaks. */
  low: number
  /** True on the frame a beat onset is detected. */
  beat: boolean
  /** Strength of the detected beat, 0..1. */
  beatStrength: number
  /** Estimated tempo in beats per minute, or null when unknown. */
  tempo: number | null
  /** Slow measure of how energetic the track is, 0..1. */
  energy: number
  /** True when the input is effectively silent. */
  silent: boolean
}

export interface AnalyzerOptions {
  sampleRate: number
  frameSize?: number
  /** 0..1; higher detects softer beats. */
  sensitivity?: number
  /** Beats closer together than this are ignored. */
  minBeatIntervalMs?: number
}

const SILENCE_DB = -55
const HISTORY_FRAMES = 43 // about one second at the default frame rate

export class MusicAnalyzer {
  readonly frameSize: number
  private sampleRate: number
  private sensitivity: number
  private minBeatIntervalMs: number
  private window: Float32Array
  private re: Float32Array
  private im: Float32Array
  private prevMag: Float32Array
  private fluxHistory: number[] = []
  private prevFlux = 0
  private lowPeak = 1e-6
  private lowEnv = 0
  private energy = 0
  private lastBeatAt = -Infinity
  private beatIntervals: number[] = []
  private lowBins: [number, number]
  private fluxBins: number

  constructor(options: AnalyzerOptions) {
    this.sampleRate = options.sampleRate
    this.frameSize = options.frameSize ?? 1024
    this.sensitivity = options.sensitivity ?? 0.6
    this.minBeatIntervalMs = options.minBeatIntervalMs ?? 333
    const n = this.frameSize
    this.window = new Float32Array(n)
    for (let i = 0; i < n; i++) this.window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1))
    this.re = new Float32Array(n)
    this.im = new Float32Array(n)
    this.prevMag = new Float32Array(n / 2)
    const binHz = this.sampleRate / n
    this.lowBins = [Math.max(1, Math.floor(30 / binHz)), Math.max(2, Math.ceil(150 / binHz))]
    this.fluxBins = Math.min(n / 2, Math.ceil(5000 / binHz))
  }

  public configure(options: { sensitivity?: number; minBeatIntervalMs?: number }): void {
    if (options.sensitivity !== undefined) this.sensitivity = Math.max(0, Math.min(1, options.sensitivity))
    if (options.minBeatIntervalMs !== undefined) this.minBeatIntervalMs = Math.max(100, options.minBeatIntervalMs)
  }

  /** Analyzes one frame of mono samples taken at timeMs. */
  public process(samples: Float32Array, timeMs: number): MusicFeatures {
    const n = this.frameSize
    let sumSq = 0
    for (let i = 0; i < n; i++) {
      const s = i < samples.length ? samples[i] : 0
      sumSq += s * s
      this.re[i] = s * this.window[i]
      this.im[i] = 0
    }
    const rms = Math.sqrt(sumSq / n)
    const db = 20 * Math.log10(rms + 1e-9)
    const silent = db < SILENCE_DB
    const loudness = Math.max(0, Math.min(1, (db + 60) / 60))

    fft(this.re, this.im)

    let lowEnergy = 0
    let flux = 0
    for (let k = 1; k < this.fluxBins; k++) {
      const mag = Math.sqrt(this.re[k] * this.re[k] + this.im[k] * this.im[k])
      const inLow = k >= this.lowBins[0] && k <= this.lowBins[1]
      if (inLow) lowEnergy += mag * mag
      // Log compression keeps loud passages from dominating the flux
      const diff = Math.log1p(mag) - Math.log1p(this.prevMag[k])
      if (diff > 0) flux += inLow ? diff * 2 : diff
      this.prevMag[k] = mag
    }

    // Low-band envelope with fast attack, slow release, and adaptive gain
    this.lowPeak = Math.max(lowEnergy, this.lowPeak * 0.995)
    const lowNorm = this.lowPeak > 1e-9 ? Math.sqrt(lowEnergy / this.lowPeak) : 0
    this.lowEnv = lowNorm > this.lowEnv ? lowNorm : this.lowEnv * 0.85 + lowNorm * 0.15

    // Adaptive threshold: mean plus k standard deviations of recent flux
    const hist = this.fluxHistory
    let mean = 0
    for (const f of hist) mean += f
    mean = hist.length ? mean / hist.length : 0
    let variance = 0
    for (const f of hist) variance += (f - mean) * (f - mean)
    const std = hist.length ? Math.sqrt(variance / hist.length) : 0
    const k = 2.6 - this.sensitivity * 1.8
    // Onsets stand well above the recent average; stationary noise only wobbles around it
    const relative = mean * (1.3 + (1 - this.sensitivity) * 0.7)
    const threshold = Math.max(mean + k * std, relative) + 0.5

    let beat = false
    let beatStrength = 0
    const sinceLast = timeMs - this.lastBeatAt
    if (
      !silent &&
      hist.length >= 8 &&
      flux > threshold &&
      flux >= this.prevFlux &&
      sinceLast >= this.minBeatIntervalMs
    ) {
      beat = true
      beatStrength = Math.max(0.2, Math.min(1, (flux - mean) / (std * 4 + 1e-6)))
      if (Number.isFinite(sinceLast) && sinceLast < 2000) {
        this.beatIntervals.push(sinceLast)
        if (this.beatIntervals.length > 16) this.beatIntervals.shift()
      }
      this.lastBeatAt = timeMs
    }

    hist.push(flux)
    if (hist.length > HISTORY_FRAMES) hist.shift()
    this.prevFlux = flux

    const beatRate = this.beatIntervals.length ? 1000 / median(this.beatIntervals) : 0
    const target = silent ? 0 : Math.min(1, loudness * 0.6 + Math.min(1, beatRate / 3) * 0.4)
    this.energy += (target - this.energy) * 0.02

    return {
      loudness: silent ? 0 : loudness,
      low: silent ? 0 : Math.min(1, this.lowEnv),
      beat,
      beatStrength,
      tempo: this.tempo(),
      energy: this.energy,
      silent
    }
  }

  /** Tempo from the median beat interval, folded into a typical musical range. */
  public tempo(): number | null {
    if (this.beatIntervals.length < 4) return null
    let bpm = 60000 / median(this.beatIntervals)
    while (bpm < 70) bpm *= 2
    while (bpm > 180) bpm /= 2
    return Math.round(bpm)
  }
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
