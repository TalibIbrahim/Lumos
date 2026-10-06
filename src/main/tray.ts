import { Tray, Menu, nativeImage, NativeImage, BrowserWindow, app } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'
import { LightManager } from './devices/LightManager'

let tray: Tray | null = null

// Simple 16x16 PNG icon fallback generated dynamically if file doesn't exist
function createFallbackIcon(): NativeImage {
  const size = 16
  const buffer = Buffer.alloc(size * size * 4)
  const center = size / 2
  const radius = size / 2 - 1

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4
      const dist = Math.sqrt((x - center) ** 2 + (y - center) ** 2)

      if (dist <= radius) {
        const alpha = Math.min(255, Math.max(0, Math.round((1 - (dist / radius) ** 2) * 255)))
        buffer[idx] = 250     // R
        buffer[idx + 1] = 204 // G
        buffer[idx + 2] = 21  // B
        buffer[idx + 3] = alpha // A
      } else {
        buffer[idx + 3] = 0
      }
    }
  }

  return nativeImage.createFromBuffer(buffer, { width: size, height: size })
}

function getTrayIcon(): NativeImage {
  const tray16Path = join(__dirname, '../../build/tray-16.png')
  if (existsSync(tray16Path)) {
    const icon = nativeImage.createFromPath(tray16Path)
    if (process.platform === 'darwin') {
      icon.setTemplateImage(true)
    }
    return icon
  }
  return createFallbackIcon()
}

export function createTray(mainWindow: BrowserWindow, lightManager: LightManager): Tray {
  if (tray) return tray

  const icon = getTrayIcon()
  tray = new Tray(icon)
  tray.setToolTip('Lumos')

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show Lumos',
      click: (): void => {
        if (!mainWindow.isVisible()) {
          mainWindow.show()
        }
        mainWindow.focus()
      }
    },
    { type: 'separator' },
    {
      label: 'All On',
      click: (): void => {
        lightManager.setAll(true)
      }
    },
    {
      label: 'All Off',
      click: (): void => {
        lightManager.setAll(false)
      }
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: (): void => {
        app.quit()
      }
    }
  ])

  tray.setContextMenu(contextMenu)

  const toggleWindow = (): void => {
    if (mainWindow.isVisible()) {
      if (mainWindow.isFocused()) {
        mainWindow.hide()
      } else {
        mainWindow.focus()
      }
    } else {
      mainWindow.show()
      mainWindow.focus()
    }
  }

  tray.on('click', toggleWindow)
  tray.on('double-click', toggleWindow)

  return tray
}
