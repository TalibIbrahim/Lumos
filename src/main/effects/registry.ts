import { powerMonitor } from 'electron'
import type { EffectManager } from './EffectManager'
import { MusicEffect } from './music/MusicEffect'
import { LoopbackMusicSource, SimulatedMusicSource } from './music/capture'
import { AlbumEffect } from './album/AlbumEffect'
import { createWorkerExtractor } from './album/extractor'
import { AwayEffect } from './away/AwayEffect'
import { GamesEffect } from './games/GamesEffect'
import { systemMonitor } from '../system/systemMonitor'

/** Creates and registers every effect. Order here is the order shown in the UI. */
export function registerEffects(manager: EffectManager): void {
  const host = manager.getHost()
  const extractor = createWorkerExtractor()

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

  manager.onDemoChange((demo) => systemMonitor.setSimulated(demo))
  manager.onShutdown(() => {
    extractor.destroy()
    systemMonitor.destroy()
  })
}
