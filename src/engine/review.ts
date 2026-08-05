// Post-round review, engine half: find the decision points in a finished
// round's action log, grade each one, and attach the exact facts behind the
// grade. The model never recomputes any of this — it narrates the shortlist.
//
// This is the same split that made the discard coach trustworthy: the engine
// owns every number ("3rd Red Dragon out", "West Wind was dead against all
// three"), the model owns the sentence explaining why it mattered.
//
// WHAT THIS NEEDS THAT THE LOG DOESN'T CARRY
// A `draw` action records the seat, not the tile — concealed hands are hidden
// information by design and never reach the client. So grading a discard needs
// the player's OWN hand at that turn, which is captured from the view stream
// the client already receives (see HandSnapshot) and paired back to the log
// here. Public state — pools, melds, the tile in flight — comes from replay.ts,
// which reproduces it exactly.
//
// When a moment's hand cannot be recovered, the moment degrades to a
// public-facts-only entry rather than crashing or, worse, guessing. `degraded`
// reports every case that hit that path.

import { claimAnalysis, rankDiscards, readOpponents, type OpponentRead, type RankedDiscard } from './analysis'
import type { Action, ClaimKind, PlayerView, RoundResult } from './game'
import { derivedWallCount, replayTo, visibleOnTable, type ReplayBoard } from './replay'
import { suitOf, tileName } from './tiles'
import type { Seat, TileId, Wind } from './types'

// ------------------------------------------------------------------ inputs --

/**
 * The player's own hand at one of their decisions, captured from the view
 * stream as the round is played. `seq` is the view's sequence number — used
 * only to dedupe and order; it is deliberately NOT assumed to line up with log
 * indices, because views and actions are counted independently.
 */
export interface HandSnapshot {
  seq: number
  phase: 'discard' | 'claims'
  concealed: TileId[]
  /** The real live-wall count at that moment. */
  wallCount: number
}

export interface ReviewInput {
  /** The seat being reviewed — the human player. */
  seat: Seat
  log: readonly Action[]
  result: RoundResult
  roundWind: Wind
  seatWinds: Record<Seat, Wind>
  faanMinimum: number
  /** Own-hand snapshots in the order they were observed. Optional. */
  snapshots?: readonly HandSnapshot[]
}

// ----------------------------------------------------------------- outputs --

/** Clear labels, worst to best. The badge is engine truth, not model opinion. */
export type Verdict = 'mistake' | 'loose' | 'fine' | 'sharp'

export type MomentKind = 'dealIn' | 'discard' | 'missedClaim' | 'claim' | 'win'

export interface BetterLine {
  tile: TileId
  /** Plain-English reason, built from engine numbers only. */
  why: string
}

export interface Moment {
  /** Index in the log of the action this moment is about. */
  index: number
  /** Human-facing turn number: how many tiles had been discarded by then. */
  turn: number
  kind: MomentKind
  verdict: Verdict
  /** The tile the moment is about, when there is one. */
  tile: TileId | null
  /** One line the engine can stand behind, with no narration. */
  headline: string
  /** Exact facts for the model to explain. Every number here is computed. */
  facts: string[]
  better: BetterLine | null
  /** Higher = more instructive. Drives the shortlist; not shown. */
  weight: number
  /**
   * True when the board AND the player's hand at this turn are both
   * recoverable, so the UI can replay it. False means text-only.
   */
  replayable: boolean
}

export interface RoundScan {
  seat: Seat
  /** Every graded decision, in log order. */
  moments: Moment[]
  /** The 3–4 most instructive, in log order. What the model is handed. */
  shortlist: Moment[]
  /** Engine-counted totals for the one-line summary. */
  tally: {
    discards: number
    sharp: number
    loose: number
    mistakes: number
    dealtIn: boolean
    missedClaims: number
  }
  /** One line of engine truth about the whole round. */
  summary: string
  /** Cases that could not be fully reconstructed, and why. */
  degraded: string[]
}

// ------------------------------------------------------------------- naming --

const WIND_NAMES: Record<Wind, string> = { E: 'East', S: 'South', W: 'West', N: 'North' }

const seatName = (input: ReviewInput, seat: Seat): string =>
  seat === input.seat ? 'you' : WIND_NAMES[input.seatWinds[seat]]

const capitalise = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)

/** How many tiles had been discarded up to and including `index`. */
function turnAt(log: readonly Action[], index: number): number {
  let n = 0
  for (let i = 0; i <= index && i < log.length; i++) if (log[i].type === 'discard') n++
  return n
}

/**
 * The claim window opened by the action at `index`: every claim/pass logged
 * before the next real action. Empty when the action opened no window.
 */
function windowAfter(log: readonly Action[], index: number): Action[] {
  const out: Action[] = []
  for (let i = index + 1; i < log.length; i++) {
    const a = log[i]
    if (a.type !== 'claim' && a.type !== 'pass') break
    out.push(a)
  }
  return out
}

// -------------------------------------------------------- view synthesis --

/**
 * Build the PlayerView the analysis functions expect from the replayed public
 * board plus the player's captured hand. Everything here is either exact
 * (pools, melds, tile in flight) or captured (concealed, wall count); nothing
 * is invented.
 *
 * `legal` is empty and `bonus` is empty: rankDiscards, claimAnalysis and
 * readOpponents read neither, and flowers are not recoverable from a log.
 */
function viewFrom(input: ReviewInput, board: ReplayBoard, snap: HandSnapshot | null): PlayerView {
  const bonus = { 0: [], 1: [], 2: [], 3: [] } as Record<Seat, TileId[]>
  return {
    seat: input.seat,
    seatWind: input.seatWinds[input.seat],
    roundWind: input.roundWind,
    seatWinds: { ...input.seatWinds },
    concealed: snap ? [...snap.concealed] : [],
    handCounts: { ...board.handCounts },
    melds: board.melds,
    bonus,
    discards: board.discards,
    wallCount: snap?.wallCount ?? derivedWallCount(board),
    faanMinimum: input.faanMinimum,
    turn: board.toAct,
    phase: board.pending ? 'claims' : 'discard',
    pendingDiscard: board.pending ? { ...board.pending } : null,
    lastClaimed: null,
    legal: [],
  }
}

// ------------------------------------------------------- snapshot pairing --

/**
 * Pair captured hands back onto the player's own decisions.
 *
 * Ordinal pairing alone is fragile — a duplicated render or a dropped view
 * shifts every later moment onto the wrong hand, and a wrong hand grades
 * confidently and wrongly. So each candidate is VALIDATED against the replayed
 * board (right phase, right tile count, and for a discard it must actually
 * contain the discarded tile) and a small lookahead recovers from drift. A
 * decision that finds no valid hand simply gets none.
 */
class SnapshotCursor {
  private i = 0
  private readonly snaps: HandSnapshot[]

  constructor(snapshots: readonly HandSnapshot[] | undefined) {
    // Dedupe by seq: React can deliver the same view more than once.
    const bySeq = new Map<number, HandSnapshot>()
    for (const s of snapshots ?? []) if (!bySeq.has(s.seq)) bySeq.set(s.seq, s)
    this.snaps = [...bySeq.values()].sort((a, b) => a.seq - b.seq)
  }

  /** Take the next hand that fits this decision, or null. */
  take(phase: 'discard' | 'claims', board: ReplayBoard, seat: Seat, mustHold: TileId | null): HandSnapshot | null {
    const fits = (s: HandSnapshot): boolean =>
      s.phase === phase &&
      s.concealed.length === board.handCounts[seat] &&
      (mustHold === null || s.concealed.includes(mustHold))
    // Try in order, with a short lookahead so one bad pairing doesn't poison
    // the rest of the round.
    for (let j = this.i; j < Math.min(this.i + 5, this.snaps.length); j++) {
      if (fits(this.snaps[j])) {
        this.i = j + 1
        return this.snaps[j]
      }
    }
    return null
  }
}

// -------------------------------------------------------------- grading --

/**
 * How dangerous a candidate discard is, weighted by how loudly each opponent is
 * pushing.
 *
 * Grading danger only against seats with two sets down would call every discard
 * safe on a quiet table, which is wrong — a concealed hand is still a hand. So
 * every opponent counts, at half weight when they have shown nothing (threat 0)
 * and up to double when they have sets down, a short pool and a thin wall
 * (threat 3). dangerScore runs 0–6, so this runs 0 to about 12.
 */
function riskOf(r: RankedDiscard, reads: OpponentRead[]): number {
  let worst = 0
  for (const o of reads) {
    worst = Math.max(worst, ((r.dangerByOpponent[o.seat] ?? 0) * (1 + o.threat)) / 2)
  }
  return worst
}

/**
 * One true sentence about an opponent and a tile, built only from what was on
 * the table. Every clause is checkable against their discard pool — and
 * review.test.ts checks it — so the review never asserts more than it can show.
 */
function oppNote(input: ReviewInput, view: PlayerView, tile: TileId, o: OpponentRead): string {
  const name = capitalise(seatName(input, o.seat))
  const pool = view.discards[o.seat]
  if (pool.includes(tile)) {
    return `${name} had already discarded the ${tileName(tile)}, so it was dead against them.`
  }
  const sets = o.exposedMelds
  const setsBit = sets ? `${sets} set${sets === 1 ? '' : 's'} exposed` : 'nothing exposed'
  const suit = suitOf(tile)
  if (suit) {
    const same = pool.filter((t) => suitOf(t) === suit).length
    return same === 0
      ? `${name} had ${setsBit} and had not discarded a single ${suitWord(suit)}.`
      : `${name} had ${setsBit} and ${same} ${suitWord(suit)} in their pool.`
  }
  return `${name} had ${setsBit} and had never discarded the ${tileName(tile)}.`
}

/**
 * Grade one of the player's discards.
 *
 * Two costs, both measured against what was actually available at that turn:
 *   speedCost — shanten given up versus the fastest legal discard;
 *   given     — safety left on the table: how much less dangerous the safest
 *               EQUALLY FAST discard would have been. Zero means nothing was
 *               available that was both as fast and safer, so there was nothing
 *               to criticise.
 *
 * The thresholds are judgement calls and are stated rather than buried. They
 * were set against a measured corpus of beginner-level rounds, where roughly
 * 8% of discards give up a shanten and 17% leave 2+ points of safety unused:
 *   - dealing in is always a mistake, whatever the hand looked like;
 *   - 2+ shanten given up, or 4+ points of safety left unused, is a mistake;
 *   - 1 shanten given up, or 2+ points of safety left unused, is loose;
 *   - the safest available tile at full speed, while somebody was visibly
 *     pushing, is sharp;
 *   - everything else is fine. Most discards are fine, and being willing to say
 *     so is the point of having four labels rather than a running critique.
 */
function gradeDiscard(
  input: ReviewInput,
  index: number,
  tile: TileId,
  board: ReplayBoard,
  snap: HandSnapshot,
): Moment {
  const view = viewFrom(input, board, snap)
  const ranked = rankDiscards(view)
  const reads = readOpponents(view)
  const loud = reads.filter((r) => r.threat >= 2)
  const mine = ranked.find((r) => r.tile === tile)
  const best = ranked[0]
  const turn = turnAt(input.log, index)

  // The tile is in flight one action later; that board is where its visible
  // count includes it — "the 3rd one out" means counting this one.
  const afterCount = visibleOnTable(replayTo(input.log, index + 1), tile)
  const dealtIn = windowAfter(input.log, index).some((a) => a.type === 'claim' && a.claim === 'win')

  const facts: string[] = []
  facts.push(`You discarded the ${tileName(tile)} on turn ${turn} — ${afterCount} of 4 now visible.`)
  // Note the seats worth noting: anyone pushing, or anyone this tile was live
  // against. A quiet table gets no opponent lines rather than filler.
  const noteworthy = reads.filter(
    (o) => o.threat >= 2 || o.exposedMelds >= 1 || (mine?.dangerByOpponent[o.seat] ?? 0) >= 4,
  )
  for (const o of noteworthy) facts.push(oppNote(input, view, tile, o))
  // view.wallCount is the captured real count when a snapshot covers the turn,
  // and the derived one otherwise — never an estimate presented as exact.
  facts.push(`${view.wallCount} tiles left in the wall at that point.`)

  if (!mine || !best) {
    // Shouldn't happen — the discarded tile was in the captured hand — but a
    // review must never crash on a shape it didn't expect.
    return {
      index,
      turn,
      kind: dealtIn ? 'dealIn' : 'discard',
      verdict: dealtIn ? 'mistake' : 'fine',
      tile,
      headline: `You discarded the ${tileName(tile)}.`,
      facts,
      better: null,
      weight: dealtIn ? 100 : 0,
      replayable: true,
    }
  }

  const risk = riskOf(mine, reads)
  const speedCost = mine.shantenAfter - best.shantenAfter
  // The safest discard that would have cost nothing in speed.
  const equalSpeed = ranked.filter((r) => r.shantenAfter === mine.shantenAfter)
  const safest = equalSpeed.reduce((b, r) => (riskOf(r, reads) < riskOf(b, reads) ? r : b), mine)
  const given = risk - riskOf(safest, reads)

  let verdict: Verdict = 'fine'
  let weight = 0
  if (dealtIn) {
    verdict = 'mistake'
    weight = 100 + risk
  } else if (speedCost >= 2 || given >= 4) {
    verdict = 'mistake'
    weight = 55 + given * 4 + speedCost * 12
  } else if (speedCost === 1 || given >= 2) {
    verdict = 'loose'
    weight = 28 + given * 3 + speedCost * 6
  } else if (loud.length > 0 && speedCost === 0 && given === 0 && risk <= 2) {
    // Sharp is praise, so it has to mean something: somebody was visibly
    // pushing, and you picked the safest tile available without slowing down.
    verdict = 'sharp'
    weight = 22 + loud.length * 4
  }

  facts.push(
    `That discard left you ${shantenWord(mine.shantenAfter)} with ${mine.ukeire} useful tiles unseen.`,
  )

  // The better line, concretely — and only when the engine can defend it
  // WITHOUT QUALIFICATION. A tile that is safer on the weighted average but
  // more dangerous against one particular seat is not advice worth giving a
  // beginner, so a safety suggestion must be at least as safe against every
  // opponent and strictly safer against at least one.
  const danger = (r: RankedDiscard, o: OpponentRead): number => r.dangerByOpponent[o.seat] ?? 0
  const paretoSafer = (r: RankedDiscard): boolean =>
    reads.every((o) => danger(r, o) <= danger(mine, o)) &&
    reads.some((o) => danger(r, o) < danger(mine, o))

  let better: BetterLine | null = null
  if (verdict === 'mistake' || verdict === 'loose') {
    const saferAlts = equalSpeed.filter((r) => r.tile !== tile && paretoSafer(r))
    const saferAlt = saferAlts.reduce<RankedDiscard | null>(
      (b, r) => (b === null || riskOf(r, reads) < riskOf(b, reads) ? r : b),
      null,
    )
    const alt = saferAlt ?? (speedCost > 0 && best.tile !== tile ? best : null)
    if (alt) {
      const why =
        riskOf(alt, reads) === 0
          ? `${tileName(alt.tile)} was dead — every opponent had already discarded it — and it left you ${shantenWord(alt.shantenAfter)} with ${alt.ukeire} useful tiles.`
          : alt.shantenAfter < mine.shantenAfter
            ? `${tileName(alt.tile)} would have left you ${shantenWord(alt.shantenAfter)} instead of ${shantenWord(mine.shantenAfter)}, with ${alt.ukeire} useful tiles against ${mine.ukeire}.`
            : `${tileName(alt.tile)} was safer against every opponent at the same speed, and left you ${alt.ukeire} useful tiles against ${mine.ukeire}.`
      better = { tile: alt.tile, why }
    }
  }

  const headline = dealtIn
    ? `You dealt in with the ${tileName(tile)}.`
    : verdict === 'mistake'
      ? speedCost >= 2
        ? `The ${tileName(tile)} cost you real speed.`
        : `The ${tileName(tile)} was the risky one here.`
      : verdict === 'loose'
        ? `The ${tileName(tile)} was looser than it needed to be.`
        : verdict === 'sharp'
          ? `You kept full speed and gave nothing away with the ${tileName(tile)}.`
          : `You discarded the ${tileName(tile)}.`

  return {
    index,
    turn,
    kind: dealtIn ? 'dealIn' : 'discard',
    verdict,
    tile,
    headline,
    facts,
    better,
    weight,
    replayable: true,
  }
}

/** Grade a pass: did the player walk past a claim that would have helped? */
function gradePass(input: ReviewInput, index: number, board: ReplayBoard, snap: HandSnapshot): Moment | null {
  const view = viewFrom(input, board, snap)
  const options = claimAnalysis(view)
  const tile = board.pending?.tile ?? null
  if (!tile || options.length === 0) return null

  const turn = turnAt(input.log, index)
  const win = options.find((o) => o.claim === 'win')
  const helpful = options.find((o) => o.recommended)
  if (!win && !helpful) return null

  const taken = win ?? helpful!
  const facts = [
    `${capitalise(seatName(input, board.pending!.from))} discarded the ${tileName(tile)} on turn ${turn}.`,
    win
      ? `That tile completed your hand — it was a winning tile and you passed on it.`
      : `Taking the ${claimWord(taken.claim)} would have moved you from ${shantenWord(taken.shantenBefore)} to ${shantenWord(taken.shantenAfter)}.`,
  ]

  return {
    index,
    turn,
    kind: 'missedClaim',
    verdict: 'mistake',
    tile,
    headline: win
      ? `You passed on the winning tile — the ${tileName(tile)}.`
      : `You passed on a ${claimWord(taken.claim)} that would have sped you up.`,
    facts,
    better: null,
    weight: win ? 95 : 40 + (taken.shantenBefore - taken.shantenAfter) * 10,
    replayable: true,
  }
}

const claimWord = (c: ClaimKind): string =>
  c === 'win' ? 'win' : c === 'pung' ? 'pung' : c === 'kong' ? 'kong' : 'chow'

const suitWord = (s: string): string =>
  s === 'm' ? 'Characters' : s === 'p' ? 'Circles' : s === 's' ? 'Bamboo' : s

const shantenWord = (n: number): string =>
  n <= -1 ? 'complete' : n === 0 ? 'ready' : n === 1 ? 'one away' : `${n} away`

// ----------------------------------------------------------------- the scan --

/**
 * Walk the log, grade every decision the reviewed seat made, and pick the
 * shortlist the model narrates. Pure — no I/O, no engine mutation.
 */
export function scanRound(input: ReviewInput): RoundScan {
  const { log, seat } = input
  const cursor = new SnapshotCursor(input.snapshots)
  const moments: Moment[] = []
  const degraded: string[] = []

  for (let i = 0; i < log.length; i++) {
    const a = log[i]
    if (a.seat !== seat) continue
    const board = replayTo(log, i)
    const turn = turnAt(log, i)

    if (a.type === 'discard') {
      const snap = cursor.take('discard', board, seat, a.tile)
      if (!snap) {
        degraded.push(`turn ${turn}: no hand captured for your discard, graded on public facts only`)
        const dealtIn = windowAfter(log, i).some((x) => x.type === 'claim' && x.claim === 'win')
        moments.push({
          index: i,
          turn,
          kind: dealtIn ? 'dealIn' : 'discard',
          verdict: dealtIn ? 'mistake' : 'fine',
          tile: a.tile,
          headline: dealtIn
            ? `You dealt in with the ${tileName(a.tile)}.`
            : `You discarded the ${tileName(a.tile)}.`,
          facts: [
            `You discarded the ${tileName(a.tile)} on turn ${turn} — ${visibleOnTable(replayTo(log, i + 1), a.tile)} of 4 visible.`,
          ],
          better: null,
          weight: dealtIn ? 100 : 0,
          // The public board still replays; only the hand row is missing.
          replayable: false,
        })
        continue
      }
      moments.push(gradeDiscard(input, i, a.tile, board, snap))
      continue
    }

    if (a.type === 'pass') {
      const snap = cursor.take('claims', board, seat, null)
      if (!snap) continue // a pass with no recoverable hand teaches nothing
      const m = gradePass(input, i, board, snap)
      if (m) moments.push(m)
      continue
    }

    if (a.type === 'claim') {
      cursor.take('claims', board, seat, null) // keep the cursor aligned
      if (a.claim === 'win') {
        moments.push({
          index: i,
          turn,
          kind: 'win',
          verdict: 'sharp',
          tile: board.pending?.tile ?? null,
          headline: `You won on ${capitalise(seatName(input, board.pending?.from ?? seat))}'s ${board.pending ? tileName(board.pending.tile) : 'discard'}.`,
          facts: [`You took the win on turn ${turn}.`],
          better: null,
          weight: 50,
          replayable: true,
        })
      }
      continue
    }

    if (a.type === 'declareWin') {
      moments.push({
        index: i,
        turn,
        kind: 'win',
        verdict: 'sharp',
        tile: null,
        headline: 'You won on your own draw.',
        facts: [`Self-drawn on turn ${turn}.`],
        better: null,
        weight: 50,
        replayable: true,
      })
      continue
    }
  }

  const tally = {
    discards: log.filter((a) => a.type === 'discard' && a.seat === seat).length,
    sharp: moments.filter((m) => m.verdict === 'sharp').length,
    loose: moments.filter((m) => m.verdict === 'loose').length,
    mistakes: moments.filter((m) => m.verdict === 'mistake').length,
    dealtIn: input.result.kind === 'win' && input.result.loser === seat,
    missedClaims: moments.filter((m) => m.kind === 'missedClaim').length,
  }

  if (!input.snapshots?.length) {
    degraded.push('no hands were captured for this round — every moment is public facts only')
  }

  return {
    seat,
    moments,
    shortlist: pickShortlist(moments),
    tally,
    summary: summarise(input, tally),
    degraded,
  }
}

/**
 * The 3–4 most instructive moments, in log order.
 *
 * Two rules beyond "highest weight wins": adjacent turns are skipped, because
 * two moments one turn apart replay to almost the same board and read as
 * repetition; and if the round contained a genuinely sharp play it earns the
 * last slot, so a review is never an unbroken pile-on. Nothing is manufactured
 * — if there was no sharp moment, there is no sharp card.
 */
export function pickShortlist(moments: Moment[], limit = 4): Moment[] {
  const byWeight = [...moments].filter((m) => m.weight > 0).sort((a, b) => b.weight - a.weight)
  const chosen: Moment[] = []
  const farEnough = (m: Moment): boolean => chosen.every((c) => Math.abs(c.turn - m.turn) >= 2)

  for (const m of byWeight) {
    if (chosen.length >= limit - 1) break
    if (farEnough(m)) chosen.push(m)
  }
  if (chosen.length < limit) {
    const sharp = byWeight.find((m) => m.verdict === 'sharp' && !chosen.includes(m) && farEnough(m))
    if (sharp) chosen.push(sharp)
  }
  for (const m of byWeight) {
    if (chosen.length >= limit) break
    if (!chosen.includes(m) && farEnough(m)) chosen.push(m)
  }
  return chosen.sort((a, b) => a.index - b.index)
}

function summarise(input: ReviewInput, tally: RoundScan['tally']): string {
  const { result, seat } = input
  const bits: string[] = []
  if (result.kind === 'draw') bits.push('Wall exhausted, nobody won')
  else if (result.winner === seat) {
    bits.push(result.selfDraw ? 'You self-drew' : 'You won off a discard')
    if (result.fan) bits.push(`for ${result.fan.totalFaan} faan`)
  } else if (result.loser === seat) {
    bits.push(`You dealt into ${WIND_NAMES[input.seatWinds[result.winner!]]}'s hand`)
  } else {
    bits.push(`${WIND_NAMES[input.seatWinds[result.winner!]]} won`)
  }

  const counts: string[] = []
  if (tally.sharp) counts.push(`${tally.sharp} sharp discard${tally.sharp === 1 ? '' : 's'}`)
  if (tally.loose) counts.push(`${tally.loose} loose one${tally.loose === 1 ? '' : 's'}`)
  if (tally.mistakes) counts.push(`${tally.mistakes} mistake${tally.mistakes === 1 ? '' : 's'}`)
  if (tally.missedClaims) counts.push(`${tally.missedClaims} missed claim${tally.missedClaims === 1 ? '' : 's'}`)

  const head = `${bits.join(' ')}.`
  return counts.length ? `${head} ${counts.join(', ')} across ${tally.discards} discards.` : head
}
