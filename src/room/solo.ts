// Offline solo factory: one human seat (0), three bots, LocalTransport,
// real clock. This is the Phase 1 game rehosted as "a room with one human"
// (spec §3) — no network anywhere on this code path, ever.

import type { Difficulty } from '../engine/bots'
import type { RuleConfig } from '../engine/game'
import type { Seat } from '../engine/types'
import { systemClock, type Clock } from './clock'
import { LocalTransport } from './LocalTransport'
import type { SeatController } from './protocol'
import { RoomRunner, SOLO_TIMING } from './RoomRunner'
import type { ClientConn } from './transport'

export const HUMAN_SEAT: Seat = 0

export interface SoloConfig {
  rules: RuleConfig
  difficulties: Record<Seat, Difficulty>
  /**
   * Fixes the deal and the bots, so a solo match can be replayed exactly.
   * Omitted in the app (every game should be a new one); supplied by tests that
   * would otherwise assert against a different round on every run.
   *
   * Safe to expose only because this is the SOLO path: the seed never leaves
   * the process, there is no opponent to gain from knowing it, and multiplayer
   * seeds come from crypto on the server and never come from a caller (§2.3).
   */
  seed?: string
}

export interface SoloRoom {
  conn: ClientConn
  runner: RoomRunner
}

export function soloSeats(difficulties: Record<Seat, Difficulty>): Record<Seat, SeatController> {
  return {
    0: { kind: 'human' },
    1: { kind: 'bot', difficulty: difficulties[1] },
    2: { kind: 'bot', difficulty: difficulties[2] },
    3: { kind: 'bot', difficulty: difficulties[3] },
  }
}

export function createSoloRoom(config: SoloConfig, clock: Clock = systemClock): SoloRoom {
  const transport = new LocalTransport()
  // Reproducibility is a solo affordance (pre-Phase-2 parity); multiplayer
  // seeds come from crypto on the server and never look like this (§2.3).
  const base = config.seed ?? `match-${Math.random().toString(36).slice(2)}`
  const runner = new RoomRunner({
    rules: config.rules,
    seats: soloSeats(config.difficulties),
    timing: SOLO_TIMING,
    clock,
    transport,
    makeRoundSeed: (roundNo) => `${base}-${roundNo}`,
    botSeed: `${base}-bots`,
  })
  transport.onMessage((seat, msg) => runner.receive(seat, msg))
  return { conn: transport.client(HUMAN_SEAT), runner }
}
