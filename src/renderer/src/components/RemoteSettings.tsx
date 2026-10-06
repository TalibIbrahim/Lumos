import React, { useCallback, useEffect, useState } from 'react'
import { Loader2, Monitor, RefreshCw } from 'lucide-react'
import { GlassButton } from './ui/GlassButton'
import { Group, Row, ToggleButton } from './ui/SettingsControls'
import { FoundHubData, RemoteStateData } from '../types'

const HUB_PORT = 8990

/**
 * Settings for control from more than one computer. Tuya lights accept one
 * local connection, so one computer keeps the lights and others control them
 * through it.
 */
export const RemoteSettings: React.FC<{ isOpen: boolean; onConnected?: () => void }> = ({ isOpen, onConnected }) => {
  const api = window.lumos
  const [state, setState] = useState<RemoteStateData | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [joining, setJoining] = useState(false)
  const [found, setFound] = useState<FoundHubData[] | null>(null)
  const [address, setAddress] = useState('')
  const [port, setPort] = useState(HUB_PORT)
  const [code, setCode] = useState('')
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    if (!api?.getRemoteState || !isOpen) return undefined
    api.getRemoteState().then(setState).catch(() => {})
    const unsub = api.onRemoteStatus(setState)
    const tick = setInterval(() => setNow(Date.now()), 15000)
    return () => {
      unsub()
      clearInterval(tick)
    }
  }, [api, isOpen])

  const run = useCallback(
    async (fn: () => Promise<{ ok: boolean; state?: RemoteStateData; error?: string }>): Promise<boolean> => {
      setBusy(true)
      setError('')
      try {
        const r = await fn()
        if (r.state) setState(r.state)
        if (!r.ok) setError(r.error || 'Something went wrong')
        return r.ok
      } finally {
        setBusy(false)
      }
    },
    []
  )

  const search = useCallback(async () => {
    if (!api) return
    setFound(null)
    const r = await api.discoverRemoteHubs()
    const hubs = r.ok && r.result ? r.result : []
    setFound(hubs)
    if (hubs.length === 1 && !address) {
      setAddress(hubs[0].address)
      setPort(hubs[0].port)
    }
  }, [api, address])

  useEffect(() => {
    if (joining) void search()
    // Search once when the form opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [joining])

  if (!state) return null

  const hub = state.hub
  const client = state.client
  const minutesLeft = hub.codeExpiresAt ? Math.max(0, Math.ceil((hub.codeExpiresAt - now) / 60000)) : 0

  return (
    <Group
      title="Other computers"
      footer={
        state.role === 'client'
          ? 'Lights, rooms, scenes, automations, effects, and energy all come from the other computer. Effects such as Music listen to sound on that computer.'
          : 'Each light accepts only one direct connection, so only one computer can talk to the lights at a time. Other computers can control them through that one.'
      }
    >
      {error && (
        <div role="alert" className="px-4 py-2.5 text-[11px] text-rose-200 bg-rose-500/10">
          {error}
        </div>
      )}

      {state.role === 'client' && client ? (
        <>
          <Row
            label={`Using the lights on ${client.hubName}`}
            hint={
              client.state === 'connected'
                ? `Connected at ${client.address}`
                : client.state === 'connecting'
                  ? 'Connecting'
                  : client.error || `Cannot reach ${client.hubName}. Make sure Lumos is running there.`
            }
          >
            <span
              className={`w-2 h-2 rounded-full flex-shrink-0 ${
                client.state === 'connected' ? 'bg-emerald-400' : client.state === 'connecting' ? 'bg-sky-400 animate-pulse' : 'bg-rose-400'
              }`}
              aria-hidden="true"
            />
          </Row>
          <Row label="Control the lights from this computer directly" hint="Only works while no other computer is connected to them.">
            <GlassButton variant="standard" size="sm" disabled={busy} onClick={() => void run(() => api.leaveRemoteHub())}>
              Stop using {client.hubName}
            </GlassButton>
          </Row>
        </>
      ) : (
        <>
          <Row label="Share these lights with other computers" hint={`Lets other computers on this network control the lights through ${state.computerName}.`}>
            <ToggleButton
              on={state.role === 'hub'}
              disabled={busy}
              onChange={(on) => void run(() => api.setRemoteHub(on))}
              ariaLabel="Share these lights with other computers"
            />
          </Row>

          {state.role === 'hub' && (
            <>
              {hub.error ? (
                <Row label="Sharing could not start" hint={hub.error} />
              ) : (
                <Row
                  label="Pairing code"
                  hint={
                    hub.code
                      ? `Enter this on the other computer. It works once and expires in ${minutesLeft} min.`
                      : 'Create a code to pair another computer.'
                  }
                >
                  <div className="flex items-center gap-3">
                    {hub.code && (
                      <span className="font-mono text-xl tracking-[0.25em] text-white select-text" aria-label={`Pairing code ${hub.code.split('').join(' ')}`}>
                        {hub.code}
                      </span>
                    )}
                    <GlassButton variant="standard" size="icon-sm" title="New code" aria-label="New code" disabled={busy} onClick={() => void run(() => api.newRemoteCode())}>
                      <RefreshCw className="w-3.5 h-3.5" />
                    </GlassButton>
                  </div>
                </Row>
              )}
              <Row
                label="This computer's address"
                hint={`${hub.addresses.join(', ') || 'No network'} on port ${hub.port}. If Windows asks, allow Lumos on this network.`}
              />
              {hub.clients.map((c) => (
                <Row key={c.id} label={c.name} hint={c.connected ? 'Connected now' : `Paired ${new Date(c.addedAt).toLocaleDateString()}`}>
                  <div className="flex items-center gap-2">
                    <Monitor className={`w-4 h-4 ${c.connected ? 'text-emerald-400' : 'text-zinc-500'}`} aria-hidden="true" />
                    <GlassButton variant="subtle" size="sm" disabled={busy} onClick={() => void run(() => api.removeRemoteClient(c.id))}>
                      Remove
                    </GlassButton>
                  </div>
                </Row>
              ))}
            </>
          )}

          {state.role !== 'hub' && !joining && (
            <Row label="Control lights on another computer" hint="Use this when Lumos on another computer is already connected to your lights.">
              <GlassButton variant="standard" size="sm" onClick={() => setJoining(true)}>
                Connect
              </GlassButton>
            </Row>
          )}

          {state.role !== 'hub' && joining && (
            <>
              <Row label="Computers sharing lights" stacked>
                {found === null ? (
                  <span className="flex items-center gap-2 text-[11px] text-zinc-400">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" /> Looking on this network
                  </span>
                ) : found.length === 0 ? (
                  <span className="text-[11px] text-zinc-400">
                    None found. On the other computer, turn on Share these lights with other computers, or type its address below.{' '}
                    <button type="button" className="text-amber-300 underline min-h-9" onClick={() => void search()}>
                      Look again
                    </button>
                  </span>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {found.map((h) => (
                      <button
                        key={h.id}
                        type="button"
                        onClick={() => {
                          setAddress(h.address)
                          setPort(h.port)
                        }}
                        className={`h-9 px-3.5 rounded-full text-xs font-medium border transition-colors outline-none focus-visible:ring-2 focus-visible:ring-white/80 ${
                          address === h.address ? 'bg-amber-400/15 border-amber-400/40 text-amber-200' : 'bg-white/[0.03] border-white/[0.08] text-zinc-300'
                        }`}
                      >
                        {h.name} · {h.address}
                      </button>
                    ))}
                  </div>
                )}
              </Row>
              <Row label="Address and pairing code" hint="This computer will stop connecting to the lights itself." stacked>
                <div className="flex flex-wrap items-center gap-2">
                  <label className="sr-only" htmlFor="remote-address">
                    Address of the other computer
                  </label>
                  <input
                    id="remote-address"
                    type="text"
                    value={address}
                    placeholder="192.168.1.20"
                    onChange={(e) => setAddress(e.target.value)}
                    className="h-9 w-40 px-3 rounded-xl bg-black/30 border border-white/[0.08] text-xs text-white font-mono placeholder:text-zinc-600 outline-none focus:border-amber-400/50 select-text"
                  />
                  <label className="sr-only" htmlFor="remote-code">
                    Six-digit pairing code
                  </label>
                  <input
                    id="remote-code"
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    value={code}
                    placeholder="Code"
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    className="h-9 w-24 px-3 rounded-xl bg-black/30 border border-white/[0.08] text-xs text-white font-mono tracking-widest placeholder:text-zinc-600 placeholder:tracking-normal outline-none focus:border-amber-400/50 select-text"
                  />
                  <GlassButton
                    variant="prominent"
                    size="sm"
                    disabled={busy || !address.trim() || code.length !== 6}
                    onClick={async () => {
                      const ok = await run(() => api.pairRemoteHub(address, port, code))
                      if (ok) {
                        setJoining(false)
                        setCode('')
                        onConnected?.()
                      }
                    }}
                  >
                    {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                    Connect
                  </GlassButton>
                  <GlassButton variant="subtle" size="sm" onClick={() => setJoining(false)}>
                    Cancel
                  </GlassButton>
                </div>
              </Row>
            </>
          )}
        </>
      )}
    </Group>
  )
}

export default RemoteSettings
