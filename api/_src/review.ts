// Source for the /api/review function — bundled into a self-contained
// api/review.js by scripts/build-api.mjs (see api/_src/coach.ts for why).
//
// POST /api/review { log: Action[], result: RoundResult | null } —
// post-round "why did I lose" review. Latency doesn't matter; quality does.

import { buildReviewPrompt } from '../_lib/buildPrompts'
import { createHandler } from '../_lib/handler'

/**
 * The review is the LONG call — Sonnet writing ~700 tokens over a whole action
 * log routinely runs past the platform's DEFAULT function budget, and a killed
 * invocation answers the browser with nothing at all. That is what made "review
 * that round" spin forever while the (shorter, Haiku) coach call stayed fine.
 * So: ask for a real budget here, and time the upstream call out INSIDE it, so
 * we always get to send a JSON error the panel can show with a retry.
 */
export const maxDuration = 60
const UPSTREAM_TIMEOUT_MS = 50_000

export default createHandler({
  buildPrompt: buildReviewPrompt,
  model: 'claude-sonnet-5',
  // The coach has always had a fallback model; the review had none, so one bad
  // upstream response was terminal. Same ladder, one rung faster.
  fallbackModel: 'claude-haiku-4-5-20251001',
  maxTokens: 700,
  timeoutMs: UPSTREAM_TIMEOUT_MS,
})
