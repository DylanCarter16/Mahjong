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
 */
export function craftedGame(opts: {
  rules?: RuleConfig
  dealer?: Seat
  handsFromDealer: [TileId[], TileId[], TileId[], TileId[]]
  dealerExtra: TileId
  drawOrder?: TileId[]
}): GameState {
  const rules = opts.rules ?? NO_FLOWER_RULES
  const dealer = opts.dealer ?? 0
  const used = [...opts.handsFromDealer.flat(), opts.dealerExtra, ...(opts.drawOrder ?? [])]

  const pool = fullSet()
  for (const t of used) {
    const i = pool.indexOf(t)
    if (i < 0) throw new Error(`craftedGame: more than four copies of ${t} requested`)
    pool.splice(i, 1)
  }
  for (const h of opts.handsFromDealer) {
    if (h.length !== 13) throw new Error('craftedGame: each hand needs exactly 13 tiles')
  }

  const wall = [...opts.handsFromDealer.flat(), opts.dealerExtra, ...(opts.drawOrder ?? []), ...pool]
  return createGameWithWall(rules, wall, dealer, 'E')
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
