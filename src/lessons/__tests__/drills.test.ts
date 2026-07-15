import { describe, expect, it } from 'vitest'
import { dangerScore } from '../../engine/bots'
import { makeRng } from '../../engine/rng'
import { shanten } from '../../engine/shanten'
import { hand } from '../../engine/tiles'
import { generateHand, gradeDiscard } from '../efficiencyTrainer'
import { generatePosition } from '../discardReading'

describe('tile efficiency trainer', () => {
  it('generates 14-tile hands at the requested shanten', () => {
    for (const target of [0, 1, 2]) {
      for (const seed of ['a', 'b', 'c']) {
        const h = generateHand(target, makeRng(`${target}-${seed}`))
        expect(h).toHaveLength(14)
        expect(shanten(h, [])).toBe(target)
      }
    }
  })

  it('grades a hand-verified example', () => {
    // 4 complete sets + m7 m9: dropping a wind keeps the widest wait (m8 ×4);
    // dropping m7 keeps a pair wait on m9 (×3); breaking a set is just worse.
    const h = hand('m1 m2 m3 p4 p5 p6 s4 s5 s6 m7 m9 wE wE wE')
    expect(gradeDiscard(h, 'wE').verdict).toBe('optimal')
    expect(gradeDiscard(h, 'm7').verdict).toBe('acceptable')
    expect(gradeDiscard(h, 's4').verdict).toBe('bad')

    const g = gradeDiscard(h, 'wE')
    const wE = g.perDiscard.find((d) => d.tile === 'wE')!
    const m7 = g.perDiscard.find((d) => d.tile === 'm7')!
    expect(wE.shantenAfter).toBe(0)
    expect(wE.liveCount).toBe(4) // all four m8 unseen
    expect(m7.shantenAfter).toBe(0)
    expect(m7.liveCount).toBe(3) // one m9 already in hand
    const s4 = g.perDiscard.find((d) => d.tile === 's4')!
    expect(s4.shantenAfter).toBe(1)
  })
})

describe('discard-reading quiz', () => {
  it('is deterministic for a given seed', () => {
    const a = generatePosition('quiz-seed-1')
    const b = generatePosition('quiz-seed-1')
    expect(a).toEqual(b)
  })

  it('produces a mid-game position with both question types', () => {
    const p = generatePosition('quiz-seed-2')
    const totalDiscards = [0, 1, 2, 3].reduce((n, s) => n + p.view.discards[s as 0].length, 0)
    expect(totalDiscards).toBeGreaterThanOrEqual(8)
    expect(p.questions.length).toBeGreaterThanOrEqual(2)
    for (const q of p.questions) {
      expect(q.options.length).toBeGreaterThanOrEqual(3)
      expect(q.correct).toBeGreaterThanOrEqual(0)
      expect(q.correct).toBeLessThan(q.options.length)
      expect(q.explain.length).toBeGreaterThan(10)
    }
  })

  it('the safest-tile answer agrees with the engine danger model', () => {
    const p = generatePosition('quiz-seed-3')
    const q = p.questions.find((q) => q.kind === 'safest')
    expect(q).toBeDefined()
    const danger = (t: string) => dangerScore(p.view, t, q!.opponent!)
    const optionDangers = q!.optionTiles!.map(danger)
    expect(danger(q!.optionTiles![q!.correct])).toBe(Math.min(...optionDangers))
  })
})
