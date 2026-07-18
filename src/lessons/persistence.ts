// Progress persistence: one versioned localStorage key with a migration
// path, plus export/import so progress survives a cleared cache.
// The API key NEVER goes through here — storage is for lesson progress and
// nothing secret.

import { conceptById, type ConceptId } from './concepts'
import { emptyProgress, type AnswerRecord, type ConceptProgress, type ProgressState } from './mastery'

export const STORAGE_KEY = 'mahjong.progress.v1'

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

// Import is untrusted input (a file the user pastes/uploads). migrate REBUILDS
// the state from validated primitives — it never passes a nested object through
// by reference and never assigns an untrusted key. That closes both the
// prototype-pollution surface (only known ConceptIds, never '__proto__', are
// ever used as keys) and the malformed-data surface (every field is coerced to
// a safe default) the audit flagged for the import path.

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const num = (v: unknown, fallback = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)
const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback)
const clamp01 = (n: number) => Math.max(0, Math.min(1, n))

const MAX_ANSWERS = 5000

function cleanConcepts(raw: unknown): Partial<Record<ConceptId, ConceptProgress>> {
  const out: Partial<Record<ConceptId, ConceptProgress>> = {}
  if (!isObj(raw)) return out
  for (const key of Object.keys(raw)) {
    // Only KNOWN concept ids — '__proto__'/'constructor'/unknown keys never
    // reach the assignment below, so a crafted import can't pollute anything.
    if (!conceptById.has(key as ConceptId)) continue
    const v = raw[key]
    if (!isObj(v)) continue
    out[key as ConceptId] = {
      box: num(v.box),
      due: str(v.due),
      mastery: clamp01(num(v.mastery)),
      seen: num(v.seen),
      correct: num(v.correct),
    }
  }
  return out
}

function cleanAnswers(raw: unknown): AnswerRecord[] {
  if (!Array.isArray(raw)) return []
  const out: AnswerRecord[] = []
  for (const a of raw.slice(0, MAX_ANSWERS)) {
    if (!isObj(a) || !conceptById.has(a.concept as ConceptId)) continue
    const rec: AnswerRecord = {
      concept: a.concept as ConceptId,
      correct: a.correct === true,
      ms: num(a.ms),
      difficulty: num(a.difficulty, 1),
      day: str(a.day),
    }
    if (typeof a.tag === 'string') rec.tag = a.tag.slice(0, 40)
    out.push(rec)
  }
  return out
}

function cleanCalibration(raw: unknown): ProgressState['calibration'] {
  const bucket = (b: unknown) => (isObj(b) ? { right: num(b.right), total: num(b.total) } : { right: 0, total: 0 })
  return { guess: bucket(isObj(raw) ? raw.guess : null), sure: bucket(isObj(raw) ? raw.sure : null), certain: bucket(isObj(raw) ? raw.certain : null) }
}

/** Versioned migration: unknown/corrupt → null; v1 → rebuilt & validated. */
export function migrate(raw: unknown): ProgressState | null {
  if (!isObj(raw) || raw.version !== 1) return null // future versions chain here
  const base = emptyProgress()
  const streak = isObj(raw.streak)
    ? { count: num(raw.streak.count), lastGoalDay: typeof raw.streak.lastGoalDay === 'string' ? raw.streak.lastGoalDay : null }
    : base.streak
  const today = isObj(raw.today) ? { day: str(raw.today.day), count: num(raw.today.count) } : base.today
  return {
    version: 1,
    concepts: cleanConcepts(raw.concepts),
    xp: Math.max(0, num(raw.xp)),
    streak,
    today,
    answers: cleanAnswers(raw.answers),
    calibration: cleanCalibration(raw.calibration),
  }
}

export function loadProgress(storage: StorageLike): ProgressState {
  try {
    const raw = storage.getItem(STORAGE_KEY)
    if (!raw) return emptyProgress()
    return migrate(JSON.parse(raw)) ?? emptyProgress()
  } catch {
    return emptyProgress()
  }
}

export function saveProgress(storage: StorageLike, state: ProgressState): void {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // storage full or unavailable — the session continues in memory
  }
}

export const exportJSON = (state: ProgressState): string => JSON.stringify(state, null, 2)

export function importJSON(text: string): ProgressState | null {
  try {
    return migrate(JSON.parse(text))
  } catch {
    return null
  }
}
