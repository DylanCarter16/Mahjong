// Source for the /api/review function — bundled into a self-contained
// api/review.js by scripts/build-api.mjs (see api/_src/coach.ts for why).
//
// POST /api/review { log: Action[], result: RoundResult | null } —
// post-round "why did I lose" review. Latency doesn't matter; quality does.

import { buildReviewPrompt } from '../_lib/buildPrompts'
import { createHandler } from '../_lib/handler'

export default createHandler({
  buildPrompt: buildReviewPrompt,
  model: 'claude-sonnet-5',
  maxTokens: 700,
})
