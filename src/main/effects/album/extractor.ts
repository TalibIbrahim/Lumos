import { Worker } from 'worker_threads'
import workerPath from './colorWorker?modulePath'
import type { ExtractedColors } from '../../../shared/color/dominant'

export type Extractor = (rgba: Uint8Array, width: number, height: number) => Promise<ExtractedColors>

/**
 * Runs colour extraction in a worker thread. The worker starts on first use
 * and is shut down after a minute without work, so it costs nothing when idle.
 */
export function createWorkerExtractor(): { extract: Extractor; destroy: () => void } {
  let worker: Worker | null = null
  let idleTimer: NodeJS.Timeout | null = null
  let nextId = 1
  const pending = new Map<number, { resolve: (r: ExtractedColors) => void; reject: (e: Error) => void }>()

  const shutdown = (): void => {
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = null
    const w = worker
    worker = null
    void w?.terminate()
    for (const p of pending.values()) p.reject(new Error('Extractor stopped'))
    pending.clear()
  }

  const ensure = (): Worker => {
    if (worker) return worker
    const w = new Worker(workerPath)
    w.on('message', (msg: { id: number; result?: ExtractedColors; error?: string }) => {
      const p = pending.get(msg.id)
      if (!p) return
      pending.delete(msg.id)
      if (msg.result) p.resolve(msg.result)
      else p.reject(new Error(msg.error || 'Extraction failed'))
    })
    w.on('error', () => shutdown())
    worker = w
    return w
  }

  const extract: Extractor = (rgba, width, height) =>
    new Promise((resolve, reject) => {
      const id = nextId++
      pending.set(id, { resolve, reject })
      const copy = new Uint8Array(rgba)
      ensure().postMessage({ id, rgba: copy, width, height }, [copy.buffer])
      if (idleTimer) clearTimeout(idleTimer)
      idleTimer = setTimeout(shutdown, 60000)
    })

  return { extract, destroy: shutdown }
}
