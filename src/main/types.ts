export interface DPSConfig {
  power: number
  mode: number
  brightness: number
  colorTemp: number
  color: number
  scene: number
  countdown: number
  minBrightness: number
  maxBrightness: number
  minColorTemp: number
  maxColorTemp: number
}

export interface TinyTuyaMappingEntry {
  code: string
  type: string
  values?: {
    min?: number
    max?: number
    scale?: number
    step?: number
    range?: string[]
    [key: string]: any
  }
  raw_values?: string
}

export interface TinyTuyaDevice {
  name: string
  id: string
  key: string
  mac?: string
  ip?: string
  version?: string | number
  ver?: string | number
  category?: string
  sub?: boolean
  sub_device?: boolean
  product_name?: string
  product_id?: string
  mapping?: Record<string, TinyTuyaMappingEntry>
  dps?: Partial<DPSConfig>
}

export interface DeviceCapabilities {
  hasPower: boolean
  hasBrightness: boolean
  hasColorTemp: boolean
  hasColor: boolean
  hasScenes: boolean
  hasCountdown: boolean
}

export interface ColorHS {
  h: number // 0-360
  s: number // 0-100
  v?: number // 0-100
}

export interface NormalizedLightState {
  id: string
  name: string
  ip: string
  online: boolean
  power: boolean
  brightness: number // 0-100 normalized
  colorTemp: number // 0-100 normalized (0 = warmest amber, 100 = coolest daylight)
  color?: ColorHS // h: 0-360, s: 0-100, v: 0-100
  mode: 'white' | 'colour' | 'scene' | 'music' | string
  scene?: number
  countdown?: number // seconds remaining
  lastSeen: number
  capabilities: DeviceCapabilities
  customName?: string
  room?: string
  order?: number
  hidden?: boolean
  effect?: string // label of the effect currently shaping this light's output
}

export const DEFAULT_DPS: DPSConfig = {
  power: 20,
  mode: 21,
  brightness: 22,
  colorTemp: 23,
  color: 24,
  scene: 25,
  countdown: 26,
  minBrightness: 10,
  maxBrightness: 1000,
  minColorTemp: 0,
  maxColorTemp: 1000
}

export interface Preset {
  id: string
  name: string
  icon?: string // Lucide icon identifier
  brightness: number
  colorTemp: number
  color?: ColorHS
  mode: 'white' | 'colour'
}

export interface RoomGroup {
  id: string
  name: string
  deviceIds: string[]
}

export interface Schedule {
  id: string
  name: string
  enabled: boolean
  time: string // "HH:mm" 24h
  days: number[] // 0-6 (0 is Sunday)
  action: 'on' | 'off' | 'preset'
  presetId?: string
  targetType: 'all' | 'room' | 'light'
  targetId?: string
}

export interface SleepTimerState {
  active: boolean
  targetType: 'all' | 'room' | 'light'
  targetId?: string
  durationMinutes: number
  startEpoch: number
  endEpoch: number
  initialBrightnessMap: Record<string, number>
}

export interface SunriseAlarm {
  id: string
  name: string
  enabled: boolean
  time: string // "HH:mm"
  days: number[]
  rampDurationMinutes: number
  targetType: 'all' | 'room' | 'light'
  targetId?: string
}

export interface DeviceMetadata {
  customName?: string
  room?: string
  order?: number
  hidden?: boolean
  lastState?: {
    power: boolean
    brightness: number
    colorTemp: number
    color?: ColorHS
    mode: string
  }
}

export interface AppSettings {
  launchAtLogin?: boolean
  startInTray?: boolean
}

export interface LumosStoreData {
  rooms: RoomGroup[]
  presets: Preset[]
  schedules: Schedule[]
  sleepTimer: SleepTimerState | null
  sunriseAlarm: SunriseAlarm | null
  deviceMeta: Record<string, DeviceMetadata>
  settings?: AppSettings
}

export type LumenStoreData = LumosStoreData

// --- Effects (shared with the renderer) ---

export type EffectStatusName = 'off' | 'waiting' | 'active' | 'error'

export interface EffectSnapshotData {
  id: string
  label: string
  description: string
  status: EffectStatusName
  statusDetail: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  settings: { enabled: boolean; targets: 'all' | string[] } & Record<string, any>
  pausedLights: string[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  info: Record<string, any>
}

export interface GlobalEffectSettingsData {
  ratePerSecond: number
  maxFlashesPerSecond: number
  reduceIntensity: boolean
  resumeOnLaunch: boolean
}

export interface EffectsSnapshotData {
  global: GlobalEffectSettingsData
  effects: EffectSnapshotData[]
}

export interface EffectPausedNotice {
  effectId: string
  effectLabel: string
  lightIds: string[]
  lightNames: string[]
}

export interface EffectActionResult {
  ok: boolean
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  result?: any
  error?: string
}

// --- Energy (all figures are estimates) ---

export type EnergyRangeName = 'today' | '7d' | '30d'

export interface EnergyReportData {
  range: EnergyRangeName
  totalKwh: number
  estimatedCost: number | null
  price: { perKwh: number; currency: string } | null
  daily: Array<{ date: string; kwh: number }>
  lights: Array<{ id: string; name: string; kwh: number; hoursOn: number; ratedWatts: number; watts: number }>
  defaultWatts: number
}
