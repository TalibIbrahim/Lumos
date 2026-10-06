import http from 'http'
import { app } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import crypto from 'crypto'
import { LightManager } from './devices/LightManager'
import { lumosStore } from './store'

export interface WebhookConfig {
  port: number
  token: string
}

export class WebhookServer {
  private server: http.Server | null = null
  private config: WebhookConfig | null = null
  private lightManager: LightManager | null = null
  private configFile: string = ''

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

    this.configFile = join(userDataPath, 'webhook-config.json')
    this.config = this.loadOrCreateConfig()
  }

  private loadOrCreateConfig(): WebhookConfig {
    if (existsSync(this.configFile)) {
      try {
        const raw = readFileSync(this.configFile, 'utf-8')
        const data = JSON.parse(raw)
        if (data && data.token && typeof data.token === 'string') {
          return {
            port: data.port || 8989,
            token: data.token
          }
        }
      } catch {
        // regenerate on read error
      }
    }

    const newConfig: WebhookConfig = {
      port: 8989,
      token: 'lumos_' + crypto.randomBytes(16).toString('hex')
    }

    try {
      writeFileSync(this.configFile, JSON.stringify(newConfig, null, 2), 'utf-8')
    } catch (err) {
      console.error('[Lumos Webhook] Failed to save webhook config:', err)
    }

    return newConfig
  }

  public getInfo(): { url: string; token: string; port: number } {
    const token = this.config?.token || ''
    const port = this.config?.port || 8989
    return {
      url: `http://127.0.0.1:${port}/api/v1/control`,
      token,
      port
    }
  }

  public start(lightManager: LightManager): void {
    if (this.server) return
    this.lightManager = lightManager
    const port = this.config?.port || 8989

    this.server = http.createServer(async (req, res) => {
      // Allow localhost CORS
      res.setHeader('Access-Control-Allow-Origin', '*')
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

      if (req.method === 'OPTIONS') {
        res.writeHead(204)
        res.end()
        return
      }

      const urlObj = new URL(req.url || '/', `http://127.0.0.1:${port}`)
      const pathname = urlObj.pathname

      // Health endpoint (no auth)
      if (pathname === '/api/v1/health' || pathname === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ status: 'ok', service: 'lumos' }))
        return
      }

      // Check Authorization
      const authHeader = req.headers['authorization'] || ''
      const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : ''
      const queryToken = urlObj.searchParams.get('token') || ''
      const token = bearerToken || queryToken

      if (!token || token !== this.config?.token) {
        res.writeHead(401, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Unauthorized: Invalid or missing bearer token' }))
        return
      }

      // GET /api/v1/status
      if (pathname === '/api/v1/status' && req.method === 'GET') {
        const statuses = this.lightManager?.getAllStates() || []
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: true, data: statuses }))
        return
      }

      // POST / GET /api/v1/control
      if (pathname === '/api/v1/control') {
        let payload: any = {}

        if (req.method === 'POST') {
          try {
            const body = await this.readRequestBody(req)
            payload = body ? JSON.parse(body) : {}
          } catch (err) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Invalid JSON body' }))
            return
          }
        } else if (req.method === 'GET') {
          // Parse query params into payload object
          for (const [k, v] of urlObj.searchParams.entries()) {
            if (k === 'token') continue
            if (v === 'true') payload[k] = true
            else if (v === 'false') payload[k] = false
            else if (!isNaN(Number(v)) && v.trim() !== '') payload[k] = Number(v)
            else payload[k] = v
          }
        }

        try {
          const result = await this.handleControlCommand(payload)
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: true, result }))
        } catch (err: any) {
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: err?.message || 'Control command failed' }))
        }
        return
      }

      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Endpoint not found' }))
    })

    this.server.listen(port, '127.0.0.1', () => {
      console.log(`[Lumos Webhook] Local REST Webhook listening on http://127.0.0.1:${port}`)
    })

    this.server.on('error', (err: any) => {
      console.warn('[Lumos Webhook] Server error:', err?.message || err)
    })
  }

  private readRequestBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      let data = ''
      req.on('data', (chunk) => {
        data += chunk
        if (data.length > 1e6) {
          req.destroy()
          reject(new Error('Payload too large'))
        }
      })
      req.on('end', () => resolve(data))
      req.on('error', reject)
    })
  }

  private async handleControlCommand(payload: any): Promise<any> {
    if (!this.lightManager) {
      throw new Error('LightManager not initialized')
    }

    const action = String(payload.action || '').toLowerCase()
    const targetId = payload.id || payload.deviceId
    const roomId = payload.room || payload.roomId

    // 1. Flash action
    if (action === 'flash' || payload.flash === true) {
      const count = Number(payload.count) || 2
      const color = payload.color || null
      return this.flashLights(targetId, roomId, count, color)
    }

    // 2. Set All Power
    if (action === 'all' || (payload.all !== undefined && payload.power !== undefined)) {
      const power = payload.power !== undefined ? Boolean(payload.power) : action === 'all-on'
      return this.lightManager.setAll(power)
    }

    // 3. Toggle
    if (action === 'toggle' && targetId) {
      return this.lightManager.toggleLight(targetId)
    }

    // 4. Apply Preset / Scene
    if (action === 'apply-preset' || payload.presetId || payload.scene) {
      const presetId = payload.presetId || payload.scene
      const targetType = targetId ? 'light' : roomId ? 'room' : 'all'
      const id = targetId || roomId
      return lumosStore.applyPreset(presetId, targetType, id)
    }

    // 5. Target specific device
    if (targetId) {
      const light = this.lightManager.getLight(targetId)
      if (!light) {
        throw new Error(`Device not found: ${targetId}`)
      }

      if (payload.power !== undefined) {
        await light.setPower(Boolean(payload.power))
      }
      if (typeof payload.brightness === 'number') {
        await light.setBrightness(payload.brightness)
      }
      if (typeof payload.colorTemp === 'number') {
        await light.setColorTemp(payload.colorTemp)
      }
      if (payload.color && typeof payload.color === 'object') {
        const h = Number(payload.color.h) || 0
        const s = Number(payload.color.s) || 100
        const v = payload.color.v !== undefined ? Number(payload.color.v) : undefined
        await light.setColor(h, s, v)
      }
      return light.getState()
    }

    // 6. Target Room
    if (roomId) {
      const storeData = lumosStore.getData()
      const room = storeData.rooms.find((r) => r.id === roomId || r.name.toLowerCase() === String(roomId).toLowerCase())
      if (!room) {
        throw new Error(`Room not found: ${roomId}`)
      }

      if (payload.power !== undefined) {
        await this.lightManager.setGroupPower(room.deviceIds, Boolean(payload.power))
      }
      if (typeof payload.brightness === 'number') {
        await this.lightManager.setGroupBrightness(room.deviceIds, payload.brightness)
      }
      if (typeof payload.colorTemp === 'number') {
        await this.lightManager.setGroupColorTemp(room.deviceIds, payload.colorTemp)
      }
      return { room: room.name, updatedDevices: room.deviceIds.length }
    }

    // 7. General Power or Brightness on All
    if (payload.power !== undefined) {
      return this.lightManager.setAll(Boolean(payload.power))
    }

    return { received: payload }
  }

  public async flashLights(
    targetId?: string,
    roomId?: string,
    count: number = 2,
    flashColor?: { h: number; s: number; v?: number } | null
  ): Promise<boolean> {
    if (!this.lightManager) return false

    const lights = targetId
      ? [this.lightManager.getLight(targetId)].filter(Boolean)
      : roomId
      ? this.lightManager.getAllLights().filter((l) => l.room === roomId)
      : this.lightManager.getAllLights()

    if (lights.length === 0) return false

    // Save initial states
    const savedStates = lights.map((l: any) => ({
      light: l,
      power: l.power,
      brightness: l.brightness,
      colorTemp: l.colorTemp,
      color: l.color,
      mode: l.mode
    }))

    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

    try {
      for (let i = 0; i < count; i++) {
        // Pulse On / Vivid
        for (const { light } of savedStates) {
          if (flashColor && light.capabilities.hasColor) {
            light.setColor(flashColor.h, flashColor.s, flashColor.v || 100).catch(() => {})
          } else {
            light.setBrightness(100).catch(() => {})
          }
        }
        await sleep(220)

        // Pulse Off / Low
        for (const { light } of savedStates) {
          light.setPower(false).catch(() => {})
        }
        await sleep(220)
      }

      // Restore initial states
      for (const { light, power, brightness, colorTemp, color, mode } of savedStates) {
        if (power) {
          await light.setPower(true)
          if (mode === 'colour' && color && light.capabilities.hasColor) {
            await light.setColor(color.h, color.s, color.v)
          } else {
            await light.setBrightness(brightness)
            await light.setColorTemp(colorTemp)
          }
        } else {
          await light.setPower(false)
        }
      }
      return true
    } catch (err) {
      console.error('[Lumos Webhook] Error during flash routine:', err)
      return false
    }
  }

  public stop(): void {
    if (this.server) {
      try {
        this.server.close()
      } catch {
        // ignore close error
      }
      this.server = null
    }
  }
}

export const webhookServer = new WebhookServer()
