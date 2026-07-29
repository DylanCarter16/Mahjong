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

/**
 * House rules the host sets in the lobby (spec §4).
 *
 * The line these sit on: a HOUSE RULE is set by the host, applies to the whole
 * room, and is locked once the game starts. A personal DISPLAY preference
 * (numbered tiles, reduced motion, whether *you* want the aid overlays) lives
 * in the client's Settings, never crosses the wire, and is changeable at any
 * time. `coachAllowed` and `beginnerAidsAllowed` are the two rules that gate a
 * personal preference; neither one is a game-state change.
 */
export interface HouseRules extends RuleConfig {
  /** Claim window length in seconds, 3–8. */
  claimWindowSec: number
  /** Turn timer in seconds. */
  turnTimerSec: number
  /** AI coach visible-to-everyone toggle (§9). Advisory, not a secret. */
  coachAllowed: boolean
  /**
   * May players use the beginner aids (suggested-discard rings, the local
   * ranked tables)? Some tables want a no-training-wheels game. Host rule wins
   * over the personal toggle. Independent of `coachAllowed`: the aids are
   * engine-computed and send no request, so a room can allow one without the
   * other in either direction.
   */
  beginnerAidsAllowed: boolean
}

/** Default 0 faan minimum — that's how the family plays (spec §4). */
export const DEFAULT_HOUSE_RULES: HouseRules = {
  faanMinimum: 0,
  flowers: true,
  faanCap: null,
  claimWindowSec: 4,
  turnTimerSec: 30,
  coachAllowed: true,
  beginnerAidsAllowed: true,
}

/** Clamp untrusted lobby input into the ranges the spec allows. */
export function sanitizeHouseRules(r: unknown): HouseRules {
  const raw = (typeof r === 'object' && r !== null ? r : {}) as Record<string, unknown>
  const d = DEFAULT_HOUSE_RULES
  const num = (v: unknown, fallback: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? v : fallback
  const faanMinimum = [0, 1, 3].includes(raw.faanMinimum as number)
    ? (raw.faanMinimum as 0 | 1 | 3)
    : d.faanMinimum
  return {
    faanMinimum,
    flowers: typeof raw.flowers === 'boolean' ? raw.flowers : d.flowers,
    faanCap:
      raw.faanCap === null || raw.faanCap === undefined
        ? null
        : Math.max(1, Math.min(64, num(raw.faanCap, 13))),
    claimWindowSec: Math.max(3, Math.min(8, num(raw.claimWindowSec, d.claimWindowSec))),
    turnTimerSec: Math.max(10, Math.min(120, num(raw.turnTimerSec, d.turnTimerSec))),
    coachAllowed: typeof raw.coachAllowed === 'boolean' ? raw.coachAllowed : d.coachAllowed,
    beginnerAidsAllowed:
      typeof raw.beginnerAidsAllowed === 'boolean' ? raw.beginnerAidsAllowed : d.beginnerAidsAllowed,
  }
}

export type SeatKind = 'open' | 'human' | 'bot'

/** What the table shows per seat (§7): a bot-piloted human reads as 'bot'. */
export type SeatStatus = 'open' | 'connected' | 'reconnecting' | 'bot'

export interface SeatInfo {
  kind: SeatKind
  /** Display name for humans; null otherwise. */
  name: string | null
  /** Bot difficulty (used when kind is 'bot', and as takeover default). */
  difficulty: Difficulty
  /** Live socket right now? Humans only; bots are always "connected". */
  connected: boolean
  /** Rolled-up presence for the UI (connection + pilot state). */
  status: SeatStatus
}

export interface RoomInfo {
  code: string
  phase: 'lobby' | 'playing'
  hostSeat: Seat
  /** The seat this particular message was addressed to. */
  you: Seat
  seats: Record<Seat, SeatInfo>
  rules: HouseRules
}

/** Client → room. */
export type ClientMsg =
  | { type: 'intent'; action: Action }
  | { type: 'newRound'; rules?: RuleConfig; seats?: Record<Seat, SeatController> }
  | { type: 'lobby'; op: 'seatKind'; seat: Seat; kind: 'open' | 'bot'; difficulty?: Difficulty }
  | { type: 'lobby'; op: 'rules'; rules: HouseRules }
  | { type: 'start' }

/** Room → seat(s). */
export type ServerMsg =
  | { type: 'view'; seq: number; view: PlayerView; match: MatchInfo }
  | { type: 'finished'; seq: number; result: RoundResult; log: Action[]; match: MatchInfo }
  | { type: 'rejected'; seq: number; reason: string }
  | { type: 'room'; room: RoomInfo }
  /** Join/reclaim handshake. The ONLY message that ever carries the token. */
  | { type: 'joined'; seat: Seat; token: string; room: RoomInfo }
