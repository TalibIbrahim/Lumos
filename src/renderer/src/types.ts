export * from '../../main/types'

export interface HomeKitInfo {
  isPaired: boolean
  setupCode: string
  setupURI: string
  qrCodeDataUrl: string
  bridgeUsername: string
  port: number
  accessoryCount: number
}

export interface WebhookInfo {
  url: string
  token: string
  port: number
}

export interface ImportResult {
  canceled: boolean
  success?: boolean
  error?: string
  lightsCount?: number
  lights?: Array<{ id: string; name: string; product: string }>
}
