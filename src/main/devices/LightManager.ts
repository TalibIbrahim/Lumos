import { Light } from './Light'
import { loadDevicesConfig } from '../config'
import { DEMO_DEVICES } from '../demo'
import { TinyTuyaDevice, NormalizedLightState } from '../types'
import { announcements, Announcement } from './discovery'
import { getArpTable } from './arp'

export class LightManager {
  private lights: Map<string, Light> = new Map()
  private onStateBroadcast: (state: NormalizedLightState) => void
  private isDemoMode = false
  private isInitialized = false
  /** While this computer controls another computer's lights, it holds no bulb connections. */
  private remoteMode = false

  /** Called after the set of lights is created or replaced. */
  public onLightsLoaded?: () => void
  /**
   * Called before lights are changed by hand (app UI, HomeKit, webhook).
   * 'power' is a plain on or off; 'state' changes colour or brightness.
   */
  public onManualChange?: (lightIds: string[], kind: 'power' | 'state') => void

  constructor(onStateBroadcast: (state: NormalizedLightState) => void) {
    this.onStateBroadcast = onStateBroadcast
    announcements.on('announce', (a: Announcement) => this.lights.get(a.id)?.onAnnounced(a))
  }

  /**
   * Listens for lights announcing themselves, so a light that moved or changed is found
   * without a scan. A light only announces while nothing is connected to it, and a connected
   * light ignores announcements, so this listens only while some light is not connected.
   */
  private syncAnnouncements(): void {
    const needed =
      !this.isDemoMode && !this.remoteMode && [...this.lights.values()].some((l) => !l.isConnected && !l.isDemo)
    if (needed) announcements.start()
    else announcements.stop()
  }

  /** Marks lights as changed by hand so ambient effects step aside for them. */
  public markManual(lightIds: string[], kind: 'power' | 'state' = 'state'): void {
    const ids = lightIds.filter((id) => this.lights.has(id))
    if (ids.length > 0) this.onManualChange?.(ids, kind)
  }

  public setRemoteMode(on: boolean): void {
    if (this.remoteMode === on) return
    this.remoteMode = on
    if (this.isInitialized) this.reloadDevices()
  }

  public isRemoteMode(): boolean {
    return this.remoteMode
  }

  public markAllManual(kind: 'power' | 'state' = 'state'): void {
    this.markManual(Array.from(this.lights.keys()), kind)
  }

  public async init(isDemo: boolean = false): Promise<void> {
    this.isDemoMode = isDemo
    this.isInitialized = true

    if (this.remoteMode) {
      this.loadDevices([], false)
      return
    }

    if (this.isDemoMode) {
      console.log('[Lumos LightManager] Initializing in DEMO mode with simulated accessories')
      this.loadDevices(DEMO_DEVICES, true)
      return
    }

    const devices = loadDevicesConfig()
    // Lights pick up an address that changed since last time from the ARP table, read once for all of them
    if (devices.some((d) => d.mac)) await getArpTable()
    this.loadDevices(devices, false)
  }

  public setDemoMode(enable: boolean): void {
    this.isDemoMode = enable
    if (enable) {
      this.loadDevices(DEMO_DEVICES, true)
    } else {
      const devices = loadDevicesConfig()
      this.loadDevices(devices, false)
    }
  }

  public getIsDemoMode(): boolean {
    return this.isDemoMode
  }

  public reloadDevices(): void {
    if (this.remoteMode) {
      this.loadDevices([], false)
    } else if (this.isDemoMode) {
      this.loadDevices(DEMO_DEVICES, true)
    } else {
      const devices = loadDevicesConfig()
      this.loadDevices(devices, false)
    }
  }

  public loadDevices(devices: TinyTuyaDevice[], isDemo: boolean = false): void {
    // Clean up existing
    for (const light of this.lights.values()) {
      light.disconnect()
    }
    this.lights.clear()

    const detectedTable: Array<{
      Name: string
      IP: string
      Version: string
      PowerDPS: number
      BrightnessDPS: string
      ColorTempDPS: string
      HasColor: boolean
      HasScenes: boolean
      HasCountdown: boolean
    }> = []

    for (const device of devices) {
      if (!device.id || !device.key) {
        console.warn(`[Lumos LightManager] Skipping invalid device entry:`, device)
        continue
      }

      const light = new Light(
        device,
        (state) => {
          this.onStateBroadcast(state)
          this.syncAnnouncements()
        },
        isDemo
      )

      this.lights.set(device.id, light)

      detectedTable.push({
        Name: light.name,
        IP: light.ip || 'Auto (Resolving)',
        Version: light.version,
        PowerDPS: light.dpsMap.power,
        BrightnessDPS: `${light.dpsMap.brightness} (${light.dpsMap.minBrightness}-${light.dpsMap.maxBrightness})`,
        ColorTempDPS: `${light.dpsMap.colorTemp} (${light.dpsMap.minColorTemp}-${light.dpsMap.maxColorTemp})`,
        HasColor: light.capabilities.hasColor,
        HasScenes: light.capabilities.hasScenes,
        HasCountdown: light.capabilities.hasCountdown
      })

      light.connect()
    }

    this.syncAnnouncements()

    this.onLightsLoaded?.()

    if (detectedTable.length > 0) {
      console.log(`\n[Lumos] ${isDemo ? 'Demo' : 'Detected'} Lights:`)
      console.table(detectedTable)
      console.log(`[Lumos] Total lights managed: ${detectedTable.length}\n`)
    } else {
      console.warn('[Lumos] No lights loaded.')
    }
  }

  /** Retries every offline light now, searching for any whose address changed. */
  public async reconnectOffline(): Promise<number> {
    const offline = Array.from(this.lights.values()).filter((l) => !l.isConnected && !l.isDemo)
    await Promise.all(offline.map((l) => l.reconnectNow().catch(() => {})))
    return offline.length
  }

  public getAllStates(): NormalizedLightState[] {
    return Array.from(this.lights.values()).map((l) => l.getState())
  }

  public getAllLights(): Light[] {
    return Array.from(this.lights.values())
  }

  public getLight(id: string): Light | undefined {
    return this.lights.get(id)
  }

  public async toggleLight(id: string): Promise<boolean> {
    const light = this.lights.get(id)
    if (!light) return false
    return light.toggle()
  }

  public async setPower(id: string, on: boolean): Promise<boolean> {
    const light = this.lights.get(id)
    if (!light) return false
    return light.setPower(on)
  }

  public async setBrightness(id: string, value: number): Promise<boolean> {
    const light = this.lights.get(id)
    if (!light) return false
    return light.setBrightness(value)
  }

  public async setColorTemp(id: string, value: number): Promise<boolean> {
    const light = this.lights.get(id)
    if (!light) return false
    return light.setColorTemp(value)
  }

  public async setColor(id: string, h: number, s: number, v?: number): Promise<boolean> {
    const light = this.lights.get(id)
    if (!light) return false
    return light.setColor(h, s, v)
  }

  public async applyPresetState(
    id: string,
    params: {
      power?: boolean
      mode: 'white' | 'colour'
      brightness: number
      colorTemp?: number
      color?: { h: number; s: number; v?: number }
    }
  ): Promise<boolean> {
    const light = this.lights.get(id)
    if (!light) return false
    return light.applyPresetState(params)
  }

  public async setWorkMode(id: string, mode: 'white' | 'colour' | 'scene' | 'music'): Promise<boolean> {
    const light = this.lights.get(id)
    if (!light) return false
    return light.setWorkMode(mode)
  }

  public async setScene(id: string, sceneNum: number): Promise<boolean> {
    const light = this.lights.get(id)
    if (!light) return false
    return light.setScene(sceneNum)
  }

  public async setCountdown(id: string, seconds: number): Promise<boolean> {
    const light = this.lights.get(id)
    if (!light) return false
    return light.setCountdown(seconds)
  }

  public async setAll(on: boolean): Promise<boolean[]> {
    const promises = Array.from(this.lights.values()).map((light) => light.setPower(on))
    return Promise.all(promises)
  }

  public async setGroupPower(deviceIds: string[], on: boolean): Promise<boolean[]> {
    const promises = deviceIds
      .map((id) => this.lights.get(id))
      .filter((l): l is Light => Boolean(l))
      .map((light) => light.setPower(on))
    return Promise.all(promises)
  }

  public async setGroupBrightness(deviceIds: string[], value: number): Promise<boolean[]> {
    const promises = deviceIds
      .map((id) => this.lights.get(id))
      .filter((l): l is Light => Boolean(l))
      .map((light) => light.setBrightness(value))
    return Promise.all(promises)
  }

  public async setGroupColorTemp(deviceIds: string[], value: number): Promise<boolean[]> {
    const promises = deviceIds
      .map((id) => this.lights.get(id))
      .filter((l): l is Light => Boolean(l))
      .map((light) => light.setColorTemp(value))
    return Promise.all(promises)
  }

  public disconnectAll(): void {
    announcements.stop()
    for (const light of this.lights.values()) {
      light.disconnect()
    }
    this.lights.clear()
  }
}
