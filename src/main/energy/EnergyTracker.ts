import { EventEmitter } from 'events'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { Light } from '../devices/Light'
import { asObj, isObj, num, str } from '../effects/validate'
import {
  DEFAULT_RATED_WATTS,
  DailyTotals,
  PowerState,
  accumulate,
  dayKey,
  estimateWatts,
  lastDays,
  prune
} from './model'

export type EnergyRange = 'today' | '7d' | '30d'

export interface EnergyPrice {
  perKwh: number
  currency: string
}

export interface EnergyReport {
  range: EnergyRange
  totalKwh: number
  estimatedCost: number | null
  price: EnergyPrice | null
  daily: Array<{ date: string; kwh: number }>
  lights: Array<{ id: string; name: string; kwh: number; hoursOn: number; ratedWatts: number; watts: number }>
  defaultWatts: number
}

interface Stored {
  version: 1
  ratedWatts: Record<string, number>
  price: EnergyPrice | null
  names: Record<string, string>
  days: DailyTotals
}

interface Tracked {
  since: number
  watts: number
}

const FLUSH_MS = 60000
const KEEP_DAYS = 400

export interface LightProvider {
  getAllLights(): Light[]
}

/**
 * Tracks estimated energy per bulb. The draw is integrated whenever a bulb's
 * output changes, stored as compact daily totals (not a raw log), and flushed
 * to disk every minute so a crash loses at most a minute.
 */
export class EnergyTracker extends EventEmitter {
  private data: Stored = { version: 1, ratedWatts: {}, price: null, names: {}, days: {} }
  private tracked = new Map<string, Tracked>()
  private bound = new Map<string, { light: Light; fn: () => void }>()
  private flushTimer: NodeJS.Timeout | null = null
  private dirty = false
  private readonly filePath: string

  constructor(
    private lights: LightProvider,
    dataDir: string,
    private clock: () => number = Date.now
  ) {
    super()
    this.filePath = join(dataDir, 'energy.json')
    this.load()
  }

  public start(): void {
    if (this.flushTimer) return
    this.flushTimer = setInterval(() => this.checkpoint(), FLUSH_MS)
    this.attach()
  }

  /** Re-binds to the current lights. Call after lights reload. */
  public attach(): void {
    const now = this.clock()
    // Close out lights that went away
    for (const [id, l] of this.bound) {
      l.light.removeListener('output', l.fn)
      l.light.removeListener('change', l.fn)
      this.close(id, now)
    }
    this.bound.clear()
    for (const light of this.lights.getAllLights()) {
      const fn = (): void => this.onChange(light)
      light.on('output', fn)
      light.on('change', fn)
      this.bound.set(light.id, { light, fn })
      this.data.names[light.id] = light.customName || light.name
      this.tracked.set(light.id, { since: now, watts: this.wattsFor(light) })
    }
  }

  public stop(): void {
    if (this.flushTimer) clearInterval(this.flushTimer)
    this.flushTimer = null
    this.checkpoint()
    for (const l of this.bound.values()) {
      l.light.removeListener('output', l.fn)
      l.light.removeListener('change', l.fn)
    }
    this.bound.clear()
  }

  private powerState(light: Light): PowerState {
    // What the bulb is actually showing, including effects
    const out = light.lastSentOutput ?? light.baseOutput()
    return { online: light.isConnected || light.isDemo, power: out.power, mode: out.mode, brightness: out.brightness }
  }

  private wattsFor(light: Light): number {
    return estimateWatts(this.powerState(light), this.ratedFor(light.id))
  }

  public ratedFor(id: string): number {
    return this.data.ratedWatts[id] ?? DEFAULT_RATED_WATTS
  }

  private onChange(light: Light): void {
    const now = this.clock()
    const watts = this.wattsFor(light)
    const t = this.tracked.get(light.id)
    if (t && Math.abs(t.watts - watts) < 0.01) return
    if (t) accumulate(this.data.days, light.id, t.since, now, t.watts)
    this.tracked.set(light.id, { since: now, watts })
    this.dirty = true
  }

  private close(id: string, now: number): void {
    const t = this.tracked.get(id)
    if (!t) return
    accumulate(this.data.days, id, t.since, now, t.watts)
    this.tracked.delete(id)
    this.dirty = true
  }

  /** Books energy up to now for every light and writes to disk. */
  public checkpoint(): void {
    const now = this.clock()
    for (const [id, t] of this.tracked) {
      if (now > t.since) {
        accumulate(this.data.days, id, t.since, now, t.watts)
        t.since = now
        if (t.watts > 0) this.dirty = true
      }
    }
    prune(this.data.days, KEEP_DAYS, now)
    if (this.dirty) this.save()
  }

  // --- Settings ---

  public setRatedWatts(id: string, watts: number): void {
    const w = num(watts, DEFAULT_RATED_WATTS, 0.5, 200)
    // Book the past at the old rating first
    this.checkpoint()
    this.data.ratedWatts[id] = Math.round(w * 10) / 10
    const light = this.bound.get(id)?.light
    if (light) this.tracked.set(id, { since: this.clock(), watts: this.wattsFor(light) })
    this.dirty = true
    this.save()
  }

  public setPrice(price: unknown): void {
    if (price === null) {
      this.data.price = null
    } else {
      const o = asObj(price)
      const perKwh = num(o.perKwh, 0, 0, 1000)
      this.data.price = perKwh > 0 ? { perKwh, currency: str(o.currency, '$', 4).trim() || '$' } : null
    }
    this.dirty = true
    this.save()
  }

  public reset(): void {
    this.checkpoint()
    this.data.days = {}
    const now = this.clock()
    for (const t of this.tracked.values()) t.since = now
    this.dirty = true
    this.save()
  }

  // --- Reports ---

  public report(range: EnergyRange): EnergyReport {
    this.checkpoint()
    const now = this.clock()
    const keys = range === 'today' ? [dayKey(now)] : lastDays(range === '7d' ? 7 : 30, now)
    const perLight = new Map<string, { wh: number; sec: number }>()
    const daily = keys.map((date) => {
      const day = this.data.days[date] || {}
      let wh = 0
      for (const [id, [w, s]] of Object.entries(day)) {
        wh += w
        const acc = perLight.get(id) || { wh: 0, sec: 0 }
        acc.wh += w
        acc.sec += s
        perLight.set(id, acc)
      }
      return { date, kwh: wh / 1000 }
    })
    const totalKwh = daily.reduce((s, d) => s + d.kwh, 0)
    const current = new Map(this.lights.getAllLights().map((l) => [l.id, l]))
    const ids = new Set([...perLight.keys(), ...current.keys()])
    const lights = Array.from(ids)
      .map((id) => {
        const acc = perLight.get(id) || { wh: 0, sec: 0 }
        const light = current.get(id)
        return {
          id,
          name: light?.customName || light?.name || this.data.names[id] || 'Removed light',
          kwh: acc.wh / 1000,
          hoursOn: acc.sec / 3600,
          ratedWatts: this.ratedFor(id),
          watts: light ? this.wattsFor(light) : 0
        }
      })
      .sort((a, b) => b.kwh - a.kwh)
    const price = this.data.price
    return {
      range,
      totalKwh,
      estimatedCost: price ? totalKwh * price.perKwh : null,
      price,
      daily,
      lights,
      defaultWatts: DEFAULT_RATED_WATTS
    }
  }

  /** Daily per-light totals as CSV. */
  public toCsv(): string {
    this.checkpoint()
    const rows = ['date,light,estimated_kwh,hours_on']
    const esc = (s: string): string => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)
    for (const date of Object.keys(this.data.days).sort()) {
      for (const [id, [wh, sec]] of Object.entries(this.data.days[date])) {
        rows.push(`${date},${esc(this.data.names[id] || id)},${(wh / 1000).toFixed(4)},${(sec / 3600).toFixed(2)}`)
      }
    }
    return rows.join('\r\n') + '\r\n'
  }

  // --- Persistence ---

  private load(): void {
    if (!existsSync(this.filePath)) return
    try {
      // Tolerate a byte order mark from files edited in other tools
      const o = asObj(JSON.parse(readFileSync(this.filePath, 'utf-8').trimStart()))
      const rated: Record<string, number> = {}
      for (const [k, v] of Object.entries(asObj(o.ratedWatts))) {
        if (typeof v === 'number' && v > 0 && v <= 200) rated[k] = v
      }
      const names: Record<string, string> = {}
      for (const [k, v] of Object.entries(asObj(o.names))) if (typeof v === 'string') names[k] = v.slice(0, 100)
      const days: DailyTotals = {}
      for (const [date, day] of Object.entries(asObj(o.days))) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !isObj(day)) continue
        days[date] = {}
        for (const [id, v] of Object.entries(day)) {
          if (Array.isArray(v) && typeof v[0] === 'number' && typeof v[1] === 'number' && v[0] >= 0 && v[1] >= 0) {
            days[date][id] = [v[0], v[1]]
          }
        }
      }
      const p = asObj(o.price)
      const price = typeof p.perKwh === 'number' && p.perKwh > 0 ? { perKwh: p.perKwh, currency: str(p.currency, '$', 4) } : null
      this.data = { version: 1, ratedWatts: rated, price, names, days }
    } catch (err) {
      console.warn('[Lumos Energy] Could not read energy history, starting fresh:', err)
    }
  }

  private save(): void {
    try {
      const tmp = `${this.filePath}.tmp`
      writeFileSync(tmp, JSON.stringify(this.data), 'utf-8')
      renameSync(tmp, this.filePath)
      this.dirty = false
      this.emit('changed')
    } catch (err) {
      console.error('[Lumos Energy] Could not save energy history:', err)
    }
  }
}
