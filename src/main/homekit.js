import './cryptoPolyfill.js'
import { app } from 'electron'
import path from 'path'
import fs from 'fs'
import os from 'os'
import util from 'util'
import debug from 'debug'
import QRCode from 'qrcode'

// Enable diagnostic logging for HAP-NodeJS and Ciao
process.env.DEBUG = process.env.DEBUG || 'HAP-NodeJS*,@homebridge/ciao*'
debug.enable('HAP-NodeJS*,@homebridge/ciao*')

let debugLogFile = null
function setupDebugLogging(storagePath) {
  if (debugLogFile) return
  try {
    debugLogFile = path.join(storagePath, 'hap-debug.log')
    const origLog = debug.log
    debug.log = (...args) => {
      const line = `[${new Date().toISOString()}] ${util.format(...args)}\n`
      try {
        fs.appendFileSync(debugLogFile, line)
      } catch {}
      origLog.apply(debug, args)
    }

    const origStderrWrite = process.stderr.write
    process.stderr.write = function (chunk, ...rest) {
      if (debugLogFile && chunk) {
        try {
          fs.appendFileSync(debugLogFile, chunk.toString())
        } catch {}
      }
      return origStderrWrite.call(process.stderr, chunk, ...rest)
    }
  } catch (err) {
    console.warn('[Lumos HomeKit] Could not initialize debug log stream:', err)
  }
}

// Dynamically require hap-nodejs so cryptoPolyfill is active before hap-nodejs initialization
const hap = require('hap-nodejs')
const {
  Bridge,
  Accessory,
  Service,
  Characteristic,
  HAPStorage,
  HapStatusError,
  uuid
} = hap

// HAP Constants
const HAP_SERVICE_COMMUNICATION_FAILURE = -70402
const HAP_CATEGORY_BRIDGE = 2
const HAP_EVENT_PAIRED = 'paired'
const HAP_EVENT_UNPAIRED = 'unpaired'

/**
 * Detects legitimate local LAN interfaces (Ethernet, Wi-Fi, Mobile Hotspot),
 * strictly excluding internal VM switches (Hyper-V / vEthernet, WSL, VMware, VirtualBox, loopback, bluetooth).
 */
export function detectLanInterfaces() {
  const ifaces = os.networkInterfaces()
  const valid = []
  for (const [name, list] of Object.entries(ifaces)) {
    if (!list) continue
    const lower = name.toLowerCase()
    if (
      lower.includes('vethernet') ||
      lower.includes('virtualbox') ||
      lower.includes('vmware') ||
      lower.includes('loopback') ||
      lower.includes('bluetooth') ||
      lower.includes('wsl')
    ) {
      continue
    }
    for (const info of list) {
      if (!info.internal && info.family === 'IPv4' && !info.address.startsWith('169.254.')) {
        valid.push(name)
        break
      }
    }
  }
  return valid
}

/**
 * Maps Lumos colorTemp (0-100, warm amber to cool daylight)
 * to HomeKit mireds (500-140, warm amber to cool daylight).
 */
export function lumosColorTempToMireds(cct) {
  const clamped = Math.max(0, Math.min(100, Number(cct) || 0))
  const mireds = Math.round(500 - (clamped / 100) * 360)
  return Math.max(140, Math.min(500, mireds))
}
export const lumenColorTempToMireds = lumosColorTempToMireds

/**
 * Maps HomeKit mireds (140-500) back to Lumos colorTemp (0-100).
 */
export function miredsToLumosColorTemp(mireds) {
  const clamped = Math.max(140, Math.min(500, Number(mireds) || 140))
  const cct = Math.round(((500 - clamped) / 360) * 100)
  return Math.max(0, Math.min(100, cct))
}
export const miredsToLumenColorTemp = miredsToLumosColorTemp

function generateMacUsername() {
  const hex = '0123456789ABCDEF'
  const parts = []
  for (let i = 0; i < 6; i++) {
    let part
    if (i === 0) {
      const high = hex[Math.floor(Math.random() * 16)]
      const low = ['2', '6', 'A', 'E'][Math.floor(Math.random() * 4)]
      part = `${high}${low}`
    } else {
      part = `${hex[Math.floor(Math.random() * 16)]}${hex[Math.floor(Math.random() * 16)]}`
    }
    parts.push(part)
  }
  return parts.join(':')
}

function generateRandomPincode() {
  // Generates valid HomeKit 8-digit pincode in XXX-XX-XXX format
  const part1 = Math.floor(100 + Math.random() * 899).toString()
  const part2 = Math.floor(10 + Math.random() * 89).toString()
  const part3 = Math.floor(100 + Math.random() * 899).toString()
  return `${part1}-${part2}-${part3}`
}

export class HomeKitManager {
  constructor() {
    this.bridge = null
    this.accessories = []
    this.lightManager = null
    this.config = null
    this.isInitialized = false
    this.storageInitialized = false
    this.storagePath = ''
    this.configFile = ''
  }

  setupStorage() {
    if (this.storageInitialized) return
    let userData = ''
    try {
      userData = app.getPath('userData')
    } catch {
      userData = path.join(process.cwd(), 'persist')
    }

    this.storagePath = path.join(userData, 'homekit')
    this.configFile = path.join(this.storagePath, 'bridge-config.json')

    if (!fs.existsSync(this.storagePath)) {
      fs.mkdirSync(this.storagePath, { recursive: true })
    }

    setupDebugLogging(this.storagePath)

    // Persist HAP storage under app.getPath('userData')/homekit
    HAPStorage.setCustomStoragePath(this.storagePath)
    this.storageInitialized = true
  }

  loadOrCreateConfig() {
    this.setupStorage()
    if (fs.existsSync(this.configFile)) {
      try {
        const raw = fs.readFileSync(this.configFile, 'utf-8')
        const data = JSON.parse(raw)
        if (data && data.username && data.pincode && data.port) {
          return data
        }
      } catch (err) {
        console.warn('[Lumos HomeKit] Could not read existing bridge config, generating new:', err)
      }
    }

    const newConfig = {
      username: generateMacUsername(),
      pincode: generateRandomPincode(),
      port: 51826
    }

    try {
      fs.writeFileSync(this.configFile, JSON.stringify(newConfig, null, 2), 'utf-8')
    } catch (err) {
      console.error('[Lumos HomeKit] Failed to save bridge config:', err)
    }

    return newConfig
  }

  async init(lightManager) {
    if (this.isInitialized) return
    this.setupStorage()
    this.lightManager = lightManager
    this.config = this.loadOrCreateConfig()

    await this.publishBridge()
    this.isInitialized = true
  }

  createAccessoryForLight(light) {
    const accessoryUuid = uuid.generate(`lumos-light-${light.id}`)
    const accessory = new Accessory(light.name, accessoryUuid)

    // Accessory Information
    const infoService = accessory.getService(Service.AccessoryInformation)
    if (infoService) {
      infoService
        .setCharacteristic(Characteristic.Manufacturer, 'Lumos')
        .setCharacteristic(Characteristic.Model, 'Lumos Tuya Light')
        .setCharacteristic(Characteristic.SerialNumber, light.id)
        .setCharacteristic(Characteristic.FirmwareRevision, light.version ? `v${light.version}` : '1.0.0')
    }

    // Lightbulb Service
    const service =
      accessory.getService(Service.Lightbulb) || accessory.addService(Service.Lightbulb, light.name)

    // Coalescing and throttling state per light
    let pendingOn = null
    let pendingBrightness = null
    let brightnessTimer = null

    const flushBrightnessAndPower = async () => {
      const bri = pendingBrightness
      const on = pendingOn
      pendingBrightness = null
      pendingOn = null

      if (on === false) {
        await light.setPower(false)
        return
      }

      if (bri !== null) {
        await light.setBrightness(bri)
        return
      }

      if (on === true) {
        await light.setPower(true)
      }
    }

    // Characteristic: On
    const onChar = service.getCharacteristic(Characteristic.On)
    if (onChar) {
      onChar
        .onGet(() => {
          const state = light.getState()
          if (!state.online) {
            throw new HapStatusError(HAP_SERVICE_COMMUNICATION_FAILURE)
          }
          return state.power
        })
        .onSet(async (value) => {
          const boolVal = Boolean(value)
          if (!boolVal) {
            if (brightnessTimer) {
              clearTimeout(brightnessTimer)
              brightnessTimer = null
            }
            pendingBrightness = null
            pendingOn = false
            await light.setPower(false)
          } else {
            pendingOn = true
            if (!brightnessTimer) {
              brightnessTimer = setTimeout(() => {
                brightnessTimer = null
                flushBrightnessAndPower()
              }, 60)
            }
          }
        })
    }

    // Characteristic: Brightness
    const briChar = service.getCharacteristic(Characteristic.Brightness)
    if (briChar) {
      briChar
        .onGet(() => {
          const state = light.getState()
          if (!state.online) {
            throw new HapStatusError(HAP_SERVICE_COMMUNICATION_FAILURE)
          }
          return state.brightness
        })
        .onSet(async (value) => {
          const numBri = Number(value)
          if (numBri === 0) {
            if (brightnessTimer) {
              clearTimeout(brightnessTimer)
              brightnessTimer = null
            }
            pendingBrightness = 0
            pendingOn = false
            await light.setPower(false)
          } else {
            pendingBrightness = numBri
            pendingOn = true
            if (brightnessTimer) {
              clearTimeout(brightnessTimer)
            }
            brightnessTimer = setTimeout(() => {
              brightnessTimer = null
              flushBrightnessAndPower()
            }, 60)
          }
        })
    }

    // Characteristic: Color & ColorTemperature Unified Batching
    let pendingHue = null
    let pendingSat = null
    let pendingColorTemp = null
    let lastTargetMode = null // 'colour' | 'white'
    let colorBatchTimer = null

    const flushColorBatch = async () => {
      colorBatchTimer = null

      if (lastTargetMode === 'colour') {
        const state = light.getState()
        const h = pendingHue !== null ? pendingHue : (state.color?.h ?? 0)
        const s = pendingSat !== null ? pendingSat : (state.color?.s ?? 100)
        pendingHue = null
        pendingSat = null
        pendingColorTemp = null
        lastTargetMode = null
        const bri = state.power ? (state.brightness || 100) : 100
        await light.setColor(h, s, bri)
      } else if (lastTargetMode === 'white' && pendingColorTemp !== null) {
        const ct = pendingColorTemp
        pendingHue = null
        pendingSat = null
        pendingColorTemp = null
        lastTargetMode = null
        await light.setColorTemp(ct)
      }
    }

    const scheduleColorBatch = () => {
      if (colorBatchTimer) {
        clearTimeout(colorBatchTimer)
      }
      colorBatchTimer = setTimeout(() => {
        flushColorBatch()
      }, 75)
    }

    // Characteristic: ColorTemperature (Mireds 140 - 500)
    const ctChar = service.getCharacteristic(Characteristic.ColorTemperature)
    if (ctChar) {
      ctChar
        .onGet(() => {
          const state = light.getState()
          if (!state.online) {
            throw new HapStatusError(HAP_SERVICE_COMMUNICATION_FAILURE)
          }
          return lumosColorTempToMireds(state.colorTemp)
        })
        .onSet(async (value) => {
          const mireds = Number(value)
          const lumosCT = miredsToLumosColorTemp(mireds)
          pendingColorTemp = lumosCT
          if (lastTargetMode !== 'colour') {
            lastTargetMode = 'white'
          }
          scheduleColorBatch()
        })
    }

    // Characteristic: Hue & Saturation (if bulb supports color)
    if (light.capabilities && light.capabilities.hasColor) {
      const hueChar = service.getCharacteristic(Characteristic.Hue) || service.addCharacteristic(Characteristic.Hue)
      hueChar
        .onGet(() => {
          const state = light.getState()
          if (!state.online) {
            throw new HapStatusError(HAP_SERVICE_COMMUNICATION_FAILURE)
          }
          return state.color ? state.color.h : 0
        })
        .onSet(async (value) => {
          pendingHue = Number(value)
          lastTargetMode = 'colour'
          scheduleColorBatch()
        })

      const satChar = service.getCharacteristic(Characteristic.Saturation) || service.addCharacteristic(Characteristic.Saturation)
      satChar
        .onGet(() => {
          const state = light.getState()
          if (!state.online) {
            throw new HapStatusError(HAP_SERVICE_COMMUNICATION_FAILURE)
          }
          return state.color ? state.color.s : 100
        })
        .onSet(async (value) => {
          pendingSat = Number(value)
          lastTargetMode = 'colour'
          scheduleColorBatch()
        })
    }

    // Listen to light's 'change' EventEmitter
    const changeListener = (state) => {
      service.updateCharacteristic(Characteristic.On, state.power)
      service.updateCharacteristic(Characteristic.Brightness, state.brightness)

      // Only update the active mode's characteristic to avoid Apple Home mode conflict
      if (state.mode === 'colour' && light.capabilities && light.capabilities.hasColor && state.color) {
        service.updateCharacteristic(Characteristic.Hue, state.color.h)
        service.updateCharacteristic(Characteristic.Saturation, state.color.s)
      } else {
        service.updateCharacteristic(Characteristic.ColorTemperature, lumosColorTempToMireds(state.colorTemp))
      }

      accessory.updateReachability(state.online)
    }

    light.on('change', changeListener)

    accessory._cleanUpListener = () => {
      light.removeListener('change', changeListener)
      if (brightnessTimer) clearTimeout(brightnessTimer)
      if (colorBatchTimer) clearTimeout(colorBatchTimer)
    }

    return accessory
  }

  async publishBridge() {
    if (!this.config || !this.lightManager) return

    const bridgeUuid = uuid.generate('lumos-bridge-root')
    this.bridge = new Bridge('Lumos', bridgeUuid)

    // Bridge Information
    const bridgeInfo = this.bridge.getService(Service.AccessoryInformation)
    if (bridgeInfo) {
      bridgeInfo
        .setCharacteristic(Characteristic.Manufacturer, 'Lumos')
        .setCharacteristic(Characteristic.Model, 'Lumos Bridge')
        .setCharacteristic(Characteristic.SerialNumber, this.config.username)
        .setCharacteristic(Characteristic.FirmwareRevision, '1.0.0')
    }

    this.bridge.on(HAP_EVENT_PAIRED, () => {
      console.log('[Lumos HomeKit] Bridge was successfully paired with Apple Home!')
    })

    this.bridge.on(HAP_EVENT_UNPAIRED, () => {
      console.log('[Lumos HomeKit] Bridge was unpaired from Apple Home.')
    })

    // Create accessories for all detected lights
    const lights = this.lightManager.getAllLights()
    this.accessories = []

    for (const light of lights) {
      const acc = this.createAccessoryForLight(light)
      this.accessories.push(acc)
      this.bridge.addBridgedAccessory(acc)
    }

    const lanIfaces = detectLanInterfaces()
    const bindOption = lanIfaces.length ? [...lanIfaces, '0.0.0.0'] : ['0.0.0.0']

    console.log(
      `[Lumos HomeKit] Publishing bridge "${this.bridge.displayName}" (${this.config.username}) with ${this.accessories.length} accessories on port ${this.config.port}...`
    )
    console.log(`[Lumos HomeKit] Binding interfaces: ${bindOption.join(', ')} (Advertiser: ciao)`)

    await this.bridge.publish({
      username: this.config.username,
      pincode: this.config.pincode,
      port: this.config.port,
      category: HAP_CATEGORY_BRIDGE,
      advertiser: 'ciao',
      bind: bindOption
    })

    console.log(`[Lumos HomeKit] Bridge published! Setup PIN: ${this.config.pincode}`)
  }

  async getHomeKitInfo() {
    const isPaired = Boolean(this.bridge?._accessoryInfo?.paired())
    const setupURI = this.bridge?.setupURI() || ''
    let qrCodeDataUrl = ''

    if (setupURI) {
      try {
        qrCodeDataUrl = await QRCode.toDataURL(setupURI, {
          errorCorrectionLevel: 'M',
          margin: 2,
          scale: 6
        })
      } catch (err) {
        console.error('[Lumos HomeKit] Failed generating QR code data URL:', err)
      }
    }

    return {
      isPaired,
      setupCode: this.config?.pincode || '',
      setupURI,
      qrCodeDataUrl,
      bridgeUsername: this.config?.username || '',
      port: this.config?.port || 51826,
      accessoryCount: this.accessories.length
    }
  }

  async resetHomeKit() {
    console.log('[Lumos HomeKit] Resetting HomeKit pairing and HAP storage...')

    // 1. Unpublish and destroy existing bridge
    if (this.bridge) {
      try {
        await this.bridge.unpublish()
        this.bridge.destroy()
      } catch (err) {
        console.warn('[Lumos HomeKit] Error unpublishing bridge during reset:', err)
      }
      this.bridge = null
    }

    // 2. Clean up light event listeners
    for (const acc of this.accessories) {
      const cleanup = acc._cleanUpListener
      if (typeof cleanup === 'function') {
        cleanup()
      }
    }
    this.accessories = []

    // 3. Clear storage directory (preserve hap-debug.log)
    if (fs.existsSync(this.storagePath)) {
      const files = fs.readdirSync(this.storagePath)
      for (const file of files) {
        if (file === 'hap-debug.log') continue
        try {
          fs.rmSync(path.join(this.storagePath, file), { recursive: true, force: true })
        } catch (err) {
          console.warn(`[Lumos HomeKit] Error clearing file ${file}:`, err)
        }
      }
    }

    // 4. Generate new MAC-style username and fresh random pincode for fresh pairing identity
    this.config = {
      username: generateMacUsername(),
      pincode: generateRandomPincode(),
      port: 51826
    }

    try {
      fs.writeFileSync(this.configFile, JSON.stringify(this.config, null, 2), 'utf-8')
    } catch (err) {
      console.error('[Lumos HomeKit] Failed saving updated bridge config:', err)
    }

    // 5. Rebuild and re-publish bridge
    await this.publishBridge()

    return this.getHomeKitInfo()
  }

  stop() {
    if (this.bridge) {
      try {
        console.log('[Lumos HomeKit] Unpublishing bridge on app shutdown...')
        this.bridge.unpublish()
      } catch (err) {
        console.warn('[Lumos HomeKit] Error unpublishing bridge:', err)
      }
      this.bridge = null
    }

    for (const acc of this.accessories) {
      const cleanup = acc._cleanUpListener
      if (typeof cleanup === 'function') {
        cleanup()
      }
    }
    this.accessories = []
    this.isInitialized = false
  }
}

export const homeKitManager = new HomeKitManager()
