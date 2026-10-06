import { NormalizedLightState } from '../types'

/** Short status for a light that cannot be reached, explaining why where known. */
/** Longer explanation for the light's detail view, where there is room. */
export function offlineHelp(issue: NormalizedLightState['connectionIssue']): string | null {
  if (issue === 'key-mismatch') {
    return 'This light is on your network but no longer accepts the key Lumos has. That happens when a light is removed and added again in the Tuya app. Run the TinyTuya wizard again and import the new devices.json in Settings > Device Configuration.'
  }
  if (issue === 'busy') {
    return 'Another app or computer is connected to this light, and lights accept only one connection. Quit Lumos on other computers, or connect them through this one in Settings > Other computers.'
  }
  if (issue === 'searching') return 'Lumos is looking for this light on your network.'
  return null
}

export function offlineLabel(issue: NormalizedLightState['connectionIssue']): string {
  if (issue === 'searching') return 'Searching'
  if (issue === 'busy') return 'In use elsewhere'
  if (issue === 'key-mismatch') return 'Key changed'
  return 'No response'
}
