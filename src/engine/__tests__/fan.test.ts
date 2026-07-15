import { describe, expect, it } from 'vitest'
import { defaultFanTable } from '../fanTable'
import { score, scoreBest, winDeclarable, type ScoringContext } from '../fan'
import { hand } from '../tiles'
import { decompose } from '../win'
import type { Meld, TileId } from '../types'

const ctx = (over: Partial<ScoringContext> = {}): ScoringContext => ({
  seatWind: 'E',
  roundWind: 'E',
  selfDraw: false,
  flowers: [],
  fullyConcealed: false,
  lastWallTile: false,
  kongReplacement: false,
  ...over,
})

/** Score the best reading of a concealed hand. */
const best = (tiles: string, c: ScoringContext, melds: Meld[] = []) =>
  scoreBest(decompose(hand(tiles), melds), c)

const names = (r: { patterns: { name: string }[] }) => r.patterns.map((p) => p.name).sort()

describe('patterns in isolation', () => {
  it('chicken hand scores zero', () => {
    const r = best('m1 m2 m3 s4 s5 s6 p7 p7 p7 m7 m8 m9 s2 s2', ctx())
    expect(r).toEqual({ totalFaan: 0, patterns: [] })
  })

  it('All Chows', () => {
    const r = best('m2 m3 m4 s3 s4 s5 s6 s7 s8 p4 p5 p6 p9 p9', ctx())
    expect(names(r)).toEqual(['All Chows'])
    expect(r.totalFaan).toBe(1)
  })

  it('All Pungs', () => {
    const r = best('m2 m2 m2 s5 s5 s5 p8 p8 p8 wN wN wN m9 m9', ctx())
    expect(names(r)).toEqual(['All Pungs'])
    expect(r.totalFaan).toBe(3)
  })

  it('Mixed One Suit', () => {
    const r = best('s1 s2 s3 s5 s5 s5 s9 s9 s9 wW wW wW s7 s7', ctx())
    expect(names(r)).toEqual(['Mixed One Suit'])
    expect(r.totalFaan).toBe(3)
  })

  it('Pure One Suit', () => {
    const r = best('s2 s2 s2 s3 s4 s5 s5 s5 s6 s7 s8 s9 s9 s9', ctx())
    expect(names(r)).toEqual(['Pure One Suit'])
    expect(r.totalFaan).toBe(7)
  })

  it('Seat Wind pung', () => {
    const r = best('wS wS wS m1 m2 m3 s4 s5 s6 p7 p8 p9 m9 m9', ctx({ seatWind: 'S' }))
    expect(names(r)).toEqual(['Seat Wind'])
  })

  it('Round Wind pung', () => {
    const r = best('wE wE wE m1 m2 m3 s4 s5 s6 p7 p8 p9 m9 m9', ctx({ seatWind: 'W' }))
    expect(names(r)).toEqual(['Round Wind'])
  })

  it('a seat+round wind pung scores both', () => {
    const r = best('wE wE wE m1 m2 m3 s4 s5 s6 p7 p8 p9 m9 m9', ctx())
    expect(names(r)).toEqual(['Round Wind', 'Seat Wind'])
    expect(r.totalFaan).toBe(2)
  })

  it('Dragon pung', () => {
    const r = best('dG dG dG m1 m2 m3 s4 s5 s6 p7 p8 p9 m9 m9', ctx())
    expect(names(r)).toEqual(['Green Dragon Pung'])
  })

  it('Self-draw', () => {
    const r = best('m1 m2 m3 s4 s5 s6 p7 p7 p7 m7 m8 m9 s2 s2', ctx({ selfDraw: true }))
    expect(names(r)).toEqual(['Self-draw'])
  })

  it('Seven Pairs', () => {
    const r = best('m1 m1 m3 m3 m5 m5 s2 s2 s4 s4 p6 p6 wE wE', ctx())
    expect(names(r)).toEqual(['Seven Pairs'])
    expect(r.totalFaan).toBe(4)
  })

  it('Thirteen Orphans', () => {
    const r = best('m1 m9 s1 s9 p1 p9 wE wS wW wN dR dG dW m1', ctx())
    expect(names(r)).toEqual(['Thirteen Orphans'])
    expect(r.totalFaan).toBe(13)
  })

  it('flowers: own flower scores, others do not, full set adds bonus', () => {
    const plain = 'm1 m2 m3 s4 s5 s6 p7 p7 p7 m7 m8 m9 s2 s2'
    // seat E owns index 1; bs2 belongs to South
    const r1 = best(plain, ctx({ flowers: ['bf1', 'bs2'] }))
    expect(r1.patterns).toEqual([{ name: 'Own Flowers', faan: 1 }])
    // all four flowers: one is ours (seat S owns index 2) plus the set bonus
    const r2 = best(plain, ctx({ seatWind: 'S', roundWind: 'S', flowers: ['bf1', 'bf2', 'bf3', 'bf4'] }))
    expect(names(r2)).toEqual(['Flower Set', 'Own Flowers'])
    expect(r2.totalFaan).toBe(3)
  })

  it('Last wall tile and kong replacement wins', () => {
    const plain = 'm1 m2 m3 s4 s5 s6 p7 p7 p7 m7 m8 m9 s2 s2'
    expect(names(best(plain, ctx({ lastWallTile: true })))).toEqual(['Last Wall Tile'])
    expect(names(best(plain, ctx({ kongReplacement: true })))).toEqual(['Kong Replacement'])
  })
})

describe('exclusivity and subsumption', () => {
  it('Pure One Suit never scores together with Mixed One Suit', () => {
    const r = best('s2 s2 s2 s3 s4 s5 s5 s5 s6 s7 s8 s9 s9 s9', ctx())
    expect(names(r)).not.toContain('Mixed One Suit')
  })

  it('All Honours subsumes All Pungs (documented decision)', () => {
    const r = best('wE wE wE wS wS wS wW wW wW dR dR dR dG dG', ctx({ seatWind: 'N', roundWind: 'N' }))
    expect(names(r)).toEqual(['All Honours', 'Red Dragon Pung'])
    expect(r.totalFaan).toBe(11)
  })

  it('Great Dragons subsumes Small Dragons and the dragon pungs', () => {
    const r = best('dR dR dR dG dG dG dW dW dW m1 m2 m3 s5 s5', ctx())
    expect(names(r)).toEqual(['Great Dragons'])
    expect(r.totalFaan).toBe(8)
  })

  it('Small Dragons subsumes its two dragon pungs', () => {
    const r = best('dR dR dR dG dG dG dW dW m1 m2 m3 s5 s6 s7', ctx())
    expect(names(r)).toEqual(['Small Dragons'])
    expect(r.totalFaan).toBe(4)
  })

  it('Small Winds subsumes seat/round wind pungs (Mixed still fires)', () => {
    const r = best('wE wE wE wS wS wS wW wW wW wN wN m1 m2 m3', ctx())
    expect(names(r)).toEqual(['Mixed One Suit', 'Small Winds'])
    expect(r.totalFaan).toBe(9)
  })

  it('Great Winds subsumes Small Winds and wind pungs; All Pungs and Mixed stack', () => {
    const r = best('wE wE wE wS wS wS wW wW wW wN wN wN m5 m5', ctx())
    expect(names(r)).toEqual(['All Pungs', 'Great Winds', 'Mixed One Suit'])
    expect(r.totalFaan).toBe(19)
  })

  it('All Kongs subsumes All Pungs', () => {
    const kong = (tile: TileId, concealed = false): Meld => ({
      type: 'kong',
      tiles: [tile, tile, tile, tile],
      concealed,
      kongStyle: concealed ? 'concealed' : 'exposed',
    })
    const melds = [kong('m2'), kong('s5'), kong('p8', true), kong('wN')]
    const r = scoreBest(decompose(hand('m9 m9'), melds), ctx())
    expect(names(r)).toEqual(['All Kongs'])
    expect(r.totalFaan).toBe(13)
  })

  it('Nine Gates subsumes Pure One Suit', () => {
    const r = best('m1 m1 m1 m2 m3 m4 m5 m5 m6 m7 m8 m9 m9 m9', ctx({ fullyConcealed: true }))
    expect(names(r)).toContain('Nine Gates')
    expect(names(r)).not.toContain('Pure One Suit')
    expect(r.totalFaan).toBeGreaterThanOrEqual(13)
  })

  it('the same shape without concealment is only Pure One Suit', () => {
    const r = best('m1 m1 m1 m2 m3 m4 m5 m5 m6 m7 m8 m9 m9 m9', ctx({ fullyConcealed: false }))
    expect(names(r)).not.toContain('Nine Gates')
    expect(names(r)).toContain('Pure One Suit')
  })
})

describe('combined hands (hand-checked totals)', () => {
  it('Pure One Suit + All Pungs = 10', () => {
    const r = best('m1 m1 m1 m3 m3 m3 m5 m5 m5 m7 m7 m7 m9 m9', ctx())
    expect(names(r)).toEqual(['All Pungs', 'Pure One Suit'])
    expect(r.totalFaan).toBe(10)
  })

  it('Mixed + Seat Wind + Round Wind + Self-draw = 6', () => {
    const r = best('m2 m3 m4 m6 m7 m8 wE wE wE m5 m5 m5 dR dR', ctx({ selfDraw: true }))
    expect(names(r)).toEqual(['Mixed One Suit', 'Round Wind', 'Seat Wind', 'Self-draw'])
    expect(r.totalFaan).toBe(6)
  })
})

describe('scoreBest picks the highest-scoring decomposition', () => {
  it('chow reading (Pure + All Chows = 8) beats pung reading (Pure = 7)', () => {
    const ds = decompose(hand('m1 m1 m1 m2 m2 m2 m3 m3 m3 m7 m8 m9 m5 m5'), [])
    expect(ds.length).toBe(2)
    const totals = ds.map((d) => score(d, ctx()).totalFaan).sort()
    expect(totals).toEqual([7, 8])
    const r = scoreBest(ds, ctx())
    expect(r.totalFaan).toBe(8)
    expect(names(r)).toEqual(['All Chows', 'Pure One Suit'])
  })
})

describe('faan cap and minimum', () => {
  it('faanCap clamps the total when configured', () => {
    const capped = ctx({ table: { ...defaultFanTable, faanCap: 13 } })
    const r = best('wE wE wE wS wS wS wW wW wW wN wN wN m5 m5', capped)
    expect(r.totalFaan).toBe(13)
  })

  it('winDeclarable enforces the minimum', () => {
    expect(winDeclarable(1, 3)).toBe(false)
    expect(winDeclarable(1, 0)).toBe(true)
    expect(winDeclarable(0, 0)).toBe(true)
    expect(winDeclarable(3, 3)).toBe(true)
  })
})
