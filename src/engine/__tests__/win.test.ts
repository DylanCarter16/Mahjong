import { describe, expect, it } from 'vitest'
import { hand } from '../tiles'
import type { Meld } from '../types'
import { decompose, isWinningHand } from '../win'

const chowMeld = (tiles: string, from = 3 as const): Meld => ({
  type: 'chow',
  tiles: hand(tiles),
  concealed: false,
  claimedFrom: from,
})
const pungMeld = (tiles: string, from = 3 as const): Meld => ({
  type: 'pung',
  tiles: hand(tiles),
  concealed: false,
  claimedFrom: from,
})

describe('standard shape', () => {
  it('wins a simple 3-chows + pung + pair hand, one decomposition', () => {
    const h = hand('m1 m2 m3 p4 p5 p6 s7 s8 s9 wE wE wE dR dR')
    expect(isWinningHand(h, [])).toBe(true)
    const ds = decompose(h, [])
    expect(ds).toHaveLength(1)
    expect(ds[0].shape).toBe('standard')
  })

  it('returns BOTH decompositions of 111222333 (pungs vs chows)', () => {
    const h = hand('m1 m1 m1 m2 m2 m2 m3 m3 m3 s5 s5 s5 wE wE')
    const ds = decompose(h, [])
    expect(ds).toHaveLength(2)
    const readings = ds.map((d) =>
      d.shape === 'standard'
        ? d.sets
            .filter((s) => !s.fromMeld)
            .map((s) => s.type)
            .sort()
            .join(',')
        : '',
    )
    expect(readings).toContain('pung,pung,pung,pung')
    expect(readings).toContain('chow,chow,chow,pung')
  })

  it('decomposes Nine Gates plus a winning tile', () => {
    const gates = 'm1 m1 m1 m2 m3 m4 m5 m6 m7 m8 m9 m9 m9'
    expect(isWinningHand(hand(`${gates} m2`), [])).toBe(true)
    expect(isWinningHand(hand(`${gates} m5`), [])).toBe(true)
    expect(isWinningHand(hand(`${gates} m9`), [])).toBe(true)
  })

  it('counts exposed melds toward the four sets', () => {
    const melds = [chowMeld('m1 m2 m3'), pungMeld('wE wE wE')]
    const h = hand('s4 s5 s6 p7 p7 p7 dR dR')
    expect(isWinningHand(h, melds)).toBe(true)
    const ds = decompose(h, melds)
    expect(ds).toHaveLength(1)
    expect(ds[0].shape === 'standard' && ds[0].sets.filter((s) => s.fromMeld)).toHaveLength(2)
  })

  it('wins an honours-only pung hand', () => {
    expect(isWinningHand(hand('wE wE wE wS wS wS wW wW wW dR dR dR dG dG'), [])).toBe(true)
  })

  it('rejects a chow wrapping 9 to 1', () => {
    expect(isWinningHand(hand('m1 m8 m9 s2 s2 s2 s5 s5 s5 p3 p3 p3 wE wE'), [])).toBe(false)
  })

  it('rejects near-miss hands', () => {
    // 4 melds, no pair
    expect(isWinningHand(hand('m1 m2 m3 m4 m5 m6 s1 s2 s3 p1 p2 p3 wE wS'), [])).toBe(false)
    // honours can never chow
    expect(isWinningHand(hand('wE wS wW dR dR dR m1 m2 m3 p4 p5 p6 s9 s9'), [])).toBe(false)
    // wrong tile count
    expect(isWinningHand(hand('m1 m2 m3 m4'), [])).toBe(false)
  })
})

describe('seven pairs', () => {
  it('wins with 7 distinct pairs', () => {
    const ds = decompose(hand('m1 m1 m3 m3 m5 m5 s2 s2 s4 s4 p6 p6 wE wE'), [])
    expect(ds).toHaveLength(1)
    expect(ds[0].shape).toBe('sevenPairs')
  })

  it('does NOT count four-of-a-kind as two pairs', () => {
    // Assumption documented in win.ts: seven DISTINCT pairs required.
    expect(isWinningHand(hand('m1 m1 m1 m1 m3 m3 s2 s2 s4 s4 p6 p6 wE wE'), [])).toBe(false)
  })

  it('requires a fully concealed hand', () => {
    expect(
      isWinningHand(hand('m1 m1 m3 m3 m5 m5 s2 s2 p6 p6 wE wE'), [pungMeld('s4 s4 s4')]),
    ).toBe(false)
  })
})

describe('thirteen orphans', () => {
  const twelve = 'm1 m9 s1 s9 p1 p9 wE wS wW wN dR dG'

  it('wins when complete', () => {
    const ds = decompose(hand(`${twelve} dW m1`), [])
    expect(ds).toHaveLength(1)
    expect(ds[0].shape).toBe('thirteenOrphans')
    expect(ds[0].shape === 'thirteenOrphans' && ds[0].duplicated).toBe('m1')
  })

  it('fails one tile away', () => {
    expect(isWinningHand(hand(`${twelve} m1 m5`), [])).toBe(false)
  })
})
