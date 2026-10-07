/**
 * App actions that a computer in remote mode sends to the hub instead of
 * handling itself. Everything that touches the lights, their rooms, scenes,
 * automations, effects, and energy lives on the hub. Window, startup, update,
 * HomeKit, webhook, and setup actions stay on each computer.
 */
export const FORWARDED_CHANNELS = new Set<string>([
  // Lights
  'get-status',
  'toggle-light',
  'set-power',
  'set-brightness',
  'stream-brightness',
  'set-color-temp',
  'stream-color-temp',
  'reconnect-lights',
  'get-latency-stats',
  'set-color',
  'set-work-mode',
  'set-scene',
  'set-countdown',
  'set-all',
  'set-group-power',
  'set-group-brightness',
  'set-group-color-temp',
  'trigger-flash',
  // Rooms, scenes, automations
  'get-store',
  'set-device-meta',
  'save-room',
  'delete-room',
  'save-preset',
  'delete-preset',
  'apply-preset',
  'save-schedule',
  'delete-schedule',
  'start-sleep-timer',
  'cancel-sleep-timer',
  'save-sunrise-alarm',
  // Effects
  'effects-get',
  'effects-set-enabled',
  'effects-update-settings',
  'effects-update-global',
  'effects-resume-lights',
  'effects-action',
  // Energy (export fetches the CSV from the hub and saves it on this computer)
  'energy-report',
  'energy-set-watts',
  'energy-set-enabled',
  'energy-set-price',
  'energy-reset',
  'energy-csv',
  // Setup state, so a remote computer does not show the first-run screen
  'has-devices-config',
  'get-is-demo-mode'
])

/** Live updates the hub pushes to connected computers. */
export const FORWARDED_EVENTS = new Set<string>([
  'light-update',
  'store-update',
  'effects-update',
  'effect-paused',
  'effects-live'
])
