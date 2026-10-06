/** electron-vite: importing a module with ?modulePath yields the path of its bundled file (used for worker threads). */
declare module '*?modulePath' {
  const path: string
  export default path
}

/** Internal tuyapi modules used to decode light announcements. */
declare module 'tuyapi/lib/message-parser' {
  export class MessageParser {
    constructor(options: { key: Buffer | string; version: string })
    parse(buffer: Buffer): Array<{ payload: unknown; commandByte: number; sequenceN: number; version: string }>
    encode(options: { data: unknown; commandByte: number; sequenceN?: number; encrypted?: boolean }): Buffer
  }
  export const CommandType: Record<string, number>
}

declare module 'tuyapi/lib/config' {
  export const UDP_KEY: Buffer
}
