import { describe, expect, it } from 'vitest'
import { scoreBest, winDeclarable } from '../../engine/fan'
import { makeRng } from '../../engine/rng'
import { tileName } from '../../engine/tiles'
import { decompose, isValidChow, isValidPung, isWinningHand } from '../../engine/win'
import { gradeDiscard } from '../efficiencyTrainer'
import { SEATS } from '../../engine/types'
import {
  genBestDiscard,
  genCanDeclare,
  genDecompose,
  genFaanCount,
  genRecognition,
  genSafeTile,
  genSetSpotting,
  genSuitRead,
  genWinningYN,
  generateItem,
  randomWinningHand,
} from '../generators'

const seeds = ['a', 'b', 'c', 'd']

describe('randomWinningHand', () => {
  it('always builds engine-verified winning hands', () => {
    for (const s of seeds) {
      const h = randomWinningHand(makeRng(s))
      expect(h).toHaveLength(14)
      expect(isWinningHand(h, [])).toBe(true)
    }
    expect(isWinningHand(randomWinningHand(makeRng('x'), 'one-suit'), [])).toBe(true)
  })
})

describe('generators are seeded and engine-validated', () => {
  it('recognition: correct option is the tile name; timed', () => {
    for (const s of seeds) {
      const item = genRecognition(2, makeRng(s))
      // Generous timing so recognition pressures without ambushing (difficulty
      // 1/2/3 = 12/8/5s); the ItemRunner also gates timed items behind a tap.
      expect(item.timeLimitMs).toBe(8000)
      const ex = item.exercise
      if (ex.kind !== 'choice') throw new Error('expected choice')
      expect(ex.options[ex.correct]).toBe(tileName(ex.showTiles![0]))
      expect(new Set(ex.options).size).toBe(ex.options.length)
    }
  })

  // Regression guard: discard-reading items are UNANSWERABLE without the
  // discard pools on screen. The board must be attached and actually carry
  // discards, or the "main lessons" reading questions become impossible.
  it('discard-reading items always carry a board with visible discards', () => {
    for (const s of [...seeds, 'e', 'f', 'g']) {
      for (const gen of [genSuitRead, genSafeTile]) {
        const item = gen(2, makeRng(s))
        expect(item.board, `${gen.name} must attach a board`).toBeDefined()
        let totalDiscards = 0
        for (const seat of SEATS) totalDiscards += item.board!.discards[seat].length
        expect(totalDiscards, `${gen.name} board must have discards to read`).toBeGreaterThan(0)
      }
    }
  })

  it('set spotting: a valid pick exists and wraps are rejected', () => {
    for (const s of seeds) {
      const item = genSetSpotting(2, makeRng(s))
      const ex = item.exercise
      if (ex.kind !== 'build') throw new Error('expected build')
      // brute-force: some 3-subset must validate
      let found = false
      const n = ex.pool.length
      for (let i = 0; i < n && !found; i++)
        for (let j = i + 1; j < n && !found; j++)
          for (let k = j + 1; k < n && !found; k++) {
            if (ex.isCorrect([ex.pool[i], ex.pool[j], ex.pool[k]])) found = true
          }
      expect(found).toBe(true)
      // a 9-1-2 wrap is never a chow
      expect(isValidChow(['m9', 'm1', 'm2'])).toBe(false)
      expect(isValidPung(['m9', 'm9', 'm1'])).toBe(false)
    }
  })

  it('winning-Y/N answers agree with the engine exactly', () => {
    for (const s of [...seeds, 'e', 'f', 'g', 'h']) {
      const item = genWinningYN(2, makeRng(s))
      const ex = item.exercise
      if (ex.kind !== 'choice') throw new Error('expected choice')
      expect(ex.correct).toBe(isWinningHand(ex.showTiles!, []) ? 0 : 1)
    }
  })

  it('decompose items are winning hands', () => {
    for (const s of seeds) {
      const item = genDecompose(2, makeRng(s))
      const ex = item.exercise
      if (ex.kind !== 'group') throw new Error('expected group')
      expect(isWinningHand(ex.tiles, [])).toBe(true)
      expect(decompose(ex.tiles, []).length).toBeGreaterThanOrEqual(1)
    }
  })

  it('faan counting: exactly one option is the engine total', () => {
    for (const s of seeds) {
      const item = genFaanCount(3, makeRng(s))
      const ex = item.exercise
      if (ex.kind !== 'choice') throw new Error('expected choice')
      const totals = ex.options.map(Number)
      expect(new Set(totals).size).toBe(totals.length)
      // recompute from prompt context via the explain path: prompt carries seat
      const seat = /seat (\w)/.exec(ex.prompt)![1] as 'E' | 'S' | 'W' | 'N'
      const selfDraw = ex.prompt.includes('self-draw')
      const truth = scoreBest(decompose(ex.showTiles!, []), {
        seatWind: seat,
        roundWind: 'E',
        selfDraw,
        flowers: [],
        fullyConcealed: false,
        lastWallTile: false,
        kongReplacement: false,
      }).totalFaan
      expect(totals[ex.correct]).toBe(truth)
      expect(totals.filter((t) => t === truth)).toHaveLength(1)
    }
  })

  it('can-I-declare agrees with winDeclarable', () => {
    for (const s of [...seeds, 'e', 'f']) {
      const item = genCanDeclare(1, makeRng(s))
      const ex = item.exercise
      if (ex.kind !== 'choice') throw new Error('expected choice')
      const min = Number(/minimum is (\d)/.exec(ex.prompt)![1])
      const total = Number(/worth (\d+) faan/.exec(ex.prompt)![1])
      expect(ex.correct).toBe(winDeclarable(total, min) ? 0 : 1)
    }
  })

  it('best-discard accepts exactly the trainer-optimal tiles', () => {
    for (const s of seeds) {
      const item = genBestDiscard(1, makeRng(s))
      const ex = item.exercise
      if (ex.kind !== 'build') throw new Error('expected build')
      const grade = gradeDiscard(ex.pool, ex.pool[0])
      for (const t of new Set(ex.pool)) {
        expect(ex.isCorrect([t])).toBe(grade.best.includes(t))
      }
    }
  })

  it('generateItem returns items tagged with the requested concept', () => {
    const rng = makeRng('tagged')
    for (const concept of ['set.chow', 'shape.seven-pairs', 'declare.minimum'] as const) {
      const item = generateItem(concept, 1, rng)
      expect(item.concept).toBe(concept)
    }
  })

  it('is reproducible for the same seed', () => {
    const a = genFaanCount(2, makeRng('same'))
    const b = genFaanCount(2, makeRng('same'))
    expect(a.exercise).toMatchObject(JSON.parse(JSON.stringify(b.exercise)))
  })
})

describe('board context', () => {
  it('position-based items carry the board they are about', async () => {
    const { genSafeTile, genSuitRead } = await import('../generators')
    const safe = genSafeTile(1, makeRng('board-1'))
    const read = genSuitRead(1, makeRng('board-2'))
    expect(safe.board).toBeDefined()
    expect(read.board).toBeDefined()
    // the board actually has something to read
    const pools = [0, 1, 2, 3].reduce((n, s) => n + read.board!.discards[s as 0].length, 0)
    expect(pools).toBeGreaterThan(0)
  })
})
