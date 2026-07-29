import { describe, expect, it } from 'vitest'
import { makeRng, shuffle } from '../rng'

describe('makeRng', () => {
  it('is reproducible from a string seed (tests, lessons, replays rely on this)', () => {
    const a = Array.from({ length: 20 }, makeRng('seed-1').next)
    const b = Array.from({ length: 20 }, makeRng('seed-1').next)
    expect(a).toEqual(b)
    const c = Array.from({ length: 20 }, makeRng('seed-2').next)
    expect(a).not.toEqual(c)
  })

  it('depends on the WHOLE seed, not just its start', () => {
    // Two long seeds sharing a prefix must diverge — the hash mixes all of it.
    const a = makeRng('mahjong-room-AAAAAAAA-round-1').next()
    const b = makeRng('mahjong-room-AAAAAAAB-round-1').next()
    expect(a).not.toBe(b)
  })

  it('is not the vulnerable 32-bit-state generator (audit H1)', () => {
    // The pre-audit generator seeded a 32-bit mulberry32 state from a SINGLE
    // xmur3 word → only ~4.3e9 possible walls, brute-forceable from an opening
    // hand to reveal every hidden tile. makeRng must not reduce to that. The
    // exact vulnerable generator is reproduced here as an anti-reference; if a
    // future change collapses the state back, these streams start matching.
    const vulnerable = (seed: string) => {
      let h = 1779033703 ^ seed.length
      for (let i = 0; i < seed.length; i++) {
        h = Math.imul(h ^ seed.charCodeAt(i), 3432918353)
        h = (h << 13) | (h >>> 19)
      }
      const word = () => {
        h = Math.imul(h ^ (h >>> 16), 2246822507)
        h = Math.imul(h ^ (h >>> 13), 3266489909)
        h ^= h >>> 16
        return h >>> 0
      }
      let a = word()
      return () => {
        a |= 0
        a = (a + 0x6d2b79f5) | 0
        let t = Math.imul(a ^ (a >>> 15), 1 | a)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
      }
    }
    for (const s of ['a', 'wall-seed-42', 'family-room-77WMFB']) {
      const got = Array.from({ length: 6 }, makeRng(s).next)
      const bad = Array.from({ length: 6 }, vulnerable(s))
      expect(got, `makeRng regressed to the brute-forceable 32-bit generator for "${s}"`).not.toEqual(bad)
    }
  })

  it('produces a well-mixed, uniform-ish shuffle', () => {
    const rng = makeRng('shuffle-seed')
    const deck = Array.from({ length: 100 }, (_, i) => i)
    const out = shuffle(deck, rng)
    expect(out).toHaveLength(100)
    expect(new Set(out).size).toBe(100) // a permutation, nothing lost/duplicated
    expect(out).not.toEqual(deck) // actually moved
  })
})
