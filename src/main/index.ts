import './cryptoPolyfill.js'
import { app, BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { appendFileSync, mkdirSync } from 'fs'
import { is } from '@electron-toolkit/utils'
import { migrateLegacyData } from './migration'
import { LightManager } from './devices/LightManager'
import { homeKitManager } from './homekit'
import { webhookServer } from './webhook'
import { setupIPC } from './ipc'
import { createTray } from './tray'
import { lumosStore } from './store'
import { setupAutoUpdater } from './updater'
import { NormalizedLightState } from './types'
import { EffectManager } from './effects/EffectManager'
import { registerEffects } from './effects/registry'
import { EnergyTracker } from './energy/EnergyTracker'
import { RemoteManager } from './remote/RemoteManager'
import { setupRemoteIPC } from './remote/remoteIpc'
import { isForwarding } from './remote/registry'

let mainWindow: BrowserWindow | null = null
let lightManager: LightManager | null = null
let effectManager: EffectManager | null = null
let energyTracker: EnergyTracker | null = null
let remoteManager: RemoteManager | null = null
let isQuitting = false
let cleanupDone = false

/**
 * Last line of defence: a stray error from a network library (for example a
 * light's connection timing out) is written to <user data>/logs/main.log
 * instead of interrupting with an error dialog. The app keeps running either way.
 */
function logUnexpected(kind: string, err: unknown): void {
  const text = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err)
  console.error(`[Lumos] ${kind}:`, text)
  try {
    const dir = join(app.getPath('userData'), 'logs')
    mkdirSync(dir, { recursive: true })
    appendFileSync(join(dir, 'main.log'), `[${new Date().toISOString()}] ${kind}: ${text}\n`)
  } catch {
    // Logging must never fail loudly
  }
}
process.on('uncaughtException', (err) => logUnexpected('Uncaught exception', err))
process.on('unhandledRejection', (reason) => logUnexpected('Unhandled rejection', reason))

function getAppIconPath(): string {
  if (process.platform === 'win32') {
    return join(__dirname, '../../build/icon.ico')
  }
  return join(__dirname, '../../build/icon.png')
}

function createWindow(startHidden = false): BrowserWindow {
  mainWindow = new BrowserWindow({
    title: 'Lumos',
    icon: getAppIconPath(),
    width: 1080,
    height: 740,
    minWidth: 760,
    minHeight: 520,
    show: false,
    frame: false,
    backgroundColor: '#09090b',
    titleBarStyle: 'hidden',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    if (mainWindow && !startHidden) {
      mainWindow.show()
    }
  })

  // Close to tray behavior
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault()
      mainWindow?.hide()
      return false
    }
    return true
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // Load renderer
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}

app.whenReady().then(async () => {
  // Step 0: Migrate legacy data from Lumen if present
  migrateLegacyData()

  // Check launch flags
  let isStartHidden = false
  const isDemo = process.argv.includes('--demo')

  try {
    isStartHidden =
      process.argv.includes('--hidden') || app.getLoginItemSettings().wasOpenedAsHidden
  } catch {
    isStartHidden = false
  }

  // What each light last looked like when sent to the window. A bulb confirms a command by
  // reporting the state it was just sent, so most reports repeat it; those are not sent again.
  const lastPushed = new Map<string, string>()

  // Initialize Light Manager with broadcaster
  lightManager = new LightManager((state: NormalizedLightState) => {
    lumosStore.recordLastState(state.id, {
      power: state.power,
      brightness: state.brightness,
      colorTemp: state.colorTemp,
      color: state.color,
      mode: state.mode
    })
    // lastSeen changes with every report and is not shown
    const shown = JSON.stringify({ ...state, lastSeen: undefined })
    if (lastPushed.get(state.id) === shown) return
    lastPushed.set(state.id, shown)
    // While this computer controls another computer's lights, the window shows those instead
    if (mainWindow && !mainWindow.isDestroyed() && !isForwarding()) {
      mainWindow.webContents.send('light-update', state)
    }
    remoteManager?.onLocalEvent('light-update', state)
  })

  // Effects: the compositor owns every write to the bulbs from here on
  effectManager = new EffectManager(lightManager, app.getPath('userData'))
  registerEffects(effectManager)
  energyTracker = new EnergyTracker(lightManager, app.getPath('userData'))
  lightManager.onLightsLoaded = () => {
    lastPushed.clear()
    // Saved names, rooms, hidden state, and positions belong on the new light objects
    lumosStore.applyMetadataToLights()
    effectManager?.attachLights()
    energyTracker?.attach()
  }
  lightManager.onManualChange = (ids, kind) => effectManager?.markManual(ids, kind)
  webhookServer.setEffectManager(effectManager)
  homeKitManager.setEffectManager(effectManager)

  // Control from other computers: one computer keeps the bulbs, others control them through it
  const sendToWindow = (channel: string, payload: unknown): void => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload)
  }
  remoteManager = new RemoteManager(app.getPath('userData'), {
    enterClient: () => {
      effectManager?.suspendAll()
      homeKitManager.stop()
      lightManager?.setRemoteMode(true)
    },
    leaveClient: async () => {
      lightManager?.setRemoteMode(false)
      await effectManager?.startEnabled()
      if (!isDemo && lightManager) {
        await homeKitManager.init(lightManager).catch((err) => console.error('[Lumos] HomeKit:', err))
      }
    }
  })
  remoteManager.on('event', (channel: string, payload: unknown) => sendToWindow(channel, payload))
  remoteManager.on('status', (status: unknown) => sendToWindow('remote-status', status))
  effectManager.on('snapshot', (s) => remoteManager?.onLocalEvent('effects-update', s))
  effectManager.on('paused', (n) => remoteManager?.onLocalEvent('effect-paused', n))
  effectManager.on('live', (l) => remoteManager?.onLocalEvent('effects-live', l))
  if (remoteManager.isClient()) lightManager.setRemoteMode(true)

  // Initialize Lumos Persistent Store & Automations
  lumosStore.init(lightManager, () => {
    if (mainWindow && !mainWindow.isDestroyed() && !isForwarding()) {
      mainWindow.webContents.send('store-update', lumosStore.getData())
    }
    remoteManager?.onLocalEvent('store-update', lumosStore.getData())
  })

  // Setup IPC handlers
  setupIPC(lightManager, homeKitManager, () => mainWindow, effectManager, energyTracker)
  setupRemoteIPC(remoteManager)
  void remoteManager.start()

  // Setup Auto-Updater
  setupAutoUpdater(() => mainWindow)

  // Start local Webhook server
  webhookServer.start(lightManager)

  // Create Window & Tray FIRST so the application window appears immediately
  const win = createWindow(isStartHidden)
  createTray(win, lightManager)

  // Initialize devices, restore states, and publish HomeKit bridge in parallel background tasks
  lightManager
    .init(isDemo)
    .then(async () => {
      try {
        await lumosStore.restoreLastStates()
      } catch (err) {
        console.warn('[Lumos] Error restoring last states:', err)
      }

      energyTracker?.start()

      // A computer controlling another computer's lights runs effects and HomeKit there, not here
      if (remoteManager?.isClient()) return

      try {
        await effectManager?.startEnabled()
      } catch (err) {
        console.warn('[Lumos] Error starting effects:', err)
      }

      if (!isDemo) {
        try {
          await homeKitManager.init(lightManager!)
        } catch (err) {
          console.error('[Lumos] Failed to initialize HomeKit bridge:', err)
        }
      }
    })
    .catch((err) => {
      console.error('[Lumos] Failed to initialize LightManager:', err)
    })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    } else if (mainWindow) {
      mainWindow.show()
    }
  })
})

app.on('before-quit', (event) => {
  isQuitting = true
  if (cleanupDone) return

  // Effects stop first and the bulbs get their base state back before the
  // connections close, so no light is left showing an effect.
  event.preventDefault()
  void (async () => {
    try {
      await Promise.race([
        effectManager?.shutdown(),
        new Promise((resolve) => setTimeout(resolve, 1500))
      ])
    } catch (err) {
      console.warn('[Lumos] Error stopping effects:', err)
    }
    energyTracker?.stop()
    remoteManager?.stop()
    lumosStore.destroy()
    webhookServer.stop()
    homeKitManager.stop()
    if (lightManager) {
      lightManager.disconnectAll()
    }
    cleanupDone = true
    app.quit()
  })()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && isQuitting) {
    app.quit()
  }
})
