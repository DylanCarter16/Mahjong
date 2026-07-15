import { describe, expect, it } from 'vitest'
import { makeRng } from '../rng'
import { buildWall } from '../wall'
import { isBonus } from '../tiles'

const count = (xs: string[]) => {
  const m = new Map<string, number>()
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1)
  return m
}

describe('wall', () => {
  it('builds 144 tiles with flowers, 136 without', () => {
    expect(buildWall({ flowers: true }, makeRng('a'))).toHaveLength(144)
    const bare = buildWall({ flowers: false }, makeRng('a'))
    expect(bare).toHaveLength(136)
    expect(bare.some(isBonus)).toBe(false)
  })

  it('is a permutation of the correct multiset', () => {
    const wall = buildWall({ flowers: true }, makeRng('seed'))
    const c = count(wall)
    expect(c.get('m1')).toBe(4)
    expect(c.get('wN')).toBe(4)
    expect(c.get('dW')).toBe(4)
    expect(c.get('bf1')).toBe(1)
    expect(c.get('bs4')).toBe(1)
    expect(c.size).toBe(42)
  })

  it('same seed gives same wall; different seed differs', () => {
    const a1 = buildWall({ flowers: true }, makeRng('alpha'))
    const a2 = buildWall({ flowers: true }, makeRng('alpha'))
    const b = buildWall({ flowers: true }, makeRng('beta'))
    expect(a1).toEqual(a2)
    expect(a1).not.toEqual(b)
  })

  it('rng is deterministic and in [0,1)', () => {
    const r1 = makeRng('x')
    const r2 = makeRng('x')
    for (let i = 0; i < 1000; i++) {
      const v = r1.next()
      expect(v).toBe(r2.next())
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })
})
