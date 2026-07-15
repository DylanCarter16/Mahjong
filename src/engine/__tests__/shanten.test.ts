import { describe, expect, it } from 'vitest'
import { hand } from '../tiles'
import { shanten, usefulTiles } from '../shanten'
import type { Meld } from '../types'

describe('shanten', () => {
  it('returns -1 for a winning hand', () => {
    expect(shanten(hand('m1 m2 m3 p4 p5 p6 s7 s8 s9 wE wE wE dR dR'), [])).toBe(-1)
    expect(shanten(hand('m1 m1 m3 m3 m5 m5 s2 s2 s4 s4 p6 p6 wE wE'), [])).toBe(-1)
  })

  it('returns 0 for tenpai hands', () => {
    // waiting on dR to pair
    expect(shanten(hand('m1 m2 m3 p4 p5 p6 s7 s8 s9 wE wE wE dR'), [])).toBe(0)
    // Nine Gates: waiting on anything in the suit
    expect(shanten(hand('m1 m1 m1 m2 m3 m4 m5 m6 m7 m8 m9 m9 m9'), [])).toBe(0)
  })

  it('hand-verified 1-shanten', () => {
    // 3 complete sets + s7s8 partial + two floaters (no pair): complete the
    // chow and pair a floater = 2 useful draws -> 1-shanten
    expect(shanten(hand('m1 m2 m3 p4 p5 p6 s7 s8 wE wE wE dR dG'), [])).toBe(1)
  })

  it('hand-verified 2-shanten', () => {
    // 2 sets + s7s8 partial + wE pair + three floaters
    expect(shanten(hand('m1 m2 m3 p4 p5 p6 s7 s8 wE wE dR dG p9'), [])).toBe(2)
  })

  it('works with exposed melds', () => {
    const melds: Meld[] = [
      { type: 'pung', tiles: hand('wE wE wE'), concealed: false, claimedFrom: 3 },
    ]
    // 2 sets remaining to build from m1m2m3 p4p5p6 s7s8 dR dR: tenpai on s9/s6
    expect(shanten(hand('m1 m2 m3 p4 p5 p6 s7 s8 dR dR'), melds)).toBe(0)
  })

  it('seven pairs reading beats the standard reading', () => {
    // six pairs + one floater: 0-shanten as seven pairs, 3-shanten standard
    expect(shanten(hand('m1 m1 m3 m3 m5 m5 s2 s2 s4 s4 p6 p6 wE'), [])).toBe(0)
  })

  it('thirteen orphans reading', () => {
    // 12 orphan kinds + one orphan pair (13 tiles): tenpai on the missing dW
    expect(shanten(hand('m1 m9 s1 s9 p1 p9 wE wS wW wN dR dG m1'), [])).toBe(0)
    // 13 distinct orphan kinds, no pair yet: also tenpai (wait to pair any)
    expect(shanten(hand('m1 m9 s1 s9 p1 p9 wE wS wW wN dR dG dW'), [])).toBe(0)
  })
})

describe('usefulTiles', () => {
  it('finds exactly the winning wait on a simple tenpai hand', () => {
    expect(usefulTiles(hand('m1 m2 m3 p4 p5 p6 s7 s8 s9 wE wE wE dR'), [])).toEqual(['dR'])
  })

  it('finds both completion routes at 1-shanten', () => {
    const useful = usefulTiles(hand('m1 m2 m3 p4 p5 p6 s7 s8 wE wE wE dR dG'), [])
    expect(useful).toContain('s6')
    expect(useful).toContain('s9')
    expect(useful).toContain('dR')
    expect(useful).toContain('dG')
  })

  it('returns nothing for a won hand', () => {
    expect(usefulTiles(hand('m1 m2 m3 p4 p5 p6 s7 s8 s9 wE wE wE dR dR'), [])).toEqual([])
  })
})
