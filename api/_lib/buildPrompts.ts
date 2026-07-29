// Server-side prompt construction (§3.1: the engine computes, the model
// explains). The client posts validated game state; the server runs the
// engine's analysis over it and hands the model FACTS plus a short ask.
// No client-supplied prompt text ever reaches the model.

import { claimAnalysis, rankDiscards, readOpponents, type ClaimEval } from '../../src/engine/analysis'
import type { PlayerView } from '../../src/engine/game'
import { shanten } from '../../src/engine/shanten'
import { tileName } from '../../src/engine/tiles'
import { postRoundPrompt } from '../../src/analysis/prompts'
import { serialiseLog } from '../../src/analysis/serialise'
import { validatePlayerView, validateReview } from './validate'

// The facts block below feeds the model internal tile codes (m9, wW, dW); these
// system prompts require it to translate them to plain English names in its
// reply and to write with no Markdown, so nothing like "**Discard wW**" ever
// reaches the screen. The client also strips both as a safety net.
const PLAIN_PROSE =
  ' Write plain prose only — no Markdown or formatting syntax of any kind (no asterisks, underscores, backticks, headings, or bullet lists). Always name tiles in plain English ("West Wind", "White Dragon", "9 of Characters") and never use internal codes like wW, dW, or m9.'

export const COACH_SYSTEM =
  'You are a concise, friendly Hong Kong mahjong coach for a beginner. You are given exact engine-computed facts about the position. Never recompute or contradict the numbers — narrate them. Follow the requested output format exactly.' +
  PLAIN_PROSE

export const REVIEW_SYSTEM =
  'You are a Hong Kong mahjong teacher reviewing a finished round for a beginner. Be concrete and reference specific turns. Follow the requested output format exactly.' +
  PLAIN_PROSE

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

function claimWords(claim: ClaimEval['claim']): string {
  if (claim === 'win') return 'win off the discard'
  if (claim === 'pung') return 'pung (three of a kind)'
  if (claim === 'kong') return 'kong (four of a kind)'
  return `chow using ${claim.chow.map(tileName).join(' + ')}`
}

/**
 * The claims-phase facts block. Same contract as coachFacts: the engine has
 * already worked out what each claim does to the hand; the model only weighs
 * it up in words. Exported for tests.
 */
export function claimFacts(view: PlayerView, options: ClaimEval[]): string {
  const pd = view.pendingDiscard!
  const myMelds = view.melds[view.seat]
  const concealed = myMelds.every((m) => m.concealed)
  const reads = readOpponents(view)
  const topThreat = reads.reduce((a, b) => (b.threat > a.threat ? b : a))
  return [
    `notation: m=characters, p=circles, s=bamboo, w=winds, d=dragons`,
    `My hand: ${view.concealed.join(' ')}${myMelds.length ? ` | my melds: ${myMelds.map((m) => m.tiles.join('')).join(' ')}` : ''}`,
    `${SEAT_LABELS[pd.from]} just discarded ${tileName(pd.tile)} and I may claim it.`,
    `Current shanten: ${options[0].shantenBefore} (0 = one tile from winning)`,
    `Claim options, computed by the engine (DO NOT recompute):`,
    ...options.map(
      (o) =>
        `  ${claimWords(o.claim)} -> shanten ${o.shantenAfter === -1 ? '-1 (an immediate win)' : o.shantenAfter}` +
        `${o.shantenAfter < o.shantenBefore ? ' (closer to ready)' : o.shantenAfter === o.shantenBefore ? ' (no progress)' : ' (further from ready)'}`,
    ),
    `Cost of claiming: the set is exposed for everyone to see.${
      concealed ? ' My hand is fully concealed right now, so claiming gives that up.' : ' I already have an exposed set.'
    }`,
    `Round wind: ${view.roundWind}. My seat wind: ${view.seatWind}. Faan minimum: ${view.faanMinimum}. Wall tiles left: ${view.wallCount}.`,
    `Most threatening opponent: ${SEAT_LABELS[topThreat.seat]}, threat ${topThreat.threat}/3, ${topThreat.exposedMelds} exposed melds.`,
  ].join('\n')
}

export function buildCoachPrompt(body: unknown): { system: string; prompt: string } | null {
  if (typeof body !== 'object' || body === null) return null
  const view = validatePlayerView((body as Record<string, unknown>).view)
  if (!view) return null

  // A claims-phase position is a different question ("take it or not?"), so it
  // gets its own facts and its own ask. The MODE is derived from the validated
  // state, never from a client-supplied field — same no-open-proxy rule as the
  // rest of this file.
  if (view.phase === 'claims' && view.pendingDiscard) {
    const options = claimAnalysis(view)
    if (options.length > 0) {
      return {
        system: COACH_SYSTEM,
        prompt: `${claimFacts(view, options)}

In 60 words or fewer: say whether to claim and which claim to take (or to pass), using the engine's shanten numbers, and name the one thing it costs me. No preamble, no recomputation.`,
      }
    }
  }

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
