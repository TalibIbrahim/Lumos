import React, { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X,
  Check,
  Copy,
  RotateCcw,
  AlertTriangle,
  Radio,
  CheckCircle2,
  Power,
  Loader2,
  QrCode,
  ShieldCheck,
  Sliders,
  Sparkles,
  Info,
  Zap,
  Upload,
  RefreshCw,
  Download
} from 'lucide-react'
import { GlassSurface } from './ui/GlassSurface'
import { GlassButton } from './ui/GlassButton'
import { RemoteSettings } from './RemoteSettings'
import { springs } from '../lib/constants'
import { HomeKitInfo, WebhookInfo, UpdateStatus } from '../types'

export interface SettingsSheetProps {
  isOpen: boolean
  onClose: () => void
  onRefreshDevices?: () => void
}

/**
 * Lumos Unified Settings Sheet
 * Apple macOS Inset Grouped style:
 * - Grouped lists with clear category headers:
 *    1. General: Launch at login (switch), Start in tray (switch)
 *    2. HomeKit: Pairing status badge, PIN code with copy, QR code toggle, Reset bridge with confirmation
 *    3. Integrations: Dynamic Webhook endpoint and token, Flash test trigger
 *    4. Configuration: Import / update TinyTuya devices.json
 *    5. About: Lumos version 1.0.0, runtime info, credits
 */
export const SettingsSheet: React.FC<SettingsSheetProps> = ({ isOpen, onClose, onRefreshDevices }) => {
  const [hkInfo, setHkInfo] = useState<HomeKitInfo | null>(null)
  const [webhookInfo, setWebhookInfo] = useState<WebhookInfo | null>(null)
  const [loadingHk, setLoadingHk] = useState(false)
  const [launchAtLogin, setLaunchAtLogin] = useState(false)
  const [startInTray, setStartInTray] = useState(true)
  const [copiedCode, setCopiedCode] = useState(false)
  const [copiedWebhook, setCopiedWebhook] = useState(false)
  const [copiedToken, setCopiedToken] = useState(false)
  const [showQrCode, setShowQrCode] = useState(false)
  const [confirmingReset, setConfirmingReset] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [flashing, setFlashing] = useState(false)
  const [importMessage, setImportMessage] = useState<string | null>(null)
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({ state: 'idle' })
  const [appVersion, setAppVersion] = useState('1.0.0')
  const [checkingUpdate, setCheckingUpdate] = useState(false)

  const loadSettingsData = useCallback(async () => {
    const api = window.lumos || window.lumen
    if (!api) return
    setLoadingHk(true)
    try {
      const [info, loginSetting, wh, ver, upStat] = await Promise.all([
        api.getHomeKitInfo(),
        api.getLaunchAtLogin(),
        api.getWebhookInfo ? api.getWebhookInfo() : Promise.resolve(null),
        api.getAppVersion ? api.getAppVersion() : Promise.resolve('1.0.0'),
        api.getUpdateStatus ? api.getUpdateStatus() : Promise.resolve({ state: 'idle' } as UpdateStatus)
      ])
      setHkInfo(info)
      setLaunchAtLogin(loginSetting)
      if (wh) {
        setWebhookInfo(wh)
      }
      if (ver) {
        setAppVersion(ver)
      }
      if (upStat) {
        setUpdateStatus(upStat)
      }
    } catch (err) {
      console.error('[SettingsSheet] Error loading settings data:', err)
    } finally {
      setLoadingHk(false)
    }
  }, [])

  useEffect(() => {
    const api = window.lumos || window.lumen
    if (!api?.onUpdateStatus) return
    const unsubscribe = api.onUpdateStatus((status) => {
      setUpdateStatus(status)
      if (status.state !== 'checking') {
        setCheckingUpdate(false)
      }
    })
    return () => unsubscribe()
  }, [])

  useEffect(() => {
    if (isOpen) {
      loadSettingsData()
      setConfirmingReset(false)
      setShowQrCode(false)
      setImportMessage(null)
    }
  }, [isOpen, loadSettingsData])

  // Esc key to dismiss
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && isOpen) {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  const handleCopyCode = (): void => {
    if (!hkInfo?.setupCode) return
    navigator.clipboard.writeText(hkInfo.setupCode)
    setCopiedCode(true)
    setTimeout(() => setCopiedCode(false), 2000)
  }

  const handleCopyWebhook = (): void => {
    if (!webhookInfo?.url) return
    navigator.clipboard.writeText(webhookInfo.url)
    setCopiedWebhook(true)
    setTimeout(() => setCopiedWebhook(false), 2000)
  }

  const handleCopyToken = (): void => {
    if (!webhookInfo?.token) return
    navigator.clipboard.writeText(webhookInfo.token)
    setCopiedToken(true)
    setTimeout(() => setCopiedToken(false), 2000)
  }

  const handleToggleLaunchAtLogin = async (): Promise<void> => {
    const api = window.lumos || window.lumen
    if (!api) return
    const nextVal = !launchAtLogin
    setLaunchAtLogin(nextVal)
    try {
      const result = await api.setLaunchAtLogin(nextVal)
      setLaunchAtLogin(Boolean(result))
    } catch (err) {
      console.error('[SettingsSheet] Error updating launch setting:', err)
      setLaunchAtLogin(!nextVal)
    }
  }

  const handleResetHomeKit = async (): Promise<void> => {
    const api = window.lumos || window.lumen
    if (!api) return
    setResetting(true)
    try {
      const updated = await api.resetHomeKit()
      setHkInfo(updated)
      setConfirmingReset(false)
    } catch (err) {
      console.error('[SettingsSheet] Error resetting HomeKit pairing:', err)
    } finally {
      setResetting(false)
    }
  }

  const handleTriggerFlash = async (): Promise<void> => {
    const api = window.lumos || window.lumen
    if (!api?.triggerFlash) return
    setFlashing(true)
    try {
      await api.triggerFlash()
    } catch (err) {
      console.error('[SettingsSheet] Flash error:', err)
    } finally {
      setFlashing(false)
    }
  }

  const handleImportDevices = async (): Promise<void> => {
    const api = window.lumos || window.lumen
    if (!api?.pickAndImportDevicesFile) return
    try {
      const res = await api.pickAndImportDevicesFile()
      if (res.canceled) return
      if (res.success) {
        setImportMessage(`Imported ${res.lightsCount} light(s) successfully!`)
        if (onRefreshDevices) onRefreshDevices()
      } else {
        setImportMessage(`Import failed: ${res.error || 'Unknown error'}`)
      }
    } catch (err: any) {
      setImportMessage(`Error: ${err?.message || 'Failed importing file'}`)
    }
  }

  const handleCheckForUpdates = async (): Promise<void> => {
    const api = window.lumos || window.lumen
    if (!api?.checkForUpdates) return
    setCheckingUpdate(true)
    try {
      await api.checkForUpdates()
    } catch (err) {
      console.warn('[SettingsSheet] Check for updates error:', err)
    } finally {
      setTimeout(() => setCheckingUpdate(false), 2500)
    }
  }

  const handleInstallUpdate = async (): Promise<void> => {
    const api = window.lumos || window.lumen
    if (!api?.installUpdate) return
    await api.installUpdate()
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 select-none">
          {/* Backdrop Scrim */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={springs.snappy}
            onClick={onClose}
            className="fixed inset-0 bg-black/65 backdrop-blur-md"
          />

          {/* Modal Container */}
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 12 }}
            transition={springs.default}
            onClick={(e) => e.stopPropagation()}
            className="relative z-10 w-full max-w-xl max-h-[88vh] rounded-3xl overflow-hidden flex flex-col shadow-2xl shadow-black/80"
          >
            <GlassSurface
              intensity="elevated"
              borderIntensity="bright"
              borderRadius={28}
              className="w-full h-full flex flex-col"
            >
              <div className="w-full h-full max-h-[88vh] flex flex-col p-6 overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between pb-4 border-b border-white/[0.08] flex-shrink-0">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-white/[0.08] border border-white/[0.1] flex items-center justify-center text-amber-300 shadow-inner">
                      <Sliders className="w-4 h-4" />
                    </div>
                    <div>
                      <h2 className="text-base font-semibold text-white tracking-tight">
                        Settings
                      </h2>
                      <p className="text-xs text-zinc-400">
                        Preferences, Apple Home bridge, and local integrations
                      </p>
                    </div>
                  </div>

                  <GlassButton
                    variant="subtle"
                    size="icon-sm"
                    onClick={onClose}
                    title="Close settings"
                  >
                    <X className="w-3.5 h-3.5" />
                  </GlassButton>
                </div>

                {/* Scrollable Content */}
                <div className="flex-1 overflow-y-auto no-scrollbar min-h-0 pt-4 pb-8 flex flex-col gap-6">
                  {/* Group 1: General */}
                  <div className="flex flex-col gap-2">
                    <span className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider px-1">
                      General
                    </span>
                    <div className="flex flex-col rounded-2xl bg-white/[0.04] border border-white/[0.07] divide-y divide-white/[0.06] overflow-hidden">
                      {/* Launch at Login */}
                      <div
                        className="h-12 px-4 flex items-center justify-between cursor-pointer hover:bg-white/[0.02] transition-colors"
                        onClick={handleToggleLaunchAtLogin}
                      >
                        <div className="flex items-center gap-3">
                          <Power className={`w-4 h-4 transition-colors ${launchAtLogin ? 'text-amber-400' : 'text-zinc-400'}`} />
                          <span className="text-xs font-medium text-white">Launch at Login</span>
                        </div>
                        <GlassButton
                          variant={launchAtLogin ? 'prominent' : 'standard'}
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation()
                            handleToggleLaunchAtLogin()
                          }}
                          className="text-xs"
                        >
                          <Check className={`w-3.5 h-3.5 ${launchAtLogin ? 'opacity-100' : 'opacity-0'}`} />
                          <span>{launchAtLogin ? 'Enabled' : 'Disabled'}</span>
                        </GlassButton>
                      </div>

                      {/* Start Minimized in Tray */}
                      <div
                        className="h-12 px-4 flex items-center justify-between cursor-pointer hover:bg-white/[0.02] transition-colors"
                        onClick={() => setStartInTray(!startInTray)}
                      >
                        <div className="flex items-center gap-3">
                          <ShieldCheck className={`w-4 h-4 transition-colors ${startInTray ? 'text-amber-400' : 'text-zinc-400'}`} />
                          <span className="text-xs font-medium text-white">Start Minimized in System Tray</span>
                        </div>
                        <GlassButton
                          variant={startInTray ? 'prominent' : 'standard'}
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation()
                            setStartInTray(!startInTray)
                          }}
                          className="text-xs"
                        >
                          <Check className={`w-3.5 h-3.5 ${startInTray ? 'opacity-100' : 'opacity-0'}`} />
                          <span>{startInTray ? 'Enabled' : 'Disabled'}</span>
                        </GlassButton>
                      </div>
                    </div>
                  </div>

                  {/* Group 2: HomeKit Bridge */}
                  <div className="flex flex-col gap-2">
                    <span className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider px-1">
                      HomeKit Bridge
                    </span>
                    <div className="flex flex-col rounded-2xl bg-white/[0.04] border border-white/[0.07] p-4 gap-4">
                      {loadingHk && !hkInfo ? (
                        <div className="py-6 flex items-center justify-center gap-2 text-xs text-zinc-400">
                          <Loader2 className="w-4 h-4 animate-spin text-amber-400" />
                          <span>Loading HomeKit bridge status...</span>
                        </div>
                      ) : hkInfo ? (
                        <>
                          {/* Pairing Status Badge */}
                          <div
                            className={`flex items-center justify-between px-3.5 py-2.5 rounded-xl border text-xs font-medium transition-colors ${
                              hkInfo.isPaired
                                ? 'bg-emerald-950/40 border-emerald-500/30 text-emerald-300'
                                : 'bg-amber-950/30 border-amber-500/30 text-amber-200'
                            }`}
                          >
                            <div className="flex items-center gap-2.5">
                              {hkInfo.isPaired ? (
                                <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                              ) : (
                                <Radio className="w-4 h-4 text-amber-400 animate-pulse flex-shrink-0" />
                              )}
                              <span>
                                {hkInfo.isPaired
                                  ? 'Paired with Apple Home'
                                  : 'Ready to Pair — Broadcasting on LAN'}
                              </span>
                            </div>
                            <span className="text-[11px] font-mono text-zinc-400">
                              {hkInfo.accessoryCount} {hkInfo.accessoryCount === 1 ? 'light' : 'lights'}
                            </span>
                          </div>

                          {/* Setup Code & QR Controls */}
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            {/* PIN Code Box */}
                            <div className="flex flex-col gap-1.5 p-3 rounded-xl bg-zinc-950/60 border border-white/[0.06]">
                              <span className="text-[10px] font-mono uppercase text-zinc-400">
                                Setup PIN Code
                              </span>
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-mono text-base font-bold tracking-widest text-amber-300">
                                  {hkInfo.setupCode}
                                </span>
                                <GlassButton
                                  variant="standard"
                                  size="sm"
                                  onClick={handleCopyCode}
                                  title="Copy code"
                                  className="px-2.5"
                                >
                                  {copiedCode ? (
                                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                                  ) : (
                                    <Copy className="w-3.5 h-3.5" />
                                  )}
                                </GlassButton>
                              </div>
                            </div>

                            {/* QR Code Affordance */}
                            <div className="flex flex-col gap-1.5 p-3 rounded-xl bg-zinc-950/60 border border-white/[0.06]">
                              <span className="text-[10px] font-mono uppercase text-zinc-400">
                                Apple Home QR
                              </span>
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-xs text-zinc-300 font-medium">
                                  Visual pairing code
                                </span>
                                <GlassButton
                                  variant={showQrCode ? 'prominent' : 'standard'}
                                  size="sm"
                                  onClick={() => setShowQrCode(!showQrCode)}
                                  className="px-2.5"
                                >
                                  <QrCode className="w-3.5 h-3.5" />
                                  <span>{showQrCode ? 'Hide QR' : 'View QR'}</span>
                                </GlassButton>
                              </div>
                            </div>
                          </div>

                          {/* Expandable QR Code Frame */}
                          <AnimatePresence>
                            {showQrCode && hkInfo.qrCodeDataUrl && (
                              <motion.div
                                initial={{ opacity: 0, height: 0 }}
                                animate={{ opacity: 1, height: 'auto' }}
                                exit={{ opacity: 0, height: 0 }}
                                transition={springs.snappy}
                                className="flex flex-col items-center justify-center p-4 bg-white rounded-2xl shadow-xl overflow-hidden"
                              >
                                <img
                                  src={hkInfo.qrCodeDataUrl}
                                  alt="HomeKit Setup QR Code"
                                  className="w-44 h-44 block rounded-lg"
                                />
                                <span className="mt-2 text-[10px] font-mono text-zinc-700 tracking-wider uppercase">
                                  Scan with Camera or Apple Home
                                </span>
                              </motion.div>
                            )}
                          </AnimatePresence>

                          {/* Reset Bridge Row */}
                          <div className="pt-1 flex items-center justify-between border-t border-white/[0.06]">
                            <div className="flex items-center gap-1.5 text-[11px] text-zinc-500">
                              <Info className="w-3.5 h-3.5" />
                              <span>Bridge ID: {hkInfo.bridgeUsername}</span>
                            </div>

                            {confirmingReset ? (
                              <div className="flex items-center gap-2">
                                <GlassButton
                                  variant="subtle"
                                  size="sm"
                                  onClick={() => setConfirmingReset(false)}
                                  disabled={resetting}
                                >
                                  Cancel
                                </GlassButton>
                                <GlassButton
                                  variant="destructive"
                                  size="sm"
                                  onClick={handleResetHomeKit}
                                  disabled={resetting}
                                >
                                  {resetting ? (
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                  ) : (
                                    <AlertTriangle className="w-3.5 h-3.5" />
                                  )}
                                  <span>Confirm Reset</span>
                                </GlassButton>
                              </div>
                            ) : (
                              <GlassButton
                                variant="destructive"
                                size="sm"
                                onClick={() => setConfirmingReset(true)}
                              >
                                <RotateCcw className="w-3.5 h-3.5" />
                                <span>Reset Bridge</span>
                              </GlassButton>
                            )}
                          </div>
                        </>
                      ) : null}
                    </div>
                  </div>

                  {/* Group 3: Integrations & Webhook */}
                  <div className="flex flex-col gap-2">
                    <span className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider px-1">
                      Integrations & REST Webhook
                    </span>
                    <div className="flex flex-col rounded-2xl bg-white/[0.04] border border-white/[0.07] p-4 gap-3">
                      <div className="flex flex-col gap-1">
                        <span className="text-[10px] font-mono uppercase text-zinc-400">
                          Local REST Endpoint
                        </span>
                        <div className="flex items-center justify-between gap-2 p-2 rounded-xl bg-zinc-950/60 border border-white/[0.06]">
                          <code className="text-xs font-mono text-zinc-300 truncate">
                            {webhookInfo?.url || 'http://127.0.0.1:8989/api/v1/control'}
                          </code>
                          <GlassButton
                            variant="subtle"
                            size="sm"
                            onClick={handleCopyWebhook}
                            className="px-2"
                          >
                            {copiedWebhook ? (
                              <Check className="w-3.5 h-3.5 text-emerald-400" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                          </GlassButton>
                        </div>
                      </div>

                      <div className="flex flex-col gap-1">
                        <span className="text-[10px] font-mono uppercase text-zinc-400">
                          Authorization Bearer Token
                        </span>
                        <div className="flex items-center justify-between gap-2 p-2 rounded-xl bg-zinc-950/60 border border-white/[0.06]">
                          <code className="text-xs font-mono text-zinc-300 truncate">
                            {webhookInfo?.token || 'Loading...'}
                          </code>
                          <GlassButton
                            variant="subtle"
                            size="sm"
                            onClick={handleCopyToken}
                            className="px-2"
                          >
                            {copiedToken ? (
                              <Check className="w-3.5 h-3.5 text-emerald-400" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                          </GlassButton>
                        </div>
                      </div>

                      <div className="pt-2 flex items-center justify-between border-t border-white/[0.06]">
                        <p className="text-[11px] text-zinc-500 leading-relaxed pr-2">
                          Trigger flashes or sync scripts via localhost HTTP requests.
                        </p>
                        <GlassButton
                          variant="standard"
                          size="sm"
                          onClick={handleTriggerFlash}
                          disabled={flashing}
                          className="flex items-center gap-1.5 flex-shrink-0"
                        >
                          <Zap className={`w-3.5 h-3.5 text-amber-400 ${flashing ? 'animate-bounce' : ''}`} />
                          <span>Test Flash</span>
                        </GlassButton>
                      </div>
                    </div>
                  </div>

                  {/* Control from other computers */}
                  <RemoteSettings isOpen={isOpen} onConnected={onRefreshDevices} />

                  {/* Group 4: Device Configuration */}
                  <div className="flex flex-col gap-2">
                    <span className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider px-1">
                      Device Configuration
                    </span>
                    <div className="flex flex-col rounded-2xl bg-white/[0.04] border border-white/[0.07] p-4 gap-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <h4 className="text-xs font-medium text-white">Import TinyTuya devices.json</h4>
                          <p className="text-[11px] text-zinc-400">
                            Re-import or update your device keys and network mappings.
                          </p>
                        </div>
                        <GlassButton
                          variant="standard"
                          size="sm"
                          onClick={handleImportDevices}
                          className="flex items-center gap-2"
                        >
                          <Upload className="w-3.5 h-3.5" />
                          <span>Import File</span>
                        </GlassButton>
                      </div>

                      {importMessage && (
                        <p className="text-xs font-mono text-amber-300 bg-amber-950/20 p-2 rounded-lg border border-amber-500/20">
                          {importMessage}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Group 5: Software Updates */}
                  <div className="flex flex-col gap-2">
                    <span className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider px-1">
                      Software Updates
                    </span>
                    <div className="flex flex-col rounded-2xl bg-white/[0.04] border border-white/[0.07] p-4 gap-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <h4 className="text-xs font-medium text-white">Lumos Version {appVersion}</h4>
                          <p className="text-[11px] text-zinc-400">
                            {updateStatus.state === 'checking' || checkingUpdate
                              ? 'Checking for updates...'
                              : updateStatus.state === 'available'
                              ? `New version ${updateStatus.version} available`
                              : updateStatus.state === 'downloading'
                              ? `Downloading update (${updateStatus.percent}%)...`
                              : updateStatus.state === 'downloaded'
                              ? `Version ${updateStatus.version} downloaded and ready to install.`
                              : updateStatus.state === 'error'
                              ? 'Up to date (or offline)'
                              : 'Automatic background updates enabled from GitHub releases.'}
                          </p>
                        </div>
                        <div>
                          {updateStatus.state === 'downloaded' ? (
                            <GlassButton
                              variant="prominent"
                              size="sm"
                              onClick={handleInstallUpdate}
                              className="flex items-center gap-2 bg-amber-500/20 text-amber-300 border-amber-500/40 hover:bg-amber-500/30"
                            >
                              <Download className="w-3.5 h-3.5" />
                              <span>Restart & Update</span>
                            </GlassButton>
                          ) : (
                            <GlassButton
                              variant="standard"
                              size="sm"
                              onClick={handleCheckForUpdates}
                              disabled={
                                checkingUpdate ||
                                updateStatus.state === 'checking' ||
                                updateStatus.state === 'downloading'
                              }
                              className="flex items-center gap-2"
                            >
                              <RefreshCw
                                className={`w-3.5 h-3.5 ${
                                  checkingUpdate || updateStatus.state === 'checking'
                                    ? 'animate-spin text-amber-400'
                                    : ''
                                }`}
                              />
                              <span>
                                {checkingUpdate || updateStatus.state === 'checking'
                                  ? 'Checking...'
                                  : 'Check for Updates'}
                              </span>
                            </GlassButton>
                          )}
                        </div>
                      </div>

                      {updateStatus.state === 'downloading' && (
                        <div className="w-full bg-white/[0.06] rounded-full h-1.5 overflow-hidden">
                          <div
                            className="bg-amber-400 h-full rounded-full transition-all duration-300"
                            style={{ width: `${updateStatus.percent}%` }}
                          />
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Group 6: About */}
                  <div className="flex flex-col gap-2">
                    <span className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider px-1">
                      About
                    </span>
                    <div className="flex flex-col rounded-2xl bg-white/[0.04] border border-white/[0.07] divide-y divide-white/[0.06] overflow-hidden">
                      <div className="h-11 px-4 flex items-center justify-between text-xs">
                        <span className="font-medium text-white">Lumos Architecture</span>
                        <span className="text-zinc-400">Electron 34 · React 19 · Tuya LAN</span>
                      </div>
                      <div className="h-11 px-4 flex items-center justify-between text-xs">
                        <span className="font-medium text-white">Design Foundations</span>
                        <div className="flex items-center gap-1.5 text-amber-300">
                          <Sparkles className="w-3.5 h-3.5" />
                          <span>Apple Human Interface Guidelines</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </GlassSurface>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}

export default SettingsSheet
