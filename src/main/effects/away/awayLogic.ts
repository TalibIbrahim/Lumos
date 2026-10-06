export type AwayAction = 'dim' | 'off'
export type AwayReason = 'idle' | 'lock' | 'suspend'

export interface AwayInputs {
  idleSeconds: number
  locked: boolean
  suspended: boolean
  /** Media is playing, audio is audible, or a full-screen app is in front. */
  mediaActive: boolean
}

export interface AwayRules {
  idleMinutes: number
  idleAction: AwayAction
  lockAction: AwayAction | 'none'
  stayOnDuringMedia: boolean
}

export type AwayDecision = { away: false; heldByMedia: boolean } | { away: true; reason: AwayReason; action: AwayAction }

/**
 * Decides whether the room should be treated as unattended. Suspend and lock
 * are explicit, so they apply even while media plays; plain inactivity does
 * not dim the room while something is being watched or listened to.
 */
export function decideAway(inputs: AwayInputs, rules: AwayRules): AwayDecision {
  if (inputs.suspended && rules.lockAction !== 'none') {
    return { away: true, reason: 'suspend', action: rules.lockAction }
  }
  if (inputs.locked && rules.lockAction !== 'none') {
    return { away: true, reason: 'lock', action: rules.lockAction }
  }
  const idle = inputs.idleSeconds >= rules.idleMinutes * 60
  if (idle) {
    if (rules.stayOnDuringMedia && inputs.mediaActive) return { away: false, heldByMedia: true }
    return { away: true, reason: 'idle', action: rules.idleAction }
  }
  return { away: false, heldByMedia: false }
}

/** How long to wait before checking idle time again. */
export function nextIdleCheckMs(idleSeconds: number, idleMinutes: number, away: boolean): number {
  // While away, look often so the room brightens as soon as someone returns.
  if (away) return 1000
  const remaining = idleMinutes * 60 - idleSeconds
  return Math.max(1000, Math.min(15000, remaining * 1000))
}
