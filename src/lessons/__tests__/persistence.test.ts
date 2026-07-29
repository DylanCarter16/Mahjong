import { describe, expect, it } from 'vitest'
import { emptyProgress } from '../mastery'
import { exportJSON, importJSON, migrate } from '../persistence'

describe('progress import hardening (audit I1)', () => {
  it('round-trips a valid export', () => {
    const s = emptyProgress()
    s.xp = 42
    s.concepts['tile.recognition.characters'] = { box: 2, due: '2026-01-01', mastery: 0.5, seen: 4, correct: 3 }
    const back = importJSON(exportJSON(s))
    expect(back).not.toBeNull()
    expect(back!.xp).toBe(42)
    expect(back!.concepts['tile.recognition.characters']).toMatchObject({ box: 2, mastery: 0.5 })
  })

  it('does not pollute Object.prototype from a crafted __proto__ payload', () => {
    const evil = '{"version":1,"concepts":{"__proto__":{"box":999,"polluted":true}},"xp":0}'
    const out = importJSON(evil)
    expect(out).not.toBeNull()
    // The dangerous key was dropped (not a known ConceptId) and nothing leaked
    // onto the prototype.
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    expect(Object.prototype.hasOwnProperty.call(out!.concepts, '__proto__')).toBe(false)
    expect(({} as { box?: unknown }).box).toBeUndefined()
  })

  it('ignores a crafted constructor/prototype payload', () => {
    const out = importJSON('{"version":1,"concepts":{"constructor":{"box":1},"prototype":{"box":2}}}')
    expect(out).not.toBeNull()
    expect(Object.keys(out!.concepts)).toEqual([]) // neither is a known concept id
  })

  it('drops unknown concept ids and coerces malformed records', () => {
    const out = migrate({
      version: 1,
      concepts: {
        'not.a.real.concept': { box: 5 },
        'tile.recognition.circles': { box: 'nope', due: 7, mastery: 9, seen: null, correct: 2 },
      },
      xp: 'lots',
      streak: 'nope',
      today: 42,
      answers: 'not an array',
      calibration: { guess: 'x' },
    })
    expect(out).not.toBeNull()
    expect(out!.concepts['not.a.real.concept' as never]).toBeUndefined()
    // Malformed record coerced: bad numbers → 0, mastery clamped to [0,1].
    expect(out!.concepts['tile.recognition.circles']).toMatchObject({ box: 0, mastery: 1, seen: 0, correct: 2 })
    expect(out!.xp).toBe(0)
    expect(out!.answers).toEqual([])
    expect(out!.calibration.guess).toEqual({ right: 0, total: 0 })
  })

  it('drops malformed answer records and caps the array', () => {
    const answers = [
      { concept: 'tile.recognition.bamboo', correct: true, ms: 100, difficulty: 1, day: '2026-01-01' },
      { concept: 'bogus', correct: true, ms: 1, difficulty: 1, day: 'x' }, // unknown concept → dropped
      'garbage',
      null,
    ]
    const out = migrate({ version: 1, answers })
    expect(out!.answers).toHaveLength(1)
    expect(out!.answers[0].concept).toBe('tile.recognition.bamboo')
  })

  it('rejects version mismatch and non-objects', () => {
    expect(migrate({ version: 2 })).toBeNull()
    expect(migrate({ concepts: {} })).toBeNull() // no version
    expect(migrate(null)).toBeNull()
    expect(migrate([1, 2, 3])).toBeNull()
    expect(importJSON('not json at all')).toBeNull()
  })
})
