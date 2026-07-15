// Bot policies. Pure functions over PlayerView — a bot can never see another
// seat's concealed tiles or the wall order, because the view type simply does
// not carry them. This is the same information boundary the Phase 2 server
// will enforce per client.
//
// Honesty note: "advanced" is strong-heuristic play (shanten efficiency plus
// discard reading, safety estimation and push/fold), not search and nothing
// close to superhuman. It should beat a beginner and lose to a good club
// player.

import type { Action, ClaimKind, PlayerView } from './game'
import type { Rng } from './rng'
import { isHonour, isSuit, isTerminal, rankOf, suitOf } from './tiles'
import { SEATS, type Meld, type Seat, type TileId } from './types'
import { shanten, usefulTiles } from './shanten'

export type Difficulty = 'easy' | 'intermediate' | 'advanced'

const discardsIn = (legal: Action[]) =>
  legal.filter((a): a is Action & { type: 'discard' } => a.type === 'discard')

const claimsIn = (legal: Action[]) =>
  legal.filter((a): a is Action & { type: 'claim' } => a.type === 'claim')

function copiesInHand(hand: TileId[], tile: TileId): number {
  return hand.filter((t) => t === tile).length
}

function isIsolated(hand: TileId[], tile: TileId): boolean {
  if (copiesInHand(hand, tile) > 1) return false
  if (isHonour(tile)) return true
  const suit = suitOf(tile)!
  const r = rankOf(tile)!
  return !hand.some(
    (t) => t !== tile && suitOf(t) === suit && Math.abs(rankOf(t)! - r) <= 2,
  )
}

/** Copies of a kind visible to this seat (hand, discards, exposed melds, pending). */
function visibleCopies(view: PlayerView, kind: TileId): number {
  let n = copiesInHand(view.concealed, kind)
  for (const seat of SEATS) {
    n += view.discards[seat].filter((t) => t === kind).length
    for (const m of view.melds[seat]) n += m.tiles.filter((t) => t === kind).length
  }
  if (view.pendingDiscard?.tile === kind) n++
  return n
}

/** Sum of unseen copies of every tile kind that would advance this hand. */
function liveUsefulCount(view: PlayerView, concealed: TileId[], melds: Meld[]): number {
  let total = 0
  for (const kind of usefulTiles(concealed, melds)) {
    total += Math.max(0, 4 - visibleCopies(view, kind))
  }
  return total
}

// ---------------------------------------------------------------- easy ----

function easyDiscard(view: PlayerView, candidates: TileId[]): TileId {
  const hand = view.concealed
  const rank = (t: TileId): number => {
    if (isHonour(t) && copiesInHand(hand, t) === 1) return 0
    if (isTerminal(t) && isIsolated(hand, t)) return 1
    if (isSuit(t) && isIsolated(hand, t)) return 2
    return 3
  }
  let best = candidates[0]
  let bestRank = rank(best)
  for (const c of candidates) {
    const r = rank(c)
    // <= so ties fall to the rightmost (highest-sorted) tile
    if (r <= bestRank) {
      best = c
      bestRank = r
    }
  }
  return best
}

// ------------------------------------------------- intermediate helpers ----

interface DiscardEval {
  tile: TileId
  shantenAfter: number
}

function evalDiscards(view: PlayerView, candidates: TileId[]): DiscardEval[] {
  const melds = view.melds[view.seat]
  return candidates.map((tile) => {
    const rest = [...view.concealed]
    rest.splice(rest.indexOf(tile), 1)
    return { tile, shantenAfter: shanten(rest, melds) }
  })
}

function efficientDiscard(view: PlayerView, candidates: TileId[]): TileId {
  const evals = evalDiscards(view, candidates)
  const minSh = Math.min(...evals.map((e) => e.shantenAfter))
  let pool = evals.filter((e) => e.shantenAfter === minSh).map((e) => e.tile)
  // Light defence: avoid feeding the kind that was just claimed.
  if (view.lastClaimed && pool.length > 1) {
    const safer = pool.filter((t) => t !== view.lastClaimed)
    if (safer.length > 0) pool = safer
  }
  if (pool.length === 1) return pool[0]
  const melds = view.melds[view.seat]
  let best = pool[0]
  let bestLive = -1
  for (const tile of pool) {
    const rest = [...view.concealed]
    rest.splice(rest.indexOf(tile), 1)
    const liveCount = liveUsefulCount(view, rest, melds)
    if (liveCount > bestLive) {
      best = tile
      bestLive = liveCount
    }
  }
  return best
}

/** Does taking this claim actually move the hand closer to winning? */
function claimReducesShanten(view: PlayerView, claim: ClaimKind): boolean {
  if (claim === 'win') return true
  const tile = view.pendingDiscard!.tile
  const melds = view.melds[view.seat]
  const before = shanten(view.concealed, melds)
  const rest = [...view.concealed]
  let newMeld: Meld
  if (claim === 'pung' || claim === 'kong') {
    const n = claim === 'pung' ? 2 : 3
    for (let i = 0; i < n; i++) rest.splice(rest.indexOf(tile), 1)
    newMeld = { type: claim, tiles: Array(n + 1).fill(tile), concealed: false }
  } else {
    for (const t of claim.chow) rest.splice(rest.indexOf(t), 1)
    newMeld = { type: 'chow', tiles: [...claim.chow, tile], concealed: false }
  }
  return shanten(rest, [...melds, newMeld]) < before
}

// ----------------------------------------------------- advanced helpers ----

function threatScore(view: PlayerView, opp: Seat): number {
  const exposed = view.melds[opp].filter((m) => !m.concealed).length
  if (exposed < 2) return 0
  return (
    exposed * 2 +
    (view.discards[opp].length < 10 ? 1 : 0) +
    (view.wallCount < 30 ? 1 : 0)
  )
}

/**
 * Lower is safer against the given opponent. Exported for the defence lesson
 * and the discard-reading quiz, so drills grade with the same model the
 * advanced bot plays by.
 */
export function dangerScore(view: PlayerView, tile: TileId, opp: Seat): number {
  const oppDiscards = view.discards[opp]
  if (oppDiscards.includes(tile)) return 0 // they discarded it: safe against them
  if (isHonour(tile)) return visibleCopies(view, tile) >= 3 ? 1 : 4
  const suit = suitOf(tile)!
  const r = rankOf(tile)!
  const sameSuit = oppDiscards.filter((t) => suitOf(t) === suit)
  if (sameSuit.some((t) => Math.abs(rankOf(t)! - r) <= 1)) return 2
  if (sameSuit.length >= 3) return 3 // they are clearly not collecting this suit
  return 5 + (r >= 4 && r <= 6 ? 1 : 0) // middle tiles connect to the most waits
}

// ------------------------------------------------------------- the policy --

export function botAction(view: PlayerView, difficulty: Difficulty, rng: Rng): Action {
  const legal = view.legal
  if (legal.length === 0) throw new Error('botAction called with no legal actions')

  // Universal: take a win whenever one is on the table.
  const win = legal.find(
    (a) => a.type === 'declareWin' || (a.type === 'claim' && a.claim === 'win'),
  )
  if (win) return win
  if (view.phase === 'draw') return legal[0]

  if (view.phase === 'claims') {
    const pass = legal.find((a) => a.type === 'pass')!
    const claims = claimsIn(legal)
    if (difficulty === 'easy') {
      return claims.length > 0 && rng.next() < 0.15 ? claims[0] : pass
    }
    const good = claims.find((c) => claimReducesShanten(view, c.claim))
    return good ?? pass
  }

  // Discard phase.
  const discards = discardsIn(legal)
  const candidates = discards.map((d) => d.tile)
  const pick = (tile: TileId): Action => discards.find((d) => d.tile === tile)!

  if (difficulty === 'easy') return pick(easyDiscard(view, candidates))

  // Declare a kong when it costs nothing (shanten does not get worse).
  const kongs = legal.filter((a): a is Action & { type: 'kong' } => a.type === 'kong')
  if (kongs.length > 0) {
    const melds = view.melds[view.seat]
    const currentBest = Math.min(...evalDiscards(view, candidates).map((e) => e.shantenAfter))
    for (const k of kongs) {
      const rest = [...view.concealed]
      const n = k.style === 'concealed' ? 4 : 1
      for (let i = 0; i < n; i++) rest.splice(rest.indexOf(k.tile), 1)
      const meld: Meld = { type: 'kong', tiles: Array(4).fill(k.tile), concealed: k.style === 'concealed' }
      if (shanten(rest, [...melds, meld]) <= currentBest) return k
    }
  }

  if (difficulty === 'advanced') {
    const threats = SEATS.filter((o) => o !== view.seat).map((o) => ({ o, score: threatScore(view, o) }))
    const top = threats.reduce((a, b) => (b.score > a.score ? b : a))
    const evals = evalDiscards(view, candidates)
    const ownShanten = Math.min(...evals.map((e) => e.shantenAfter))
    // Push/fold: hand still far from ready against a loud board -> bail out.
    if (top.score >= 6 && ownShanten >= 1) {
      let safest = candidates[0]
      let bestDanger = Infinity
      for (const tile of candidates) {
        const d = dangerScore(view, tile, top.o)
        if (d < bestDanger) {
          safest = tile
          bestDanger = d
        }
      }
      return pick(safest)
    }
  }

  return pick(efficientDiscard(view, candidates))
}
