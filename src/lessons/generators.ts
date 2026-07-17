// Procedural lesson-item generators (§4.3). Every generator takes a
// difficulty, consumes a seeded Rng (reproducible), and validates answers by
// calling the engine — no rule is ever re-encoded here.

import { scoreBest, winDeclarable, type ScoringContext } from '../engine/fan'
import type { PlayerView } from '../engine/game'
import { shuffle, type Rng } from '../engine/rng'
import { shanten } from '../engine/shanten'
import { ALL_PLAY_KINDS, isHonour, sortTiles, suitOf, tileName } from '../engine/tiles'
import type { TileId, Wind } from '../engine/types'
import { decompose, isValidChow, isValidPung, isWinningHand } from '../engine/win'
import type { ConceptId } from './concepts'
import { generatePosition } from './discardReading'
import { generateHand, gradeDiscard } from './efficiencyTrainer'

export type Difficulty = 1 | 2 | 3

export type ItemExercise =
  | {
      kind: 'choice'
      prompt: string
      showTiles?: TileId[]
      options: string[]
      optionTiles?: TileId[]
      correct: number
    }
  | {
      kind: 'build'
      prompt: string
      pool: TileId[]
      pick: number
      isCorrect: (sel: TileId[]) => boolean
    }
  | {
      kind: 'group'
      prompt: string
      tiles: TileId[]
    }

export interface LessonItem {
  concept: ConceptId
  difficulty: Difficulty
  timeLimitMs?: number
  exercise: ItemExercise
  /** Engine-fact explanation shown after the one allowed answer. */
  explain: string
  /** For items generated from a game position: the board to show (pools, melds, hand). */
  board?: PlayerView
}

const pick = <T,>(xs: readonly T[], rng: Rng): T => xs[Math.floor(rng.next() * xs.length)]

// ---------------------------------------------------------------------------
// Winning-hand construction (engine-validated, count-safe)

export function randomWinningHand(rng: Rng, bias?: 'one-suit' | 'honour-heavy'): TileId[] {
  for (let attempt = 0; attempt < 200; attempt++) {
    const counts = new Map<TileId, number>()
    const take = (t: TileId, n: number): boolean => {
      const c = counts.get(t) ?? 0
      if (c + n > 4) return false
      counts.set(t, c + n)
      return true
    }
    const suits = bias === 'one-suit' ? [pick(['m', 'p', 's'] as const, rng)] : (['m', 'p', 's'] as const)
    const honourKinds = ALL_PLAY_KINDS.filter(isHonour)
    const tiles: TileId[] = []

    const pairKind =
      bias === 'honour-heavy' || (bias !== 'one-suit' && rng.next() < 0.25)
        ? pick(honourKinds, rng)
        : `${pick(suits, rng)}${1 + Math.floor(rng.next() * 9)}`
    if (!take(pairKind, 2)) continue
    tiles.push(pairKind, pairKind)

    let ok = true
    for (let m = 0; m < 4 && ok; m++) {
      const wantHonour = bias === 'honour-heavy' ? rng.next() < 0.5 : rng.next() < 0.15
      if (wantHonour) {
        const k = pick(honourKinds, rng)
        ok = take(k, 3)
        if (ok) tiles.push(k, k, k)
      } else if (rng.next() < 0.55) {
        const suit = pick(suits, rng)
        const start = 1 + Math.floor(rng.next() * 7)
        const run = [`${suit}${start}`, `${suit}${start + 1}`, `${suit}${start + 2}`]
        ok = run.every((t) => take(t, 1))
        if (ok) tiles.push(...run)
      } else {
        const k = `${pick(suits, rng)}${1 + Math.floor(rng.next() * 9)}`
        ok = take(k, 3)
        if (ok) tiles.push(k, k, k)
      }
    }
    if (!ok) continue
    const hand = sortTiles(tiles)
    if (isWinningHand(hand, [])) return hand
  }
  throw new Error('could not build a winning hand')
}

const defaultCtx = (over: Partial<ScoringContext> = {}): ScoringContext => ({
  seatWind: 'E',
  roundWind: 'E',
  selfDraw: false,
  flowers: [],
  fullyConcealed: false,
  lastWallTile: false,
  kongReplacement: false,
  ...over,
})

// ---------------------------------------------------------------------------
// 1. Recognition — timed tile naming with confusable distractors.

function recognitionDistractors(tile: TileId, difficulty: Difficulty, rng: Rng): TileId[] {
  const out = new Set<TileId>()
  const suit = suitOf(tile)
  if (suit) {
    const r = Number(tile[1])
    // hardest confusions first: same rank other suits, then adjacent ranks
    for (const s of ['m', 'p', 's']) if (s !== suit) out.add(`${s}${r}`)
    if (difficulty >= 2) {
      if (r > 1) out.add(`${suit}${r - 1}`)
      if (r < 9) out.add(`${suit}${r + 1}`)
    }
  } else {
    for (const k of ALL_PLAY_KINDS.filter(isHonour)) if (k !== tile) out.add(k)
  }
  return shuffle([...out], rng).slice(0, 3)
}

export function genRecognition(difficulty: Difficulty, rng: Rng): LessonItem {
  const domain = pick(['m', 'p', 's', 'honour'] as const, rng)
  const tile =
    domain === 'honour'
      ? pick(ALL_PLAY_KINDS.filter(isHonour), rng)
      : `${domain}${1 + Math.floor(rng.next() * 9)}`
  const concept: ConceptId =
    domain === 'honour'
      ? 'tile.recognition.honours'
      : domain === 'm'
        ? 'tile.recognition.characters'
        : domain === 'p'
          ? 'tile.recognition.circles'
          : 'tile.recognition.bamboo'
  const optionsTiles = shuffle([tile, ...recognitionDistractors(tile, difficulty, rng)], rng)
  return {
    concept,
    difficulty,
    // Generous at first — speed still counts (fast answers earn more mastery),
    // but the clock should pressure, not ambush.
    timeLimitMs: [6000, 4500, 3000][difficulty - 1],
    exercise: {
      kind: 'choice',
      prompt: 'Name this tile',
      showTiles: [tile],
      options: optionsTiles.map(tileName),
      correct: optionsTiles.indexOf(tile),
    },
    explain: `This is ${tileName(tile)}. Speed matters — at a real table you read your hand between turns.`,
  }
}

// ---------------------------------------------------------------------------
// 2. Set spotting — tap a valid chow/pung among decoys that almost work.

export function genSetSpotting(difficulty: Difficulty, rng: Rng): LessonItem {
  const wantPung = rng.next() < 0.4
  const suit = pick(['m', 'p', 's'] as const, rng)
  const pool: TileId[] = []
  let prompt: string

  if (wantPung) {
    const k = `${suit}${1 + Math.floor(rng.next() * 9)}`
    pool.push(k, k, k)
    prompt = 'Select a valid PUNG (three identical tiles)'
    // decoys: a near-pair and honours
    const other = `${suit}${1 + Math.floor(rng.next() * 9)}`
    pool.push(other, other === k ? 'wE' : other, 'dG')
  } else {
    const start = 1 + Math.floor(rng.next() * 7)
    pool.push(`${suit}${start}`, `${suit}${start + 1}`, `${suit}${start + 2}`)
    prompt = 'Select a valid CHOW (three consecutive tiles, one suit)'
    if (difficulty >= 2) {
      // the classic trap: 9-1-2 pieces that wrap
      pool.push(`${suit}9`, `${suit}1`, `${suit}2`)
    }
    if (difficulty >= 2) {
      // mixed-suit run decoy
      const others = (['m', 'p', 's'] as const).filter((s) => s !== suit)
      pool.push(`${others[0]}4`, `${others[1]}5`)
    } else {
      pool.push('wN', `${suit === 'm' ? 'p' : 'm'}5`)
    }
  }

  const shuffled = shuffle(pool, rng)
  return {
    concept: wantPung ? 'set.pung-kong' : 'set.chow',
    difficulty,
    exercise: {
      kind: 'build',
      prompt,
      pool: shuffled,
      pick: 3,
      isCorrect: (sel) => (wantPung ? isValidPung(sel) : isValidChow(sel)),
    },
    explain: wantPung
      ? 'A pung is three identical tiles — any kind, including winds and dragons.'
      : 'A chow is three consecutive tiles in ONE suit. Runs never wrap 9→1, and honours never form chows.',
  }
}

// ---------------------------------------------------------------------------
// 3. Is this a winning hand? — near-misses only.

/** Seven distinct pairs, or the same with one pair broken (near-miss). */
function sevenPairsHand(rng: Rng, complete: boolean): TileId[] {
  const kinds = shuffle([...ALL_PLAY_KINDS], rng).slice(0, complete ? 7 : 8)
  const tiles = complete
    ? kinds.flatMap((k) => [k, k])
    : [...kinds.slice(0, 6).flatMap((k) => [k, k]), kinds[6], kinds[7]]
  return sortTiles(tiles)
}

const ORPHANS: TileId[] = ['m1', 'm9', 'p1', 'p9', 's1', 's9', 'wE', 'wS', 'wW', 'wN', 'dR', 'dG', 'dW']

function orphansHand(rng: Rng, complete: boolean): TileId[] {
  const dup = pick(ORPHANS, rng)
  const tiles = complete ? [...ORPHANS, dup] : [...ORPHANS.filter((t) => t !== 'dW'), dup, pick(['m5', 'p4', 's6'], rng)]
  return sortTiles(tiles)
}

export function genWinningYN(difficulty: Difficulty, rng: Rng): LessonItem {
  const winning = rng.next() < 0.5
  const shape = rng.next() < 0.6 ? 'standard' : rng.next() < 0.7 ? 'sevenPairs' : 'orphans'
  const hand =
    shape === 'sevenPairs'
      ? sevenPairsHand(rng, winning)
      : shape === 'orphans'
        ? orphansHand(rng, winning)
        : winning
          ? randomWinningHand(rng)
          : generateHand(difficulty >= 2 ? 0 : 1, rng) // shanten 0 = one off: pattern-matching fails
  const answer = isWinningHand(hand, [])
  const options = ['Yes — it wins', 'No — not yet']
  const best = answer ? null : shanten(hand, [])
  return {
    concept:
      shape === 'sevenPairs'
        ? 'shape.seven-pairs'
        : shape === 'orphans'
          ? 'shape.thirteen-orphans'
          : 'shape.standard',
    difficulty,
    exercise: {
      kind: 'choice',
      prompt: 'Is this a complete winning hand?',
      showTiles: hand,
      options,
      correct: answer ? 0 : 1,
    },
    explain: answer
      ? 'It decomposes into four sets and a pair — complete.'
      : `Close but no: this hand is ${best === 0 ? 'one tile away (tenpai)' : `${best} steps from ready`}. You have to actually decompose it — the shape lies.`,
  }
}

// ---------------------------------------------------------------------------
// 4. Decompose it — tap out the sets; ANY valid reading is accepted.

export function genDecompose(difficulty: Difficulty, rng: Rng): LessonItem {
  const hand = randomWinningHand(rng, difficulty >= 2 ? 'one-suit' : undefined)
  const readings = decompose(hand, [])
  return {
    concept: 'shape.decompose',
    difficulty,
    exercise: {
      kind: 'group',
      prompt: 'Tap tiles in groups of three to carve out the four sets; the pair is what remains.',
      tiles: hand,
    },
    explain:
      readings.length > 1
        ? `This hand has ${readings.length} valid readings — any of them counts. Scoring always takes the most valuable one.`
        : 'One clean reading: four sets and the pair.',
  }
}

// ---------------------------------------------------------------------------
// 5. Faan counting — distractors are the *specific* mistakes the rules invite.

export function genFaanCount(difficulty: Difficulty, rng: Rng): LessonItem {
  const bias = difficulty === 3 ? 'one-suit' : difficulty === 2 && rng.next() < 0.5 ? 'honour-heavy' : undefined
  const hand = randomWinningHand(rng, bias)
  const seatWind = pick(['E', 'S', 'W', 'N'] as Wind[], rng)
  const ctx = defaultCtx({ seatWind, roundWind: 'E', selfDraw: rng.next() < 0.4 })
  const result = scoreBest(decompose(hand, []), ctx)
  const total = result.totalFaan

  const names = result.patterns.map((p) => p.name)
  const wrongs = new Set<number>()
  // double-counting Mixed under Pure
  if (names.includes('Pure One Suit')) wrongs.add(total + 3)
  // missing seat/round wind or self-draw
  if (names.some((n) => n === 'Seat Wind' || n === 'Round Wind' || n === 'Self-draw')) wrongs.add(total - 1)
  // counting Small Dragons/Winds under Great, or dragon pungs under Small
  if (names.includes('Great Dragons')) wrongs.add(total + 4)
  if (names.includes('Small Dragons')) wrongs.add(total + 2)
  wrongs.add(total + 1)
  wrongs.add(Math.max(0, total - 2))
  wrongs.delete(total)
  const options = shuffle([total, ...[...wrongs].slice(0, 3)], rng)

  return {
    concept: names.length > 1 || names.includes('Pure One Suit') ? 'faan.exclusivity' : 'faan.patterns',
    difficulty,
    exercise: {
      kind: 'choice',
      prompt: `Won by ${ctx.selfDraw ? 'self-draw' : 'discard'}, seat ${seatWind}, round E. How many faan?`,
      showTiles: hand,
      options: options.map(String),
      correct: options.indexOf(total),
    },
    explain:
      result.patterns.length === 0
        ? 'A chicken hand — no patterns fire, 0 faan.'
        : `${result.patterns.map((p) => `${p.name} ${p.faan}`).join(' + ')} = ${total} faan. Watch the subsumptions: superseded patterns never add.`,
  }
}

// ---------------------------------------------------------------------------
// 6. Can I declare? — the minimum, with the 0-minimum family case prominent.

export function genCanDeclare(difficulty: Difficulty, rng: Rng): LessonItem {
  const minimum = pick([0, 0, 1, 3, 3] as const, rng) // 0 prominent by design
  const hand = randomWinningHand(rng, difficulty >= 2 ? undefined : undefined)
  const ctx = defaultCtx({ selfDraw: rng.next() < 0.5 })
  const total = scoreBest(decompose(hand, []), ctx).totalFaan
  const can = winDeclarable(total, minimum)
  return {
    concept: 'declare.minimum',
    difficulty,
    exercise: {
      kind: 'choice',
      prompt: `Your hand is complete (worth ${total} faan, won by ${ctx.selfDraw ? 'self-draw' : 'discard'}). The table minimum is ${minimum}. Can you declare?`,
      showTiles: hand,
      options: ['Yes — declare it', 'No — below the minimum'],
      correct: can ? 0 : 1,
    },
    explain: can
      ? `${total} faan meets the minimum of ${minimum}${minimum === 0 ? ' — with family rules (0 minimum) every complete hand wins' : ''}.`
      : `${total} faan is under the ${minimum}-faan minimum: complete but undeclarable. Add value or wait for a scoring condition.`,
  }
}

// ---------------------------------------------------------------------------
// 7. Best discard — the efficiency trainer as a scheduled item.

export function genBestDiscard(difficulty: Difficulty, rng: Rng): LessonItem {
  const hand = generateHand(difficulty, rng)
  const grade = gradeDiscard(hand, hand[0]) // grading table for the whole hand
  const best = grade.best
  return {
    concept: 'efficiency.discard-choice',
    difficulty,
    exercise: {
      kind: 'build',
      prompt: 'Pick the most efficient discard.',
      pool: hand,
      pick: 1,
      isCorrect: (sel) => best.includes(sel[0]),
    },
    explain: `Best: ${best.map(tileName).join(' or ')} — ${grade.perDiscard
      .filter((e) => best.includes(e.tile))
      .slice(0, 1)
      .map((e) => `${e.shantenAfter === -1 ? 'wins' : `${e.shantenAfter} shanten`}, ${e.liveCount} live tiles`)
      .join('')}. Efficiency = lowest shanten first, then the widest wait.`,
  }
}

// ---------------------------------------------------------------------------
// 8 & 9. Reading and safety — real seeded positions.

export function genSuitRead(difficulty: Difficulty, rng: Rng): LessonItem {
  const pos = generatePosition(`gen-read-${Math.floor(rng.next() * 1e9)}`, 16 + difficulty * 8)
  const q = pos.questions.find((x) => x.kind === 'suit') ?? pos.questions[0]
  return {
    concept: 'read.suit-inference',
    difficulty,
    exercise: { kind: 'choice', prompt: q.prompt, options: q.options, correct: q.correct },
    explain: q.explain,
    board: pos.view, // the question is unanswerable without the pools
  }
}

export function genSafeTile(difficulty: Difficulty, rng: Rng): LessonItem {
  const pos = generatePosition(`gen-safe-${Math.floor(rng.next() * 1e9)}`, 16 + difficulty * 8)
  const q = pos.questions.find((x) => x.kind === 'safest')
  if (!q) return genSuitRead(difficulty, rng) // rare fallback, still engine-graded
  return {
    concept: 'defence.safe-tiles',
    difficulty,
    exercise: {
      kind: 'choice',
      prompt: q.prompt,
      options: q.options,
      ...(q.optionTiles ? { optionTiles: q.optionTiles } : {}),
      correct: q.correct,
    },
    explain: q.explain,
    board: pos.view, // the question is unanswerable without the pools
  }
}

// ---------------------------------------------------------------------------

export const GENERATORS: Partial<Record<ConceptId, (d: Difficulty, rng: Rng) => LessonItem>> = {
  'tile.recognition.characters': genRecognition,
  'tile.recognition.circles': genRecognition,
  'tile.recognition.bamboo': genRecognition,
  'tile.recognition.honours': genRecognition,
  'set.chow': genSetSpotting,
  'set.pung-kong': genSetSpotting,
  'shape.standard': genWinningYN,
  'shape.decompose': genDecompose,
  'shape.seven-pairs': genWinningYN,
  'shape.thirteen-orphans': genWinningYN,
  'faan.patterns': genFaanCount,
  'faan.exclusivity': genFaanCount,
  'declare.minimum': genCanDeclare,
  'efficiency.shanten': genWinningYN,
  'efficiency.ukeire': genBestDiscard,
  'efficiency.discard-choice': genBestDiscard,
  'defence.safe-tiles': genSafeTile,
  'defence.push-fold': genSafeTile,
  'read.suit-inference': genSuitRead,
  'read.threat': genSuitRead,
}

/** Generate an item for a concept; generators re-roll until the item's actual
 *  concept tag matches when the generator serves several concepts. */
export function generateItem(concept: ConceptId, difficulty: Difficulty, rng: Rng): LessonItem {
  const gen = GENERATORS[concept]
  if (!gen) throw new Error(`no generator for ${concept}`)
  for (let i = 0; i < 8; i++) {
    const item = gen(difficulty, rng)
    if (item.concept === concept) return item
  }
  // Serve the last roll under the requested concept's banner (same skill family).
  const item = gen(difficulty, rng)
  return { ...item, concept }
}
