import { ipcMain } from 'electron'
import type { RemoteManager } from './RemoteManager'

/** Settings actions for control from other computers. These always run on this computer. */
export function setupRemoteIPC(remote: RemoteManager): void {
  const wrap = async <T>(fn: () => Promise<T> | T): Promise<{ ok: boolean; state?: unknown; result?: T; error?: string }> => {
    try {
      const result = await fn()
      return { ok: true, result, state: remote.getState() }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Something went wrong', state: remote.getState() }
    }
  }

  ipcMain.handle('remote-get-state', () => remote.getState())
  ipcMain.handle('remote-set-hub', (_e, on: unknown) => wrap(() => remote.setHubEnabled(on === true)))
  ipcMain.handle('remote-new-code', () => wrap(() => remote.newPairingCode()))
  ipcMain.handle('remote-remove-client', (_e, id: unknown) =>
    wrap(() => {
      if (typeof id !== 'string') throw new Error('Invalid request')
      return remote.removeClient(id)
    })
  )
  ipcMain.handle('remote-discover', () => wrap(() => remote.discover()))
  ipcMain.handle('remote-pair', (_e, address: unknown, port: unknown, code: unknown) =>
    wrap(() => {
      if (typeof address !== 'string' || typeof code !== 'string') throw new Error('Invalid request')
      return remote.pair(address, Number(port) || 0, code)
    })
  )
  ipcMain.handle('remote-leave', () => wrap(() => remote.leave()))
}
