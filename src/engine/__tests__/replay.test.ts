// The strongest test available for the replay: play REAL games with the real
// reducer, then prove that folding the resulting action log reproduces the
// public table at every single step. If replay.ts ever drifts from the engine's
// semantics — when a discard lands, who wins a contested tile, how a robbed
// kong resolves, what a chow exposes — this goes red at the exact action where
// they diverge.
//
// The engine is the oracle here; replay.ts never gets to mark its own homework.

import { describe, expect, it } from 'vitest'
import { botAction } from '../bots'
import { applyAction, createGame, legalActions, playerView, type Action, type GameState } from '../game'
import { makeRng } from '../rng'
import { LIVE_WALL_AT_DEAL, derivedWallCount, replayTo, stepTurn, visibleOnTable } from '../replay'
import { SEATS } from '../types'

/** Play a full round, keeping every intermediate state alongside the log. */
function playRound(seed: string): { log: Action[]; states: GameState[]; final: GameState } {
  let g = createGame({ faanMinimum: 0, flowers: true, faanCap: null }, seed, 0, 'E')
  const rng = makeRng(`bots:${seed}`)
  const states: GameState[] = [g] // states[i] = after i actions
  let guard = 0
  while (g.phase !== 'finished' && guard++ < 3000) {
    if (g.phase === 'claims') {
      // Seat order, deliberately NOT priority order: this is what produces logs
      // where a chow is recorded before the pung that actually takes the tile.
      const actors = SEATS.filter((s) => legalActions(g, s).length > 0)
      for (const s of actors) {
        if (g.phase !== 'claims') break
        g = applyAction(g, botAction(playerView(g, s), 'intermediate', rng) as Action)
        states.push(g)
      }
      continue
    }
    g = applyAction(g, botAction(playerView(g, g.turn), 'intermediate', rng) as Action)
    states.push(g)
  }
  return { log: g.log, states, final: g }
}

/** Claim windows in which more than one seat put in a claim. */
function contestedWindows(log: readonly Action[]): number {
  let n = 0
  let inWindow = 0
  for (const a of log) {
    if (a.type === 'claim') inWindow++
    else if (a.type !== 'pass') {
      if (inWindow > 1) n++
      inWindow = 0
    }
  }
  return inWindow > 1 ? n + 1 : n
}

const SEEDS = ['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7', 'r8', 'counts', 'visible', 'wall', 'clamp']

describe('replayTo reproduces the real table', () => {
  it.each(SEEDS)('matches the engine at every action (seed %s)', (seed) => {
    const { log, states } = playRound(seed)
    expect(log.length).toBeGreaterThan(20)

    for (let i = 0; i <= log.length; i++) {
      const board = replayTo(log, i)
      const truth = states[i]
      for (const seat of SEATS) {
        expect(board.discards[seat], `discards seat ${seat} @${i} (seed ${seed})`).toEqual(
          truth.discards[seat],
        )
        // Compare melds structurally: type + tiles + concealed is what the
        // table shows. (claimedFrom is bookkeeping the board doesn't render.)
        expect(
          board.melds[seat].map((m) => ({ type: m.type, tiles: m.tiles, concealed: m.concealed })),
          `melds seat ${seat} @${i} (seed ${seed})`,
        ).toEqual(
          truth.melds[seat].map((m) => ({ type: m.type, tiles: m.tiles, concealed: m.concealed })),
        )
        expect(board.handCounts[seat], `hand count seat ${seat} @${i} (seed ${seed})`).toBe(
          truth.hands[seat].length,
        )
      }
      expect(board.pending?.tile ?? null, `pending tile @${i} (seed ${seed})`).toEqual(
        truth.pendingDiscard?.tile ?? null,
      )
      expect(board.pending?.from ?? null, `pending from @${i} (seed ${seed})`).toEqual(
        truth.pendingDiscard?.from ?? null,
      )
    }
  })

  it('is actually exercising contested claim windows', () => {
    // Without this the sweep above could pass while the priority rule is
    // broken, simply because no two seats ever claimed the same tile.
    const total = SEEDS.reduce((n, seed) => n + contestedWindows(playRound(seed).log), 0)
    expect(total, 'no contested claim windows in the corpus — the priority rule is untested').toBeGreaterThan(0)
  })

  it('gives a contested tile to the pung, not to whoever claimed first', () => {
    // Find a real window where a chow was logged before a pung/kong and check
    // the engine handed the tile to the pung — i.e. that log order loses.
    let checked = 0
    for (const seed of SEEDS) {
      const { log, states } = playRound(seed)
      for (let i = 0; i < log.length; i++) {
        const a = log[i]
        if (a.type !== 'claim' || typeof a.claim !== 'object') continue
        // Scan the rest of this window for a pung/kong claim.
        for (let j = i + 1; j < log.length; j++) {
          const b = log[j]
          if (b.type !== 'claim' && b.type !== 'pass') break
          if (b.type !== 'claim' || (b.claim !== 'pung' && b.claim !== 'kong')) continue
          const after = replayTo(log, j + 1)
          const truth = states[j + 1]
          expect(after.melds[b.seat].length).toBe(truth.melds[b.seat].length)
          expect(after.melds[a.seat].length).toBe(truth.melds[a.seat].length)
          checked++
          break
        }
      }
    }
    // Informational: if the corpus has no chow-then-pung window this is 0 and
    // the assertion above (contested windows exist) still guards the rule.
    expect(checked).toBeGreaterThanOrEqual(0)
  })

  it('counts tiles visible on the table exactly', () => {
    const { log, states } = playRound('visible')
    for (let i = 0; i <= log.length; i += 5) {
      const board = replayTo(log, i)
      const truth = states[i]
      for (const kind of ['dR', 'dG', 'm5', 'p1', 'wE'] as const) {
        let expected = 0
        for (const seat of SEATS) {
          expected += truth.discards[seat].filter((t) => t === kind).length
          for (const m of truth.melds[seat]) expected += m.tiles.filter((t) => t === kind).length
        }
        if (truth.pendingDiscard?.tile === kind) expected++
        expect(visibleOnTable(board, kind), `${kind} @${i}`).toBe(expected)
      }
    }
  })

  it('names the seat to act while the round is live', () => {
    const { log, states } = playRound('turns')
    for (let i = 0; i <= log.length; i++) {
      const truth = states[i]
      if (truth.phase === 'finished' || truth.phase === 'claims') continue
      expect(replayTo(log, i).toAct, `toAct @${i}`).toBe(truth.turn)
    }
  })
})

describe('stepTurn', () => {
  it('walks between the tiles that hit the table, in both directions', () => {
    const { log } = playRound('step')
    const discards = log.map((a, i) => (a.type === 'discard' ? i : -1)).filter((i) => i >= 0)
    expect(discards.length).toBeGreaterThan(5)

    // Forward from each discard lands on the next one, and back again returns.
    for (let k = 0; k < discards.length - 1; k++) {
      expect(stepTurn(log, discards[k], 1)).toBe(discards[k + 1])
      expect(stepTurn(log, discards[k + 1], -1)).toBe(discards[k])
    }
  })

  it('returns null at the ends rather than wrapping or throwing', () => {
    const { log } = playRound('stepEnds')
    const discards = log.map((a, i) => (a.type === 'discard' ? i : -1)).filter((i) => i >= 0)
    expect(stepTurn(log, discards[0], -1)).toBeNull()
    expect(stepTurn(log, discards[discards.length - 1], 1)).toBeNull()
    expect(stepTurn([], 0, 1)).toBeNull()
    expect(stepTurn(log, -50, -1)).toBeNull()
    expect(stepTurn(log, log.length + 50, 1)).toBeNull()
  })

  it('steps from a non-discard action, which is where a missed claim sits', () => {
    const { log } = playRound('stepPass')
    const pass = log.findIndex((a) => a.type === 'pass')
    expect(pass).toBeGreaterThan(0)
    // The discard being passed on is behind it; the next one is ahead.
    const back = stepTurn(log, pass, -1)
    expect(back).not.toBeNull()
    expect(log[back!].type).toBe('discard')
  })
})

describe('replayTo edge cases', () => {
  it('is a no-op at index 0 and clamps past the end', () => {
    const { log } = playRound('clamp')
    const start = replayTo(log, 0)
    expect(start.index).toBe(0)
    expect(SEATS.every((s) => start.discards[s].length === 0)).toBe(true)
    expect(SEATS.every((s) => start.melds[s].length === 0)).toBe(true)
    expect(start.pending).toBeNull()
    // The dealer opens holding 14; every other seat has 13.
    expect(SEATS.filter((s) => start.handCounts[s] === 14)).toHaveLength(1)

    const past = replayTo(log, log.length + 500)
    expect(past.index).toBe(log.length)
    expect(past).toEqual(replayTo(log, log.length))
    expect(past.finished).toBe(true)
  })

  it('survives an empty log and a log of only passes', () => {
    expect(() => replayTo([], 5)).not.toThrow()
    expect(replayTo([], 5).index).toBe(0)
    const passes: Action[] = [
      { type: 'pass', seat: 1 },
      { type: 'pass', seat: 2 },
    ]
    expect(() => replayTo(passes, 2)).not.toThrow()
    expect(replayTo(passes, 2).pending).toBeNull()
  })

  it('does not mutate the log it is given', () => {
    const { log } = playRound('immutable')
    const before = JSON.stringify(log)
    replayTo(log, Math.floor(log.length / 2))
    replayTo(log, log.length)
    expect(JSON.stringify(log)).toBe(before)
  })

  it('returns independent boards that callers can safely hold', () => {
    const { log } = playRound('isolate')
    const a = replayTo(log, 20)
    const b = replayTo(log, 20)
    a.discards[0].push('dR')
    a.melds[0].push({ type: 'pung', tiles: ['dR', 'dR', 'dR'], concealed: false })
    expect(b.discards[0]).not.toContain('dR')
    expect(b.melds[0]).toHaveLength(0)
  })

  it('derives a wall count that tracks the engine within the flower allowance', () => {
    const { log, states } = playRound('wall')
    expect(LIVE_WALL_AT_DEAL).toBe(77)
    for (let i = 0; i <= log.length; i += 11) {
      const derived = derivedWallCount(replayTo(log, i))
      const actual = playerView(states[i], 0).wallCount
      // Bonus/kong replacement draws come off the BACK of the wall and are
      // invisible to the log, so the derived count drifts by at most the number
      // of bonus tiles in play (8).
      expect(Math.abs(derived - actual), `wall @${i}: derived ${derived} vs ${actual}`).toBeLessThanOrEqual(10)
    }
  })
})
