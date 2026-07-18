// Position analysis primitives (Phase 1.5 §3.2). Pure and additive: these
// compose the tested shanten/usefulTiles/dangerScore primitives into the
// facts the coach proxy, beginner aids, and lesson drills all share. The
// model narrates these numbers; it never computes them.

import { dangerScore } from './bots'
import type { PlayerView } from './game'
import { shanten, usefulTiles } from './shanten'
import { isSuit, rankOf, sortTiles, suitOf } from './tiles'
import { nextSeat, SEATS, type Meld, type Seat, type Suit, type TileId } from './types'
import { isWinningHand } from './win'

export interface RankedDiscard {
  tile: TileId
  shantenAfter: number
  /** Unseen copies of every tile kind that would advance the remaining hand. */
  ukeire: number
  /** The tile kinds that would advance the hand after this discard. */
  advancing: TileId[]
  /** dangerScore per opponent seat (lower = safer). Own seat absent. */
  dangerByOpponent: Partial<Record<Seat, number>>
}

/** Copies of `kind` visible to this seat, optionally counting an extra tile. */
function visibleCopies(view: PlayerView, restHand: TileId[], kind: TileId, discarded: TileId): number {
  let n = restHand.filter((t) => t === kind).length + (kind === discarded ? 1 : 0)
  for (const seat of SEATS) {
    n += view.discards[seat].filter((t) => t === kind).length
    for (const m of view.melds[seat]) n += m.tiles.filter((t) => t === kind).length
  }
  if (view.pendingDiscard?.tile === kind) n++
  return n
}

/**
 * Every legal discard from this hand, ranked best-first (shanten ascending,
 * then ukeire descending).
 */
export function rankDiscards(view: PlayerView): RankedDiscard[] {
  const melds = view.melds[view.seat]
  const out: RankedDiscard[] = []
  for (const tile of new Set(view.concealed)) {
    const rest = [...view.concealed]
    rest.splice(rest.indexOf(tile), 1)
    const advancing = usefulTiles(rest, melds)
    const ukeire = advancing.reduce(
      (n, k) => n + Math.max(0, 4 - visibleCopies(view, rest, k, tile)),
      0,
    )
    const dangerByOpponent: Partial<Record<Seat, number>> = {}
    for (const opp of SEATS) {
      if (opp !== view.seat) dangerByOpponent[opp] = dangerScore(view, tile, opp)
    }
    out.push({ tile, shantenAfter: shanten(rest, melds), ukeire, advancing, dangerByOpponent })
  }
  out.sort((a, b) => a.shantenAfter - b.shantenAfter || b.ukeire - a.ukeire)
  return out
}

export type ClaimOption = 'win' | 'pung' | 'kong' | { chow: [TileId, TileId] }

export interface ClaimEval {
  claim: ClaimOption
  shantenBefore: number
  /** −1 means the claim wins outright. */
  shantenAfter: number
  /** True when taking the claim moves the hand closer to winning. */
  recommended: boolean
}

/**
 * What claiming the pending discard would actually do to this seat's hand —
 * the facts behind every pung/kong/chow button. Empty when nothing is
 * pending or the discard is the viewer's own.
 */
export function claimAnalysis(view: PlayerView): ClaimEval[] {
  const pd = view.pendingDiscard
  if (!pd || pd.from === view.seat) return []
  const tile = pd.tile
  const hand = view.concealed
  const melds = view.melds[view.seat]
  const before = shanten(hand, melds)
  const copies = hand.filter((t) => t === tile).length
  const out: ClaimEval[] = []

  const withMeld = (removed: TileId[], meld: Meld): number => {
    const rest = [...hand]
    for (const r of removed) rest.splice(rest.indexOf(r), 1)
    return shanten(rest, [...melds, meld])
  }

  if (isWinningHand([...hand, tile], melds)) {
    out.push({ claim: 'win', shantenBefore: before, shantenAfter: -1, recommended: true })
  }
  if (copies >= 2) {
    const after = withMeld([tile, tile], { type: 'pung', tiles: [tile, tile, tile], concealed: false })
    out.push({ claim: 'pung', shantenBefore: before, shantenAfter: after, recommended: after < before })
  }
  if (copies >= 3) {
    const after = withMeld([tile, tile, tile], {
      type: 'kong',
      tiles: [tile, tile, tile, tile],
      concealed: false,
      kongStyle: 'exposed',
    })
    out.push({ claim: 'kong', shantenBefore: before, shantenAfter: after, recommended: after < before })
  }
  if (view.seat === nextSeat(pd.from) && isSuit(tile)) {
    const r = rankOf(tile)!
    const suit = tile[0]
    const has = (n: number) => n >= 1 && n <= 9 && hand.includes(`${suit}${n}`)
    for (const [a, b] of [
      [r - 2, r - 1],
      [r - 1, r + 1],
      [r + 1, r + 2],
    ]) {
      if (!has(a) || !has(b)) continue
      const pieces: [TileId, TileId] = [`${suit}${a}`, `${suit}${b}`]
      const after = withMeld(pieces, {
        type: 'chow',
        tiles: sortTiles([...pieces, tile]),
        concealed: false,
      })
      out.push({ claim: { chow: pieces }, shantenBefore: before, shantenAfter: after, recommended: after < before })
    }
  }
  out.sort((a, b) => a.shantenAfter - b.shantenAfter)
  return out
}

export interface OpponentRead {
  seat: Seat
  suitDiscards: Record<Suit, number>
  /** Suits this opponent is plausibly collecting (they discard them rarely). */
  likelyCollecting: Suit[]
  /** 0 quiet … 3 loud: exposed melds + few discards + late wall. */
  threat: 0 | 1 | 2 | 3
  /** Tile kinds that are known-safe against this opponent. */
  safeTiles: TileId[]
  exposedMelds: number
}

const SUITS: Suit[] = ['m', 'p', 's']

/** What each opponent's visible information says about their hand. */
export function readOpponents(view: PlayerView): OpponentRead[] {
  const out: OpponentRead[] = []
  for (const seat of SEATS) {
    if (seat === view.seat) continue
    const discards = view.discards[seat]
    const suitDiscards: Record<Suit, number> = { m: 0, p: 0, s: 0 }
    for (const t of discards) {
      const s = suitOf(t)
      if (s) suitDiscards[s]++
    }
    const evidence = suitDiscards.m + suitDiscards.p + suitDiscards.s
    const minCount = Math.min(...SUITS.map((s) => suitDiscards[s]))
    // A player rarely throws the suit they are collecting; require a few suit
    // discards before claiming a read.
    const likelyCollecting =
      evidence >= 4 ? SUITS.filter((s) => suitDiscards[s] <= Math.max(1, minCount)) : []

    const exposedMelds = view.melds[seat].filter((m) => !m.concealed).length
    const threat = (
      exposedMelds < 2
        ? 0
        : 1 + (discards.length < 10 ? 1 : 0) + (view.wallCount < 30 ? 1 : 0)
    ) as 0 | 1 | 2 | 3

    const safeTiles = [...new Set(discards)].filter((t) => dangerScore(view, t, seat) === 0)
    out.push({ seat, suitDiscards, likelyCollecting, threat, safeTiles, exposedMelds })
  }
  return out
}
