// The cross-round patterns layer.
//
// The whole value of this layer is that it says something true about how you
// actually play, so the tests are mostly about restraint: it must not claim a
// pattern from one occurrence, must not count a round it never graded, and must
// not survive a corrupt or hostile saved file.

import { describe, expect, it } from 'vitest'
import { botAction } from '../../engine/bots'
import { applyAction, createGame, legalActions, playerView, type Action } from '../../engine/game'
import { makeRng } from '../../engine/rng'
import { scanRound, type HandSnapshot, type LeakId, type RoundScan } from '../../engine/review'
import { SEATS, type Seat } from '../../engine/types'
import { conceptById } from '../../lessons/concepts'
import { emptyProgress } from '../../lessons/mastery'
import { appendRound, MAX_ROUNDS, migrate, STORAGE_KEY } from '../../lessons/persistence'
import { conceptsToPractise, findLeaks, LEAKS, overall, recordRound, type RoundRecord } from '../leaks'

const RULES = { faanMinimum: 0, flowers: true, faanCap: null } as const

/** A real graded round, so the record under test is not hand-written. */
function realScan(seed: string): RoundScan {
  let g = createGame(RULES, seed, 0, 'E')
  const rng = makeRng(`bots:${seed}`)
  const snapshots: HandSnapshot[] = []
  let seq = 0
  const capture = () => {
    if (g.phase !== 'discard' && g.phase !== 'claims') return
    if (legalActions(g, 0 as Seat).length === 0) return
    const v = playerView(g, 0 as Seat)
    snapshots.push({ seq: seq++, phase: g.phase, concealed: [...v.concealed], wallCount: v.wallCount })
  }
  capture()
  let guard = 0
  while (g.phase !== 'finished' && guard++ < 3000) {
    if (g.phase === 'claims') {
      for (const s of SEATS.filter((x) => legalActions(g, x).length > 0)) {
        if (g.phase !== 'claims') break
        g = applyAction(g, botAction(playerView(g, s), s === 0 ? 'easy' : 'intermediate', rng) as Action)
        capture()
      }
      continue
    }
    g = applyAction(g, botAction(playerView(g, g.turn), g.turn === 0 ? 'easy' : 'intermediate', rng) as Action)
    capture()
  }
  return scanRound({
    seat: 0,
    log: g.log,
    result: g.result!,
    roundWind: g.roundWind,
    seatWinds: g.seatWinds,
    faanMinimum: RULES.faanMinimum,
    snapshots,
  })
}

const rec = (leaks: Partial<Record<LeakId, number>>, over: Partial<RoundRecord> = {}): RoundRecord => ({
  day: '2026-01-01',
  discards: 12,
  sharp: 0,
  loose: 0,
  mistakes: 0,
  leaks,
  ...over,
})

describe('recordRound', () => {
  it.each(['l1', 'l2', 'l3', 'l4'])('counts exactly the leaks the engine graded (seed %s)', (seed) => {
    const scan = realScan(seed)
    const record = recordRound(scan, '2026-01-01')

    // Every count must be traceable to a graded moment — no more, no less.
    for (const id of Object.keys(record.leaks) as LeakId[]) {
      expect(record.leaks[id]).toBe(scan.moments.filter((m) => m.leak === id).length)
    }
    const totalLeaks = Object.values(record.leaks).reduce((a, b) => a + b, 0)
    expect(totalLeaks).toBe(scan.moments.filter((m) => m.leak !== null).length)
    expect(record.discards).toBe(scan.tally.discards)
    expect(record.mistakes).toBe(scan.tally.mistakes)
  })

  it('never records a leak for a moment that was fine or sharp', () => {
    for (const seed of ['l1', 'l2', 'l3', 'l4', 'l5', 'l6']) {
      for (const m of realScan(seed).moments) {
        if (m.verdict === 'fine' || m.verdict === 'sharp') expect(m.leak, m.headline).toBeNull()
      }
    }
  })

  it('produces at least one real leak across a corpus of beginner rounds', () => {
    // Otherwise every assertion above is vacuously true.
    const total = ['l1', 'l2', 'l3', 'l4', 'l5', 'l6']
      .map((s) => recordRound(realScan(s), '2026-01-01'))
      .reduce((n, r) => n + Object.values(r.leaks).reduce((a, b) => a + b, 0), 0)
    expect(total, 'no leaks graded at all in the corpus').toBeGreaterThan(0)
  })
})

describe('findLeaks', () => {
  it('says nothing from a single occurrence', () => {
    expect(findLeaks([rec({ dealtIn: 1 })])).toEqual([])
    expect(findLeaks([rec({ dealtIn: 3 })])).toEqual([])
  })

  it('reports a habit once it recurs, with the denominator', () => {
    const leaks = findLeaks([rec({ fedThreat: 2 }), rec({ fedThreat: 1 }), rec({})])
    expect(leaks).toHaveLength(1)
    expect(leaks[0]).toMatchObject({ id: 'fedThreat', count: 3, rounds: 2, outOf: 3 })
  })

  it('ranks the most frequent first, and breaks ties by reach', () => {
    const records = [
      rec({ slowDiscard: 1, looseDiscard: 3 }),
      rec({ slowDiscard: 1, looseDiscard: 1 }),
      rec({ slowDiscard: 1 }),
      rec({ slowDiscard: 1 }),
    ]
    const leaks = findLeaks(records)
    expect(leaks.map((l) => l.id)).toEqual(['slowDiscard', 'looseDiscard'])
    // At equal count, the one that touched more rounds ranks first: twice in
    // one bad round is an incident, once in each of two rounds is a habit.
    const tie = findLeaks([
      rec({ dealtIn: 2, fedThreat: 1 }),
      rec({ fedThreat: 1 }),
      rec({ dealtIn: 1, fedThreat: 1 }),
    ])
    expect(tie.find((l) => l.id === 'dealtIn')).toMatchObject({ count: 3, rounds: 2 })
    expect(tie.find((l) => l.id === 'fedThreat')).toMatchObject({ count: 3, rounds: 3 })
    expect(tie[0].id).toBe('fedThreat')
  })

  it('carries a label, a detail and lesson concepts that really exist', () => {
    for (const l of findLeaks([rec({ passedWin: 1 }), rec({ passedWin: 1 })])) {
      expect(l.label.length).toBeGreaterThan(0)
      expect(l.detail).toMatch(/\.$/)
      expect(l.concepts.length).toBeGreaterThan(0)
      for (const c of l.concepts) expect(conceptById.has(c), `unknown concept ${c}`).toBe(true)
    }
  })

  it('maps every leak the engine can produce', () => {
    // A leak the engine grades but this layer has no entry for would be counted
    // and then silently never shown.
    const ids: LeakId[] = ['dealtIn', 'fedThreat', 'looseDiscard', 'slowDiscard', 'missedClaim', 'passedWin']
    for (const id of ids) expect(LEAKS[id], `no LEAKS entry for ${id}`).toBeDefined()
    expect(Object.keys(LEAKS).sort()).toEqual([...ids].sort())
  })

  it('survives an empty history', () => {
    expect(findLeaks([])).toEqual([])
    expect(overall([])).toMatchObject({ rounds: 0, discards: 0 })
    expect(conceptsToPractise([])).toEqual([])
  })
})

describe('conceptsToPractise', () => {
  it('puts the most-implicated concept first', () => {
    const leaks = findLeaks([rec({ slowDiscard: 5 }), rec({ slowDiscard: 5 }), rec({ passedWin: 1 }), rec({ passedWin: 1 })])
    const concepts = conceptsToPractise(leaks)
    expect(concepts[0]).toBe('efficiency.discard-choice')
    expect(concepts).toContain('shape.standard')
  })
})

describe('persistence', () => {
  const store = () => {
    const data = new Map<string, string>()
    return {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
      raw: data,
    }
  }

  it('appends without losing what the lessons wrote', () => {
    const s = store()
    // The lessons tab writes first…
    const withXp = { ...emptyProgress(), xp: 40 }
    s.setItem(STORAGE_KEY, JSON.stringify(withXp))
    // …then the play tab appends a round.
    const after = appendRound(s, rec({ dealtIn: 1 }))
    expect(after.xp).toBe(40)
    expect(after.rounds).toHaveLength(1)
    expect(migrate(JSON.parse(s.getItem(STORAGE_KEY)!))!.xp).toBe(40)
  })

  it('keeps only the most recent rounds', () => {
    const s = store()
    for (let i = 0; i < MAX_ROUNDS + 12; i++) appendRound(s, rec({ dealtIn: 1 }, { day: `d${i}` }))
    const rounds = migrate(JSON.parse(s.getItem(STORAGE_KEY)!))!.rounds
    expect(rounds).toHaveLength(MAX_ROUNDS)
    expect(rounds[rounds.length - 1].day).toBe(`d${MAX_ROUNDS + 11}`)
  })

  it('round-trips a real round through storage unchanged', () => {
    const s = store()
    const record = recordRound(realScan('trip'), '2026-02-03')
    appendRound(s, record)
    expect(migrate(JSON.parse(s.getItem(STORAGE_KEY)!))!.rounds[0]).toEqual(record)
  })

  it('defaults to no rounds when loading a save written before this existed', () => {
    const old = { ...emptyProgress(), xp: 7 } as Record<string, unknown>
    delete old.rounds
    const state = migrate(old)
    expect(state).not.toBeNull()
    expect(state!.rounds).toEqual([])
    expect(state!.xp).toBe(7)
  })

  it('rejects hostile and malformed round data on import', () => {
    const state = migrate({
      ...emptyProgress(),
      rounds: [
        // Unknown leak keys, prototype-pollution attempts, junk numbers.
        { day: '2026-01-01', discards: 5, leaks: { __proto__: 9, notALeak: 3, dealtIn: 2 } },
        { day: 12345, discards: -9, sharp: 'lots', loose: NaN, mistakes: Infinity, leaks: 'nope' },
        'not an object',
      ],
    })
    expect(state).not.toBeNull()
    const rounds = state!.rounds
    expect(rounds).toHaveLength(2)
    expect(Object.keys(rounds[0].leaks)).toEqual(['dealtIn'])
    expect(rounds[0].leaks.dealtIn).toBe(2)
    // Nothing polluted, and every count coerced to something sane.
    expect(({} as Record<string, unknown>).notALeak).toBeUndefined()
    expect(rounds[1]).toMatchObject({ day: '', discards: 0, sharp: 0, loose: 0, mistakes: 0, leaks: {} })
    expect(Number.isFinite(rounds[1].mistakes)).toBe(true)
  })
})
