import { TinyTuyaDevice } from './types'

export const DEMO_DEVICES: TinyTuyaDevice[] = [
  {
    id: 'demo-light-1',
    name: 'Desk Lamp',
    key: '0123456789abcdef',
    ip: '192.0.2.11',
    mac: '00:11:22:33:44:01',
    version: '3.3',
    category: 'dj',
    product_name: 'Smart RGB+CCT Light',
    sub: false,
    mapping: {
      '20': { code: 'switch_led', type: 'Boolean' },
      '21': { code: 'work_mode', type: 'Enum', values: { range: ['white', 'colour', 'scene'] } },
      '22': { code: 'bright_value_v2', type: 'Integer', values: { min: 10, max: 1000 } },
      '23': { code: 'temp_value_v2', type: 'Integer', values: { min: 0, max: 1000 } },
      '24': { code: 'colour_data_v2', type: 'String' },
      '25': { code: 'scene_data_v2', type: 'String' },
      '26': { code: 'countdown_1', type: 'Integer', values: { min: 0, max: 86400 } }
    }
  },
  {
    id: 'demo-light-2',
    name: 'Living Room Pendant',
    key: '0123456789abcdef',
    ip: '192.0.2.12',
    mac: '00:11:22:33:44:02',
    version: '3.3',
    category: 'dj',
    product_name: 'Smart CCT Ceiling Light',
    sub: false,
    mapping: {
      '20': { code: 'switch_led', type: 'Boolean' },
      '21': { code: 'work_mode', type: 'Enum', values: { range: ['white', 'scene'] } },
      '22': { code: 'bright_value_v2', type: 'Integer', values: { min: 10, max: 1000 } },
      '23': { code: 'temp_value_v2', type: 'Integer', values: { min: 0, max: 1000 } },
      '25': { code: 'scene_data_v2', type: 'String' },
      '26': { code: 'countdown_1', type: 'Integer', values: { min: 0, max: 86400 } }
    }
  },
  {
    id: 'demo-light-3',
    name: 'Reading Spot',
    key: '0123456789abcdef',
    ip: '192.0.2.13',
    mac: '00:11:22:33:44:03',
    version: '3.3',
    category: 'tgq',
    product_name: 'Smart Dimmable Warm Spot',
    sub: false,
    mapping: {
      '20': { code: 'switch_led', type: 'Boolean' },
      '21': { code: 'work_mode', type: 'Enum', values: { range: ['white'] } },
      '22': { code: 'bright_value_v2', type: 'Integer', values: { min: 10, max: 1000 } },
      '23': { code: 'temp_value_v2', type: 'Integer', values: { min: 0, max: 1000 } }
    }
  },
  {
    id: 'demo-light-4',
    name: 'Studio Halo',
    key: '0123456789abcdef',
    ip: '192.0.2.14',
    mac: '00:11:22:33:44:04',
    version: '3.5',
    category: 'dj',
    product_name: 'Smart RGB Strip',
    sub: false,
    mapping: {
      '20': { code: 'switch_led', type: 'Boolean' },
      '21': { code: 'work_mode', type: 'Enum', values: { range: ['white', 'colour', 'scene'] } },
      '22': { code: 'bright_value_v2', type: 'Integer', values: { min: 10, max: 1000 } },
      '23': { code: 'temp_value_v2', type: 'Integer', values: { min: 0, max: 1000 } },
      '24': { code: 'colour_data_v2', type: 'String' },
      '25': { code: 'scene_data_v2', type: 'String' }
    }
  },
  {
    id: 'demo-light-5',
    name: 'Hallway Sconce',
    key: '0123456789abcdef',
    ip: '192.0.2.15',
    mac: '00:11:22:33:44:05',
    version: '3.3',
    category: 'dj',
    product_name: 'Smart CCT Wall Sconce',
    sub: false,
    mapping: {
      '20': { code: 'switch_led', type: 'Boolean' },
      '21': { code: 'work_mode', type: 'Enum', values: { range: ['white'] } },
      '22': { code: 'bright_value_v2', type: 'Integer', values: { min: 10, max: 1000 } },
      '23': { code: 'temp_value_v2', type: 'Integer', values: { min: 0, max: 1000 } }
    }
  }
]
