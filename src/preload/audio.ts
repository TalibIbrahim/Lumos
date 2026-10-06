import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron'

/**
 * Bridge for the hidden audio analysis page. It only reports analysis
 * features and status back to the main process; no audio leaves the page.
 */
export interface LumosAudioBridge {
  onConfig: (callback: (config: AudioCaptureConfig) => void) => void
  sendFeatures: (features: unknown) => void
  sendStatus: (status: { state: 'running' | 'error'; message?: string }) => void
}

export interface AudioCaptureConfig {
  sensitivity: number
  minBeatIntervalMs: number
}

const bridge: LumosAudioBridge = {
  onConfig: (callback) => {
    ipcRenderer.on('audio-config', (_event: IpcRendererEvent, config: AudioCaptureConfig) => callback(config))
  },
  sendFeatures: (features) => ipcRenderer.send('audio-features', features),
  sendStatus: (status) => ipcRenderer.send('audio-status', status)
}

contextBridge.exposeInMainWorld('lumosAudio', bridge)
