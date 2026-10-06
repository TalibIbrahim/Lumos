import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron'
import {
  NormalizedLightState,
  LumosStoreData,
  Preset,
  Schedule,
  ColorHS,
  DeviceMetadata,
  SunriseAlarm
} from '../main/types'

export interface HomeKitInfo {
  isPaired: boolean
  setupCode: string
  setupURI: string
  qrCodeDataUrl: string
  bridgeUsername: string
  port: number
  accessoryCount: number
}

export interface WebhookInfo {
  url: string
  token: string
  port: number
}

export type UpdateStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'available'; version: string }
  | { state: 'not-available' }
  | { state: 'downloading'; percent: number }
  | { state: 'downloaded'; version: string }
  | { state: 'error'; message: string }

export interface ImportResult {
  canceled: boolean
  success?: boolean
  error?: string
  lightsCount?: number
  lights?: Array<{ id: string; name: string; product: string }>
}

export interface LumosAPI {
  // Light controls
  getStatus: () => Promise<NormalizedLightState[]>
  toggleLight: (id: string) => Promise<boolean>
  setPower: (id: string, on: boolean) => Promise<boolean>
  setBrightness: (id: string, value: number) => Promise<boolean>
  streamBrightness: (id: string, value: number) => void
  setColorTemp: (id: string, value: number) => Promise<boolean>
  streamColorTemp: (id: string, value: number) => void
  setColor: (id: string, color: ColorHS) => Promise<boolean>
  setWorkMode: (id: string, mode: 'white' | 'colour' | 'scene' | 'music') => Promise<boolean>
  setScene: (id: string, sceneNum: number) => Promise<boolean>
  setCountdown: (id: string, seconds: number) => Promise<boolean>
  setAll: (on: boolean) => Promise<boolean[]>
  setGroupPower: (deviceIds: string[], on: boolean) => Promise<boolean[]>
  setGroupBrightness: (deviceIds: string[], value: number) => Promise<boolean[]>
  setGroupColorTemp: (deviceIds: string[], value: number) => Promise<boolean[]>
  triggerFlash: (targetId?: string, roomId?: string, count?: number) => Promise<boolean>
  getLatencyStats: () => Promise<{ count: number; min: number; max: number; avg: number; p50: number; p95: number }>

  // Subscriptions
  onUpdate: (callback: (state: NormalizedLightState) => void) => () => void
  onStoreUpdate: (callback: (store: LumosStoreData) => void) => () => void
  onUpdateStatus: (callback: (status: UpdateStatus) => void) => () => void

  // Store & Settings
  getStore: () => Promise<LumosStoreData>
  setDeviceMeta: (id: string, meta: Partial<DeviceMetadata>) => Promise<boolean>
  saveRoom: (room: { id?: string; name: string; deviceIds: string[] }) => Promise<any>
  deleteRoom: (id: string) => Promise<boolean>
  savePreset: (preset: Preset) => Promise<boolean>
  deletePreset: (id: string) => Promise<boolean>
  applyPreset: (presetId: string, targetType: 'all' | 'room' | 'light', targetId?: string) => Promise<boolean>
  saveSchedule: (schedule: Schedule) => Promise<boolean>
  deleteSchedule: (id: string) => Promise<boolean>
  startSleepTimer: (targetType: 'all' | 'room' | 'light', targetId: string | undefined, durationMinutes: number) => Promise<boolean>
  cancelSleepTimer: () => Promise<boolean>
  saveSunriseAlarm: (alarm: SunriseAlarm | null) => Promise<boolean>

  // HomeKit & Webhook
  getHomeKitInfo: () => Promise<HomeKitInfo>
  resetHomeKit: () => Promise<HomeKitInfo>
  getWebhookInfo: () => Promise<WebhookInfo>

  // Auto-Update
  checkForUpdates: () => Promise<any>
  installUpdate: () => Promise<void>
  getAppVersion: () => Promise<string>
  getUpdateStatus: () => Promise<UpdateStatus>

  // Onboarding & Demo
  hasDevicesConfig: () => Promise<boolean>
  pickAndImportDevicesFile: () => Promise<ImportResult>
  saveImportedDevices: (rawJson: string) => Promise<{ success: boolean; count?: number; error?: string }>
  startDemoMode: () => Promise<NormalizedLightState[]>
  getIsDemoMode: () => Promise<boolean>
  openExternalUrl: (url: string) => Promise<boolean>

  // Window & System
  getLaunchAtLogin: () => Promise<boolean>
  setLaunchAtLogin: (enabled: boolean) => Promise<boolean>
  minimize: () => Promise<void>
  maximize: () => Promise<void>
  close: () => Promise<void>
}

export type LumenAPI = LumosAPI

const api: LumosAPI = {
  getStatus: (): Promise<NormalizedLightState[]> => ipcRenderer.invoke('get-status'),
  toggleLight: (id: string): Promise<boolean> => ipcRenderer.invoke('toggle-light', id),
  setPower: (id: string, on: boolean): Promise<boolean> => ipcRenderer.invoke('set-power', id, on),
  setBrightness: (id: string, value: number): Promise<boolean> =>
    ipcRenderer.invoke('set-brightness', id, value),
  streamBrightness: (id: string, value: number): void =>
    ipcRenderer.send('stream-brightness', id, value),
  setColorTemp: (id: string, value: number): Promise<boolean> =>
    ipcRenderer.invoke('set-color-temp', id, value),
  streamColorTemp: (id: string, value: number): void =>
    ipcRenderer.send('stream-color-temp', id, value),
  setColor: (id: string, color: ColorHS): Promise<boolean> =>
    ipcRenderer.invoke('set-color', id, color),
  setWorkMode: (id: string, mode: 'white' | 'colour' | 'scene' | 'music'): Promise<boolean> =>
    ipcRenderer.invoke('set-work-mode', id, mode),
  setScene: (id: string, sceneNum: number): Promise<boolean> =>
    ipcRenderer.invoke('set-scene', id, sceneNum),
  setCountdown: (id: string, seconds: number): Promise<boolean> =>
    ipcRenderer.invoke('set-countdown', id, seconds),
  setAll: (on: boolean): Promise<boolean[]> => ipcRenderer.invoke('set-all', on),
  setGroupPower: (deviceIds: string[], on: boolean) =>
    ipcRenderer.invoke('set-group-power', deviceIds, on),
  setGroupBrightness: (deviceIds: string[], value: number) =>
    ipcRenderer.invoke('set-group-brightness', deviceIds, value),
  setGroupColorTemp: (deviceIds: string[], value: number) =>
    ipcRenderer.invoke('set-group-color-temp', deviceIds, value),
  triggerFlash: (targetId?: string, roomId?: string, count?: number) =>
    ipcRenderer.invoke('trigger-flash', targetId, roomId, count),
  getLatencyStats: () => ipcRenderer.invoke('get-latency-stats'),

  onUpdate: (callback: (state: NormalizedLightState) => void): (() => void) => {
    const subscription = (_event: IpcRendererEvent, state: NormalizedLightState): void => {
      callback(state)
    }
    ipcRenderer.on('light-update', subscription)
    return () => {
      ipcRenderer.removeListener('light-update', subscription)
    }
  },

  onStoreUpdate: (callback: (store: LumosStoreData) => void): (() => void) => {
    const subscription = (_event: IpcRendererEvent, store: LumosStoreData): void => {
      callback(store)
    }
    ipcRenderer.on('store-update', subscription)
    return () => {
      ipcRenderer.removeListener('store-update', subscription)
    }
  },

  onUpdateStatus: (callback: (status: UpdateStatus) => void): (() => void) => {
    const subscription = (_event: IpcRendererEvent, status: UpdateStatus): void => {
      callback(status)
    }
    ipcRenderer.on('update-status', subscription)
    return () => {
      ipcRenderer.removeListener('update-status', subscription)
    }
  },

  getStore: (): Promise<LumosStoreData> => ipcRenderer.invoke('get-store'),
  setDeviceMeta: (id: string, meta: Partial<DeviceMetadata>): Promise<boolean> =>
    ipcRenderer.invoke('set-device-meta', id, meta),
  saveRoom: (room: { id?: string; name: string; deviceIds: string[] }): Promise<any> =>
    ipcRenderer.invoke('save-room', room),
  deleteRoom: (id: string): Promise<boolean> => ipcRenderer.invoke('delete-room', id),
  savePreset: (preset: Preset): Promise<boolean> => ipcRenderer.invoke('save-preset', preset),
  deletePreset: (id: string): Promise<boolean> => ipcRenderer.invoke('delete-preset', id),
  applyPreset: (presetId: string, targetType: 'all' | 'room' | 'light', targetId?: string): Promise<boolean> =>
    ipcRenderer.invoke('apply-preset', presetId, targetType, targetId),
  saveSchedule: (schedule: Schedule): Promise<boolean> => ipcRenderer.invoke('save-schedule', schedule),
  deleteSchedule: (id: string): Promise<boolean> => ipcRenderer.invoke('delete-schedule', id),
  startSleepTimer: (targetType: 'all' | 'room' | 'light', targetId: string | undefined, durationMinutes: number): Promise<boolean> =>
    ipcRenderer.invoke('start-sleep-timer', targetType, targetId, durationMinutes),
  cancelSleepTimer: (): Promise<boolean> => ipcRenderer.invoke('cancel-sleep-timer'),
  saveSunriseAlarm: (alarm: SunriseAlarm | null): Promise<boolean> =>
    ipcRenderer.invoke('save-sunrise-alarm', alarm),

  getHomeKitInfo: (): Promise<HomeKitInfo> => ipcRenderer.invoke('get-homekit-info'),
  resetHomeKit: (): Promise<HomeKitInfo> => ipcRenderer.invoke('reset-homekit'),
  getWebhookInfo: (): Promise<WebhookInfo> => ipcRenderer.invoke('get-webhook-info'),

  checkForUpdates: (): Promise<any> => ipcRenderer.invoke('check-for-updates'),
  installUpdate: (): Promise<void> => ipcRenderer.invoke('install-update'),
  getAppVersion: (): Promise<string> => ipcRenderer.invoke('get-app-version'),
  getUpdateStatus: (): Promise<UpdateStatus> => ipcRenderer.invoke('get-update-status'),

  hasDevicesConfig: (): Promise<boolean> => ipcRenderer.invoke('has-devices-config'),
  pickAndImportDevicesFile: (): Promise<ImportResult> => ipcRenderer.invoke('pick-and-import-devices-file'),
  saveImportedDevices: (rawJson: string): Promise<{ success: boolean; count?: number; error?: string }> =>
    ipcRenderer.invoke('save-imported-devices', rawJson),
  startDemoMode: (): Promise<NormalizedLightState[]> => ipcRenderer.invoke('start-demo-mode'),
  getIsDemoMode: (): Promise<boolean> => ipcRenderer.invoke('get-is-demo-mode'),
  openExternalUrl: (url: string): Promise<boolean> => ipcRenderer.invoke('open-external-url', url),

  getLaunchAtLogin: (): Promise<boolean> => ipcRenderer.invoke('get-launch-at-login'),
  setLaunchAtLogin: (enabled: boolean): Promise<boolean> =>
    ipcRenderer.invoke('set-launch-at-login', enabled),
  minimize: (): Promise<void> => ipcRenderer.invoke('window-minimize'),
  maximize: (): Promise<void> => ipcRenderer.invoke('window-maximize'),
  close: (): Promise<void> => ipcRenderer.invoke('window-close')
}

// Expose lumos and lumen bridge in renderer context
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('lumos', api)
    contextBridge.exposeInMainWorld('lumen', api)
  } catch (error) {
    console.error('[Lumos Preload] Error exposing contextBridge:', error)
  }
} else {
  // @ts-ignore
  window.lumos = api
  // @ts-ignore
  window.lumen = api
}
