// Room protocol: everything that crosses the transport boundary. In
// multiplayer these are wire messages; in solo they cross a function call.
// Every type here must survive JSON.stringify unchanged — no classes, no
// Maps, no undefined-valued keys added on purpose.
//
// Security note (spec §2.2): ServerMsg is the ONLY thing a client ever
// receives. 'view' carries a per-seat PlayerView; 'finished' additionally
// discloses the round's full action log — deliberately, and only once the
// round is over, because the Phase 1.5 review coach replays it. Nothing in
// this file may ever carry GameState, the wall, or a seed.

import type { Difficulty } from '../engine/bots'
import type { Action, PlayerView, RoundResult, RuleConfig } from '../engine/game'
import type { Seat, Wind } from '../engine/types'

export type SeatController = { kind: 'human' } | { kind: 'bot'; difficulty: Difficulty }

export interface MatchInfo {
  dealer: Seat
  roundWind: Wind
  roundNo: number
  /** Cumulative faan won per seat (teaching scoreboard, not point settlement). */
  scores: Record<Seat, number>
}

/** Client → room. */
export type ClientMsg =
  | { type: 'intent'; action: Action }
  | { type: 'newRound'; rules?: RuleConfig; seats?: Record<Seat, SeatController> }

/** Room → seat(s). */
export type ServerMsg =
  | { type: 'view'; seq: number; view: PlayerView; match: MatchInfo }
  | { type: 'finished'; seq: number; result: RoundResult; log: Action[]; match: MatchInfo }
  | { type: 'rejected'; seq: number; reason: string }
