import { describe, it, expect } from 'vitest'
import { MusicAnalyzer, fft } from '../shared/audio/analysis'

const SR = 44100
const N = 1024

/** Generates frames of a signal function and runs them through a fresh analyzer. */
function run(signal: (t: number) => number, seconds: number, sensitivity = 0.6) {
  const analyzer = new MusicAnalyzer({ sampleRate: SR, frameSize: N, sensitivity })
  const frames = Math.floor((seconds * SR) / N)
  const beats: number[] = []
  let last = null as ReturnType<MusicAnalyzer['process']> | null
  let silentFrames = 0
  for (let f = 0; f < frames; f++) {
    const buf = new Float32Array(N)
    for (let i = 0; i < N; i++) buf[i] = signal((f * N + i) / SR)
    const t = ((f * N) / SR) * 1000
    last = analyzer.process(buf, t)
    if (last.beat) beats.push(t)
    if (last.silent) silentFrames++
  }
  return { beats, last: last!, frames, silentFrames, analyzer }
}

/** Seeded noise so the test is deterministic. */
function noise(seed = 1): () => number {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 0xffffffff - 0.5
  }
}

const kick = (period: number) => (t: number) => {
  const local = t % period
  return 0.8 * Math.exp(-local / 0.06) * Math.sin(2 * Math.PI * 60 * local)
}

describe('Music analysis: FFT', () => {
  it('finds the bin of a pure tone', () => {
    const re = new Float32Array(N)
    const im = new Float32Array(N)
    const bin = 40
    for (let i = 0; i < N; i++) re[i] = Math.sin((2 * Math.PI * bin * i) / N)
    fft(re, im)
    let best = 0
    let bestMag = 0
    for (let k = 1; k < N / 2; k++) {
      const m = Math.hypot(re[k], im[k])
      if (m > bestMag) {
        bestMag = m
        best = k
      }
    }
    expect(best).toBe(bin)
  })
})

describe('Music analysis: beat detection on synthetic signals', () => {
  it('detects a steady 120 BPM kick and estimates the tempo', () => {
    const { beats, last } = run(kick(0.5), 12)
    // 24 kicks in 12 seconds; allow for the warm-up second
    expect(beats.length).toBeGreaterThanOrEqual(20)
    expect(beats.length).toBeLessThanOrEqual(25)
    const intervals = beats.slice(1).map((b, i) => b - beats[i])
    for (const iv of intervals.slice(2)) expect(Math.abs(iv - 500)).toBeLessThan(60)
    expect(last.tempo).not.toBeNull()
    expect(Math.abs(last.tempo! - 120)).toBeLessThanOrEqual(4)
  })

  it('reports silence and no beats for a silent input', () => {
    const { beats, frames, silentFrames, last } = run(() => 0, 5)
    expect(beats).toHaveLength(0)
    expect(silentFrames).toBe(frames)
    expect(last.loudness).toBe(0)
    expect(last.tempo).toBeNull()
  })

  it('stays mostly quiet on steady white noise', () => {
    const rnd = noise(7)
    const { beats, last } = run(() => rnd() * 0.5, 10)
    // Stationary noise has no onsets; a handful of chance crossings at most
    expect(beats.length).toBeLessThanOrEqual(4)
    expect(last.silent).toBe(false)
    expect(last.loudness).toBeGreaterThan(0.4)
  })

  it('still finds the beat when the kick is buried in noise', () => {
    const rnd = noise(3)
    const k = kick(0.5)
    const { beats } = run((t) => k(t) + rnd() * 0.15, 12)
    expect(beats.length).toBeGreaterThanOrEqual(18)
  })

  it('never reports beats closer together than the minimum interval', () => {
    const analyzer = new MusicAnalyzer({ sampleRate: SR, frameSize: N, minBeatIntervalMs: 400 })
    const k = kick(0.2) // five kicks a second, faster than allowed
    const beats: number[] = []
    for (let f = 0; f < 400; f++) {
      const buf = new Float32Array(N)
      for (let i = 0; i < N; i++) buf[i] = k((f * N + i) / SR)
      const t = ((f * N) / SR) * 1000
      if (analyzer.process(buf, t).beat) beats.push(t)
    }
    for (let i = 1; i < beats.length; i++) expect(beats[i] - beats[i - 1]).toBeGreaterThanOrEqual(400)
  })

  it('higher sensitivity finds at least as many beats', () => {
    const rnd = noise(5)
    const k = kick(0.5)
    const sig = (t: number) => k(t) * 0.3 + rnd() * 0.2
    const low = run(sig, 10, 0.1).beats.length
    const high = run(sig, 10, 0.95).beats.length
    expect(high).toBeGreaterThanOrEqual(low)
  })
})
