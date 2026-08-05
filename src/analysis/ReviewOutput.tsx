// The post-round review: a short list of tappable moments, not a wall of text.
//
// The split on screen mirrors the split in the system: the badge, the turn, the
// engine line and the replayed board are all computed and exact; the sentence
// under them is the model explaining why it mattered. The engine half renders
// even when the model's answer doesn't parse — a review showing graded moments
// with no narration is still useful, one showing "M1:" is not.
//
// Closed, this is skimmable: four lines, each with a verdict you can read at a
// glance. Open, it is the table exactly as it stood at that turn, which is the
// thing "around turn 47 you discarded the Red Dragon" could never be.

import { useState } from 'react'
import { stepTurn } from '../engine/replay'
import { handsByDecision } from '../engine/review'
import type { Action } from '../engine/game'
import type { HandSnapshot } from '../engine/review'
import { tileName } from '../engine/tiles'
import type { Seat, Wind } from '../engine/types'
import { TileView } from '../ui/TileView'
import type { ReviewMeta } from './client'
import { parseNarration } from './narration'
import { ReplayBoardView } from './ReplayBoardView'

/**
 * Badge styling on the semantic scale already in use elsewhere: red for a real
 * error, amber for "consider", green for good play. A mistake and a bit of
 * praise used to read at the same weight, which is exactly what a badge fixes.
 */
const VERDICT: Record<string, { label: string; cls: string }> = {
  mistake: { label: 'Mistake', cls: 'border-rose-400/40 bg-rose-500/15 text-rose-200' },
  loose: { label: 'Loose', cls: 'border-amber-400/40 bg-amber-500/15 text-amber-200' },
  fine: { label: 'Fine', cls: 'border-emerald-500/40 bg-emerald-700/30 text-emerald-200' },
  sharp: { label: 'Sharp', cls: 'border-lime-400/40 bg-lime-500/15 text-lime-200' },
}

export function ReviewOutput({
  review,
  text,
  log,
  seat,
  seatWinds,
  snapshots,
  numbered = true,
}: {
  review: ReviewMeta
  text: string
  log: Action[]
  seat: Seat
  seatWinds: Record<Seat, Wind>
  snapshots: HandSnapshot[]
  numbered?: boolean
}) {
  const narration = parseNarration(text, review.moments.length)
  // Which moment is expanded, and which turn within it is being looked at —
  // stepping ±1 moves the board without changing which moment you are reading.
  const [openAt, setOpenAt] = useState<{ moment: number; index: number } | null>(null)

  // Paired once for the whole review: the same walk the grader used, so the
  // hand drawn on the board is the hand the verdict was computed from.
  const hands = handsByDecision(log, seat, snapshots)

  return (
    <div className="space-y-3">
      <p className="font-semibold text-emerald-50">{narration.summary || review.summary}</p>

      <ol className="space-y-2">
        {review.moments.map((m, i) => {
          const badge = VERDICT[m.verdict] ?? { label: m.verdict, cls: 'border-emerald-600 text-emerald-200' }
          const open = openAt?.moment === i
          return (
            <li key={m.index} className="overflow-hidden rounded-lg border border-emerald-800 bg-emerald-950/40">
              <button
                className="flex min-h-11 w-full items-start gap-2 p-2 text-left cursor-pointer"
                aria-expanded={open}
                onClick={() => setOpenAt(open ? null : { moment: i, index: m.index })}
              >
                <span
                  className={`mt-0.5 shrink-0 rounded-full border px-1.5 py-0.5 text-[0.6rem] font-semibold ${badge.cls}`}
                >
                  {badge.label}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-xs text-emerald-300/70">turn {m.turn}</span>
                  <span className="block text-sm text-emerald-50">{m.headline}</span>
                  {narration.moments[i] && (
                    <span className="mt-1 block text-sm text-emerald-100/90">{narration.moments[i]}</span>
                  )}
                </span>
                {m.tile && (
                  <span className="inline-flex w-5 shrink-0">
                    <TileView tile={m.tile} size="xs" numbered={numbered} />
                  </span>
                )}
                <span aria-hidden className="shrink-0 self-center text-emerald-400/60">
                  {open ? '▾' : '▸'}
                </span>
              </button>

              {open && (
                <div className="border-t border-emerald-800 p-2">
                  {/* Every exact fact the verdict rests on, before the board —
                      the numbers and the picture agree because both come from
                      the same scan. */}
                  <ul className="mb-2 space-y-0.5 text-xs text-emerald-200/80">
                    {m.facts.map((f, k) => (
                      <li key={k}>{f}</li>
                    ))}
                  </ul>
                  {/* A div, not a p: TileView renders a div, and a div inside a
                      p is invalid nesting that React warns about at runtime. */}
                  {m.better && (
                    <div className="mb-2 flex items-start gap-1.5 rounded-md border border-amber-400/30 bg-amber-500/10 p-1.5 text-xs text-amber-100">
                      <span className="inline-flex w-5 shrink-0 pt-0.5">
                        <TileView tile={m.better.tile} size="xs" numbered={numbered} />
                      </span>
                      <span>
                        <span className="font-semibold">{tileName(m.better.tile)} instead. </span>
                        {m.better.why}
                      </span>
                    </div>
                  )}
                  <ReplayBoardView
                    log={log}
                    index={openAt.index}
                    seat={seat}
                    seatWinds={seatWinds}
                    hands={hands}
                    highlight={m.tile}
                    suggest={m.better?.tile ?? null}
                    numbered={numbered}
                    onStep={(dir) => {
                      const next = stepTurn(log, openAt.index, dir)
                      if (next !== null) setOpenAt({ moment: i, index: next })
                    }}
                  />
                  {openAt.index !== m.index && (
                    <button
                      className="mt-2 min-h-11 w-full rounded-lg border border-emerald-700 px-3 py-1.5 text-xs text-emerald-100 cursor-pointer"
                      onClick={() => setOpenAt({ moment: i, index: m.index })}
                    >
                      Back to turn {m.turn}
                    </button>
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ol>

      {/* Anything the model wrote outside the format still gets shown. Dropping
          it would silently lose advice whenever a model ignored the labels. */}
      {narration.rest && <p className="text-sm text-emerald-100/90">{narration.rest}</p>}

      {/* Honest about what could not be rebuilt, rather than quietly showing a
          thinner review and letting it look like the whole story. */}
      {review.degraded.length > 0 && (
        <p className="text-[0.7rem] text-emerald-400/60">
          {review.degraded.length} moment{review.degraded.length === 1 ? '' : 's'} could not be replayed in
          full — graded from the visible table only.
        </p>
      )}
    </div>
  )
}
