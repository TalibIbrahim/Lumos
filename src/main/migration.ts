import { app } from 'electron'
import { join, dirname } from 'path'
import { existsSync, copyFileSync, cpSync, mkdirSync } from 'fs'

/**
 * Generic legacy data migration.
 * If %APPDATA%/Lumen exists and %APPDATA%/Lumos does not contain existing data,
 * safely migrates devices, store, and HomeKit pairing data so users do not lose their setup.
 */
export function migrateLegacyData(): void {
  try {
    const userData = app.getPath('userData')
    const appDataRoot = dirname(userData)
    const legacyUserData = join(appDataRoot, 'Lumen')

    if (!existsSync(legacyUserData)) {
      return
    }

    if (!existsSync(userData)) {
      mkdirSync(userData, { recursive: true })
    }

    // 1. Migrate devices.json
    const currentDevices = join(userData, 'devices.json')
    const legacyDevices = join(legacyUserData, 'devices.json')
    if (!existsSync(currentDevices) && existsSync(legacyDevices)) {
      copyFileSync(legacyDevices, currentDevices)
      console.log('[Lumos Migration] Migrated devices.json from legacy path.')
    }

    // 2. Migrate store data
    const currentStore = join(userData, 'lumos-store.json')
    const legacyStoreLumos = join(legacyUserData, 'lumos-store.json')
    const legacyStoreLumen = join(legacyUserData, 'lumen-store.json')

    if (!existsSync(currentStore)) {
      if (existsSync(legacyStoreLumos)) {
        copyFileSync(legacyStoreLumos, currentStore)
        console.log('[Lumos Migration] Migrated store from legacy lumos-store.json.')
      } else if (existsSync(legacyStoreLumen)) {
        copyFileSync(legacyStoreLumen, currentStore)
        console.log('[Lumos Migration] Migrated store from legacy lumen-store.json.')
      }
    }

    // 3. Migrate HomeKit pairing storage
    const currentHomeKit = join(userData, 'homekit')
    const legacyHomeKit = join(legacyUserData, 'homekit')
    if (!existsSync(currentHomeKit) && existsSync(legacyHomeKit)) {
      cpSync(legacyHomeKit, currentHomeKit, { recursive: true })
      console.log('[Lumos Migration] Migrated HomeKit pairing data from legacy directory.')
    }
  } catch (err) {
    console.warn('[Lumos Migration] Non-fatal error during legacy data migration:', err)
  }
}
