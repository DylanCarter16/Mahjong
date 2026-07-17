// Crafted-deal helpers for runner tests. createGameWithWall deals 13 tiles
// per seat in seat order from the dealer, then a 14th to the dealer — so a
// fully scripted wall gives exact control over every hand and every draw.

import { createGameWithWall, type GameState, type RuleConfig } from '../../engine/game'
import type { Seat, TileId } from '../../engine/types'

export const NO_FLOWER_RULES: RuleConfig = { faanMinimum: 0, flowers: false, faanCap: null }

/** The 136-tile set (no flowers/seasons), grouped by kind. */
export function fullSet(): TileId[] {
  const tiles: TileId[] = []
  for (const suit of ['m', 'p', 's']) {
    for (let r = 1; r <= 9; r++) {
      for (let i = 0; i < 4; i++) tiles.push(`${suit}${r}`)
    }
  }
  for (const w of ['wE', 'wS', 'wW', 'wN', 'dR', 'dG', 'dW']) {
    for (let i = 0; i < 4; i++) tiles.push(w)
  }
  return tiles
}

/**
 * Build a game with exact hands. `hands` are 13 tiles per seat in SEAT ORDER
 * FROM THE DEALER; `dealerExtra` is the dealer's 14th. `drawOrder` (optional)
 * pins the first live-wall draws; everything else follows deterministically.
 * `liveWallAfterDeal` (optional) truncates the wall so exactly that many
 * live draws remain after the deal (the dead wall stays intact).
 */
export function craftedGame(opts: {
  rules?: RuleConfig
  dealer?: Seat
  handsFromDealer: [TileId[], TileId[], TileId[], TileId[]]
  dealerExtra: TileId
  drawOrder?: TileId[]
  liveWallAfterDeal?: number
}): GameState {
  const rules = opts.rules ?? NO_FLOWER_RULES
  const dealer = opts.dealer ?? 0
  const drawOrder = opts.drawOrder ?? []
  const used = [...opts.handsFromDealer.flat(), opts.dealerExtra, ...drawOrder]

  const pool = fullSet()
  for (const t of used) {
    const i = pool.indexOf(t)
    if (i < 0) throw new Error(`craftedGame: more than four copies of ${t} requested`)
    pool.splice(i, 1)
  }
  for (const h of opts.handsFromDealer) {
    if (h.length !== 13) throw new Error('craftedGame: each hand needs exactly 13 tiles')
  }

  let rest = [...drawOrder, ...pool]
  if (opts.liveWallAfterDeal !== undefined) {
    const DEAD_WALL = 14
    const size = opts.liveWallAfterDeal + DEAD_WALL
    if (size > rest.length) throw new Error('craftedGame: not enough tiles left for that wall')
    rest = rest.slice(0, size)
  }
  const wall = [...opts.handsFromDealer.flat(), opts.dealerExtra, ...rest]
  return createGameWithWall(rules, wall, dealer, 'E')
}

/**
 * Hand-built mid-game state for robbing-the-kong scenarios: seat 1 is mid
 * turn holding the 4th p5; seat 2 either waits on p5 (p4p6 run wait) or
 * holds junk. style 'added' gives seat 1 an exposed pung of p5; 'concealed'
 * gives seat 1 all four p5 in hand.
 */
export function robKongState(opts: { style: 'added' | 'concealed'; robberCanWin: boolean }): GameState {
  const seat1Hand: TileId[] =
    opts.style === 'added'
      ? ['p5', 'm1', 'm1', 'm2', 'm2', 'm3', 'm3', 's7', 's8', 's9', 'wN']
      : ['p5', 'p5', 'p5', 'p5', 'm1', 'm1', 'm2', 'm2', 'm3', 'm3', 's7', 's8', 'wN', 'wN']
  const robber: TileId[] = opts.robberCanWin
    ? ['p4', 'p6', 'm7', 'm8', 'm9', 's1', 's2', 's3', 'wW', 'wW', 'p1', 'p2', 'p3']
    : ['p9', 'p9', 's5', 's5', 's6', 's6', 'wW', 'wW', 'dW', 'dW', 'm8', 'm8', 'wS']
  const hands: Record<Seat, TileId[]> = {
    0: ['wE', 'wE', 'm4', 'm4', 's4', 's4', 'p8', 'p8', 'dR', 'dR', 'm6', 'm6', 'dG'],
    1: seat1Hand,
    2: robber,
    3: ['m5', 'm5', 'p7', 'p7', 'wS', 'wS', 'dW', 'dW', 's5', 's6', 'dG', 'wN', 'wN'],
  }
  const melds: Record<Seat, GameState['melds'][Seat]> = {
    0: [],
    1:
      opts.style === 'added'
        ? [{ type: 'pung', tiles: ['p5', 'p5', 'p5'], concealed: false, claimedFrom: 0 }]
        : [],
    2: [],
    3: [],
  }

  const pool = fullSet()
  for (const t of [...Object.values(hands).flat(), ...melds[1].flatMap((m) => m.tiles)]) {
    const i = pool.indexOf(t)
    if (i < 0) throw new Error(`robKongState: more than four copies of ${t}`)
    pool.splice(i, 1)
  }

  return {
    config: NO_FLOWER_RULES,
    wall: pool.slice(0, 30),
    hands: structuredClone(hands),
    melds: structuredClone(melds),
    bonus: { 0: [], 1: [], 2: [], 3: [] },
    discards: { 0: [], 1: [], 2: [], 3: [] },
    turn: 1,
    phase: 'discard',
    pendingDiscard: null,
    claims: {},
    lastDraw: { seat: 1, tile: seat1Hand[0], kongReplacement: false, lastWallTile: false },
    lastClaimed: null,
    roundWind: 'E',
    seatWinds: { 0: 'E', 1: 'S', 2: 'W', 3: 'N' },
    log: [],
    result: null,
  }
}

/** A dealer hand that is a complete win the moment it is dealt (all pungs). */
export function dealerWinHand(): { hand13: TileId[]; extra: TileId } {
  return {
    hand13: ['m1', 'm1', 'm1', 'm2', 'm2', 'm2', 'm3', 'm3', 'm3', 'p1', 'p1', 'p1', 's1'],
    extra: 's1',
  }
}

/** Three quiet 13-tile hands that cannot claim much of anything. */
export function quietHands(): [TileId[], TileId[], TileId[]] {
  return [
    ['m4', 'm4', 'm5', 'm5', 'm6', 'm6', 'p2', 'p2', 'p3', 'p3', 'p4', 'p4', 'wE'],
    ['s3', 's3', 's4', 's4', 's5', 's5', 'p6', 'p6', 'p7', 'p7', 'p8', 'p8', 'wS'],
    ['m7', 'm7', 'm8', 'm8', 'm9', 'm9', 's7', 's7', 's8', 's8', 's9', 's9', 'wW'],
  ]
}
