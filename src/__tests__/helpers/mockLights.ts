import { Light } from '../../main/devices/Light'
import { TinyTuyaDevice } from '../../main/types'

export interface SentCommand {
  at: number
  lightId: string
  data: Record<string, unknown>
}

export const COLOUR_MAPPING: TinyTuyaDevice['mapping'] = {
  '20': { code: 'switch_led', type: 'Boolean' },
  '21': { code: 'work_mode', type: 'Enum', values: { range: ['white', 'colour', 'scene'] } },
  '22': { code: 'bright_value_v2', type: 'Integer', values: { min: 10, max: 1000 } },
  '23': { code: 'temp_value_v2', type: 'Integer', values: { min: 0, max: 1000 } },
  '24': { code: 'colour_data_v2', type: 'String' },
  '25': { code: 'scene_data_v2', type: 'String' }
}

export const WHITE_MAPPING: TinyTuyaDevice['mapping'] = {
  '20': { code: 'switch_led', type: 'Boolean' },
  '21': { code: 'work_mode', type: 'Enum', values: { range: ['white'] } },
  '22': { code: 'bright_value_v2', type: 'Integer', values: { min: 10, max: 1000 } },
  '23': { code: 'temp_value_v2', type: 'Integer', values: { min: 0, max: 1000 } }
}

/**
 * Creates lights whose device client records every command instead of
 * talking to the network. The lights start connected, on, white at 80 percent.
 */
export function createMockLights(
  count: number,
  options: { colour?: boolean; log?: SentCommand[] } = {}
): { lights: Light[]; log: SentCommand[] } {
  const log = options.log ?? []
  const lights: Light[] = []
  for (let i = 0; i < count; i++) {
    const light = new Light({
      id: `mock-${i + 1}`,
      name: `Mock ${i + 1}`,
      key: '0123456789abcdef',
      ip: `192.0.2.${100 + i}`,
      version: '3.3',
      mapping: options.colour === false ? WHITE_MAPPING : COLOUR_MAPPING
    })
    light.isConnected = true
    light.power = true
    light.brightness = 80
    light.colorTemp = 40
    light.mode = 'white'
    light.lastSentOutput = light.baseOutput()
    // @ts-expect-error replace the device client with a recorder
    light['tuya'] = {
      set: async (opts: { data: Record<string, unknown> }) => {
        log.push({ at: Date.now(), lightId: light.id, data: { ...opts.data } })
        return true
      },
      isConnected: () => true,
      disconnect: () => {}
    }
    lights.push(light)
  }
  return { lights, log }
}

/** Lets pending promise callbacks run under fake timers. */
export async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

export function sendsFor(log: SentCommand[], lightId: string): SentCommand[] {
  return log.filter((c) => c.lightId === lightId)
}
