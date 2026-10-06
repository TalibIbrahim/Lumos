import { NormalizedLightState } from '../types'

/** Short status for a light that cannot be reached, explaining why where known. */
export function offlineLabel(issue: NormalizedLightState['connectionIssue']): string {
  if (issue === 'searching') return 'Searching'
  if (issue === 'busy') return 'In use elsewhere'
  return 'No response'
}
