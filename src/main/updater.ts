import { app, BrowserWindow, ipcMain } from 'electron'
import { autoUpdater } from 'electron-updater'
import { is } from '@electron-toolkit/utils'

export type UpdateStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'available'; version: string }
  | { state: 'not-available' }
  | { state: 'downloading'; percent: number }
  | { state: 'downloaded'; version: string }
  | { state: 'error'; message: string }

let currentStatus: UpdateStatus = { state: 'idle' }

export function setupAutoUpdater(getMainWindow: () => BrowserWindow | null): void {
  // Configure auto updater defaults
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  const broadcastStatus = (status: UpdateStatus): void => {
    currentStatus = status
    const win = getMainWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send('update-status', status)
    }
  }

  autoUpdater.on('checking-for-update', () => {
    broadcastStatus({ state: 'checking' })
  })

  autoUpdater.on('update-available', (info) => {
    broadcastStatus({ state: 'available', version: info.version })
  })

  autoUpdater.on('update-not-available', () => {
    broadcastStatus({ state: 'not-available' })
  })

  autoUpdater.on('download-progress', (progressObj) => {
    broadcastStatus({
      state: 'downloading',
      percent: Math.round(progressObj.percent)
    })
  })

  autoUpdater.on('update-downloaded', (info) => {
    broadcastStatus({ state: 'downloaded', version: info.version })
  })

  autoUpdater.on('error', (err) => {
    const errorMsg = err?.message || 'Failed to check for updates'
    broadcastStatus({ state: 'error', message: errorMsg })
  })

  // IPC Handlers
  ipcMain.handle('check-for-updates', async () => {
    if (is.dev) {
      return { state: 'not-available', dev: true }
    }
    try {
      broadcastStatus({ state: 'checking' })
      const result = await autoUpdater.checkForUpdates()
      return result
    } catch (err: any) {
      broadcastStatus({ state: 'error', message: err?.message || 'Update check failed' })
      throw err
    }
  })

  ipcMain.handle('install-update', () => {
    autoUpdater.quitAndInstall()
  })

  ipcMain.handle('get-app-version', () => {
    return app.getVersion()
  })

  ipcMain.handle('get-update-status', () => {
    return currentStatus
  })

  // Initial update check after a short background delay (skip in dev mode)
  if (!is.dev) {
    setTimeout(() => {
      autoUpdater.checkForUpdatesAndNotify().catch((err) => {
        console.warn('[Lumos Updater] Initial check error:', err?.message)
      })
    }, 5000)
  }
}
