import { LightManager } from './devices/LightManager'

export interface HomeKitInfo {
  isPaired: boolean
  setupCode: string
  setupURI: string
  qrCodeDataUrl: string
  bridgeUsername: string
  port: number
  accessoryCount: number
}

export function lumosColorTempToMireds(cct: number): number
export function miredsToLumosColorTemp(mireds: number): number
export function lumenColorTempToMireds(cct: number): number
export function miredsToLumenColorTemp(mireds: number): number
export function detectLanInterfaces(): string[]

export class HomeKitManager {
  init(lightManager: LightManager): Promise<void>
  getHomeKitInfo(): Promise<HomeKitInfo>
  resetHomeKit(): Promise<HomeKitInfo>
  stop(): void
}

export const homeKitManager: HomeKitManager
