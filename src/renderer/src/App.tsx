import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import {
  LightbulbOff,
  RefreshCw,
  Layers,
  Plus,
  ShieldCheck,
  Download
} from 'lucide-react'
import { Sidebar } from './components/Sidebar'
import { Toolbar } from './components/Toolbar'
import { RoomSection } from './components/RoomSection'
import { LightTile } from './components/LightTile'
import { PresetsBar } from './components/PresetsBar'
import { LightDetailSheet } from './components/LightDetailSheet'
import { AutomationsView } from './components/AutomationsView'
import { SettingsSheet } from './components/SettingsSheet'
import { RoomsSheet } from './components/RoomsSheet'
import { ScenesView } from './components/ScenesView'
import { TileContextMenu } from './components/TileContextMenu'
import { AmbientBackdrop } from './components/AmbientBackdrop'
import { GlassSurface } from './components/ui/GlassSurface'
import { GlassButton } from './components/ui/GlassButton'
import { ErrorBoundary } from './components/ui/ErrorBoundary'
import { OnboardingView } from './components/OnboardingView'
import { EffectsView } from './components/EffectsView'
import { EnergyView } from './components/EnergyView'
import {
  NormalizedLightState,
  LumosStoreData,
  ColorHS,
  DeviceMetadata,
  Preset,
  RoomGroup,
  Schedule,
  EffectsSnapshotData,
  EffectPausedNotice
} from './types'
import { springs } from './lib/constants'

interface ToastState {
  id: number
  message: string
  onUndo?: () => void
  actionLabel?: string
}

export const App: React.FC = () => {
  const shouldReduceMotion = useReducedMotion()
  const [lights, setLights] = useState<NormalizedLightState[]>([])
  const [store, setStore] = useState<LumosStoreData | null>(null)
  const [effects, setEffects] = useState<EffectsSnapshotData | null>(null)
  const [loading, setLoading] = useState(true)
  const [hasConfig, setHasConfig] = useState<boolean>(true)
  const [isDemoMode, setIsDemoMode] = useState<boolean>(false)

  // Navigation & View state
  const [currentView, setCurrentView] = useState<string>('home')
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)
  const [isCompact, setIsCompact] = useState(false)

  // Sheets & Dialogs
  const [selectedDetailLightId, setSelectedDetailLightId] = useState<string | null>(null)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [isRoomsOpen, setIsRoomsOpen] = useState(false)
  const [isCreateSceneOpen, setIsCreateSceneOpen] = useState(false)
  const [isCreateScheduleOpen, setIsCreateScheduleOpen] = useState(false)

  // Toast feedback with Undo
  const [toast, setToast] = useState<ToastState | null>(null)

  // Keyboard spatial grid focus tracking
  const [focusedLightId, setFocusedLightId] = useState<string | null>(null)

  // 5-Item Tile Context Menu
  const [contextMenu, setContextMenu] = useState<{
    isOpen: boolean
    position: { x: number; y: number }
    light: NormalizedLightState | null
  }>({
    isOpen: false,
    position: { x: 0, y: 0 },
    light: null
  })

  // Show Toast helper
  const showToast = useCallback((message: string, onUndo?: () => void, actionLabel?: string) => {
    const id = Date.now()
    setToast({ id, message, onUndo, actionLabel })
    setTimeout(() => {
      setToast((prev) => (prev?.id === id ? null : prev))
    }, 4500)
  }, [])

  // Effects: status updates, and a notice when a hand change pauses an effect on a light
  useEffect(() => {
    const api = window.lumos
    if (!api?.getEffects) return undefined
    api.getEffects().then(setEffects).catch(() => setEffects(null))
    const unsubUpdate = api.onEffectsUpdate((snapshot) => setEffects(snapshot))
    const unsubPaused = api.onEffectPaused((notice: EffectPausedNotice) => {
      const names =
        notice.lightNames.length <= 2
          ? notice.lightNames.join(' and ')
          : `${notice.lightNames.length} lights`
      showToast(
        `${notice.effectLabel} paused for ${names}`,
        () => void api.resumeEffectLights(notice.effectId, notice.lightIds),
        'Resume'
      )
    })
    return () => {
      unsubUpdate()
      unsubPaused()
    }
  }, [showToast])

  // When an update has downloaded, offer to restart into it
  useEffect(() => {
    const api = window.lumos
    if (!api?.onUpdateStatus) return undefined
    let announced = ''
    return api.onUpdateStatus((status) => {
      if (status.state === 'downloaded' && status.version !== announced) {
        announced = status.version
        showToast(`Lumos ${status.version} is ready`, () => void api.installUpdate(), 'Restart')
      }
    })
  }, [showToast])

  const handleToggleEffect = useCallback((id: string, on: boolean) => {
    setEffects((prev) =>
      prev
        ? {
            ...prev,
            effects: prev.effects.map((e) =>
              e.id === id ? { ...e, settings: { ...e.settings, enabled: on }, status: on ? 'waiting' : 'off' } : e
            )
          }
        : prev
    )
    window.lumos?.setEffectEnabled(id, on).then(setEffects).catch(() => {})
  }, [])

  const activeEffectCount = useMemo(
    () => (effects ? effects.effects.filter((e) => e.settings.enabled).length : 0),
    [effects]
  )

  // Responsive Breakpoint Observer (< 880px)
  useEffect(() => {
    const handleResize = () => {
      const compact = window.innerWidth < 880
      setIsCompact(compact)
      if (compact) {
        setIsSidebarCollapsed(true)
      }
    }
    handleResize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  // Initial Data Fetch
  const fetchStatusAndStore = useCallback(async () => {
    try {
      const api = window.lumos || window.lumen
      if (api) {
        const [statuses, storeData, configExists, demoActive] = await Promise.all([
          api.getStatus(),
          api.getStore(),
          api.hasDevicesConfig ? api.hasDevicesConfig() : Promise.resolve(true),
          api.getIsDemoMode ? api.getIsDemoMode() : Promise.resolve(false)
        ])
        setLights(statuses)
        setStore(storeData)
        setHasConfig(Boolean(configExists) || statuses.length > 0)
        setIsDemoMode(Boolean(demoActive))
      }
    } catch (err) {
      console.error('[Lumos UI] Error fetching initial state:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  // Subscriptions to live hardware broadcasts
  useEffect(() => {
    fetchStatusAndStore()

    const api = window.lumos || window.lumen
    if (api?.onUpdate) {
      const unsubUpdate = api.onUpdate((updatedLight: NormalizedLightState) => {
        setLights((prevLights) => {
          const index = prevLights.findIndex((l) => l.id === updatedLight.id)
          if (index >= 0) {
            const next = [...prevLights]
            next[index] = updatedLight
            return next
          } else {
            return [...prevLights, updatedLight]
          }
        })
      })

      const unsubStore = api.onStoreUpdate
        ? api.onStoreUpdate((updatedStore: LumosStoreData) => {
            setStore(updatedStore)
          })
        : () => {}

      return () => {
        unsubUpdate()
        unsubStore()
      }
    }
    return undefined
  }, [fetchStatusAndStore])

  const handleExploreDemo = useCallback(async () => {
    const api = window.lumos || window.lumen
    if (api?.startDemoMode) {
      const demoLights = await api.startDemoMode()
      setLights(demoLights)
      setHasConfig(true)
      setIsDemoMode(true)
      setCurrentView('home')
    }
  }, [])

  // Direct Control Handlers
  const handleToggle = useCallback((id: string) => {
    setLights((prev) =>
      prev.map((l) => (l.id === id ? { ...l, power: !l.power } : l))
    )
    ;(window.lumos || window.lumen)?.toggleLight(id)
  }, [])

  const handleBrightnessChange = useCallback((id: string, value: number) => {
    setLights((prev) =>
      prev.map((l) =>
        l.id === id ? { ...l, brightness: value, power: value > 0 ? true : l.power } : l
      )
    )
    const api = window.lumos || window.lumen
    if (api?.streamBrightness) {
      api.streamBrightness(id, value)
    } else {
      api?.setBrightness(id, value)
    }
  }, [])

  const handleColorTempChange = useCallback((id: string, value: number) => {
    setLights((prev) =>
      prev.map((l) => (l.id === id ? { ...l, colorTemp: value, mode: 'white' } : l))
    )
    const api = window.lumos || window.lumen
    if (api?.streamColorTemp) {
      api.streamColorTemp(id, value)
    } else {
      api?.setColorTemp(id, value)
    }
  }, [])

  const handleColorChange = useCallback((id: string, color: ColorHS) => {
    setLights((prev) =>
      prev.map((l) => (l.id === id ? { ...l, color, mode: 'colour' } : l))
    )
    ;(window.lumos || window.lumen)?.setColor(id, color)
  }, [])

  const handleModeChange = useCallback((id: string, mode: 'white' | 'colour') => {
    setLights((prev) =>
      prev.map((l) => (l.id === id ? { ...l, mode } : l))
    )
    ;(window.lumos || window.lumen)?.setWorkMode(id, mode)
  }, [])

  const handleSetScene = useCallback((id: string, sceneNum: number) => {
    setLights((prev) =>
      prev.map((l) => (l.id === id ? { ...l, scene: sceneNum, mode: 'scene' } : l))
    )
    ;(window.lumos || window.lumen)?.setScene(id, sceneNum)
  }, [])

  const handleSetCountdown = useCallback((id: string, seconds: number) => {
    setLights((prev) =>
      prev.map((l) => (l.id === id ? { ...l, countdown: seconds } : l))
    )
    ;(window.lumos || window.lumen)?.setCountdown(id, seconds)
  }, [])

  const handleSetAll = useCallback((on: boolean) => {
    setLights((prev) =>
      prev.map((l) => (l.online ? { ...l, power: on } : l))
    )
    ;(window.lumos || window.lumen)?.setAll(on)
  }, [])

  const handleToggleRoom = useCallback((deviceIds: string[], on: boolean) => {
    setLights((prev) =>
      prev.map((l) => (deviceIds.includes(l.id) && l.online ? { ...l, power: on } : l))
    )
    ;(window.lumos || window.lumen)?.setGroupPower(deviceIds, on)
  }, [])

  const handleApplyScene = useCallback((sceneId: string) => {
    ;(window.lumos || window.lumen)?.applyPreset(sceneId, 'all')
  }, [])

  const handleSaveScene = useCallback(async (scene: Preset) => {
    const api = window.lumos || window.lumen
    if (api) {
      await api.savePreset(scene)
      fetchStatusAndStore()
    }
  }, [fetchStatusAndStore])

  const handleDeleteSceneWithUndo = useCallback(async (scene: Preset) => {
    const api = window.lumos || window.lumen
    if (api) {
      await api.deletePreset(scene.id)
      fetchStatusAndStore()
      showToast(`"${scene.name}" deleted`, async () => {
        if (api) {
          await api.savePreset(scene)
          fetchStatusAndStore()
        }
      })
    }
  }, [fetchStatusAndStore, showToast])

  const handleDeleteRoomWithUndo = useCallback(async (room: RoomGroup) => {
    const api = window.lumos || window.lumen
    if (api) {
      await api.deleteRoom(room.id)
      fetchStatusAndStore()
      showToast(`"${room.name}" deleted`, async () => {
        if (api) {
          await api.saveRoom(room)
          fetchStatusAndStore()
        }
      })
    }
  }, [fetchStatusAndStore, showToast])

  const handleDeleteScheduleWithUndo = useCallback(async (schedule: Schedule) => {
    const api = window.lumos || window.lumen
    if (api) {
      await api.deleteSchedule(schedule.id)
      fetchStatusAndStore()
      showToast(`"${schedule.name}" deleted`, async () => {
        if (api) {
          await api.saveSchedule(schedule)
          fetchStatusAndStore()
        }
      })
    }
  }, [fetchStatusAndStore, showToast])

  const handleUpdateMetadata = useCallback(
    async (id: string, meta: Partial<DeviceMetadata>) => {
      const api = window.lumos || window.lumen
      if (api) {
        await api.setDeviceMeta(id, meta)
        fetchStatusAndStore()

        if (meta.hidden === true) {
          const light = lights.find((l) => l.id === id)
          const name = light?.customName || light?.name || 'Accessory'
          showToast(`"${name}" hidden`, () => {
            handleUpdateMetadata(id, { hidden: false })
          })
        }
      }
    },
    [fetchStatusAndStore, lights, showToast]
  )

  // Context Menu Handlers
  const handleOpenContextMenu = useCallback(
    (pos: { clientX: number; clientY: number }, light: NormalizedLightState) => {
      setContextMenu({
        isOpen: true,
        position: { x: pos.clientX, y: pos.clientY },
        light
      })
    },
    []
  )

  const handleCloseContextMenu = useCallback(() => {
    setContextMenu((prev) => ({ ...prev, isOpen: false, light: null }))
  }, [])

  // Visible Lights & Room Memberships
  const visibleLights = useMemo(() => {
    return lights.filter((l) => !l.hidden)
  }, [lights])

  const totalLights = visibleLights.length
  const activeLights = visibleLights.filter((l) => l.online && l.power).length

  const rooms = useMemo(() => store?.rooms || [], [store?.rooms])
  const scenes = useMemo(() => store?.presets || [], [store?.presets])

  const activeAutomationCount = useMemo(() => {
    let count = 0
    if (store?.schedules) {
      count += store.schedules.filter((s) => s.enabled).length
    }
    if (store?.sleepTimer?.active) count += 1
    if (store?.sunriseAlarm?.enabled) count += 1
    return count
  }, [store])

  const groupedIds = useMemo(() => {
    const ids = new Set<string>()
    for (const r of rooms) {
      for (const id of r.deviceIds) {
        ids.add(id)
      }
    }
    for (const l of visibleLights) {
      if (l.room && rooms.some((r) => r.name === l.room || r.id === l.room)) {
        ids.add(l.id)
      }
    }
    return ids
  }, [rooms, visibleLights])

  const ungroupedLights = useMemo(() => {
    return visibleLights.filter((l) => !groupedIds.has(l.id))
  }, [visibleLights, groupedIds])

  // Selected Detail Light
  const selectedDetailLight = useMemo(() => {
    if (!selectedDetailLightId) return null
    return lights.find((l) => l.id === selectedDetailLightId) || null
  }, [selectedDetailLightId, lights])

  // Active Room Resolution
  const currentRoom = useMemo(() => {
    if (!currentView.startsWith('room-')) return null
    const roomId = currentView.replace('room-', '')
    return rooms.find((r) => r.id === roomId) || null
  }, [currentView, rooms])

  const currentRoomLights = useMemo(() => {
    if (!currentRoom) return []
    return visibleLights.filter(
      (l) =>
        currentRoom.deviceIds.includes(l.id) ||
        l.room === currentRoom.name ||
        l.room === currentRoom.id
    )
  }, [currentRoom, visibleLights])

  const currentRoomActive = useMemo(() => {
    return currentRoomLights.filter((l) => l.online && l.power).length > 0
  }, [currentRoomLights])

  // Spatial Keyboard Navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeTag = document.activeElement?.tagName?.toLowerCase()
      if (activeTag === 'input' || activeTag === 'textarea' || activeTag === 'select') {
        return
      }

      if (
        e.key === 'ArrowRight' ||
        e.key === 'ArrowLeft' ||
        e.key === 'ArrowDown' ||
        e.key === 'ArrowUp'
      ) {
        if (visibleLights.length === 0) return
        e.preventDefault()

        const tileElements = Array.from(
          document.querySelectorAll<HTMLElement>('[role="switch"][data-light-id]')
        )
        if (tileElements.length === 0) return

        let currentIndex = -1
        if (focusedLightId) {
          currentIndex = tileElements.findIndex(
            (el) => el.getAttribute('data-light-id') === focusedLightId
          )
        } else {
          const activeEl = document.activeElement as HTMLElement
          currentIndex = tileElements.indexOf(activeEl)
        }

        if (currentIndex === -1) {
          const first = tileElements[0]
          const id = first.getAttribute('data-light-id')
          if (id) {
            setFocusedLightId(id)
            first.focus()
          }
          return
        }

        const currentRect = tileElements[currentIndex].getBoundingClientRect()
        let nextIndex = currentIndex

        if (e.key === 'ArrowRight') {
          nextIndex = (currentIndex + 1) % tileElements.length
        } else if (e.key === 'ArrowLeft') {
          nextIndex = (currentIndex - 1 + tileElements.length) % tileElements.length
        } else if (e.key === 'ArrowDown') {
          const candidates = tileElements
            .map((el, i) => ({ el, i, rect: el.getBoundingClientRect() }))
            .filter((item) => item.rect.top > currentRect.bottom - 10)

          if (candidates.length > 0) {
            candidates.sort((a, b) => {
              const dyA = a.rect.top - currentRect.top
              const dyB = b.rect.top - currentRect.top
              const dxA = Math.abs(a.rect.left - currentRect.left)
              const dxB = Math.abs(b.rect.left - currentRect.left)
              return dyA - dyB || dxA - dxB
            })
            nextIndex = candidates[0].i
          } else {
            nextIndex = (currentIndex + 1) % tileElements.length
          }
        } else if (e.key === 'ArrowUp') {
          const candidates = tileElements
            .map((el, i) => ({ el, i, rect: el.getBoundingClientRect() }))
            .filter((item) => item.rect.bottom < currentRect.top + 10)

          if (candidates.length > 0) {
            candidates.sort((a, b) => {
              const dyA = currentRect.top - a.rect.top
              const dyB = currentRect.top - b.rect.top
              const dxA = Math.abs(a.rect.left - currentRect.left)
              const dxB = Math.abs(b.rect.left - currentRect.left)
              return dyA - dyB || dxA - dxB
            })
            nextIndex = candidates[0].i
          } else {
            nextIndex = (currentIndex - 1 + tileElements.length) % tileElements.length
          }
        }

        const targetEl = tileElements[nextIndex]
        const targetId = targetEl.getAttribute('data-light-id')
        if (targetId) {
          setFocusedLightId(targetId)
          targetEl.focus()
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [visibleLights, focusedLightId])

  // Derive Toolbar Configuration
  const toolbarConfig = useMemo(() => {
    if (currentRoom) {
      const activeCount = currentRoomLights.filter((l) => l.online && l.power).length
      return {
        title: currentRoom.name,
        subtitle:
          activeCount > 0
            ? `${activeCount} ${activeCount === 1 ? 'light' : 'lights'} on`
            : `${currentRoomLights.length} ${currentRoomLights.length === 1 ? 'accessory' : 'accessories'}`,
        primaryActionLabel: 'Edit Room',
        primaryActionIcon: Layers,
        onPrimaryAction: () => setIsRoomsOpen(true),
        anyActive: currentRoomActive,
        totalLights: currentRoomLights.length,
        onTogglePower: () =>
          handleToggleRoom(currentRoom.deviceIds, !currentRoomActive)
      }
    }

    if (currentView === 'scenes') {
      return {
        title: 'Scenes',
        subtitle: `${scenes.length} ${scenes.length === 1 ? 'scene' : 'scenes'} saved`,
        primaryActionLabel: 'New Scene',
        primaryActionIcon: Plus,
        onPrimaryAction: () => setIsCreateSceneOpen(true),
        anyActive: activeLights > 0,
        totalLights,
        onTogglePower: () => handleSetAll(activeLights === 0)
      }
    }

    if (currentView === 'effects') {
      const live = effects?.effects.filter((e) => e.status === 'active').length ?? 0
      return {
        title: 'Effects',
        subtitle:
          activeEffectCount === 0
            ? 'All effects off'
            : `${activeEffectCount} on${live > 0 ? `, ${live} active now` : ''}`,
        primaryActionLabel: undefined,
        primaryActionIcon: ShieldCheck,
        onPrimaryAction: undefined,
        anyActive: activeLights > 0,
        totalLights,
        onTogglePower: () => handleSetAll(activeLights === 0)
      }
    }

    if (currentView === 'energy') {
      return {
        title: 'Energy',
        subtitle: 'Estimated from rated wattage',
        primaryActionLabel: 'Export',
        primaryActionIcon: Download,
        onPrimaryAction: () => void window.lumos?.exportEnergy(),
        anyActive: activeLights > 0,
        totalLights,
        onTogglePower: () => handleSetAll(activeLights === 0)
      }
    }

    if (currentView === 'automations') {
      return {
        title: 'Automations',
        subtitle: `${activeAutomationCount} active routines`,
        primaryActionLabel: 'New Schedule',
        primaryActionIcon: Plus,
        onPrimaryAction: () => setIsCreateScheduleOpen(true),
        anyActive: activeLights > 0,
        totalLights,
        onTogglePower: () => handleSetAll(activeLights === 0)
      }
    }

    return {
      title: isDemoMode ? 'Home (Demo)' : 'Home',
      subtitle: activeLights > 0 ? `${activeLights} lights on` : 'All lights off',
      primaryActionLabel: 'Add Room',
      primaryActionIcon: Plus,
      onPrimaryAction: () => setIsRoomsOpen(true),
      anyActive: activeLights > 0,
      totalLights,
      onTogglePower: () => handleSetAll(activeLights === 0)
    }
  }, [
    currentRoom,
    currentRoomLights,
    currentRoomActive,
    currentView,
    scenes.length,
    activeAutomationCount,
    activeLights,
    totalLights,
    isDemoMode,
    handleToggleRoom,
    handleSetAll,
    effects,
    activeEffectCount
  ])

  // If no devices configured and not exploring demo, show first-run onboarding screen
  if (!loading && !hasConfig && !isDemoMode && lights.length === 0) {
    return (
      <div className="h-screen w-screen overflow-hidden flex bg-[#09090b] text-zinc-100 font-sans selection:bg-amber-400/30 selection:text-white">
        <AmbientBackdrop lights={[]} />
        <OnboardingView
          onComplete={fetchStatusAndStore}
          onExploreDemo={handleExploreDemo}
        />
      </div>
    )
  }

  return (
    <div className="h-screen w-screen overflow-hidden flex bg-[#09090b] text-zinc-100 font-sans selection:bg-amber-400/30 selection:text-white">
      {/* Ambient background tinted by the lights that are on */}
      <AmbientBackdrop lights={visibleLights} />

      {/* Collapsible Sidebar */}
      <Sidebar
        currentView={currentView}
        rooms={rooms}
        lights={visibleLights}
        sceneCount={scenes.length}
        activeAutomationCount={activeAutomationCount}
        activeEffectCount={activeEffectCount}
        onSelectView={(viewId) => {
          setCurrentView(viewId)
        }}
        onAddRoom={() => setIsRoomsOpen(true)}
        onOpenSettings={() => setIsSettingsOpen(true)}
        isCollapsed={isSidebarCollapsed}
        isCompact={isCompact}
        onToggleCollapse={() => setIsSidebarCollapsed((prev) => !prev)}
      />

      {/* Main Workspace Pane */}
      <div className="flex-1 flex flex-col h-full overflow-hidden relative z-10">
        {/* Minimal Window Toolbar */}
        <Toolbar
          title={toolbarConfig.title}
          subtitle={toolbarConfig.subtitle}
          isSidebarCollapsed={isSidebarCollapsed}
          isCompact={isCompact}
          onToggleSidebar={() => setIsSidebarCollapsed((prev) => !prev)}
          primaryActionLabel={toolbarConfig.primaryActionLabel}
          primaryActionIcon={toolbarConfig.primaryActionIcon}
          onPrimaryAction={toolbarConfig.onPrimaryAction}
          anyActive={toolbarConfig.anyActive}
          totalLights={toolbarConfig.totalLights}
          onTogglePower={toolbarConfig.onTogglePower}
          onScanSubnet={fetchStatusAndStore}
          onRefresh={fetchStatusAndStore}
          onOpenSettings={() => setIsSettingsOpen(true)}
        />

        {/* Scrollable View Canvas */}
        <main className="flex-1 overflow-y-auto px-6 sm:px-8 py-4 pb-20 no-scrollbar">
          {loading ? (
            /* Shimmering Tile Skeletons */
            <div className="max-w-6xl mx-auto flex flex-col gap-6">
              <div className="flex flex-col gap-1.5 px-1">
                <div className="w-28 h-5 rounded-lg bg-white/[0.06] animate-pulse" />
                <div className="w-16 h-3 rounded-md bg-white/[0.03] animate-pulse" />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div
                    key={i}
                    className="h-[114px] rounded-[20px] bg-white/[0.03] border border-white/[0.06] p-3.5 flex flex-col justify-between animate-pulse"
                  >
                    <div className="flex items-center justify-between">
                      <div className="w-8.5 h-8.5 rounded-full bg-white/[0.06]" />
                      <div className="w-5 h-5 rounded-md bg-white/[0.03]" />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <div className="w-24 h-3.5 rounded-md bg-white/[0.07]" />
                      <div className="w-16 h-2.5 rounded-md bg-white/[0.04]" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : visibleLights.length === 0 && currentView !== 'effects' && currentView !== 'energy' ? (
            /* Calm Empty State */
            <motion.div
              initial={shouldReduceMotion ? false : { opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={springs.default}
              className="flex-1 flex flex-col items-center justify-center min-h-[50vh] max-w-md mx-auto text-center"
            >
              <GlassSurface intensity="medium" className="p-8 flex flex-col items-center gap-4">
                <div className="w-14 h-14 rounded-2xl bg-zinc-900 border border-white/10 flex items-center justify-center text-zinc-400">
                  <LightbulbOff className="w-7 h-7 text-zinc-400" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <h3 className="text-base font-semibold text-white tracking-tight">
                    No Accessories Detected
                  </h3>
                  <p className="text-xs text-zinc-400 leading-relaxed">
                    Lumos is listening on your local subnet. Check your configuration or ensure bulbs are powered on.
                  </p>
                </div>
                <div className="flex items-center gap-2 pt-2">
                  <GlassButton
                    variant="standard"
                    size="md"
                    onClick={fetchStatusAndStore}
                    className="flex items-center gap-2"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>Scan Subnet</span>
                  </GlassButton>
                  <GlassButton
                    variant="prominent"
                    size="md"
                    onClick={handleExploreDemo}
                  >
                    <span>Demo Mode</span>
                  </GlassButton>
                </div>
              </GlassSurface>
            </motion.div>
          ) : (
            <div className="max-w-6xl mx-auto flex flex-col gap-6">
              {/* VIEW 1: HOME */}
              {currentView === 'home' && (
                <>
                  {/* Quick Scenes Bar */}
                  {scenes.length > 0 && (
                    <div className="px-1">
                      <PresetsBar
                        presets={scenes}
                        onApplyPreset={handleApplyScene}
                        disabled={activeLights === 0}
                      />
                    </div>
                  )}

                  {/* Room Sections */}
                  <div className="flex flex-col gap-8">
                    {rooms.map((room) => (
                      <RoomSection
                        key={room.id}
                        room={room}
                        lights={visibleLights}
                        onToggleLight={handleToggle}
                        onBrightnessChange={handleBrightnessChange}
                        onOpenDetail={(l) => setSelectedDetailLightId(l.id)}
                        onToggleRoom={handleToggleRoom}
                        onContextMenu={handleOpenContextMenu}
                        focusedLightId={focusedLightId}
                      />
                    ))}

                    {/* Ungrouped Fixtures Section */}
                    {ungroupedLights.length > 0 && (
                      <section className="flex flex-col gap-3.5 select-none">
                        <div className="flex items-center justify-between px-1">
                          <div className="flex items-center gap-2">
                            <Layers className="w-4 h-4 text-zinc-400" />
                            <h2 className="text-[17px] font-semibold tracking-tight text-white">
                              {rooms.length > 0 ? 'Other Accessories' : 'All Accessories'}
                            </h2>
                            <span className="px-2 py-0.5 rounded-full bg-white/[0.06] border border-white/[0.08] text-[11px] font-medium text-zinc-400">
                              {ungroupedLights.filter((l) => l.online && l.power).length}/{ungroupedLights.length} On
                            </span>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                          <AnimatePresence mode="popLayout">
                            {ungroupedLights.map((light) => (
                              <motion.div
                                key={light.id}
                                layout={!shouldReduceMotion}
                                initial={shouldReduceMotion ? undefined : { opacity: 0, scale: 0.96 }}
                                animate={{ opacity: 1, scale: 1 }}
                                exit={shouldReduceMotion ? undefined : { opacity: 0, scale: 0.94 }}
                                transition={springs.default}
                              >
                                <LightTile
                                  light={light}
                                  onToggle={handleToggle}
                                  onBrightnessChange={handleBrightnessChange}
                                  onOpenDetail={(l) => setSelectedDetailLightId(l.id)}
                                  onContextMenu={handleOpenContextMenu}
                                  isFocused={focusedLightId === light.id}
                                />
                              </motion.div>
                            ))}
                          </AnimatePresence>
                        </div>
                      </section>
                    )}
                  </div>
                </>
              )}

              {/* VIEW 2: SPECIFIC ROOM */}
              {currentRoom && (
                <div className="flex flex-col gap-5">
                  {currentRoomLights.length === 0 ? (
                    <div className="p-12 text-center rounded-2xl bg-zinc-950/30 border border-white/[0.06] flex flex-col items-center gap-3">
                      <Layers className="w-8 h-8 text-zinc-600" />
                      <p className="text-xs text-zinc-400">
                        No accessories assigned to {currentRoom.name} yet.
                      </p>
                      <GlassButton
                        variant="prominent"
                        size="sm"
                        onClick={() => setIsRoomsOpen(true)}
                      >
                        Assign Accessories
                      </GlassButton>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                      <AnimatePresence mode="popLayout">
                        {currentRoomLights.map((light) => (
                          <motion.div
                            key={light.id}
                            layout={!shouldReduceMotion}
                            initial={shouldReduceMotion ? undefined : { opacity: 0, scale: 0.96 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={shouldReduceMotion ? undefined : { opacity: 0, scale: 0.94 }}
                            transition={springs.default}
                          >
                            <LightTile
                              light={light}
                              onToggle={handleToggle}
                              onBrightnessChange={handleBrightnessChange}
                              onOpenDetail={(l) => setSelectedDetailLightId(l.id)}
                              onContextMenu={handleOpenContextMenu}
                              isFocused={focusedLightId === light.id}
                            />
                          </motion.div>
                        ))}
                      </AnimatePresence>
                    </div>
                  )}
                </div>
              )}

              {/* VIEW 3: SCENES */}
              {currentView === 'scenes' && (
                <ScenesView
                  scenes={scenes}
                  onApplyScene={handleApplyScene}
                  onSaveScene={handleSaveScene}
                  onDeleteScene={(sceneId) => {
                    const scene = scenes.find((s) => s.id === sceneId)
                    if (scene) handleDeleteSceneWithUndo(scene)
                  }}
                  onDeleteSceneWithUndo={handleDeleteSceneWithUndo}
                  isCreateOpen={isCreateSceneOpen}
                  onCloseCreate={() => setIsCreateSceneOpen(false)}
                  onOpenCreate={() => setIsCreateSceneOpen(true)}
                />
              )}

              {/* VIEW 5: EFFECTS */}
              {currentView === 'effects' && (
                <EffectsView
                  snapshot={effects}
                  lights={visibleLights}
                  isDemoMode={isDemoMode}
                  onToggle={handleToggleEffect}
                />
              )}

              {/* VIEW 6: ENERGY */}
              {currentView === 'energy' && <EnergyView lights={visibleLights} />}

              {/* VIEW 4: AUTOMATIONS */}
              {currentView === 'automations' && (
                <AutomationsView
                  store={store}
                  lights={visibleLights}
                  onRefreshStore={fetchStatusAndStore}
                  isCreateOpen={isCreateScheduleOpen}
                  onCloseCreate={() => setIsCreateScheduleOpen(false)}
                  onOpenCreate={() => setIsCreateScheduleOpen(true)}
                  onDeleteScheduleWithUndo={handleDeleteScheduleWithUndo}
                />
              )}
            </div>
          )}
        </main>
      </div>

      {/* Actionable Glass Toast Notification with Undo */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={shouldReduceMotion ? undefined : { opacity: 0, y: 16, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={shouldReduceMotion ? undefined : { opacity: 0, y: 12, scale: 0.95 }}
            transition={springs.snappy}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 pointer-events-auto"
          >
            <div className="h-10 px-4 rounded-full bg-[#18181c]/95 backdrop-blur-2xl border border-white/15 shadow-2xl flex items-center gap-3.5 select-none">
              <span className="text-xs text-zinc-200 font-medium">{toast.message}</span>
              {toast.onUndo && (
                <button
                  type="button"
                  onClick={() => {
                    toast.onUndo?.()
                    setToast(null)
                  }}
                  className="text-xs font-semibold text-amber-300 hover:text-amber-200 underline cursor-pointer transition-colors"
                >
                  {toast.actionLabel ?? 'Undo'}
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Unified Settings Sheet */}
      <SettingsSheet
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        onRefreshDevices={fetchStatusAndStore}
      />

      {/* Room Management Sheet */}
      <RoomsSheet
        isOpen={isRoomsOpen}
        onClose={() => setIsRoomsOpen(false)}
        rooms={rooms}
        lights={visibleLights}
        onRefreshStore={fetchStatusAndStore}
        onDeleteRoomWithUndo={handleDeleteRoomWithUndo}
      />

      {/* Hero Light Detail Sheet */}
      <ErrorBoundary
        fallbackTitle="Accessory Detail Interrupted"
        onReset={() => setSelectedDetailLightId(null)}
      >
        <LightDetailSheet
          isOpen={Boolean(selectedDetailLight)}
          light={selectedDetailLight}
          rooms={rooms}
          onClose={() => setSelectedDetailLightId(null)}
          onToggle={handleToggle}
          onBrightnessChange={handleBrightnessChange}
          onColorTempChange={handleColorTempChange}
          onColorChange={handleColorChange}
          onModeChange={handleModeChange}
          onSetScene={handleSetScene}
          onSetCountdown={handleSetCountdown}
          onUpdateMetadata={handleUpdateMetadata}
        />
      </ErrorBoundary>

      {/* 5-Item Tile Context Menu */}
      <TileContextMenu
        isOpen={contextMenu.isOpen}
        position={contextMenu.position}
        light={contextMenu.light}
        rooms={rooms}
        onClose={handleCloseContextMenu}
        onTogglePower={handleToggle}
        onOpenDetails={(l) => setSelectedDetailLightId(l.id)}
        onUpdateMetadata={handleUpdateMetadata}
      />
    </div>
  )
}

export default App
