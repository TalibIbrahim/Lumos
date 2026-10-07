import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron'

/**
 * Bridge for the hidden Screen Sync capture page. The page reports zone
 * colours, timing statistics, and (only while the settings sheet shows a
 * preview) a small preview image. Nothing else leaves the page.
 */
contextBridge.exposeInMainWorld('lumosScreen', {
  onConfig: (callback: (config: unknown) => void) => {
    ipcRenderer.on('screen-config', (_event: IpcRendererEvent, config: unknown) => callback(config))
  },
  sendResult: (result: unknown) => ipcRenderer.send('screen-result', result),
  sendStats: (stats: unknown) => ipcRenderer.send('screen-stats', stats),
  sendPreview: (preview: unknown) => ipcRenderer.send('screen-preview', preview),
  sendStatus: (status: unknown) => ipcRenderer.send('screen-status', status)
})
