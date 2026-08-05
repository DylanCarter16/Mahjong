// Cross-round patterns: the layer a single review cannot reach.
//
// One round can tell you that you threw a dragon into a live pung. It cannot
// tell you that you do it most games — and that is the thing that would
// actually move your play against stronger opponents. So each finished round
// leaves behind a COMPACT graded record (counts, not the log), and the patterns
// view reads back across them.
//
// Two rules keep this honest, and they are the whole design:
//   1. Every count comes from a moment the engine graded. Nothing is inferred
//      from "feel", and nothing is inferred from rounds that were not observed.
//   2. Nothing is claimed from a single occurrence. A leak has to recur before
//      it is called a leak, because one loose discard is a Tuesday, not a habit.
//
// Records are stored beside lesson mastery (§4.2, one versioned key) so a
// recurring leak can nudge what the lessons surface.

import type { LeakId, RoundScan } from '../engine/review'
import type { ConceptId } from '../lessons/concepts'

/** One finished round, reduced to what a pattern can be built from. */
export interface RoundRecord {
  /** Local calendar day, so "your last N rounds" needs no stored clock. */
  day: string
  /** Own discards in the round — the denominator for a rate. */
  discards: number
  sharp: number
  loose: number
  mistakes: number
  /** Times each leak was graded in this round. */
  leaks: Partial<Record<LeakId, number>>
}

/**
 * Human-facing description of a leak, plus the lesson concepts it maps to.
 *
 * The wording says exactly what was measured. "You fed a live pung" would be a
 * nicer sentence, but the engine measures "threw a live tile at a seat with
 * sets down when a dead one was available", so that is what it says.
 */
export const LEAKS: Record<LeakId, { label: string; detail: string; concepts: ConceptId[] }> = {
  dealtIn: {
    label: 'Dealing into winning hands',
    detail: 'You discarded the tile an opponent won on.',
    concepts: ['defence.safe-tiles', 'defence.push-fold'],
  },
  fedThreat: {
    label: 'Feeding the seat that was pushing',
    detail: 'You threw a live tile at a seat with sets down when a dead one was available.',
    concepts: ['read.threat', 'defence.safe-tiles'],
  },
  looseDiscard: {
    label: 'Loose discards on a quiet table',
    detail: 'You left safety on the table with an equally fast tile available.',
    concepts: ['defence.safe-tiles', 'read.suit-inference'],
  },
  slowDiscard: {
    label: 'Giving up speed',
    detail: 'You discarded a tile that cost you a turn towards ready.',
    concepts: ['efficiency.discard-choice', 'efficiency.ukeire'],
  },
  missedClaim: {
    label: 'Passing on useful claims',
    detail: 'You passed on a pung or chow that would have moved you closer to ready.',
    concepts: ['efficiency.shanten', 'set.pung-kong'],
  },
  passedWin: {
    label: 'Passing on the winning tile',
    detail: 'You passed on a discard that completed your hand.',
    concepts: ['shape.standard', 'declare.minimum'],
  },
}

/** Reduce a graded round to its record. Counts only, never the log. */
export function recordRound(scan: RoundScan, day: string): RoundRecord {
  const leaks: Partial<Record<LeakId, number>> = {}
  for (const m of scan.moments) {
    if (!m.leak) continue
    leaks[m.leak] = (leaks[m.leak] ?? 0) + 1
  }
  return {
    day,
    discards: scan.tally.discards,
    sharp: scan.tally.sharp,
    loose: scan.tally.loose,
    mistakes: scan.tally.mistakes,
    leaks,
  }
}

export interface Leak {
  id: LeakId
  label: string
  detail: string
  concepts: ConceptId[]
  /** Total times graded across the records considered. */
  count: number
  /** How many of those rounds it happened in at all. */
  rounds: number
  /** Rounds considered — the denominator, so the claim can be checked. */
  outOf: number
}

/**
 * Recurring leaks across recent rounds, worst first.
 *
 * `minRounds` is the bar for calling something a pattern rather than an
 * incident. Two is deliberately low but not one: at one occurrence there is no
 * pattern to report, and reporting it anyway is how a coach loses trust.
 */
export function findLeaks(records: readonly RoundRecord[], minRounds = 2): Leak[] {
  const out: Leak[] = []
  for (const id of Object.keys(LEAKS) as LeakId[]) {
    let count = 0
    let rounds = 0
    for (const r of records) {
      const n = r.leaks[id] ?? 0
      if (n > 0) {
        count += n
        rounds++
      }
    }
    if (rounds < minRounds) continue
    out.push({ id, ...LEAKS[id], count, rounds, outOf: records.length })
  }
  // Most frequent first; ties broken by how many rounds it touched, so a habit
  // spread over five games outranks one bad round with five instances.
  return out.sort((a, b) => b.count - a.count || b.rounds - a.rounds)
}

/** Overall shape of recent play, for the one line above the leak list. */
export function overall(records: readonly RoundRecord[]): {
  rounds: number
  discards: number
  sharp: number
  loose: number
  mistakes: number
} {
  return records.reduce(
    (acc, r) => ({
      rounds: acc.rounds + 1,
      discards: acc.discards + r.discards,
      sharp: acc.sharp + r.sharp,
      loose: acc.loose + r.loose,
      mistakes: acc.mistakes + r.mistakes,
    }),
    { rounds: 0, discards: 0, sharp: 0, loose: 0, mistakes: 0 },
  )
}

/**
 * The lesson concepts a set of leaks points at, most-implicated first.
 * This is the hook back into the mastery model: what to practise next.
 */
export function conceptsToPractise(leaks: readonly Leak[]): ConceptId[] {
  const weight = new Map<ConceptId, number>()
  for (const l of leaks) {
    for (const c of l.concepts) weight.set(c, (weight.get(c) ?? 0) + l.count)
  }
  return [...weight.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c)
}
