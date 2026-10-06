import { LumosAPI, LumenAPI } from './index'

declare global {
  interface Window {
    lumos: LumosAPI
    lumen: LumenAPI
  }
}
