// §6 tests: turn timers, disconnect grace, bot takeover, and reconnect —
// all on a FakeClock. Reconnect is the COMMON path on a PWA (backgrounding a
// phone kills the socket), so background/foreground cycles are tested as
// first-class, not as a clean-disconnect afterthought.

import { describe, expect, it } from 'vitest'
import type { GameState } from '../../engine/game'
import { SEATS, type Seat } from '../../engine/types'
import { FakeClock } from '../clock'
import { LocalTransport } from '../LocalTransport'
import {
  DEFAULT_HOUSE_RULES,
  type ClientMsg,
  type HouseRules,
  type SeatController,
  type ServerMsg,
} from '../protocol'
import { RoomHost } from '../RoomHost'
import { RoomRunner, type RoomTiming } from '../RoomRunner'
import { craftedGame, dealerWinHand, quietHands } from './helpers'

const lastView = (inbox: ServerMsg[]) =>
  [...inbox].reverse().find((m) => m.type === 'view') as Extract<ServerMsg, { type: 'view' }>
const lastRoom = (inbox: ServerMsg[]) =>
  [...inbox].reverse().find((m) => m.type === 'room') as Extract<ServerMsg, { type: 'room' }>

// ============================ RoomRunner: turn timer =======================

const TURN_TIMING: RoomTiming = {
  drawDelayMs: 1,
  botDelayMs: 5,
  claimWindowMs: 4000,
  turnTimerMs: 30_000,
  instantAllBotClaims: true,
}

interface RunnerHarness {
  runner: RoomRunner
  clock: FakeClock
  inbox: Record<Seat, ServerMsg[]>
  timeouts: { seat: Seat; consecutive: number }[]
  send: (seat: Seat, msg: ClientMsg) => void
}

function runnerRoom(
  seats: Record<Seat, SeatController>,
  initialGame: GameState,
  onTakeover?: (seat: Seat, consecutive: number, runner: RoomRunner) => void,
): RunnerHarness {
  const transport = new LocalTransport()
  const clock = new FakeClock()
  const inbox: Record<Seat, ServerMsg[]> = { 0: [], 1: [], 2: [], 3: [] }
  const timeouts: { seat: Seat; consecutive: number }[] = []
  const conns = SEATS.map((s) => transport.client(s))
  for (const s of SEATS) conns[s].onMessage((m) => inbox[s].push(m))
  const runner = new RoomRunner({
    rules: initialGame.config,
    seats,
    timing: TURN_TIMING,
    clock,
    transport,
    makeRoundSeed: () => 'unused',
    botSeed: 'tt-bots',
    logIssue: () => {},
    initialGame,
    onTurnTimeout: (seat, consecutive) => {
      timeouts.push({ seat, consecutive })
      onTakeover?.(seat, consecutive, runner)
    },
  })
  transport.onMessage((s, m) => runner.receive(s, m))
  runner.start()
  return { runner, clock, inbox, timeouts, send: (s, m) => conns[s].send(m) }
}

const humanDealerGame = (): GameState =>
  craftedGame({ handsFromDealer: [dealerWinHand().hand13, ...quietHands()], dealerExtra: 'p9' })

const ALL_HUMAN: Record<Seat, SeatController> = {
  0: { kind: 'human' },
  1: { kind: 'human' },
  2: { kind: 'human' },
  3: { kind: 'human' },
}

describe('turn timer (§6)', () => {
  it('tsumogiri: on expiry the just-drawn tile is auto-discarded', () => {
    const g = humanDealerGame()
    const drawn = g.lastDraw!.tile // dealer's 14th, treated as the draw
    const h = runnerRoom(ALL_HUMAN, g)
    expect(lastView(h.inbox[0]).view.phase).toBe('discard')
    expect(lastView(h.inbox[0]).view.turn).toBe(0)

    h.clock.advance(29_999)
    expect(lastView(h.inbox[0]).view.discards[0]).not.toContain(drawn) // not yet
    h.clock.advance(1)

    const v = lastView(h.inbox[1])
    expect(v.view.discards[0]).toContain(drawn) // tsumogiri'd the drawn tile
    expect(h.timeouts).toEqual([{ seat: 0, consecutive: 1 }])
    h.runner.stop()
  })

  it('a voluntary discard cancels the pending turn timer', () => {
    const g = humanDealerGame()
    const h = runnerRoom(ALL_HUMAN, g)
    const tile = lastView(h.inbox[0]).view.concealed[0]
    h.clock.advance(10_000)
    h.send(0, { type: 'intent', action: { type: 'discard', seat: 0, tile } })
    // Advancing past the original deadline must NOT trigger a tsumogiri.
    h.clock.advance(30_000)
    expect(h.timeouts).toEqual([])
    h.runner.stop()
  })

  it('two consecutive timeouts flip the seat to a bot, which plays on', () => {
    // Seat 0 human + 3 bots so the turn actually cycles back. Mirror the
    // RoomHost policy: pilot at 2 consecutive timeouts.
    const g = humanDealerGame()
    let piloted = false
    const h = runnerRoom(
      { 0: { kind: 'human' }, 1: { kind: 'bot', difficulty: 'easy' }, 2: { kind: 'bot', difficulty: 'easy' }, 3: { kind: 'bot', difficulty: 'easy' } },
      g,
      (seat, consecutive, runner) => {
        if (consecutive >= 2 && seat === 0) {
          runner.setSeatController(0, { kind: 'bot', difficulty: 'intermediate' })
          piloted = true
        }
      },
    )
    // Seat 0 never acts; each of its turns times out. Between them the bots
    // play on the pace clock, so the turn cycles back to seat 0.
    for (let i = 0; i < 40 && !piloted; i++) h.clock.advance(30_000)
    expect(piloted).toBe(true)
    expect(h.timeouts.some((t) => t.seat === 0 && t.consecutive === 2)).toBe(true)
    // Once piloted, seat 0 no longer times out — the count stops at 2.
    expect(h.timeouts.filter((t) => t.seat === 0).length).toBe(2)
    h.runner.stop()
  })

  it('setSeatController hands a live seat to a bot and back', () => {
    const g = humanDealerGame()
    const h = runnerRoom(ALL_HUMAN, g)
    const before = lastView(h.inbox[0]).seq
    // Flip seat 0 (whose turn it is) to a bot: it should now act on its own.
    h.runner.setSeatController(0, { kind: 'bot', difficulty: 'easy' })
    h.clock.advance(10)
    const after = lastView(h.inbox[0])
    expect(after.seq).toBeGreaterThan(before) // the bot discarded without an intent
    h.runner.stop()
  })
})

// ======================= RoomHost: disconnect & takeover ===================

interface HostHarness {
  host: RoomHost
  clock: FakeClock
  inbox: Record<Seat, ServerMsg[]>
  send: (seat: Seat, msg: ClientMsg) => void
}

function hostRoom(opts: {
  rules?: Partial<HouseRules>
  initialGame?: GameState
  seats?: { bots?: Seat[] }
}): HostHarness {
  const transport = new LocalTransport()
  const clock = new FakeClock()
  const inbox: Record<Seat, ServerMsg[]> = { 0: [], 1: [], 2: [], 3: [] }
  const conns = SEATS.map((s) => transport.client(s))
  for (const s of SEATS) conns[s].onMessage((m) => inbox[s].push(m))
  const host = new RoomHost({
    code: 'ABCDEF',
    clock,
    transport,
    makeRoundSeed: () => 'seed',
    botSeed: 'host-bots',
    rules: { ...DEFAULT_HOUSE_RULES, ...opts.rules },
    ...(opts.initialGame ? { initialGame: opts.initialGame } : {}),
  })
  transport.onMessage((s, m) => host.receive(s, m))
  return { host, clock, inbox, send: (s, m) => conns[s].send(m) }
}

/** Two humans (seats 0,1) + two bots (2,3), started. Turn timer long so the
 * disconnect grace (60s) is what fires in these tests, not the turn timer. */
function twoHumansStarted(initialGame?: GameState): HostHarness {
  const h = hostRoom({ rules: { turnTimerSec: 120 }, initialGame })
  h.host.joinHuman('Dylan')
  h.host.joinHuman('Mum')
  h.send(0, { type: 'lobby', op: 'seatKind', seat: 2, kind: 'bot' })
  h.send(0, { type: 'lobby', op: 'seatKind', seat: 3, kind: 'bot' })
  h.send(0, { type: 'start' })
  return h
}

describe('disconnect grace & bot takeover (§6)', () => {
  it('a drop marks the seat reconnecting, then flips it to a bot after 60s', () => {
    const h = twoHumansStarted()
    h.host.setConnected(1, false)
    expect(lastRoom(h.inbox[0]).room.seats[1].status).toBe('reconnecting')

    h.clock.advance(59_999)
    expect(lastRoom(h.inbox[0]).room.seats[1].status).toBe('reconnecting')
    h.clock.advance(1)
    // Grace lapsed: seat 1 is now bot-controlled but still a human's seat.
    const room = lastRoom(h.inbox[0]).room
    expect(room.seats[1].status).toBe('bot')
    expect(room.seats[1].kind).toBe('human') // identity preserved for reclaim
    h.host.stop()
  })

  it('reconnect within grace cancels the takeover and replays state', () => {
    const h = twoHumansStarted()
    const before = h.inbox[1].length
    h.host.setConnected(1, false)
    h.clock.advance(30_000)
    h.host.onReconnect(1) // token reclaim, mid-grace
    h.clock.advance(60_000) // the original grace deadline passes — no effect
    const room = lastRoom(h.inbox[0]).room
    expect(room.seats[1].status).toBe('connected')
    // onReconnect replays the current view to the returning seat.
    expect(h.inbox[1].length).toBeGreaterThan(before)
    expect(lastView(h.inbox[1]).view.seat).toBe(1)
    h.host.stop()
  })

  it('background/foreground cycles never take over or corrupt state', () => {
    const h = twoHumansStarted()
    const seqStart = lastView(h.inbox[1]).seq
    // Five rapid background→foreground cycles, each well within grace.
    for (let i = 0; i < 5; i++) {
      h.host.setConnected(1, false)
      expect(lastRoom(h.inbox[1]).room.seats[1].status).toBe('reconnecting')
      h.clock.advance(5_000)
      h.host.onReconnect(1)
      expect(lastRoom(h.inbox[1]).room.seats[1].status).toBe('connected')
    }
    // Seat 1 never got piloted, and its view is coherent (same round).
    expect(lastRoom(h.inbox[1]).room.seats[1].kind).toBe('human')
    expect(lastView(h.inbox[1]).seq).toBeGreaterThanOrEqual(seqStart)
    expect(lastView(h.inbox[1]).view.concealed.length).toBeGreaterThan(0)
    h.host.stop()
  })

  it('reconnect AFTER takeover hands the seat back; bot decisions stand', () => {
    const h = twoHumansStarted()
    h.host.setConnected(1, false)
    h.clock.advance(60_000) // grace lapses → seat 1 piloted
    expect(lastRoom(h.inbox[1]).room.seats[1].status).toBe('bot')
    const seqWhilePiloted = lastView(h.inbox[1]).seq

    h.host.onReconnect(1)
    const room = lastRoom(h.inbox[1]).room
    expect(room.seats[1].status).toBe('connected') // back under human control
    expect(room.seats[1].kind).toBe('human')
    // No rewind: the seq only moves forward across the takeover→handback.
    expect(lastView(h.inbox[1]).seq).toBeGreaterThanOrEqual(seqWhilePiloted)
    h.host.stop()
  })

  it('two consecutive turn timeouts flip the ACTIVE human seat to a bot', () => {
    // Host (seat 0, dealer) is human and it is its turn; it never acts. The
    // 30s turn timer fires, the round cycles through the bots, and when it is
    // seat 0's turn again it times out a 2nd time → takeover.
    const g = craftedGame({
      handsFromDealer: [dealerWinHand().hand13, ...quietHands()],
      dealerExtra: 'p9',
    })
    const h = hostRoom({ rules: { turnTimerSec: 30, claimWindowSec: 3 }, initialGame: g })
    h.host.joinHuman('Dylan') // seat 0, host + dealer
    h.send(0, { type: 'lobby', op: 'seatKind', seat: 1, kind: 'bot' })
    h.send(0, { type: 'lobby', op: 'seatKind', seat: 2, kind: 'bot' })
    h.send(0, { type: 'lobby', op: 'seatKind', seat: 3, kind: 'bot' })
    h.send(0, { type: 'start' })
    expect(lastRoom(h.inbox[0]).room.seats[0].status).toBe('connected')

    // Let the game run for a while; seat 0 never sends an intent.
    for (let i = 0; i < 40 && lastRoom(h.inbox[0]).room.seats[0].status !== 'bot'; i++) {
      h.clock.advance(30_000)
    }
    expect(lastRoom(h.inbox[0]).room.seats[0].status).toBe('bot')
    expect(lastRoom(h.inbox[0]).room.seats[0].kind).toBe('human')
    h.host.stop()
  })
})

describe('reconnect state replay across a restore (§6)', () => {
  it('a piloted seat survives serialize/restore and can still be handed back', () => {
    const h = twoHumansStarted()
    h.host.setConnected(1, false)
    h.clock.advance(60_000) // seat 1 piloted
    const snap = h.host.serialize()
    expect(snap.seats[1]).toMatchObject({ kind: 'human', piloted: true })
    h.host.stop()

    // Rehydrate in a fresh world (post-eviction).
    const transport2 = new LocalTransport()
    const clock2 = new FakeClock()
    const inbox1: ServerMsg[] = []
    transport2.client(1).onMessage((m) => inbox1.push(m))
    const restored = RoomHost.restore(snap, {
      code: 'ABCDEF',
      clock: clock2,
      transport: transport2,
      makeRoundSeed: () => 'seed2',
      logIssue: () => {},
    })
    transport2.onMessage((s, m) => restored.receive(s, m))
    restored.resume()
    // Seat 1 is still a bot-piloted human seat.
    expect(restored.roomInfo(1).seats[1].status).toBe('bot')
    // The human returns with their token → handed back to human control.
    restored.onReconnect(1)
    expect(restored.roomInfo(1).seats[1].status).toBe('connected')
    expect(lastView(inbox1).view.seat).toBe(1)
    restored.stop()
  })
})
