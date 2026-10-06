/** Worker thread that runs album colour extraction off the main thread. */
import { parentPort } from 'worker_threads'
import { extractColors } from '../../../shared/color/dominant'

parentPort?.on('message', (msg: { id: number; rgba: Uint8Array; width: number; height: number }) => {
  try {
    const result = extractColors(msg.rgba, msg.width, msg.height)
    parentPort?.postMessage({ id: msg.id, result })
  } catch (err) {
    parentPort?.postMessage({ id: msg.id, error: err instanceof Error ? err.message : 'Extraction failed' })
  }
})
