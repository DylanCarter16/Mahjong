// "Your patterns" — the leaks that show up across rounds, not within one.
//
// This is the layer that can say something a single review never can: not "you
// threw a dragon into a live pung", but "you have done that in four of your
// last six games". Every number here is a count of engine-graded moments from
// rounds actually played on this device, and the denominator is always shown,
// so a claim can be checked rather than taken on faith.
//
// Nothing is reported from a single occurrence. See findLeaks.

import { conceptById, type ConceptId } from '../lessons/concepts'
import { findLeaks, overall, conceptsToPractise, type RoundRecord } from './leaks'

export function PatternsPanel({ records }: { records: RoundRecord[] }) {
  const totals = overall(records)
  const leaks = findLeaks(records)
  const practise = conceptsToPractise(leaks).slice(0, 3)

  if (records.length === 0) {
    return (
      <p className="rounded-lg border border-emerald-800 bg-emerald-900/40 p-2 text-xs text-emerald-300/70">
        Nothing yet. Patterns appear once you have finished a few rounds — they are counted from the same
        graded moments the reviews are built from.
      </p>
    )
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-emerald-200/80">
        Across your last {totals.rounds} round{totals.rounds === 1 ? '' : 's'}: {totals.discards} discards,{' '}
        {totals.sharp} sharp, {totals.loose} loose, {totals.mistakes} mistake
        {totals.mistakes === 1 ? '' : 's'}.
      </p>

      {leaks.length === 0 ? (
        <p className="rounded-lg border border-emerald-800 bg-emerald-900/40 p-2 text-xs text-emerald-300/70">
          No habit has repeated often enough to call it a pattern yet. That is a real answer, not an empty
          one — play a few more rounds.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {leaks.map((l) => (
            <li key={l.id} className="rounded-lg border border-emerald-800 bg-emerald-950/40 p-2">
              <p className="flex flex-wrap items-baseline justify-between gap-x-2">
                <span className="text-sm font-semibold text-emerald-50">{l.label}</span>
                <span className="text-xs text-amber-200/90">
                  {l.count}× in {l.rounds} of {l.outOf} rounds
                </span>
              </p>
              <p className="mt-0.5 text-xs text-emerald-200/70">{l.detail}</p>
            </li>
          ))}
        </ul>
      )}

      {/* The hook back into the lessons: a recurring leak is a concept to drill,
          and naming it is more use than another paragraph about the leak. */}
      {practise.length > 0 && (
        <p className="text-xs text-emerald-300/70">
          Worth drilling in Learn: {practise.map(titleOf).join(', ')}.
        </p>
      )}
    </div>
  )
}

const titleOf = (id: ConceptId): string => conceptById.get(id)?.title ?? id
