import { describe, expect, it } from 'vitest'
import { CONCEPTS } from '../concepts'
import {
  buildSession,
  DAILY_GOAL,
  emptyProgress,
  gradeAnswer,
  INTERVALS,
  isUnlocked,
  type ProgressState,
} from '../mastery'
import { exportJSON, importJSON, loadProgress, saveProgress, type StorageLike } from '../persistence'

const T0 = new Date('2026-07-16T10:00:00Z')
const day = (n: number) => new Date(T0.getTime() + n * 86_400_000)

const answer = (
  s: ProgressState,
  over: Partial<Parameters<typeof gradeAnswer>[1]> = {},
  when = T0,
) =>
  gradeAnswer(s, { concept: 'set.chow', correct: true, ms: 2000, difficulty: 1, ...over }, when)

describe('concepts', () => {
  it('defines ~20 concepts with valid prerequisites', () => {
    expect(CONCEPTS.length).toBeGreaterThanOrEqual(18)
    const ids = new Set(CONCEPTS.map((c) => c.id))
    for (const c of CONCEPTS) for (const p of c.prereqs) expect(ids.has(p)).toBe(true)
  })
})

describe('mastery updates', () => {
  it('rises on correct answers and falls on wrong ones, staying in [0,1]', () => {
    let s = emptyProgress()
    for (let i = 0; i < 10; i++) s = answer(s)
    const high = s.concepts['set.chow']!.mastery
    expect(high).toBeGreaterThan(0.8)
    expect(high).toBeLessThanOrEqual(1)
    s = answer(s, { correct: false })
    expect(s.concepts['set.chow']!.mastery).toBeLessThan(high)
    expect(s.concepts['set.chow']!.mastery).toBeGreaterThanOrEqual(0)
  })

  it('correct-but-slow earns less than correct-and-instant on timed items', () => {
    const fast = answer(emptyProgress(), { ms: 800, timeLimitMs: 3000 })
    const slow = answer(emptyProgress(), { ms: 2900, timeLimitMs: 3000 })
    expect(fast.concepts['set.chow']!.mastery).toBeGreaterThan(slow.concepts['set.chow']!.mastery)
  })

  it('moves through Leitner boxes with the right intervals', () => {
    let s = emptyProgress()
    s = answer(s) // box 0 -> 1
    expect(s.concepts['set.chow']!.box).toBe(1)
    s = answer(s)
    s = answer(s)
    expect(s.concepts['set.chow']!.box).toBe(3)
    const due = new Date(s.concepts['set.chow']!.due).getTime()
    expect(due - T0.getTime()).toBe(INTERVALS[3] * 86_400_000)
    s = answer(s, { correct: false }) // demote to box 1
    expect(s.concepts['set.chow']!.box).toBe(1)
  })
})

describe('unlocking and sessions', () => {
  it('locks concepts until prerequisites reach mastery', () => {
    let s = emptyProgress()
    expect(isUnlocked(s, 'tile.recognition.circles')).toBe(true) // no prereqs
    expect(isUnlocked(s, 'faan.patterns')).toBe(false)
    // master the whole prerequisite chain
    for (const c of CONCEPTS) {
      for (let i = 0; i < 8; i++) s = answer(s, { concept: c.id })
    }
    expect(isUnlocked(s, 'faan.patterns')).toBe(true)
  })

  it('builds sessions from due + new + weakest, never locked ones', () => {
    let s = emptyProgress()
    // learn two basics, one strong, one weak
    for (let i = 0; i < 8; i++) s = answer(s, { concept: 'tile.recognition.circles' })
    s = answer(s, { concept: 'tile.recognition.bamboo', correct: false })
    const plan = buildSession(s, day(20), 13)
    expect(plan.entries.length).toBeGreaterThanOrEqual(12)
    expect(plan.entries.length).toBeLessThanOrEqual(15)
    const ids = plan.entries.map((e) => e.concept)
    // the overdue, weak concept must appear before the strong one
    expect(ids.indexOf('tile.recognition.bamboo')).toBeLessThan(ids.indexOf('tile.recognition.circles'))
    // locked concepts never appear
    for (const id of ids) expect(isUnlocked(s, id)).toBe(true)
    // some brand-new unlocked material is included
    expect(plan.entries.some((e) => e.isNew)).toBe(true)
  })
})

describe('streak, goal and xp', () => {
  it('awards xp and counts the daily goal', () => {
    let s = emptyProgress()
    s = answer(s)
    expect(s.xp).toBeGreaterThan(0)
    expect(s.today.count).toBe(1)
  })

  it('increments the streak when the goal is met on consecutive days', () => {
    let s = emptyProgress()
    for (let i = 0; i < DAILY_GOAL; i++) s = answer(s, {}, day(0))
    expect(s.streak.count).toBe(1)
    for (let i = 0; i < DAILY_GOAL; i++) s = answer(s, {}, day(1))
    expect(s.streak.count).toBe(2)
    // skipping a day resets
    for (let i = 0; i < DAILY_GOAL; i++) s = answer(s, {}, day(4))
    expect(s.streak.count).toBe(1)
  })
})

describe('persistence', () => {
  const mem = (): StorageLike => {
    const m = new Map<string, string>()
    return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) }
  }

  it('round-trips through storage and export/import', () => {
    const storage = mem()
    let s = emptyProgress()
    for (let i = 0; i < 5; i++) s = answer(s)
    saveProgress(storage, s)
    expect(loadProgress(storage)).toEqual(s)
    const imported = importJSON(exportJSON(s))
    expect(imported).toEqual(s)
  })

  it('survives corrupt or foreign payloads', () => {
    const storage = mem()
    storage.setItem('mahjong.progress.v1', '{not json')
    expect(loadProgress(storage).version).toBe(1)
    expect(importJSON('"just a string"')).toBeNull()
    expect(importJSON('{"version": 999}')).toBeNull()
  })

  it('backfills missing fields from older/partial payloads', () => {
    const partial = { version: 1, concepts: {}, xp: 40 }
    const s = importJSON(JSON.stringify(partial))
    expect(s).not.toBeNull()
    expect(s!.xp).toBe(40)
    expect(s!.streak).toEqual({ count: 0, lastGoalDay: null })
    expect(s!.answers).toEqual([])
  })

  it('caps the answer log', () => {
    let s = emptyProgress()
    for (let i = 0; i < 600; i++) s = answer(s)
    expect(s.answers.length).toBeLessThanOrEqual(500)
  })
})
