import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Music2, AlertTriangle, FolderCog, RotateCcw, Play, CheckCircle2, Loader2, Sparkles, Check } from 'lucide-react'
import { GlassButton } from './ui/GlassButton'
import {
  GlassSheet,
  Group,
  Row,
  ToggleButton,
  RangeControl,
  Segmented,
  ColorSwatches,
  LightPicker,
  StatusPill,
  PhotosensitivityNote,
  swatchCss
} from './ui/SettingsControls'
import { EFFECT_ICONS } from '../lib/effectIcons'
import { EFFECT_PRESETS } from '../lib/effectPresets'
import { ScreenSyncSettings } from './ScreenSyncSettings'
import { EffectSnapshotData, NormalizedLightState } from '../types'

type Settings = EffectSnapshotData['settings']

export interface EffectSettingsSheetProps {
  effect: EffectSnapshotData | null
  lights: NormalizedLightState[]
  isDemoMode: boolean
  onClose: () => void
  onToggle: (id: string, on: boolean) => void
}

/**
 * Settings for one effect: target lights, colours and limits, in one level of
 * grouped lists. Changes apply as you make them.
 */
export const EffectSettingsSheet: React.FC<EffectSettingsSheetProps> = ({ effect, lights, isDemoMode, onClose, onToggle }) => {
  const api = window.lumos
  const [draft, setDraft] = useState<Settings | null>(null)
  const [justApplied, setJustApplied] = useState(false)
  const pending = useRef<Record<string, unknown>>({})
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const effectId = effect?.id
  const preset = effect ? EFFECT_PRESETS[effect.id] : null

  // Take the latest settings from the app unless a change is on its way
  useEffect(() => {
    if (!effect) {
      setDraft(null)
      return
    }
    if (Object.keys(pending.current).length === 0) setDraft(effect.settings)
  }, [effect])

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    const patch = pending.current
    pending.current = {}
    if (effectId && Object.keys(patch).length > 0) void api?.updateEffectSettings(effectId, patch)
  }, [api, effectId])

  useEffect(() => () => flush(), [flush])

  const patch = useCallback(
    (p: Record<string, unknown>) => {
      setDraft((d) => (d ? ({ ...d, ...p } as Settings) : d))
      pending.current = { ...pending.current, ...p }
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(flush, 250)
    },
    [flush]
  )

  const applyPreset = useCallback(() => {
    if (!effect || !preset) return
    patch(preset.settings)
    flush()
    if (!effect.settings.enabled) {
      onToggle(effect.id, true)
    }
    setJustApplied(true)
    setTimeout(() => setJustApplied(false), 2500)
  }, [effect, preset, patch, flush, onToggle])

  const close = (): void => {
    flush()
    onClose()
  }

  const Icon = (effect && EFFECT_ICONS[effect.id]) || Music2
  const s = draft

  return (
    <GlassSheet isOpen={Boolean(effect && s)} onClose={close} title={effect?.label ?? ''} subtitle={effect?.description} icon={Icon}>
      {effect && s && (
        <>
          <div className="flex items-center justify-between gap-3 px-1">
            <div className="flex items-center gap-2 min-w-0">
              <StatusPill status={effect.status} />
              <span className="text-[11px] text-zinc-400 truncate">{effect.statusDetail}</span>
            </div>
            <ToggleButton on={effect.settings.enabled} onChange={(on) => onToggle(effect.id, on)} ariaLabel={`${effect.label} on or off`} />
          </div>

          {preset && (
            <div className="flex items-center justify-between gap-3 p-3.5 rounded-2xl bg-amber-400/[0.08] border border-amber-400/25">
              <div className="min-w-0 flex-1 pr-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-amber-300">
                  <Sparkles className="w-4 h-4 flex-shrink-0 text-amber-300" />
                  <span>{preset.name}</span>
                  <span className="text-[10px] font-medium text-amber-300/90 bg-amber-400/15 px-2 py-0.5 rounded-full border border-amber-400/30">
                    {preset.badge}
                  </span>
                </div>
                <p className="text-[11px] text-zinc-300 mt-1 leading-relaxed">
                  {preset.description}
                </p>
              </div>
              <GlassButton
                variant="prominent"
                size="sm"
                onClick={applyPreset}
                aria-label={`Run ${preset.name} preset`}
              >
                {justApplied ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-300" />
                    <span>Applied</span>
                  </>
                ) : (
                  <span>{effect.settings.enabled ? 'Best settings' : 'Run preset'}</span>
                )}
              </GlassButton>
            </div>
          )}

          {effect.status === 'error' && (
            <div role="alert" className="flex items-start gap-2.5 rounded-xl bg-rose-500/10 border border-rose-400/20 px-3 py-2.5 text-[11px] text-rose-200">
              <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-px" />
              <span>{effect.statusDetail || 'This effect could not start.'}</span>
            </div>
          )}

          {effect.id === 'screen' && <ScreenSyncSettings s={s} patch={patch} effect={effect} lights={lights} isDemoMode={isDemoMode} />}
          {effect.id === 'music' && <MusicSettings s={s} patch={patch} effect={effect} />}
          {effect.id === 'album' && <AlbumSettings s={s} patch={patch} effect={effect} isDemoMode={isDemoMode} />}
          {effect.id === 'cycle' && <ColorCycleSettings s={s} patch={patch} />}
          {effect.id === 'fireplace' && <FireplaceSettings s={s} patch={patch} />}
          {effect.id === 'away' && <AwaySettings s={s} patch={patch} effect={effect} isDemoMode={isDemoMode} />}
          {effect.id === 'games' && <GamesSettings s={s} patch={patch} effect={effect} isDemoMode={isDemoMode} />}

          <Group title="Lights">
            <Row label="Lights this effect uses" stacked>
              <LightPicker lights={lights} value={s.targets} onChange={(targets) => patch({ targets })} />
            </Row>
          </Group>

          {effect.pausedLights.length > 0 && (
            <Group title="Paused by hand">
              <Row
                label={`${effect.pausedLights.length} ${effect.pausedLights.length === 1 ? 'light was' : 'lights were'} changed by hand`}
                hint="The effect leaves these lights alone until you resume them."
              >
                <GlassButton variant="standard" size="sm" onClick={() => void api?.resumeEffectLights(effect.id, effect.pausedLights)}>
                  Resume
                </GlassButton>
              </Row>
            </Group>
          )}
        </>
      )}
    </GlassSheet>
  )
}

interface SectionProps {
  s: Settings
  patch: (p: Record<string, unknown>) => void
  effect: EffectSnapshotData
  isDemoMode?: boolean
}

// --- Music ---

const PALETTES: Array<{ value: string; label: string; colors: number[] }> = [
  { value: 'aurora', label: 'Aurora', colors: [165, 195, 275] },
  { value: 'sunset', label: 'Sunset', colors: [12, 32, 330] },
  { value: 'ocean', label: 'Ocean', colors: [185, 210, 240] },
  { value: 'neon', label: 'Neon', colors: [300, 180, 55] },
  { value: 'custom', label: 'Custom', colors: [] }
]

const MusicSettings: React.FC<SectionProps> = ({ s, patch, effect }) => {
  const api = window.lumos
  const [level, setLevel] = useState<{ loudness: number; low: number; beat: boolean; tempo: number | null; silent: boolean } | null>(null)
  const [beatFlash, setBeatFlash] = useState(false)

  // Ask for the live level while this sheet is open
  useEffect(() => {
    if (!api || effect.status === 'off') return
    void api.effectAction('music', 'meter', { on: true })
    const renew = setInterval(() => void api.effectAction('music', 'meter', { on: true }), 20000)
    const unsub = api.onEffectsLive((live) => {
      if (live.effectId !== 'music') return
      setLevel(live.payload)
      if (live.payload?.beat) {
        setBeatFlash(true)
        setTimeout(() => setBeatFlash(false), 120)
      }
    })
    return () => {
      clearInterval(renew)
      unsub()
      void api.effectAction('music', 'meter', { on: false })
    }
  }, [api, effect.status])

  const custom: Array<{ h: number; s: number }> = s.customColors || []

  return (
    <>
      <PhotosensitivityNote />
      <Group
        title="Style"
        footer={
          s.style === 'party'
            ? 'Lights snap to each beat, step to the next colour, and go full white for a moment when the beat drops. Every beat after a drop hits full brightness for a while. The flash limit still applies.'
            : s.style === 'bass'
              ? 'Sub-bass focus: lights roll with the bassline through slow gentle changes and surge to MAX brightness when the beat drops.'
              : 'Lights pulse gently with the beat while the colours drift slowly.'
        }
      >
        <Row label="Style">
          <Segmented
            ariaLabel="Style"
            value={s.style}
            options={[
              { value: 'smooth', label: 'Smooth' },
              { value: 'party', label: 'Party' },
              { value: 'bass', label: 'Bass Drop' }
            ]}
            onChange={(v) => patch({ style: v })}
          />
        </Row>
      </Group>
      <Group title="Listening" footer="Sound is analysed on this computer as it plays. Nothing is recorded, saved, or sent anywhere.">
        <Row label="Level" hint={effect.status === 'off' ? 'Turn the effect on to see the live level.' : level?.tempo ? `About ${level.tempo} beats per minute` : 'Play some music to tune sensitivity.'} stacked>
          <div className="flex items-center gap-3" aria-hidden="true">
            <div className="flex-1 h-2 rounded-full bg-white/[0.08] overflow-hidden">
              <div className="h-full rounded-full bg-gradient-to-r from-emerald-400 via-amber-300 to-rose-400 transition-[width] duration-75" style={{ width: `${Math.round((level?.loudness ?? 0) * 100)}%` }} />
            </div>
            <span className={`w-2.5 h-2.5 rounded-full transition-colors ${beatFlash ? 'bg-amber-300' : 'bg-white/10'}`} title="Beat" />
          </div>
        </Row>
        <Row label="Sensitivity" hint="Higher catches softer beats." stacked>
          <RangeControl ariaLabel="Sensitivity" value={s.sensitivity} min={0} max={100} onChange={(v) => patch({ sensitivity: v })} format={(v) => `${v}%`} />
        </Row>
        <Row
          label="Pause when the music stops"
          hint="After this long without sound, your lights go back to how they were. Music picks up again as soon as something plays."
          stacked
        >
          <RangeControl ariaLabel="Pause when the music stops" value={s.silenceSeconds} min={2} max={60} onChange={(v) => patch({ silenceSeconds: v })} format={(v) => `${v} s`} />
        </Row>
      </Group>

      <Group title="Colour">
        <Row label="Colour set" stacked>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Colour set">
            {PALETTES.map((p) => {
              const selected = s.palette === p.value
              const colors = p.value === 'custom' ? custom.map((c) => c.h) : p.colors
              return (
                <button
                  key={p.value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => patch({ palette: p.value })}
                  className={`flex items-center gap-2 h-9 pl-2.5 pr-3.5 rounded-full border text-[11px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-white/80 transition-colors ${
                    selected ? 'bg-white/[0.12] border-white/30 text-white' : 'bg-white/[0.03] border-white/[0.08] text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  <span className="flex -space-x-1">
                    {colors.slice(0, 3).map((h, i) => (
                      <span key={i} className="w-3.5 h-3.5 rounded-full border border-black/40" style={{ background: swatchCss(h, 90) }} />
                    ))}
                  </span>
                  {p.label}
                </button>
              )
            })}
          </div>
        </Row>
        {s.palette === 'custom' &&
          custom.map((c, i) => (
            <Row key={i} label={`Custom colour ${i + 1}`} stacked>
              <ColorSwatches
                ariaLabel={`Custom colour ${i + 1}`}
                value={c}
                onChange={(next) => patch({ customColors: custom.map((x, j) => (j === i ? next : x)) })}
              />
            </Row>
          ))}
        {s.style !== 'party' && (
          <Row label="Colour drift" hint="How quickly the colours change. Livelier tracks change faster." stacked>
            <RangeControl ariaLabel="Colour drift" value={s.driftSpeed} min={0} max={100} onChange={(v) => patch({ driftSpeed: v })} format={(v) => `${v}%`} />
          </Row>
        )}
        <Row
          label="Spread colours across lights"
          hint={s.style === 'party' ? 'Neighbouring lights show different colours from the set.' : 'Colours move from light to light like a wave.'}
        >
          <ToggleButton on={s.wave} onChange={(on) => patch({ wave: on })} ariaLabel="Spread colours across lights" />
        </Row>
      </Group>

      <Group title="Pulse" footer="When Album color is also on, the album colour is used and Music adds the pulses.">
        <Row
          label="Pulse strength"
          hint={s.style === 'party' ? 'How dark the lights go between beats.' : s.style === 'bass' ? 'How deep the sub-bass pulse travels.' : 'How far brightness moves on each beat.'}
          stacked
        >
          <RangeControl ariaLabel="Pulse strength" value={s.pulseDepth} min={0} max={100} onChange={(v) => patch({ pulseDepth: v })} format={(v) => `${v}%`} />
        </Row>
        <Row label="Most beats per second">
          <Segmented
            ariaLabel="Most beats per second"
            value={s.maxBeatsPerSecond}
            options={[
              { value: 1, label: '1' },
              { value: 2, label: '2' },
              { value: 3, label: '3' }
            ]}
            onChange={(v) => patch({ maxBeatsPerSecond: v })}
          />
        </Row>
      </Group>
    </>
  )
}

// --- Album color ---

const AlbumSettings: React.FC<SectionProps> = ({ s, patch, effect, isDemoMode }) => {
  const api = window.lumos
  const colors: Array<{ h: number; s: number }> = effect.info.colors || []
  return (
    <>
      <Group
        title="Now playing"
        footer="Works with Spotify, Apple Music, web browsers and most media players. Album art stays in memory and is never saved or sent."
      >
        <Row label="Current colours" hint={effect.info.monochrome ? 'Black and white art, so warm white' : colors.length ? undefined : 'Nothing playing right now'}>
          <div className="flex gap-1.5">
            {colors.map((c, i) => (
              <span key={i} className="w-6 h-6 rounded-full border border-white/20" style={{ background: swatchCss(c.h, c.s) }} />
            ))}
          </div>
        </Row>
        {effect.info.helper === false && (
          <Row label="Media session not available" hint="Album color needs Windows 10 or later." />
        )}
      </Group>
      <Group title="Behaviour">
        <Row label="Use several colours from the art" hint="Spreads up to three colours across your lights.">
          <ToggleButton on={s.spreadColors} onChange={(on) => patch({ spreadColors: on })} ariaLabel="Use several colours" />
        </Row>
        <Row label="Return to normal after playback stops" stacked>
          <RangeControl ariaLabel="Return to normal after" value={s.stopDelaySeconds} min={0} max={120} step={5} onChange={(v) => patch({ stopDelaySeconds: v })} format={(v) => (v === 0 ? 'Now' : `${v} s`)} />
        </Row>
      </Group>
      {isDemoMode && (
        <Group title="Demo">
          <Row label="Pretend a track is playing">
            <div className="flex gap-2">
              <GlassButton variant="standard" size="sm" onClick={() => void api?.effectAction('album', 'simulate', {})}>
                New track
              </GlassButton>
              <GlassButton variant="subtle" size="sm" onClick={() => void api?.effectAction('album', 'simulate', { playing: false })}>
                Stop
              </GlassButton>
            </div>
          </Row>
        </Group>
      )}
    </>
  )
}

// --- Chroma Cycle ---

const ColorCycleSettings: React.FC<{ s: Settings; patch: (p: Record<string, unknown>) => void }> = ({ s, patch }) => {
  return (
    <>
      <Group title="Cycle speed" footer="Controls how long it takes to travel through the full 360° color wheel.">
        <Row label="Cycle time" hint="Lower is faster, higher is a slow ambient drift." stacked>
          <RangeControl
            ariaLabel="Cycle time"
            value={Number(s.speed ?? 60)}
            min={10}
            max={300}
            step={5}
            onChange={(v) => patch({ speed: v })}
            format={(v) => `${v}s`}
          />
        </Row>
      </Group>

      <Group title="Color & Light">
        <Row label="Brightness" stacked>
          <RangeControl
            ariaLabel="Brightness"
            value={Number(s.brightness ?? 100)}
            min={1}
            max={100}
            onChange={(v) => patch({ brightness: v })}
            format={(v) => `${v}%`}
          />
        </Row>
        <Row label="Saturation" hint="Lower values produce soft pastels, higher values give vibrant pure hues." stacked>
          <RangeControl
            ariaLabel="Saturation"
            value={Number(s.saturation ?? 100)}
            min={1}
            max={100}
            onChange={(v) => patch({ saturation: v })}
            format={(v) => `${v}%`}
          />
        </Row>
      </Group>

      <Group title="Motion">
        <Row
          label="Spectrum wave"
          hint="Offsets the colors across lights so they form a continuous rainbow across the room."
        >
          <ToggleButton
            on={Boolean(s.wave ?? true)}
            onChange={(on) => patch({ wave: on })}
            ariaLabel="Spectrum wave"
          />
        </Row>
        <Row
          label="Reverse direction"
          hint="Cycles backwards through the spectrum (from red toward violet)."
        >
          <ToggleButton
            on={Boolean(s.reverse ?? false)}
            onChange={(on) => patch({ reverse: on })}
            ariaLabel="Reverse direction"
          />
        </Row>
      </Group>
    </>
  )
}

// --- Acoustic Fireplace ---

const FireplaceSettings: React.FC<{ s: Settings; patch: (p: Record<string, unknown>) => void }> = ({ s, patch }) => {
  return (
    <>
      <Group title="Flame & Embers" footer="Simulates living hearth embers and golden flickering flames.">
        <Row label="Intensity" hint="Maximum brightness level of the fire." stacked>
          <RangeControl
            ariaLabel="Intensity"
            value={Number(s.intensity ?? 80)}
            min={10}
            max={100}
            onChange={(v) => patch({ intensity: v })}
            format={(v) => `${v}%`}
          />
        </Row>
        <Row label="Flame speed" hint="How fast the flames flicker and embers breathe." stacked>
          <RangeControl
            ariaLabel="Flame speed"
            value={Number(s.flameSpeed ?? 50)}
            min={10}
            max={100}
            onChange={(v) => patch({ flameSpeed: v })}
            format={(v) => `${v}%`}
          />
        </Row>
      </Group>

      <Group title="Reactivity">
        <Row
          label="Acoustic reactivity"
          hint="Flames crackle and flare up with low-end bass and audio swells when music plays on this computer."
        >
          <ToggleButton
            on={Boolean(s.acoustic ?? true)}
            onChange={(on) => patch({ acoustic: on })}
            ariaLabel="Acoustic reactivity"
          />
        </Row>
        <Row
          label="Multi-light hearth"
          hint="Offsets flame flicker across lights so each dances independently like different sides of a fireplace."
        >
          <ToggleButton
            on={Boolean(s.wave ?? true)}
            onChange={(on) => patch({ wave: on })}
            ariaLabel="Multi-light hearth"
          />
        </Row>
      </Group>
    </>
  )
}

// --- Away dimming ---

const AwaySettings: React.FC<SectionProps> = ({ s, patch, effect, isDemoMode }) => {
  const api = window.lumos
  return (
    <>
      <Group title="When you step away">
        <Row label="After this long without activity" stacked>
          <RangeControl ariaLabel="Idle time" value={s.idleMinutes} min={1} max={60} onChange={(v) => patch({ idleMinutes: v })} format={(v) => `${v} min`} />
        </Row>
        <Row label="Then">
          <Segmented
            ariaLabel="Idle action"
            value={s.idleAction}
            options={[
              { value: 'dim', label: 'Dim' },
              { value: 'off', label: 'Turn off' }
            ]}
            onChange={(v) => patch({ idleAction: v })}
          />
        </Row>
        <Row label="When the computer locks or sleeps">
          <Segmented
            ariaLabel="Lock action"
            value={s.lockAction}
            options={[
              { value: 'dim', label: 'Dim' },
              { value: 'off', label: 'Turn off' },
              { value: 'none', label: 'Nothing' }
            ]}
            onChange={(v) => patch({ lockAction: v })}
          />
        </Row>
        <Row label="Dim to" stacked>
          <RangeControl ariaLabel="Dim to" value={s.dimPercent} min={1} max={80} onChange={(v) => patch({ dimPercent: v })} format={(v) => `${v}%`} />
        </Row>
      </Group>
      <Group title="While you watch or listen" footer="Lights are left alone while music or video plays or a full-screen app is open, even if you are not touching the computer.">
        <Row label="Stay on while media plays">
          <ToggleButton on={s.stayOnDuringMedia} onChange={(on) => patch({ stayOnDuringMedia: on })} ariaLabel="Stay on while media plays" />
        </Row>
      </Group>
      <Group title="When you come back" footer="Lights you changed by hand while away keep your change.">
        <Row label="Bring lights back">
          <Segmented
            ariaLabel="Restore"
            value={s.restore}
            options={[
              { value: 'fade', label: 'Gently' },
              { value: 'instant', label: 'Straight away' }
            ]}
            onChange={(v) => patch({ restore: v })}
          />
        </Row>
      </Group>
      {isDemoMode && (
        <Group title="Demo">
          <Row label={effect.info.away ? 'Lights are dimmed for away' : 'Pretend you stepped away'}>
            <GlassButton
              variant="standard"
              size="sm"
              disabled={effect.status === 'off'}
              onClick={() => void api?.effectAction('away', 'simulate', { away: !effect.info.away })}
            >
              {effect.info.away ? 'Come back' : 'Step away'}
            </GlassButton>
          </Row>
        </Group>
      )}
    </>
  )
}

// --- Games ---

function ago(at: number): string {
  const s = Math.max(0, Math.round((Date.now() - at) / 1000))
  if (s < 60) return s <= 5 ? 'just now' : `${s} s ago`
  const m = Math.round(s / 60)
  return m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`
}

const TEAM_SOURCE: Record<string, string> = {
  name: 'from your in-game name',
  'team-data': "from your team's car details",
  camera: 'from the player the camera follows'
}

/** What Lumos has received from Rocket League, to check setup and team detection. */
const RocketLeagueDiagnostics: React.FC<{ info: any; running: boolean }> = ({ info, running }) => {
  if (!running || !info) return null
  const messages: number = info.messages ?? 0
  if (messages === 0) {
    return (
      <Row
        label="Nothing received from Rocket League yet"
        hint={
          info.status === 'connected' || info.status === 'in-match'
            ? 'Connected, waiting for the first update.'
            : 'If the game is running, its Stats API is probably off. Choose Turn on above, then restart Rocket League.'
        }
      />
    )
  }
  const goal = info.lastGoal as { outcome: string; at: number } | null
  const team =
    info.team === null || info.team === undefined
      ? 'Not worked out yet. It usually is within a few seconds of kickoff.'
      : `${info.teamName ?? 'Team ' + info.team}, ${TEAM_SOURCE[info.teamSource] ?? 'detected'}`
  return (
    <>
      <Row label="Your team" hint={team} />
      <Row
        label="Receiving from the game"
        hint={[
          `${messages} updates so far; last ${info.lastEvent || 'update'} ${ago(info.lastEventAt)}.`,
          goal
            ? `Last goal ${ago(goal.at)}: ${goal.outcome === 'ours' ? 'your team' : goal.outcome === 'theirs' ? 'the other team' : 'team unknown'}.`
            : ''
        ]
          .filter(Boolean)
          .join(' ')}
      />
    </>
  )
}

interface RlInstall {
  source: string
  path: string
  configPath: string
  configured: boolean
  hasBackup: boolean
}

interface Cs2Install {
  path: string
  installed: boolean
  gameFolder: string
}

const GamesSettings: React.FC<SectionProps> = ({ s, patch, effect, isDemoMode }) => {
  const api = window.lumos
  const rl = s.rocketLeague
  const [rlInstalls, setRlInstalls] = useState<RlInstall[] | null>(null)
  const [csInstalls, setCsInstalls] = useState<Cs2Install[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [name, setName] = useState(rl.playerName)

  useEffect(() => setName(rl.playerName), [rl.playerName])

  useEffect(() => {
    if (!api) return
    api.effectAction('games', 'rl-detect').then((r) => setRlInstalls(r.ok ? r.result : []))
    api.effectAction('games', 'cs2-detect').then((r) => setCsInstalls(r.ok ? r.result : []))
  }, [api])

  const run = async (key: string, action: string, payload: unknown, okText: string): Promise<void> => {
    if (!api) return
    setBusy(key)
    setMessage(null)
    const r = await api.effectAction('games', action, payload)
    setBusy(null)
    if (r.ok) {
      setMessage({ kind: 'ok', text: okText })
      if (r.result?.installs) {
        if (action.startsWith('rl')) setRlInstalls(r.result.installs)
        else setCsInstalls(r.result.installs)
      }
    } else {
      setMessage({ kind: 'error', text: r.error || 'That did not work.' })
    }
  }

  const setRl = (p: Record<string, unknown>): void => patch({ rocketLeague: { ...rl, ...p } })

  return (
    <>
      <PhotosensitivityNote />

      {message && (
        <div
          role="status"
          className={`flex items-start gap-2.5 rounded-xl px-3 py-2.5 text-[11px] border ${
            message.kind === 'ok' ? 'bg-emerald-500/10 border-emerald-400/20 text-emerald-200' : 'bg-rose-500/10 border-rose-400/20 text-rose-200'
          }`}
        >
          {message.kind === 'ok' ? <CheckCircle2 className="w-4 h-4 flex-shrink-0" /> : <AlertTriangle className="w-4 h-4 flex-shrink-0" />}
          <span>{message.text}</span>
        </div>
      )}

      <Group
        title="Rocket League"
        footer="Uses the game's official Stats API. It has to be switched on in the game's DefaultStatsAPI.ini; Lumos can do that for you, keeps a backup, and can undo it. Restart the game afterwards."
      >
        <Row label="Flash for goals">
          <ToggleButton on={rl.enabled} onChange={(on) => setRl({ enabled: on })} ariaLabel="Rocket League goal flash" />
        </Row>
        <RocketLeagueDiagnostics info={effect.info.rocketLeague} running={effect.status !== 'off' && rl.enabled} />
        <Row
          label="Your in-game name (optional)"
          hint="Lumos works out your team on its own. Enter your name only if it gets your team wrong; clan tags and capitals do not matter. Stored only on this computer."
          stacked
        >
          <input
            type="text"
            value={name}
            maxLength={64}
            placeholder="Name shown in matches"
            onChange={(e) => setName(e.target.value)}
            onBlur={() => setRl({ playerName: name.trim() })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            }}
            className="h-9 px-3 rounded-xl bg-black/30 border border-white/[0.08] text-xs text-white placeholder:text-zinc-600 outline-none focus:border-amber-400/50 select-text"
          />
        </Row>
        {rlInstalls === null ? (
          <Row label="Looking for the game">
            <Loader2 className="w-4 h-4 text-zinc-500 animate-spin" />
          </Row>
        ) : rlInstalls.length === 0 ? (
          <Row label="Rocket League was not found" hint="Steam and Epic installs are detected automatically. You can still turn the Stats API on yourself; see the README." />
        ) : (
          rlInstalls.map((inst) => (
            <Row key={inst.path} label={`${inst.source} install`} hint={inst.configured ? 'Stats API is on' : 'Stats API is off'}>
              <div className="flex gap-2">
                {!inst.configured && (
                  <GlassButton
                    variant="prominent"
                    size="sm"
                    disabled={busy !== null}
                    onClick={() => void run(`rl-on-${inst.path}`, 'rl-enable', { path: inst.path }, 'Stats API turned on. Restart Rocket League for it to take effect.')}
                  >
                    {busy === `rl-on-${inst.path}` ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FolderCog className="w-3.5 h-3.5" />}
                    Turn on
                  </GlassButton>
                )}
                {inst.hasBackup && (
                  <GlassButton
                    variant="subtle"
                    size="sm"
                    disabled={busy !== null}
                    onClick={() => void run(`rl-off-${inst.path}`, 'rl-revert', { path: inst.path }, 'Original settings restored. Restart Rocket League.')}
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    Undo
                  </GlassButton>
                )}
              </div>
            </Row>
          ))
        )}
        <Row label="Your goal">
          <ToggleButton on={rl.useTeamColor} labels={['Team colour', 'Chosen colour']} onChange={(on) => setRl({ useTeamColor: on })} ariaLabel="Use your team colour" />
        </Row>
        {!rl.useTeamColor && (
          <Row label="Colour for your goals" stacked>
            <ColorSwatches ariaLabel="Colour for your goals" value={rl.ourGoalColor} onChange={(c) => setRl({ ourGoalColor: c })} />
          </Row>
        )}
        <Row label="Colour for opponent goals" stacked>
          <ColorSwatches ariaLabel="Colour for opponent goals" value={rl.theirGoalColor} onChange={(c) => setRl({ theirGoalColor: c })} />
        </Row>
        <Row label="Flashes per goal" stacked>
          <RangeControl ariaLabel="Flashes per goal" value={rl.flashCount} min={1} max={6} onChange={(v) => setRl({ flashCount: v })} />
        </Row>
        <Row label="Length of each flash" stacked>
          <RangeControl ariaLabel="Length of each flash" value={rl.flashMs} min={150} max={1000} step={50} onChange={(v) => setRl({ flashMs: v })} format={(v) => `${(v / 1000).toFixed(2)} s`} />
        </Row>
        <Row label="Wait between goal flashes" stacked>
          <RangeControl ariaLabel="Wait between goal flashes" value={rl.cooldownSeconds} min={0} max={30} onChange={(v) => setRl({ cooldownSeconds: v })} format={(v) => `${v} s`} />
        </Row>
        <Row label="Flash at kickoff">
          <ToggleButton on={rl.matchStart} onChange={(on) => setRl({ matchStart: on })} ariaLabel="Flash at kickoff" />
        </Row>
        <Row label="Flash when the match ends" hint="Win and loss colours.">
          <ToggleButton on={rl.matchEnd} onChange={(on) => setRl({ matchEnd: on })} ariaLabel="Flash when the match ends" />
        </Row>
        <Row label="Try it">
          <div className="flex gap-2">
            <GlassButton variant="standard" size="sm" disabled={effect.status === 'off'} onClick={() => void api?.effectAction('games', 'test-flash', { kind: 'ours' })}>
              <Play className="w-3.5 h-3.5" /> Your goal
            </GlassButton>
            <GlassButton variant="standard" size="sm" disabled={effect.status === 'off'} onClick={() => void api?.effectAction('games', 'test-flash', { kind: 'theirs' })}>
              Opponent
            </GlassButton>
          </div>
        </Row>
      </Group>

      <Group
        title="Counter-Strike 2"
        footer="Uses Valve's official Game State Integration. Lumos adds a small config file to the game's cfg folder and listens only on this computer. Restart the game afterwards."
      >
        <Row label="Pulse on low health">
          <ToggleButton on={s.cs2.enabled} onChange={(on) => patch({ cs2: { ...s.cs2, enabled: on } })} ariaLabel="Counter-Strike 2 low health" />
        </Row>
        {csInstalls === null ? (
          <Row label="Looking for the game">
            <Loader2 className="w-4 h-4 text-zinc-500 animate-spin" />
          </Row>
        ) : csInstalls.length === 0 ? (
          <Row label="Counter-Strike 2 was not found" hint="Steam libraries are detected automatically." />
        ) : (
          csInstalls.map((inst) => (
            <Row key={inst.path} label="Steam install" hint={inst.installed ? 'Config file added' : 'Config file not added yet'}>
              {inst.installed ? (
                <GlassButton variant="subtle" size="sm" disabled={busy !== null} onClick={() => void run(`cs-off-${inst.path}`, 'cs2-remove', { path: inst.path }, 'Config file removed.')}>
                  <RotateCcw className="w-3.5 h-3.5" /> Remove
                </GlassButton>
              ) : (
                <GlassButton
                  variant="prominent"
                  size="sm"
                  disabled={busy !== null}
                  onClick={() => void run(`cs-on-${inst.path}`, 'cs2-install', { path: inst.path }, 'Config file added. Restart Counter-Strike 2 for it to take effect.')}
                >
                  {busy === `cs-on-${inst.path}` ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FolderCog className="w-3.5 h-3.5" />}
                  Add config
                </GlassButton>
              )}
            </Row>
          ))
        )}
      </Group>

      <Group title="League of Legends" footer="Uses Riot's official Live Client Data API on this computer. Nothing to set up.">
        <Row label="Pulse on low health">
          <ToggleButton on={s.league.enabled} onChange={(on) => patch({ league: { enabled: on } })} ariaLabel="League of Legends low health" />
        </Row>
      </Group>

      <Group title="Low health" footer="The pulse starts slow and speeds up as health drops. Only shown while you are alive in a match.">
        <Row label="Start pulsing below" stacked>
          <RangeControl ariaLabel="Low health threshold" value={s.health.threshold} min={5} max={90} step={5} onChange={(v) => patch({ health: { ...s.health, threshold: v } })} format={(v) => `${v}%`} />
        </Row>
        <Row label="Pulse colour" stacked>
          <ColorSwatches ariaLabel="Pulse colour" value={s.health.color} onChange={(c) => patch({ health: { ...s.health, color: c } })} />
        </Row>
        <Row label="Include lights that are off" hint="Goal flashes turn these on briefly.">
          <ToggleButton on={s.flashLightsThatAreOff} onChange={(on) => patch({ flashLightsThatAreOff: on })} ariaLabel="Include lights that are off" />
        </Row>
      </Group>

      {isDemoMode && (
        <Group title="Demo">
          <Row label="Simulate game events">
            <div className="flex flex-wrap gap-2 justify-end">
              {[
                ['goal-ours', 'Your goal'],
                ['goal-theirs', 'Opponent goal'],
                ['health', 'Low health'],
                ['health-end', 'Healed']
              ].map(([event, label]) => (
                <GlassButton
                  key={event}
                  variant="standard"
                  size="sm"
                  disabled={effect.status === 'off'}
                  onClick={() => void api?.effectAction('games', 'simulate', { event, health: 0.12 })}
                >
                  {label}
                </GlassButton>
              ))}
            </div>
          </Row>
        </Group>
      )}
    </>
  )
}

export default EffectSettingsSheet
