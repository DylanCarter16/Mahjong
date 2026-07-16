import { describe, expect, it } from 'vitest'
import { rankDiscards, readOpponents } from '../analysis'
import { createGameWithWall, playerView, type PlayerView } from '../game'
import { hand } from '../tiles'
import type { Meld, Seat, TileId } from '../types'

const mkView = (over: Partial<PlayerView> & { concealed: TileId[] }): PlayerView => {
  const empty = () => ({ 0: [], 1: [], 2: [], 3: [] })
  return {
    seat: 0,
    seatWind: 'E',
    roundWind: 'E',
    seatWinds: { 0: 'E', 1: 'S', 2: 'W', 3: 'N' },
    handCounts: { 0: 14, 1: 13, 2: 13, 3: 13 },
    melds: empty() as PlayerView['melds'],
    bonus: empty() as PlayerView['bonus'],
    discards: empty() as PlayerView['discards'],
    wallCount: 60,
    faanMinimum: 0,
    turn: 0,
    phase: 'discard',
    pendingDiscard: null,
    lastClaimed: null,
    legal: [],
    ...over,
  }
}

describe('rankDiscards', () => {
  it('ranks the hand-verified example correctly with exact ukeire', () => {
    // 4 complete sets + m7 m9: dropping a wind waits on m8 (4 live);
    // dropping m7 waits on m9 (3 live, one is in hand).
    const v = mkView({ concealed: hand('m1 m2 m3 p4 p5 p6 s4 s5 s6 m7 m9 wE wE wE') })
    const ranked = rankDiscards(v)
    expect(ranked[0].tile).toBe('wE')
    expect(ranked[0].shantenAfter).toBe(0)
    expect(ranked[0].ukeire).toBe(4)
    expect(ranked[0].advancing).toEqual(['m8'])
    const m7 = ranked.find((r) => r.tile === 'm7')!
    expect(m7.shantenAfter).toBe(0)
    expect(m7.ukeire).toBe(3)
    expect(m7.advancing).toEqual(['m9'])
    const s4 = ranked.find((r) => r.tile === 's4')!
    expect(s4.shantenAfter).toBe(1)
    // sorted best-first: shanten ascending, then ukeire descending
    for (let i = 1; i < ranked.length; i++) {
      const a = ranked[i - 1]
      const b = ranked[i]
      expect(a.shantenAfter < b.shantenAfter || (a.shantenAfter === b.shantenAfter && a.ukeire >= b.ukeire)).toBe(true)
    }
  })

  it('discounts advancing tiles that are visible in discards and melds', () => {
    const discards: Record<Seat, TileId[]> = { 0: [], 1: ['m8', 'm8'], 2: ['m8'], 3: [] }
    const v = mkView({
      concealed: hand('m1 m2 m3 p4 p5 p6 s4 s5 s6 m7 m9 wE wE wE'),
      discards,
    })
    const wE = rankDiscards(v).find((r) => r.tile === 'wE')!
    expect(wE.ukeire).toBe(1) // 4 - 3 visible m8
  })

  it('reports per-opponent danger for every candidate', () => {
    const v = mkView({
      concealed: hand('m1 m2 m3 p4 p5 p6 s4 s5 s6 m7 m9 wE wE wE'),
      discards: { 0: [], 1: ['m9'], 2: [], 3: [] },
    })
    const m9 = rankDiscards(v).find((r) => r.tile === 'm9')!
    expect(m9.dangerByOpponent[1]).toBe(0) // in South's own discards: safe vs them
    expect(m9.dangerByOpponent[2]).toBeGreaterThan(0)
    expect(m9.dangerByOpponent[0]).toBeUndefined() // no danger score against yourself
  })
})

describe('readOpponents', () => {
  it('infers the suits an opponent is NOT discarding as likely collected', () => {
    const v = mkView({
      concealed: hand('m1 m2 m3 p4 p5 p6 s4 s5 s6 m7 m9 wE wE wE'),
      discards: { 0: [], 1: ['s1', 's4', 's7', 's9', 'm2', 'wN'], 2: [], 3: [] },
    })
    const south = readOpponents(v).find((o) => o.seat === 1)!
    expect(south.suitDiscards).toEqual({ m: 1, p: 0, s: 4 })
    expect(south.likelyCollecting).toContain('p')
    expect(south.likelyCollecting).not.toContain('s')
  })

  it('scores threat from exposed melds, few discards, and a late wall', () => {
    const pung = (t: TileId): Meld => ({ type: 'pung', tiles: [t, t, t], concealed: false })
    const quiet = mkView({ concealed: hand('m1 m2 m3') })
    expect(readOpponents(quiet).every((o) => o.threat === 0)).toBe(true)

    const loud = mkView({
      concealed: hand('m1 m2 m3'),
      melds: { 0: [], 1: [], 2: [pung('dR'), pung('wS'), pung('m2')], 3: [] },
      discards: { 0: [], 1: [], 2: ['p1', 'p2'], 3: [] },
      wallCount: 12,
    })
    const west = readOpponents(loud).find((o) => o.seat === 2)!
    expect(west.threat).toBe(3)
  })

  it('lists tiles known-safe against each opponent', () => {
    const v = mkView({
      concealed: hand('m1 m2 m3'),
      discards: { 0: [], 1: ['p3', 'wN'], 2: [], 3: [] },
    })
    const south = readOpponents(v).find((o) => o.seat === 1)!
    expect(south.safeTiles).toContain('p3')
    expect(south.safeTiles).toContain('wN')
    expect(south.safeTiles).not.toContain('m5')
  })

  it('works on a real game view', () => {
    const wall = [
      ...hand('m5 m5 s2 s3 p8 p9 wN wS wW m8 m9 s6 s4'),
      ...hand('m1 m2 m3 p4 p5 p6 s7 s8 s9 wE wE wE dR'),
      ...hand('m6 m7 p7 s1 s3 s4 wN wS wW m4 p3 p5 p8'),
      ...hand('s5 s6 p2 p4 m4 m6 wN wS wW m7 p7 s1 s2'),
      'dR',
      ...Array.from({ length: 18 }, () => 'p1' as TileId),
    ]
    const s = createGameWithWall({ faanMinimum: 0, flowers: false, faanCap: null }, wall)
    const v = playerView(s, 0)
    expect(rankDiscards(v).length).toBeGreaterThan(5)
    expect(readOpponents(v)).toHaveLength(3)
  })
})
