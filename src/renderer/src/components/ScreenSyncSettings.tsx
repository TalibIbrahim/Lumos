import React, { useEffect, useState } from 'react'
import { AlertTriangle, Info } from 'lucide-react'
import { Group, Row, ToggleButton, RangeControl, Segmented, PhotosensitivityNote } from './ui/SettingsControls'
import { EffectSnapshotData, LightPosition, NormalizedLightState } from '../types'
import { hsvToRgb, cctToRgb } from '../lib/color'

type Settings = EffectSnapshotData['settings']

interface Rect {
  x0: number
  y0: number
  x1: number
  y1: number
}

interface BulbColor {
  colour: boolean
  h: number
  s: number
  brightness: number
  colorTemp: number
}

interface Preview {
  image?: string
  width: number
  height: number
  zones: Record<string, Rect>
  bars: { top: number; bottom: number; left: number; right: number }
  colors: Record<string, BulbColor>
}

interface DisplayInfo {
  id: string
  label: string
  primary: boolean
  width: number
  height: number
}

const POSITIONS: Array<{ value: LightPosition | ''; label: string }> = [
  { value: '', label: 'Off' },
  { value: 'left', label: 'Left' },
  { value: 'top', label: 'Top' },
  { value: 'center', label: 'Center' },
  { value: 'bottom', label: 'Bottom' },
  { value: 'right', label: 'Right' }
]

const SHORTCUT_LABELS: Record<string, string> = {
  '': 'None',
  'CommandOrControl+Alt+S': 'Ctrl+Alt+S',
  'CommandOrControl+Shift+S': 'Ctrl+Shift+S',
  'CommandOrControl+Alt+L': 'Ctrl+Alt+L'
}

/** What a bulb is being sent, as a CSS colour for the preview. */
export function bulbCss(c: BulbColor | undefined): string {
  if (!c || c.brightness <= 0) return '#18181b'
  const rgb = c.colour ? hsvToRgb(c.h, c.s, 100) : cctToRgb(c.colorTemp)
  const k = 0.35 + 0.65 * (c.brightness / 100)
  return `rgb(${Math.round(rgb.r * k)}, ${Math.round(rgb.g * k)}, ${Math.round(rgb.b * k)})`
}

const ISSUES: Record<string, { title: string; body: React.ReactNode }> = {
  'no-positions': {
    title: 'Give your lights a position',
    body: 'Screen Sync uses the lights you place around the screen. Choose Left, Right, Top, Bottom, or Center for at least one light below.'
  },
  'all-paused': {
    title: 'Paused on the lights you changed by hand',
    body: 'You changed these lights yourself, so Screen Sync is leaving them alone. Choose Resume below to hand them back.'
  },
  protected: {
    title: 'The picture looks black to Lumos',
    body: (
      <>
        Many streaming apps and some video players protect what they show, so screen capture sees only black. Lumos does not get around
        this. Try playing the video in a web browser with hardware acceleration turned off, or use another source.
      </>
    )
  },
  exclusive: {
    title: 'A full-screen game cannot be captured',
    body: 'Games running in exclusive full screen often cannot be seen by screen capture. Switch the game to borderless windowed mode in its display settings.'
  },
  'display-missing': {
    title: 'The chosen display is not connected',
    body: 'Screen Sync is following the main display until it comes back.'
  },
  'capture-failed': {
    title: 'The screen could not be captured',
    body: 'Check that the display is on, then turn Screen Sync off and on again.'
  },
  'no-frames': {
    title: 'Waiting for the screen',
    body: 'The display may be asleep. Screen Sync carries on when the picture comes back.'
  }
}

export const ScreenSyncSettings: React.FC<{
  s: Settings
  patch: (p: Record<string, unknown>) => void
  effect: EffectSnapshotData
  lights: NormalizedLightState[]
  isDemoMode: boolean
}> = ({ s, patch, effect, lights, isDemoMode }) => {
  const api = window.lumos
  const [preview, setPreview] = useState<Preview | null>(null)
  const [displays, setDisplays] = useState<DisplayInfo[]>([])
  const running = effect.status !== 'off'
  const info = effect.info

  // Ask for the live preview while this sheet is open
  useEffect(() => {
    if (!api || !running) return
    void api.effectAction('screen', 'preview', { on: true })
    const renew = setInterval(() => void api.effectAction('screen', 'preview', { on: true }), 20000)
    const unsub = api.onEffectsLive((live) => {
      if (live.effectId === 'screen') setPreview(live.payload as Preview)
    })
    return () => {
      clearInterval(renew)
      unsub()
      void api.effectAction('screen', 'preview', { on: false })
    }
  }, [api, running])

  useEffect(() => {
    api?.effectAction('screen', 'displays').then((r) => setDisplays(r.ok && Array.isArray(r.result) ? r.result : []))
  }, [api])

  const setPosition = (id: string, position: LightPosition | ''): void => {
    void api?.setDeviceMeta(id, { position: position || null })
  }

  const issue = info.issue ? ISSUES[info.issue as string] : null
  const placed = lights.filter((l) => l.position)
  const colors: Record<string, BulbColor> = preview?.colors ?? (info.colors as Record<string, BulbColor>) ?? {}
  const zones = preview?.zones ?? {}
  const nameOf = (id: string): string => {
    const l = lights.find((x) => x.id === id)
    return l?.customName || l?.name || 'Light'
  }

  return (
    <>
      {issue && (
        <div role="status" className="flex items-start gap-2.5 rounded-xl bg-white/[0.05] border border-white/[0.1] px-3 py-2.5 text-[12px] text-zinc-200">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-px text-amber-300" />
          <div className="flex flex-col gap-0.5">
            <span className="font-medium text-white">{issue.title}</span>
            <span className="text-zinc-400 leading-relaxed">
              {issue.body}
              {info.issue === 'capture-failed' && info.captureError ? ` (${String(info.captureError)})` : ''}
            </span>
          </div>
        </div>
      )}

      <Group title="Preview" footer="The picture is analysed on this computer as it plays. Nothing is recorded, saved, or sent anywhere.">
        <div className="p-3">
          <div className="relative w-full aspect-video rounded-xl overflow-hidden bg-zinc-950 border border-white/[0.06]">
            {preview?.image ? (
              <img src={preview.image} alt="" className="absolute inset-0 w-full h-full object-cover" />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-[11px] text-zinc-500 px-6 text-center">
                {!running ? 'Turn Screen Sync on to see what it sees.' : isDemoMode ? 'Playing the built-in sample.' : 'Waiting for the first picture.'}
              </div>
            )}
            <svg viewBox="0 0 160 90" className="absolute inset-0 w-full h-full" aria-hidden="true" preserveAspectRatio="none">
              {preview && (preview.bars.top > 0 || preview.bars.bottom > 0) && (
                <>
                  <rect x="0" y="0" width="160" height={preview.bars.top} fill="rgba(0,0,0,0.55)" />
                  <rect x="0" y={90 - preview.bars.bottom} width="160" height={preview.bars.bottom} fill="rgba(0,0,0,0.55)" />
                </>
              )}
              {Object.entries(zones).map(([id, r]) => (
                <rect
                  key={id}
                  x={r.x0 + 0.5}
                  y={r.y0 + 0.5}
                  width={Math.max(0, r.x1 - r.x0 - 1)}
                  height={Math.max(0, r.y1 - r.y0 - 1)}
                  fill="none"
                  stroke="rgba(255,255,255,0.85)"
                  strokeWidth="0.8"
                  strokeDasharray="2 1.5"
                />
              ))}
            </svg>
          </div>
          {placed.length > 0 && (
            <ul className="flex flex-wrap gap-2 pt-3">
              {placed.map((l) => (
                <li key={l.id} className="flex items-center gap-2 h-8 pl-1.5 pr-3 rounded-full bg-white/[0.04] border border-white/[0.07] text-[11px] text-zinc-300">
                  <span className="w-5 h-5 rounded-full border border-white/20" style={{ background: bulbCss(colors[l.id]) }} aria-hidden="true" />
                  {nameOf(l.id)} · {l.position}
                </li>
              ))}
            </ul>
          )}
        </div>
        {running && (
          <Row
            label="Screen to light"
            hint={
              info.latencyMs != null
                ? [
                    `About ${info.latencyMs} ms from a change on screen to the bulb answering.`,
                    info.ackMs != null ? `The bulbs answer in about ${info.ackMs} ms.` : '',
                    info.analysisMs != null && info.framesPerSecond
                      ? `Analysis takes ${info.analysisMs} ms per frame at ${info.framesPerSecond} frames a second.`
                      : ''
                  ]
                    .filter(Boolean)
                    .join(' ')
                : 'Measured once the lights start following the screen.'
            }
          >
            <span className="font-mono text-xs text-zinc-300 whitespace-nowrap flex-shrink-0">{info.latencyMs != null ? `${info.latencyMs} ms` : '…'}</span>
          </Row>
        )}
      </Group>

      <Group title="Positions" footer="Lights left Off are not used by Screen Sync. Lights that share a position split that part of the screen between them.">
        {lights.map((l) => (
          <Row key={l.id} label={l.customName || l.name} stacked>
            <Segmented
              ariaLabel={`Position of ${l.customName || l.name}`}
              value={(l.position ?? '') as LightPosition | ''}
              options={POSITIONS}
              onChange={(v) => setPosition(l.id, v)}
            />
          </Row>
        ))}
      </Group>

      <Group title="Response">
        <Row label="Mode" hint={s.mode === 'cinema' ? 'Smooth, gentle changes for films.' : s.mode === 'gaming' ? 'Fast response for games.' : 'Your own settings.'}>
          <Segmented
            ariaLabel="Mode"
            value={s.mode as string}
            options={[
              { value: 'cinema', label: 'Cinema' },
              { value: 'gaming', label: 'Gaming' },
              { value: 'custom', label: 'Custom' }
            ]}
            onChange={(v) => patch({ mode: v })}
          />
        </Row>
        <Row label="Response speed" stacked>
          <RangeControl
            ariaLabel="Response speed"
            value={s.responseSpeed}
            min={0}
            max={100}
            onChange={(v) => patch({ mode: 'custom', responseSpeed: v })}
            format={(v) => `${v}%`}
          />
        </Row>
      </Group>

      <Group title="Colour and brightness">
        <Row
          label="Full brightness"
          hint="Always project at maximum brightness so ambient light reaches across the room, even during dark scenes."
        >
          <ToggleButton on={!!s.fullBrightness} onChange={(on) => patch({ fullBrightness: on })} ariaLabel="Full brightness" />
        </Row>
        <Row
          label="Movie mode"
          hint="Colour only, and easy on the eyes: the lights match the picture instead of switching to plain white, and brightness rises slowly so a cut to a bright scene never flashes. Dim in dark scenes does not apply."
        >
          <ToggleButton on={!!s.colourOnly} onChange={(on) => patch({ colourOnly: on })} ariaLabel="Movie mode" />
        </Row>
        {s.colourOnly && (
          <>
            <Row label="Turn off in dark scenes" hint="When off, dark scenes stay dim at the minimum brightness instead of going out.">
              <ToggleButton on={s.movieOffInDark !== false} onChange={(on) => patch({ movieOffInDark: on })} ariaLabel="Turn off in dark scenes" />
            </Row>
            <Row label="Movie brightness" hint="The most the lights ever show, as a share of Maximum brightness. Lower it if you do not want to notice the lights during a film." stacked>
              <RangeControl ariaLabel="Movie brightness" value={s.movieCeiling ?? 60} min={10} max={100} onChange={(v) => patch({ movieCeiling: v })} format={(v) => `${v}%`} />
            </Row>
            <Row label="Fade back slowly" hint="When Screen Sync stops, or the PC locks, the lights ease back to your normal light over several seconds and dip through darkness on the way, so the bright white never snaps on.">
              <ToggleButton on={s.movieSlowStop !== false} onChange={(on) => patch({ movieSlowStop: on })} ariaLabel="Fade back slowly" />
            </Row>
            <Row label="Rise speed" hint="How fast the lights may get brighter. Lower is gentler; getting darker is never slowed down." stacked>
              <RangeControl ariaLabel="Rise speed" value={s.movieRise ?? 25} min={5} max={100} onChange={(v) => patch({ movieRise: v })} format={(v) => `${v} per second`} />
            </Row>
          </>
        )}
        <Row label="Saturation boost" stacked>
          <RangeControl ariaLabel="Saturation boost" value={s.saturation} min={0} max={100} onChange={(v) => patch({ saturation: v })} format={(v) => `${v}%`} />
        </Row>
        {!s.fullBrightness && (
          <Row label="Minimum brightness" hint="Bulbs behave badly near zero. At 0 the lights turn off in black scenes." stacked>
            <RangeControl ariaLabel="Minimum brightness" value={s.minBrightness} min={0} max={60} onChange={(v) => patch({ minBrightness: v })} format={(v) => `${v}%`} />
          </Row>
        )}
        <Row label="Maximum brightness" stacked>
          <RangeControl ariaLabel="Maximum brightness" value={s.maxBrightness} min={10} max={100} onChange={(v) => patch({ maxBrightness: v })} format={(v) => `${v}%`} />
        </Row>
        <Row label="Edge width" hint="How much of the picture next to each edge a light follows." stacked>
          <RangeControl ariaLabel="Edge width" value={s.edgeWidth} min={5} max={40} onChange={(v) => patch({ edgeWidth: v })} format={(v) => `${v}%`} />
        </Row>
        <Row label="Intensity" stacked>
          <RangeControl ariaLabel="Intensity" value={s.intensity} min={10} max={100} onChange={(v) => patch({ intensity: v })} format={(v) => `${v}%`} />
        </Row>
        <Row label="Ignore black bars" hint="Films with bars above and below do not make the lights dark.">
          <ToggleButton on={s.ignoreBars} onChange={(on) => patch({ ignoreBars: on })} ariaLabel="Ignore black bars" />
        </Row>
        {!s.fullBrightness && (
          <Row label="Dim in dark scenes">
            <ToggleButton on={s.dimDarkScenes} onChange={(on) => patch({ dimDarkScenes: on })} ariaLabel="Dim in dark scenes" />
          </Row>
        )}
      </Group>

      <Group title="Safety">
        <Row label="Limit brightness changes" hint="Rapid flashes on screen become gentler changes on the lights.">
          <ToggleButton on={s.limiter} onChange={(on) => patch({ limiter: on })} ariaLabel="Limit brightness changes" />
        </Row>
      </Group>
      <PhotosensitivityNote />

      <Group title="Display">
        {displays.length === 0 ? (
          <Row label={isDemoMode ? 'Built-in sample' : 'Main display'} hint={isDemoMode ? 'Demo mode plays a sample sequence instead of the screen.' : undefined} />
        ) : (
          <Row label="Follow this display" stacked>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Display">
              {[{ id: '', label: 'Main display', primary: false, width: 0, height: 0 }, ...displays].map((d) => {
                const selected = s.displayId === d.id
                return (
                  <button
                    key={d.id || 'main'}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => patch({ displayId: d.id })}
                    className={`h-9 px-3.5 rounded-full text-xs font-medium border transition-colors outline-none focus-visible:ring-2 focus-visible:ring-white/80 ${
                      selected ? 'bg-amber-400/15 border-amber-400/40 text-amber-200' : 'bg-white/[0.03] border-white/[0.08] text-zinc-300 hover:text-white'
                    }`}
                  >
                    {d.label}
                    {d.width ? ` · ${d.width}×${d.height}` : ''}
                    {d.primary ? ' · main' : ''}
                  </button>
                )
              })}
            </div>
          </Row>
        )}
        {info.remoteSession && (
          <Row label="Remote desktop" hint="In a remote desktop session Lumos sees the remote session's screen, which may update slowly." />
        )}
      </Group>

      <Group title="Shortcut" footer="Works from anywhere, even while Lumos is in the tray.">
        <Row label="Turn Screen Sync on or off" stacked>
          <Segmented
            ariaLabel="Keyboard shortcut"
            value={s.shortcut as string}
            options={Object.entries(SHORTCUT_LABELS).map(([value, label]) => ({ value, label }))}
            onChange={(v) => patch({ shortcut: v })}
          />
        </Row>
      </Group>

      <p className="flex items-start gap-2 text-[11px] text-zinc-500 leading-relaxed px-1">
        <Info className="w-3.5 h-3.5 flex-shrink-0 mt-px" />
        With HDR turned on, Windows hands screen capture a standard-range picture, so very bright highlights may look a little flatter on the
        lights.
      </p>
    </>
  )
}

export default ScreenSyncSettings
