import './cryptoPolyfill.js'
import { app } from 'electron'
import path from 'path'
import fs from 'fs'
import os from 'os'
import net from 'net'
import util from 'util'
import debug from 'debug'

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

// hap-nodejs is required at run time so cryptoPolyfill is active before it initializes. It takes
// a noticeable time to load, so it loads when HomeKit starts rather than before the window opens,
// and not at all on a computer that controls another computer's lights.
let hap = null
let Bridge, Accessory, Service, Characteristic, HAPStorage, HapStatusError, uuid
function loadHap() {
  if (hap) return hap
  hap = require('hap-nodejs')
  ;({ Bridge, Accessory, Service, Characteristic, HAPStorage, HapStatusError, uuid } = hap)

  // Intercept socket listen errors on HAPServer to prevent unhandled 'error' events crashing Electron
  if (hap.HAPServer && hap.HAPServer.prototype) {
    const origListen = hap.HAPServer.prototype.listen
    hap.HAPServer.prototype.listen = function (port, host) {
      if (this.httpServer && this.httpServer.tcpServer) {
        this.httpServer.tcpServer.on('error', (err) => {
          console.warn('[Lumos HomeKit] HAP TCP server socket error intercepted:', err?.code, err?.message)
        })
      }
      return origListen.call(this, port, host)
    }
  }

  return hap
}

// HAP Constants
const HAP_SERVICE_COMMUNICATION_FAILURE = -70402
const HAP_CATEGORY_BRIDGE = 2
const HAP_EVENT_PAIRED = 'paired'
const HAP_EVENT_UNPAIRED = 'unpaired'

/**
 * Tests whether a TCP port can be bound on the given host address.
 */
export function checkPortAvailable(port, host = '0.0.0.0') {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once('error', () => {
      resolve(false)
    })
    server.once('listening', () => {
      server.close(() => resolve(true))
    })
    try {
      server.listen(port, host)
    } catch {
      resolve(false)
    }
  })
}

/**
 * Finds an available, bindable TCP port starting from preferredPort (default 51826).
 * Scans sequential HAP range (51826-51850), then falls back to OS-assigned ephemeral port.
 */
export async function findAvailablePort(preferredPort = 51826, host = '0.0.0.0') {
  if (preferredPort && (await checkPortAvailable(preferredPort, host))) {
    return preferredPort
  }
  const start = 51826
  for (let p = start; p <= 51850; p++) {
    if (p === preferredPort) continue
    if (await checkPortAvailable(p, host)) {
      return p
    }
  }
  return new Promise((resolve) => {
    const s = net.createServer()
    s.listen(0, host, () => {
      const port = s.address().port
      s.close(() => resolve(port))
    })
  })
}

/**
 * Detects legitimate local LAN interfaces (Ethernet, Wi-Fi, Mobile Hotspot),
 * strictly excluding virtual adapters and VM switches (Hyper-V / vEthernet, WSL, VMware, VirtualBox, loopback, bluetooth).
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
      lower.includes('vbox') ||
      lower.includes('vmware') ||
      lower.includes('vmnet') ||
      lower.includes('loopback') ||
      lower.includes('bluetooth') ||
      lower.includes('wsl') ||
      lower.includes('pseudo') ||
      lower.includes('teredo') ||
      lower.includes('isatap') ||
      lower.includes('docker') ||
      lower.includes('cni')
    ) {
      continue
    }
    for (const info of list) {
      const isIpv4 = info.family === 'IPv4' || info.family === 4
      if (
        !info.internal &&
        isIpv4 &&
        !info.address.startsWith('169.254.') &&
        !info.address.startsWith('127.')
      ) {
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
    this.effectManager = null
    this.config = null
    this.isInitialized = false
    this.storageInitialized = false
    this.storagePath = ''
    this.configFile = ''
  }

  setupStorage() {
    loadHap()
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

  async loadOrCreateConfig() {
    this.setupStorage()
    let config = null
    if (fs.existsSync(this.configFile)) {
      try {
        const raw = fs.readFileSync(this.configFile, 'utf-8')
        const data = JSON.parse(raw)
        if (data && data.username && data.pincode && data.port) {
          config = data
        }
      } catch (err) {
        console.warn('[Lumos HomeKit] Could not read existing bridge config, generating new:', err)
      }
    }

    if (!config) {
      config = {
        username: generateMacUsername(),
        pincode: generateRandomPincode(),
        port: 51826
      }
    }

    const safePort = await findAvailablePort(config.port)
    if (safePort !== config.port) {
      console.log(`[Lumos HomeKit] Configured port ${config.port} unavailable, using ${safePort}`)
      config.port = safePort
    }

    try {
      fs.writeFileSync(this.configFile, JSON.stringify(config, null, 2), 'utf-8')
    } catch (err) {
      console.error('[Lumos HomeKit] Failed to save bridge config:', err)
    }

    return config
  }

  /** Effects are exposed as Switch accessories so they can be toggled from Apple Home and Siri. */
  setEffectManager(effectManager) {
    this.effectManager = effectManager
  }

  async init(lightManager) {
    if (this.isInitialized) return
    this.setupStorage()
    this.lightManager = lightManager
    this.config = await this.loadOrCreateConfig()

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

    // Changes from Apple Home are manual control, so ambient effects step aside
    // 'power' for plain on and off, which does not pause ambient effects
    const markManual = (kind = 'state') => {
      if (this.lightManager && typeof this.lightManager.markManual === 'function') {
        this.lightManager.markManual([light.id], kind)
      }
    }

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
          return Boolean(state.power)
        })
        .onSet(async (value) => {
          markManual('power')
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
          return typeof state.brightness === 'number' ? state.brightness : 100
        })
        .onSet(async (value) => {
          markManual()
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
          return lumosColorTempToMireds(state.colorTemp)
        })
        .onSet(async (value) => {
          markManual()
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
          return state.color ? state.color.h : 0
        })
        .onSet(async (value) => {
          markManual()
          pendingHue = Number(value)
          lastTargetMode = 'colour'
          scheduleColorBatch()
        })

      const satChar = service.getCharacteristic(Characteristic.Saturation) || service.addCharacteristic(Characteristic.Saturation)
      satChar
        .onGet(() => {
          const state = light.getState()
          return state.color ? state.color.s : 100
        })
        .onSet(async (value) => {
          markManual()
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

  createAccessoryForEffect(effect) {
    const manager = this.effectManager
    const name = effect.voiceName || effect.label
    const accessory = new Accessory(name, uuid.generate(`lumos-effect-${effect.id}`))

    const infoService = accessory.getService(Service.AccessoryInformation)
    if (infoService) {
      infoService
        .setCharacteristic(Characteristic.Manufacturer, 'Lumos')
        .setCharacteristic(Characteristic.Model, 'Lumos Effect')
        .setCharacteristic(Characteristic.SerialNumber, `effect-${effect.id}`)
        .setCharacteristic(Characteristic.FirmwareRevision, '1.0.0')
    }

    const service = accessory.getService(Service.Switch) || accessory.addService(Service.Switch, name)
    service
      .getCharacteristic(Characteristic.On)
      .onGet(() => effect.isEnabled())
      .onSet(async (value) => {
        await manager.setEnabled(effect.id, Boolean(value))
      })

    const snapshotListener = (snapshot) => {
      const entry = snapshot.effects.find((e) => e.id === effect.id)
      if (entry) service.updateCharacteristic(Characteristic.On, Boolean(entry.settings.enabled))
    }
    manager.on('snapshot', snapshotListener)
    accessory._cleanUpListener = () => manager.removeListener('snapshot', snapshotListener)
    return accessory
  }

  async publishBridge() {
    loadHap()
    if (!this.config || !this.lightManager) return

    // Ensure the target port is currently bindable before creating the bridge
    const safePort = await findAvailablePort(this.config.port || 51826)
    if (safePort !== this.config.port) {
      console.log(`[Lumos HomeKit] Switching bridge port from ${this.config.port} to ${safePort}`)
      this.config.port = safePort
      try {
        fs.writeFileSync(this.configFile, JSON.stringify(this.config, null, 2), 'utf-8')
      } catch {}
    }

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

    if (this.effectManager) {
      for (const effect of this.effectManager.list()) {
        const acc = this.createAccessoryForEffect(effect)
        this.accessories.push(acc)
        this.bridge.addBridgedAccessory(acc)
      }
    }

    const lanIfaces = detectLanInterfaces()
    const bindOption = lanIfaces.length ? [...lanIfaces, '0.0.0.0'] : ['0.0.0.0']

    console.log(
      `[Lumos HomeKit] Publishing bridge "${this.bridge.displayName}" (${this.config.username}) with ${this.accessories.length} accessories on port ${this.config.port}...`
    )
    console.log(`[Lumos HomeKit] Binding interfaces: ${bindOption.join(', ')} (Advertiser: ciao)`)

    try {
      await this.bridge.publish({
        username: this.config.username,
        pincode: this.config.pincode,
        port: this.config.port,
        category: HAP_CATEGORY_BRIDGE,
        advertiser: 'ciao',
        bind: bindOption
      })
      console.log(`[Lumos HomeKit] Bridge published! Setup PIN: ${this.config.pincode}`)
    } catch (err) {
      console.error(`[Lumos HomeKit] Failed publishing on port ${this.config.port}:`, err)
      const altPort = await findAvailablePort(this.config.port + 1)
      if (altPort !== this.config.port) {
        console.log(`[Lumos HomeKit] Retrying publish on alternative port ${altPort}...`)
        this.config.port = altPort
        try {
          fs.writeFileSync(this.configFile, JSON.stringify(this.config, null, 2), 'utf-8')
        } catch {}
        await this.bridge.publish({
          username: this.config.username,
          pincode: this.config.pincode,
          port: this.config.port,
          category: HAP_CATEGORY_BRIDGE,
          advertiser: 'ciao',
          bind: bindOption
        })
        console.log(`[Lumos HomeKit] Bridge published on retry! Setup PIN: ${this.config.pincode}`)
      } else {
        throw err
      }
    }
  }

  async getHomeKitInfo() {
    const isPaired = Boolean(this.bridge?._accessoryInfo?.paired())
    let setupURI = ''
    try {
      setupURI = this.bridge?.setupURI() || ''
    } catch {
      setupURI = ''
    }
    let qrCodeDataUrl = ''

    if (setupURI) {
      try {
        const QRCode = require('qrcode')
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
        await this.bridge.destroy()
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

    // 3. Wait briefly for closing sockets to finish releasing ports
    await new Promise((resolve) => setTimeout(resolve, 300))

    // 4. Clear storage directory (preserve hap-debug.log) and clear in-memory HAPStorage
    try {
      if (HAPStorage && typeof HAPStorage.storage === 'function') {
        HAPStorage.storage().clearSync()
      }
    } catch (err) {
      console.warn('[Lumos HomeKit] Error clearing HAP storage in-memory cache:', err)
    }

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

    // 5. Generate new MAC-style username and fresh random pincode for fresh pairing identity
    const safePort = await findAvailablePort(51826)
    this.config = {
      username: generateMacUsername(),
      pincode: generateRandomPincode(),
      port: safePort
    }

    try {
      fs.writeFileSync(this.configFile, JSON.stringify(this.config, null, 2), 'utf-8')
    } catch (err) {
      console.error('[Lumos HomeKit] Failed saving updated bridge config:', err)
    }

    // 6. Rebuild and re-publish bridge
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
