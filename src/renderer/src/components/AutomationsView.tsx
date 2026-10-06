import React, { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Clock,
  Moon,
  Sunrise,
  Plus,
  Trash2,
  Check,
  X,
  Calendar
} from 'lucide-react'
import { GlassSurface } from './ui/GlassSurface'
import { GlassButton } from './ui/GlassButton'
import {
  LumosStoreData,
  Schedule,
  SunriseAlarm,
  NormalizedLightState
} from '../types'
import { springs } from '../lib/constants'

export interface AutomationsViewProps {
  store: LumosStoreData | null
  lights?: NormalizedLightState[]
  onRefreshStore: () => void
  isCreateOpen?: boolean
  onCloseCreate?: () => void
  onOpenCreate?: () => void
  onDeleteScheduleWithUndo?: (schedule: Schedule) => void
}

const WEEKDAYS = [
  { day: 0, label: 'Su' },
  { day: 1, label: 'Mo' },
  { day: 2, label: 'Tu' },
  { day: 3, label: 'We' },
  { day: 4, label: 'Th' },
  { day: 5, label: 'Fr' },
  { day: 6, label: 'Sa' }
]

const SLEEP_PRESETS = [15, 30, 45, 60]
const RAMP_PRESETS = [10, 15, 20, 30]

/**
 * Lumos In-Content Automations View:
 * - Section 1: Schedules (grouped Apple inset rows, inline toggles, time, repeat days, target, delete)
 * - Section 2: Sleep Timer (active countdown badge, duration preset pills 15m/30m/45m/60m, start/cancel)
 * - Section 3: Sunrise Alarm (inline toggle, scheduled wake time, days, ramp duration)
 * - Creation Sheet for new schedules
 * - Calm empty state when no automations exist
 */
export const AutomationsView: React.FC<AutomationsViewProps> = ({
  store,
  lights: _lights = [],
  onRefreshStore,
  isCreateOpen = false,
  onCloseCreate,
  onOpenCreate,
  onDeleteScheduleWithUndo
}) => {
  // Modal creation state
  const [internalCreate, setInternalCreate] = useState(false)
  const isCreating = isCreateOpen || internalCreate

  const handleCloseCreation = () => {
    setInternalCreate(false)
    onCloseCreate?.()
  }

  // Sleep Timer Local State
  const [sleepDuration, setSleepDuration] = useState<number>(30)
  const [sleepTargetType, setSleepTargetType] = useState<'all' | 'room'>('all')
  const [sleepTargetId, setSleepTargetId] = useState<string>('')

  // Sunrise Alarm Local State
  const [sunriseTime, setSunriseTime] = useState<string>('07:00')
  const [sunriseDays, setSunriseDays] = useState<number[]>([1, 2, 3, 4, 5])
  const [sunriseRamp, setSunriseRamp] = useState<number>(20)
  const [sunriseEnabled, setSunriseEnabled] = useState<boolean>(true)
  const [hasSunriseChanges, setHasSunriseChanges] = useState(false)

  // New Schedule Form State
  const [scheduleName, setScheduleName] = useState('')
  const [scheduleTime, setScheduleTime] = useState('22:30')
  const [scheduleDays, setScheduleDays] = useState<number[]>([0, 1, 2, 3, 4, 5, 6])
  const [scheduleAction, setScheduleAction] = useState<'on' | 'off' | 'preset'>('off')
  const [schedulePresetId, setSchedulePresetId] = useState<string>('')
  const [scheduleTargetType, setScheduleTargetType] = useState<'all' | 'room'>('all')
  const [scheduleTargetId, setScheduleTargetId] = useState<string>('')

  // Sync Sunrise state from store
  useEffect(() => {
    if (store?.sunriseAlarm) {
      setSunriseTime(store.sunriseAlarm.time || '07:00')
      setSunriseDays(store.sunriseAlarm.days || [1, 2, 3, 4, 5])
      setSunriseRamp(store.sunriseAlarm.rampDurationMinutes || 20)
      setSunriseEnabled(store.sunriseAlarm.enabled ?? true)
      setHasSunriseChanges(false)
    }
  }, [store?.sunriseAlarm])

  const rooms = store?.rooms || []
  const presets = store?.presets || []
  const schedules = store?.schedules || []
  const sleepTimer = store?.sleepTimer

  // Format Repeat Days Label
  const formatDays = (days: number[]): string => {
    if (!days || days.length === 0) return 'Never'
    if (days.length === 7) return 'Every day'
    if (days.length === 5 && [1, 2, 3, 4, 5].every((d) => days.includes(d))) return 'Weekdays'
    if (days.length === 2 && [0, 6].every((d) => days.includes(d))) return 'Weekends'
    return days.map((d) => WEEKDAYS.find((w) => w.day === d)?.label).filter(Boolean).join(' ')
  }

  // Sleep Timer Remaining Time Calculation
  const getSleepRemainingMinutes = (): number => {
    if (!sleepTimer?.active || !sleepTimer.endEpoch) return 0
    const remainingMs = sleepTimer.endEpoch - Date.now()
    return Math.max(0, Math.ceil(remainingMs / 60000))
  }

  // Actions: Sleep Timer
  const handleStartSleepTimer = async (): Promise<void> => {
    const api = window.lumos || window.lumen
    if (!api) return
    await api.startSleepTimer(
      sleepTargetType,
      sleepTargetType === 'room' ? sleepTargetId : undefined,
      sleepDuration
    )
    onRefreshStore()
  }

  const handleCancelSleepTimer = async (): Promise<void> => {
    const api = window.lumos || window.lumen
    if (!api) return
    await api.cancelSleepTimer()
    onRefreshStore()
  }

  // Actions: Sunrise Alarm
  const handleSaveSunrise = async (overrideEnabled?: boolean): Promise<void> => {
    const api = window.lumos || window.lumen
    if (!api) return
    const isEn = overrideEnabled !== undefined ? overrideEnabled : sunriseEnabled
    const alarm: SunriseAlarm = {
      id: store?.sunriseAlarm?.id || 'sunrise-main',
      name: 'Morning Sunrise',
      enabled: isEn,
      time: sunriseTime,
      days: sunriseDays,
      rampDurationMinutes: sunriseRamp,
      targetType: 'all'
    }
    await api.saveSunriseAlarm(alarm)
    setHasSunriseChanges(false)
    onRefreshStore()
  }

  const handleToggleSunriseDay = (day: number): void => {
    setSunriseDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort()
    )
    setHasSunriseChanges(true)
  }

  // Actions: Schedules
  const handleToggleSchedule = async (schedule: Schedule): Promise<void> => {
    const api = window.lumos || window.lumen
    if (!api) return
    await api.saveSchedule({
      ...schedule,
      enabled: !schedule.enabled
    })
    onRefreshStore()
  }

  const handleDeleteSchedule = async (schedule: Schedule): Promise<void> => {
    if (onDeleteScheduleWithUndo) {
      onDeleteScheduleWithUndo(schedule)
    } else {
      const api = window.lumos || window.lumen
      if (!api) return
      await api.deleteSchedule(schedule.id)
      onRefreshStore()
    }
  }

  const handleCreateScheduleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    const api = window.lumos || window.lumen
    if (!api || !scheduleName.trim()) return

    const newSchedule: Schedule = {
      id: 'sched-' + Date.now(),
      name: scheduleName.trim(),
      enabled: true,
      time: scheduleTime,
      days: scheduleDays,
      action: scheduleAction,
      presetId: scheduleAction === 'preset' ? schedulePresetId : undefined,
      targetType: scheduleTargetType,
      targetId: scheduleTargetType === 'room' ? scheduleTargetId : undefined
    }

    await api.saveSchedule(newSchedule)
    setScheduleName('')
    handleCloseCreation()
    onRefreshStore()
  }

  const hasAnyAutomations =
    schedules.length > 0 || Boolean(sleepTimer?.active) || Boolean(store?.sunriseAlarm?.enabled)

  return (
    <div className="flex flex-col gap-8 w-full max-w-4xl mx-auto select-none pb-12">
      {/* Calm Apple Home Empty State if entirely blank */}
      {!hasAnyAutomations && schedules.length === 0 && (
        <div className="py-12 flex flex-col items-center justify-center text-center gap-3">
          <div className="w-14 h-14 rounded-2xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center text-zinc-500">
            <Clock className="w-6 h-6" />
          </div>
          <div className="flex flex-col gap-1 max-w-sm">
            <h3 className="text-base font-semibold text-white tracking-tight">
              No Automations Configured
            </h3>
            <p className="text-xs text-zinc-400">
              Set recurring schedules, fade lights off at bedtime, or wake up to a simulated sunrise.
            </p>
          </div>
          <div className="pt-2">
            <GlassButton
              variant="prominent"
              size="md"
              onClick={() => {
                if (onOpenCreate) onOpenCreate()
                else setInternalCreate(true)
              }}
            >
              <Plus className="w-3.5 h-3.5 mr-1" />
              <span>Add First Schedule</span>
            </GlassButton>
          </div>
        </div>
      )}

      {/* SECTION 1: SCHEDULES */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between px-1">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-zinc-400" />
            <h2 className="text-[17px] font-semibold tracking-tight text-white">
              Schedules
            </h2>
            <span className="px-2 py-0.5 rounded-full bg-white/[0.06] border border-white/[0.08] text-[11px] font-medium text-zinc-400">
              {schedules.filter((s) => s.enabled).length}/{schedules.length} Active
            </span>
          </div>

          <GlassButton
            variant="prominent"
            size="sm"
            onClick={() => {
              if (onOpenCreate) onOpenCreate()
              else setInternalCreate(true)
            }}
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Schedule</span>
          </GlassButton>
        </div>

        {schedules.length === 0 ? (
          <div className="p-8 rounded-2xl bg-white/[0.03] border border-white/[0.07] text-center text-xs text-zinc-400 flex flex-col items-center gap-2">
            <p>No recurring schedules scheduled.</p>
          </div>
        ) : (
          <div className="flex flex-col rounded-2xl bg-white/[0.04] border border-white/[0.08] divide-y divide-white/[0.06] overflow-hidden">
            {schedules.map((schedule) => {
              const targetLabel =
                schedule.targetType === 'room'
                  ? rooms.find((r) => r.id === schedule.targetId)?.name || 'Room'
                  : 'All Accessories'

              const actionLabel =
                schedule.action === 'on'
                  ? 'Turn on'
                  : schedule.action === 'off'
                  ? 'Turn off'
                  : `Apply ${presets.find((p) => p.id === schedule.presetId)?.name || 'Scene'}`

              return (
                <div
                  key={schedule.id}
                  className="p-4 flex items-center justify-between gap-4 transition-colors hover:bg-white/[0.02]"
                >
                  <div className="flex items-center gap-4 min-w-0">
                    <div className="font-mono text-xl font-bold tracking-tight text-white w-16">
                      {schedule.time}
                    </div>

                    <div className="flex flex-col min-w-0">
                      <span className="text-sm font-medium text-white truncate">
                        {schedule.name}
                      </span>
                      <span className="text-xs text-zinc-400 truncate">
                        {formatDays(schedule.days)} · {targetLabel} ({actionLabel})
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2.5 flex-shrink-0">
                    <GlassButton
                      variant={schedule.enabled ? 'prominent' : 'standard'}
                      size="sm"
                      onClick={() => handleToggleSchedule(schedule)}
                      title={schedule.enabled ? 'Disable schedule' : 'Enable schedule'}
                    >
                      <span>{schedule.enabled ? 'Active' : 'Off'}</span>
                    </GlassButton>

                    <GlassButton
                      variant="subtle"
                      size="icon-sm"
                      onClick={() => handleDeleteSchedule(schedule)}
                      title="Delete schedule"
                    >
                      <Trash2 className="w-3.5 h-3.5 text-zinc-400 hover:text-rose-400" />
                    </GlassButton>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* SECTION 2: SLEEP TIMER */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between px-1">
          <div className="flex items-center gap-2">
            <Moon className="w-4 h-4 text-zinc-400" />
            <h2 className="text-[17px] font-semibold tracking-tight text-white">
              Sleep Fade Timer
            </h2>
            {sleepTimer?.active && (
              <span className="px-2 py-0.5 rounded-full bg-amber-400/20 border border-amber-400/30 text-[11px] font-mono text-amber-300 animate-pulse">
                Active · {getSleepRemainingMinutes()}m remaining
              </span>
            )}
          </div>
        </div>

        <div className="p-5 rounded-2xl bg-white/[0.04] border border-white/[0.08] flex flex-col gap-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-white/[0.06]">
            <div>
              <h4 className="text-sm font-medium text-white">Bedtime Gradual Dimmer</h4>
              <p className="text-xs text-zinc-400">
                Smoothly steps brightness down to zero across the selected duration.
              </p>
            </div>

            <div className="flex items-center gap-2">
              {sleepTimer?.active ? (
                <GlassButton
                  variant="destructive"
                  size="sm"
                  onClick={handleCancelSleepTimer}
                >
                  <X className="w-3.5 h-3.5" />
                  <span>Cancel Timer</span>
                </GlassButton>
              ) : (
                <GlassButton
                  variant="prominent"
                  size="sm"
                  onClick={handleStartSleepTimer}
                >
                  <Moon className="w-3.5 h-3.5" />
                  <span>Start Sleep Timer</span>
                </GlassButton>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            {/* Duration Pills */}
            <div className="flex flex-col gap-2 min-w-0">
              <span className="font-medium text-zinc-300">Fade Duration</span>
              <div className="flex items-center gap-2 flex-wrap">
                {SLEEP_PRESETS.map((mins) => (
                  <GlassButton
                    key={mins}
                    variant={sleepDuration === mins ? 'prominent' : 'standard'}
                    size="sm"
                    className="text-xs px-3"
                    disabled={Boolean(sleepTimer?.active)}
                    onClick={() => setSleepDuration(mins)}
                  >
                    <span>{mins}m</span>
                  </GlassButton>
                ))}
              </div>
            </div>

            {/* Target Picker */}
            <div className="flex flex-col gap-2 min-w-0">
              <span className="font-medium text-zinc-300">Target Area</span>
              <div className="flex items-center gap-2 flex-wrap">
                <GlassButton
                  variant={sleepTargetType === 'all' ? 'prominent' : 'standard'}
                  size="sm"
                  disabled={Boolean(sleepTimer?.active)}
                  onClick={() => setSleepTargetType('all')}
                >
                  <span>All Lights</span>
                </GlassButton>

                {rooms.length > 0 && (
                  <select
                    disabled={Boolean(sleepTimer?.active)}
                    value={sleepTargetType === 'room' ? sleepTargetId : ''}
                    onChange={(e) => {
                      if (e.target.value) {
                        setSleepTargetType('room')
                        setSleepTargetId(e.target.value)
                      } else {
                        setSleepTargetType('all')
                      }
                    }}
                    className="bg-zinc-900 border border-white/10 rounded-lg text-xs text-white px-2.5 py-1.5 focus:outline-none focus:border-amber-400"
                  >
                    <option value="">Select Room...</option>
                    {rooms.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* SECTION 3: SUNRISE ALARM */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between px-1">
          <div className="flex items-center gap-2">
            <Sunrise className="w-4 h-4 text-zinc-400" />
            <h2 className="text-[17px] font-semibold tracking-tight text-white">
              Sunrise Wake Alarm
            </h2>
            {sunriseEnabled && (
              <span className="px-2 py-0.5 rounded-full bg-amber-400/20 border border-amber-400/30 text-[11px] font-medium text-amber-300">
                Scheduled at {sunriseTime}
              </span>
            )}
          </div>

          <GlassButton
            variant={sunriseEnabled ? 'prominent' : 'standard'}
            size="sm"
            onClick={() => {
              const next = !sunriseEnabled
              setSunriseEnabled(next)
              handleSaveSunrise(next)
            }}
          >
            <span>{sunriseEnabled ? 'Active' : 'Off'}</span>
          </GlassButton>
        </div>

        <div className="p-5 rounded-2xl bg-white/[0.04] border border-white/[0.08] flex flex-col gap-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-white/[0.06]">
            <div>
              <h4 className="text-sm font-medium text-white">Natural Wake Simulation</h4>
              <p className="text-xs text-zinc-400">
                Fades lights smoothly from warm candle amber to crisp daylight prior to your alarm.
              </p>
            </div>

            {hasSunriseChanges && (
              <GlassButton
                variant="prominent"
                size="sm"
                onClick={() => handleSaveSunrise()}
              >
                <Check className="w-3.5 h-3.5 mr-1" />
                <span>Save Alarm</span>
              </GlassButton>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5 text-xs items-start">
            {/* Alarm Wake Time */}
            <div className="flex flex-col gap-2 min-w-0">
              <span className="font-medium text-zinc-300">Wake Target Time</span>
              <input
                type="time"
                value={sunriseTime}
                onChange={(e) => {
                  setSunriseTime(e.target.value)
                  setHasSunriseChanges(true)
                }}
                className="bg-zinc-900 border border-white/10 rounded-xl px-3 py-1.5 text-sm font-mono text-white focus:outline-none focus:border-amber-400 w-full max-w-[160px]"
              />
            </div>

            {/* Repeat Days */}
            <div className="flex flex-col gap-2 min-w-0">
              <span className="font-medium text-zinc-300">Repeat Days</span>
              <div className="flex items-center gap-1 flex-wrap">
                {WEEKDAYS.map((wd) => {
                  const isSel = sunriseDays.includes(wd.day)
                  return (
                    <button
                      type="button"
                      key={wd.day}
                      onClick={() => handleToggleSunriseDay(wd.day)}
                      className={`w-7 h-7 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                        isSel
                          ? 'bg-amber-400 text-zinc-950 font-semibold shadow-sm'
                          : 'bg-white/[0.06] text-zinc-400 hover:text-white'
                      }`}
                    >
                      {wd.label}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Ramp Duration */}
            <div className="flex flex-col gap-2 min-w-0">
              <span className="font-medium text-zinc-300">Ramp Period</span>
              <div className="flex items-center gap-1.5 flex-wrap">
                {RAMP_PRESETS.map((ramp) => (
                  <GlassButton
                    key={ramp}
                    variant={sunriseRamp === ramp ? 'prominent' : 'standard'}
                    size="sm"
                    className="text-xs px-2.5 flex-1 min-w-[42px]"
                    onClick={() => {
                      setSunriseRamp(ramp)
                      setHasSunriseChanges(true)
                    }}
                  >
                    <span>{ramp}m</span>
                  </GlassButton>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CREATION SHEET MODAL */}
      <AnimatePresence>
        {isCreating && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={handleCloseCreation}
              className="fixed inset-0 bg-black/65 backdrop-blur-md"
            />

            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 12 }}
              transition={springs.default}
              onClick={(e) => e.stopPropagation()}
              className="relative z-10 w-full max-w-md rounded-3xl overflow-hidden shadow-2xl shadow-black/80"
            >
              <GlassSurface intensity="elevated" className="p-6 flex flex-col gap-5">
                <div className="flex items-center justify-between pb-3 border-b border-white/[0.08]">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-xl bg-amber-400/10 border border-amber-400/20 flex items-center justify-center text-amber-300">
                      <Calendar className="w-4 h-4" />
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-white tracking-tight">
                        New Schedule
                      </h3>
                      <p className="text-[11px] text-zinc-400">
                        Automate lighting routines on set days
                      </p>
                    </div>
                  </div>
                  <GlassButton
                    variant="subtle"
                    size="icon-sm"
                    onClick={handleCloseCreation}
                  >
                    <X className="w-3.5 h-3.5" />
                  </GlassButton>
                </div>

                <form onSubmit={handleCreateScheduleSubmit} className="flex flex-col gap-4 text-xs">
                  {/* Name */}
                  <div className="flex flex-col gap-1.5">
                    <label className="font-medium text-white">Schedule Name</label>
                    <input
                      type="text"
                      value={scheduleName}
                      onChange={(e) => setScheduleName(e.target.value)}
                      placeholder="e.g. Evening Wind Down, Morning Lights"
                      autoFocus
                      className="w-full bg-zinc-900 border border-white/10 rounded-xl px-3.5 py-2 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-amber-400"
                    />
                  </div>

                  {/* Trigger Time */}
                  <div className="flex flex-col gap-1.5">
                    <label className="font-medium text-white">Execution Time</label>
                    <input
                      type="time"
                      value={scheduleTime}
                      onChange={(e) => setScheduleTime(e.target.value)}
                      className="w-full bg-zinc-900 border border-white/10 rounded-xl px-3.5 py-2 text-sm font-mono text-white focus:outline-none focus:border-amber-400"
                    />
                  </div>

                  {/* Repeat Days */}
                  <div className="flex flex-col gap-1.5">
                    <label className="font-medium text-white">Repeat Days</label>
                    <div className="grid grid-cols-7 gap-1">
                      {WEEKDAYS.map((wd) => {
                        const isSel = scheduleDays.includes(wd.day)
                        return (
                          <button
                            type="button"
                            key={wd.day}
                            onClick={() =>
                              setScheduleDays((prev) =>
                                prev.includes(wd.day)
                                  ? prev.filter((d) => d !== wd.day)
                                  : [...prev, wd.day].sort()
                              )
                            }
                            className={`h-8 rounded-lg text-xs font-medium transition-all ${
                              isSel
                                ? 'bg-amber-400 text-zinc-950 font-semibold shadow-sm'
                                : 'bg-white/[0.06] text-zinc-400 hover:text-white'
                            }`}
                          >
                            {wd.label}
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  {/* Action Selection */}
                  <div className="flex flex-col gap-1.5">
                    <label className="font-medium text-white">Action</label>
                    <div className="grid grid-cols-3 gap-2">
                      <GlassButton
                        type="button"
                        variant={scheduleAction === 'off' ? 'prominent' : 'standard'}
                        size="sm"
                        onClick={() => setScheduleAction('off')}
                      >
                        <span>Turn Off</span>
                      </GlassButton>
                      <GlassButton
                        type="button"
                        variant={scheduleAction === 'on' ? 'prominent' : 'standard'}
                        size="sm"
                        onClick={() => setScheduleAction('on')}
                      >
                        <span>Turn On</span>
                      </GlassButton>
                      <GlassButton
                        type="button"
                        variant={scheduleAction === 'preset' ? 'prominent' : 'standard'}
                        size="sm"
                        onClick={() => setScheduleAction('preset')}
                      >
                        <span>Apply Scene</span>
                      </GlassButton>
                    </div>

                    {scheduleAction === 'preset' && presets.length > 0 && (
                      <select
                        value={schedulePresetId}
                        onChange={(e) => setSchedulePresetId(e.target.value)}
                        className="mt-1.5 bg-zinc-900 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-400"
                      >
                        <option value="">Select a scene...</option>
                        {presets.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>

                  {/* Target Scope */}
                  <div className="flex flex-col gap-1.5">
                    <label className="font-medium text-white">Target Scope</label>
                    <div className="flex items-center gap-2">
                      <GlassButton
                        type="button"
                        variant={scheduleTargetType === 'all' ? 'prominent' : 'standard'}
                        size="sm"
                        onClick={() => setScheduleTargetType('all')}
                      >
                        <span>All Lights</span>
                      </GlassButton>

                      {rooms.length > 0 && (
                        <select
                          value={scheduleTargetType === 'room' ? scheduleTargetId : ''}
                          onChange={(e) => {
                            if (e.target.value) {
                              setScheduleTargetType('room')
                              setScheduleTargetId(e.target.value)
                            } else {
                              setScheduleTargetType('all')
                            }
                          }}
                          className="bg-zinc-900 border border-white/10 rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none focus:border-amber-400"
                        >
                          <option value="">Specific Room...</option>
                          {rooms.map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.name}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  </div>

                  {/* Submit / Cancel Buttons */}
                  <div className="flex items-center justify-end gap-2 pt-3 border-t border-white/[0.06]">
                    <GlassButton
                      variant="subtle"
                      size="sm"
                      type="button"
                      onClick={handleCloseCreation}
                    >
                      <span>Cancel</span>
                    </GlassButton>
                    <GlassButton
                      variant="prominent"
                      size="sm"
                      type="submit"
                      disabled={!scheduleName.trim()}
                    >
                      <Check className="w-3.5 h-3.5 mr-1" />
                      <span>Save Schedule</span>
                    </GlassButton>
                  </div>
                </form>
              </GlassSurface>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  )
}

export default AutomationsView
