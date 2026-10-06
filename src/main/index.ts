import './cryptoPolyfill.js'
import { app, BrowserWindow, shell } from 'electron'
import { join } from 'path'
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

let mainWindow: BrowserWindow | null = null
let lightManager: LightManager | null = null
let isQuitting = false

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

  // Initialize Light Manager with broadcaster
  lightManager = new LightManager((state: NormalizedLightState) => {
    lumosStore.recordLastState(state.id, {
      power: state.power,
      brightness: state.brightness,
      colorTemp: state.colorTemp,
      color: state.color,
      mode: state.mode
    })
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('light-update', state)
    }
  })

  // Initialize Lumos Persistent Store & Automations
  lumosStore.init(lightManager, () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('store-update', lumosStore.getData())
    }
  })

  // Setup IPC handlers
  setupIPC(lightManager, homeKitManager, () => mainWindow)

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

app.on('before-quit', () => {
  isQuitting = true
  lumosStore.destroy()
  webhookServer.stop()
  homeKitManager.stop()
  if (lightManager) {
    lightManager.disconnectAll()
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && isQuitting) {
    app.quit()
  }
})
