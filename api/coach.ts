// POST /api/coach { view: PlayerView } — in-game "best discard" coaching.
// Interactive path: Haiku for latency, Sonnet as fallback.

import { buildCoachPrompt } from './_lib/buildPrompts'
import { createHandler } from './_lib/handler'

export default createHandler({
  buildPrompt: buildCoachPrompt,
  model: 'claude-haiku-4-5-20251001',
  fallbackModel: 'claude-sonnet-5',
  maxTokens: 700,
})
