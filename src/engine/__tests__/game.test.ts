import { describe, expect, it } from 'vitest'
import { hand } from '../tiles'
import type { Seat, TileId } from '../types'
import {
  applyAction,
  createGame,
  createGameWithWall,
  legalActions,
  playerView,
  type Action,
  type GameState,
  type RuleConfig,
} from '../game'

const cfg = (over: Partial<RuleConfig> = {}): RuleConfig => ({
  faanMinimum: 0,
  flowers: false,
  faanCap: null,
  ...over,
})

/**
 * Rigged wall builder. Deal order is documented in game.ts: 13 tiles to each
 * seat starting with the dealer (seat 0 here), then a 14th to the dealer.
 * Test walls are synthetic — createGameWithWall does not validate the multiset.
 */
function rig(opts: {
  h0: string // dealer's first 13
  h1: string
  h2: string
  h3: string
  extra: string // dealer's 14th tile
  draws?: string // subsequent live draws, in order
  back?: string // tiles at the very back (replacement draws pop from here, last first)
  deadPad?: number
}): TileId[] {
  const pad = Array.from({ length: opts.deadPad ?? 18 }, () => 'p1')
  const back = opts.back ? hand(opts.back) : []
  // keep the pad so the dead wall stays >= 14 even with `back` popped off
  return [
    ...opts.h0.split(' '),
    ...opts.h1.split(' '),
    ...opts.h2.split(' '),
    ...opts.h3.split(' '),
    opts.extra,
    ...(opts.draws ? opts.draws.split(' ') : []),
    ...pad,
    ...back.reverse(), // back[0] is the first replacement drawn
  ]
}

const TENPAI_DR = 'm1 m2 m3 p4 p5 p6 s7 s8 s9 wE wE wE dR'
const JUNK_A = 'm5 m5 s2 s3 p8 p9 wN wS wW m8 m9 s6 s4'
const JUNK_B = 'm6 m7 p7 s1 s3 s4 wN wS wW m4 p3 p5 p8'
const JUNK_C = 's5 s6 p2 p4 m4 m6 wN wS wW m7 p7 s1 s2'

describe('claimed win', () => {
  const wall = rig({ h0: JUNK_A, h1: TENPAI_DR, h2: JUNK_B, h3: JUNK_C, extra: 'dR' })

  it('resolves a win claim on a discard', () => {
    let s = createGameWithWall(cfg(), wall)
    expect(s.phase).toBe('discard')
    expect(s.turn).toBe(0)
    s = applyAction(s, { type: 'discard', seat: 0, tile: 'dR' })
    expect(s.phase).toBe('claims')
    const legal = legalActions(s, 1)
    expect(legal.some((a) => a.type === 'claim' && a.claim === 'win')).toBe(true)
    s = applyAction(s, { type: 'claim', seat: 1, claim: 'win' })
    expect(s.phase).toBe('finished')
    expect(s.result).toMatchObject({ kind: 'win', winner: 1, loser: 0, selfDraw: false })
    // wE pung under an East round wind: 1 faan, allowed at 0 minimum
    expect(s.result!.fan!.totalFaan).toBe(1)
    expect(s.result!.fan!.patterns).toEqual([{ name: 'Round Wind', faan: 1 }])
    expect(s.log.length).toBe(2)
  })

  it('blocks the same win under a 3-faan minimum (auto-passes the claim window)', () => {
    let s = createGameWithWall(cfg({ faanMinimum: 3 }), wall)
    s = applyAction(s, { type: 'discard', seat: 0, tile: 'dR' })
    // seat 1's hand is complete but under the minimum: no claim is offered,
    // so nobody is eligible and the discard resolves straight through.
    expect(s.phase).toBe('draw')
    expect(s.turn).toBe(1)
  })
})

describe('self-draw win', () => {
  it('wins on the drawn tile', () => {
    const wall = rig({ h0: JUNK_A, h1: TENPAI_DR, h2: JUNK_B, h3: JUNK_C, extra: 'p2', draws: 'dR' })
    let s = createGameWithWall(cfg(), wall)
    s = applyAction(s, { type: 'discard', seat: 0, tile: 'p2' }) // nobody can claim
    expect(s.phase).toBe('draw')
    s = applyAction(s, { type: 'draw', seat: 1 })
    const legal = legalActions(s, 1)
    expect(legal.some((a) => a.type === 'declareWin')).toBe(true)
    s = applyAction(s, { type: 'declareWin', seat: 1 })
    expect(s.result).toMatchObject({ kind: 'win', winner: 1, selfDraw: true })
    expect(s.result!.fan!.patterns).toContainEqual({ name: 'Self-draw', faan: 1 })
  })
})

describe('wall exhaustion', () => {
  it('ends the round in a draw when the live wall is empty', () => {
    // 53 deal tiles + exactly 14 dead tiles: zero live draws remain.
    const wall = rig({ h0: JUNK_A, h1: TENPAI_DR, h2: JUNK_B, h3: JUNK_C, extra: 'p2', deadPad: 14 })
    expect(wall).toHaveLength(67)
    let s = createGameWithWall(cfg(), wall)
    s = applyAction(s, { type: 'discard', seat: 0, tile: 'p2' })
    expect(s.phase).toBe('finished')
    expect(s.result).toEqual({ kind: 'draw' })
  })
})

describe('claim priority', () => {
  it('resolves a double win in seat order from the discarder', () => {
    const h2 = 'm1 m2 m3 p4 p5 p6 s7 s8 s9 wS wS wS dR'
    const h3 = 'm4 m5 m6 p1 p2 p3 s1 s2 s3 wW wW wW dR'
    const wall = rig({ h0: JUNK_A, h1: JUNK_B, h2, h3, extra: 'dR' })
    let s = createGameWithWall(cfg(), wall)
    s = applyAction(s, { type: 'discard', seat: 0, tile: 'dR' })
    expect(legalActions(s, 2).some((a) => a.type === 'claim' && a.claim === 'win')).toBe(true)
    expect(legalActions(s, 3).some((a) => a.type === 'claim' && a.claim === 'win')).toBe(true)
    s = applyAction(s, { type: 'claim', seat: 3, claim: 'win' })
    expect(s.phase).toBe('claims') // waits for every eligible seat
    s = applyAction(s, { type: 'claim', seat: 2, claim: 'win' })
    expect(s.result).toMatchObject({ kind: 'win', winner: 2, loser: 0 }) // seat 2 is closer
  })

  it('win beats pung on the same discard', () => {
    const h2 = 'm1 m2 m3 p4 p5 p6 s7 s8 s9 wS wS wS dR' // wins on dR
    const h3 = 'm4 m5 m6 p1 p2 p3 s1 s2 s4 wW wW dR dR' // could pung dR (s1s2s4 keeps it from winning)
    const wall = rig({ h0: JUNK_A, h1: JUNK_B, h2, h3, extra: 'dR' })
    let s = createGameWithWall(cfg(), wall)
    s = applyAction(s, { type: 'discard', seat: 0, tile: 'dR' })
    s = applyAction(s, { type: 'claim', seat: 3, claim: 'pung' })
    s = applyAction(s, { type: 'claim', seat: 2, claim: 'win' })
    expect(s.result).toMatchObject({ kind: 'win', winner: 2 })
  })

  it('pung beats chow, even when the chow is from the nearer seat (§5.1)', () => {
    // Regression: a chow is only ever claimable by the seat right after the
    // discarder, so if the meld selector went purely by seat order a chow
    // would always beat a farther seat's pung. It must not.
    const h1 = 'p4 p6 m1 m4 m7 s1 s4 s7 wN wW dR dG dW' // seat 1 can chow p5
    const h2 = 'p5 p5 m2 m5 m8 s2 s5 s8 wN wW dR dG dW' // seat 2 can pung p5
    const h3 = 'm3 m6 m9 s3 s6 s9 p1 p2 p3 p7 p8 p9 dW' // no claim on p5
    const wall = rig({ h0: JUNK_A, h1, h2, h3, extra: 'p5' })
    let s = createGameWithWall(cfg(), wall)
    s = applyAction(s, { type: 'discard', seat: 0, tile: 'p5' })
    expect(legalActions(s, 1).some((a) => a.type === 'claim' && typeof a.claim === 'object')).toBe(true)
    expect(legalActions(s, 2).some((a) => a.type === 'claim' && a.claim === 'pung')).toBe(true)
    // Chow arrives FIRST and from the nearer seat; pung arrives after.
    s = applyAction(s, { type: 'claim', seat: 1, claim: { chow: ['p4', 'p6'] } })
    expect(s.phase).toBe('claims') // still collecting — never resolve on arrival
    s = applyAction(s, { type: 'claim', seat: 2, claim: 'pung' })
    expect(s.turn).toBe(2)
    expect(s.melds[2][0]).toMatchObject({ type: 'pung', tiles: ['p5', 'p5', 'p5'] })
    expect(s.melds[1]).toHaveLength(0) // chow rejected by priority
  })
})

// Robbing the kong (搶槓, §5.3) — added new in Phase 2; Phase 1 did not
// implement it (README assumptions list). Builds the pre-added-kong position
// directly: seat 1 holds an exposed pung of p5 plus the 4th p5 and it is
// seat 1's turn.
function robKongPosition(seat2Hand: string): GameState {
  const wall = rig({ h0: JUNK_A, h1: JUNK_B, h2: JUNK_C, h3: JUNK_A, extra: 'p1' })
  const s = createGameWithWall(cfg(), wall)
  s.melds[1] = [{ type: 'pung', tiles: ['p5', 'p5', 'p5'], concealed: false, claimedFrom: 0 }]
  s.hands[1] = hand('p5 m1 m4 m7 s1 s4 s7 wN wW dG')
  s.hands[2] = hand(seat2Hand)
  s.turn = 1
  s.phase = 'discard'
  s.pendingDiscard = null
  s.claims = {}
  s.lastDraw = { seat: 1, tile: 'm1', kongReplacement: false, lastWallTile: false }
  return s
}

describe('robbing the kong (§5.3)', () => {
  it('an added kong opens a win-only window and a waiting seat robs it', () => {
    // seat 2 is tenpai on p5 (p4 p6 + four complete groups worth of shape).
    let s = robKongPosition('p4 p6 m1 m2 m3 s7 s8 s9 p1 p2 p3 wW wW')
    const kong = legalActions(s, 1).find((a) => a.type === 'kong' && a.style === 'added')
    expect(kong).toBeDefined()
    s = applyAction(s, kong as Action)

    // The window is win-only, and it belongs to the seats that can rob.
    expect(s.phase).toBe('claims')
    expect(s.pendingDiscard).toMatchObject({ tile: 'p5', from: 1, robKong: true })
    const claims2 = legalActions(s, 2).filter((a) => a.type === 'claim')
    expect(claims2).toHaveLength(1)
    expect(claims2[0]).toMatchObject({ type: 'claim', claim: 'win' })

    s = applyAction(s, { type: 'claim', seat: 2, claim: 'win' })
    // The konger is the discarder for scoring; the kong never formed.
    expect(s.result).toMatchObject({ kind: 'win', winner: 2, loser: 1 })
    expect(s.melds[1][0].type).toBe('pung')
  })

  it('an added kong with no eligible robber completes and draws a replacement', () => {
    let s = robKongPosition('m5 m6 m7 s2 s3 s4 wN wS dW dW dG dG p8') // cannot win on p5
    const kong = legalActions(s, 1).find((a) => a.type === 'kong' && a.style === 'added')
    s = applyAction(s, kong as Action)
    // Resolved synchronously: no human is owed a window when nobody can rob.
    expect(s.phase).toBe('discard')
    expect(s.turn).toBe(1)
    expect(s.melds[1][0]).toMatchObject({ type: 'kong', kongStyle: 'added', tiles: ['p5', 'p5', 'p5', 'p5'] })
    expect(s.lastDraw).toMatchObject({ seat: 1, kongReplacement: true })
  })

  it('a concealed kong is not robbable — it never opens a window', () => {
    const wall = rig({
      h0: 's5 s5 s5 s5 m1 m4 m7 wN wW dG p7 p8 p9',
      h1: JUNK_B,
      h2: JUNK_C,
      h3: JUNK_A,
      extra: 'p1',
      back: 'm2',
    })
    let s = createGameWithWall(cfg(), wall)
    const kong = legalActions(s, 0).find((a) => a.type === 'kong' && a.style === 'concealed')
    expect(kong).toBeDefined()
    s = applyAction(s, kong as Action)
    expect(s.phase).toBe('discard') // straight to discard: no claims phase at all
    expect(s.turn).toBe(0)
    expect(s.melds[0][0]).toMatchObject({ type: 'kong', concealed: true })
  })
})

describe('chow claims', () => {
  it('only the seat to the discarder’s right may chow', () => {
    const h1 = 'm2 m3 p7 p9 s1 s4 wN wS wW m8 m9 s5 s6' // m2 m3 chow m4
    const h2 = 'm5 m6 p2 p4 s2 s3 wN wS wW p6 p8 s8 s9' // m5 m6 would chow m4 but is not next
    const wall = rig({ h0: JUNK_A, h1, h2, h3: JUNK_C, extra: 'm4' })
    let s = createGameWithWall(cfg(), wall)
    s = applyAction(s, { type: 'discard', seat: 0, tile: 'm4' })
    expect(s.phase).toBe('claims')
    const chow1 = legalActions(s, 1).filter((a) => a.type === 'claim' && typeof a.claim === 'object')
    expect(chow1).toHaveLength(1)
    expect(legalActions(s, 2)).toEqual([])
    s = applyAction(s, chow1[0] as Action)
    expect(s.melds[1]).toHaveLength(1)
    expect(s.melds[1][0]).toMatchObject({ type: 'chow', tiles: ['m2', 'm3', 'm4'], concealed: false })
    expect(s.turn).toBe(1)
    expect(s.phase).toBe('discard')
    expect(s.hands[1]).toHaveLength(11)
  })
})

describe('kongs and bonus tiles', () => {
  it('replaces bonus tiles at deal from the back of the wall', () => {
    const h0 = 'bf1 m5 m5 s2 s3 p8 p9 wN wS wW m8 m9 s6'
    const wall = rig({ h0, h1: TENPAI_DR, h2: JUNK_B, h3: JUNK_C, extra: 'p2', back: 'm7' })
    const s = createGameWithWall(cfg({ flowers: true }), wall)
    expect(s.bonus[0]).toEqual(['bf1'])
    expect(s.hands[0]).toContain('m7')
    expect(s.hands[0]).toHaveLength(14)
  })

  it('concealed kong draws a replacement and can win off it', () => {
    const h0 = 's5 s5 s5 s5 m1 m2 m3 p4 p5 p6 s7 s8 s9'
    const wall = rig({ h0, h1: JUNK_B, h2: JUNK_C, h3: JUNK_A, extra: 'wE', back: 'wE' })
    let s = createGameWithWall(cfg(), wall)
    const wallBefore = s.wall.length
    const kong = legalActions(s, 0).find((a) => a.type === 'kong')
    expect(kong).toMatchObject({ type: 'kong', seat: 0, tile: 's5', style: 'concealed' })
    s = applyAction(s, kong as Action)
    expect(s.melds[0][0]).toMatchObject({ type: 'kong', concealed: true, kongStyle: 'concealed' })
    expect(s.wall.length).toBe(wallBefore - 1) // replacement came off the back
    expect(s.phase).toBe('discard')
    // replacement wE pairs the wE already in hand: 3 chows + kong + pair
    s = applyAction(s, { type: 'declareWin', seat: 0 })
    expect(s.result!.fan!.patterns.map((p) => p.name)).toContain('Kong Replacement')
    expect(s.result!.selfDraw).toBe(true)
  })
})

describe('information boundary and hygiene', () => {
  const wall = rig({ h0: JUNK_A, h1: TENPAI_DR, h2: JUNK_B, h3: JUNK_C, extra: 'dR' })

  it('playerView never leaks hidden information', () => {
    const s = createGameWithWall(cfg(), wall)
    const v = playerView(s, 1)
    expect(v.concealed).toEqual(hand(TENPAI_DR))
    expect((v as unknown as Record<string, unknown>).hands).toBeUndefined()
    expect((v as unknown as Record<string, unknown>).wall).toBeUndefined()
    expect(v.wallCount).toBe(s.wall.length - 14)
    expect(v.legal).toEqual([])
  })

  it('hides the tiles of another seat’s concealed kong', () => {
    const h0 = 's5 s5 s5 s5 m1 m2 m3 p4 p5 p6 s7 s8 s9'
    const kw = rig({ h0, h1: JUNK_B, h2: JUNK_C, h3: JUNK_A, extra: 'wE', back: 'wE' })
    let s = createGameWithWall(cfg(), kw)
    s = applyAction(s, { type: 'kong', seat: 0, tile: 's5', style: 'concealed' })
    expect(playerView(s, 1).melds[0][0]).toMatchObject({ type: 'kong', tiles: [] })
    expect(playerView(s, 0).melds[0][0].tiles).toHaveLength(4)
  })

  it('state survives a JSON round-trip', () => {
    const s = createGame(cfg({ flowers: true }), 'round-trip-seed')
    expect(JSON.parse(JSON.stringify(s))).toEqual(s)
  })

  it('rejects illegal actions loudly', () => {
    const s = createGameWithWall(cfg(), wall)
    expect(() => applyAction(s, { type: 'discard', seat: 2, tile: 'm6' })).toThrow()
    expect(() => applyAction(s, { type: 'discard', seat: 0, tile: 'dW' })).toThrow()
    expect(() => applyAction(s, { type: 'draw', seat: 0 })).toThrow()
  })

  it('logs every applied action', () => {
    let s = createGameWithWall(cfg(), wall)
    s = applyAction(s, { type: 'discard', seat: 0, tile: 'dR' })
    s = applyAction(s, { type: 'claim', seat: 1, claim: 'win' })
    expect(s.log).toEqual([
      { type: 'discard', seat: 0, tile: 'dR' },
      { type: 'claim', seat: 1, claim: 'win' },
    ])
  })
})

describe('seeded games', () => {
  it('same seed produces identical games; hands are dealt correctly', () => {
    const a = createGame(cfg({ flowers: true }), 'seed-1')
    const b = createGame(cfg({ flowers: true }), 'seed-1')
    expect(a).toEqual(b)
    expect(a.hands[0].length).toBe(14)
    for (const seat of [1, 2, 3] as Seat[]) expect(a.hands[seat]).toHaveLength(13)
    expect(a.hands[0].some((t) => t.startsWith('b'))).toBe(false) // bonus auto-replaced
    expect(a.seatWinds).toEqual({ 0: 'E', 1: 'S', 2: 'W', 3: 'N' })
  })
})
