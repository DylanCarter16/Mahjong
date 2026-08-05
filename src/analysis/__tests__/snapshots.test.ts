// The capture side of the review, tested against the real message stream.
//
// The scanner pairs captured hands back onto the player's own actions in the
// log, and a pairing that drifts grades a discard against a hand that never
// held it. The recorder's capture rule and the scanner's pairing rule therefore
// have to agree exactly — so the test that matters is not "the recorder records
// things", it is: play a real solo round over the real transport, then scan it,
// and require that every single decision found its hand.
//
// The rounds are seeded end to end — deal, bots and this seat's own choices —
// so a failure here is reproducible rather than something that shows up once in
// twenty runs and can't be pinned down.

import { describe, expect, it } from 'vitest'
import { botAction } from '../../engine/bots'
import type { Action, PlayerView, RoundResult } from '../../engine/game'
import { makeRng } from '../../engine/rng'
import { scanRound } from '../../engine/review'
import { FakeClock } from '../../room/clock'
import { createSoloRoom } from '../../room/solo'
import type { MatchInfo } from '../../room/protocol'
import { SnapshotRecorder } from '../snapshots'

const RULES = { faanMinimum: 0, flowers: true, faanCap: null } as const
const DIFFICULTIES = { 0: 'easy', 1: 'intermediate', 2: 'intermediate', 3: 'intermediate' } as const

interface Played {
  recorder: SnapshotRecorder
  finished: { result: RoundResult; log: Action[] } | null
  lastView: PlayerView | null
  match: MatchInfo | null
  views: number
}

/**
 * Play a solo round the way the app does: subscribe to the connection, record
 * every view, and answer with an intent whenever this seat has a legal action.
 * The clock is fake so the runner's pacing delays resolve instantly.
 */
function playSolo(seed: string, rounds = 1): Played {
  const clock = new FakeClock()
  const room = createSoloRoom({ rules: RULES, difficulties: { ...DIFFICULTIES }, seed }, clock)
  const rng = makeRng(`human:${seed}`)
  const out: Played = { recorder: new SnapshotRecorder(), finished: null, lastView: null, match: null, views: 0 }
  const queue: Action[] = []

  room.conn.onMessage((m) => {
    if (m.type === 'view') {
      out.views++
      out.recorder.observe(m.seq, m.view, m.match.roundNo)
      out.lastView = m.view
      out.match = m.match
      // Queue rather than send: sending inside the handler would re-enter the
      // runner mid-broadcast, which no real client does.
      if (m.view.legal.length > 0) queue.push(botAction(m.view, 'easy', rng) as Action)
    } else if (m.type === 'finished') {
      out.finished = { result: m.result, log: [...m.log] }
      out.match = m.match
    }
  })

  room.runner.start()
  for (let round = 0; round < rounds; round++) {
    if (round > 0) room.conn.send({ type: 'newRound' })
    let guard = 0
    const startedAt = out.finished
    while (out.finished === startedAt && guard++ < 4000) {
      const next = queue.shift()
      if (next) room.conn.send({ type: 'intent', action: next })
      else clock.advance(1000)
    }
    queue.length = 0
  }
  room.runner.stop()
  return out
}

const scanOf = (p: Played) =>
  scanRound({
    seat: 0,
    log: p.finished!.log,
    result: p.finished!.result,
    roundWind: p.lastView!.roundWind,
    seatWinds: p.lastView!.seatWinds,
    faanMinimum: RULES.faanMinimum,
    snapshots: p.recorder.take(),
  })

describe('recording a real solo round', () => {
  it.each(['s1', 's2', 's3', 's4'])('captures a hand for every decision (seed %s)', (seed) => {
    const played = playSolo(seed)
    expect(played.finished, 'the round never finished').not.toBeNull()
    const scan = scanOf(played)

    const ownDiscards = played.finished!.log.filter((a) => a.type === 'discard' && a.seat === 0).length
    expect(ownDiscards, 'this seed produced no decisions to check').toBeGreaterThan(0)
    // The whole point: no decision fell back to public facts only.
    expect(scan.degraded, `degraded: ${scan.degraded.join(' | ')}`).toEqual([])
    expect(scan.moments.filter((m) => m.kind === 'discard' || m.kind === 'dealIn')).toHaveLength(
      ownDiscards,
    )
  })

  it('records one snapshot per decision, not one per view', () => {
    // Every seat gets a view after every action, so a recorder that captured
    // indiscriminately would collect several times as many as there are
    // decisions — and then pair every one of them wrongly.
    const played = playSolo('density')
    const snaps = played.recorder.take()
    const decisions = played.finished!.log.filter(
      (a) => a.seat === 0 && (a.type === 'discard' || a.type === 'claim' || a.type === 'pass' || a.type === 'kong'),
    ).length
    expect(snaps.length).toBe(decisions)
    expect(played.views).toBeGreaterThan(snaps.length * 2)
  })

  it('starts a fresh set on the next round rather than accumulating', () => {
    const played = playSolo('twoRounds', 2)
    const snaps = played.recorder.take()
    const decisions = played.finished!.log.filter(
      (a) => a.seat === 0 && (a.type === 'discard' || a.type === 'claim' || a.type === 'pass' || a.type === 'kong'),
    ).length
    // If round one's snapshots leaked into round two this is roughly double,
    // and every moment in the second round grades against the wrong hand.
    expect(snaps.length).toBe(decisions)
    expect(scanOf(played).degraded).toEqual([])
  })

  it('hands out copies, so a caller cannot mutate the recorder', () => {
    const played = playSolo('copies')
    const first = played.recorder.take()
    const size = first.length
    const handSize = first[0].concealed.length
    first[0].concealed.push('dR')
    first.length = 0

    const second = played.recorder.take()
    expect(second).toHaveLength(size)
    expect(second[0].concealed).toHaveLength(handSize)
  })
})

describe('the recorder in isolation', () => {
  const view = (over: Partial<PlayerView>): PlayerView =>
    ({
      seat: 0,
      phase: 'discard',
      concealed: ['m1'],
      wallCount: 50,
      legal: [{ type: 'discard', seat: 0, tile: 'm1' }],
      ...over,
    }) as PlayerView

  it('ignores views where this seat has nothing to decide', () => {
    const r = new SnapshotRecorder()
    r.observe(1, view({ legal: [] }), 1)
    r.observe(2, view({ phase: 'draw' }), 1)
    r.observe(3, view({ phase: 'finished' }), 1)
    expect(r.take()).toEqual([])
  })

  it('ignores a repeated seq, which a reconnect replays', () => {
    const r = new SnapshotRecorder()
    r.observe(7, view({}), 1)
    r.observe(7, view({ concealed: ['p9'] }), 1)
    expect(r.take()).toHaveLength(1)
    expect(r.take()[0].concealed).toEqual(['m1'])
  })

  it('records both decision phases with the wall count as seen', () => {
    const r = new SnapshotRecorder()
    r.observe(1, view({ phase: 'discard', wallCount: 44 }), 1)
    r.observe(2, view({ phase: 'claims', wallCount: 43 }), 1)
    expect(r.take().map((s) => [s.phase, s.wallCount])).toEqual([
      ['discard', 44],
      ['claims', 43],
    ])
  })

  it('is bounded — a stuck stream cannot grow the payload without limit', () => {
    const r = new SnapshotRecorder()
    for (let i = 0; i < 5000; i++) r.observe(i, view({}), 1)
    expect(r.take().length).toBeLessThanOrEqual(240)
  })
})
