import { ipcMain, IpcMainInvokeEvent, IpcMainEvent } from 'electron'
import { FORWARDED_CHANNELS } from './channels'

/* eslint-disable @typescript-eslint/no-explicit-any */
type Listener = (event: any, ...args: any[]) => any

/**
 * Registry of the app's IPC handlers. Each handler is registered once and can
 * be run either for this computer's own window or, on a hub, for a remote
 * computer. On a remote computer, forwarded actions go to the hub instead.
 */
const handlers = new Map<string, Listener>()

export interface Forwarder {
  isActive(): boolean
  invoke(channel: string, args: unknown[]): Promise<unknown>
  send(channel: string, args: unknown[]): void
}

let forwarder: Forwarder | null = null

export function setForwarder(f: Forwarder | null): void {
  forwarder = f
}

export function isForwarding(): boolean {
  return Boolean(forwarder?.isActive())
}

/** Like ipcMain.handle, but forwardable. */
export function handle(channel: string, listener: Listener): void {
  handlers.set(channel, listener)
  ipcMain.handle(channel, (event: IpcMainInvokeEvent, ...args: unknown[]) => {
    if (FORWARDED_CHANNELS.has(channel) && forwarder?.isActive()) return forwarder.invoke(channel, args)
    return listener(event, ...args)
  })
}

/** Like ipcMain.on, but forwardable. */
export function on(channel: string, listener: Listener): void {
  handlers.set(channel, listener)
  ipcMain.on(channel, (event: IpcMainEvent, ...args: unknown[]) => {
    if (FORWARDED_CHANNELS.has(channel) && forwarder?.isActive()) {
      forwarder.send(channel, args)
      return
    }
    listener(event, ...args)
  })
}

/** Runs a handler here, or on the hub when this computer controls another computer's lights. */
export async function invokeAuto(channel: string, args: unknown[]): Promise<unknown> {
  if (FORWARDED_CHANNELS.has(channel) && forwarder?.isActive()) return forwarder.invoke(channel, args)
  const listener = handlers.get(channel)
  if (!listener) throw new Error('Unknown action')
  return listener({ sender: null }, ...args)
}

/** Runs a forwardable handler on behalf of a remote computer. */
export async function invokeLocal(channel: string, args: unknown[]): Promise<unknown> {
  if (!FORWARDED_CHANNELS.has(channel)) throw new Error('Not allowed')
  const listener = handlers.get(channel)
  if (!listener) throw new Error('Unknown action')
  return listener({ sender: null, remote: true }, ...args)
}
