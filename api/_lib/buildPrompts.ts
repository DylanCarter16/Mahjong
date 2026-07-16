// Server-side prompt construction (§3.1: the engine computes, the model
// explains). The client posts validated game state; the server runs the
// engine's analysis over it and hands the model FACTS plus a short ask.
// No client-supplied prompt text ever reaches the model.

import { rankDiscards, readOpponents } from '../../src/engine/analysis'
import type { PlayerView } from '../../src/engine/game'
import { shanten } from '../../src/engine/shanten'
import { tileName } from '../../src/engine/tiles'
import { postRoundPrompt } from '../../src/analysis/prompts'
import { serialiseLog } from '../../src/analysis/serialise'
import { validatePlayerView, validateReview } from './validate'

export const COACH_SYSTEM =
  'You are a concise, friendly Hong Kong mahjong coach for a beginner. You are given exact engine-computed facts about the position. Never recompute or contradict the numbers — narrate them. Follow the requested output format exactly.'

export const REVIEW_SYSTEM =
  'You are a Hong Kong mahjong teacher reviewing a finished round for a beginner. Be concrete and reference specific turns. Follow the requested output format exactly.'

const SEAT_LABELS = ['ME', 'South', 'West', 'North'] as const

function dangerWord(score: number): string {
  if (score === 0) return 'SAFE (in their discards)'
  if (score <= 2) return 'fairly safe'
  if (score <= 4) return 'uncertain'
  return 'DANGEROUS'
}

/** The §3.1 facts block: hand, ranked discards, opponent reads. Exported for tests. */
export function coachFacts(view: PlayerView): string {
  const melds = view.melds[view.seat]
  const ranked = rankDiscards(view).slice(0, 7)
  const reads = readOpponents(view)
  const topThreat = reads.reduce((a, b) => (b.threat > a.threat ? b : a))

  const lines: string[] = [
    `notation: m=characters, p=circles, s=bamboo, w=winds, d=dragons`,
    `My hand: ${view.concealed.join(' ')}${melds.length ? ` | my melds: ${melds.map((m) => m.tiles.join('')).join(' ')}` : ''}`,
    `Current shanten: ${shanten(view.concealed, melds)} (0 = one tile from winning)`,
    `Discard options, ranked by the engine (DO NOT recompute):`,
    ...ranked.map((r) => {
      const danger =
        topThreat.threat >= 2
          ? `, vs ${SEAT_LABELS[topThreat.seat]}: ${dangerWord(r.dangerByOpponent[topThreat.seat] ?? 5)}`
          : ''
      const waits = r.advancing.length > 0 ? ` (waits: ${r.advancing.join(' ')})` : ''
      return `  ${r.tile} -> shanten ${r.shantenAfter}, ${r.ukeire} live tiles advance${waits}${danger}`
    }),
    `Round wind: ${view.roundWind}. My seat wind: ${view.seatWind}. Faan minimum: ${view.faanMinimum}. Wall tiles left: ${view.wallCount}.`,
  ]
  for (const o of reads) {
    const suits = `discards ${o.suitDiscards.m} characters / ${o.suitDiscards.p} circles / ${o.suitDiscards.s} bamboo`
    const collecting =
      o.likelyCollecting.length > 0 && o.likelyCollecting.length < 3
        ? `, likely collecting ${o.likelyCollecting.map((s) => ({ m: 'characters', p: 'circles', s: 'bamboo' })[s]).join('/')}`
        : ''
    lines.push(
      `${SEAT_LABELS[o.seat]}: ${o.exposedMelds} exposed melds, threat ${o.threat}/3, ${suits}${collecting}.`,
    )
  }
  return lines.join('\n')
}

export function buildCoachPrompt(body: unknown): { system: string; prompt: string } | null {
  if (typeof body !== 'object' || body === null) return null
  const view = validatePlayerView((body as Record<string, unknown>).view)
  if (!view) return null
  const pending = view.pendingDiscard
    ? `\nNote: ${SEAT_LABELS[view.pendingDiscard.from]} just discarded ${tileName(view.pendingDiscard.tile)} and it is claimable.`
    : ''
  return {
    system: COACH_SYSTEM,
    prompt: `${coachFacts(view)}${pending}

In 60 words or fewer: name the best discard and why (use the engine ranking), then ONE defensive note about the most threatening opponent. No preamble, no recomputation.`,
  }
}

export function buildReviewPrompt(body: unknown): { system: string; prompt: string } | null {
  const payload = validateReview(body)
  if (!payload) return null
  return { system: REVIEW_SYSTEM, prompt: postRoundPrompt(serialiseLog(payload.log, payload.result)) }
}
