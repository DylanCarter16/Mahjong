// §8 claim-window tests. These exercise the TIMED window in RoomRunner with
// a FakeClock: claims arrive over time, and the property under test is that
// latency never decides a contest (§5.1). No setTimeout, no sleeps.

import { describe, expect, it } from 'vitest'
import type { GameState } from '../../engine/game'
import { SEATS, type Seat } from '../../engine/types'
import { FakeClock } from '../clock'
import { LocalTransport } from '../LocalTransport'
import type { ClientMsg, SeatController, ServerMsg } from '../protocol'
import { RoomRunner, type RoomTiming } from '../RoomRunner'
import { craftedGame } from './helpers'

// Multiplayer-style timing: a real 4s human window, bots effectively instant.
const MP_TIMING: RoomTiming = {
  drawDelayMs: 1,
  botDelayMs: 5,
  claimWindowMs: 4000,
  turnTimerMs: null,
  instantAllBotClaims: true,
}

const HUMANS: Record<Seat, SeatController> = {
  0: { kind: 'human' },
  1: { kind: 'human' },
  2: { kind: 'human' },
  3: { kind: 'human' },
}
const BOTS: Record<Seat, SeatController> = {
  0: { kind: 'bot', difficulty: 'intermediate' },
  1: { kind: 'bot', difficulty: 'intermediate' },
  2: { kind: 'bot', difficulty: 'intermediate' },
  3: { kind: 'bot', difficulty: 'intermediate' },
}

interface Harness {
  runner: RoomRunner
  clock: FakeClock
  inbox: Record<Seat, ServerMsg[]>
  issues: string[]
  send: (seat: Seat, msg: ClientMsg) => void
}

function room(seats: Record<Seat, SeatController>, initialGame: GameState): Harness {
  const transport = new LocalTransport()
  const clock = new FakeClock()
  const issues: string[] = []
  const inbox: Record<Seat, ServerMsg[]> = { 0: [], 1: [], 2: [], 3: [] }
  const conns = SEATS.map((s) => transport.client(s))
  for (const s of SEATS) conns[s].onMessage((m) => inbox[s].push(m))
  const runner = new RoomRunner({
    rules: initialGame.config,
    seats,
    timing: MP_TIMING,
    clock,
    transport,
    makeRoundSeed: () => 'unused-crafted',
    botSeed: 'cw-bots',
    logIssue: (m) => issues.push(m),
    initialGame,
  })
  transport.onMessage((s, m) => runner.receive(s, m))
  runner.start()
  return { runner, clock, inbox, issues, send: (s, m) => conns[s].send(m) }
}

const lastView = (inbox: ServerMsg[]) =>
  [...inbox].reverse().find((m) => m.type === 'view') as Extract<ServerMsg, { type: 'view' }>
const finishedOf = (inbox: ServerMsg[]) =>
  inbox.find((m) => m.type === 'finished') as Extract<ServerMsg, { type: 'finished' }> | undefined

// ---- crafted positions (seat 0 is dealer, about to discard) --------------

/** Seat 1 can chow p5; seat 2 wins on p5; seat 3 has no claim. */
const chowVsWin = (): GameState =>
  craftedGame({
    handsFromDealer: [
      ['m5', 'm5', 's2', 's3', 'p8', 'p9', 'wN', 'wS', 'm8', 'm9', 's6', 's4', 'dW'],
      ['p4', 'p6', 'm1', 'm4', 'm7', 's1', 's4', 's7', 'wN', 'wW', 'dR', 'dG', 'dW'],
      ['p4', 'p6', 'm1', 'm2', 'm3', 's7', 's8', 's9', 'p1', 'p2', 'p3', 'wW', 'wW'],
      ['m3', 'm6', 'm9', 's3', 's6', 's9', 'p7', 'p8', 'p9', 'dW', 'dR', 'dR', 'wS'],
    ],
    dealerExtra: 'p5',
  })

/** Seats 2 and 3 both win on dR (pair wait); seat 1 has no claim. */
const twoWinners = (): GameState =>
  craftedGame({
    handsFromDealer: [
      ['m5', 'm5', 's2', 's3', 'p8', 'p9', 'wN', 'wS', 'm8', 's6', 's4', 'dG', 'dW'],
      ['m7', 'm8', 'm9', 'p1', 'p2', 'p4', 's7', 's8', 'wN', 'wS', 'wW', 'dG', 'dW'],
      ['m1', 'm2', 'm3', 'p4', 'p5', 'p6', 's7', 's8', 's9', 'p1', 'p2', 'p3', 'dR'],
      ['m4', 'm5', 'm6', 's1', 's2', 's3', 'p7', 'p8', 'p9', 's4', 's5', 's6', 'dR'],
    ],
    dealerExtra: 'dR',
  })

/** Only seat 1 can act on dR (pung); nobody else. */
const onePung = (): GameState =>
  craftedGame({
    handsFromDealer: [
      ['m5', 'm5', 's2', 's3', 'p8', 'p9', 'wN', 'wS', 'm8', 'm9', 's6', 's4', 'dW'],
      ['dR', 'dR', 'm1', 'm4', 'm7', 's1', 's5', 's9', 'wN', 'wW', 'dG', 'p7', 'dW'],
      ['m3', 'm6', 'm9', 's3', 's6', 's9', 'p1', 'p2', 'p3', 'p4', 'p5', 'wS', 'wS'],
      ['m2', 'm5', 'm8', 's2', 's4', 's7', 'p6', 'p8', 'wE', 'wE', 'dG', 'p7', 'p9'],
    ],
    dealerExtra: 'dR',
  })

// --------------------------------------------------------------------------

describe('claim window (§5, §8)', () => {
  it('skip-window: a discard nobody can claim advances immediately, no delay', () => {
    const h = room(HUMANS, chowVsWin())
    const before = lastView(h.inbox[0]).seq
    // Seat 0 discards an isolated tile (wN) — nobody has a claim on it.
    h.send(0, { type: 'intent', action: { type: 'discard', seat: 0, tile: 'wN' } })
    const after = lastView(h.inbox[1])
    expect(after.seq).toBeGreaterThan(before)
    expect(after.view.phase).toBe('draw') // straight past the window
    expect(after.view.turn).toBe(1)
    // No claim-window timer was armed (only the 1ms forced-draw pace).
    expect(h.clock.pending).toBeLessThanOrEqual(1)
    h.runner.stop()
  })

  it('claim priority: chow arrives FIRST, win arrives LAST — the win takes it', () => {
    const h = room(HUMANS, chowVsWin())
    h.send(0, { type: 'intent', action: { type: 'discard', seat: 0, tile: 'p5' } })
    expect(lastView(h.inbox[2]).view.phase).toBe('claims')

    // Fast connection: seat 1's chow lands early in the window (a claim is an
    // intent wrapping a claim action — latency here must not win the contest).
    h.clock.advance(200)
    h.send(1, { type: 'intent', action: { type: 'claim', seat: 1, claim: { chow: ['p4', 'p6'] } } })
    expect(finishedOf(h.inbox[2])).toBeUndefined() // still collecting

    // Hotel wifi: seat 2's winning declaration lands much later, still in window.
    h.clock.advance(3000)
    h.send(2, { type: 'intent', action: { type: 'claim', seat: 2, claim: 'win' } })

    const fin = finishedOf(h.inbox[2])
    expect(fin).toBeDefined()
    expect(fin!.result).toMatchObject({ kind: 'win', winner: 2, loser: 0 })
    h.runner.stop()
  })

  it('same-priority tie: two winners resolve by seat order, not arrival', () => {
    const h = room(HUMANS, twoWinners())
    h.send(0, { type: 'intent', action: { type: 'discard', seat: 0, tile: 'dR' } })
    expect(lastView(h.inbox[2]).view.phase).toBe('claims')
    // The FARTHER seat (3) declares first; the nearer seat (2) declares later.
    h.clock.advance(500)
    h.send(3, { type: 'intent', action: { type: 'claim', seat: 3, claim: 'win' } })
    h.clock.advance(500)
    h.send(2, { type: 'intent', action: { type: 'claim', seat: 2, claim: 'win' } })
    const fin = finishedOf(h.inbox[0])
    expect(fin).toBeDefined()
    expect(fin!.result.winner).toBe(2) // nearest seat from the discarder
    h.runner.stop()
  })

  it('close early: once every eligible seat responds, no waiting out the window', () => {
    const h = room(HUMANS, onePung())
    h.send(0, { type: 'intent', action: { type: 'discard', seat: 0, tile: 'dR' } })
    const atClaims = lastView(h.inbox[1]).seq
    // Seat 1 is the only eligible seat; it passes at t=100 (< 4000 window).
    h.clock.advance(100)
    h.send(1, { type: 'intent', action: { type: 'pass', seat: 1 } })
    const after = lastView(h.inbox[1])
    expect(after.seq).toBeGreaterThan(atClaims)
    // Resolved now, at t=100 — dR is in seat 0's discard pool, play moved on.
    expect(after.view.discards[0]).toContain('dR')
    expect(after.view.phase).toBe('draw')
    expect(h.clock.now()).toBe(100)
    h.runner.stop()
  })

  it('timeout = pass: an eligible seat that never responds is passed at expiry', () => {
    const h = room(HUMANS, onePung())
    h.send(0, { type: 'intent', action: { type: 'discard', seat: 0, tile: 'dR' } })
    expect(lastView(h.inbox[1]).view.phase).toBe('claims')
    // Seat 1 (could pung) stays silent. Window lapses.
    h.clock.advance(3999)
    expect(lastView(h.inbox[1]).view.phase).toBe('claims') // not yet
    h.clock.advance(1)
    const after = lastView(h.inbox[1])
    expect(after.view.discards[0]).toContain('dR') // timed out → treated as pass
    expect(after.view.phase).toBe('draw')
    expect(h.issues).toEqual([]) // a timeout is not an error
    expect(h.runner['game']).toBeTruthy()
    h.runner.stop()
  })

  it('all bots eligible: resolves without waiting out the human window', () => {
    const h = room(BOTS, onePung())
    // No human is owed a window (§5.2 rule 6). Bots respond on the 5ms pace;
    // the 4000ms window is never the gating factor.
    h.clock.advance(50)
    const v = lastView(h.inbox[0])
    // The pung either happened or was declined, but the position has MOVED
    // well before 4000ms — dR is no longer pending.
    expect(v.view.pendingDiscard?.tile).not.toBe('dR')
    expect(h.clock.now()).toBeLessThan(4000)
    h.runner.stop()
  })

  it('illegal claim during a window: rejected, treated as pass, logged', () => {
    const h = room(HUMANS, onePung())
    h.send(0, { type: 'intent', action: { type: 'discard', seat: 0, tile: 'dR' } })
    const atClaims = lastView(h.inbox[1]).seq
    // Seat 1 can pung, but claims a KONG it cannot make — illegal.
    h.send(1, { type: 'intent', action: { type: 'claim', seat: 1, claim: 'kong' } })
    expect(h.inbox[1].some((m) => m.type === 'rejected')).toBe(true)
    expect(h.issues.length).toBe(1)
    // Treated as a pass: seat 1 no longer holds the window open, dR resolves.
    const after = lastView(h.inbox[1])
    expect(after.seq).toBeGreaterThan(atClaims)
    expect(after.view.discards[0]).toContain('dR')
    h.runner.stop()
  })

  it('a seat with no legal claim never holds the window open (§5.2 rule 3)', () => {
    const h = room(HUMANS, onePung())
    h.send(0, { type: 'intent', action: { type: 'discard', seat: 0, tile: 'dR' } })
    // Seats 2 and 3 cannot claim dR — they are not eligible and must not gate.
    expect(h.runner['game']).toBeTruthy()
    // Seat 1 passes; window closes with 2 and 3 never having to respond.
    h.send(1, { type: 'intent', action: { type: 'pass', seat: 1 } })
    expect(lastView(h.inbox[1]).view.phase).toBe('draw')
    expect(h.clock.now()).toBe(0) // closed instantly, no window wait
    h.runner.stop()
  })
})
