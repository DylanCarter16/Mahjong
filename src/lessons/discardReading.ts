// Discard-reading quiz: run a real seeded bot game to a mid-game position,
// then ask questions graded by the same models the bots play with.

import { botAction, dangerScore, type Difficulty } from '../engine/bots'
import { applyAction, createGame, playerView, type GameState, type PlayerView } from '../engine/game'
import { makeRng, shuffle, type Rng } from '../engine/rng'
import { glyph, suitOf, tileName } from '../engine/tiles'
import { SEATS, type Seat, type Suit, type TileId } from '../engine/types'

export interface QuizQuestion {
  kind: 'suit' | 'safest'
  prompt: string
  options: string[]
  /** For safest-tile questions: the tile behind each option. */
  optionTiles?: TileId[]
  opponent?: Seat
  correct: number
  explain: string
}

export interface QuizPosition {
  view: PlayerView
  questions: QuizQuestion[]
}

const NAMES: Record<Seat, string> = { 0: 'you', 1: 'South', 2: 'West', 3: 'North' }
const SUIT_LABELS: Record<Suit, string> = { m: 'Characters 萬', p: 'Circles 筒', s: 'Bamboo 索' }
const DIFFS: Record<Seat, Difficulty> = { 0: 'advanced', 1: 'intermediate', 2: 'advanced', 3: 'intermediate' }

function playTo(seed: string, minDiscards: number): GameState | null {
  let s = createGame({ faanMinimum: 3, flowers: true, faanCap: null }, seed)
  const rng = makeRng(`${seed}-driver`)
  let steps = 0
  const total = () => SEATS.reduce((n: number, seat) => n + s.discards[seat].length, 0)
  while (s.phase !== 'finished' && total() < minDiscards) {
    if (++steps > 2000) return null
    if (s.phase === 'claims') {
      const seat = SEATS.find((x) => playerView(s, x).legal.length > 0)
      if (seat === undefined) return null
      s = applyAction(s, botAction(playerView(s, seat), DIFFS[seat], rng))
    } else {
      s = applyAction(s, botAction(playerView(s, s.turn), DIFFS[s.turn], rng))
    }
  }
  return s.phase === 'finished' ? null : s
}

function suitQuestion(view: PlayerView): QuizQuestion | null {
  // The opponent with the most suit discards makes the clearest read.
  let bestOpp: Seat | null = null
  let bestCount = 2 // need at least a few discards to read anything
  for (const opp of SEATS) {
    if (opp === view.seat) continue
    const suitDiscards = view.discards[opp].filter((t) => suitOf(t) !== null).length
    if (suitDiscards > bestCount) {
      bestOpp = opp
      bestCount = suitDiscards
    }
  }
  if (bestOpp === null) return null
  const counts: Record<Suit, number> = { m: 0, p: 0, s: 0 }
  for (const t of view.discards[bestOpp]) {
    const su = suitOf(t)
    if (su) counts[su]++
  }
  const suits: Suit[] = ['m', 'p', 's']
  const top = suits.reduce((a, b) => (counts[b] > counts[a] ? b : a))
  return {
    kind: 'suit',
    opponent: bestOpp,
    prompt: `Which suit has ${NAMES[bestOpp]} discarded the most?`,
    options: suits.map((su) => SUIT_LABELS[su]),
    correct: suits.indexOf(top),
    explain:
      `${NAMES[bestOpp]} has thrown ${counts.m} Characters, ${counts.p} Circles and ${counts.s} Bamboo. ` +
      `Players rarely throw the suit they are collecting — so ${SUIT_LABELS[top]} is the suit they are least likely to need, ` +
      `and tiles from it are comparatively safer against them.`,
  }
}

const DANGER_WORDS: [number, string][] = [
  [0, 'it is already in their discard pool, so it is safe against them'],
  [1, 'almost every copy is visible, so it can hardly complete a set for them'],
  [2, 'it sits next to ranks they have already thrown away'],
  [3, 'they have discarded that suit heavily, so they are unlikely to be collecting it'],
  [5, 'nothing about their discards makes it safe'],
  [6, 'middle tiles connect to the most possible waits — the most dangerous kind of tile'],
]

function explainDanger(score: number): string {
  let best = DANGER_WORDS[DANGER_WORDS.length - 1][1]
  for (const [s, words] of DANGER_WORDS) if (score >= s) best = words
  return best
}

function safestQuestion(view: PlayerView, rng: Rng): QuizQuestion | null {
  let target: Seat | null = null
  let most = 2
  for (const opp of SEATS) {
    if (opp === view.seat) continue
    if (view.discards[opp].length > most) {
      target = opp
      most = view.discards[opp].length
    }
  }
  if (target === null) return null
  const distinct = [...new Set(view.concealed)]
  if (distinct.length < 3) return null
  const ranked = distinct
    .map((t) => ({ t, d: dangerScore(view, t, target) }))
    .sort((a, b) => a.d - b.d)
  const picks = [ranked[0], ranked[Math.floor(ranked.length / 2)], ranked[ranked.length - 1]]
  if (new Set(picks.map((p) => p.t)).size < 3) return null
  const shuffled = shuffle(picks, rng)
  const correct = shuffled.findIndex((p) => p.t === ranked[0].t)
  return {
    kind: 'safest',
    opponent: target,
    prompt: `${NAMES[target]} looks the most developed. Which of these tiles from your hand is safest to discard?`,
    options: shuffled.map((p) => `${glyph(p.t)} ${tileName(p.t)}`),
    optionTiles: shuffled.map((p) => p.t),
    correct,
    explain:
      `${tileName(ranked[0].t)} is safest: ${explainDanger(ranked[0].d)}. ` +
      `By contrast, ${tileName(ranked[ranked.length - 1].t)} is the riskiest of the three — ${explainDanger(ranked[ranked.length - 1].d)}.`,
  }
}

/** Deterministic for a given seed. Tries a few sub-seeds until a rich position appears. */
export function generatePosition(seed: string, minDiscards = 24): QuizPosition {
  for (let attempt = 0; attempt < 12; attempt++) {
    const need = attempt < 6 ? minDiscards : 12 // relax if games keep ending early
    const state = playTo(`${seed}-${attempt}`, need)
    if (!state) continue
    const view = playerView(state, 0)
    const rng = makeRng(`${seed}-q-${attempt}`)
    const questions = [suitQuestion(view), safestQuestion(view, rng)].filter(
      (q): q is QuizQuestion => q !== null,
    )
    if (questions.length >= 2) return { view, questions }
  }
  throw new Error(`could not generate a quiz position for seed ${seed}`)
}
