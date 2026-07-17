// §8 integration: a full scripted game to an asserted end state, and — the
// one that stops the two paths drifting — LOCAL vs NETWORK parity. The same
// RoomRunner, same seed, same deterministic action policy is driven over
// LocalTransport (in-memory, no serialization) and SimNetTransport (JSON both
// directions, like the real Durable Object socket path). Every payload every
// seat receives must be byte-for-byte identical. If the network path ever
// carries something that doesn't survive JSON, this goes red.

import { describe, expect, it } from 'vitest'
import type { GameState, PlayerView, RuleConfig } from '../../engine/game'
import { SEATS, type Seat } from '../../engine/types'
import { FakeClock } from '../clock'
import { LocalTransport } from '../LocalTransport'
import type { ClientMsg, SeatController, ServerMsg } from '../protocol'
import { RoomRunner, type RoomTiming } from '../RoomRunner'
import type { Transport } from '../transport'
import { SimNetTransport } from './SimNetTransport'

const RULES: RuleConfig = { faanMinimum: 0, flowers: true, faanCap: null }

const PARITY_TIMING: RoomTiming = {
  drawDelayMs: 1,
  botDelayMs: 1,
  claimWindowMs: 4000,
  turnTimerMs: null, // the deterministic policy always answers; no timeouts
  instantAllBotClaims: true,
}

/**
 * Deterministic "player": take a win whenever offered, otherwise pass every
 * claim and discard the first legal tile on your turn. No melds → clean,
 * terminating games that still exercise discards, claim windows (as passes),
 * and wins across the transport.
 */
function choose(view: PlayerView): ClientMsg | null {
  const win = view.legal.find(
    (a) => a.type === 'declareWin' || (a.type === 'claim' && a.claim === 'win'),
  )
  if (win) return { type: 'intent', action: win }
  if (view.phase === 'claims') {
    const pass = view.legal.find((a) => a.type === 'pass')
    return pass ? { type: 'intent', action: pass } : null
  }
  if (view.phase === 'discard' && view.turn === view.seat) {
    const d = view.legal.find((a) => a.type === 'discard')
    return d ? { type: 'intent', action: d } : null
  }
  return null
}

interface RunResult {
  inbox: Record<Seat, ServerMsg[]>
  issues: string[]
  finished?: Extract<ServerMsg, { type: 'finished' }>
}

function playGame(
  makeTransport: () => Transport & { client(seat: Seat): ReturnType<LocalTransport['client']> },
  seats: Record<Seat, SeatController>,
  seed: string,
  initialGame?: GameState,
): RunResult {
  const transport = makeTransport()
  const clock = new FakeClock()
  const issues: string[] = []
  const inbox: Record<Seat, ServerMsg[]> = { 0: [], 1: [], 2: [], 3: [] }
  const seen: Record<Seat, number> = { 0: -1, 1: -1, 2: -1, 3: -1 }
  const actedSeq: Record<Seat, number> = { 0: -1, 1: -1, 2: -1, 3: -1 }
  const conns = SEATS.map((s) => transport.client(s))

  for (const s of SEATS) {
    conns[s].onMessage((m) => {
      inbox[s].push(m)
      if (m.type !== 'view' || seats[s].kind !== 'human') return
      // A real client acts on its freshest view only. Under synchronous in-
      // process delivery a re-entrant action can deliver a newer view before
      // an older one; ignore the stale straggler (seq lower than one seen).
      if (m.seq < seen[s]) return
      seen[s] = m.seq
      if (m.seq <= actedSeq[s]) return // don't act twice on one state
      const next = choose(m.view)
      if (next) {
        actedSeq[s] = m.seq
        conns[s].send(next)
      }
    })
  }

  const runner = new RoomRunner({
    rules: RULES,
    seats,
    timing: PARITY_TIMING,
    clock,
    transport,
    makeRoundSeed: (n) => `${seed}-${n}`,
    botSeed: `${seed}-bots`,
    logIssue: (m) => issues.push(m),
    ...(initialGame ? { initialGame } : {}),
  })
  transport.onMessage((s, m) => runner.receive(s, m))
  runner.start()
  clock.runAll()

  const finished = inbox[0].find((m) => m.type === 'finished') as RunResult['finished']
  return { inbox, issues, finished }
}

const ALL_HUMAN: Record<Seat, SeatController> = {
  0: { kind: 'human' },
  1: { kind: 'human' },
  2: { kind: 'human' },
  3: { kind: 'human' },
}
const ONE_HUMAN: Record<Seat, SeatController> = {
  0: { kind: 'human' },
  1: { kind: 'bot', difficulty: 'intermediate' },
  2: { kind: 'bot', difficulty: 'intermediate' },
  3: { kind: 'bot', difficulty: 'intermediate' },
}

describe('full scripted 4-player game (§8)', () => {
  it('runs to a finished round with a coherent end state', () => {
    const r = playGame(() => new LocalTransport(), ALL_HUMAN, 'scripted-4p')
    expect(r.finished).toBeDefined()
    const res = r.finished!.result
    expect(res.kind === 'win' || res.kind === 'draw').toBe(true)
    if (res.kind === 'win') {
      expect(SEATS).toContain(res.winner)
      expect(r.finished!.match.scores[res.winner!]).toBe(res.fan!.totalFaan)
    }
    expect(r.finished!.log.length).toBeGreaterThan(10)
    // Any diagnostics are only ever the benign "acted on a superseded view"
    // kind — a rejected+ignored stale action, never a runner-internal error.
    for (const msg of r.issues) expect(msg).toMatch(/illegal intent from seat/)
  })

  it('is reproducible from the same seed', () => {
    const a = playGame(() => new LocalTransport(), ALL_HUMAN, 'repro-seed')
    const b = playGame(() => new LocalTransport(), ALL_HUMAN, 'repro-seed')
    expect(a.finished!.result).toEqual(b.finished!.result)
    expect(a.finished!.log).toEqual(b.finished!.log)
  })
})

describe('LOCAL vs NETWORK transport parity (§8)', () => {
  const scenarios: [string, Record<Seat, SeatController>, string][] = [
    ['four humans', ALL_HUMAN, 'parity-4h'],
    ['one human, three bots', ONE_HUMAN, 'parity-1h3b'],
  ]

  for (const [name, seats, seed] of scenarios) {
    it(`${name}: every payload to every seat is identical across transports`, () => {
      const local = playGame(() => new LocalTransport(), seats, seed)
      const net = playGame(() => new SimNetTransport(), seats, seed)

      // Both must actually have played a full game — and behave identically,
      // right down to any (benign, stale-action) diagnostics.
      expect(local.finished).toBeDefined()
      expect(net.finished).toBeDefined()
      expect(net.issues).toEqual(local.issues)
      for (const msg of local.issues) expect(msg).toMatch(/illegal intent from seat/)

      // The exact per-seat message streams must match byte-for-byte (deep
      // structural equality — Local passes object refs, Net passes JSON copies).
      for (const s of SEATS) {
        expect(net.inbox[s].length, `seat ${s} message count`).toBe(local.inbox[s].length)
        expect(net.inbox[s], `seat ${s} message stream`).toEqual(local.inbox[s])
      }
      // And the same end state.
      expect(net.finished!.result).toEqual(local.finished!.result)
      expect(net.finished!.log).toEqual(local.finished!.log)
    })
  }

  it('the JSON round-trip preserves every field the client relies on', () => {
    // A guard against silent type drift: the network path must not turn a
    // number into a string, drop an optional, or reorder a meld's tiles.
    const local = playGame(() => new LocalTransport(), ONE_HUMAN, 'json-fields')
    const net = playGame(() => new SimNetTransport(), ONE_HUMAN, 'json-fields')
    const lv = local.inbox[0].find((m) => m.type === 'view') as Extract<ServerMsg, { type: 'view' }>
    const nv = net.inbox[0].find((m) => m.type === 'view') as Extract<ServerMsg, { type: 'view' }>
    expect(typeof nv.view.wallCount).toBe('number')
    expect(nv.view).toEqual(lv.view)
    expect(nv.match).toEqual(lv.match)
  })
})
