import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Download, RotateCcw, Info, LightbulbOff, Gauge } from 'lucide-react'
import { GlassSurface } from './ui/GlassSurface'
import { GlassButton } from './ui/GlassButton'
import { Group, Row, Segmented } from './ui/SettingsControls'
import { EnergyRangeName, EnergyReportData, NormalizedLightState } from '../types'

/** Bar colour validated for contrast and lightness on the dark surface; hover uses the app accent. */
const BAR = '#c2850f'
const BAR_HOVER = '#fbbf24'

const RANGES: Array<{ value: EnergyRangeName; label: string }> = [
  { value: 'today', label: 'Today' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' }
]

function formatKwh(kwh: number): string {
  if (kwh === 0) return '0 kWh'
  const wh = kwh * 1000
  if (wh < 1) return '<1 Wh'
  if (wh < 10) return `${wh.toFixed(1)} Wh`
  if (kwh < 0.1) return `${Math.round(wh)} Wh`
  return `${kwh < 10 ? kwh.toFixed(2) : kwh.toFixed(1)} kWh`
}

function formatMoney(value: number, currency: string): string {
  return `${currency}${value < 1 ? value.toFixed(3) : value.toFixed(2)}`
}

function shortDate(key: string, long: boolean): string {
  const [y, m, d] = key.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  return long
    ? date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
    : date.toLocaleDateString(undefined, { day: 'numeric' })
}

interface Bar {
  key: string
  label: string
  tooltip: string
  value: number
}

/** Simple SVG bar chart: one series, thin rounded bars, hover tooltip, recessive baseline. */
const BarChart: React.FC<{ bars: Bar[]; ariaLabel: string; labelEvery: number }> = ({ bars, ariaLabel, labelEvery }) => {
  const [hover, setHover] = useState<number | null>(null)
  const max = Math.max(...bars.map((b) => b.value), 0)
  const W = 640
  const H = 180
  const top = 24
  const bottom = 26
  const plotH = H - top - bottom
  const slot = W / Math.max(1, bars.length)
  const gap = 2
  const barW = Math.max(3, Math.min(36, slot * 0.62))

  return (
    <div className="relative w-full">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label={ariaLabel}>
        <line x1={0} x2={W} y1={top + plotH} y2={top + plotH} stroke="rgba(255,255,255,0.1)" strokeWidth={1} />
        {bars.map((b, i) => {
          const h = max > 0 ? (b.value / max) * plotH : 0
          const x = i * slot + (slot - barW) / 2
          const y = top + plotH - h
          const r = Math.min(4, barW / 2, h)
          const showLabel = i % labelEvery === 0 || i === bars.length - 1
          return (
            <g key={b.key}>
              {/* Rounded top, square base on the baseline */}
              {h > 0 && (
                <path
                  d={`M${x},${top + plotH} V${y + r} Q${x},${y} ${x + r},${y} H${x + barW - r} Q${x + barW},${y} ${x + barW},${y + r} V${top + plotH} Z`}
                  fill={hover === i ? BAR_HOVER : BAR}
                />
              )}
              {showLabel && (
                <text x={i * slot + slot / 2} y={H - 8} textAnchor="middle" fontSize={11} fill="rgba(161,161,170,0.9)">
                  {b.label}
                </text>
              )}
              {/* Hit target taller and wider than the bar */}
              <rect
                x={i * slot + gap / 2}
                y={0}
                width={slot - gap}
                height={top + plotH}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
              >
                <title>{b.tooltip}</title>
              </rect>
            </g>
          )
        })}
        {max > 0 && (
          <text x={0} y={14} fontSize={11} fill="rgba(113,113,122,1)">
            {'Peak '}
            {formatKwh(max)}
          </text>
        )}
      </svg>
      {hover !== null && bars[hover] && (
        <div
          className="pointer-events-none absolute -top-2 px-2 py-1 rounded-md bg-[#18181c]/95 border border-white/15 text-[11px] text-zinc-100 whitespace-nowrap shadow-lg"
          style={{ left: `${((hover + 0.5) / bars.length) * 100}%`, transform: 'translateX(-50%)' }}
        >
          {bars[hover].tooltip}
        </div>
      )}
    </div>
  )
}

export interface EnergyViewProps {
  lights: NormalizedLightState[]
}

/**
 * Energy page. Tuya bulbs do not report power, so everything here is an
 * estimate from each bulb's rated wattage and what it was showing.
 */
export const EnergyView: React.FC<EnergyViewProps> = ({ lights }) => {
  const api = window.lumos
  const [range, setRange] = useState<EnergyRangeName>('7d')
  const [report, setReport] = useState<EnergyReportData | null>(null)
  const [error, setError] = useState(false)
  const [watts, setWatts] = useState<Record<string, string>>({})
  const [price, setPrice] = useState('')
  const [currency, setCurrency] = useState('$')
  const [confirmReset, setConfirmReset] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!api?.getEnergyReport) return
    try {
      const r = await api.getEnergyReport(range)
      setReport(r)
      setError(false)
    } catch {
      setError(true)
    }
  }, [api, range])

  useEffect(() => {
    void load()
    const t = setInterval(() => void load(), 30000)
    return () => clearInterval(t)
  }, [load])

  useEffect(() => {
    if (!report) return
    setPrice((p) => (p === '' && report.price ? String(report.price.perKwh) : p))
    if (report.price) setCurrency((c) => (c === '$' ? report.price!.currency : c))
  }, [report])

  const bars: Bar[] = useMemo(() => {
    if (!report) return []
    if (report.range === 'today') {
      return report.lights.map((l) => ({
        key: l.id,
        label: l.name.length > 10 ? `${l.name.slice(0, 9)}…` : l.name,
        tooltip: `${l.name}: ${formatKwh(l.kwh)} estimated, on for ${l.hoursOn.toFixed(1)} h`,
        value: l.kwh
      }))
    }
    return report.daily.map((d) => ({
      key: d.date,
      label: shortDate(d.date, report.range === '7d'),
      tooltip: `${shortDate(d.date, true)}: ${formatKwh(d.kwh)} estimated`,
      value: d.kwh
    }))
  }, [report])

  const saveWatts = async (id: string): Promise<void> => {
    const v = Number(watts[id])
    if (!Number.isFinite(v) || v <= 0) return
    await api?.setEnergyWatts(id, v)
    setWatts((w) => {
      const next = { ...w }
      delete next[id]
      return next
    })
    void load()
  }

  const savePrice = async (): Promise<void> => {
    const v = Number(price)
    await api?.setEnergyPrice(Number.isFinite(v) && v > 0 ? { perKwh: v, currency: currency.trim() || '$' } : null)
    void load()
  }

  const exportCsv = async (): Promise<void> => {
    const r = await api?.exportEnergy()
    if (r && !r.canceled) setNotice(r.success ? 'Exported.' : r.error || 'Could not export.')
  }

  const reset = async (): Promise<void> => {
    await api?.resetEnergy()
    setConfirmReset(false)
    setNotice('Energy history cleared.')
    void load()
  }

  if (error) {
    return (
      <div className="p-10 text-center rounded-2xl bg-zinc-950/30 border border-white/[0.06] flex flex-col items-center gap-3">
        <Gauge className="w-10 h-10 text-zinc-600" />
        <p className="text-base font-semibold text-zinc-300">Estimates could not be loaded</p>
        <GlassButton variant="prominent" size="md" onClick={() => void load()}>
          Try again
        </GlassButton>
      </div>
    )
  }

  if (!report) {
    return <div className="h-64 rounded-[20px] bg-white/[0.03] border border-white/[0.06] animate-pulse" />
  }

  const hasData = report.totalKwh > 0
  const currentWatts = report.lights.reduce((s, l) => s + l.watts, 0)
  const rangeLabel = RANGES.find((r) => r.value === report.range)?.label.toLowerCase()

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start gap-2.5 px-4 py-3 rounded-2xl bg-white/[0.03] border border-white/[0.06] text-[11px] text-zinc-400 leading-relaxed">
        <Info className="w-4 h-4 text-zinc-500 flex-shrink-0 mt-px" />
        These are estimates. Your lights do not report their power use, so Lumos works it out from each light's rated
        wattage, its brightness, and whether it is showing white or colour.
      </div>

      <GlassSurface intensity="medium" borderRadius={20} className="p-5 flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-4 w-full">
          <div className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">Estimated use, {rangeLabel}</span>
            <span className="font-display !text-4xl text-white tabular-nums">{formatKwh(report.totalKwh)}</span>
            <span className="text-xs text-zinc-400">
              {report.estimatedCost !== null && report.price
                ? `About ${formatMoney(report.estimatedCost, report.price.currency)} estimated cost`
                : 'Add your electricity price below to see an estimated cost'}
              {` · about ${currentWatts.toFixed(1)} W right now`}
            </span>
          </div>
          <Segmented ariaLabel="Time range" value={range} options={RANGES} onChange={setRange} />
        </div>

        {hasData ? (
          <BarChart
            bars={bars}
            labelEvery={report.range === '30d' ? 5 : 1}
            ariaLabel={report.range === 'today' ? 'Estimated energy today for each light' : 'Estimated energy for each day'}
          />
        ) : (
          <div className="h-44 flex flex-col items-center justify-center gap-2 text-center w-full">
            <LightbulbOff className="w-10 h-10 text-zinc-600" />
            <p className="text-base font-semibold text-zinc-300">No estimates yet</p>
            <p className="text-[13px] text-zinc-500 max-w-[320px]">Estimates for this period build up while Lumos runs.</p>
          </div>
        )}
      </GlassSurface>

      <Group
        title="Each light"
        footer="Rated wattage is printed on the light's box or base, for example “9 W” or “Power: 10 W”. If you cannot find it, the default is a typical value for a smart light."
      >
        {report.lights.length === 0 && <Row label="No lights yet" hint="Lights appear here once Lumos finds them." />}
        {report.lights.map((l) => {
          const light = lights.find((x) => x.id === l.id)
          const editing = watts[l.id] !== undefined
          return (
            <div key={l.id} className="px-4 py-3 flex items-center justify-between gap-4">
              <div className="flex flex-col min-w-0">
                <span className="text-xs font-medium text-white truncate">{l.name}</span>
                <span className="text-[11px] text-zinc-500">
                  {formatKwh(l.kwh)} estimated · on {l.hoursOn.toFixed(1)} h{light && !light.online ? ' · offline' : ''}
                </span>
              </div>
              <label className="flex items-center gap-1.5 flex-shrink-0">
                <span className="sr-only">Rated watts for {l.name}</span>
                <input
                  type="number"
                  min={0.5}
                  max={200}
                  step={0.5}
                  value={editing ? watts[l.id] : l.ratedWatts}
                  onChange={(e) => setWatts((w) => ({ ...w, [l.id]: e.target.value }))}
                  onBlur={() => void saveWatts(l.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                  }}
                  className="w-16 h-8 px-2 rounded-lg bg-black/30 border border-white/[0.08] text-xs text-right text-white font-mono outline-none focus:border-amber-400/50 select-text"
                />
                <span className="text-[11px] text-zinc-400">W rated</span>
              </label>
            </div>
          )
        })}
      </Group>

      <Group title="Cost" footer="Use the price per kilowatt hour from your electricity bill.">
        <Row label="Price per kWh">
          <div className="flex items-center gap-2">
            <label className="sr-only" htmlFor="energy-currency">
              Currency symbol
            </label>
            <input
              id="energy-currency"
              type="text"
              maxLength={4}
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              onBlur={() => void savePrice()}
              className="w-10 h-8 px-2 rounded-lg bg-black/30 border border-white/[0.08] text-xs text-center text-white outline-none focus:border-amber-400/50 select-text"
            />
            <label className="sr-only" htmlFor="energy-price">
              Price per kilowatt hour
            </label>
            <input
              id="energy-price"
              type="number"
              min={0}
              step={0.01}
              placeholder="0.25"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              onBlur={() => void savePrice()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
              }}
              className="w-20 h-8 px-2 rounded-lg bg-black/30 border border-white/[0.08] text-xs text-right text-white font-mono outline-none focus:border-amber-400/50 select-text"
            />
          </div>
        </Row>
      </Group>

      <Group title="History" footer={notice ?? 'Daily totals for each light are kept for about a year.'}>
        <Row label="Export as a spreadsheet" hint="One row per light per day, as CSV.">
          <GlassButton variant="standard" size="sm" onClick={() => void exportCsv()}>
            <Download className="w-3.5 h-3.5" />
            Export
          </GlassButton>
        </Row>
        <Row label="Clear energy history" hint={confirmReset ? 'This removes every estimate so far. It cannot be undone.' : undefined}>
          {confirmReset ? (
            <div className="flex gap-2">
              <GlassButton variant="subtle" size="sm" onClick={() => setConfirmReset(false)}>
                Cancel
              </GlassButton>
              <GlassButton variant="destructive" size="sm" onClick={() => void reset()}>
                Clear history
              </GlassButton>
            </div>
          ) : (
            <GlassButton variant="subtle" size="sm" onClick={() => setConfirmReset(true)}>
              <RotateCcw className="w-3.5 h-3.5" />
              Reset
            </GlassButton>
          )}
        </Row>
      </Group>
    </div>
  )
}

export default EnergyView
