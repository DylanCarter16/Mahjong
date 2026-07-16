// Beginner-aid discard analysis — a thin wrapper over the engine's
// rankDiscards (the same facts the coach proxy narrates), adding only the
// "suggested" flag the tile ring UI needs.

import { rankDiscards, type RankedDiscard } from '../engine/analysis'
import type { PlayerView } from '../engine/game'

export interface DiscardEval extends RankedDiscard {
  suggested: boolean
}

export function evalMyDiscards(view: PlayerView): DiscardEval[] {
  const ranked = rankDiscards(view)
  if (ranked.length === 0) return []
  const best = ranked[0]
  return ranked.map((r) => ({
    ...r,
    suggested: r.shantenAfter === best.shantenAfter && r.ukeire === best.ukeire,
  }))
}
