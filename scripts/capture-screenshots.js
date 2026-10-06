const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')
const fs = require('fs')

// Safety timeout: exit after 20 seconds maximum under all circumstances
setTimeout(() => {
  console.log('Safety timeout reached. Force exiting.')
  process.exit(0)
}, 20000)

const outDir = path.join(__dirname, '../docs/screenshots')
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true })
}


const mockLights = [
  {
    id: 'light-1',
    name: 'Desk Lamp',
    customName: 'Desk Lamp',
    ip: '192.168.1.101',
    online: true,
    power: true,
    brightness: 85,
    colorTemp: 60,
    mode: 'white',
    lastSeen: Date.now(),
    room: 'Office',
    capabilities: {
      hasPower: true,
      hasBrightness: true,
      hasColorTemp: true,
      hasColor: true,
      hasScenes: true,
      hasCountdown: true
    }
  },
  {
    id: 'light-2',
    name: 'Living Room Pendant',
    customName: 'Ceiling Pendant',
    ip: '192.168.1.102',
    online: true,
    power: true,
    brightness: 100,
    colorTemp: 25,
    mode: 'white',
    lastSeen: Date.now(),
    room: 'Living Room',
    capabilities: {
      hasPower: true,
      hasBrightness: true,
      hasColorTemp: true,
      hasColor: false,
      hasScenes: true,
      hasCountdown: true
    }
  },
  {
    id: 'light-3',
    name: 'Reading Spot',
    customName: 'Reading Spot',
    ip: '192.168.1.103',
    online: true,
    power: false,
    brightness: 45,
    colorTemp: 15,
    mode: 'white',
    lastSeen: Date.now(),
    room: 'Living Room',
    capabilities: {
      hasPower: true,
      hasBrightness: true,
      hasColorTemp: true,
      hasColor: false,
      hasScenes: false,
      hasCountdown: false
    }
  },
  {
    id: 'light-4',
    name: 'Studio Backlight',
    customName: 'Studio Halo',
    ip: '192.168.1.104',
    online: true,
    power: true,
    brightness: 90,
    colorTemp: 50,
    mode: 'colour',
    color: { h: 215, s: 85, v: 95 },
    lastSeen: Date.now(),
    room: 'Studio',
    capabilities: {
      hasPower: true,
      hasBrightness: true,
      hasColorTemp: true,
      hasColor: true,
      hasScenes: true,
      hasCountdown: true
    }
  },
  {
    id: 'light-5',
    name: 'Hallway Sconce',
    customName: 'Hallway Sconce',
    ip: '192.168.1.105',
    online: false,
    power: false,
    brightness: 0,
    colorTemp: 50,
    mode: 'white',
    lastSeen: Date.now() - 3600000,
    room: 'Hallway',
    capabilities: {
      hasPower: true,
      hasBrightness: true,
      hasColorTemp: true,
      hasColor: false,
      hasScenes: false,
      hasCountdown: false
    }
  }
]

const mockStore = {
  rooms: [
    { id: 'room-1', name: 'Living Room', deviceIds: ['light-2', 'light-3'] },
    { id: 'room-2', name: 'Office', deviceIds: ['light-1'] },
    { id: 'room-3', name: 'Studio', deviceIds: ['light-4'] }
  ],
  presets: [
    { id: 'preset-1', name: 'Relax', icon: 'Moon', brightness: 35, colorTemp: 18, mode: 'white' },
    { id: 'preset-2', name: 'Focus', icon: 'Target', brightness: 90, colorTemp: 70, mode: 'white' },
    { id: 'preset-3', name: 'Night reading', icon: 'BookOpen', brightness: 50, colorTemp: 30, mode: 'white' },
    { id: 'preset-4', name: 'Daylight', icon: 'Sparkles', brightness: 100, colorTemp: 85, mode: 'white' }
  ],
  schedules: [
    {
      id: 'sched-1',
      name: 'Morning Wakeup',
      enabled: true,
      time: '07:30',
      days: [1, 2, 3, 4, 5],
      action: 'preset',
      presetId: 'preset-4',
      targetType: 'all'
    },
    {
      id: 'sched-2',
      name: 'Evening Wind-down',
      enabled: true,
      time: '23:00',
      days: [0, 1, 2, 3, 4, 5, 6],
      action: 'off',
      targetType: 'all'
    }
  ],
  sleepTimer: {
    active: true,
    targetType: 'all',
    durationMinutes: 30,
    startEpoch: Date.now() - 600000,
    endEpoch: Date.now() + 1200000,
    initialBrightnessMap: { 'light-1': 85, 'light-2': 100 }
  },
  sunriseAlarm: {
    id: 'sunrise-1',
    name: 'Gentle Sunrise',
    enabled: true,
    time: '07:00',
    days: [1, 2, 3, 4, 5],
    rampDurationMinutes: 20,
    targetType: 'all'
  },
  deviceMeta: {}
}

const mockHomeKit = {
  isPaired: true,
  setupCode: '031-45-154',
  setupURI: 'X-HM://0083D2110314',
  qrCodeDataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  bridgeUsername: 'CC:22:3D:E3:CE:30',
  port: 51826,
  accessoryCount: 4
}

// Setup IPC
ipcMain.handle('get-status', () => mockLights)
ipcMain.handle('get-store', () => mockStore)
ipcMain.handle('get-homekit-info', () => mockHomeKit)
ipcMain.handle('get-launch-at-login', () => false)
ipcMain.handle('set-launch-at-login', () => true)
ipcMain.handle('set-power', () => true)
ipcMain.handle('toggle-light', () => true)
ipcMain.handle('set-brightness', () => true)
ipcMain.handle('set-color-temp', () => true)
ipcMain.handle('set-color', () => true)
ipcMain.handle('set-work-mode', () => true)
ipcMain.handle('set-all', () => [true, true])
ipcMain.handle('set-group-power', () => [true])
ipcMain.handle('window-minimize', () => {})
ipcMain.handle('window-maximize', () => {})
ipcMain.handle('window-close', () => {})

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

async function capture(win, filename) {
  try {
    const filePath = path.join(outDir, filename)
    const image = await win.webContents.capturePage()
    const buffer = image.toPNG()
    fs.writeFileSync(filePath, buffer)
    console.log(`Captured ${filename} (${buffer.length} bytes)`)
  } catch (err) {
    console.error(`Failed to capture ${filename}:`, err.message)
  }
}

async function safeExec(win, jsCode) {
  try {
    return await win.webContents.executeJavaScript(`(() => {
      try {
        ${jsCode}
      } catch (err) {
        return null;
      }
    })()`)
  } catch (err) {
    return null
  }
}

app.whenReady().then(async () => {
  let win
  try {
    win = new BrowserWindow({
      title: 'Lumos',
      width: 1080,
      height: 740,
      show: false,
      frame: false,
      backgroundColor: '#000000',
      webPreferences: {
        preload: path.join(__dirname, '../out/preload/index.js'),
        sandbox: false,
        contextIsolation: true
      }
    })

    await win.loadFile(path.join(__dirname, '../out/renderer/index.html'))
    win.show()
    await sleep(1200)

    // 1. Default Window Size (1080 x 740) - Home View
    win.setSize(1080, 740)
    await sleep(400)
    await capture(win, '01_home_default_1080x740.png')

    // 2. Minimum Window Size (760 x 520)
    win.setSize(760, 520)
    await sleep(400)
    await capture(win, '02_home_minimum_760x520.png')

    // 3. Large Window Size (1280 x 840)
    win.setSize(1280, 840)
    await sleep(400)
    await capture(win, '03_home_large_1280x840.png')

    // 4. Scenes View
    win.setSize(1080, 740)
    await sleep(300)
    await safeExec(win, `
      const btns = Array.from(document.querySelectorAll('button'));
      const btn = btns.find(b => b.innerText && b.innerText.includes('Scenes'));
      if (btn) btn.click();
    `)
    await sleep(600)
    await capture(win, '04_scenes_view.png')

    // 5. Automations View
    await safeExec(win, `
      const btns = Array.from(document.querySelectorAll('button'));
      const btn = btns.find(b => b.innerText && b.innerText.includes('Automations'));
      if (btn) btn.click();
    `)
    await sleep(600)
    await capture(win, '05_automations_view.png')

    // 6. Settings Sheet
    await safeExec(win, `
      const btns = Array.from(document.querySelectorAll('button'));
      const btn = btns.find(b => b.innerText && b.innerText.includes('Settings'));
      if (btn) btn.click();
    `)
    await sleep(600)
    await capture(win, '06_settings_sheet.png')

    // Close Settings Sheet
    await safeExec(win, `
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    `)
    await sleep(400)

    // 7. Light Detail Sheet
    await safeExec(win, `
      const btns = Array.from(document.querySelectorAll('button'));
      const homeBtn = btns.find(b => b.innerText && b.innerText.includes('Home'));
      if (homeBtn) homeBtn.click();
    `)
    await sleep(400)

    await safeExec(win, `
      const tiles = document.querySelectorAll('[role="switch"]');
      if (tiles.length > 0) {
        const infoBtn = tiles[0].querySelector('button');
        if (infoBtn) infoBtn.click();
      }
    `)
    await sleep(700)
    await capture(win, '07_light_detail_sheet.png')

    console.log('Capture finished completely.')
  } catch (err) {
    console.error('Error during capture:', err)
  } finally {
    if (win && !win.isDestroyed()) {
      win.destroy()
    }
    process.exit(0)
  }
})
