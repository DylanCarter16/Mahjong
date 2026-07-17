// RoomHost: one multiplayer room — lobby, seat assignment, house rules, and
// the RoomRunner lifecycle once the game starts. Transport-agnostic and
// clock-injected like the runner, so every behaviour here is testable under
// vitest with a FakeClock; the Durable Object stays a dumb shell that owns
// sockets, storage, and alarms and nothing else.
//
// Authorization model (spec §4): no accounts. The room code gets you in; a
// per-seat crypto token (issued by the shell, stored alongside the snapshot)
// is the only way to reclaim a seat. Host powers belong to hostSeat.

import type { Difficulty } from '../engine/bots'
import type { Seat } from '../engine/types'
import { SEATS } from '../engine/types'
import type { Clock } from './clock'
import {
  DEFAULT_HOUSE_RULES,
  sanitizeHouseRules,
  type ClientMsg,
  type HouseRules,
  type RoomInfo,
  type SeatController,
  type SeatInfo,
  type SeatKind,
} from './protocol'
import { RoomRunner, type RoomRunnerSnapshot, type RoomTiming } from './RoomRunner'
import type { Transport } from './transport'

export function multiplayerTiming(rules: HouseRules): RoomTiming {
  return {
    drawDelayMs: 300,
    botDelayMs: 650,
    claimWindowMs: rules.claimWindowSec * 1000,
    turnTimerMs: rules.turnTimerSec * 1000,
    instantAllBotClaims: true, // §5.2 rule 6: don't fake suspense for bots
  }
}

interface SeatState {
  kind: SeatKind
  name: string | null
  difficulty: Difficulty
  connected: boolean
}

/** Plain-data snapshot for the shell's write-through storage. */
export interface RoomHostSnapshot {
  code: string
  phase: 'lobby' | 'playing'
  hostSeat: Seat
  rules: HouseRules
  seats: Record<Seat, SeatState>
  runner: RoomRunnerSnapshot | null
}

export interface RoomHostOptions {
  code: string
  clock: Clock
  transport: Transport
  /** Secret wall seed supplier (§2.3) — crypto on the server, per round. */
  makeRoundSeed: () => string
  botSeed?: string
  logIssue?: (msg: string) => void
  /** Write-through hook: the shell persists a snapshot after every change. */
  onDirty?: () => void
  rules?: HouseRules
}

const DEFAULT_BOT_DIFFICULTY: Difficulty = 'intermediate'

export class RoomHost {
  private phase: 'lobby' | 'playing' = 'lobby'
  private hostSeat: Seat = 0
  private rules: HouseRules
  private seats: Record<Seat, SeatState>
  private runner: RoomRunner | null = null
  private readonly code: string
  private readonly logIssue: (msg: string) => void

  constructor(private readonly opts: RoomHostOptions) {
    this.code = opts.code
    this.rules = opts.rules ?? DEFAULT_HOUSE_RULES
    this.logIssue = opts.logIssue ?? ((m) => console.warn(`[room ${opts.code}] ${m}`))
    this.seats = {
      0: emptySeat(),
      1: emptySeat(),
      2: emptySeat(),
      3: emptySeat(),
    }
  }

  static restore(snapshot: RoomHostSnapshot, opts: RoomHostOptions): RoomHost {
    const h = new RoomHost({ ...opts, code: snapshot.code, rules: snapshot.rules })
    h.phase = snapshot.phase
    h.hostSeat = snapshot.hostSeat
    h.seats = structuredClone(snapshot.seats)
    // Sockets did not survive the eviction; the shell reports reconnects.
    for (const s of SEATS) if (h.seats[s].kind === 'human') h.seats[s].connected = false
    if (snapshot.runner) {
      h.runner = RoomRunner.restore(snapshot.runner, h.runnerOptions())
    }
    return h
  }

  serialize(): RoomHostSnapshot {
    return {
      code: this.code,
      phase: this.phase,
      hostSeat: this.hostSeat,
      rules: structuredClone(this.rules),
      seats: structuredClone(this.seats),
      runner: this.runner ? this.runner.serialize() : null,
    }
  }

  /** Re-arm timers after a restore (idempotent, mirrors RoomRunner.start). */
  resume(): void {
    this.runner?.start()
  }

  stop(): void {
    this.runner?.stop()
  }

  // ------------------------------------------------------------- joining ----

  /**
   * A new human wants in. Fills the lowest open seat; the first human in an
   * empty room becomes the host. Late joiners fill open seats until the game
   * starts (spec §4); after start, only token reclaims get you a seat.
   */
  joinHuman(rawName: string): { ok: true; seat: Seat } | { ok: false; reason: string } {
    const name = sanitizeName(rawName)
    if (this.phase === 'playing') return { ok: false, reason: 'game already started' }
    const seat = SEATS.find((s) => this.seats[s].kind === 'open')
    if (seat === undefined) return { ok: false, reason: 'room is full' }
    this.seats[seat] = { kind: 'human', name, difficulty: DEFAULT_BOT_DIFFICULTY, connected: true }
    if (SEATS.every((s) => s === seat || this.seats[s].kind !== 'human')) {
      this.hostSeat = seat
    }
    this.afterRoomChange()
    return { ok: true, seat }
  }

  /** Socket-level presence, reported by the shell. */
  setConnected(seat: Seat, connected: boolean): void {
    if (this.seats[seat].kind !== 'human') return
    if (this.seats[seat].connected === connected) return
    this.seats[seat].connected = connected
    this.afterRoomChange()
  }

  /** Reconnect: mark present and replay current game state to that seat. */
  onReconnect(seat: Seat): void {
    this.setConnected(seat, true)
    this.runner?.resend(seat)
  }

  /** True when no human seat has a live socket (shell uses this for GC). */
  allHumansDisconnected(): boolean {
    return SEATS.every((s) => this.seats[s].kind !== 'human' || !this.seats[s].connected)
  }

  humanSeats(): Seat[] {
    return SEATS.filter((s) => this.seats[s].kind === 'human')
  }

  getPhase(): 'lobby' | 'playing' {
    return this.phase
  }

  coachAllowed(): boolean {
    return this.rules.coachAllowed
  }

  // ------------------------------------------------------------ messages ----

  receive(seat: Seat, msg: ClientMsg): void {
    switch (msg.type) {
      case 'lobby':
        this.handleLobby(seat, msg)
        return
      case 'start':
        this.handleStart(seat)
        return
      case 'intent':
        if (this.phase !== 'playing' || !this.runner) {
          this.reject(seat, 'game has not started')
          return
        }
        this.runner.receive(seat, msg)
        return
      case 'newRound':
        if (this.phase !== 'playing' || !this.runner) {
          this.reject(seat, 'game has not started')
          return
        }
        if (seat !== this.hostSeat) {
          this.reject(seat, 'only the host starts the next round')
          return
        }
        // Multiplayer round flow keeps the lobby's rules and seat setup;
        // the solo-style overrides in the message are ignored on purpose.
        this.runner.receive(seat, { type: 'newRound' })
        return
    }
  }

  private handleLobby(seat: Seat, msg: Extract<ClientMsg, { type: 'lobby' }>): void {
    if (this.phase !== 'lobby') {
      this.reject(seat, 'game already started')
      return
    }
    if (seat !== this.hostSeat) {
      this.logIssue(`non-host seat ${seat} tried lobby op ${msg.op}`)
      this.reject(seat, 'host only')
      return
    }
    if (msg.op === 'rules') {
      this.rules = sanitizeHouseRules(msg.rules)
      this.afterRoomChange()
      return
    }
    // seatKind: the host may open a seat or assign a bot — never touch a
    // seat a human is sitting in.
    const target = this.seats[msg.seat]
    if (!target || msg.seat === this.hostSeat) {
      this.reject(seat, 'cannot change that seat')
      return
    }
    if (target.kind === 'human') {
      this.reject(seat, 'a player is sitting there')
      return
    }
    if (msg.kind === 'bot') {
      const difficulty = isDifficulty(msg.difficulty) ? msg.difficulty : DEFAULT_BOT_DIFFICULTY
      this.seats[msg.seat] = { kind: 'bot', name: null, difficulty, connected: true }
    } else {
      this.seats[msg.seat] = emptySeat()
    }
    this.afterRoomChange()
  }

  private handleStart(seat: Seat): void {
    if (this.phase !== 'lobby') {
      this.reject(seat, 'game already started')
      return
    }
    if (seat !== this.hostSeat) {
      this.reject(seat, 'host only')
      return
    }
    // Empty seats are filled by bots (spec §0).
    for (const s of SEATS) {
      if (this.seats[s].kind === 'open') {
        this.seats[s] = { kind: 'bot', name: null, difficulty: DEFAULT_BOT_DIFFICULTY, connected: true }
      }
    }
    this.phase = 'playing'
    this.runner = new RoomRunner(this.runnerOptions())
    this.afterRoomChange()
    this.runner.start()
  }

  private runnerOptions() {
    return {
      rules: {
        faanMinimum: this.rules.faanMinimum,
        flowers: this.rules.flowers,
        faanCap: this.rules.faanCap,
      },
      seats: this.seatControllers(),
      timing: multiplayerTiming(this.rules),
      clock: this.opts.clock,
      transport: this.opts.transport,
      makeRoundSeed: () => this.opts.makeRoundSeed(),
      ...(this.opts.botSeed ? { botSeed: this.opts.botSeed } : {}),
      logIssue: this.logIssue,
      onChange: () => this.opts.onDirty?.(),
      dealer: this.hostSeat,
    }
  }

  private seatControllers(): Record<Seat, SeatController> {
    const out = {} as Record<Seat, SeatController>
    for (const s of SEATS) {
      const seat = this.seats[s]
      out[s] =
        seat.kind === 'human'
          ? { kind: 'human' }
          : { kind: 'bot', difficulty: seat.difficulty }
    }
    return out
  }

  // ------------------------------------------------------------ outbound ----

  roomInfo(you: Seat): RoomInfo {
    const seats = {} as Record<Seat, SeatInfo>
    for (const s of SEATS) {
      const st = this.seats[s]
      seats[s] = { kind: st.kind, name: st.name, difficulty: st.difficulty, connected: st.connected }
    }
    return {
      code: this.code,
      phase: this.phase,
      hostSeat: this.hostSeat,
      you,
      seats,
      rules: structuredClone(this.rules),
    }
  }

  /** Room-level state changed: tell every seat (views are the runner's job). */
  private afterRoomChange(): void {
    for (const s of SEATS) {
      this.opts.transport.send(s, { type: 'room', room: this.roomInfo(s) })
    }
    this.opts.onDirty?.()
  }

  private reject(seat: Seat, reason: string): void {
    this.opts.transport.send(seat, { type: 'rejected', seq: -1, reason })
  }
}

function emptySeat(): SeatState {
  return { kind: 'open', name: null, difficulty: DEFAULT_BOT_DIFFICULTY, connected: false }
}

function sanitizeName(raw: string): string {
  const name = String(raw).replace(/[\r\n\t]/g, ' ').trim().slice(0, 24)
  return name.length > 0 ? name : 'Player'
}

function isDifficulty(d: unknown): d is Difficulty {
  return d === 'easy' || d === 'intermediate' || d === 'advanced'
}
