import { describe, expect, it } from 'vitest'
import { SEATS, type Seat } from '../../engine/types'
import { FakeClock } from '../clock'
import { isValidRoomCode, makeRoomCode, makeSeatToken, normalizeRoomCode } from '../codes'
import { LocalTransport } from '../LocalTransport'
import type { ClientMsg, ServerMsg } from '../protocol'
import { DEFAULT_HOUSE_RULES, sanitizeHouseRules } from '../protocol'
import { RoomHost } from '../RoomHost'

function makeHost(seed = 'room-host-test') {
  const transport = new LocalTransport()
  const clock = new FakeClock()
  const issues: string[] = []
  let dirty = 0
  const inbox: Record<Seat, ServerMsg[]> = { 0: [], 1: [], 2: [], 3: [] }
  const conns = SEATS.map((s) => transport.client(s))
  for (const s of SEATS) conns[s].onMessage((m) => inbox[s].push(m))
  const host = new RoomHost({
    code: 'ABCDEF',
    clock,
    transport,
    makeRoundSeed: () => `${seed}-${Math.random()}`,
    botSeed: `${seed}-bots`,
    logIssue: (m) => issues.push(m),
    onDirty: () => dirty++,
  })
  transport.onMessage((s, m) => host.receive(s, m))
  return {
    host,
    clock,
    transport,
    inbox,
    issues,
    send: (s: Seat, m: ClientMsg) => conns[s].send(m),
    dirtyCount: () => dirty,
  }
}

const lastRoom = (msgs: ServerMsg[]) =>
  [...msgs].reverse().find((m) => m.type === 'room') as Extract<ServerMsg, { type: 'room' }>

describe('room codes and tokens', () => {
  it('codes use the unambiguous alphabet', () => {
    for (let i = 0; i < 200; i++) {
      const code = makeRoomCode()
      expect(isValidRoomCode(code)).toBe(true)
      expect(code).not.toMatch(/[O0I1L]/)
    }
  })

  it('normalisation uppercases and strips separators', () => {
    expect(normalizeRoomCode(' ab-cd ef ')).toBe('ABCDEF')
    expect(isValidRoomCode(normalizeRoomCode('abcdef'))).toBe(true)
    expect(isValidRoomCode(normalizeRoomCode('abc0ef'))).toBe(false) // 0 not in alphabet
    expect(isValidRoomCode('SHORT')).toBe(false)
  })

  it('seat tokens are 128-bit hex and unique', () => {
    const a = makeSeatToken()
    const b = makeSeatToken()
    expect(a).toMatch(/^[0-9a-f]{32}$/)
    expect(a).not.toBe(b)
  })
})

describe('house rule sanitisation', () => {
  it('clamps untrusted input into spec ranges', () => {
    const r = sanitizeHouseRules({
      faanMinimum: 7,
      claimWindowSec: 99,
      turnTimerSec: 1,
      flowers: 'yes',
      faanCap: -5,
      coachAllowed: 0,
    })
    expect(r.faanMinimum).toBe(0) // invalid → family default
    expect(r.claimWindowSec).toBe(8)
    expect(r.turnTimerSec).toBe(10)
    expect(r.flowers).toBe(true)
    expect(r.faanCap).toBe(1)
    expect(r.coachAllowed).toBe(true)
    expect(sanitizeHouseRules(null)).toEqual(DEFAULT_HOUSE_RULES)
  })
})

describe('RoomHost lobby', () => {
  it('assigns the lowest open seat; the first human becomes host', () => {
    const h = makeHost()
    const a = h.host.joinHuman('Dylan')
    expect(a).toEqual({ ok: true, seat: 0 })
    const b = h.host.joinHuman('Mum')
    expect(b).toEqual({ ok: true, seat: 1 })
    const room = lastRoom(h.inbox[0]).room
    expect(room.hostSeat).toBe(0)
    expect(room.seats[0]).toMatchObject({ kind: 'human', name: 'Dylan', connected: true })
    expect(room.seats[1]).toMatchObject({ kind: 'human', name: 'Mum' })
    expect(room.seats[2].kind).toBe('open')
    expect(room.phase).toBe('lobby')
    // Each seat's copy is addressed to it.
    expect(lastRoom(h.inbox[1]).room.you).toBe(1)
  })

  it('rejects a fifth human and sanitises names', () => {
    const h = makeHost()
    for (let i = 0; i < 4; i++) expect(h.host.joinHuman(`P${i}`).ok).toBe(true)
    expect(h.host.joinHuman('Late')).toEqual({ ok: false, reason: 'room is full' })
    const weird = h.host.joinHuman.bind(h.host)
    void weird
    const h2 = makeHost()
    h2.host.joinHuman('  \t\n  ')
    expect(lastRoom(h2.inbox[0]).room.seats[0].name).toBe('Player')
    const h3 = makeHost()
    h3.host.joinHuman('x'.repeat(100))
    expect(lastRoom(h3.inbox[0]).room.seats[0].name!.length).toBe(24)
  })

  it('host-only ops: non-host attempts are rejected and logged', () => {
    const h = makeHost()
    h.host.joinHuman('Host')
    h.host.joinHuman('Guest')
    h.send(1, { type: 'lobby', op: 'seatKind', seat: 3, kind: 'bot' })
    expect(h.inbox[1].some((m) => m.type === 'rejected')).toBe(true)
    expect(h.issues.length).toBe(1)
    h.send(1, { type: 'start' })
    expect(h.inbox[1].filter((m) => m.type === 'rejected').length).toBe(2)
    expect(lastRoom(h.inbox[0]).room.phase).toBe('lobby')
  })

  it('host assigns bots and difficulties; cannot repurpose a human seat', () => {
    const h = makeHost()
    h.host.joinHuman('Host')
    h.host.joinHuman('Guest')
    h.send(0, { type: 'lobby', op: 'seatKind', seat: 3, kind: 'bot', difficulty: 'advanced' })
    let room = lastRoom(h.inbox[0]).room
    expect(room.seats[3]).toMatchObject({ kind: 'bot', difficulty: 'advanced' })
    h.send(0, { type: 'lobby', op: 'seatKind', seat: 3, kind: 'open' })
    room = lastRoom(h.inbox[0]).room
    expect(room.seats[3].kind).toBe('open')
    h.send(0, { type: 'lobby', op: 'seatKind', seat: 1, kind: 'bot' })
    expect(h.inbox[0].some((m) => m.type === 'rejected')).toBe(true)
    expect(lastRoom(h.inbox[0]).room.seats[1].kind).toBe('human')
  })

  it('host sets rules; they are sanitised on the way in', () => {
    const h = makeHost()
    h.host.joinHuman('Host')
    h.send(0, {
      type: 'lobby',
      op: 'rules',
      rules: { ...DEFAULT_HOUSE_RULES, claimWindowSec: 55, faanMinimum: 3 },
    })
    const room = lastRoom(h.inbox[0]).room
    expect(room.rules.claimWindowSec).toBe(8)
    expect(room.rules.faanMinimum).toBe(3)
  })

  it('intents before start are rejected', () => {
    const h = makeHost()
    h.host.joinHuman('Host')
    h.send(0, { type: 'intent', action: { type: 'draw', seat: 0 } })
    expect(h.inbox[0].some((m) => m.type === 'rejected')).toBe(true)
  })
})

describe('RoomHost start and play', () => {
  it('start fills open seats with bots and deals; late joins are refused', () => {
    const h = makeHost()
    h.host.joinHuman('Host')
    h.host.joinHuman('Guest')
    h.send(0, { type: 'start' })
    const room = lastRoom(h.inbox[0]).room
    expect(room.phase).toBe('playing')
    expect(room.seats[2].kind).toBe('bot')
    expect(room.seats[3].kind).toBe('bot')
    // Views arrive: host is the dealer with 14 tiles.
    const view = [...h.inbox[0]].reverse().find((m) => m.type === 'view')
    expect(view?.type).toBe('view')
    if (view?.type !== 'view') throw new Error('unreachable')
    expect(view.view.concealed.length).toBe(14)
    expect(view.view.seat).toBe(0)
    // Guest sees 13.
    const gview = [...h.inbox[1]].reverse().find((m) => m.type === 'view')
    if (gview?.type !== 'view') throw new Error('no guest view')
    expect(gview.view.concealed.length).toBe(13)
    expect(h.host.joinHuman('Late')).toEqual({ ok: false, reason: 'game already started' })
    h.host.stop()
  })

  it('a two-human game over the host runs bots to a finish', () => {
    const h = makeHost('finish-seed')
    h.host.joinHuman('Host')
    h.send(0, { type: 'lobby', op: 'seatKind', seat: 1, kind: 'bot' })
    h.send(0, { type: 'lobby', op: 'seatKind', seat: 2, kind: 'bot' })
    h.send(0, { type: 'lobby', op: 'seatKind', seat: 3, kind: 'bot' })
    h.send(0, { type: 'start' })
    // Host never acts; the turn timer isn't wired yet (Phase 6), so instead
    // play host turns by echoing the first legal action from each view.
    for (let guard = 0; guard < 500; guard++) {
      h.clock.runAll()
      const last = [...h.inbox[0]].reverse().find((m) => m.type === 'view')
      if (last?.type !== 'view') throw new Error('no view')
      if (last.view.phase === 'finished') break
      const legal = last.view.legal[0]
      expect(legal, 'host should always have a legal action when the room idles').toBeDefined()
      h.send(0, { type: 'intent', action: legal })
    }
    expect(h.inbox[0].some((m) => m.type === 'finished')).toBe(true)
    expect(h.issues).toEqual([])
    h.host.stop()
  })

  it('serialize/restore keeps the game going with humans marked disconnected', () => {
    const h = makeHost('restore-seed')
    h.host.joinHuman('Host')
    h.host.joinHuman('Guest')
    h.send(0, { type: 'start' })
    h.clock.advance(1000)
    const snap = h.host.serialize()
    h.host.stop()

    expect(snap.phase).toBe('playing')
    expect(snap.runner).not.toBeNull()
    expect(snap.runner!.game).not.toBeNull()

    // Fresh transport + clock: the world after an eviction.
    const transport2 = new LocalTransport()
    const clock2 = new FakeClock()
    const inbox0: ServerMsg[] = []
    transport2.client(0).onMessage((m) => inbox0.push(m))
    const restored = RoomHost.restore(snap, {
      code: 'ABCDEF',
      clock: clock2,
      transport: transport2,
      makeRoundSeed: () => `later-${Math.random()}`,
      logIssue: () => {},
    })
    transport2.onMessage((s, m) => restored.receive(s, m))
    expect(restored.allHumansDisconnected()).toBe(true)
    restored.setConnected(0, true)
    expect(restored.allHumansDisconnected()).toBe(false)
    const room = lastRoom(inbox0).room
    expect(room.phase).toBe('playing')
    expect(room.seats[1]).toMatchObject({ kind: 'human', connected: false })
    restored.resume()
    // It is the host's (human dealer's) turn — nothing self-advances, which
    // is correct. Prove the game survived by playing on from the snapshot.
    const tile = snap.runner!.game!.hands[0][0]
    restored.receive(0, { type: 'intent', action: { type: 'discard', seat: 0, tile } })
    const view = [...inbox0].reverse().find((m) => m.type === 'view')
    expect(view?.type).toBe('view')
    if (view?.type !== 'view') throw new Error('unreachable')
    expect(view.seq).toBeGreaterThan(snap.runner!.seq)
    expect(view.view.concealed.length).toBe(13)
    // …and bots respond to whatever that discard opened up.
    clock2.runAll()
    expect(restored.serialize().runner!.seq).toBeGreaterThanOrEqual(view.seq)
    restored.stop()
  })
})
