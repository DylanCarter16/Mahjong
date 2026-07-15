import { describe, expect, it } from 'vitest'
import { botAction, type Difficulty } from '../bots'
import {
  applyAction,
  createGame,
  playerView,
  type Action,
  type GameState,
  type PlayerView,
} from '../game'
import { makeRng } from '../rng'
import { hand } from '../tiles'
import { SEATS, type Meld, type Seat } from '../types'

/** Minimal hand-built view for policy-level tests. */
function mkView(over: Partial<PlayerView> & { concealed: PlayerView['concealed'] }): PlayerView {
  const empty = () => ({ 0: [], 1: [], 2: [], 3: [] })
  const defaults: Omit<PlayerView, 'concealed'> = {
    seat: 0,
    seatWind: 'E',
    roundWind: 'E',
    seatWinds: { 0: 'E', 1: 'S', 2: 'W', 3: 'N' },
    handCounts: { 0: 13, 1: 13, 2: 13, 3: 13 },
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
  }
  const base: PlayerView = { ...defaults, ...over }
  if (base.legal.length === 0 && base.phase === 'discard') {
    base.legal = [...new Set(base.concealed)].map((tile) => ({ type: 'discard', seat: base.seat, tile }))
  }
  return base
}

const rng = () => makeRng('bot-test')

describe.each(['easy', 'intermediate', 'advanced'] as Difficulty[])('%s bot', (difficulty) => {
  it('claims an available win', () => {
    const v = mkView({
      concealed: hand('m1 m2 m3 p4 p5 p6 s7 s8 s9 wE wE wE dR'),
      phase: 'claims',
      pendingDiscard: { tile: 'dR', from: 3 },
      legal: [
        { type: 'claim', seat: 0, claim: 'win' },
        { type: 'pass', seat: 0 },
      ],
    })
    expect(botAction(v, difficulty, rng())).toEqual({ type: 'claim', seat: 0, claim: 'win' })
  })

  it('declares an available self-drawn win', () => {
    const concealed = hand('m1 m2 m3 p4 p5 p6 s7 s8 s9 wE wE wE dR dR')
    const v = mkView({
      concealed,
      legal: [
        ...[...new Set(concealed)].map((tile): Action => ({ type: 'discard', seat: 0, tile })),
        { type: 'declareWin', seat: 0 },
      ],
    })
    expect(botAction(v, difficulty, rng())).toEqual({ type: 'declareWin', seat: 0 })
  })

  it('plays full seeded games with only legal actions', { timeout: 60_000 }, () => {
    for (const seed of ['f1', 'f2', 'f3']) {
      let s: GameState = createGame({ faanMinimum: 0, flowers: true, faanCap: null }, `${difficulty}-${seed}`)
      const r = makeRng(seed)
      let steps = 0
      while (s.phase !== 'finished') {
        if (++steps > 2000) throw new Error('game did not terminate')
        let acted = false
        if (s.phase === 'claims') {
          for (const seat of SEATS) {
            if (playerView(s, seat).legal.length > 0) {
              // applyAction throws on anything illegal — that IS the assertion
              s = applyAction(s, botAction(playerView(s, seat), difficulty, r))
              acted = true
              break
            }
          }
        } else {
          s = applyAction(s, botAction(playerView(s, s.turn), difficulty, r))
          acted = true
        }
        expect(acted).toBe(true)
      }
      expect(s.result).not.toBeNull()
    }
  })
})

describe('easy bot heuristics', () => {
  it('discards an isolated honour first', () => {
    const v = mkView({ concealed: hand('wN m2 m3 m4 m5 m6 m7 p4 p5 p6 s3 s4 s5 s6') })
    expect(botAction(v, 'easy', rng())).toEqual({ type: 'discard', seat: 0, tile: 'wN' })
  })
})

describe('advanced bot defence', () => {
  const threatMelds: Meld[] = (['dR', 'wS', 'm2'] as const).map((t) => ({
    type: 'pung',
    tiles: [t, t, t],
    concealed: false,
    claimedFrom: 0 as Seat,
  }))

  // Hand where p3 (100% safe: already in the threat's pool) is an inefficient
  // discard (breaks a complete chow) while s9/m5 are the efficient ones.
  const concealed = hand('m1 m2 m3 s4 s5 s9 p2 p3 p4 wE wE m5 m7 m8')

  const boardOver: Partial<PlayerView> = {
    melds: { 0: [], 1: threatMelds, 2: [], 3: [] },
    discards: { 0: [], 1: ['p3', 'wN'], 2: [], 3: [] },
    wallCount: 10,
  }

  it('folds to the safe tile against a threatening board', () => {
    const v = mkView({ concealed, ...boardOver })
    expect(botAction(v, 'advanced', rng())).toEqual({ type: 'discard', seat: 0, tile: 'p3' })
  })

  it('intermediate does not fold on the same board', () => {
    const v = mkView({ concealed, ...boardOver })
    const a = botAction(v, 'intermediate', rng())
    expect(a.type).toBe('discard')
    expect((a as { tile: string }).tile).not.toBe('p3')
  })

  it('advanced plays normally on a quiet board', () => {
    const v = mkView({ concealed })
    const a = botAction(v, 'advanced', rng())
    expect(a.type).toBe('discard')
    expect((a as { tile: string }).tile).not.toBe('p3')
  })
})
