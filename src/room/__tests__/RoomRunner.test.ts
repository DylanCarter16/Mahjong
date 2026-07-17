import { describe, expect, it } from 'vitest'
import type { GameState, RuleConfig } from '../../engine/game'
import { SEATS, type Seat } from '../../engine/types'
import { FakeClock } from '../clock'
import { LocalTransport } from '../LocalTransport'
import type { ClientMsg, MatchInfo, SeatController, ServerMsg } from '../protocol'
import { nextRoundSetup, RoomRunner, SOLO_TIMING, type RoomTiming } from '../RoomRunner'
import { craftedGame, dealerWinHand, quietHands } from './helpers'

const RULES: RuleConfig = { faanMinimum: 0, flowers: true, faanCap: null }

const BOT: SeatController = { kind: 'bot', difficulty: 'intermediate' }
const HUMAN: SeatController = { kind: 'human' }

interface Harness {
  runner: RoomRunner
  clock: FakeClock
  /** Every message each seat received, in order. */
  inbox: Record<Seat, ServerMsg[]>
  issues: string[]
  send: (seat: Seat, msg: ClientMsg) => void
}

function makeRoom(
  seats: Record<Seat, SeatController>,
  timing: RoomTiming = SOLO_TIMING,
  seed = 'runner-test',
  initialGame?: GameState,
): Harness {
  const transport = new LocalTransport()
  const clock = new FakeClock()
  const issues: string[] = []
  const inbox: Record<Seat, ServerMsg[]> = { 0: [], 1: [], 2: [], 3: [] }
  const conns = SEATS.map((s) => transport.client(s))
  for (const s of SEATS) conns[s].onMessage((m) => inbox[s].push(m))
  const runner = new RoomRunner({
    rules: RULES,
    seats,
    timing,
    clock,
    transport,
    makeRoundSeed: (n) => `${seed}-${n}`,
    botSeed: `${seed}-bots`,
    logIssue: (m) => issues.push(m),
    ...(initialGame ? { initialGame } : {}),
  })
  transport.onMessage((s, m) => runner.receive(s, m))
  return { runner, clock, inbox, issues, send: (s, m) => conns[s].send(m) }
}

const lastView = (inbox: ServerMsg[]) =>
  [...inbox].reverse().find((m) => m.type === 'view') as Extract<ServerMsg, { type: 'view' }>

describe('RoomRunner', () => {
  it('start deals and sends every seat its own view', () => {
    const h = makeRoom({ 0: HUMAN, 1: BOT, 2: BOT, 3: BOT })
    h.runner.start()
    for (const s of SEATS) {
      const v = lastView(h.inbox[s])
      expect(v).toBeDefined()
      expect(v.view.seat).toBe(s)
      expect(v.match.roundNo).toBe(1)
    }
    // Dealer (seat 0) starts with 14 tiles, everyone else 13.
    expect(lastView(h.inbox[0]).view.concealed.length).toBe(14)
    expect(lastView(h.inbox[1]).view.concealed.length).toBe(13)
    expect(lastView(h.inbox[0]).view.handCounts[1]).toBe(13)
  })

  it('start is idempotent and stop cancels all timers', () => {
    const h = makeRoom({ 0: BOT, 1: BOT, 2: BOT, 3: BOT })
    h.runner.start()
    expect(h.clock.pending).toBeGreaterThan(0)
    h.runner.stop()
    expect(h.clock.pending).toBe(0)
    const seqBefore = lastView(h.inbox[0]).seq
    h.runner.start() // resumes, does not re-deal
    expect(lastView(h.inbox[0]).seq).toBe(seqBefore)
    expect(h.clock.pending).toBeGreaterThan(0)
    h.runner.stop()
  })

  it('a full bots-only round runs to completion with no leaked timers', () => {
    const h = makeRoom({ 0: BOT, 1: BOT, 2: BOT, 3: BOT })
    h.runner.start()
    h.clock.runAll()
    const finished = h.inbox[0].find((m) => m.type === 'finished')
    expect(finished).toBeDefined()
    if (finished?.type !== 'finished') throw new Error('unreachable')
    expect(finished.result.kind === 'win' || finished.result.kind === 'draw').toBe(true)
    expect(finished.log.length).toBeGreaterThan(0)
    expect(h.clock.pending).toBe(0)
    expect(h.issues).toEqual([])
    // A win banks faan on the scoreboard; a draw banks nothing.
    if (finished.result.kind === 'win' && finished.result.fan) {
      expect(finished.match.scores[finished.result.winner!]).toBe(finished.result.fan.totalFaan)
    }
  })

  it('bot pacing respects the injected clock', () => {
    const h = makeRoom({ 0: BOT, 1: BOT, 2: BOT, 3: BOT })
    h.runner.start()
    const seq0 = lastView(h.inbox[0]).seq
    h.clock.advance(SOLO_TIMING.botDelayMs - 1)
    expect(lastView(h.inbox[0]).seq).toBe(seq0) // dealer bot still "thinking"
    h.clock.advance(1)
    expect(lastView(h.inbox[0]).seq).toBeGreaterThan(seq0) // discard landed
    h.runner.stop()
  })

  it('a human discard intent applies and the game advances', () => {
    const h = makeRoom({ 0: HUMAN, 1: BOT, 2: BOT, 3: BOT })
    h.runner.start()
    const v = lastView(h.inbox[0])
    expect(v.view.phase).toBe('discard')
    expect(v.view.turn).toBe(0)
    const tile = v.view.concealed[0]
    h.send(0, { type: 'intent', action: { type: 'discard', seat: 0, tile } })
    const after = lastView(h.inbox[0])
    expect(after.seq).toBeGreaterThan(v.seq)
    expect(after.view.concealed.length).toBe(13)
    expect(['claims', 'draw']).toContain(after.view.phase)
    expect(h.issues).toEqual([])
    h.runner.stop()
  })

  it('an illegal intent is rejected, state unchanged, and logged', () => {
    const h = makeRoom({ 0: HUMAN, 1: BOT, 2: BOT, 3: BOT })
    h.runner.start()
    const v = lastView(h.inbox[0])
    const notInHand = ['m1', 'm2', 'p5', 's9', 'wE'].find((t) => !v.view.concealed.includes(t))!
    h.send(0, { type: 'intent', action: { type: 'discard', seat: 0, tile: notInHand } })
    expect(h.inbox[0].some((m) => m.type === 'rejected')).toBe(true)
    expect(lastView(h.inbox[0]).seq).toBe(v.seq) // no new state
    expect(h.issues.length).toBe(1)
    h.runner.stop()
  })

  it('an intent naming another seat is rejected and logged', () => {
    const h = makeRoom({ 0: HUMAN, 1: HUMAN, 2: BOT, 3: BOT })
    h.runner.start()
    const v = lastView(h.inbox[1])
    // Seat 1 tries to act as seat 0 (the dealer, whose turn it is).
    const tile = lastView(h.inbox[0]).view.concealed[0]
    h.send(1, { type: 'intent', action: { type: 'discard', seat: 0, tile } })
    expect(h.inbox[1].some((m) => m.type === 'rejected')).toBe(true)
    expect(lastView(h.inbox[1]).seq).toBe(v.seq)
    expect(h.issues.length).toBe(1)
    h.runner.stop()
  })

  it('an intent for a bot-controlled seat is rejected', () => {
    const h = makeRoom({ 0: HUMAN, 1: BOT, 2: BOT, 3: BOT })
    h.runner.start()
    // A hostile client claims to be seat 1 (a bot) — transport says seat 1's
    // conn sent it, which cannot happen for a bot seat.
    h.send(1, { type: 'intent', action: { type: 'draw', seat: 1 } })
    expect(h.inbox[1].some((m) => m.type === 'rejected')).toBe(true)
    expect(h.issues.length).toBe(1)
    h.runner.stop()
  })

  it('newRound is rejected while the round is live', () => {
    const h = makeRoom({ 0: HUMAN, 1: BOT, 2: BOT, 3: BOT })
    h.runner.start()
    h.send(0, { type: 'newRound' })
    expect(h.inbox[0].some((m) => m.type === 'rejected')).toBe(true)
    h.runner.stop()
  })

  it('a dealt winning hand can be declared and newRound starts round 2', () => {
    const win = dealerWinHand()
    const game = craftedGame({
      handsFromDealer: [win.hand13, ...quietHands()],
      dealerExtra: win.extra,
    })
    const h = makeRoom({ 0: HUMAN, 1: BOT, 2: BOT, 3: BOT }, SOLO_TIMING, 'crafted', game)
    h.runner.start()
    const v = lastView(h.inbox[0])
    expect(v.view.legal.some((a) => a.type === 'declareWin')).toBe(true)
    h.send(0, { type: 'intent', action: { type: 'declareWin', seat: 0 } })

    const fin = h.inbox[0].find((m) => m.type === 'finished')
    expect(fin?.type).toBe('finished')
    if (fin?.type !== 'finished') throw new Error('unreachable')
    expect(fin.result.kind).toBe('win')
    expect(fin.result.winner).toBe(0)
    expect(fin.result.selfDraw).toBe(true)
    expect(fin.match.scores[0]).toBe(fin.result.fan!.totalFaan)

    h.send(0, { type: 'newRound' })
    const v2 = lastView(h.inbox[0])
    expect(v2.match.roundNo).toBe(2)
    expect(v2.match.dealer).toBe(0) // dealer won → dealer repeats
    expect(v2.view.phase).toBe('discard')
    expect(v2.view.concealed.length).toBe(14) // dealer again
    expect(v2.match.scores[0]).toBe(fin.match.scores[0]) // scoreboard carries over
    h.runner.stop()
  })
})

describe('nextRoundSetup', () => {
  const base: MatchInfo = { dealer: 0, roundWind: 'E', roundNo: 1, scores: { 0: 0, 1: 0, 2: 0, 3: 0 } }

  it('dealer repeats on a dealer win', () => {
    const s = nextRoundSetup({ kind: 'win', winner: 0 }, base)
    expect(s).toEqual({ dealer: 0, roundWind: 'E', roundNo: 2 })
  })

  it('dealer repeats on a drawn round', () => {
    const s = nextRoundSetup({ kind: 'draw' }, base)
    expect(s).toEqual({ dealer: 0, roundWind: 'E', roundNo: 2 })
  })

  it('deal rotates when a non-dealer wins', () => {
    const s = nextRoundSetup({ kind: 'win', winner: 2 }, base)
    expect(s).toEqual({ dealer: 1, roundWind: 'E', roundNo: 2 })
  })

  it('round wind advances when the deal passes back to seat 0', () => {
    const m: MatchInfo = { ...base, dealer: 3, roundWind: 'E', roundNo: 4 }
    const s = nextRoundSetup({ kind: 'win', winner: 0 }, m)
    expect(s).toEqual({ dealer: 0, roundWind: 'S', roundNo: 5 })
  })
})
