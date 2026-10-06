/** Helpers for validating untrusted settings and payloads. */

export type Obj = Record<string, unknown>

export function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export function asObj(v: unknown): Obj {
  return isObj(v) ? v : {}
}

export function num(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, n))
}

export function int(v: unknown, fallback: number, min: number, max: number): number {
  return Math.round(num(v, fallback, min, max))
}

export function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback
}

export function str(v: unknown, fallback: string, maxLen = 200): string {
  return typeof v === 'string' ? v.slice(0, maxLen) : fallback
}

export function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback
}

export interface HueSat {
  h: number
  s: number
}

export function hueSat(v: unknown, fallback: HueSat): HueSat {
  if (!isObj(v)) return fallback
  return { h: num(v.h, fallback.h, 0, 360), s: num(v.s, fallback.s, 0, 100) }
}

export function targets(v: unknown): 'all' | string[] {
  if (v === 'all' || v === undefined || v === null) return 'all'
  if (!Array.isArray(v)) return 'all'
  const ids = v.filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length < 128)
  return Array.from(new Set(ids)).slice(0, 256)
}
