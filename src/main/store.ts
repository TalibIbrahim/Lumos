import { app } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import {
  LumosStoreData,
  Preset,
  RoomGroup,
  Schedule,
  SleepTimerState,
  SunriseAlarm,
  DeviceMetadata
} from './types'
import { LightManager } from './devices/LightManager'

const DEFAULT_PRESETS: Preset[] = [
  {
    id: 'preset-reading',
    name: 'Reading',
    icon: 'BookOpen',
    brightness: 85,
    colorTemp: 60,
    mode: 'white'
  },
  {
    id: 'preset-relax',
    name: 'Relax',
    icon: 'Coffee',
    brightness: 40,
    colorTemp: 15,
    mode: 'white'
  },
  {
    id: 'preset-focus',
    name: 'Focus',
    icon: 'Target',
    brightness: 100,
    colorTemp: 85,
    mode: 'white'
  },
  {
    id: 'preset-night',
    name: 'Night',
    icon: 'Moon',
    brightness: 5,
    colorTemp: 0,
    mode: 'white'
  }
]

export class LumosStore {
  private filePath: string
  private legacyFilePath: string
  private data: LumosStoreData
  private lightManager: LightManager | null = null
  private schedulerInterval: NodeJS.Timeout | null = null
  private lastTriggeredMinute: string = ''
  private lastStateSaveTimer: NodeJS.Timeout | null = null
  private onBroadcast?: () => void

  constructor() {
    let userDataPath = ''
    try {
      userDataPath = app.getPath('userData')
    } catch {
      userDataPath = join(process.cwd(), 'persist')
    }

    if (!existsSync(userDataPath)) {
      mkdirSync(userDataPath, { recursive: true })
    }

    this.filePath = join(userDataPath, 'lumos-store.json')
    this.legacyFilePath = join(userDataPath, 'lumen-store.json')
    this.data = this.load()
  }

  public init(lightManager: LightManager, onBroadcast?: () => void): void {
    this.lightManager = lightManager
    this.onBroadcast = onBroadcast
    this.applyMetadataToLights()
    this.startScheduler()
  }

  private load(): LumosStoreData {
    const targetPath = existsSync(this.filePath)
      ? this.filePath
      : existsSync(this.legacyFilePath)
      ? this.legacyFilePath
      : null

    if (targetPath && existsSync(targetPath)) {
      try {
        const raw = readFileSync(targetPath, 'utf-8')
        const parsed = JSON.parse(raw)
        return {
          rooms: Array.isArray(parsed.rooms) ? parsed.rooms : [],
          presets: Array.isArray(parsed.presets) && parsed.presets.length > 0 ? parsed.presets : DEFAULT_PRESETS,
          schedules: Array.isArray(parsed.schedules) ? parsed.schedules : [],
          sleepTimer: parsed.sleepTimer || null,
          sunriseAlarm: parsed.sunriseAlarm || null,
          deviceMeta: parsed.deviceMeta || {},
          settings: parsed.settings || {}
        }
      } catch (err) {
        console.error('[Lumos Store] Error reading store from disk:', err)
      }
    }

    return {
      rooms: [
        { id: 'room-office', name: 'Office', deviceIds: [] }
      ],
      presets: DEFAULT_PRESETS,
      schedules: [],
      sleepTimer: null,
      sunriseAlarm: null,
      deviceMeta: {},
      settings: {}
    }
  }

  public save(): void {
    try {
      writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf-8')
      if (this.onBroadcast) {
        this.onBroadcast()
      }
    } catch (err) {
      console.error('[Lumos Store] Error saving store to disk:', err)
    }
  }

  public getData(): LumosStoreData {
    return this.data
  }

  public getLaunchAtLogin(): boolean | undefined {
    return this.data.settings?.launchAtLogin
  }

  public setLaunchAtLogin(enabled: boolean): void {
    if (!this.data.settings) {
      this.data.settings = {}
    }
    this.data.settings.launchAtLogin = enabled
    this.save()
  }

  public getStartInTray(): boolean {
    return this.data.settings?.startInTray !== false
  }

  public setStartInTray(enabled: boolean): void {
    if (!this.data.settings) {
      this.data.settings = {}
    }
    this.data.settings.startInTray = enabled
    this.save()
  }

  public applyMetadataToLights(): void {
    if (!this.lightManager) return
    const lights = this.lightManager.getAllLights()
    for (const light of lights) {
      const meta = this.data.deviceMeta[light.id]
      if (meta) {
        if (meta.customName) light.customName = meta.customName
        if (meta.room) light.room = meta.room
        if (typeof meta.order === 'number') light.order = meta.order
        if (typeof meta.hidden === 'boolean') light.hidden = meta.hidden
      }
    }
  }

  public setDeviceMeta(deviceId: string, meta: Partial<DeviceMetadata>): void {
    const existing = this.data.deviceMeta[deviceId] || {}
    this.data.deviceMeta[deviceId] = { ...existing, ...meta }
    this.save()
    this.applyMetadataToLights()

    const light = this.lightManager?.getLight(deviceId)
    if (light) {
      light.emitState()
    }
  }

  public recordLastState(deviceId: string, state: DeviceMetadata['lastState']): void {
    const existing = this.data.deviceMeta[deviceId] || {}
    this.data.deviceMeta[deviceId] = {
      ...existing,
      lastState: state
    }
    // State changes arrive many times a second while sliders move; write once they settle.
    if (this.lastStateSaveTimer) clearTimeout(this.lastStateSaveTimer)
    this.lastStateSaveTimer = setTimeout(() => {
      this.lastStateSaveTimer = null
      this.save()
    }, 1000)
  }

  public async restoreLastStates(): Promise<void> {
    if (!this.lightManager) return
    const lights = this.lightManager.getAllLights()
    for (const light of lights) {
      const meta = this.data.deviceMeta[light.id]
      if (meta && meta.lastState) {
        const last = meta.lastState
        try {
          if (last.power) {
            await light.setPower(true)
            if (typeof last.brightness === 'number') await light.setBrightness(last.brightness)
            if (last.mode === 'colour' && last.color && light.capabilities.hasColor) {
              await light.setColor(last.color.h, last.color.s, last.color.v)
            } else if (typeof last.colorTemp === 'number') {
              await light.setColorTemp(last.colorTemp)
            }
          } else {
            await light.setPower(false)
          }
        } catch (err) {
          console.warn(`[Lumos Store] Could not restore state for ${light.name}:`, err)
        }
      }
    }
  }

  // --- Rooms / Groups ---
  public setRooms(rooms: RoomGroup[]): void {
    this.data.rooms = rooms
    this.save()
  }

  public createRoom(name: string, deviceIds: string[] = []): RoomGroup {
    const id = `room-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`
    const room: RoomGroup = { id, name, deviceIds }
    this.data.rooms.push(room)
    this.save()
    return room
  }

  public updateRoom(id: string, name: string, deviceIds: string[]): RoomGroup | null {
    const room = this.data.rooms.find((r) => r.id === id)
    if (!room) return null
    room.name = name
    room.deviceIds = deviceIds
    this.save()
    return room
  }

  public deleteRoom(id: string): boolean {
    const prevLen = this.data.rooms.length
    this.data.rooms = this.data.rooms.filter((r) => r.id !== id)
    this.save()
    return this.data.rooms.length < prevLen
  }

  // --- Presets ---
  public savePreset(preset: Preset): void {
    const idx = this.data.presets.findIndex((p) => p.id === preset.id)
    if (idx >= 0) {
      this.data.presets[idx] = preset
    } else {
      this.data.presets.push(preset)
    }
    this.save()
  }

  public deletePreset(id: string): boolean {
    const prevLen = this.data.presets.length
    this.data.presets = this.data.presets.filter((p) => p.id !== id)
    this.save()
    return this.data.presets.length < prevLen
  }

  public async applyPreset(presetId: string, targetType: 'all' | 'room' | 'light', targetId?: string): Promise<boolean> {
    const preset = this.data.presets.find((p) => p.id === presetId)
    if (!preset || !this.lightManager) return false

    const targetLights = this.resolveTargetLights(targetType, targetId)
    for (const light of targetLights) {
      if (!light.isConnected && !light.isDemo) continue
      try {
        await light.setPower(true)
        await light.setBrightness(preset.brightness)
        if (preset.mode === 'colour' && preset.color && light.capabilities.hasColor) {
          await light.setColor(preset.color.h, preset.color.s, preset.color.v)
        } else {
          await light.setColorTemp(preset.colorTemp)
        }
      } catch (err) {
        console.error(`[Lumos Store] Error applying preset ${preset.name} to light ${light.name}:`, err)
      }
    }
    return true
  }

  // --- Schedules ---
  public saveSchedule(schedule: Schedule): void {
    const idx = this.data.schedules.findIndex((s) => s.id === schedule.id)
    if (idx >= 0) {
      this.data.schedules[idx] = schedule
    } else {
      this.data.schedules.push(schedule)
    }
    this.save()
  }

  public deleteSchedule(id: string): boolean {
    const prevLen = this.data.schedules.length
    this.data.schedules = this.data.schedules.filter((s) => s.id !== id)
    this.save()
    return this.data.schedules.length < prevLen
  }

  // --- Sleep Timer ---
  public startSleepTimer(targetType: 'all' | 'room' | 'light', targetId: string | undefined, durationMinutes: number): void {
    if (!this.lightManager) return
    const lights = this.resolveTargetLights(targetType, targetId)
    const initialMap: Record<string, number> = {}
    for (const l of lights) {
      initialMap[l.id] = l.power ? l.brightness : 100
    }

    const now = Date.now()
    this.data.sleepTimer = {
      active: true,
      targetType,
      targetId,
      durationMinutes,
      startEpoch: now,
      endEpoch: now + durationMinutes * 60 * 1000,
      initialBrightnessMap: initialMap
    }
    this.save()
    if (this.onBroadcast) this.onBroadcast()
  }

  public cancelSleepTimer(): void {
    this.data.sleepTimer = null
    this.save()
    if (this.onBroadcast) this.onBroadcast()
  }

  // --- Sunrise Alarm ---
  public saveSunriseAlarm(alarm: SunriseAlarm | null): void {
    this.data.sunriseAlarm = alarm
    this.save()
    if (this.onBroadcast) this.onBroadcast()
  }

  // --- Helpers & Background Scheduler ---
  public resolveTargetIds(targetType: 'all' | 'room' | 'light', targetId?: string): string[] {
    return this.resolveTargetLights(targetType, targetId).map((l) => l.id)
  }

  private resolveTargetLights(targetType: 'all' | 'room' | 'light', targetId?: string) {
    if (!this.lightManager) return []
    const all = this.lightManager.getAllLights()
    if (targetType === 'all') return all
    if (targetType === 'light') return all.filter((l) => l.id === targetId)
    if (targetType === 'room') {
      const room = this.data.rooms.find((r) => r.id === targetId)
      if (!room) return []
      return all.filter((l) => room.deviceIds.includes(l.id))
    }
    return all
  }

  private startScheduler(): void {
    if (this.schedulerInterval) clearInterval(this.schedulerInterval)

    this.schedulerInterval = setInterval(() => {
      this.tick()
    }, 5000)
  }

  private async tick(): Promise<void> {
    const now = new Date()
    const nowTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
    const currentDay = now.getDay()
    const currentEpoch = now.getTime()

    // 1. Sleep timer ticker
    if (this.data.sleepTimer && this.data.sleepTimer.active && this.lightManager) {
      const timer = this.data.sleepTimer
      if (currentEpoch >= timer.endEpoch) {
        const targets = this.resolveTargetLights(timer.targetType, timer.targetId)
        for (const light of targets) {
          light.setPower(false).catch(() => {})
        }
        this.data.sleepTimer = null
        this.save()
        if (this.onBroadcast) this.onBroadcast()
      } else {
        const totalDuration = timer.endEpoch - timer.startEpoch
        const elapsed = currentEpoch - timer.startEpoch
        const progress = Math.min(1, Math.max(0, elapsed / totalDuration))
        const targets = this.resolveTargetLights(timer.targetType, timer.targetId)

        for (const light of targets) {
          const initBri = timer.initialBrightnessMap[light.id] ?? 100
          const targetBri = Math.max(1, Math.round(initBri * (1 - progress)))
          if (light.brightness !== targetBri && light.power) {
            light.setBrightness(targetBri).catch(() => {})
          }
        }
      }
    }

    // 2. Sunrise alarm ticker
    if (this.data.sunriseAlarm && this.data.sunriseAlarm.enabled && this.lightManager) {
      const alarm = this.data.sunriseAlarm
      if (alarm.days.includes(currentDay)) {
        const [targetH, targetM] = alarm.time.split(':').map(Number)
        const targetDate = new Date(now)
        targetDate.setHours(targetH, targetM, 0, 0)

        const rampMs = alarm.rampDurationMinutes * 60 * 1000
        const startRampTime = targetDate.getTime() - rampMs
        const endRampTime = targetDate.getTime()

        if (currentEpoch >= startRampTime && currentEpoch <= endRampTime) {
          const progress = (currentEpoch - startRampTime) / rampMs
          const brightness = Math.max(1, Math.min(85, Math.round(progress * 85)))
          const colorTemp = Math.max(0, Math.min(75, Math.round(progress * 75)))
          const targets = this.resolveTargetLights(alarm.targetType, alarm.targetId)

          for (const light of targets) {
            if (!light.power) light.setPower(true).catch(() => {})
            light.setBrightness(brightness).catch(() => {})
            light.setColorTemp(colorTemp).catch(() => {})
          }
        }
      }
    }

    // 3. Schedules (once per minute trigger)
    if (this.lastTriggeredMinute !== nowTime) {
      this.lastTriggeredMinute = nowTime

      for (const schedule of this.data.schedules) {
        if (!schedule.enabled) continue
        if (schedule.time === nowTime && schedule.days.includes(currentDay)) {
          console.log(`[Lumos Scheduler] Triggering schedule: "${schedule.name}"`)
          const targets = this.resolveTargetLights(schedule.targetType, schedule.targetId)

          if (schedule.action === 'on') {
            for (const light of targets) light.setPower(true).catch(() => {})
          } else if (schedule.action === 'off') {
            for (const light of targets) light.setPower(false).catch(() => {})
          } else if (schedule.action === 'preset' && schedule.presetId) {
            this.applyPreset(schedule.presetId, schedule.targetType, schedule.targetId).catch(() => {})
          }
        }
      }
    }
  }

  public destroy(): void {
    if (this.lastStateSaveTimer) {
      clearTimeout(this.lastStateSaveTimer)
      this.lastStateSaveTimer = null
      this.save()
    }
    if (this.schedulerInterval) {
      clearInterval(this.schedulerInterval)
      this.schedulerInterval = null
    }
  }
}

export const lumosStore = new LumosStore()
export const lumenStore = lumosStore
