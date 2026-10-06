import { EventEmitter } from 'events'
import TuyAPI from 'tuyapi'
import { resolveIpFromMac } from './arp'
import {
  TinyTuyaDevice,
  NormalizedLightState,
  DPSConfig,
  DEFAULT_DPS,
  DeviceCapabilities,
  ColorHS
} from '../types'
import { latencyTracker } from '../latency'
import { updatePersistedDeviceIp } from '../config'
import { LightOutput, OutputField, changedFields, quantize } from '../effects/output'

export class Light extends EventEmitter {
  public id: string
  public name: string
  public ip?: string
  public mac?: string
  public key: string
  public version: string
  public dpsMap: DPSConfig
  public capabilities: DeviceCapabilities
  public isDemo: boolean = false

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private tuya!: any
  private onStateChange?: (state: NormalizedLightState) => void

  public isConnected = false
  private isFinding = false
  private hasReceivedData = false
  private connectAttemptsWithCurrentVersion = 0
  private retryTimer: NodeJS.Timeout | null = null
  private retryBackoffMs = 1000
  private readonly maxBackoffMs = 15000
  private isDestroyed = false

  // Command coalescing queue
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private pendingDps: Record<string, any> = {}
  private isFlushInFlight = false

  // Output tracking. The fields below (power, brightness, ...) hold the base
  // state, which is the user's intent. What the bulb is actually told to show
  // can differ while effects are active, so it is tracked separately here.
  public lastSentOutput: LightOutput | null = null
  private forcedFields = new Set<OutputField>()
  /** When set, base state changes are routed through the compositor. */
  public outputSink?: (light: Light) => Promise<boolean>
  /** Device reports before this time are echoes of effect output, not user changes. */
  public suppressReportsUntil = 0
  /** Label of the effect currently shaping this light's output, if any. */
  public activeEffect?: string

  // Current internal state
  public power = false
  public brightness = 100 // 0-100 normalized
  public colorTemp = 50 // 0-100 normalized
  public color: ColorHS = { h: 0, s: 0, v: 100 }
  public mode = 'white'
  public scene = 1
  public countdown = 0
  public lastSeen = Date.now()

  // App-level customization
  public customName?: string
  public room?: string
  public order?: number
  public hidden?: boolean

  constructor(device: TinyTuyaDevice, onStateChange?: (state: NormalizedLightState) => void, isDemo: boolean = false) {
    super()
    this.id = device.id
    this.name = device.name || `Light (${device.id.slice(-4)})`
    this.key = device.key
    this.mac = device.mac
    this.isDemo = isDemo || device.id.startsWith('demo-')

    const rawIp = (device.ip || '').trim()
    let initialIp = rawIp.toLowerCase() === 'auto' ? '' : rawIp

    // If MAC is known, check ARP table first. ARP is authoritative for physical devices on LAN.
    if (this.mac && !this.isDemo) {
      const arpIp = resolveIpFromMac(this.mac)
      if (arpIp) {
        if (initialIp && initialIp !== arpIp) {
          console.log(`[Lumos Light ${this.name}] Active ARP IP (${arpIp}) replaces configured IP (${initialIp}) for MAC ${this.mac}`)
        } else {
          console.log(`[Lumos Light ${this.name}] Resolved LAN IP from ARP table: ${arpIp} (MAC: ${this.mac})`)
        }
        initialIp = arpIp
      }
    }
    this.ip = initialIp

    const ver = device.version || device.ver
    this.version = ver ? String(ver) : '3.5'

    this.onStateChange = onStateChange
    const { dps, capabilities } = this.deriveDPS(device)
    this.dpsMap = dps
    this.capabilities = capabilities

    if (!this.isDemo) {
      this.initTuyaClient()
    }
  }

  private deriveDPS(device: TinyTuyaDevice): { dps: DPSConfig; capabilities: DeviceCapabilities } {
    const dps = { ...DEFAULT_DPS, ...(device.dps || {}) }

    let hasColorCode = false
    let hasWorkModeRangeColor = false
    let hasSceneCode = false
    let hasCountdownCode = false
    let hasPowerCode = false
    let hasBrightnessCode = false
    let hasColorTempCode = false

    if (device.mapping && typeof device.mapping === 'object') {
      for (const [dpIdStr, entry] of Object.entries(device.mapping)) {
        const dpId = parseInt(dpIdStr, 10)
        if (isNaN(dpId) || !entry || !entry.code) continue

        const code = entry.code.toLowerCase()

        if (code === 'switch_led' || code === 'switch' || code === 'led_switch') {
          dps.power = dpId
          hasPowerCode = true
        } else if (code === 'work_mode' || code === 'mode') {
          dps.mode = dpId
          if (entry.values?.range && Array.isArray(entry.values.range)) {
            if (entry.values.range.includes('colour') || entry.values.range.includes('color')) {
              hasWorkModeRangeColor = true
            }
          }
        } else if (code === 'bright_value_v2' || code === 'bright_value' || code === 'brightness') {
          dps.brightness = dpId
          hasBrightnessCode = true
          if (entry.values?.min !== undefined) dps.minBrightness = Number(entry.values.min)
          if (entry.values?.max !== undefined) dps.maxBrightness = Number(entry.values.max)
        } else if (code === 'temp_value_v2' || code === 'temp_value' || code === 'temp') {
          dps.colorTemp = dpId
          hasColorTempCode = true
          if (entry.values?.min !== undefined) dps.minColorTemp = Number(entry.values.min)
          if (entry.values?.max !== undefined) dps.maxColorTemp = Number(entry.values.max)
        } else if (code === 'colour_data_v2' || code === 'colour_data' || code === 'color_data') {
          dps.color = dpId
          hasColorCode = true
        } else if (code === 'scene_data_v2' || code === 'scene_data' || code === 'scene') {
          dps.scene = dpId
          hasSceneCode = true
        } else if (code === 'countdown_1' || code === 'countdown') {
          dps.countdown = dpId
          hasCountdownCode = true
        }
      }
    }

    const capabilities: DeviceCapabilities = {
      hasPower: hasPowerCode || dps.power !== undefined,
      hasBrightness: hasBrightnessCode || dps.brightness !== undefined,
      hasColorTemp: hasColorTempCode || dps.colorTemp !== undefined,
      hasColor: Boolean(hasColorCode && hasWorkModeRangeColor),
      hasScenes: Boolean(hasSceneCode),
      hasCountdown: Boolean(hasCountdownCode)
    }

    return { dps, capabilities }
  }

  private initTuyaClient(): void {
    try {
      if (this.tuya) {
        try {
          this.tuya.removeAllListeners()
          this.tuya.disconnect()
        } catch {
          // ignore disconnect error
        }
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tuyaOptions: any = {
        id: this.id,
        key: this.key,
        version: this.version,
        issueGetOnConnect: false,
        nullPayloadOnJSONError: true
      }

      if (this.ip) {
        tuyaOptions.ip = this.ip
      }

      this.tuya = new TuyAPI(tuyaOptions)

      this.tuya.on('connected', () => {
        console.log(`[Lumos Light ${this.name}] Connected (v${this.version}) to ${this.ip}!`)
        this.isConnected = true
        this.retryBackoffMs = 1000
        this.clearRetryTimer()
        this.lastSeen = Date.now()

        // Persist verified working IP so subsequent launches connect immediately
        if (this.ip && !this.isDemo) {
          updatePersistedDeviceIp(this.id, this.ip)
        }

        // Enable TCP_NODELAY to bypass Nagle algorithm latency
        try {
          if (this.tuya?._client && typeof this.tuya._client.setNoDelay === 'function') {
            this.tuya._client.setNoDelay(true)
          }
          if (this.tuya?._socket && typeof this.tuya._socket.setNoDelay === 'function') {
            this.tuya._socket.setNoDelay(true)
          }
        } catch {
          // ignore socket flag error
        }

        this.emitState()

        setTimeout(async () => {
          if (this.isConnected && this.tuya) {
            try {
              const res = await this.tuya.get({ schema: true })
              if (res) {
                this.handleTuyaData(res)
              }
            } catch {
              // Non-fatal if initial status query times out
            }
            // Lets the compositor resend effect output the bulb lost while offline
            this.emit('online')
          }
        }, 120)
      })

      this.tuya.on('disconnected', () => {
        this.isConnected = false
        console.log(`[Lumos Light ${this.name}] Disconnected.`)

        this.emitState()
        this.scheduleReconnect()
      })

      this.tuya.on('error', (err: unknown) => {
        const msg = String((err as any)?.message || err || '')
        if (msg.includes('Timeout waiting for status response')) {
          return
        }

        if (!this.tuya || !this.tuya.isConnected()) {
          this.isConnected = false
          this.emitState()
          this.scheduleReconnect()
        }
      })

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.tuya.on('data', (data: any) => {
        this.hasReceivedData = true
        this.lastSeen = Date.now()
        this.handleTuyaData(data)
      })

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.tuya.on('dp-refresh', (data: any) => {
        this.hasReceivedData = true
        this.lastSeen = Date.now()
        this.handleTuyaData(data)
      })
    } catch (err) {
      console.error(`[Lumos Light ${this.name}] Init error:`, err)
    }
  }

  public async connect(): Promise<void> {
    if (this.isDestroyed || this.isConnected) return
    this.clearRetryTimer()

    if (this.isDemo) {
      this.isConnected = true
      this.lastSeen = Date.now()
      this.emitState()
      return
    }

    try {
      if (this.mac) {
        const arpIp = resolveIpFromMac(this.mac)
        if (arpIp && arpIp !== this.ip) {
          console.log(`[Lumos Light ${this.name}] Target IP updated via ARP: ${this.ip} -> ${arpIp}`)
          this.ip = arpIp
          updatePersistedDeviceIp(this.id, this.ip)
          this.initTuyaClient()
        }
      }

      if (!this.ip) {
        if (this.mac) {
          const arpIp = resolveIpFromMac(this.mac)
          if (arpIp) {
            this.ip = arpIp
            console.log(`[Lumos Light ${this.name}] Resolved LAN IP from ARP: ${this.ip}`)
            updatePersistedDeviceIp(this.id, this.ip)
            this.initTuyaClient()
          }
        }

        if (!this.ip && !this.isFinding) {
          this.isFinding = true
          try {
            await this.tuya.find({ timeout: 4 })
            if (this.tuya.device?.ip) {
              const discoveredIp: string = this.tuya.device.ip
              this.ip = discoveredIp
              console.log(`[Lumos Light ${this.name}] Discovered IP via TuyAPI: ${this.ip}`)
              updatePersistedDeviceIp(this.id, discoveredIp)
              this.initTuyaClient()
            }
          } catch {
            // discovery timeout
          } finally {
            this.isFinding = false
          }
        }
      }

      if (!this.ip) {
        this.scheduleReconnect()
        return
      }

      this.connectAttemptsWithCurrentVersion++
      await this.tuya.connect()
    } catch {
      this.scheduleReconnect()
    }
  }

  private scheduleReconnect(): void {
    if (this.isDestroyed || this.isDemo || this.retryTimer !== null) return

    this.retryTimer = setTimeout(async () => {
      this.retryTimer = null
      if (this.isDestroyed || this.isConnected) return

      try {
        if (this.mac) {
          const arpIp = resolveIpFromMac(this.mac)
          if (arpIp && arpIp !== this.ip) {
            console.log(`[Lumos Light ${this.name}] Reconnect detected new IP via ARP: ${this.ip} -> ${arpIp}`)
            this.ip = arpIp
            updatePersistedDeviceIp(this.id, this.ip)
            this.initTuyaClient()
          }
        }

        if (!this.ip) {
          if (this.mac) {
            const arpIp = resolveIpFromMac(this.mac)
            if (arpIp) {
              this.ip = arpIp
              updatePersistedDeviceIp(this.id, this.ip)
              this.initTuyaClient()
            }
          }

          if (!this.ip && !this.isFinding) {
            this.isFinding = true
            try {
              await this.tuya.find({ timeout: 4 })
              if (this.tuya.device?.ip) {
                const discoveredIp: string = this.tuya.device.ip
                this.ip = discoveredIp
                updatePersistedDeviceIp(this.id, discoveredIp)
                this.initTuyaClient()
              }
            } catch {
              // discovery timeout
            } finally {
              this.isFinding = false
            }
          }
        }

        if (this.ip) {
          this.initTuyaClient()
          await this.tuya.connect()
        } else {
          this.retryBackoffMs = Math.min(this.retryBackoffMs * 2, this.maxBackoffMs)
          this.scheduleReconnect()
        }
      } catch {
        this.retryBackoffMs = Math.min(this.retryBackoffMs * 2, this.maxBackoffMs)
        this.scheduleReconnect()
      }
    }, this.retryBackoffMs)
  }

  private clearRetryTimer(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer)
      this.retryTimer = null
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private handleTuyaData(data: any): void {
    if (!data || !data.dps) return
    // While effects drive the bulb, its reports echo effect output and must not
    // overwrite the base state the user set.
    if (Date.now() < this.suppressReportsUntil) return

    const dps = data.dps
    let stateChanged = false

    if (this.dpsMap.power.toString() in dps) {
      this.power = Boolean(dps[this.dpsMap.power.toString()])
      stateChanged = true
    }

    if (this.dpsMap.mode.toString() in dps) {
      this.mode = String(dps[this.dpsMap.mode.toString()])
      stateChanged = true
    }

    if (this.dpsMap.brightness.toString() in dps) {
      const rawBri = Number(dps[this.dpsMap.brightness.toString()])
      this.brightness = this.denormalizeBrightness(rawBri)
      stateChanged = true
    }

    if (this.dpsMap.colorTemp.toString() in dps) {
      const rawTemp = Number(dps[this.dpsMap.colorTemp.toString()])
      this.colorTemp = this.denormalizeColorTemp(rawTemp)
      stateChanged = true
    }

    if (this.dpsMap.color && this.dpsMap.color.toString() in dps) {
      try {
        const rawColor = dps[this.dpsMap.color.toString()]
        if (typeof rawColor === 'string' && /^[0-9a-fA-F]{12}$/.test(rawColor)) {
          const hRaw = parseInt(rawColor.slice(0, 4), 16)
          const sRaw = parseInt(rawColor.slice(4, 8), 16)
          const vRaw = parseInt(rawColor.slice(8, 12), 16)
          const h = Math.round(Math.max(0, Math.min(360, hRaw)))
          const s = Math.round(Math.max(0, Math.min(100, sRaw / 10)))
          const v = Math.round(Math.max(0, Math.min(100, vRaw / 10)))
          this.color = { h, s, v }
          if (this.mode === 'colour') this.brightness = v
          stateChanged = true
        } else {
          const parsed = typeof rawColor === 'string' ? JSON.parse(rawColor) : rawColor
          if (parsed && typeof parsed === 'object') {
            const h = typeof parsed.h === 'number' ? parsed.h : this.color.h
            const s = typeof parsed.s === 'number' ? Math.round(parsed.s > 100 ? parsed.s / 10 : parsed.s) : this.color.s
            const v = typeof parsed.v === 'number' ? Math.round(parsed.v > 100 ? parsed.v / 10 : parsed.v) : (this.color.v || this.brightness)
            this.color = { h, s, v }
            stateChanged = true
          }
        }
      } catch {
        // ignore parse error
      }
    }

    if (this.dpsMap.scene && this.dpsMap.scene.toString() in dps) {
      try {
        const rawScene = dps[this.dpsMap.scene.toString()]
        const parsed = typeof rawScene === 'string' ? JSON.parse(rawScene) : rawScene
        if (parsed && typeof parsed.scene_num === 'number') {
          this.scene = parsed.scene_num
          stateChanged = true
        } else if (typeof rawScene === 'number') {
          this.scene = rawScene
          stateChanged = true
        }
      } catch {
        // ignore
      }
    }

    if (this.dpsMap.countdown && this.dpsMap.countdown.toString() in dps) {
      this.countdown = Number(dps[this.dpsMap.countdown.toString()]) || 0
      stateChanged = true
    }

    if (stateChanged) {
      // The device just reported what it shows, so later diffs start from it.
      this.lastSentOutput = quantize(this.baseOutput())
      this.emit('output', this.lastSentOutput)
      this.emitState()
    }
  }

  public denormalizeBrightness(raw: number): number {
    const min = this.dpsMap.minBrightness
    const max = this.dpsMap.maxBrightness
    const clamped = Math.max(min, Math.min(max, raw))
    return Math.round(((clamped - min) / (max - min)) * 100)
  }

  public normalizeBrightness(normalized: number): number {
    const min = this.dpsMap.minBrightness
    const max = this.dpsMap.maxBrightness
    const clamped = Math.max(0, Math.min(100, normalized))
    return Math.round(min + (clamped / 100) * (max - min))
  }

  public denormalizeColorTemp(raw: number): number {
    const min = this.dpsMap.minColorTemp
    const max = this.dpsMap.maxColorTemp
    const clamped = Math.max(min, Math.min(max, raw))
    return Math.round(((clamped - min) / (max - min)) * 100)
  }

  public normalizeColorTemp(normalized: number): number {
    const min = this.dpsMap.minColorTemp
    const max = this.dpsMap.maxColorTemp
    const clamped = Math.max(0, Math.min(100, normalized))
    return Math.round(min + (clamped / 100) * (max - min))
  }

  public getState(): NormalizedLightState {
    return {
      id: this.id,
      name: this.name,
      ip: this.ip || (this.isDemo ? '192.0.2.10' : 'Auto (Resolving...)'),
      online: this.isConnected,
      power: this.power,
      brightness: this.brightness,
      colorTemp: this.colorTemp,
      color: this.color,
      mode: this.mode,
      scene: this.scene,
      countdown: this.countdown,
      lastSeen: this.lastSeen,
      capabilities: this.capabilities,
      customName: this.customName,
      room: this.room,
      order: this.order,
      hidden: this.hidden,
      effect: this.activeEffect
    }
  }

  public emitState(): void {
    const state = this.getState()
    this.emit('change', state)
    if (this.onStateChange) {
      this.onStateChange(state)
    }
  }

  private async flushPendingDps(): Promise<boolean> {
    if (this.isDemo) {
      this.pendingDps = {}
      latencyTracker.record('set_batch', this.id, 12)
      return true
    }

    if (this.isFlushInFlight || !this.isConnected || !this.tuya) return false
    this.isFlushInFlight = true

    try {
      while (Object.keys(this.pendingDps).length > 0) {
        const batch = { ...this.pendingDps }
        this.pendingDps = {}

        const startTime = performance.now()
        await this.tuya.set({
          multiple: true,
          data: batch,
          shouldWaitForResponse: false
        })
        const duration = performance.now() - startTime
        latencyTracker.record('set_batch', this.id, duration)
      }
      return true
    } catch (err) {
      console.error(`[Lumos Light ${this.name}] Flush error:`, err)
      return false
    } finally {
      this.isFlushInFlight = false
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public async queueDpsUpdate(updates: Record<string, any>): Promise<boolean> {
    Object.assign(this.pendingDps, updates)
    return this.flushPendingDps()
  }

  /** The output that represents the base state alone, with no effects applied. */
  public baseOutput(): LightOutput {
    const mode =
      this.mode === 'colour' || this.mode === 'scene' || this.mode === 'music' ? this.mode : 'white'
    const brightness = mode === 'colour' ? (this.color.v ?? this.brightness) : this.brightness
    return {
      power: this.power,
      mode,
      brightness,
      colorTemp: this.colorTemp,
      h: this.color.h,
      s: this.color.s,
      scene: mode === 'scene' ? this.scene : undefined
    }
  }

  /**
   * Sends an output to the bulb. Only fields that differ from what the bulb
   * last received are sent, plus any fields a base state change marked as
   * required. Colour outputs on white-only bulbs become white at the same level.
   */
  public async sendOutput(target: LightOutput): Promise<boolean> {
    const next = quantize(this.adaptToCapabilities(target))
    const prev = this.lastSentOutput
    const fields = prev ? changedFields(prev, next) : new Set<OutputField>()
    for (const f of this.forcedFields) fields.add(f)
    this.forcedFields.clear()

    if (fields.size === 0) return true
    if (!this.isConnected && !this.isDemo) return false

    this.lastSentOutput = next
    this.emit('output', next)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dps: Record<string, any> = {}
    const key = (n: number): string => n.toString()

    if (fields.has('power')) dps[key(this.dpsMap.power)] = next.power
    if (!next.power) {
      return Object.keys(dps).length > 0 ? this.queueDpsUpdate(dps) : true
    }

    const modeChanged = fields.has('mode')
    if (next.mode === 'colour') {
      if (modeChanged) dps[key(this.dpsMap.mode)] = 'colour'
      if (modeChanged || fields.has('color') || fields.has('brightness')) {
        dps[key(this.dpsMap.color)] = this.encodeColour(next.h, next.s, next.brightness)
      }
    } else if (next.mode === 'white') {
      if (modeChanged) dps[key(this.dpsMap.mode)] = 'white'
      if (modeChanged || fields.has('brightness')) {
        dps[key(this.dpsMap.brightness)] = this.normalizeBrightness(next.brightness)
      }
      if (this.capabilities.hasColorTemp && (modeChanged || fields.has('colorTemp'))) {
        dps[key(this.dpsMap.colorTemp)] = this.normalizeColorTemp(next.colorTemp)
      }
    } else if (next.mode === 'scene') {
      if (modeChanged || fields.has('scene')) {
        dps[key(this.dpsMap.scene)] = JSON.stringify(this.buildScenePayload(next.scene ?? 1))
        dps[key(this.dpsMap.mode)] = 'scene'
      }
    } else if (modeChanged) {
      dps[key(this.dpsMap.mode)] = next.mode
    }

    if (Object.keys(dps).length === 0) return true
    return this.queueDpsUpdate(dps)
  }

  private adaptToCapabilities(o: LightOutput): LightOutput {
    if (o.mode === 'colour' && !this.capabilities.hasColor) {
      // Pick the white temperature closest to the requested colour's warmth.
      if (o.s < 15) return { ...o, mode: 'white' }
      const colorTemp = o.h < 70 || o.h > 300 ? 0 : o.h > 160 && o.h < 260 ? 100 : 50
      return { ...o, mode: 'white', colorTemp }
    }
    if (o.mode === 'scene' && !this.capabilities.hasScenes) return { ...o, mode: 'white' }
    return o
  }

  private encodeColour(h: number, s: number, v: number): string {
    const hexH = Math.max(0, Math.min(360, Math.round(h))).toString(16).padStart(4, '0')
    const hexS = Math.round(Math.max(0, Math.min(100, s)) * 10).toString(16).padStart(4, '0')
    const hexV = Math.round(Math.max(0, Math.min(100, v)) * 10).toString(16).padStart(4, '0')
    return `${hexH}${hexS}${hexV}`.toLowerCase()
  }

  private buildScenePayload(sceneNum: number): Record<string, unknown> {
    return {
      scene_num: sceneNum,
      scene_units: [
        {
          bright: 1000,
          temperature: 500,
          h: 0,
          s: 0,
          v: 0,
          unit_change_mode: 'gradient',
          unit_switch_duration: 15,
          unit_gradient_duration: 15
        }
      ]
    }
  }

  /** Applies a base state change: through the compositor if attached, otherwise directly. */
  private commit(...fields: OutputField[]): Promise<boolean> {
    for (const f of fields) this.forcedFields.add(f)
    if (!this.isConnected && !this.isDemo) {
      this.forcedFields.clear()
      return Promise.resolve(false)
    }
    if (this.outputSink) return this.outputSink(this)
    return this.sendOutput(this.baseOutput())
  }

  public hasForcedFields(): boolean {
    return this.forcedFields.size > 0
  }

  /** Forgets what the bulb last received so the next output is sent in full. */
  public invalidateOutput(): void {
    this.lastSentOutput = null
    this.forcedFields.add('power')
    this.forcedFields.add('mode')
    this.forcedFields.add('brightness')
    this.forcedFields.add('colorTemp')
    this.forcedFields.add('color')
  }

  public async toggle(): Promise<boolean> {
    return this.setPower(!this.power)
  }

  public async setPower(on: boolean): Promise<boolean> {
    this.power = on
    this.emitState()
    return this.commit('power')
  }

  public async setBrightness(normalizedValue: number): Promise<boolean> {
    const targetBri = Math.max(0, Math.min(100, normalizedValue))
    const fields: OutputField[] = []

    this.brightness = targetBri
    if (this.mode === 'colour') {
      // Dimming a colour keeps the colour rather than switching to white.
      this.color = { ...this.color, v: targetBri }
      fields.push('color')
    } else {
      if (this.mode !== 'white') {
        this.mode = 'white'
        fields.push('mode')
      }
      fields.push('brightness')
    }
    if (!this.power && targetBri > 0) {
      this.power = true
      fields.push('power')
    }
    this.emitState()
    return this.commit(...fields)
  }

  public async setColorTemp(normalizedValue: number): Promise<boolean> {
    this.colorTemp = Math.max(0, Math.min(100, normalizedValue))
    this.mode = 'white'
    this.emitState()
    return this.commit('mode', 'colorTemp')
  }

  public async setColor(h: number, s: number, v?: number): Promise<boolean> {
    if (!this.capabilities.hasColor) return false
    const clampedH = Math.max(0, Math.min(360, Math.round(h)))
    const clampedS = Math.max(0, Math.min(100, Math.round(s)))
    const clampedV = Math.max(0, Math.min(100, Math.round(v ?? this.brightness)))
    const fields: OutputField[] = ['mode', 'color']

    this.color = { h: clampedH, s: clampedS, v: clampedV }
    this.brightness = clampedV
    this.mode = 'colour'
    if (!this.power && clampedV > 0) {
      this.power = true
      fields.push('power')
    }
    this.emitState()
    return this.commit(...fields)
  }

  public async setWorkMode(mode: 'white' | 'colour' | 'scene' | 'music'): Promise<boolean> {
    this.mode = mode
    this.emitState()
    return this.commit('mode')
  }

  public async setScene(sceneNum: number): Promise<boolean> {
    if (!this.capabilities.hasScenes) return false
    this.scene = sceneNum
    this.mode = 'scene'
    this.emitState()
    return this.commit('mode', 'scene')
  }

  public async setCountdown(seconds: number): Promise<boolean> {
    if (!this.capabilities.hasCountdown) return false
    const clampedSec = Math.max(0, Math.min(86400, Math.round(seconds)))
    this.countdown = clampedSec
    this.emitState()

    if (this.isDemo) {
      latencyTracker.record('set_countdown', this.id, 10)
      return true
    }

    if (!this.isConnected) return false

    try {
      await this.tuya.set({
        dps: this.dpsMap.countdown,
        set: clampedSec,
        shouldWaitForResponse: false
      })
      return true
    } catch (err) {
      console.error(`[Lumos Light ${this.name}] setCountdown error:`, err)
      return false
    }
  }

  public disconnect(): void {
    this.isDestroyed = true
    this.clearRetryTimer()
    if (!this.isDemo) {
      try {
        if (this.tuya) {
          this.tuya.disconnect()
        }
      } catch {
        // ignore disconnect error
      }
    }
    this.isConnected = false
    this.emitState()
  }
}