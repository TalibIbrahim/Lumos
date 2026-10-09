import { app, BrowserWindow, ipcMain, Notification, powerMonitor } from 'electron'
import type { AppUpdater } from 'electron-updater'
import { is } from '@electron-toolkit/utils'
import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'fs'
import { join } from 'path'
import { setTrayUpdateReady } from './tray'

export type UpdateStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'available'; version: string }
  | { state: 'not-available' }
  | { state: 'downloading'; percent: number }
  | { state: 'downloaded'; version: string }
  | { state: 'error'; message: string }

let currentStatus: UpdateStatus = { state: 'idle' }

/** How often to look for a new release while the app keeps running in the tray. */
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000
/** Delay before the first check, and after waking from sleep so the network is back. */
const STARTUP_DELAY_MS = 5000
const RESUME_DELAY_MS = 30000
const MAX_LOG_BYTES = 512 * 1024

/**
 * Writes updater activity to <user data>/logs/updater.log so a failed check
 * or download can be diagnosed after the fact. The file is rotated to
 * updater.old.log when it grows past 512 KB.
 */
function createFileLogger(): {
  info: (...a: unknown[]) => void
  warn: (...a: unknown[]) => void
  error: (...a: unknown[]) => void
  debug: (...a: unknown[]) => void
} {
  let file = ''
  try {
    const dir = join(app.getPath('userData'), 'logs')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    file = join(dir, 'updater.log')
  } catch {
    file = ''
  }

  const write = (level: string, args: unknown[]): void => {
    const text = args
      .map((a) => (a instanceof Error ? `${a.message}\n${a.stack ?? ''}` : typeof a === 'string' ? a : JSON.stringify(a)))
      .join(' ')
    const line = `[${new Date().toISOString()}] ${level} ${text}\n`
    if (level !== 'DEBUG') console.log(`[Lumos Updater] ${level} ${text}`)
    if (!file) return
    try {
      if (existsSync(file) && statSync(file).size > MAX_LOG_BYTES) {
        renameSync(file, file.replace(/\.log$/, '.old.log'))
      }
      appendFileSync(file, line)
    } catch {
      // Logging must never break updating
    }
  }

  return {
    info: (...a) => write('INFO', a),
    warn: (...a) => write('WARN', a),
    error: (...a) => write('ERROR', a),
    debug: (...a) => write('DEBUG', a)
  }
}

export function setupAutoUpdater(
  getMainWindow: () => BrowserWindow | null,
  onBeforeInstall?: () => Promise<void>
): void {
  const log = createFileLogger()

  // The updater library takes a noticeable time to load, so it loads on first use
  // (the first check runs a few seconds after launch) rather than before the window opens
  let updater: AppUpdater | null = null
  const getUpdater = (): AppUpdater => {
    if (updater) return updater
    const { autoUpdater } = require('electron-updater') as typeof import('electron-updater')
    updater = autoUpdater
    attach(autoUpdater)
    return autoUpdater
  }

  let checking = false
  let lastLoggedPercent = -1

  const broadcastStatus = (status: UpdateStatus): void => {
    currentStatus = status
    const win = getMainWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send('update-status', status)
    }
  }

  let isInstalling = false
  const install = async (): Promise<void> => {
    if (isInstalling) return
    isInstalling = true
    log.info('Installing update and restarting')
    if (onBeforeInstall) {
      try {
        await onBeforeInstall()
      } catch (err) {
        log.warn('Cleanup before update install failed:', err)
      }
    }
    // Silent install, then relaunch. An install for all users still shows the Windows permission prompt.
    getUpdater().quitAndInstall(true, true)
  }

  /** Looks for a new release unless a check or download is already under way. */
  const check = async (reason: string): Promise<void> => {
    if (is.dev || checking) return
    if (currentStatus.state === 'downloading' || currentStatus.state === 'downloaded') return
    checking = true
    log.info(`Checking for updates (${reason}), current version ${app.getVersion()}`)
    try {
      await getUpdater().checkForUpdates()
    } catch (err) {
      log.warn('Update check failed:', err instanceof Error ? err.message : String(err))
    } finally {
      checking = false
    }
  }

  const attach = (autoUpdater: AppUpdater): void => {
    autoUpdater.logger = log

    // Download in the background; install on quit, or straight away from the restart prompt
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true

    autoUpdater.on('checking-for-update', () => {
      broadcastStatus({ state: 'checking' })
    })

    autoUpdater.on('update-available', (info) => {
      log.info(`Update ${info.version} available, downloading`)
      lastLoggedPercent = -1
      broadcastStatus({ state: 'available', version: info.version })
    })

    autoUpdater.on('update-not-available', () => {
      broadcastStatus({ state: 'not-available' })
    })

    autoUpdater.on('download-progress', (progressObj) => {
      const percent = Math.round(progressObj.percent)
      if (percent >= lastLoggedPercent + 25) {
        lastLoggedPercent = percent - (percent % 25)
        log.info(`Downloading update: ${percent}%`)
      }
      broadcastStatus({ state: 'downloading', percent })
    })

    autoUpdater.on('update-downloaded', (info) => {
      log.info(`Update ${info.version} downloaded and ready to install`)
      broadcastStatus({ state: 'downloaded', version: info.version })
      setTrayUpdateReady(info.version, () => void install())

      // The in-app notice covers an open window; a system notification covers the tray
      const win = getMainWindow()
      const windowInView = win && !win.isDestroyed() && win.isVisible() && win.isFocused()
      if (!windowInView && Notification.isSupported()) {
        const note = new Notification({
          title: `Lumos ${info.version} is ready`,
          body: 'Restart Lumos to finish updating.'
        })
        note.on('click', () => {
          const w = getMainWindow()
          if (w && !w.isDestroyed()) {
            w.show()
            w.focus()
          }
        })
        note.show()
      }
    })

    autoUpdater.on('error', (err) => {
      const errorMsg = err?.message || 'Failed to check for updates'
      log.error('Updater error:', err)
      broadcastStatus({ state: 'error', message: errorMsg })
    })
  }

  // IPC Handlers
  ipcMain.handle('check-for-updates', async () => {
    if (is.dev) {
      return { state: 'not-available', dev: true }
    }
    if (currentStatus.state === 'downloading' || currentStatus.state === 'downloaded') {
      return currentStatus
    }
    try {
      broadcastStatus({ state: 'checking' })
      log.info(`Checking for updates (requested), current version ${app.getVersion()}`)
      await getUpdater().checkForUpdates()
      // The check result holds a promise and cannot cross IPC; the status is what the window uses
      return currentStatus
    } catch (err: any) {
      log.error('Requested update check failed:', err)
      broadcastStatus({
        state: 'error',
        message: err?.message || 'Update check failed'
      })
      throw err
    }
  })

  ipcMain.handle('install-update', async () => {
    await install()
  })

  ipcMain.handle('get-app-version', () => {
    return app.getVersion()
  })

  ipcMain.handle('get-update-status', () => {
    return currentStatus
  })

  if (!is.dev) {
    // Check shortly after launch, then regularly, since Lumos usually stays running in the tray
    setTimeout(() => void check('startup'), STARTUP_DELAY_MS)
    setInterval(() => void check('scheduled'), CHECK_INTERVAL_MS)
    // An interrupted download resumes from here too
    powerMonitor.on('resume', () => {
      setTimeout(() => void check('resume'), RESUME_DELAY_MS)
    })
  }
}
