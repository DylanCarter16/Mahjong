// Mastery + spaced repetition (SM-2-lite / Leitner boxes). Pure functions —
// the UI hands in `new Date()`, tests hand in fixed clocks.

import type { RoundRecord } from '../analysis/leaks'
import { CONCEPTS, conceptById, type ConceptId } from './concepts'

export const INTERVALS = [0, 1, 2, 4, 8, 16] // days until due, per box
export const DAILY_GOAL = 12
export const UNLOCK_THRESHOLD = 0.6
const EMA_ALPHA = 0.28
const ANSWER_LOG_CAP = 500

export type Confidence = 'guess' | 'sure' | 'certain'

export interface ConceptProgress {
  box: number // 0 = never seen correctly
  due: string // ISO timestamp
  mastery: number // 0..1
  seen: number
  correct: number
}

export interface AnswerRecord {
  concept: ConceptId
  correct: boolean
  ms: number
  difficulty: number
  day: string
  /** Error-pattern metadata from trainers (chosen vs optimal, etc.). */
  tag?: string
}

export interface ProgressState {
  version: 1
  concepts: Partial<Record<ConceptId, ConceptProgress>>
  xp: number
  streak: { count: number; lastGoalDay: string | null }
  today: { day: string; count: number }
  answers: AnswerRecord[]
  calibration: Record<Confidence, { right: number; total: number }>
  /**
   * Graded results of recent PLAYED rounds, for the review's cross-round
   * patterns view. Compact counts, never a log. Added after v1 shipped, so it
   * is written by new code and defaults to empty when an older save is loaded —
   * no version bump needed for a purely additive field.
   */
  rounds: RoundRecord[]
}

export const emptyProgress = (): ProgressState => ({
  version: 1,
  concepts: {},
  xp: 0,
  streak: { count: 0, lastGoalDay: null },
  today: { day: '', count: 0 },
  answers: [],
  calibration: {
    guess: { right: 0, total: 0 },
    sure: { right: 0, total: 0 },
    certain: { right: 0, total: 0 },
  },
  rounds: [],
})

const dayOf = (d: Date) => d.toISOString().slice(0, 10)
const daysBetween = (a: string, b: string) =>
  Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000)

export interface Answer {
  concept: ConceptId
  correct: boolean
  ms: number
  /** 1 easy … 3 hard. Weights both mastery movement and xp. */
  difficulty: number
  timeLimitMs?: number
  confidence?: Confidence
  tag?: string
}

export function gradeAnswer(state: ProgressState, a: Answer, now: Date): ProgressState {
  const s: ProgressState = structuredClone(state)
  const cp: ConceptProgress = s.concepts[a.concept] ?? {
    box: 0,
    due: now.toISOString(),
    mastery: 0,
    seen: 0,
    correct: 0,
  }

  // Correct-but-slow earns less than correct-and-instant on timed items.
  let target = 0
  if (a.correct) {
    if (a.timeLimitMs) {
      const frac = a.ms / a.timeLimitMs
      target = frac <= 0.5 ? 1 : frac <= 1 ? 0.75 : 0.55
    } else target = 1
  }
  const alpha = EMA_ALPHA * (0.8 + 0.2 * Math.min(3, Math.max(1, a.difficulty)))
  cp.mastery = Math.min(1, Math.max(0, cp.mastery + alpha * (target - cp.mastery)))
  cp.box = a.correct ? Math.min(INTERVALS.length - 1, cp.box + 1) : 1
  cp.due = new Date(now.getTime() + INTERVALS[cp.box] * 86_400_000).toISOString()
  cp.seen++
  if (a.correct) cp.correct++
  s.concepts[a.concept] = cp

  s.xp += a.correct ? 10 * Math.min(3, Math.max(1, a.difficulty)) : 2

  const today = dayOf(now)
  if (s.today.day !== today) s.today = { day: today, count: 0 }
  s.today.count++
  if (s.today.count === DAILY_GOAL) {
    const last = s.streak.lastGoalDay
    s.streak.count = last !== null && daysBetween(last, today) === 1 ? s.streak.count + 1 : 1
    s.streak.lastGoalDay = today
    s.xp += 25
  }

  if (a.confidence) {
    s.calibration[a.confidence].total++
    if (a.correct) s.calibration[a.confidence].right++
  }

  s.answers.push({
    concept: a.concept,
    correct: a.correct,
    ms: a.ms,
    difficulty: a.difficulty,
    day: today,
    ...(a.tag ? { tag: a.tag } : {}),
  })
  if (s.answers.length > ANSWER_LOG_CAP) s.answers.splice(0, s.answers.length - ANSWER_LOG_CAP)

  return s
}

export const masteryOf = (s: ProgressState, id: ConceptId): number => s.concepts[id]?.mastery ?? 0

export function isUnlocked(s: ProgressState, id: ConceptId): boolean {
  const c = conceptById.get(id)
  if (!c) return false
  return c.prereqs.every((p) => masteryOf(s, p) >= UNLOCK_THRESHOLD)
}

/** Concepts past their due date, most overdue + weakest first. */
export function dueConcepts(s: ProgressState, now: Date): ConceptId[] {
  const t = now.getTime()
  return CONCEPTS.filter((c) => {
    const cp = s.concepts[c.id]
    return cp && new Date(cp.due).getTime() <= t && isUnlocked(s, c.id)
  })
    .sort((a, b) => {
      const pa = s.concepts[a.id]!
      const pb = s.concepts[b.id]!
      return pa.mastery - pb.mastery || new Date(pa.due).getTime() - new Date(pb.due).getTime()
    })
    .map((c) => c.id)
}

export interface SessionEntry {
  concept: ConceptId
  isNew: boolean
}

export interface SessionPlan {
  entries: SessionEntry[]
}

/**
 * A session is ~12–15 items: everything due (weakest first), a little brand-new
 * unlocked material, and the weakest seen concepts to fill. Never "unit 3,
 * questions 1–5".
 */
export function buildSession(s: ProgressState, now: Date, size = 13): SessionPlan {
  const entries: SessionEntry[] = []
  const seenCount = new Map<ConceptId, number>()
  const push = (concept: ConceptId, isNew: boolean) => {
    if (entries.length >= size) return
    const n = seenCount.get(concept) ?? 0
    if (n >= 4) return // variety guard
    seenCount.set(concept, n + 1)
    entries.push({ concept, isNew })
  }

  for (const id of dueConcepts(s, now)) push(id, false)

  const fresh = CONCEPTS.filter((c) => !s.concepts[c.id] && isUnlocked(s, c.id)).map((c) => c.id)
  for (const id of fresh.slice(0, 3)) push(id, true)

  // Fill with the weakest unlocked concepts, repeating round-robin.
  const pool = CONCEPTS.filter((c) => isUnlocked(s, c.id)).sort(
    (a, b) => masteryOf(s, a.id) - masteryOf(s, b.id),
  )
  let guard = 0
  while (entries.length < size && pool.length > 0 && guard++ < 200) {
    for (const c of pool) {
      if (entries.length >= size) break
      push(c.id, !s.concepts[c.id])
    }
  }
  return { entries }
}

/**
 * Targeted practice on ONE concept (§C2) — "I want to drill defence now"
 * instead of waiting for the chain to reach it.
 *
 * This is a second way IN, not a second progress system: every answer still
 * goes through `gradeAnswer` into the same `ProgressState`, so practising
 * defence raises `defence.*` mastery everywhere, and `buildSession` — which
 * ranks by that same mastery and by `due` — stops feeding you beginner defence
 * items on its own. Nothing here writes state; the caller grades exactly as the
 * main chain does.
 *
 * Prerequisites are deliberately NOT enforced: you may practise anything, and
 * the UI labels a concept whose prereqs aren't mastered as being ahead of the
 * chain. Blocking it would defeat the point of the entry point, and it stays
 * honest — practising a locked concept raises that concept's mastery but does
 * not unlock it, since unlocking is a statement about its PREREQS' mastery.
 */
export function buildFocusedSession(
  s: ProgressState,
  now: Date,
  concept: ConceptId,
  size = 10,
): SessionPlan {
  void now // same signature shape as buildSession; scheduling is the caller's
  const isNew = !s.concepts[concept]
  return { entries: Array.from({ length: size }, () => ({ concept, isNew })) }
}
