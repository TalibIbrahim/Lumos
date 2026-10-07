import { globalShortcut, powerMonitor } from 'electron'
import type { EffectManager } from './EffectManager'
import { MusicEffect } from './music/MusicEffect'
import { LoopbackMusicSource, SimulatedMusicSource } from './music/capture'
import { AlbumEffect } from './album/AlbumEffect'
import { createWorkerExtractor } from './album/extractor'
import { AwayEffect } from './away/AwayEffect'
import { GamesEffect } from './games/GamesEffect'
import { ScreenSyncEffect } from './screen/ScreenSyncEffect'
import { DisplayScreenSource, SampleScreenSource } from './screen/source'
import { systemMonitor } from '../system/systemMonitor'
import { setTrayEffects } from '../tray'

/** Creates and registers every effect. Order here is the order shown in the UI. */
export function registerEffects(manager: EffectManager): void {
  const host = manager.getHost()
  const extractor = createWorkerExtractor()

  const screenSync = new ScreenSyncEffect(
    host,
    (demo) => (demo ? new SampleScreenSource() : new DisplayScreenSource()),
    powerMonitor,
    systemMonitor,
    (payload) => manager.emitLive('screen', payload)
  )
  manager.register(screenSync)
  manager.register(
    new MusicEffect(
      host,
      (demo) => (demo ? new SimulatedMusicSource() : new LoopbackMusicSource()),
      (payload) => manager.emitLive('music', payload)
    )
  )
  manager.register(new AlbumEffect(host, systemMonitor, extractor.extract))
  manager.register(new AwayEffect(host, powerMonitor, systemMonitor))
  manager.register(new GamesEffect(host))

  const toggleScreenSync = (): void => void manager.setEnabled(screenSync.id, !screenSync.isEnabled())

  // Optional global keyboard shortcut for Screen Sync
  let shortcut = ''
  const applyShortcut = (): void => {
    const wanted = screenSync.getSettings().shortcut
    if (wanted === shortcut) return
    if (shortcut) globalShortcut.unregister(shortcut)
    shortcut = ''
    if (wanted) {
      try {
        if (globalShortcut.register(wanted, toggleScreenSync)) shortcut = wanted
        else console.warn(`[Lumos Effects] The shortcut ${wanted} is already used by another app`)
      } catch {
        // invalid on this platform
      }
    }
  }

  // Screen Sync in the tray menu
  const updateTray = (): void =>
    setTrayEffects([{ label: 'Screen Sync', checked: screenSync.isEnabled(), toggle: toggleScreenSync }])

  applyShortcut()
  updateTray()
  manager.on('snapshot', () => {
    applyShortcut()
    updateTray()
  })

  manager.onDemoChange((demo) => systemMonitor.setSimulated(demo))
  manager.onShutdown(() => {
    if (shortcut) globalShortcut.unregister(shortcut)
    extractor.destroy()
    systemMonitor.destroy()
  })
}
