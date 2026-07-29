// Source for the /api/coach function. Lives under api/_src (underscore =
// ignored by Vercel routing) and is bundled by scripts/build-api.mjs into a
// self-contained api/coach.js — the file Vercel actually deploys. See that
// script for WHY: Vercel does not package the cross-directory ../../src imports
// this handler transitively needs, so the deployed function must be pre-bundled.
//
// POST /api/coach { view: PlayerView } — in-game "best discard" coaching.
// Interactive path: Haiku for latency, Sonnet as fallback.

import { buildCoachPrompt } from '../_lib/buildPrompts'
import { createHandler } from '../_lib/handler'

// Same reasoning as api/_src/review.ts: an upstream budget strictly inside the
// function budget, so a stalled model turns into a JSON error the panel can
// retry rather than a request that never returns. Tighter here — this one runs
// while you are waiting to play.
export const maxDuration = 60
const UPSTREAM_TIMEOUT_MS = 30_000

export default createHandler({
  buildPrompt: buildCoachPrompt,
  model: 'claude-haiku-4-5-20251001',
  fallbackModel: 'claude-sonnet-5',
  maxTokens: 500,
  timeoutMs: UPSTREAM_TIMEOUT_MS,
})
