// POST /api/review { log: Action[], result: RoundResult | null } —
// post-round "why did I lose" review. Latency doesn't matter; quality does.

import { buildReviewPrompt } from './_lib/buildPrompts'
import { createHandler } from './_lib/handler'

export default createHandler({
  buildPrompt: buildReviewPrompt,
  model: 'claude-sonnet-5',
  // Quality path with a reliability net: if Sonnet errors, refuses, or
  // returns a textless completion, Haiku still delivers a review.
  fallbackModel: 'claude-haiku-4-5-20251001',
  maxTokens: 1600,
})
