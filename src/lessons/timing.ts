// Timed-item pacing (§C1). Pure, so it can be tested without a DOM.
//
// The rule: warn ONCE per session about the timed questions ahead, then never
// interrupt again. Previously every timed item opened a full-screen "you'll
// have 12 seconds — I'm ready" gate; in a run of them that is a modal between
// every question. The replacement is this notice, a persistent ⏱ badge on the
// timed items, and a short count-in before each clock starts.

/** Count-in before a timed question's clock starts. Long enough to look up. */
export const COUNT_IN_MS = 2_000

/**
 * One sentence about the timed items ahead, or null when there are none.
 * Takes the session's per-item time limits in order.
 */
export function timedNotice(timeLimits: (number | undefined)[]): string | null {
  const total = timeLimits.length
  const timed = timeLimits.filter((t) => t).length
  if (timed === 0) return null
  const secs = Math.round(Math.max(...timeLimits.map((t) => t ?? 0)) / 1000)
  // A leading run is the common shape (recognition drills cluster), and it is
  // the one the owner asked to be told about: "the next N questions are timed".
  let lead = 0
  while (lead < total && timeLimits[lead]) lead++
  if (timed === total) return `All ${total} questions in this session are timed — up to ${secs} seconds each.`
  if (lead >= 2) return `The next ${lead} questions are timed — up to ${secs} seconds each.`
  // Interleaved: don't promise a run that isn't there — the badge carries it.
  return `${timed} of these ${total} questions are timed — they're marked, and each gets a countdown first.`
}
