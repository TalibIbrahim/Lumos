import { Light } from './Light'
import { loadDevicesConfig } from '../config'
import { DEMO_DEVICES } from '../demo'
import { TinyTuyaDevice, NormalizedLightState } from '../types'

export class LightManager {
  private lights: Map<string, Light> = new Map()
  private onStateBroadcast: (state: NormalizedLightState) => void
  private isDemoMode = false
  private isInitialized = false

  constructor(onStateBroadcast: (state: NormalizedLightState) => void) {
    this.onStateBroadcast = onStateBroadcast
  }

  public async init(isDemo: boolean = false): Promise<void> {
    this.isDemoMode = isDemo
    this.isInitialized = true

    if (this.isDemoMode) {
      console.log('[Lumos LightManager] Initializing in DEMO mode with simulated accessories')
      this.loadDevices(DEMO_DEVICES, true)
      return
    }

    const devices = loadDevicesConfig()
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
    if (this.isDemoMode) {
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

    if (detectedTable.length > 0) {
      console.log(`\n[Lumos] ${isDemo ? 'Demo' : 'Detected'} Lights:`)
      console.table(detectedTable)
      console.log(`[Lumos] Total lights managed: ${detectedTable.length}\n`)
    } else {
      console.warn('[Lumos] No lights loaded.')
    }
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
    for (const light of this.lights.values()) {
      light.disconnect()
    }
    this.lights.clear()
  }
}
