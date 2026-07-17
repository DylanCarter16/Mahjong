// RoomRunner: orchestrates one room — seats, the turn cycle, pacing, claim
// windows, bot invocation — on top of the pure engine reducer. It is
// transport-agnostic and clock-injected: the same runner drives offline solo
// play (LocalTransport + real clock) and the multiplayer server (WebSockets +
// Durable Object). Nothing in here may know which one it is on (spec §3).
//
// Authority (spec §2.1): every client message lands in handleMessage and is
// validated by the engine's own legalActions inside applyAction before it
// touches state. The client UI showing only legal buttons is a convenience;
// THIS is the boundary. Assume every client is hostile and modified.
//
// Claim windows (spec §5): the engine already collects claims and resolves
// by rule priority only once every eligible seat has responded — arrival
// order cannot win a contest by design. The runner's job is time: pace bot
// responses, and (in multiplayer) pass for humans who let the window lapse.

import { botAction } from '../engine/bots'
import {
  applyAction,
  createGame,
  legalActions,
  playerView,
  type Action,
  type GameState,
  type RoundResult,
  type RuleConfig,
} from '../engine/game'
import { makeRng } from '../engine/rng'
import { nextSeat, SEATS, type Seat, type Wind } from '../engine/types'
import type { Clock, TimerHandle } from './clock'
import type { ClientMsg, MatchInfo, SeatController } from './protocol'
import type { Transport } from './transport'

export interface RoomTiming {
  /** Pacing before a forced draw is applied. */
  drawDelayMs: number
  /** Pacing before a bot acts (its turn, or its claim response). */
  botDelayMs: number
  /**
   * Claim window for human seats (§5.2). null = wait indefinitely, which is
   * offline solo behaviour: the bus has no clock pressure.
   */
  claimWindowMs: number | null
  /** Turn timer (§6). null = none. Wired in Phase 6. */
  turnTimerMs: number | null
  /** When only bots can claim, respond with zero delay (§5.2 rule 6). */
  instantAllBotClaims: boolean
}

/** Matches the pre-Phase-2 solo feel: 300ms draws, 650ms bot think time. */
export const SOLO_TIMING: RoomTiming = {
  drawDelayMs: 300,
  botDelayMs: 650,
  claimWindowMs: null,
  turnTimerMs: null,
  instantAllBotClaims: false,
}

const WIND_ORDER: Wind[] = ['E', 'S', 'W', 'N']

/**
 * Dealer repeats on a dealer win or a drawn round, otherwise the deal
 * rotates; the round wind advances when the deal passes back to seat 0.
 * (Moved verbatim from the Phase 1 useGame hook.)
 */
export function nextRoundSetup(
  result: RoundResult | null,
  match: MatchInfo,
): Pick<MatchInfo, 'dealer' | 'roundWind' | 'roundNo'> {
  const dealerRepeats =
    result?.kind === 'draw' || (result?.kind === 'win' && result.winner === match.dealer)
  const dealer = dealerRepeats ? match.dealer : nextSeat(match.dealer)
  const roundWind =
    !dealerRepeats && dealer === 0
      ? WIND_ORDER[(WIND_ORDER.indexOf(match.roundWind) + 1) % 4]
      : match.roundWind
  return { dealer, roundWind, roundNo: match.roundNo + 1 }
}

export interface RoomRunnerOptions {
  rules: RuleConfig
  seats: Record<Seat, SeatController>
  timing: RoomTiming
  clock: Clock
  transport: Transport
  /**
   * Secret per-round wall seed supplier (§2.3). The seed is consumed by
   * createGame and never retained, stored, logged, or transmitted. Solo may
   * use a reproducible scheme; the server must use crypto randomness.
   */
  makeRoundSeed: (roundNo: number) => string
  /** Seed for bot decision randomness — separate from the wall seed. */
  botSeed?: string
  /**
   * Diagnostics for rejected client messages (§5.2): either a client bug or
   * someone poking at the protocol, and the owner wants to know which.
   */
  logIssue?: (msg: string) => void
  dealer?: Seat
  roundWind?: Wind
  /** Test affordance: start from a crafted state instead of a seeded deal. */
  initialGame?: GameState
}

export class RoomRunner {
  private game: GameState | null = null
  private match: MatchInfo
  private rules: RuleConfig
  private seats: Record<Seat, SeatController>
  /** State version: increments once per applied action / round start. */
  private seq = 0
  private paceTimer: TimerHandle | null = null
  private windowTimer: TimerHandle | null = null
  private stopped = false
  private readonly botSeed: string
  private readonly logIssue: (msg: string) => void

  constructor(private readonly opts: RoomRunnerOptions) {
    this.rules = opts.rules
    this.seats = { ...opts.seats }
    this.botSeed = opts.botSeed ?? `bots-${Math.random().toString(36).slice(2)}`
    this.logIssue = opts.logIssue ?? ((m) => console.warn(`[room] ${m}`))
    this.match = {
      dealer: opts.dealer ?? 0,
      roundWind: opts.roundWind ?? 'E',
      roundNo: 1,
      scores: { 0: 0, 1: 0, 2: 0, 3: 0 },
    }
    opts.transport.onMessage((seat, msg) => this.handleMessage(seat, msg))
  }

  /** Idempotent: first call deals; later calls just re-arm pacing. */
  start(): void {
    this.stopped = false
    if (!this.game) {
      this.game =
        this.opts.initialGame ??
        createGame(this.rules, this.opts.makeRoundSeed(1), this.match.dealer, this.match.roundWind)
      this.afterChange()
    } else {
      this.pump()
    }
  }

  /** Cancels all timers. start() resumes from the current state. */
  stop(): void {
    this.stopped = true
    this.clearTimers()
  }

  // ------------------------------------------------------------ inbound ----

  private handleMessage(seat: Seat, msg: ClientMsg): void {
    if (msg.type === 'newRound') {
      this.handleNewRound(seat, msg.rules, msg.seats)
      return
    }
    this.handleIntent(seat, msg.action)
  }

  private handleIntent(seat: Seat, action: Action): void {
    const g = this.game
    if (!g) return
    if (action.seat !== seat) {
      this.logIssue(`seat ${seat} sent an intent for seat ${action.seat}`)
      this.reject(seat, 'intent names another seat')
      return
    }
    if (this.seats[seat].kind !== 'human') {
      this.logIssue(`intent for non-human seat ${seat}`)
      this.reject(seat, 'seat is not human-controlled')
      return
    }
    try {
      this.game = applyAction(g, action)
    } catch (e) {
      // §5.2: an illegal claim is rejected, treated as a pass (so a buggy or
      // hostile client cannot hold the window open), and logged.
      this.logIssue(`illegal intent from seat ${seat}: ${JSON.stringify(action)} — ${String(e)}`)
      this.reject(seat, e instanceof Error ? e.message : 'illegal action')
      if (
        g.phase === 'claims' &&
        action.type === 'claim' &&
        legalActions(g, seat).some((a) => a.type === 'pass')
      ) {
        this.game = applyAction(g, { type: 'pass', seat })
        this.afterChange()
      }
      return
    }
    this.afterChange()
  }

  private handleNewRound(
    seat: Seat,
    rules?: RuleConfig,
    seats?: Record<Seat, SeatController>,
  ): void {
    const g = this.game
    if (!g || g.phase !== 'finished') {
      this.reject(seat, 'round is still in progress')
      return
    }
    if (this.seats[seat].kind !== 'human') {
      this.reject(seat, 'seat is not human-controlled')
      return
    }
    const setup = nextRoundSetup(g.result, this.match)
    this.match = { ...this.match, ...setup }
    if (rules) this.rules = rules
    if (seats) this.seats = { ...seats }
    this.game = createGame(
      this.rules,
      this.opts.makeRoundSeed(setup.roundNo),
      setup.dealer,
      setup.roundWind,
    )
    this.afterChange()
  }

  // ----------------------------------------------------------- outbound ----

  private matchSnapshot(): MatchInfo {
    return { ...this.match, scores: { ...this.match.scores } }
  }

  private reject(seat: Seat, reason: string): void {
    this.opts.transport.send(seat, { type: 'rejected', seq: this.seq, reason })
  }

  /** After every applied action: bank scores, publish views, re-arm pacing. */
  private afterChange(): void {
    const g = this.game!
    this.seq++
    if (g.phase === 'finished') {
      const r = g.result
      if (r?.kind === 'win' && r.winner !== undefined && r.fan) {
        this.match.scores[r.winner] += r.fan.totalFaan
      }
    }
    for (const seat of SEATS) {
      this.opts.transport.send(seat, {
        type: 'view',
        seq: this.seq,
        view: playerView(g, seat),
        match: this.matchSnapshot(),
      })
    }
    if (g.phase === 'finished') {
      // Post-round disclosure: the full action log goes out only once the
      // round is over, for the review coach and future replays (§ protocol).
      this.opts.transport.broadcast({
        type: 'finished',
        seq: this.seq,
        result: g.result!,
        log: [...g.log],
        match: this.matchSnapshot(),
      })
    }
    this.pump()
  }

  // ------------------------------------------------------------- pacing ----

  private clearTimers(): void {
    if (this.paceTimer) {
      this.opts.clock.clearTimeout(this.paceTimer)
      this.paceTimer = null
    }
    if (this.windowTimer) {
      this.opts.clock.clearTimeout(this.windowTimer)
      this.windowTimer = null
    }
  }

  private schedulePace(ms: number, fn: () => void): void {
    this.paceTimer = this.opts.clock.setTimeout(() => {
      this.paceTimer = null
      fn()
    }, ms)
  }

  /**
   * Looks at the current phase and arms exactly the timers it needs. Runs
   * after every state change; idempotent because clearTimers() comes first.
   */
  private pump(): void {
    this.clearTimers()
    if (this.stopped) return
    const g = this.game
    if (!g || g.phase === 'finished') return

    if (g.phase === 'draw') {
      // Draws are forced for every seat, human or bot (pre-Phase-2 parity).
      this.schedulePace(this.opts.timing.drawDelayMs, () => {
        this.applyAuto({ type: 'draw', seat: this.game!.turn })
      })
      return
    }

    if (g.phase === 'discard') {
      const ctl = this.seats[g.turn]
      if (ctl.kind === 'bot') {
        this.schedulePace(this.opts.timing.botDelayMs, () => this.applyBotTurn())
      }
      // Humans discard via intents; the turn timer arrives in Phase 6.
      return
    }

    // Claims phase. The engine resolves the window on the last response, so
    // the runner only has to make sure every eligible seat eventually
    // responds: bots after pacing (one per tick, matching the old solo
    // cadence), humans via intents or the window deadline.
    const eligibleBots = SEATS.filter(
      (s) => this.seats[s].kind === 'bot' && legalActions(g, s).length > 0,
    )
    const eligibleHumans = SEATS.filter(
      (s) => this.seats[s].kind === 'human' && legalActions(g, s).length > 0,
    )
    if (eligibleBots.length > 0) {
      const instant = eligibleHumans.length === 0 && this.opts.timing.instantAllBotClaims
      this.schedulePace(instant ? 0 : this.opts.timing.botDelayMs, () => this.applyNextBotClaim())
    }
    if (eligibleHumans.length > 0 && this.opts.timing.claimWindowMs !== null) {
      this.windowTimer = this.opts.clock.setTimeout(() => {
        this.windowTimer = null
        this.expireClaimWindow()
      }, this.opts.timing.claimWindowMs)
    }
  }

  private applyBotTurn(): void {
    const g = this.game
    if (!g || g.phase !== 'discard') return
    const ctl = this.seats[g.turn]
    if (ctl.kind !== 'bot') return
    const view = playerView(g, g.turn)
    this.applyAuto(botAction(view, ctl.difficulty, this.botRng()))
  }

  /** One bot claim response per pacing tick; pump() reschedules the rest. */
  private applyNextBotClaim(): void {
    const g = this.game
    if (!g || g.phase !== 'claims') return
    const seat = SEATS.find(
      (s) => this.seats[s].kind === 'bot' && legalActions(g, s).length > 0,
    )
    if (seat === undefined) return
    const ctl = this.seats[seat]
    if (ctl.kind !== 'bot') return
    const view = playerView(g, seat)
    this.applyAuto(botAction(view, ctl.difficulty, this.botRng()))
  }

  /** Window lapsed (§5.2 rule 7): every silent eligible seat passes. */
  private expireClaimWindow(): void {
    let g = this.game
    if (!g || g.phase !== 'claims') return
    for (const seat of SEATS) {
      g = this.game
      if (!g || g.phase !== 'claims') break
      if (legalActions(g, seat).some((a) => a.type === 'pass')) {
        this.game = applyAction(g, { type: 'pass', seat })
        this.afterChange()
      }
    }
  }

  /** Server-originated actions (draws, bots, timeouts) — must never throw. */
  private applyAuto(action: Action): void {
    const g = this.game
    if (!g) return
    try {
      this.game = applyAction(g, action)
    } catch (e) {
      // An engine rejection here is a runner bug, not a client's. Log loudly
      // and keep the room alive; the state is unchanged.
      this.logIssue(`internal action rejected: ${JSON.stringify(action)} — ${String(e)}`)
      return
    }
    this.afterChange()
  }

  private botRng() {
    // Deterministic per decision and reconstructible after a restore: no
    // closure state to persist. Derived from a seed that is not the wall's.
    return makeRng(`${this.botSeed}:${this.match.roundNo}:${this.game?.log.length ?? 0}`)
  }
}
