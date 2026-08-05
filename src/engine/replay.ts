// Rebuild the visible table at any point in a finished round's action log.
//
// WHY THIS EXISTS RATHER THAN REUSING THE TRAINER'S REPLAY
// The discard-reading trainer replays a game it generated itself, so it owns
// the seed and can call createGame() + applyAction() to get real GameStates. A
// REAL round gives the client two things and no more: the action log and the
// result. It never gets the seed — protocol.ts forbids it and the leak test
// enforces it — so the wall cannot be rebuilt, and `applyAction` needs a wall.
//
// It doesn't matter, because the wall is not what a review needs. Everything a
// player must SEE to understand a moment is public information that the log
// records exactly:
//
//   - every discard pool, in the order the tiles hit the table
//   - every exposed meld, with the tiles that formed it
//   - who was to act, and which tile was in flight
//
// What the log genuinely cannot give is anyone's CONCEALED hand: a `draw`
// action records the seat but not the tile (by design — that's hidden
// information). So your own hand is not reconstructed here; it is captured from
// the view stream the client already receives every turn and passed in
// alongside. See ReviewSnapshot in review.ts.
//
// Pure, no React, no engine mutation — a fold over the log.

import { sortTiles } from './tiles'
import { nextSeat, SEATS, type Meld, type Seat, type TileId } from './types'
import type { Action, ClaimKind } from './game'

/** The visible table immediately AFTER `index` actions have been applied. */
export interface ReplayBoard {
  /** Number of actions applied to reach this board. */
  index: number
  /** Each seat's discard pool, in the order the tiles landed. */
  discards: Record<Seat, TileId[]>
  /** Each seat's exposed melds (plus concealed kongs, which are public). */
  melds: Record<Seat, Meld[]>
  /** The tile in flight — discarded or added-kong'd, not yet resolved. */
  pending: { tile: TileId; from: Seat; robKong?: true } | null
  /** Seat whose action comes next, as far as the log shows. */
  toAct: Seat
  /** Wall draws taken so far, including kong replacements. */
  draws: number
  /** How many tiles each seat holds concealed. */
  handCounts: Record<Seat, number>
  /** Seat currently holding a 14th tile (mid-turn), if any. */
  holding: Seat | null
  /** True once the log has run out of actions and the round is over. */
  finished: boolean
}

const emptyBySeat = <T>(make: () => T): Record<Seat, T> =>
  ({ 0: make(), 1: make(), 2: make(), 3: make() }) as Record<Seat, T>

/**
 * Live wall tiles at the deal: 144 total − 14 dead wall − 53 dealt (13 each,
 * plus the dealer's 14th). Bonus-tile replacements at the deal are invisible to
 * the log, so a board's wall count is DERIVED and can drift by the number of
 * flowers drawn. Callers that captured the real `view.wallCount` should prefer
 * it; this is the fallback when no snapshot covers the turn.
 */
export const LIVE_WALL_AT_DEAL = 144 - 14 - 53

function meldFromClaim(claim: ClaimKind, tile: TileId, from: Seat): Meld | null {
  if (claim === 'win') return null // completes the hand; no meld is exposed
  if (claim === 'pung') {
    return { type: 'pung', tiles: [tile, tile, tile], concealed: false, claimedFrom: from }
  }
  if (claim === 'kong') {
    return {
      type: 'kong',
      tiles: [tile, tile, tile, tile],
      concealed: false,
      kongStyle: 'exposed',
      claimedFrom: from,
    }
  }
  return { type: 'chow', tiles: sortTiles([...claim.chow, tile]), concealed: false, claimedFrom: from }
}

/**
 * Fold the log into the board after `upTo` actions (clamped to the log).
 *
 * Two things here are subtler than they look, and both are pinned by
 * replay.test.ts playing real games and diffing every single action index.
 *
 * WHEN A CLAIM WINDOW CLOSES. The reducer resolves the instant every ELIGIBLE
 * seat has answered — and eligibility depends on concealed hands, which the log
 * doesn't carry. So "count the passes" cannot work, and the window may close
 * with no `pass` logged at all (nobody could claim) or on the claim itself. The
 * rule that reproduces the reducer using only the log: the window is over once
 * the NEXT logged action is neither a pass nor a claim. Looking one action
 * ahead is legitimate even at the requested boundary — "had this resolved yet?"
 * is answered by what came next, and the whole log is in hand.
 *
 * WHO WINS A CONTESTED TILE. Claims are buffered, never applied on sight,
 * because the log's ORDER is not the priority order: a win beats everything, a
 * pung/kong beats a chow logged before it, and ties go to the nearest seat
 * counter-clockwise from the discarder (§5.1/§5.3). Applying the first claim in
 * the log silently hands melds to the wrong seat.
 */
export function replayTo(log: readonly Action[], upTo: number): ReplayBoard {
  const end = Math.max(0, Math.min(upTo, log.length))
  const discards = emptyBySeat<TileId[]>(() => [])
  const melds = emptyBySeat<Meld[]>(() => [])
  let pending: ReplayBoard['pending'] = null
  let claims: Partial<Record<Seat, ClaimKind>> = {}
  // The dealer opens the round holding 14 tiles, so the first logged action is
  // theirs — that's the only place the log names the dealer.
  let toAct: Seat = log[0]?.seat ?? 0
  let holding: Seat | null = log[0]?.seat ?? null
  let draws = 0
  let won = false

  /** Close the claim window the reducer's way: priority, then seat order. */
  const resolve = () => {
    if (!pending) return
    const { tile, from, robKong } = pending
    const order: Seat[] = [1, 2, 3].map((i) => ((from + i) % 4) as Seat)

    const winner = order.find((s) => claims[s] === 'win')
    if (winner !== undefined) {
      // The winning tile joins the winner's hand; it never enters a pool.
      pending = null
      claims = {}
      toAct = winner
      holding = winner
      won = true
      return
    }

    if (robKong) {
      // Nobody robbed it: the added kong completes on the seat's own pung.
      const pung = melds[from].find((m) => m.type === 'pung' && m.tiles[0] === tile)
      if (pung) {
        pung.type = 'kong'
        pung.tiles = [tile, tile, tile, tile]
        pung.kongStyle = 'added'
      }
      draws++ // replacement draw
      pending = null
      claims = {}
      toAct = from
      holding = from
      return
    }

    const melder =
      order.find((s) => claims[s] === 'pung' || claims[s] === 'kong') ??
      order.find((s) => typeof claims[s] === 'object' && claims[s] !== null)

    if (melder !== undefined) {
      const m = meldFromClaim(claims[melder]!, tile, from)
      if (m) melds[melder].push(m)
      if (claims[melder] === 'kong') draws++ // replacement draw
      pending = null
      claims = {}
      toAct = melder
      holding = melder
      return
    }

    discards[from].push(tile)
    pending = null
    claims = {}
    toAct = nextSeat(from)
    holding = null
  }

  for (let i = 0; i < end; i++) {
    const a = log[i]

    switch (a.type) {
      case 'draw':
        draws++
        toAct = a.seat
        holding = a.seat
        break
      case 'discard':
        pending = { tile: a.tile, from: a.seat }
        claims = {}
        toAct = nextSeat(a.seat)
        holding = null
        break
      case 'pass':
        // A pass is a response, not a claim: it only matters in that it may be
        // the answer that closes the window, which the lookahead below sees.
        break
      case 'claim':
        claims[a.seat] = a.claim
        break
      case 'kong':
        if (a.style === 'concealed') {
          melds[a.seat].push({
            type: 'kong',
            tiles: [a.tile, a.tile, a.tile, a.tile],
            concealed: true,
            kongStyle: 'concealed',
          })
          draws++ // replacement draw
          toAct = a.seat
          holding = a.seat
        } else {
          // Robbable: it sits in flight until the win-only window closes.
          pending = { tile: a.tile, from: a.seat, robKong: true }
          claims = {}
          holding = null
        }
        break
      case 'declareWin':
        toAct = a.seat
        holding = a.seat
        won = true
        break
    }

    const next = log[i + 1]
    if (pending && (next === undefined || (next.type !== 'pass' && next.type !== 'claim'))) resolve()
  }

  // Between turns a seat holds 13 tiles minus 3 for every exposed set (an
  // exposed kong's 4th tile came from outside the hand, a concealed kong's from
  // inside plus a replacement — both leave the same 13-tile skeleton). The seat
  // mid-turn holds one more, until it discards.
  const handCounts = emptyBySeat<number>(() => 13)
  for (const s of SEATS) handCounts[s] = 13 - melds[s].length * 3 + (holding === s ? 1 : 0)

  return {
    index: end,
    discards,
    melds,
    pending,
    toAct,
    draws,
    handCounts,
    holding,
    finished: won || end >= log.length,
  }
}

/** Derived live-wall count for a board. See LIVE_WALL_AT_DEAL on accuracy. */
export const derivedWallCount = (board: ReplayBoard): number =>
  Math.max(0, LIVE_WALL_AT_DEAL - board.draws)

/**
 * Total tiles of `kind` visible on the table at this board — every discard pool
 * and every exposed meld, plus the tile in flight. This is the number the
 * review quotes ("3rd Red Dragon out"); it is exact, never estimated.
 */
export function visibleOnTable(board: ReplayBoard, kind: TileId): number {
  let n = 0
  for (const seat of SEATS) {
    n += board.discards[seat].filter((t) => t === kind).length
    for (const m of board.melds[seat]) n += m.tiles.filter((t) => t === kind).length
  }
  if (board.pending?.tile === kind) n++
  return n
}
