// The post-round review, rendered as moments rather than a wall of text.
//
// The split on screen mirrors the split in the system: the ENGINE line under
// each turn is computed and exact, the sentence under it is the model
// explaining why it mattered. Both are labelled as such by the panel's caption,
// and the engine line renders even when the model's answer doesn't parse — a
// review that shows the graded moments with no narration is still useful, one
// that shows "M1:" is not.

import { parseNarration } from './narration'
import type { ReviewMeta } from './client'

const VERDICT_LABEL: Record<string, string> = {
  mistake: 'Mistake',
  loose: 'Loose',
  fine: 'Fine',
  sharp: 'Sharp',
}

export function ReviewOutput({ review, text }: { review: ReviewMeta; text: string }) {
  const narration = parseNarration(text, review.moments.length)

  return (
    <div className="space-y-3">
      {/* One-line verdict on the whole round. The model's version if it wrote
          one, the engine's if it didn't — never nothing. */}
      <p className="font-semibold text-emerald-50">{narration.summary || review.summary}</p>

      <ol className="space-y-2">
        {review.moments.map((m, i) => (
          <li key={m.index} className="rounded-lg border border-emerald-800 bg-emerald-950/40 p-2">
            <p className="flex flex-wrap items-baseline gap-x-2 text-xs text-emerald-300/70">
              <span className="font-semibold text-emerald-200">{VERDICT_LABEL[m.verdict] ?? m.verdict}</span>
              <span>turn {m.turn}</span>
            </p>
            <p className="mt-0.5 text-sm text-emerald-50">{m.headline}</p>
            {narration.moments[i] && (
              <p className="mt-1 text-sm text-emerald-100/90">{narration.moments[i]}</p>
            )}
          </li>
        ))}
      </ol>

      {/* Anything the model wrote outside the format still gets shown. Dropping
          it would silently lose advice whenever a model ignored the labels. */}
      {narration.rest && <p className="text-sm text-emerald-100/90">{narration.rest}</p>}
    </div>
  )
}
