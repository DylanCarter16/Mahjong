// Tile-efficiency trainer engine. All grading goes through engine shanten /
// usefulTiles — nothing here re-encodes a mahjong rule.

import { shuffle, type Rng } from '../engine/rng'
import { shanten, usefulTiles } from '../engine/shanten'
import { ALL_PLAY_KINDS, sortTiles } from '../engine/tiles'
import type { TileId } from '../engine/types'
import { buildWall } from '../engine/wall'

export interface DiscardEval {
  tile: TileId
  shantenAfter: number
  /** Unseen copies of every tile that would advance the remaining hand. */
  liveCount: number
  /** The specific tile kinds that would advance the hand. */
  advancing: TileId[]
}

export interface DiscardGrade {
  verdict: 'optimal' | 'acceptable' | 'bad'
  /** The discards the trainer would accept as optimal. */
  best: TileId[]
  perDiscard: DiscardEval[]
}

const without = (h: TileId[], tile: TileId): TileId[] => {
  const rest = [...h]
  rest.splice(rest.indexOf(tile), 1)
  return rest
}

const copies = (h: TileId[], kind: TileId) => h.filter((t) => t === kind).length

export function evalDiscards(hand14: TileId[]): DiscardEval[] {
  return [...new Set(hand14)].map((tile) => {
    const rest = without(hand14, tile)
    const advancing = usefulTiles(rest, [])
    const liveCount = advancing.reduce(
      (n, k) => n + Math.max(0, 4 - copies(rest, k) - (k === tile ? 1 : 0)),
      0,
    )
    return { tile, shantenAfter: shanten(rest, []), liveCount, advancing }
  })
}

export type CurveVerdict = 'optimal' | 'within-2-ukeire' | 'suboptimal' | 'blunder'

/** Curve grading (§4.4): optimal / within-2-ukeire / suboptimal / blunder. */
export function curveVerdict(grade: DiscardGrade, discard: TileId): CurveVerdict {
  const mine = grade.perDiscard.find((e) => e.tile === discard)
  if (!mine) throw new Error(`${discard} is not in the hand`)
  const bestShanten = Math.min(...grade.perDiscard.map((e) => e.shantenAfter))
  if (mine.shantenAfter > bestShanten) return 'blunder'
  const bestLive = Math.max(
    ...grade.perDiscard.filter((e) => e.shantenAfter === bestShanten).map((e) => e.liveCount),
  )
  if (grade.best.includes(discard)) return 'optimal'
  return mine.liveCount >= bestLive - 2 ? 'within-2-ukeire' : 'suboptimal'
}

/**
 * Optimal: reaches the best shanten and keeps (nearly) the most live tiles.
 * Acceptable: best shanten but noticeably fewer live tiles.
 * Bad: leaves the hand further from winning than it needs to be.
 */
export function gradeDiscard(hand14: TileId[], discard: TileId): DiscardGrade {
  const perDiscard = evalDiscards(hand14)
  const bestShanten = Math.min(...perDiscard.map((e) => e.shantenAfter))
  const bestLive = Math.max(
    ...perDiscard.filter((e) => e.shantenAfter === bestShanten).map((e) => e.liveCount),
  )
  const isOptimal = (e: DiscardEval) =>
    e.shantenAfter === bestShanten && e.liveCount >= 0.8 * bestLive
  const mine = perDiscard.find((e) => e.tile === discard)
  if (!mine) throw new Error(`${discard} is not in the hand`)
  const verdict = mine.shantenAfter > bestShanten ? 'bad' : isOptimal(mine) ? 'optimal' : 'acceptable'
  return { verdict, best: perDiscard.filter(isOptimal).map((e) => e.tile), perDiscard }
}

/**
 * Procedurally generate a 14-tile hand at exactly the target shanten, by
 * hill-climbing from a random deal: swap the least useful tile for a useful
 * draw to improve, or a random tile for junk to degrade.
 */
export function generateHand(targetShanten: number, rng: Rng, maxSteps = 600): TileId[] {
  let h = buildWall({ flowers: false }, rng).slice(0, 14)
  for (let step = 0; step < maxSteps; step++) {
    const sh = shanten(h, [])
    if (sh === targetShanten) return sortTiles(h)
    if (sh > targetShanten) {
      const evals = evalDiscards(h)
      const bestDiscard = evals.reduce((a, b) => (b.shantenAfter < a.shantenAfter ? b : a)).tile
      const rest = without(h, bestDiscard)
      const useful = usefulTiles(rest, []).filter((k) => copies(rest, k) < 4)
      if (useful.length === 0) {
        h = buildWall({ flowers: false }, rng).slice(0, 14) // dead end, restart
        continue
      }
      h = [...rest, useful[Math.floor(rng.next() * useful.length)]]
    } else {
      // Too close to winning: swap a random tile for one that loosens the hand.
      const victim = h[Math.floor(rng.next() * h.length)]
      const candidates = shuffle(
        ALL_PLAY_KINDS.filter((k) => copies(h, k) < 4),
        rng,
      )
      const rest = without(h, victim)
      const junk = candidates.find((k) => shanten([...rest, k], []) > sh)
      h = junk ? [...rest, junk] : buildWall({ flowers: false }, rng).slice(0, 14)
    }
  }
  throw new Error(`could not reach ${targetShanten}-shanten in ${maxSteps} steps`)
}
