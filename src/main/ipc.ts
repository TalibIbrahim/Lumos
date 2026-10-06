import { ipcMain, BrowserWindow, app, dialog, shell } from 'electron'
import { readFileSync } from 'fs'
import { LightManager } from './devices/LightManager'
import { HomeKitManager } from './homekit'
import { lumosStore } from './store'
import { webhookServer } from './webhook'
import {
  hasDevicesConfig,
  saveDevicesConfig,
  validateDevicesConfig
} from './config'
import {
  NormalizedLightState,
  Preset,
  Schedule,
  ColorHS,
  DeviceMetadata,
  SunriseAlarm
} from './types'
import { latencyTracker } from './latency'
import type { EffectManager } from './effects/EffectManager'
import type { EnergyTracker, EnergyRange } from './energy/EnergyTracker'
import { writeFileSync } from 'fs'

export function setupIPC(
  lightManager: LightManager,
  homeKitManager: HomeKitManager,
  getMainWindow: () => BrowserWindow | null,
  effectManager: EffectManager,
  energyTracker: EnergyTracker
): void {
  // Changes made here come from the user's hand, so ambient effects step aside
  const manual = (ids: string[]): void => lightManager.markManual(ids)

  // Batch state updates to renderer over ~16ms animation frames
  const pendingBroadcastStates = new Map<string, NormalizedLightState>()
  let broadcastScheduled = false

  const flushBroadcasts = (): void => {
    broadcastScheduled = false
    const win = getMainWindow()
    if (!win || win.isDestroyed()) {
      pendingBroadcastStates.clear()
      return
    }

    for (const state of pendingBroadcastStates.values()) {
      win.webContents.send('light-update', state)
    }
    pendingBroadcastStates.clear()
  }

  // Light control IPC Handlers
  ipcMain.handle('get-status', async () => {
    return lightManager.getAllStates()
  })

  ipcMain.handle('toggle-light', async (_event, id: string) => {
    if (typeof id !== 'string' || !id) return false
    manual([id])
    return lightManager.toggleLight(id)
  })

  ipcMain.handle('set-power', async (_event, id: string, on: boolean) => {
    if (typeof id !== 'string' || typeof on !== 'boolean') return false
    manual([id])
    return lightManager.setPower(id, on)
  })

  ipcMain.handle('set-brightness', async (_event, id: string, value: number) => {
    if (typeof id !== 'string' || typeof value !== 'number') return false
    manual([id])
    return lightManager.setBrightness(id, value)
  })

  ipcMain.on('stream-brightness', (_event, id: string, value: number) => {
    if (typeof id === 'string' && typeof value === 'number') {
      manual([id])
      lightManager.setBrightness(id, value)
    }
  })

  ipcMain.handle('set-color-temp', async (_event, id: string, value: number) => {
    if (typeof id !== 'string' || typeof value !== 'number') return false
    manual([id])
    return lightManager.setColorTemp(id, value)
  })

  ipcMain.on('stream-color-temp', (_event, id: string, value: number) => {
    if (typeof id === 'string' && typeof value === 'number') {
      manual([id])
      lightManager.setColorTemp(id, value)
    }
  })

  ipcMain.handle('get-latency-stats', async () => {
    return latencyTracker.getStats()
  })

  ipcMain.handle('set-color', async (_event, id: string, color: ColorHS) => {
    if (typeof id !== 'string' || !color) return false
    manual([id])
    return lightManager.setColor(id, color.h, color.s, color.v)
  })

  ipcMain.handle('set-work-mode', async (_event, id: string, mode: 'white' | 'colour' | 'scene' | 'music') => {
    if (typeof id !== 'string') return false
    manual([id])
    return lightManager.setWorkMode(id, mode)
  })

  ipcMain.handle('set-scene', async (_event, id: string, sceneNum: number) => {
    if (typeof id !== 'string' || typeof sceneNum !== 'number') return false
    manual([id])
    return lightManager.setScene(id, sceneNum)
  })

  ipcMain.handle('set-countdown', async (_event, id: string, seconds: number) => {
    if (typeof id !== 'string' || typeof seconds !== 'number') return false
    return lightManager.setCountdown(id, seconds)
  })

  ipcMain.handle('set-all', async (_event, on: boolean) => {
    if (typeof on !== 'boolean') return []
    lightManager.markAllManual()
    return lightManager.setAll(on)
  })

  ipcMain.handle('set-group-power', async (_event, deviceIds: string[], on: boolean) => {
    if (!Array.isArray(deviceIds) || typeof on !== 'boolean') return []
    manual(deviceIds)
    return lightManager.setGroupPower(deviceIds, on)
  })

  ipcMain.handle('set-group-brightness', async (_event, deviceIds: string[], value: number) => {
    if (!Array.isArray(deviceIds) || typeof value !== 'number') return []
    manual(deviceIds)
    return lightManager.setGroupBrightness(deviceIds, value)
  })

  ipcMain.handle('set-group-color-temp', async (_event, deviceIds: string[], value: number) => {
    if (!Array.isArray(deviceIds) || typeof value !== 'number') return []
    manual(deviceIds)
    return lightManager.setGroupColorTemp(deviceIds, value)
  })

  // Flash action IPC
  ipcMain.handle('trigger-flash', async (_event, targetId?: string, roomId?: string, count: number = 2) => {
    return webhookServer.flashLights(targetId, roomId, count)
  })

  // Store & Settings IPC
  ipcMain.handle('get-store', async () => {
    return lumosStore.getData()
  })

  ipcMain.handle('set-device-meta', async (_event, id: string, meta: Partial<DeviceMetadata>) => {
    lumosStore.setDeviceMeta(id, meta)
    return true
  })

  ipcMain.handle('save-room', async (_event, room: { id?: string; name: string; deviceIds: string[] }) => {
    if (room.id) {
      return lumosStore.updateRoom(room.id, room.name, room.deviceIds)
    } else {
      return lumosStore.createRoom(room.name, room.deviceIds)
    }
  })

  ipcMain.handle('delete-room', async (_event, id: string) => {
    return lumosStore.deleteRoom(id)
  })

  ipcMain.handle('save-preset', async (_event, preset: Preset) => {
    lumosStore.savePreset(preset)
    return true
  })

  ipcMain.handle('delete-preset', async (_event, id: string) => {
    return lumosStore.deletePreset(id)
  })

  ipcMain.handle(
    'apply-preset',
    async (_event, presetId: string, targetType: 'all' | 'room' | 'light', targetId?: string) => {
      manual(lumosStore.resolveTargetIds(targetType, targetId))
      return lumosStore.applyPreset(presetId, targetType, targetId)
    }
  )

  ipcMain.handle('save-schedule', async (_event, schedule: Schedule) => {
    lumosStore.saveSchedule(schedule)
    return true
  })

  ipcMain.handle('delete-schedule', async (_event, id: string) => {
    return lumosStore.deleteSchedule(id)
  })

  ipcMain.handle(
    'start-sleep-timer',
    async (_event, targetType: 'all' | 'room' | 'light', targetId: string | undefined, durationMinutes: number) => {
      lumosStore.startSleepTimer(targetType, targetId, durationMinutes)
      return true
    }
  )

  ipcMain.handle('cancel-sleep-timer', async () => {
    lumosStore.cancelSleepTimer()
    return true
  })

  ipcMain.handle('save-sunrise-alarm', async (_event, alarm: SunriseAlarm | null) => {
    lumosStore.saveSunriseAlarm(alarm)
    return true
  })

  // Effects IPC Handlers
  const send = (channel: string, payload: unknown): void => {
    const win = getMainWindow()
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
  }
  effectManager.on('snapshot', (snapshot) => send('effects-update', snapshot))
  effectManager.on('paused', (notice) => send('effect-paused', notice))
  effectManager.on('live', (live) => send('effects-live', live))

  ipcMain.handle('effects-get', async () => effectManager.snapshot())

  ipcMain.handle('effects-set-enabled', async (_event, id: string, on: boolean) => {
    if (typeof id !== 'string' || typeof on !== 'boolean') return effectManager.snapshot()
    return effectManager.setEnabled(id, on)
  })

  ipcMain.handle('effects-update-settings', async (_event, id: string, patch: unknown) => {
    if (typeof id !== 'string') return effectManager.snapshot()
    return effectManager.updateSettings(id, patch)
  })

  ipcMain.handle('effects-update-global', async (_event, patch: unknown) => {
    return effectManager.updateGlobal(patch)
  })

  ipcMain.handle('effects-resume-lights', async (_event, id: string, lightIds: string[]) => {
    if (typeof id !== 'string' || !Array.isArray(lightIds)) return effectManager.snapshot()
    return effectManager.resumeLight(
      id,
      lightIds.filter((x) => typeof x === 'string')
    )
  })

  ipcMain.handle('effects-action', async (_event, id: string, action: string, payload: unknown) => {
    if (typeof id !== 'string' || typeof action !== 'string') return { ok: false, error: 'Invalid request' }
    try {
      return { ok: true, result: await effectManager.action(id, action, payload) }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Action failed' }
    }
  })

  // Energy IPC Handlers (all figures are estimates)
  const isRange = (r: unknown): r is EnergyRange => r === 'today' || r === '7d' || r === '30d'

  ipcMain.handle('energy-report', async (_event, range: unknown) => {
    return energyTracker.report(isRange(range) ? range : 'today')
  })

  ipcMain.handle('energy-set-watts', async (_event, id: string, watts: number) => {
    if (typeof id !== 'string' || typeof watts !== 'number' || !Number.isFinite(watts)) return false
    energyTracker.setRatedWatts(id, watts)
    return true
  })

  ipcMain.handle('energy-set-price', async (_event, price: unknown) => {
    energyTracker.setPrice(price === null ? null : price)
    return true
  })

  ipcMain.handle('energy-reset', async () => {
    energyTracker.reset()
    return true
  })

  ipcMain.handle('energy-export', async () => {
    const win = getMainWindow()
    const today = new Date().toISOString().slice(0, 10)
    const result = await dialog.showSaveDialog(win || (undefined as any), {
      title: 'Export energy estimates',
      defaultPath: `lumos-energy-${today}.csv`,
      filters: [{ name: 'CSV', extensions: ['csv'] }]
    })
    if (result.canceled || !result.filePath) return { canceled: true }
    try {
      writeFileSync(result.filePath, energyTracker.toCsv(), 'utf-8')
      return { canceled: false, success: true }
    } catch (err: any) {
      return { canceled: false, success: false, error: err?.message || 'Could not save the file' }
    }
  })

  // HomeKit IPC Handlers
  ipcMain.handle('get-homekit-info', async () => {
    return homeKitManager.getHomeKitInfo()
  })

  ipcMain.handle('reset-homekit', async () => {
    return homeKitManager.resetHomeKit()
  })

  // Webhook IPC Handlers
  ipcMain.handle('get-webhook-info', async () => {
    return webhookServer.getInfo()
  })

  // Onboarding & Device Import IPC Handlers
  ipcMain.handle('has-devices-config', async () => {
    return hasDevicesConfig()
  })

  ipcMain.handle('pick-and-import-devices-file', async () => {
    const win = getMainWindow()
    const result = await dialog.showOpenDialog(win || undefined as any, {
      title: 'Import TinyTuya devices.json',
      filters: [{ name: 'JSON Files', extensions: ['json'] }],
      properties: ['openFile']
    })

    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true }
    }

    try {
      const filePath = result.filePaths[0]
      const raw = readFileSync(filePath, 'utf-8')
      const validation = validateDevicesConfig(raw)
      if (!validation.valid) {
        return { canceled: false, success: false, error: validation.error }
      }

      saveDevicesConfig(raw)
      lightManager.reloadDevices()
      return {
        canceled: false,
        success: true,
        lightsCount: validation.lights.length,
        lights: validation.lights.map((l) => ({ id: l.id, name: l.name, product: l.product_name || 'Smart Light' }))
      }
    } catch (err: any) {
      return { canceled: false, success: false, error: err?.message || 'Failed reading selected file' }
    }
  })

  ipcMain.handle('save-imported-devices', async (_event, rawJson: string) => {
    const validation = validateDevicesConfig(rawJson)
    if (!validation.valid) {
      return { success: false, error: validation.error }
    }

    const saveRes = saveDevicesConfig(rawJson)
    if (saveRes.success) {
      lightManager.reloadDevices()
      return { success: true, count: saveRes.count }
    }
    return { success: false, error: saveRes.error }
  })

  ipcMain.handle('start-demo-mode', async () => {
    lightManager.setDemoMode(true)
    return lightManager.getAllStates()
  })

  ipcMain.handle('get-is-demo-mode', async () => {
    return lightManager.getIsDemoMode()
  })

  // External URL opener
  ipcMain.handle('open-external-url', async (_event, url: string) => {
    if (typeof url === 'string' && (url.startsWith('https://') || url.startsWith('http://'))) {
      shell.openExternal(url)
      return true
    }
    return false
  })

  // Launch at login Handlers
  ipcMain.handle('get-launch-at-login', () => {
    try {
      const stored = lumosStore.getLaunchAtLogin()
      if (typeof stored === 'boolean') {
        return stored
      }
      return app.getLoginItemSettings().openAtLogin
    } catch {
      return false
    }
  })

  ipcMain.handle('set-launch-at-login', (_event, openAtLogin: boolean) => {
    if (typeof openAtLogin !== 'boolean') return false
    try {
      app.setLoginItemSettings({
        openAtLogin: Boolean(openAtLogin),
        openAsHidden: true,
        args: ['--hidden']
      })
    } catch (err) {
      console.error('[Lumos IPC] Failed to set login item settings:', err)
    }
    lumosStore.setLaunchAtLogin(openAtLogin)
    return openAtLogin
  })

  // Window control helpers for frameless title bar
  ipcMain.handle('window-minimize', () => {
    const win = getMainWindow()
    if (win && !win.isDestroyed()) win.minimize()
  })

  ipcMain.handle('window-maximize', () => {
    const win = getMainWindow()
    if (win && !win.isDestroyed()) {
      if (win.isMaximized()) {
        win.unmaximize()
      } else {
        win.maximize()
      }
    }
  })

  ipcMain.handle('window-close', () => {
    const win = getMainWindow()
    if (win && !win.isDestroyed()) {
      win.close()
    }
  })
}
