import React, { useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { ShieldCheck, ChevronRight, LightbulbOff } from 'lucide-react'
import { GlassSurface } from './ui/GlassSurface'
import { GlassButton } from './ui/GlassButton'
import { StatusPill, ToggleButton, GlassSheet, Group, Row, Segmented, RangeControl, PhotosensitivityNote } from './ui/SettingsControls'
import { EffectSettingsSheet } from './EffectSettingsSheet'
import { springs } from '../lib/constants'
import { EFFECT_ICONS } from '../lib/effectIcons'
import { EffectsSnapshotData, EffectSnapshotData, NormalizedLightState, WebhookInfo } from '../types'

type GameState = 'off' | 'waiting' | 'connected' | 'in-match' | 'error'
const GAME_STATE_LABEL: Record<GameState, string> = {
  off: 'Off',
  waiting: 'Waiting for game',
  connected: 'Connected',
  'in-match': 'In a match',
  error: 'Needs attention'
}
const GAME_STATE_DOT: Record<GameState, string> = {
  off: 'bg-zinc-600',
  waiting: 'bg-sky-400/70',
  connected: 'bg-emerald-400',
  'in-match': 'bg-emerald-400 animate-pulse',
  error: 'bg-rose-400'
}

export interface EffectsViewProps {
  snapshot: EffectsSnapshotData | null
  lights: NormalizedLightState[]
  isDemoMode: boolean
  onToggle: (id: string, on: boolean) => void
  /** Name of the computer the effects run on, when this one controls another computer's lights. */
  runningOn?: string | null
}

/**
 * Effects page: one card per effect with its status and an on/off toggle.
 * Tapping a card opens its settings sheet.
 */
export const EffectsView: React.FC<EffectsViewProps> = ({ snapshot, lights, isDemoMode, onToggle, runningOn }) => {
  const reduceMotion = useReducedMotion()
  const [openId, setOpenId] = useState<string | null>(null)
  const [safetyOpen, setSafetyOpen] = useState(false)
  const noLights = lights.length === 0

  if (!snapshot) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-[148px] rounded-[20px] bg-white/[0.03] border border-white/[0.06] animate-pulse" />
        ))}
      </div>
    )
  }

  const open = snapshot.effects.find((e) => e.id === openId) || null

  return (
    <div className="flex flex-col gap-6">
      {runningOn && (
        <p className="text-xs text-zinc-400 px-1">
          These effects run on {runningOn}. Music and Album color follow what plays on that computer.
        </p>
      )}

      {noLights && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-2xl bg-white/[0.03] border border-white/[0.06] text-xs text-zinc-400">
          <LightbulbOff className="w-4 h-4 text-zinc-500 flex-shrink-0" />
          Effects need at least one light. Add your lights or try Demo Mode to see them in action.
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {snapshot.effects.map((effect, i) => (
          <motion.div
            key={effect.id}
            initial={reduceMotion ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...springs.enter, delay: reduceMotion ? 0 : i * 0.04 }}
          >
            <EffectCard
              effect={effect}
              lights={lights}
              disabled={noLights}
              onOpen={() => setOpenId(effect.id)}
              onToggle={(on) => onToggle(effect.id, on)}
              note={yieldNote(effect, snapshot)}
            />
          </motion.div>
        ))}
      </div>

      <button
        type="button"
        onClick={() => setSafetyOpen(true)}
        className="group w-full flex items-center justify-between gap-3 px-4 h-12 rounded-2xl bg-white/[0.03] border border-white/[0.06] hover:bg-white/[0.05] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-white/80"
      >
        <span className="flex items-center gap-3">
          <ShieldCheck className="w-4 h-4 text-zinc-400 group-hover:text-amber-300 transition-colors" />
          <span className="text-xs font-medium text-white">Effect safety and performance</span>
        </span>
        <span className="flex items-center gap-2 text-[11px] text-zinc-500">
          {snapshot.global.bulbProtection
            ? 'Bulb protection on'
            : `Up to ${snapshot.global.maxFlashesPerSecond} flashes per second`}
          {snapshot.global.reduceIntensity ? ', reduced intensity' : ''}
          <ChevronRight className="w-3.5 h-3.5" />
        </span>
      </button>

      <EffectSettingsSheet
        effect={open}
        lights={lights}
        isDemoMode={isDemoMode}
        onClose={() => setOpenId(null)}
        onToggle={onToggle}
      />
      <SafetySheet isOpen={safetyOpen} onClose={() => setSafetyOpen(false)} snapshot={snapshot} />
    </div>
  )
}

/** Music and Album color step aside on the lights Screen Sync drives; say so on their cards. */
function yieldNote(effect: EffectSnapshotData, snapshot: EffectsSnapshotData): string | null {
  if (effect.id !== 'music' && effect.id !== 'album') return null
  const screen = snapshot.effects.find((e) => e.id === 'screen')
  if (!effect.settings.enabled || !screen || screen.status !== 'active') return null
  return 'Screen Sync is controlling the lights it has a position for, so this effect waits on those lights.'
}

const EffectCard: React.FC<{
  effect: EffectSnapshotData
  lights: NormalizedLightState[]
  disabled: boolean
  onOpen: () => void
  onToggle: (on: boolean) => void
  note?: string | null
}> = ({ effect, lights, disabled, onOpen, onToggle, note }) => {
  const Icon = EFFECT_ICONS[effect.id] || ShieldCheck
  const on = effect.settings.enabled
  const active = effect.status === 'active'
  const pausedNames = effect.pausedLights
    .map((id) => lights.find((l) => l.id === id))
    .filter(Boolean)
    .map((l) => l!.customName || l!.name)

  return (
    <GlassSurface
      intensity="medium"
      borderRadius={20}
      interactive
      onClick={onOpen}
      glowColor={active ? 'radial-gradient(ellipse at 20% 0%, rgba(251,191,36,0.35), transparent 70%)' : undefined}
      glowOpacity={active ? 0.5 : 0}
      className="p-4 flex flex-col gap-3 cursor-pointer h-full"
    >
      <div
        className="flex flex-col gap-3 w-full"
        role="button"
        tabIndex={0}
        aria-label={`${effect.label} settings`}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onOpen()
          }
        }}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div
              className={`w-10 h-10 rounded-xl border flex items-center justify-center flex-shrink-0 transition-colors ${
                on ? 'bg-amber-400/15 border-amber-400/30 text-amber-300' : 'bg-white/[0.05] border-white/[0.08] text-zinc-400'
              }`}
            >
              <Icon className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h3 className="text-[15px] font-semibold text-white tracking-tight truncate">{effect.label}</h3>
              <StatusPill status={effect.status} />
            </div>
          </div>
          <ToggleButton on={on} disabled={disabled} onChange={onToggle} ariaLabel={`${effect.label} on or off`} />
        </div>

        <p className="text-xs text-zinc-400 leading-relaxed">
          {effect.status === 'off' || !effect.statusDetail ? effect.description : effect.statusDetail}
        </p>

        {effect.id === 'games' && <GamesStatusList info={effect.info} enabled={on} />}

        {note && <p className="text-[11px] text-amber-200/80">{note}</p>}

        {pausedNames.length > 0 && (
          <p className="text-[11px] text-zinc-500">
            Paused on {pausedNames.join(', ')} because {pausedNames.length === 1 ? 'it was' : 'they were'} changed by hand.
          </p>
        )}
      </div>
    </GlassSurface>
  )
}

const GamesStatusList: React.FC<{ info: Record<string, any>; enabled: boolean }> = ({ info, enabled }) => {
  const rows: Array<{ name: string; state: GameState; detail?: string }> = [
    { name: 'Rocket League', state: (info.rocketLeague?.status as GameState) || 'off' },
    { name: 'Counter-Strike 2', state: (info.cs2?.status as GameState) || 'off', detail: info.cs2?.error },
    { name: 'League of Legends', state: (info.league?.status as GameState) || 'off' }
  ]
  return (
    <div className="flex flex-col rounded-xl bg-black/20 border border-white/[0.05] divide-y divide-white/[0.04]">
      {rows.map((r) => {
        const state: GameState = enabled ? r.state : 'off'
        return (
          <div key={r.name} className="flex items-center justify-between px-3 h-8">
            <span className="text-[11px] text-zinc-300">{r.name}</span>
            <span className="flex items-center gap-1.5 text-[10px] text-zinc-400" title={r.detail || undefined}>
              <span className={`w-1.5 h-1.5 rounded-full ${GAME_STATE_DOT[state]}`} />
              {state === 'error' && r.detail ? r.detail : GAME_STATE_LABEL[state]}
            </span>
          </div>
        )
      })}
    </div>
  )
}

const SafetySheet: React.FC<{ isOpen: boolean; onClose: () => void; snapshot: EffectsSnapshotData }> = ({
  isOpen,
  onClose,
  snapshot
}) => {
  const api = window.lumos
  const g = snapshot.global
  const protect = Boolean(g.bulbProtection)
  const [rate, setRate] = useState(g.ratePerSecond)
  const [webhook, setWebhook] = useState<WebhookInfo | null>(null)

  React.useEffect(() => {
    if (!isOpen) return
    setRate(g.ratePerSecond)
    api?.getWebhookInfo?.().then(setWebhook).catch(() => setWebhook(null))
  }, [isOpen, g.ratePerSecond, api])

  const update = (patch: Record<string, unknown>): void => {
    void api?.updateEffectsGlobal(patch)
  }
  const base = webhook ? webhook.url.replace(/\/control$/, '/effects') : 'http://127.0.0.1:8989/api/v1/effects'

  return (
    <GlassSheet isOpen={isOpen} onClose={onClose} title="Effect safety" subtitle="Limits that apply to every effect" icon={ShieldCheck}>
      <PhotosensitivityNote />
      <Group
        title="Bulb protection"
        footer="Keeps every light to at most 2 commands per second, 1 flash per second, and 1 power change every 2 seconds, whatever sends them: this app, Apple Home, the webhook, or another computer. Changes in between are combined, so each light still ends on your latest setting. Effects look slower and smoother while it is on."
      >
        <Row label="Protect bulbs" hint="Lighter on each bulb's controller and its stored settings.">
          <ToggleButton on={protect} onChange={(on) => update({ bulbProtection: on })} ariaLabel="Protect bulbs" />
        </Row>
      </Group>
      <Group title="Flashing">
        <Row
          label="Most flashes per second"
          hint={protect ? 'Held at 1 while bulb protection is on.' : 'Applies to every light and every effect. Never more than three.'}
        >
          <div className={protect ? 'opacity-40 pointer-events-none' : ''} aria-disabled={protect}>
            <Segmented
              ariaLabel="Most flashes per second"
              value={g.maxFlashesPerSecond}
              options={[
                { value: 1, label: '1' },
                { value: 2, label: '2' },
                { value: 3, label: '3' }
              ]}
              onChange={(v) => update({ maxFlashesPerSecond: v })}
            />
          </div>
        </Row>
        <Row label="Reduce intensity" hint="Gentler pulses and flashes, with no sudden jumps in brightness.">
          <ToggleButton on={g.reduceIntensity} onChange={(on) => update({ reduceIntensity: on })} ariaLabel="Reduce intensity" />
        </Row>
      </Group>

      <Group
        title="Performance"
        footer={
          protect
            ? 'Held at 2 per second while bulb protection is on.'
            : 'Lower this if a light seems to lag behind or drop commands. Your own changes are always sent straight away.'
        }
      >
        <Row label="Commands per second for each light" stacked>
          <RangeControl
            ariaLabel="Commands per second for each light"
            value={rate}
            min={2}
            max={20}
            onChange={setRate}
            onCommit={(v) => update({ ratePerSecond: v })}
            format={(v) => `${v} / s`}
            disabled={protect}
          />
        </Row>
      </Group>

      <Group title="Startup">
        <Row label="Turn effects back on when Lumos starts" hint="Effects that were on when Lumos closed start again.">
          <ToggleButton on={g.resumeOnLaunch} onChange={(on) => update({ resumeOnLaunch: on })} ariaLabel="Resume effects at launch" />
        </Row>
      </Group>

      <Group
        title="Control from elsewhere"
        footer="Each effect appears in Apple Home as a switch, so you can say, for example, “turn on Music mode”. Webhooks need your token, shown in Settings."
      >
        {snapshot.effects.map((e) => (
          <Row key={e.id} label={e.label} stacked>
            <code className="text-[10px] font-mono text-zinc-400 break-all select-text">
              POST {base}/{e.id}/toggle
            </code>
          </Row>
        ))}
      </Group>

      <div className="flex justify-end">
        <GlassButton variant="standard" size="sm" onClick={onClose}>
          Done
        </GlassButton>
      </div>
    </GlassSheet>
  )
}

export default EffectsView
