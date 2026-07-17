// Server-side prompt construction (§3.1: the engine computes, the model
// explains). The client posts validated game state; the server runs the
// engine's analysis over it and hands the model FACTS plus a short ask.
// No client-supplied prompt text ever reaches the model.

import { claimAnalysis, rankDiscards, readOpponents } from '../../src/engine/analysis'
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

const claimLabel = (c: ReturnType<typeof claimAnalysis>[number]['claim']): string =>
  c === 'win' ? 'WIN' : c === 'pung' ? 'PUNG' : c === 'kong' ? 'KONG' : `CHOW with ${c.chow.join(' ')}`

export function buildCoachPrompt(body: unknown): { system: string; prompt: string } | null {
  if (typeof body !== 'object' || body === null) return null
  const view = validatePlayerView((body as Record<string, unknown>).view)
  if (!view) return null

  // Claim decision moment: the question is "take it or pass", not "what do I discard".
  const claims = claimAnalysis(view)
  if (view.pendingDiscard && claims.length > 0) {
    const lines = claims.map(
      (c) =>
        `  ${claimLabel(c.claim)} -> ${
          c.shantenAfter === -1 ? 'WINS THE HAND' : `shanten ${c.shantenBefore} -> ${c.shantenAfter}`
        }${c.recommended ? ' (advances the hand)' : ' (does NOT advance the hand)'}`,
    )
    return {
      system: COACH_SYSTEM,
      prompt: `${coachFacts(view)}

CLAIM DECISION: ${SEAT_LABELS[view.pendingDiscard.from]} just discarded ${tileName(view.pendingDiscard.tile)}. Engine-computed options (DO NOT recompute):
${lines.join('\n')}
  PASS -> stay at shanten ${claims[0].shantenBefore}, keep the hand concealed

In 50 words or fewer: say whether to claim or pass and why — weigh advancing the hand against exposing melds and giving up concealment. No preamble.`,
    }
  }

  return {
    system: COACH_SYSTEM,
    prompt: `${coachFacts(view)}

In 60 words or fewer: name the best discard and why (use the engine ranking), then ONE defensive note about the most threatening opponent. No preamble, no recomputation.`,
  }
}

export function buildReviewPrompt(body: unknown): { system: string; prompt: string } | null {
  const payload = validateReview(body)
  if (!payload) return null
  return { system: REVIEW_SYSTEM, prompt: postRoundPrompt(serialiseLog(payload.log, payload.result)) }
}
