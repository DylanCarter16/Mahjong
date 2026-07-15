import { describe, expect, it } from 'vitest'
import {
  ALL_PLAY_KINDS,
  BONUS_KINDS,
  glyph,
  hand,
  isBonus,
  isHonour,
  isSuit,
  isTerminal,
  rankOf,
  sortTiles,
  suitOf,
  t,
  tileName,
} from '../tiles'

describe('tile ids', () => {
  it('has 34 play kinds and 8 bonus kinds', () => {
    expect(ALL_PLAY_KINDS).toHaveLength(34)
    expect(BONUS_KINDS).toHaveLength(8)
    expect(new Set([...ALL_PLAY_KINDS, ...BONUS_KINDS]).size).toBe(42)
  })

  it('validates ids', () => {
    expect(t('m1')).toBe('m1')
    expect(t('wE')).toBe('wE')
    expect(t('dW')).toBe('dW')
    expect(t('bf3')).toBe('bf3')
    expect(() => t('m0')).toThrow()
    expect(() => t('m10')).toThrow()
    expect(() => t('x5')).toThrow()
    expect(() => t('wQ')).toThrow()
    expect(() => t('bf5')).toThrow()
  })

  it('parses and sorts hands', () => {
    expect(hand('wE m3 m1 p2 dR s9')).toEqual(['m1', 'm3', 'p2', 's9', 'wE', 'dR'])
    expect(sortTiles(['dG', 'wN', 's1', 'm9'])).toEqual(['m9', 's1', 'wN', 'dG'])
  })

  it('classifies tiles', () => {
    expect(isSuit('m5')).toBe(true)
    expect(isSuit('wE')).toBe(false)
    expect(isHonour('dR')).toBe(true)
    expect(isHonour('p1')).toBe(false)
    expect(isBonus('bs4')).toBe(true)
    expect(isBonus('s4')).toBe(false)
    expect(isTerminal('m1')).toBe(true)
    expect(isTerminal('m9')).toBe(true)
    expect(isTerminal('m5')).toBe(false)
    expect(isTerminal('wE')).toBe(false)
    expect(suitOf('p7')).toBe('p')
    expect(suitOf('wE')).toBeNull()
    expect(rankOf('s3')).toBe(3)
    expect(rankOf('dR')).toBeNull()
  })

  it('maps every kind to a unique mahjong-block glyph', () => {
    const all = [...ALL_PLAY_KINDS, ...BONUS_KINDS].map(glyph)
    expect(new Set(all).size).toBe(42)
    for (const g of all) {
      const cp = g.codePointAt(0)!
      expect(cp).toBeGreaterThanOrEqual(0x1f000)
      expect(cp).toBeLessThanOrEqual(0x1f02a)
    }
    expect(glyph('m1')).toBe('🀇')
    expect(glyph('s1')).toBe('🀐')
    expect(glyph('p1')).toBe('🀙')
    expect(glyph('wE')).toBe('🀀')
    expect(glyph('dR')).toBe('🀄')
  })

  it('names tiles for teaching UI', () => {
    expect(tileName('m3')).toBe('3 of Characters')
    expect(tileName('p9')).toBe('9 of Circles')
    expect(tileName('wN')).toBe('North Wind')
    expect(tileName('dG')).toBe('Green Dragon')
    expect(tileName('bf1')).toBe('Flower 1 (Plum)')
    expect(tileName('bs2')).toBe('Season 2 (Summer)')
  })
})
