import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  RlMatchTracker,
  normalizeName,
  applyStatsApiSettings,
  parseRlMessage,
  readStatsApiSettings,
  RL_STATS_SECTION
} from '../main/effects/games/rocketLeague'
import { parseCs2Payload, buildGsiConfig } from '../main/effects/games/cs2'
import { parseActivePlayer } from '../main/effects/games/league'
import { parseLibraryFolders } from '../main/effects/games/installs'
import { HealthPulseLayer, pulsePeriodMs, PULSE_FAST_MS, PULSE_SLOW_MS, DEATH_HOLD_MS } from '../main/effects/games/healthPulse'
import { decideAway, nextIdleCheckMs, AwayRules } from '../main/effects/away/awayLogic'
import { accumulate, brightnessLevel, dayKey, estimateWatts, lastDays, prune, DailyTotals } from '../main/energy/model'
import {
  paletteColor,
  partyBrightness,
  partyColor,
  partyEnvelope,
  pulseBrightness,
  pulseEnvelope,
  PALETTES
} from '../main/effects/music/mapping'
import { parseHelperLine } from '../main/system/systemMonitor'
import { sanitizeFeatures } from '../main/effects/music/features'
import { LightOutput } from '../main/effects/output'
import { ComposeContext } from '../main/effects/compositor'

const fixture = (name: string): string => readFileSync(join(__dirname, 'fixtures', 'games', name), 'utf8')
const TOKEN = '0123456789abcdef0123'

describe('Rocket League: payload parsing', () => {
  it('parses UpdateState players and team colours', () => {
    const e = parseRlMessage(fixture('rl-update-state.json'))
    expect(e?.type).toBe('state')
    if (e?.type !== 'state') return
    expect(e.players).toEqual([
      { name: 'Driver One', teamNum: 0, detailed: true },
      { name: 'Driver Two', teamNum: 1, detailed: false }
    ])
    expect(e.target).toEqual({ name: 'Driver One', teamNum: 0 })
    expect(e.teams.map((t) => t.colorPrimary)).toEqual(['1873FF', 'FF8A15'])
    expect(e.replay).toBe(false)
  })

  it('parses GoalScored with and without an assister', () => {
    const blue = parseRlMessage(fixture('rl-goal-blue.json'))
    expect(blue).toEqual({ type: 'goal', scorer: { name: 'Driver One', teamNum: 0 } })
    const orange = parseRlMessage(fixture('rl-goal-orange.json'))
    expect(orange).toEqual({ type: 'goal', scorer: { name: 'Driver Two', teamNum: 1 } })
  })

  it('parses MatchEnded winner', () => {
    expect(parseRlMessage(fixture('rl-match-ended.json'))).toEqual({ type: 'matchEnded', winnerTeamNum: 0 })
  })

  it('accepts Data encoded as a JSON string', () => {
    const msg = JSON.stringify({ Event: 'MatchEnded', Data: JSON.stringify({ WinnerTeamNum: 1 }) })
    expect(parseRlMessage(msg)).toEqual({ type: 'matchEnded', winnerTeamNum: 1 })
  })

  it('rejects malformed and unexpected payloads safely', () => {
    expect(parseRlMessage('')).toBeNull()
    expect(parseRlMessage('not json')).toBeNull()
    expect(parseRlMessage('[]')).toBeNull()
    expect(parseRlMessage('{"Data":{}}')).toBeNull()
    expect(parseRlMessage('{"Event":42}')).toBeNull()
    expect(parseRlMessage('{"Event":"GoalScored","Data":"{bad"}')).toBeNull()
    expect(parseRlMessage('{"Event":"GoalScored","Data":{"Scorer":{"Name":"x"}}}')).toEqual({ type: 'goal', scorer: null })
    expect(parseRlMessage('{"Event":"UpdateState","Data":{"Players":"oops","Game":5}}')).toEqual({
      type: 'state',
      players: [],
      teams: [],
      replay: false,
      target: null
    })
    expect(parseRlMessage(JSON.stringify({ Event: 'BallHit', Data: {} }))).toEqual({ type: 'other', name: 'BallHit' })
    expect(parseRlMessage('x'.repeat(2 * 1024 * 1024))).toBeNull()
  })
})

describe('Rocket League: deciding whose goal it was', () => {
  const state = parseRlMessage(fixture('rl-update-state.json'))!

  it('matches the in-game name case-insensitively and finds the team', () => {
    const t = new RlMatchTracker('  driver one ')
    t.update(state)
    expect(t.getMyTeam()).toBe(0)
    expect(t.goalOutcome({ name: 'Driver One', teamNum: 0 })).toBe('ours')
    expect(t.goalOutcome({ name: 'Driver Two', teamNum: 1 })).toBe('theirs')
    expect(t.teamColor(0)).toBe('1873FF')
    expect(t.matchOutcome(0)).toBe('win')
    expect(t.matchOutcome(1)).toBe('loss')
  })

  const stateWith = (players: Array<{ name: string; teamNum: number; detailed: boolean }>, target: { name: string; teamNum: number } | null, replay = false) => ({
    type: 'state' as const,
    players,
    teams: [],
    replay,
    target
  })

  it('works out your team without a name, from the car details the API sends only for your team', () => {
    const t = new RlMatchTracker('')
    t.update(state) // fixture: only Driver One (team 0) has live car details
    expect(t.getMyTeam()).toBe(0)
    expect(t.getSource()).toBe('team-data')
    expect(t.goalOutcome({ name: 'Anyone', teamNum: 0 })).toBe('ours')
    expect(t.goalOutcome({ name: 'Anyone', teamNum: 1 })).toBe('theirs')
  })

  it('falls back to the player the camera follows, but not during replays', () => {
    const t = new RlMatchTracker('')
    const plain = [
      { name: 'A', teamNum: 0, detailed: false },
      { name: 'B', teamNum: 1, detailed: false }
    ]
    t.update(stateWith(plain, { name: 'B', teamNum: 1 }, true))
    expect(t.getMyTeam()).toBeNull()
    t.update(stateWith(plain, { name: 'B', teamNum: 1 }))
    expect(t.getMyTeam()).toBe(1)
    expect(t.getSource()).toBe('camera')
  })

  it('does not guess while spectating, when every player has car details and no one is followed', () => {
    const t = new RlMatchTracker('')
    t.update(
      stateWith(
        [
          { name: 'A', teamNum: 0, detailed: true },
          { name: 'B', teamNum: 1, detailed: true }
        ],
        null
      )
    )
    expect(t.getMyTeam()).toBeNull()
  })

  it('matches the name regardless of clan tags, capitals, and spacing, and prefers it', () => {
    for (const shown of ['[TAG] Driver One', 'TAG Driver One', 'driver one', 'Driver_One', '(TAG)DriverOne']) {
      const t = new RlMatchTracker('Driver One')
      t.update(stateWith([{ name: shown, teamNum: 1, detailed: false }, { name: 'X', teamNum: 0, detailed: true }], null))
      expect(t.getMyTeam()).toBe(1)
      expect(t.getSource()).toBe('name')
    }
    expect(normalizeName('[ABC] Some Body')).toBe('somebody')
  })

  it('forgets the team when the match is left', () => {
    const t = new RlMatchTracker('Driver One')
    t.update(state)
    t.update({ type: 'matchDestroyed' })
    expect(t.getMyTeam()).toBeNull()
  })
})

describe('Rocket League: DefaultStatsAPI.ini editing', () => {
  it('edits existing keys in place and keeps everything else', () => {
    const original = '[SomeSection]\r\nOther=1\r\n\r\n[TAGame.SomeExporter_TA]\r\nPacketSendRate=0\r\nPort=49123\r\n'
    const next = applyStatsApiSettings(original, { packetSendRate: 10, port: 49123 })
    expect(next).toBe('[SomeSection]\r\nOther=1\r\n\r\n[TAGame.SomeExporter_TA]\r\nPacketSendRate=10\r\nPort=49123\r\n')
    expect(readStatsApiSettings(next)).toEqual({ packetSendRate: 10, port: 49123 })
  })

  it('adds a missing key next to the existing one', () => {
    const next = applyStatsApiSettings('[X]\nPort=50000\n', { packetSendRate: 10, port: 50000 })
    expect(next).toBe('[X]\nPacketSendRate=10\nPort=50000\n')
  })

  it('creates the section in an empty or unrelated file', () => {
    expect(applyStatsApiSettings('', { packetSendRate: 10, port: 49123 })).toBe(
      `[${RL_STATS_SECTION}]\nPacketSendRate=10\nPort=49123\n`
    )
    expect(applyStatsApiSettings('[A]\nB=1', { packetSendRate: 5, port: 49123 })).toContain(`[A]\nB=1\n\n[${RL_STATS_SECTION}]`)
  })

  it('reads a disabled config', () => {
    expect(readStatsApiSettings('PacketSendRate=0\nPort=49123').packetSendRate).toBe(0)
    expect(readStatsApiSettings('').packetSendRate).toBeNull()
  })

  it('updates WebPort when present and prefers it over Port', () => {
    const original = '[TAGame.MatchStatsExporter_TA]\r\nPort=49123\r\nWebPort=49124\r\nPacketSendRate=0\r\n'
    const next = applyStatsApiSettings(original, { packetSendRate: 10, port: 49124 })
    expect(next).toBe('[TAGame.MatchStatsExporter_TA]\r\nPort=49123\r\nWebPort=49124\r\nPacketSendRate=10\r\n')
    expect(readStatsApiSettings(next)).toEqual({ packetSendRate: 10, port: 49124 })
  })
})

describe('CS2: Game State Integration payloads', () => {
  it('reads health for the local player during a live round', () => {
    expect(parseCs2Payload(fixture('cs2-live.json'), TOKEN)).toEqual({
      inMatch: true,
      isLocalPlayer: true,
      alive: true,
      health: 0.24
    })
  })

  it('reports death', () => {
    const s = parseCs2Payload(fixture('cs2-dead.json'), TOKEN)!
    expect(s.inMatch).toBe(true)
    expect(s.alive).toBe(false)
  })

  it('does not treat a spectated player as the user', () => {
    expect(parseCs2Payload(fixture('cs2-spectating.json'), TOKEN)!.isLocalPlayer).toBe(false)
  })

  it('is not in a match while in the menu', () => {
    expect(parseCs2Payload(fixture('cs2-menu.json'), TOKEN)!.inMatch).toBe(false)
  })

  it('rejects a wrong token and malformed bodies', () => {
    expect(parseCs2Payload(fixture('cs2-live.json'), 'wrong-token')).toBeNull()
    expect(parseCs2Payload('{', TOKEN)).toBeNull()
    expect(parseCs2Payload('[]', TOKEN)).toBeNull()
    expect(parseCs2Payload('', TOKEN)).toBeNull()
    expect(parseCs2Payload(JSON.stringify({ auth: { token: TOKEN }, player: { state: { health: 'lots' } } }), TOKEN)!.inMatch).toBe(false)
  })

  it('writes a config pointing at loopback with the token', () => {
    const cfg = buildGsiConfig(3123, TOKEN)
    expect(cfg).toContain('"uri" "http://127.0.0.1:3123/"')
    expect(cfg).toContain(`"token" "${TOKEN}"`)
    expect(cfg).toContain('"player_state" "1"')
  })

  it('parses Steam library folders', () => {
    const vdf = '"libraryfolders"\n{\n "0"\n {\n  "path"\t\t"C:\\\\Program Files (x86)\\\\Steam"\n }\n "1"\n {\n  "path"\t\t"E:\\\\Games\\\\Steam"\n }\n}'
    expect(parseLibraryFolders(vdf)).toEqual(['C:\\Program Files (x86)\\Steam', 'E:\\Games\\Steam'])
  })
})

describe('League: Live Client Data payloads', () => {
  it('reads current and max health', () => {
    const s = parseActivePlayer(fixture('league-activeplayer.json'))!
    expect(s.inMatch).toBe(true)
    expect(s.alive).toBe(true)
    expect(s.health).toBeCloseTo(182 / 640, 5)
  })

  it('reports death at zero health', () => {
    const body = JSON.stringify({ championStats: { currentHealth: 0, maxHealth: 600 } })
    expect(parseActivePlayer(body)).toEqual({ inMatch: true, alive: false, health: 0 })
  })

  it('rejects unusable payloads', () => {
    expect(parseActivePlayer('')).toBeNull()
    expect(parseActivePlayer('{"errorCode":"RESOURCE_NOT_FOUND"}')).toBeNull()
    expect(parseActivePlayer('{"championStats":{"currentHealth":10,"maxHealth":0}}')).toBeNull()
    expect(parseActivePlayer('nope')).toBeNull()
  })
})

describe('Low-health pulse', () => {
  it('speeds up from about 2.5 s at the threshold to about 0.7 s near zero', () => {
    expect(pulsePeriodMs(30, 30)).toBeCloseTo(PULSE_SLOW_MS, 5)
    expect(pulsePeriodMs(0, 30)).toBeCloseTo(PULSE_FAST_MS, 5)
    expect(pulsePeriodMs(15, 30)).toBeCloseTo((PULSE_SLOW_MS + PULSE_FAST_MS) / 2, 5)
  })

  it('never runs faster than the flash-rate cap', () => {
    expect(pulsePeriodMs(0, 30, 1)).toBeGreaterThanOrEqual(1000)
  })

  const ctx = (now: number): ComposeContext => ({
    now,
    lightId: 'a',
    capabilities: { hasPower: true, hasBrightness: true, hasColorTemp: true, hasColor: true, hasScenes: false, hasCountdown: false },
    base: below,
    index: 0,
    count: 1,
    reduceIntensity: false
  })
  const below: LightOutput = { power: true, mode: 'white', brightness: 70, colorTemp: 40, h: 0, s: 0 }

  function layer() {
    const released: number[] = []
    const l = new HealthPulseLayer(
      () => true,
      () => ({ threshold: 30, color: { h: 0, s: 100 }, maxFlashesPerSecond: 3 }),
      (ms) => released.push(ms),
      () => {}
    )
    return { l, released }
  }

  it('pulses red only below the threshold while alive in a match', () => {
    const { l } = layer()
    l.update({ inMatch: true, alive: true, health: 0.8 }, 0)
    expect(l.appliesTo('a')).toBe(false)
    l.update({ inMatch: true, alive: true, health: 0.2 }, 0)
    expect(l.appliesTo('a')).toBe(true)
    const out = l.compose(below, ctx(2000))!
    expect(out.mode).toBe('colour')
    expect(out.h).toBe(0)
  })

  it('is a smooth wave, never jumping between extremes in one frame', () => {
    const { l } = layer()
    l.update({ inMatch: true, alive: true, health: 0.05 }, 0)
    let prev = l.compose(below, ctx(1000))!.brightness
    for (let t = 1033; t < 6000; t += 33) {
      const b = l.compose(below, ctx(t))!.brightness
      expect(Math.abs(b - prev)).toBeLessThan(20)
      prev = b
    }
  })

  it('shows a brief dim red on death, then releases with a fade', () => {
    const { l, released } = layer()
    l.update({ inMatch: true, alive: true, health: 0.2 }, 0)
    l.update({ inMatch: true, alive: false, health: 0 }, 100)
    const out = l.compose(below, ctx(500))!
    expect(out.brightness).toBe(15)
    expect(l.isAnimating(100 + DEATH_HOLD_MS + 1)).toBe(false)
    expect(l.appliesTo('a')).toBe(false)
    expect(released.length).toBe(1)
  })

  it('eases back when healed or when the game ends', () => {
    const { l, released } = layer()
    l.update({ inMatch: true, alive: true, health: 0.2 }, 0)
    l.update({ inMatch: true, alive: true, health: 0.9 }, 100)
    expect(l.appliesTo('a')).toBe(false)
    expect(released[0]).toBeGreaterThan(0)
    l.update({ inMatch: true, alive: true, health: 0.1 }, 200)
    l.update({ inMatch: false, alive: true, health: 1 }, 300)
    expect(l.appliesTo('a')).toBe(false)
  })
})

describe('Away dimming: idle and lock state machine', () => {
  const rules: AwayRules = { idleMinutes: 5, idleAction: 'dim', lockAction: 'off', stayOnDuringMedia: true }
  const base = { idleSeconds: 0, locked: false, suspended: false, mediaActive: false }

  it('stays present while active', () => {
    expect(decideAway(base, rules)).toEqual({ away: false, heldByMedia: false })
  })

  it('dims after the idle threshold', () => {
    expect(decideAway({ ...base, idleSeconds: 300 }, rules)).toEqual({ away: true, reason: 'idle', action: 'dim' })
    expect(decideAway({ ...base, idleSeconds: 299 }, rules).away).toBe(false)
  })

  it('does not dim for inactivity while media plays, if enabled', () => {
    expect(decideAway({ ...base, idleSeconds: 900, mediaActive: true }, rules)).toEqual({ away: false, heldByMedia: true })
    expect(decideAway({ ...base, idleSeconds: 900, mediaActive: true }, { ...rules, stayOnDuringMedia: false }).away).toBe(true)
  })

  it('applies the lock action on lock, even while media plays', () => {
    expect(decideAway({ ...base, locked: true, mediaActive: true }, rules)).toEqual({ away: true, reason: 'lock', action: 'off' })
  })

  it('ignores lock when the lock action is none, but still dims on idle', () => {
    const r = { ...rules, lockAction: 'none' as const }
    expect(decideAway({ ...base, locked: true }, r).away).toBe(false)
    expect(decideAway({ ...base, locked: true, idleSeconds: 400 }, r)).toEqual({ away: true, reason: 'idle', action: 'dim' })
  })

  it('treats suspend like lock', () => {
    expect(decideAway({ ...base, suspended: true }, rules)).toEqual({ away: true, reason: 'suspend', action: 'off' })
  })

  it('polls rarely while present and often while away', () => {
    expect(nextIdleCheckMs(0, 5, false)).toBe(15000)
    expect(nextIdleCheckMs(295, 5, false)).toBe(5000)
    expect(nextIdleCheckMs(400, 5, true)).toBe(1000)
  })
})

describe('Energy: model and daily bucketing', () => {
  const on = { online: true, power: true, mode: 'white', brightness: 100 }

  it('scales rated watts by brightness and mode, and is zero when off or offline', () => {
    expect(estimateWatts(on, 10)).toBeCloseTo(10, 5)
    expect(estimateWatts({ ...on, brightness: 0 }, 10)).toBeCloseTo(0.8, 5)
    expect(estimateWatts({ ...on, mode: 'colour' }, 10)).toBeCloseTo(5.5, 5)
    expect(estimateWatts({ ...on, power: false }, 10)).toBe(0)
    expect(estimateWatts({ ...on, online: false }, 10)).toBe(0)
    expect(brightnessLevel(50)).toBeGreaterThan(0.3)
    expect(brightnessLevel(50)).toBeLessThan(0.5)
  })

  it('accumulates watt hours and on time', () => {
    const days: DailyTotals = {}
    const start = new Date(2026, 0, 10, 12, 0, 0).getTime()
    accumulate(days, 'a', start, start + 2 * 3600 * 1000, 9)
    expect(days['2026-01-10'].a[0]).toBeCloseTo(18, 5)
    expect(days['2026-01-10'].a[1]).toBeCloseTo(7200, 5)
  })

  it('splits usage across midnight', () => {
    const days: DailyTotals = {}
    const start = new Date(2026, 0, 10, 23, 0, 0).getTime()
    accumulate(days, 'a', start, start + 2 * 3600 * 1000, 10)
    expect(days['2026-01-10'].a[0]).toBeCloseTo(10, 5)
    expect(days['2026-01-11'].a[0]).toBeCloseTo(10, 5)
  })

  it('counts no on time while off', () => {
    const days: DailyTotals = {}
    const start = new Date(2026, 0, 10, 8).getTime()
    accumulate(days, 'a', start, start + 3600000, 0)
    expect(days['2026-01-10'].a).toEqual([0, 0])
  })

  it('prunes old days and lists recent ones', () => {
    const now = new Date(2026, 5, 15, 12).getTime()
    const days: DailyTotals = { '2024-01-01': { a: [1, 1] }, [dayKey(now)]: { a: [1, 1] } }
    prune(days, 400, now)
    expect(Object.keys(days)).toEqual([dayKey(now)])
    const keys = lastDays(7, now)
    expect(keys).toHaveLength(7)
    expect(keys[6]).toBe('2026-06-15')
    expect(keys[0]).toBe('2026-06-09')
  })
})

describe('Music mapping', () => {
  it('loops through a palette', () => {
    const p = PALETTES.aurora
    expect(paletteColor(p, 0)).toEqual(p[0])
    expect(paletteColor(p, 1)).toEqual(p[0])
    expect(paletteColor(p, 1 / 3).h).toBeCloseTo(p[1].h, 5)
  })

  it('pulse rises quickly and decays smoothly', () => {
    expect(pulseEnvelope(0, 1, 120)).toBe(0)
    expect(pulseEnvelope(60, 1, 120)).toBeCloseTo(1, 5)
    const later = pulseEnvelope(400, 1, 120)
    expect(later).toBeGreaterThan(0)
    expect(later).toBeLessThan(0.3)
  })

  it('pulse depth controls how far brightness moves', () => {
    expect(pulseBrightness(60, 0, 0, 0)).toBe(60)
    expect(pulseBrightness(60, 1, 0, 1)).toBe(100)
    expect(pulseBrightness(60, 0, 0, 1)).toBeCloseTo(18, 5)
  })

  it('party style hits full brightness at once and goes dark between beats', () => {
    expect(partyEnvelope(0, 1, 120, false)).toBe(1)
    expect(partyEnvelope(0, 0.2, 120, false)).toBeLessThan(0.75)
    // After a drop every beat is a full hit, even a soft one
    expect(partyEnvelope(0, 0.2, 120, true)).toBe(1)
    expect(partyEnvelope(400, 1, 120, false)).toBeLessThan(0.1)
    expect(partyBrightness(80, 1, 0, 0.75)).toBe(100)
    expect(partyBrightness(80, 0, 0, 0.75)).toBeLessThan(30)
  })

  it('party style steps through the palette on each beat, neighbours one colour apart', () => {
    const p = PALETTES.neon
    expect(partyColor(p, 0, 0, true)).toEqual(p[0])
    expect(partyColor(p, 1, 0, true)).toEqual(p[1])
    expect(partyColor(p, 1, 1, true)).toEqual(p[2])
    expect(partyColor(p, 1, 1, false)).toEqual(p[1])
    expect(partyColor(p, 3, 0, true)).toEqual(p[0])
  })
})

describe('Validation of untrusted local inputs', () => {
  it('parses media helper lines and rejects malformed ones', () => {
    expect(parseHelperLine('{"t":"sys","peak":0.25,"fullscreen":true,"exclusive":true}')).toEqual({
      kind: 'sys',
      sys: { peak: 0.25, fullscreen: true, exclusive: true }
    })
    const thumb = Buffer.alloc(2 * 2 * 4, 200).toString('base64')
    const media = parseHelperLine(`{"t":"media","status":"Playing","key":"abc123","thumb":"${thumb}","w":2,"h":2}`)
    expect(media?.kind).toBe('media')
    if (media?.kind === 'media') {
      expect(media.media.status).toBe('Playing')
      expect(media.media.thumbnail?.rgba.length).toBe(16)
    }
    // Thumbnail size that does not match its dimensions is dropped
    const bad = parseHelperLine(`{"t":"media","status":"Playing","key":"abc","thumb":"${thumb}","w":8,"h":8}`)
    expect(bad?.kind === 'media' && bad.media.thumbnail).toBe(null)
    expect(parseHelperLine('{"t":"media","status":"Weird","key":"NOT-HEX"}')).toEqual({
      kind: 'media',
      media: { status: 'Other', key: null, thumbnail: null }
    })
    expect(parseHelperLine('garbage')).toBeNull()
    expect(parseHelperLine('{"t":"unknown"}')).toBeNull()
  })

  it('clamps music features from the analysis page', () => {
    expect(sanitizeFeatures({ loudness: 5, low: -1, beat: 'yes', tempo: 9999 })).toEqual({
      loudness: 1,
      low: 0,
      beat: false,
      beatStrength: 0,
      tempo: 300,
      energy: 0,
      silent: true,
      drop: false
    })
    expect(sanitizeFeatures('nope')).toBeNull()
  })
})

import { blendViaDark } from '../main/effects/output'

describe('blendViaDark', () => {
  const colour = { power: true, mode: 'colour' as const, h: 30, s: 40, brightness: 40 }
  const white = { power: true, mode: 'white' as const, colorTemp: 50, brightness: 80 }

  it('dips to almost nothing before switching from colour to white', () => {
    const mid = blendViaDark(colour, white, 0.5)
    expect(mid.mode === 'colour' || mid.mode === 'white').toBe(true)
    expect((mid as { brightness: number }).brightness).toBeLessThanOrEqual(2)
  })

  it('stays in colour mode through the first half and in white mode through the second', () => {
    expect(blendViaDark(colour, white, 0.3).mode).toBe('colour')
    expect(blendViaDark(colour, white, 0.7).mode).toBe('white')
  })

  it('never shows the white mode brighter than the colour it came from before it has dimmed', () => {
    for (let t = 0.5; t < 0.53; t += 0.01) {
      const o = blendViaDark(colour, white, t) as { mode: string; brightness: number }
      if (o.mode === 'white') expect(o.brightness).toBeLessThan(10)
    }
  })

  it('comes up from off in the target mode, starting from almost nothing', () => {
    const off = { ...white, power: false }
    const early = blendViaDark(off, white, 0.1) as { mode: string; brightness: number; power: boolean }
    expect(early.power).toBe(true)
    expect(early.mode).toBe('white')
    expect(early.brightness).toBeLessThan(15)
  })

  it('ends exactly on the target and starts on the source', () => {
    expect(blendViaDark(colour, white, 1)).toEqual(white)
    expect(blendViaDark(colour, white, 0)).toEqual(colour)
  })
})
