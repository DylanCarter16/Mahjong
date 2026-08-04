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
  // THE review bug. `claude-sonnet-5` runs ADAPTIVE THINKING when `thinking` is
  // omitted, and max_tokens caps thinking + text together — so all 700 tokens
  // went to reasoning over a full action log and the response contained no text
  // block at all. Every single time, at normal latency, which is exactly what
  // "empty answer, deterministic" looks like from the outside.
  //
  // Off, not bigger: this call narrates engine-computed facts into three
  // numbered points in 180 words. The system prompt already forbids
  // recomputation, so reasoning budget buys nothing here and costs latency on a
  // request the player is waiting on. If you ever want it on, raise maxTokens
  // well clear of the visible-output budget first — thinking eats the same cap.
  thinking: { type: 'disabled' },
})
