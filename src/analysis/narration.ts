// Split the model's review into a summary plus one line per moment.
//
// The prompt asks for a strict "SUMMARY: … / M1: … / M2: …" shape so each
// sentence can be attached to the moment card it belongs to. Models mostly
// comply and sometimes don't, and a review that renders nothing because a
// label was missing is worse than one that renders as a paragraph. So parsing
// is best-effort by design: whatever cannot be matched to a moment comes back
// as `rest`, and the caller shows it as prose.

export interface Narration {
  /** The one-line round summary, if the model produced one. */
  summary: string
  /** Narration per shortlisted moment, by index. Empty string when missing. */
  moments: string[]
  /** Anything that didn't fit the format. Render it rather than dropping it. */
  rest: string
  /** True when every moment got a sentence — the shape we asked for. */
  complete: boolean
}

/**
 * `count` is the number of moments the engine shortlisted, which is what the
 * prompt asked the model to number up to. Lines beyond it are treated as loose
 * prose rather than silently discarded.
 */
export function parseNarration(text: string, count: number): Narration {
  const moments = Array.from({ length: count }, () => '')
  const loose: string[] = []
  let summary = ''
  // Which bucket the current line continues — models wrap.
  let current: number | 'summary' | null = null

  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line) {
      current = null
      continue
    }
    const summaryHead = /^SUMMARY\s*[:\-—]\s*(.*)$/i.exec(line)
    if (summaryHead) {
      summary = summaryHead[1].trim()
      current = 'summary'
      continue
    }
    const momentHead = /^M\s*(\d+)\s*[:.\-—)]\s*(.*)$/i.exec(line)
    if (momentHead) {
      const i = Number(momentHead[1]) - 1
      if (i >= 0 && i < count) {
        moments[i] = momentHead[2].trim()
        current = i
        continue
      }
      // A number outside the shortlist is the model inventing a moment; keep
      // the text but don't attach it to a card it doesn't belong to.
      loose.push(line)
      current = null
      continue
    }
    if (current === 'summary') summary = `${summary} ${line}`.trim()
    else if (typeof current === 'number') moments[current] = `${moments[current]} ${line}`.trim()
    else loose.push(line)
  }

  return {
    summary,
    moments,
    rest: loose.join('\n').trim(),
    complete: summary.length > 0 && moments.every((m) => m.length > 0),
  }
}
