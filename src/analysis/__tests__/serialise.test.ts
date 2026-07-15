import { describe, expect, it } from 'vitest'
import { applyAction, createGameWithWall, playerView } from '../../engine/game'
import { hand } from '../../engine/tiles'
import type { TileId } from '../../engine/types'
import { stripFences } from '../client'
import { serialiseLog, serialisePlayerView } from '../serialise'

const wall = (): TileId[] => [
  ...hand('m5 m5 s2 s3 p8 p9 wN wS wW m8 m9 s6 s4'),
  ...hand('m1 m2 m3 p4 p5 p6 s7 s8 s9 wE wE wE dR'),
  ...hand('m6 m7 p7 s1 s3 s4 wN wS wW m4 p3 p5 p8'),
  ...hand('s5 s6 p2 p4 m4 m6 wN wS wW m7 p7 s1 s2'),
  'dR',
  ...Array.from({ length: 18 }, () => 'p1' as TileId),
]

describe('serialisation for prompts', () => {
  it('captures the player view compactly and without hidden info', () => {
    const s = createGameWithWall({ faanMinimum: 0, flowers: false, faanCap: null }, wall())
    const text = serialisePlayerView(playerView(s, 1))
    expect(text).toContain('seat wind: S')
    expect(text).toContain('my hand: m1 m2 m3 p4 p5 p6 s7 s8 s9 wE wE wE dR')
    expect(text).toContain('faan minimum: 0')
    // no other seat's concealed tiles anywhere
    expect(text).not.toContain('m5 m5 s2')
    expect(text).not.toContain('wall:')
  })

  it('serialises the action log with the result line', () => {
    let s = createGameWithWall({ faanMinimum: 0, flowers: false, faanCap: null }, wall())
    s = applyAction(s, { type: 'discard', seat: 0, tile: 'dR' })
    s = applyAction(s, { type: 'claim', seat: 1, claim: 'win' })
    const text = serialiseLog(s.log, s.result)
    expect(text).toContain('1. ME discards dR')
    expect(text).toContain('2. S wins off the discard')
    expect(text).toContain("RESULT: S won off ME's discard for 1 faan (Round Wind)")
  })

  it('strips markdown fences from model output', () => {
    expect(stripFences('```json\n{"a":1}\n```')).toBe('{"a":1}')
    expect(stripFences('```\nplain\n```')).toBe('plain')
    expect(stripFences('no fences')).toBe('no fences')
  })
})
