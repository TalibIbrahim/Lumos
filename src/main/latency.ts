export interface LatencySample {
  id: string
  command: string
  lightId: string
  durationMs: number
  timestamp: number
}

export interface LatencyStats {
  count: number
  min: number
  max: number
  avg: number
  p50: number
  p95: number
}

class LatencyTracker {
  private samples: LatencySample[] = []
  private readonly maxSamples = 200

  public record(command: string, lightId: string, durationMs: number): void {
    const sample: LatencySample = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      command,
      lightId,
      durationMs: Math.max(0, Math.round(durationMs * 10) / 10),
      timestamp: Date.now()
    }

    this.samples.push(sample)
    if (this.samples.length > this.maxSamples) {
      this.samples.shift()
    }
  }

  public getStats(): LatencyStats {
    if (this.samples.length === 0) {
      return {
        count: 0,
        min: 0,
        max: 0,
        avg: 0,
        p50: 0,
        p95: 0
      }
    }

    const durations = this.samples.map((s) => s.durationMs).sort((a, b) => a - b)
    const count = durations.length
    const min = durations[0]
    const max = durations[count - 1]
    const sum = durations.reduce((acc, v) => acc + v, 0)
    const avg = Math.round((sum / count) * 10) / 10

    const p50Index = Math.min(count - 1, Math.floor(count * 0.5))
    const p95Index = Math.min(count - 1, Math.floor(count * 0.95))

    return {
      count,
      min,
      max,
      avg,
      p50: durations[p50Index],
      p95: durations[p95Index]
    }
  }

  public reset(): void {
    this.samples = []
  }
}

export const latencyTracker = new LatencyTracker()
