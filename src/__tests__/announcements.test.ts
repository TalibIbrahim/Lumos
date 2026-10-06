import { describe, it, expect } from 'vitest'
import { MessageParser, CommandType } from 'tuyapi/lib/message-parser'
import { UDP_KEY } from 'tuyapi/lib/config'
import { decodeAnnouncement, AnnouncementListener } from '../main/devices/discovery'

/** Builds an announcement packet the way a light does, with tuyapi's own encoder. */
function announcement(version: '3.5' | '3.3', payload: Record<string, unknown>): Buffer {
  const parser = new MessageParser({ key: UDP_KEY, version })
  return parser.encode({ data: payload, commandByte: CommandType.UDP_NEW, sequenceN: 1 })
}

describe('Light announcements', () => {
  const payload = { ip: '192.168.137.45', gwId: 'bf12345678abcdef4wyp', active: 2, ablilty: 0, encrypt: true, productKey: 'abc', version: '3.5' }

  it('decodes a protocol 3.5 announcement', () => {
    const a = decodeAnnouncement(announcement('3.5', payload), 1000)
    expect(a).toEqual({ id: 'bf12345678abcdef4wyp', ip: '192.168.137.45', version: '3.5', at: 1000 })
  })

  it('decodes a protocol 3.3 announcement', () => {
    const a = decodeAnnouncement(announcement('3.3', { ...payload, version: '3.3' }), 1000)
    expect(a).toEqual({ id: 'bf12345678abcdef4wyp', ip: '192.168.137.45', version: '3.3', at: 1000 })
  })

  it('rejects junk and announcements with bad fields', () => {
    expect(decodeAnnouncement(Buffer.alloc(10))).toBeNull()
    expect(decodeAnnouncement(Buffer.from('not a tuya packet at all, just text'))).toBeNull()
    expect(decodeAnnouncement(Buffer.alloc(4096))).toBeNull()
    expect(decodeAnnouncement(announcement('3.5', { ...payload, ip: 'not-an-ip' }))).toBeNull()
    expect(decodeAnnouncement(announcement('3.5', { ...payload, gwId: '../../etc' }))).toBeNull()
  })

  it('remembers the latest announcement per light for a while', () => {
    const l = new AnnouncementListener()
    l.record({ id: 'abcdefgh12', ip: '10.0.0.5', version: '3.5', at: 1000 })
    expect(l.get('abcdefgh12', 30000, 2000)?.ip).toBe('10.0.0.5')
    expect(l.get('abcdefgh12', 30000, 40000)).toBeNull()
    expect(l.get('unknown', 30000, 2000)).toBeNull()
  })
})
