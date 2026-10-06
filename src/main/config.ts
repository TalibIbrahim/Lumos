import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import { TinyTuyaDevice } from './types'

// Known Tuya lighting categories (e.g., dj = light, tgq = dimmer/light)
const LIGHT_CATEGORIES = new Set(['dj', 'tgq', 'dd', 'xdd', 'dc', 'sdd', 'tyd', 'fsd'])

export function isLightDevice(device: TinyTuyaDevice): boolean {
  // 1. Skip sub-devices (Zigbee child nodes, Bluetooth mesh sub-devices, etc.)
  if (device.sub === true || device.sub_device === true) {
    return false
  }

  // 2. Check category if present
  if (device.category && LIGHT_CATEGORIES.has(device.category.toLowerCase())) {
    return true
  }

  // 3. Inspect mapping codes if category is unspecified
  if (device.mapping && typeof device.mapping === 'object') {
    const codes = Object.values(device.mapping).map((m) => m?.code)
    const hasLightDps = codes.some((code) =>
      ['switch_led', 'bright_value', 'bright_value_v2', 'temp_value', 'temp_value_v2', 'colour_data', 'colour_data_v2'].includes(code)
    )
    if (hasLightDps) {
      return true
    }
  }

  // 4. Product name check fallback
  if (device.product_name && /bulb|light|lamp|strip|downlight|spotlight|led/i.test(device.product_name)) {
    return true
  }

  return false
}

export function getUserDataDevicesPath(): string {
  let userDataPath = ''
  try {
    if (app && typeof app.getPath === 'function') {
      userDataPath = app.getPath('userData')
    }
  } catch {
    // app not ready
  }

  if (!userDataPath) {
    userDataPath = join(process.cwd(), 'persist')
  }

  if (!existsSync(userDataPath)) {
    try {
      mkdirSync(userDataPath, { recursive: true })
    } catch {
      // ignore
    }
  }

  return join(userDataPath, 'devices.json')
}

export function hasDevicesConfig(): boolean {
  const primaryPath = getUserDataDevicesPath()
  if (existsSync(primaryPath)) {
    try {
      const raw = readFileSync(primaryPath, 'utf-8')
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) && parsed.length > 0
    } catch {
      return false
    }
  }

  // Check dev fallback if not packaged
  try {
    if (app && !app.isPackaged) {
      const devPath = join(process.cwd(), 'devices.json')
      if (existsSync(devPath)) return true
    }
  } catch {
    // ignore
  }

  return false
}

export function validateDevicesConfig(data: unknown): {
  valid: boolean
  lights: TinyTuyaDevice[]
  totalDevices: number
  error?: string
} {
  let parsed: unknown = data

  if (typeof data === 'string') {
    try {
      parsed = JSON.parse(data)
    } catch {
      return { valid: false, lights: [], totalDevices: 0, error: 'Invalid JSON format' }
    }
  }

  const list = Array.isArray(parsed)
    ? parsed
    : typeof parsed === 'object' && parsed !== null && Array.isArray((parsed as any).devices)
    ? (parsed as any).devices
    : null

  if (!list) {
    return { valid: false, lights: [], totalDevices: 0, error: 'Expected JSON array of devices' }
  }

  const lights: TinyTuyaDevice[] = []
  for (const item of list) {
    if (item && typeof item === 'object' && item.id && item.key) {
      if (isLightDevice(item as TinyTuyaDevice)) {
        lights.push(item as TinyTuyaDevice)
      }
    }
  }

  if (lights.length === 0) {
    return {
      valid: false,
      lights: [],
      totalDevices: list.length,
      error: 'No compatible Tuya smart lights detected in the provided file'
    }
  }

  return {
    valid: true,
    lights,
    totalDevices: list.length
  }
}

export function saveDevicesConfig(content: unknown): { success: boolean; count: number; error?: string } {
  const validation = validateDevicesConfig(content)
  if (!validation.valid) {
    return { success: false, count: 0, error: validation.error }
  }

  const targetPath = getUserDataDevicesPath()
  try {
    let rawToSave = ''
    if (typeof content === 'string') {
      rawToSave = content
    } else {
      rawToSave = JSON.stringify(content, null, 2)
    }
    writeFileSync(targetPath, rawToSave, 'utf-8')
    console.log(`[Lumos Config] Saved ${validation.lights.length} lights to: ${targetPath}`)
    return { success: true, count: validation.lights.length }
  } catch (err: any) {
    console.error('[Lumos Config] Failed writing devices config:', err)
    return { success: false, count: 0, error: err?.message || 'Failed writing devices.json to disk' }
  }
}

export function loadDevicesConfig(): TinyTuyaDevice[] {
  const primaryPath = getUserDataDevicesPath()
  const candidatePaths: string[] = [primaryPath]

  // In non-packaged dev environment, also allow reading from project directory if userData is empty
  try {
    if (app && !app.isPackaged) {
      candidatePaths.push(join(process.cwd(), 'devices.json'))
    }
  } catch {
    // ignore
  }

  for (const configPath of candidatePaths) {
    if (existsSync(configPath)) {
      try {
        const raw = readFileSync(configPath, 'utf-8')
        const parsed = JSON.parse(raw)
        const list = Array.isArray(parsed) ? parsed : parsed.devices || []
        const validLights = list.filter((d: any): d is TinyTuyaDevice => {
          if (!d || typeof d !== 'object') return false
          if (!d.id || !d.key) return false
          return isLightDevice(d)
        })

        if (validLights.length > 0) {
          console.log(`[Lumos Config] Successfully loaded ${validLights.length} light(s) from: ${configPath}`)
          return validLights
        }
      } catch (err) {
        console.error(`[Lumos Config] Error parsing ${configPath}:`, err)
      }
    }
  }

  console.warn('[Lumos Config] No devices.json found in candidate paths:', candidatePaths)
  return []
}

export function updatePersistedDeviceIp(deviceId: string, newIp: string): void {
  if (!deviceId || !newIp) return

  const targetPath = getUserDataDevicesPath()
  if (existsSync(targetPath)) {
    try {
      const raw = readFileSync(targetPath, 'utf-8')
      const parsed = JSON.parse(raw)
      const list = Array.isArray(parsed) ? parsed : parsed.devices || []
      let updated = false
      for (const d of list) {
        if (d && d.id === deviceId && d.ip !== newIp) {
          d.ip = newIp
          updated = true
        }
      }
      if (updated) {
        writeFileSync(targetPath, JSON.stringify(parsed, null, 2), 'utf-8')
        console.log(`[Lumos Config] Persisted updated IP (${newIp}) for device ${deviceId} in ${targetPath}`)
      }
    } catch {
      // ignore write error
    }
  }
}
