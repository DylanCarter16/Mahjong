// Capture the player's own hand at each of their decisions, so the post-round
// review can grade them.
//
// WHY THIS IS NEEDED AT ALL
// The review reconstructs the table from the action log (see engine/replay.ts),
// which is exact for everything public. It cannot reconstruct a concealed hand:
// a `draw` action records the seat and not the tile, deliberately — hidden
// information never leaves the server, and the leak test enforces it. The
// client, however, is already sent its own hand in every view. So the hand is
// not recovered after the fact; it is remembered as the round is played.
//
// Nothing here is new information and nothing crosses a trust boundary: these
// are this player's own views, kept on this device, and sent back with their
// own review request.

import type { PlayerView } from '../engine/game'
import type { HandSnapshot } from '../engine/review'

/**
 * A round's worth of snapshots is bounded by the number of turns, but cap it
 * anyway — this is the payload of a network request, and an unbounded array
 * built from a message stream is exactly the kind of thing that turns into a
 * 2MB POST when something upstream misbehaves.
 */
const MAX_SNAPSHOTS = 240

export class SnapshotRecorder {
  private roundNo = -1
  private snaps: HandSnapshot[] = []
  private seen = new Set<number>()

  /**
   * Record this view if it represents a decision this seat had to make.
   *
   * A view where `legal` is empty is not a decision — during a claim window
   * every seat gets a view, but only the seats that can actually claim have
   * legal actions, and a seat that has already answered has none. That single
   * test is what makes these pair one-to-one with the seat's own actions in the
   * log.
   */
  observe(seq: number, view: PlayerView, roundNo: number): void {
    if (roundNo !== this.roundNo) this.startRound(roundNo)
    if (view.phase !== 'discard' && view.phase !== 'claims') return
    if (view.legal.length === 0) return
    // The same seq can arrive twice (a reconnect replays the current view, and
    // React can deliver a message to a remounted listener). Dedupe on it.
    if (this.seen.has(seq) || this.snaps.length >= MAX_SNAPSHOTS) return
    this.seen.add(seq)
    this.snaps.push({
      seq,
      phase: view.phase,
      concealed: [...view.concealed],
      wallCount: view.wallCount,
    })
  }

  /** A copy, so a caller holding the result can't be changed underneath. */
  take(): HandSnapshot[] {
    return this.snaps.map((s) => ({ ...s, concealed: [...s.concealed] }))
  }

  private startRound(roundNo: number): void {
    this.roundNo = roundNo
    this.snaps = []
    this.seen.clear()
  }
}
