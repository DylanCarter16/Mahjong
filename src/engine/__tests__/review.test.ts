// The review scanner graded against real rounds.
//
// The bar here is higher than "it returns something": a review that quotes a
// wrong number is worse than no review, so these tests check the FACTS, not
// just the shape. Hands are captured the way the client captures them (from the
// view stream, one per decision) and every graded moment must be traceable back
// to what the engine actually held.

import { describe, expect, it } from 'vitest'
import { botAction } from '../bots'
import { applyAction, createGame, legalActions, playerView, type Action, type GameState } from '../game'
import { rankDiscards } from '../analysis'
import { makeRng } from '../rng'
import { replayTo, visibleOnTable } from '../replay'
import { hand } from '../tiles'
import { pickShortlist, scanRound, type HandSnapshot, type Moment, type ReviewInput } from '../review'
import { SEATS, type Seat } from '../types'

const RULES = { faanMinimum: 0, flowers: true, faanCap: null } as const

interface Round {
  input: ReviewInput
  states: GameState[]
  final: GameState
}

/**
 * Play a round while capturing the reviewed seat's hand exactly as the client
 * would: one snapshot per view in which that seat has something to decide.
 *
 * `passAlways` makes the reviewed seat decline every claim, which is how the
 * missed-claim path gets a real log to grade rather than a hand-built one.
 */
function playRound(seed: string, seat: Seat = 0, passAlways = false): Round {
  let g = createGame(RULES, seed, 0, 'E')
  const rng = makeRng(`bots:${seed}`)
  const states: GameState[] = [g]
  const snapshots: HandSnapshot[] = []
  let seq = 0

  const capture = () => {
    if (g.phase !== 'discard' && g.phase !== 'claims') return
    if (legalActions(g, seat).length === 0) return
    const v = playerView(g, seat)
    snapshots.push({ seq: seq++, phase: g.phase, concealed: [...v.concealed], wallCount: v.wallCount })
  }

  const act = (s: Seat): Action => {
    const view = playerView(g, s)
    if (s === seat && passAlways && g.phase === 'claims') {
      const pass = view.legal.find((a) => a.type === 'pass')
      if (pass) return pass
    }
    // The reviewed seat plays at beginner strength — that is who the review is
    // for, and a corpus of optimal play never exercises the grader at all.
    return botAction(view, s === seat ? 'easy' : 'intermediate', rng) as Action
  }

  capture()
  let guard = 0
  while (g.phase !== 'finished' && guard++ < 3000) {
    if (g.phase === 'claims') {
      const actors = SEATS.filter((s) => legalActions(g, s).length > 0)
      for (const s of actors) {
        if (g.phase !== 'claims') break
        g = applyAction(g, act(s))
        states.push(g)
        capture()
      }
      continue
    }
    g = applyAction(g, act(g.turn))
    states.push(g)
    capture()
  }

  return {
    states,
    final: g,
    input: {
      seat,
      log: g.log,
      result: g.result!,
      roundWind: g.roundWind,
      seatWinds: { ...g.seatWinds },
      faanMinimum: RULES.faanMinimum,
      snapshots,
    },
  }
}

const SEEDS = ['v1', 'v2', 'v3', 'v4', 'v5', 'v6']

/** Internal tile codes that must never reach the player: m5, dR, wN … */
const CODE = /(?:^|[\s"'(])(?:[mps][1-9]|w[ESWN]|d[RGW])(?:$|[\s".,;:)])/

describe('scanRound over real rounds', () => {
  it.each(SEEDS)('recovers every hand and grades every discard (seed %s)', (seed) => {
    const { input } = playRound(seed)
    const scan = scanRound(input)

    const ownDiscards = input.log.filter((a) => a.type === 'discard' && a.seat === input.seat).length
    const graded = scan.moments.filter((m) => m.kind === 'discard' || m.kind === 'dealIn')
    expect(graded).toHaveLength(ownDiscards)
    expect(scan.tally.discards).toBe(ownDiscards)

    // Client-captured hands must pair onto every decision. If this ever fails,
    // the review is grading somebody's guess.
    expect(scan.degraded, `degraded moments: ${scan.degraded.join(' | ')}`).toEqual([])
    expect(graded.every((m) => m.replayable)).toBe(true)
  })

  it.each(SEEDS)('quotes visible-tile counts that match the table exactly (seed %s)', (seed) => {
    const { input } = playRound(seed)
    for (const m of scanRound(input).moments) {
      if (m.kind !== 'discard' && m.kind !== 'dealIn') continue
      const stated = /— (\d+) of 4/.exec(m.facts[0])
      expect(stated, `no visible count in: ${m.facts[0]}`).not.toBeNull()
      const truth = visibleOnTable(replayTo(input.log, m.index + 1), m.tile!)
      expect(Number(stated![1]), `turn ${m.turn} ${m.tile}`).toBe(truth)
    }
  })

  it.each(SEEDS)('grades the discard that was won on as a deal-in (seed %s)', (seed) => {
    const { input, final } = playRound(seed)
    const scan = scanRound(input)
    const dealtIn = final.result?.kind === 'win' && final.result.loser === input.seat
    expect(scan.tally.dealtIn).toBe(dealtIn)
    const moment = scan.moments.find((m) => m.kind === 'dealIn')
    if (dealtIn) {
      expect(moment, 'dealt in but no dealIn moment').toBeDefined()
      expect(moment!.verdict).toBe('mistake')
      // The worst thing that happened in the round always makes the shortlist.
      expect(scan.shortlist.map((m) => m.index)).toContain(moment!.index)
    } else {
      expect(moment).toBeUndefined()
    }
  })

  it('has a corpus that actually contains a deal-in', () => {
    // Without this the per-seed test above passes vacuously if no seed in the
    // corpus ever deals in, and the deal-in grading goes untested.
    const dealIns = SEEDS.filter((s) => scanRound(playRound(s).input).tally.dealtIn)
    expect(dealIns.length, 'no seed in the corpus deals in').toBeGreaterThan(0)
  })

  it('uses the full range of verdicts rather than grading everything the same', () => {
    // A grader that returns one label for every discard would satisfy most of
    // the tests here. This is the one that says it discriminates.
    const seen = new Set<string>()
    for (const seed of [...SEEDS, 'w1', 'w2', 'w3', 'w4', 'w5', 'w6']) {
      for (const m of scanRound(playRound(seed).input).moments) seen.add(m.verdict)
    }
    expect([...seen].sort()).toEqual(['fine', 'loose', 'mistake', 'sharp'])
  })

  it.each(SEEDS)('never leaks internal tile codes or markdown (seed %s)', (seed) => {
    const scan = scanRound(playRound(seed).input)
    const text = [
      scan.summary,
      ...scan.moments.flatMap((m) => [m.headline, ...m.facts, m.better?.why ?? '']),
    ].join('\n')
    expect(text).not.toMatch(CODE)
    expect(text).not.toMatch(/[*_`#]/)
  })

  it.each(SEEDS)('only ever names an alternative that was genuinely better (seed %s)', (seed) => {
    // Checked against the REAL view at that turn — the engine's own state, not
    // the review's reconstruction — so this catches the review agreeing with
    // itself. "Better" means never slower, and either faster or safer.
    const { input, states } = playRound(seed)
    let checked = 0
    for (const m of scanRound(input).moments) {
      if (!m.better) continue
      expect(states[m.index].hands[input.seat]).toContain(m.better.tile)
      expect(m.better.tile).not.toBe(m.tile)

      const ranked = rankDiscards(playerView(states[m.index], input.seat))
      const played = ranked.find((r) => r.tile === m.tile)!
      const alt = ranked.find((r) => r.tile === m.better!.tile)!
      const opps = SEATS.filter((s) => s !== input.seat)
      const d = (r: (typeof ranked)[number], s: Seat) => r.dangerByOpponent[s] ?? 0

      expect(alt.shantenAfter, `turn ${m.turn}: suggested a slower discard`).toBeLessThanOrEqual(
        played.shantenAfter,
      )
      if (alt.shantenAfter === played.shantenAfter) {
        // Sold as the safer tile, so it must be safer against EVERY opponent —
        // not merely safer on average.
        expect(opps.every((s) => d(alt, s) <= d(played, s)), `turn ${m.turn}: ${m.better!.why}`).toBe(true)
        expect(opps.some((s) => d(alt, s) < d(played, s)), `turn ${m.turn}: ${m.better!.why}`).toBe(true)
      }
      if (/was dead/.test(m.better.why)) {
        expect(opps.every((s) => d(alt, s) === 0), `turn ${m.turn}: called a live tile dead`).toBe(true)
      }
      checked++
    }
    expect(checked).toBeGreaterThanOrEqual(0)
  })

  it('produces better-lines somewhere in the corpus', () => {
    // The per-seed check above is vacuous on a round with nothing to improve.
    const total = SEEDS.reduce(
      (n, s) => n + scanRound(playRound(s).input).moments.filter((m) => m.better).length,
      0,
    )
    expect(total, 'no round in the corpus produced a single better-line').toBeGreaterThan(0)
  })

  it.each(SEEDS)('writes sentences a person would write (seed %s)', (seed) => {
    const scan = scanRound(playRound(seed).input)
    for (const m of scan.moments) {
      for (const fact of m.facts) {
        // "and 0 Circles in their pool" is true and unreadable; say the other
        // thing instead.
        expect(fact, 'a zero rendered as a count').not.toMatch(/\b0 (Characters|Circles|Bamboo|sets?)\b/)
        expect(fact.trim(), 'an empty or unterminated fact').toMatch(/^\S.*[.!?]$/)
      }
      expect(m.headline.trim()).toMatch(/^\S.*[.!?]$/)
    }
  })

  it.each(SEEDS)('states nothing about an opponent that the table did not show (seed %s)', (seed) => {
    // Every clause the review writes about an opponent is re-derived here from
    // the replayed pool. A review that overstates a read is worse than one that
    // says less, so each sentence has to survive being checked literally.
    const { input } = playRound(seed)
    const winds = { E: 0, S: 1, W: 2, N: 3 } as const
    let checked = 0
    for (const m of scanRound(input).moments) {
      if (m.kind !== 'discard' && m.kind !== 'dealIn') continue
      const board = replayTo(input.log, m.index)
      for (const fact of m.facts) {
        const who = /^(East|South|West|North) had /.exec(fact)
        if (!who) continue
        const wind = who[1][0] as keyof typeof winds
        const seat = SEATS.find((s) => input.seatWinds[s] === wind)!
        expect(seat, `seat ${wind} not at the table`).toBeDefined()
        const pool = board.discards[seat]
        const exposed = board.melds[seat].filter((x) => !x.concealed).length
        checked++

        if (/already discarded the .*, so it was dead against them/.test(fact)) {
          expect(pool, fact).toContain(m.tile)
          continue
        }
        expect(pool, `${fact} — but the tile is in their pool`).not.toContain(m.tile)

        const sets = /(\d+) sets? exposed/.exec(fact)
        if (sets) expect(Number(sets[1]), fact).toBe(exposed)
        if (/nothing exposed/.test(fact)) expect(exposed, fact).toBe(0)

        const suitOfTile = { m: 'Characters', p: 'Circles', s: 'Bamboo' }[m.tile![0]]
        const none = /had not discarded a single (Characters|Circles|Bamboo)/.exec(fact)
        if (none) {
          expect(none[1], fact).toBe(suitOfTile)
          expect(pool.filter((t) => t[0] === m.tile![0]), fact).toHaveLength(0)
        }
        const some = /and (\d+) (Characters|Circles|Bamboo) in their pool/.exec(fact)
        if (some) {
          expect(some[2], fact).toBe(suitOfTile)
          expect(pool.filter((t) => t[0] === m.tile![0]), fact).toHaveLength(Number(some[1]))
        }
      }
    }
    expect(checked, 'no opponent sentences were produced at all').toBeGreaterThan(0)
  })

  it.each(SEEDS)('quotes the wall count that was really on the table (seed %s)', (seed) => {
    const { input, states } = playRound(seed)
    for (const m of scanRound(input).moments) {
      const stated = /^(\d+) tiles left in the wall/.exec(m.facts.find((f) => /wall/.test(f)) ?? '')
      if (!stated) continue
      expect(Number(stated[1]), `turn ${m.turn}`).toBe(playerView(states[m.index], input.seat).wallCount)
    }
  })

  it('is pure: it does not mutate the log or the snapshots', () => {
    const { input } = playRound('pure')
    const before = JSON.stringify({ log: input.log, snaps: input.snapshots })
    scanRound(input)
    scanRound(input)
    expect(JSON.stringify({ log: input.log, snaps: input.snapshots })).toBe(before)
  })

  it('is deterministic', () => {
    const { input } = playRound('deterministic')
    expect(JSON.stringify(scanRound(input))).toBe(JSON.stringify(scanRound(input)))
  })
})

describe('missed claims', () => {
  it('flags a winning tile the player passed on', () => {
    // Constructed rather than found by playing seeds: passing on a win is rare
    // enough that searching for one is slow and non-deterministic, and this is
    // the single worst miss in the game — it deserves an exact case.
    //
    // Seat 0 holds four complete sets plus a lone Red Dragon; South throws the
    // Red Dragon that pairs it, and seat 0 passes.
    const winning = hand('m1 m1 m1 m2 m3 m4 p1 p2 p3 s7 s8 s9 dR')
    const log: Action[] = [
      { type: 'discard', seat: 0, tile: 'm9' },
      { type: 'pass', seat: 1 },
      { type: 'pass', seat: 2 },
      { type: 'pass', seat: 3 },
      { type: 'draw', seat: 1 },
      { type: 'discard', seat: 1, tile: 'dR' },
      { type: 'pass', seat: 0 }, // ← the moment
      { type: 'pass', seat: 2 },
      { type: 'draw', seat: 2 },
      { type: 'discard', seat: 2, tile: 'p7' },
    ]
    const scan = scanRound({
      seat: 0,
      log,
      result: { kind: 'draw' },
      roundWind: 'E',
      seatWinds: { 0: 'E', 1: 'S', 2: 'W', 3: 'N' },
      faanMinimum: 0,
      snapshots: [
        { seq: 0, phase: 'discard', concealed: [...winning, 'm9'], wallCount: 60 },
        { seq: 1, phase: 'claims', concealed: winning, wallCount: 58 },
      ],
    })

    const win = scan.moments.find((m) => m.kind === 'missedClaim')
    expect(win, 'a passed-up winning tile was not graded').toBeDefined()
    expect(win!.index).toBe(6)
    expect(win!.tile).toBe('dR')
    expect(win!.headline).toMatch(/winning tile/)
    expect(win!.headline).toMatch(/Red Dragon/)
    expect(win!.verdict).toBe('mistake')
    expect(win!.weight).toBeGreaterThanOrEqual(95)
    // Nothing in a round outweighs walking past a win.
    expect(scan.shortlist[0]).toBe(win)
  })

  it('does not flag a pass on a tile that would not have helped', () => {
    // Same shape, but the discard is unrelated to the hand: passing was right,
    // and inventing a "missed claim" here would teach the wrong lesson.
    const held = hand('m1 m1 m1 m2 m3 m4 p1 p2 p3 s7 s8 s9 dR')
    const log: Action[] = [
      { type: 'discard', seat: 0, tile: 'm9' },
      { type: 'pass', seat: 1 },
      { type: 'draw', seat: 1 },
      { type: 'discard', seat: 1, tile: 'p6' },
      { type: 'pass', seat: 0 },
      { type: 'draw', seat: 2 },
    ]
    const scan = scanRound({
      seat: 0,
      log,
      result: { kind: 'draw' },
      roundWind: 'E',
      seatWinds: { 0: 'E', 1: 'S', 2: 'W', 3: 'N' },
      faanMinimum: 0,
      snapshots: [
        { seq: 0, phase: 'discard', concealed: [...held, 'm9'], wallCount: 60 },
        { seq: 1, phase: 'claims', concealed: held, wallCount: 58 },
      ],
    })
    expect(scan.moments.filter((m) => m.kind === 'missedClaim')).toEqual([])
  })

  it('flags claims that would have advanced the hand', () => {
    let total = 0
    for (let i = 0; i < 12; i++) {
      const scan = scanRound(playRound(`skip${i}`, 0, true).input)
      total += scan.moments.filter((m) => m.kind === 'missedClaim').length
      for (const m of scan.moments) {
        if (m.kind !== 'missedClaim') continue
        expect(m.verdict).toBe('mistake')
        expect(m.tile).not.toBeNull()
      }
    }
    expect(total, 'a seat that passed on everything missed nothing at all').toBeGreaterThan(0)
  })

  it('does not invent misses when the player claimed correctly', () => {
    // Same seeds, normal play: the intermediate bot takes claims that reduce
    // shanten, so its missed-claim count must be far below the all-pass run.
    const passing = ['skip0', 'skip1', 'skip2', 'skip3'].reduce(
      (n, s) => n + scanRound(playRound(s, 0, true).input).tally.missedClaims,
      0,
    )
    const playing = ['skip0', 'skip1', 'skip2', 'skip3'].reduce(
      (n, s) => n + scanRound(playRound(s, 0, false).input).tally.missedClaims,
      0,
    )
    expect(playing).toBeLessThan(passing)
  })
})

describe('the shortlist', () => {
  it.each(SEEDS)('is at most four, in log order, with no two adjacent turns (seed %s)', (seed) => {
    const scan = scanRound(playRound(seed).input)
    expect(scan.shortlist.length).toBeLessThanOrEqual(4)
    for (let i = 1; i < scan.shortlist.length; i++) {
      expect(scan.shortlist[i].index).toBeGreaterThan(scan.shortlist[i - 1].index)
      expect(Math.abs(scan.shortlist[i].turn - scan.shortlist[i - 1].turn)).toBeGreaterThanOrEqual(2)
    }
    // Everything shortlisted is a real graded moment, not a synthesised one.
    for (const m of scan.shortlist) expect(scan.moments).toContain(m)
  })

  it('leads with the heaviest moments rather than the first ones in the log', () => {
    const moments = [
      moment({ index: 2, turn: 1, weight: 5, verdict: 'fine' }),
      moment({ index: 10, turn: 5, weight: 90, verdict: 'mistake' }),
      moment({ index: 20, turn: 10, weight: 70, verdict: 'mistake' }),
      moment({ index: 30, turn: 15, weight: 60, verdict: 'loose' }),
      moment({ index: 40, turn: 20, weight: 8, verdict: 'fine' }),
    ]
    const picked = pickShortlist(moments)
    expect(picked.map((m) => m.turn)).toEqual([5, 10, 15, 20])
  })

  it('drops a moment that sits one turn from one already picked', () => {
    const picked = pickShortlist([
      moment({ index: 10, turn: 5, weight: 90, verdict: 'mistake' }),
      moment({ index: 12, turn: 6, weight: 80, verdict: 'mistake' }),
      moment({ index: 30, turn: 15, weight: 70, verdict: 'loose' }),
    ])
    expect(picked.map((m) => m.turn)).toEqual([5, 15])
  })

  it('saves a slot for a sharp play when there was one', () => {
    const picked = pickShortlist([
      moment({ index: 10, turn: 5, weight: 90, verdict: 'mistake' }),
      moment({ index: 20, turn: 10, weight: 80, verdict: 'mistake' }),
      moment({ index: 30, turn: 15, weight: 70, verdict: 'loose' }),
      moment({ index: 40, turn: 20, weight: 60, verdict: 'loose' }),
      moment({ index: 50, turn: 25, weight: 25, verdict: 'sharp' }),
    ])
    expect(picked.map((m) => m.verdict)).toContain('sharp')
  })

  it('does not manufacture a sharp moment when the round had none', () => {
    const picked = pickShortlist([
      moment({ index: 10, turn: 5, weight: 90, verdict: 'mistake' }),
      moment({ index: 20, turn: 10, weight: 80, verdict: 'loose' }),
    ])
    expect(picked.every((m) => m.verdict !== 'sharp')).toBe(true)
    expect(picked).toHaveLength(2)
  })

  it('ignores moments with no instructive weight', () => {
    expect(pickShortlist([moment({ index: 1, turn: 1, weight: 0, verdict: 'fine' })])).toEqual([])
  })
})

describe('degrading instead of guessing', () => {
  it('produces a review with no snapshots at all, and says so', () => {
    const { input } = playRound('nosnap')
    const scan = scanRound({ ...input, snapshots: [] })
    expect(scan.moments.length).toBeGreaterThan(0)
    expect(scan.degraded.join(' ')).toMatch(/no hands were captured/)
    expect(scan.moments.filter((m) => m.kind === 'discard').every((m) => !m.replayable)).toBe(true)
    // A deal-in is public knowledge, so it is still graded without a hand.
    expect(scan.summary.length).toBeGreaterThan(0)
  })

  it('never grades a discard against a hand that did not contain it', () => {
    // Corrupt the pairing the way a dropped or duplicated view would, then
    // check the guard holds: any moment marked replayable must have been graded
    // on a hand that really held the tile.
    const { input, states } = playRound('drift')
    for (const drop of [1, 2, 5]) {
      const scan = scanRound({ ...input, snapshots: input.snapshots!.slice(drop) })
      for (const m of scan.moments) {
        if (!m.replayable || m.kind !== 'discard') continue
        expect(states[m.index].hands[input.seat], `turn ${m.turn}`).toContain(m.tile)
      }
    }
  })

  it('survives a truncated log and an empty one', () => {
    const { input } = playRound('trunc')
    expect(() => scanRound({ ...input, log: input.log.slice(0, 9) })).not.toThrow()
    const empty = scanRound({ ...input, log: [], snapshots: [] })
    expect(empty.moments).toEqual([])
    expect(empty.shortlist).toEqual([])
    expect(empty.summary.length).toBeGreaterThan(0)
  })
})

describe('the round summary', () => {
  it.each(SEEDS)('states the real outcome and real counts (seed %s)', (seed) => {
    const { input, final } = playRound(seed)
    const scan = scanRound(input)
    const r = final.result!
    if (r.kind === 'draw') expect(scan.summary).toMatch(/Wall exhausted/)
    else if (r.winner === input.seat) expect(scan.summary).toMatch(/You (self-drew|won)/)
    else if (r.loser === input.seat) expect(scan.summary).toMatch(/You dealt into/)
    else expect(scan.summary).toMatch(/(East|South|West|North) won/)

    const stated = /across (\d+) discards/.exec(scan.summary)
    if (stated) expect(Number(stated[1])).toBe(scan.tally.discards)
  })
})

/** A bare moment for the pure shortlist tests. */
function moment(over: Partial<Moment> & Pick<Moment, 'index' | 'turn' | 'weight' | 'verdict'>): Moment {
  return {
    kind: 'discard',
    tile: 'm1',
    headline: '',
    facts: [],
    better: null,
    replayable: true,
    ...over,
  }
}
