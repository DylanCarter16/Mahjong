// ═══════════════════════════════════════════════════════════════════════════
//
//   THE LEAK TEST — spec §2.2. The single most important test in the repo.
//
//   Hidden information must never leave the server. This suite captures every
//   payload the room emits to seat E across entire games and proves, against
//   an independently reconstructed game state, that no tile from any other
//   seat's concealed hand and no unseen wall tile appears in any of them.
//
//   DO NOT weaken, skip, or delete these tests. If one goes red, the game has
//   stopped being a game: someone can read hands. Fix the leak, not the test.
//
//   Three independent prongs (deliberately not derived from playerView, so a
//   bug there cannot vouch for itself):
//     1. Path allowlist — every key path in every message must be expected.
//        A GameState field (wall, hands, log, seed…) appearing anywhere fails.
//     2. Conservation — per tile kind: copies visible in the view + copies
//        actually hidden (others' hands, the wall, others' concealed kongs)
//        must equal the total in the tile set. A single leaked tile breaks it.
//     3. Masking — another seat's concealed kong never shows its tiles until
//        the post-round disclosure.
//
// ═══════════════════════════════════════════════════════════════════════════

import { describe, expect, it } from 'vitest'
import { applyAction, createGame, type GameState, type PlayerView, type RuleConfig } from '../../engine/game'
import { SEATS, type Seat, type TileId } from '../../engine/types'
import { FakeClock } from '../clock'
import { LocalTransport } from '../LocalTransport'
import type { ClientMsg, SeatController, ServerMsg } from '../protocol'
import { RoomRunner, SOLO_TIMING } from '../RoomRunner'
import { craftedGame } from './helpers'

const BOT: SeatController = { kind: 'bot', difficulty: 'advanced' }
const HUMAN: SeatController = { kind: 'human' }

// --------------------------------------------------------- capture harness --

interface Captured {
  msgs: ServerMsg[]
  send: (seat: Seat, msg: ClientMsg) => void
  clock: FakeClock
  runner: RoomRunner
}

function captureSeat(
  seatUnderTest: Seat,
  seats: Record<Seat, SeatController>,
  seed: string,
  rules: RuleConfig,
  initialGame?: GameState,
): Captured {
  const transport = new LocalTransport()
  const clock = new FakeClock()
  const msgs: ServerMsg[] = []
  const conns = SEATS.map((s) => transport.client(s))
  conns[seatUnderTest].onMessage((m) => msgs.push(structuredClone(m)))
  const runner = new RoomRunner({
    rules,
    seats,
    timing: SOLO_TIMING,
    clock,
    transport,
    makeRoundSeed: (n) => `${seed}-${n}`,
    botSeed: `${seed}-bots`,
    logIssue: () => {},
    ...(initialGame ? { initialGame } : {}),
  })
  transport.onMessage((s, m) => runner.receive(s, m))
  return { msgs, send: (s, m) => conns[s].send(m), clock, runner }
}

// ------------------------------------------------------- prong 1: allowlist --

// Wildcards: * = any array index, § = any seat key (0-3), NAME = literal.
const VIEW_PATHS = [
  'type',
  'seq',
  'view.seat',
  'view.seatWind',
  'view.roundWind',
  'view.seatWinds.§',
  'view.concealed.*',
  'view.handCounts.§',
  'view.melds.§.*.type',
  'view.melds.§.*.tiles.*',
  'view.melds.§.*.concealed',
  'view.melds.§.*.kongStyle',
  'view.melds.§.*.claimedFrom',
  'view.bonus.§.*',
  'view.discards.§.*',
  'view.wallCount',
  'view.faanMinimum',
  'view.turn',
  'view.phase',
  'view.pendingDiscard',
  'view.pendingDiscard.tile',
  'view.pendingDiscard.from',
  'view.lastClaimed',
  'view.legal.*.type',
  'view.legal.*.seat',
  'view.legal.*.tile',
  'view.legal.*.style',
  'view.legal.*.claim',
  'view.legal.*.claim.chow.*',
  'match.dealer',
  'match.roundWind',
  'match.roundNo',
  'match.scores.§',
]

const FINISHED_PATHS = [
  'type',
  'seq',
  'result.kind',
  'result.winner',
  'result.loser',
  'result.selfDraw',
  'result.fan.totalFaan',
  'result.fan.patterns.*.name',
  'result.fan.patterns.*.faan',
  'result.fan.capped',
  // Post-round disclosure: the full action log goes out ONLY in this message,
  // only once the round is finished (asserted separately below).
  'log.*.type',
  'log.*.seat',
  'log.*.tile',
  'log.*.style',
  'log.*.claim',
  'log.*.claim.chow.*',
  'match.dealer',
  'match.roundWind',
  'match.roundNo',
  'match.scores.§',
]

const REJECTED_PATHS = ['type', 'seq', 'reason']

function leafPaths(value: unknown, prefix = ''): string[] {
  if (value === null || typeof value !== 'object') return [prefix]
  // Empty containers carry no information; only content can leak.
  if (Array.isArray(value)) {
    return value.flatMap((v) => leafPaths(v, prefix ? `${prefix}.*` : '*'))
  }
  return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) => {
    const key = /^[0-3]$/.test(k) ? '§' : k
    return leafPaths(v, prefix ? `${prefix}.${key}` : key)
  })
}

function assertAllowedPaths(msg: ServerMsg): void {
  const allowed =
    msg.type === 'view' ? VIEW_PATHS : msg.type === 'finished' ? FINISHED_PATHS : REJECTED_PATHS
  for (const p of leafPaths(msg)) {
    expect(allowed, `unexpected payload path "${p}" in a ${msg.type} message`).toContain(p)
  }
}

// ---------------------------------------------------- prong 2: conservation --

function countInto(counts: Map<TileId, number>, tiles: Iterable<TileId>): void {
  for (const t of tiles) counts.set(t, (counts.get(t) ?? 0) + 1)
}

/** Every copy of every tile kind in the game, from the untouched deal. */
function totalsOf(initial: GameState): Map<TileId, number> {
  const totals = new Map<TileId, number>()
  countInto(totals, initial.wall)
  for (const s of SEATS) {
    countInto(totals, initial.hands[s])
    countInto(totals, initial.bonus[s])
    for (const m of initial.melds[s]) countInto(totals, m.tiles)
  }
  return totals
}

/** Tiles the view actually shows (lastClaimed excluded: it is already in a meld). */
function visibleInView(view: PlayerView): Map<TileId, number> {
  const c = new Map<TileId, number>()
  countInto(c, view.concealed)
  for (const s of SEATS) {
    countInto(c, view.discards[s])
    countInto(c, view.bonus[s])
    for (const m of view.melds[s]) countInto(c, m.tiles)
  }
  if (view.pendingDiscard) countInto(c, [view.pendingDiscard.tile])
  return c
}

/** Tiles genuinely hidden from `seat` in the true state. */
function hiddenFrom(state: GameState, seat: Seat): Map<TileId, number> {
  const c = new Map<TileId, number>()
  countInto(c, state.wall)
  for (const s of SEATS) {
    if (s === seat) continue
    countInto(c, state.hands[s])
    for (const m of state.melds[s]) {
      if (m.type === 'kong' && m.concealed) countInto(c, m.tiles)
    }
  }
  return c
}

function assertConservation(view: PlayerView, state: GameState, totals: Map<TileId, number>): void {
  const visible = visibleInView(view)
  const hidden = hiddenFrom(state, view.seat)
  const kinds = new Set([...totals.keys(), ...visible.keys(), ...hidden.keys()])
  for (const k of kinds) {
    const v = visible.get(k) ?? 0
    const h = hidden.get(k) ?? 0
    const t = totals.get(k) ?? 0
    expect(
      v + h,
      `tile ${k}: view shows ${v} + hidden ${h} ≠ total ${t} — a hidden tile leaked into seat ${view.seat}'s view`,
    ).toBe(t)
  }
}

function assertMasking(view: PlayerView, phase: GameState['phase']): void {
  for (const s of SEATS) {
    if (s === view.seat) continue
    for (const m of view.melds[s]) {
      if (m.type === 'kong' && m.concealed && phase !== 'finished') {
        expect(m.tiles, `seat ${s}'s concealed kong tiles visible to seat ${view.seat}`).toEqual([])
      }
    }
  }
}

/** Belt-and-braces: GameState-only keys must never appear in any message. */
function assertNoForbiddenKeys(msg: ServerMsg): void {
  const forbidden = new Set(['wall', 'hands', 'seed', 'claims', 'lastDraw', 'config'])
  const walk = (v: unknown): void => {
    if (v === null || typeof v !== 'object') return
    if (Array.isArray(v)) {
      for (const x of v) walk(x)
      return
    }
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      expect(forbidden.has(k), `forbidden key "${k}" found in a ${msg.type} message`).toBe(false)
      walk(x)
    }
  }
  walk(msg)
  if ('log' in msg === false) return
  expect(msg.type, 'an action log appeared outside the post-round disclosure').toBe('finished')
}

// ------------------------------------------------------------------- tests --

const RULES: RuleConfig = { faanMinimum: 0, flowers: true, faanCap: null }

describe('THE LEAK TEST (§2.2)', () => {
  it('a full bots-only game leaks nothing to seat E in any payload', () => {
    const seed = 'leak-audit'
    const cap = captureSeat(0, { 0: BOT, 1: BOT, 2: BOT, 3: BOT }, seed, RULES)
    cap.runner.start()
    cap.clock.runAll()

    const finished = cap.msgs.find((m) => m.type === 'finished')
    expect(finished?.type).toBe('finished')
    if (finished?.type !== 'finished') throw new Error('unreachable')

    // Reconstruct the true state sequence independently from the same seed
    // and the disclosed log: states[n] is the state after n actions, and the
    // view with seq n+1 was emitted from states[n].
    const states: GameState[] = [createGame(RULES, `${seed}-1`, 0, 'E')]
    for (const a of finished.log) states.push(applyAction(states[states.length - 1], a))
    const totals = totalsOf(states[0])

    const views = cap.msgs.filter((m) => m.type === 'view')
    expect(views.length).toBe(states.length) // one view wave per state version

    for (const msg of cap.msgs) {
      assertAllowedPaths(msg)
      assertNoForbiddenKeys(msg)
    }
    for (const msg of views) {
      const state = states[msg.seq - 1]
      expect(state, `no reconstructed state for view seq ${msg.seq}`).toBeDefined()
      expect(msg.view.seat).toBe(0)
      // Own hand must be exactly the true hand — and nothing more.
      expect([...msg.view.concealed].sort()).toEqual([...state.hands[0]].sort())
      // Other hands arrive as counts only.
      for (const s of [1, 2, 3] as const) {
        expect(msg.view.handCounts[s]).toBe(state.hands[s].length)
      }
      assertConservation(msg.view, state, totals)
      assertMasking(msg.view, state.phase)
    }

    // The game actually exercised the interesting paths.
    expect(states[states.length - 1].phase).toBe('finished')
    expect(finished.log.length).toBeGreaterThan(20)
  })

  it("another seat's concealed kong stays masked; conservation still holds", () => {
    const game = craftedGame({
      handsFromDealer: [
        ['m1', 'm1', 'm2', 'm2', 'm3', 'm3', 'p6', 'p6', 'p7', 'p7', 'p8', 'p8', 'wE'],
        ['wN', 'wN', 'wN', 'wN', 'p2', 'p2', 'p3', 'p3', 'p4', 'm4', 'm4', 'm5', 'm5'],
        ['s3', 's3', 's4', 's4', 's5', 's5', 'm6', 'm6', 'm7', 'm7', 'm8', 'm8', 'wS'],
        ['s6', 's6', 's7', 's7', 's8', 's8', 'p9', 'p9', 'm9', 'm9', 'p5', 'p5', 'wW'],
      ],
      dealerExtra: 'dR',
      drawOrder: ['s9'],
    })
    const cap = captureSeat(0, { 0: HUMAN, 1: HUMAN, 2: BOT, 3: BOT }, 'kong-mask', {
      ...RULES,
      flowers: false,
    }, game)
    cap.runner.start()

    // Dealer discards the lone dragon; nobody can claim it; seat 1 draws.
    cap.send(0, { type: 'intent', action: { type: 'discard', seat: 0, tile: 'dR' } })
    cap.clock.runAll() // forced draw fires for seat 1
    // Seat 1 declares a concealed kong of wN.
    cap.send(1, { type: 'intent', action: { type: 'kong', seat: 1, tile: 'wN', style: 'concealed' } })

    const last = [...cap.msgs].reverse().find((m) => m.type === 'view')
    expect(last?.type).toBe('view')
    if (last?.type !== 'view') throw new Error('unreachable')
    const kong = last.view.melds[1].find((m) => m.type === 'kong')
    expect(kong).toBeDefined()
    expect(kong!.concealed).toBe(true)
    expect(kong!.tiles, 'concealed kong tiles must be masked for other seats').toEqual([])
    // No wN reachable anywhere in seat 0's world.
    const wNVisible = visibleInView(last.view).get('wN') ?? 0
    expect(wNVisible).toBe(0)
    for (const msg of cap.msgs) {
      assertAllowedPaths(msg)
      assertNoForbiddenKeys(msg)
    }
    cap.runner.stop()
  })

  it('the kong owner still sees their own concealed kong tiles', () => {
    const game = craftedGame({
      handsFromDealer: [
        ['m1', 'm1', 'm2', 'm2', 'm3', 'm3', 'p6', 'p6', 'p7', 'p7', 'p8', 'p8', 'wE'],
        ['wN', 'wN', 'wN', 'wN', 'p2', 'p2', 'p3', 'p3', 'p4', 'm4', 'm4', 'm5', 'm5'],
        ['s3', 's3', 's4', 's4', 's5', 's5', 'm6', 'm6', 'm7', 'm7', 'm8', 'm8', 'wS'],
        ['s6', 's6', 's7', 's7', 's8', 's8', 'p9', 'p9', 'm9', 'm9', 'p5', 'p5', 'wW'],
      ],
      dealerExtra: 'dR',
      drawOrder: ['s9'],
    })
    const cap = captureSeat(1, { 0: HUMAN, 1: HUMAN, 2: BOT, 3: BOT }, 'kong-own', {
      ...RULES,
      flowers: false,
    }, game)
    cap.runner.start()
    cap.send(0, { type: 'intent', action: { type: 'discard', seat: 0, tile: 'dR' } })
    cap.clock.runAll()
    cap.send(1, { type: 'intent', action: { type: 'kong', seat: 1, tile: 'wN', style: 'concealed' } })

    const last = [...cap.msgs].reverse().find((m) => m.type === 'view')
    if (last?.type !== 'view') throw new Error('no view captured')
    const kong = last.view.melds[1].find((m) => m.type === 'kong')
    expect(kong!.tiles).toEqual(['wN', 'wN', 'wN', 'wN'])
    cap.runner.stop()
  })
})
