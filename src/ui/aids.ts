// Beginner-aid discard analysis, powered entirely by the engine (never the
// API): for every legal discard, what shanten does it leave and how many
// useful tiles stay unseen ("live")?

import type { PlayerView } from '../engine/game'
import { shanten, usefulTiles } from '../engine/shanten'
import { SEATS, type TileId } from '../engine/types'

export interface DiscardEval {
  tile: TileId
  shantenAfter: number
  liveCount: number
  suggested: boolean
}

export function unseenCopies(view: PlayerView, kind: TileId): number {
  let seen = view.concealed.filter((t) => t === kind).length
  for (const seat of SEATS) {
    seen += view.discards[seat].filter((t) => t === kind).length
    for (const m of view.melds[seat]) seen += m.tiles.filter((t) => t === kind).length
  }
  if (view.pendingDiscard?.tile === kind) seen++
  return Math.max(0, 4 - seen)
}

export function evalMyDiscards(view: PlayerView): DiscardEval[] {
  const melds = view.melds[view.seat]
  const evals = [...new Set(view.concealed)].map((tile) => {
    const rest = [...view.concealed]
    rest.splice(rest.indexOf(tile), 1)
    const shantenAfter = shanten(rest, melds)
    const liveCount = usefulTiles(rest, melds).reduce((n, k) => n + unseenCopies(view, k), 0)
    return { tile, shantenAfter, liveCount, suggested: false }
  })
  const bestShanten = Math.min(...evals.map((e) => e.shantenAfter))
  const bestLive = Math.max(...evals.filter((e) => e.shantenAfter === bestShanten).map((e) => e.liveCount))
  for (const e of evals) e.suggested = e.shantenAfter === bestShanten && e.liveCount === bestLive
  return evals
}
