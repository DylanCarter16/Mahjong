// GameState + reducer. Pure, serialisable (plain data only — optional keys
// are omitted rather than set to undefined), no timers, no React. The claim
// window is modelled as a real phase so the Phase 2 server can reuse it as a
// timed window without reshaping the state machine.
//
// Documented simplifications (see README):
//   - Deal order is 13 sequential tiles per seat from the dealer, then a 14th
//     to the dealer. With a shuffled wall this is equivalent to the ritual
//     4-4-4-1 deal.
//   - The dead wall is positional: the last 14 tiles of the remaining wall.
//     Replacement draws (kongs, bonus tiles) come off the back.
//   - Robbing the kong (搶槓, Phase 2 §5.3): an ADDED kong opens a win-only
//     claim window before it completes; if a seat wins off the added tile,
//     the kong never forms and the konger is the discarder for scoring.
//     Concealed kongs are not robbable (HK family rules; the thirteen-
//     orphans exception is deliberately not implemented).

import { scoreBest, winDeclarable, type FanResult, type ScoringContext } from './fan'
import { defaultFanTable } from './fanTable'
import { makeRng } from './rng'
import { isBonus, isSuit, rankOf, sortTiles } from './tiles'
import { nextSeat, SEATS, type Meld, type Seat, type TileId, type Wind } from './types'
import { buildWall } from './wall'
import { decompose } from './win'

export const DEAD_WALL = 14

export interface RuleConfig {
  faanMinimum: 0 | 1 | 3
  flowers: boolean
  faanCap: number | null
}

export type ClaimKind = 'win' | 'pung' | 'kong' | { chow: [TileId, TileId] }

export type Action =
  | { type: 'draw'; seat: Seat }
  | { type: 'discard'; seat: Seat; tile: TileId }
  | { type: 'declareWin'; seat: Seat }
  | { type: 'claim'; seat: Seat; claim: ClaimKind }
  | { type: 'pass'; seat: Seat }
  | { type: 'kong'; seat: Seat; tile: TileId; style: 'concealed' | 'added' }

export interface RoundResult {
  kind: 'win' | 'draw'
  winner?: Seat
  loser?: Seat
  selfDraw?: boolean
  fan?: FanResult
}

export type Phase = 'discard' | 'draw' | 'claims' | 'finished'

export interface GameState {
  config: RuleConfig
  wall: TileId[]
  hands: Record<Seat, TileId[]>
  melds: Record<Seat, Meld[]>
  bonus: Record<Seat, TileId[]>
  discards: Record<Seat, TileId[]>
  turn: Seat
  phase: Phase
  /** The tile a claims phase is about: a discard, or (robKong) the tile just
   * added to an exposed pung, claimable by win only. */
  pendingDiscard: { tile: TileId; from: Seat; robKong?: true } | null
  claims: Partial<Record<Seat, ClaimKind | 'pass'>>
  /** Set after a draw/kong replacement; cleared by claims. Gates declareWin. */
  lastDraw: { seat: Seat; tile: TileId; kongReplacement: boolean; lastWallTile: boolean } | null
  /** Kind of the last tile taken by pung/kong/chow — bot defence signal. */
  lastClaimed: TileId | null
  roundWind: Wind
  seatWinds: Record<Seat, Wind>
  log: Action[]
  result: RoundResult | null
}

/** What one seat may legally see. Bots and analysis receive ONLY this. */
export interface PlayerView {
  seat: Seat
  seatWind: Wind
  roundWind: Wind
  seatWinds: Record<Seat, Wind>
  concealed: TileId[]
  /** Public: everyone can count tile backs at a real table. */
  handCounts: Record<Seat, number>
  melds: Record<Seat, Meld[]>
  bonus: Record<Seat, TileId[]>
  discards: Record<Seat, TileId[]>
  wallCount: number
  faanMinimum: number
  turn: Seat
  phase: Phase
  pendingDiscard: { tile: TileId; from: Seat; robKong?: true } | null
  lastClaimed: TileId | null
  legal: Action[]
}

const live = (s: GameState): number => s.wall.length - DEAD_WALL

const WINDS_BY_SEAT: Wind[] = ['E', 'S', 'W', 'N']

export function createGameWithWall(
  config: RuleConfig,
  wall: TileId[],
  dealer: Seat = 0,
  roundWind: Wind = 'E',
): GameState {
  const w = [...wall]
  const hands = {} as Record<Seat, TileId[]>
  const melds = {} as Record<Seat, Meld[]>
  const bonus = {} as Record<Seat, TileId[]>
  const discards = {} as Record<Seat, TileId[]>
  const seatWinds = {} as Record<Seat, Wind>

  const order: Seat[] = [0, 1, 2, 3].map((i) => (((dealer + i) % 4) as Seat))
  for (const [i, seat] of order.entries()) {
    hands[seat] = w.splice(0, 13)
    melds[seat] = []
    bonus[seat] = []
    discards[seat] = []
    seatWinds[seat] = WINDS_BY_SEAT[i]
  }
  hands[dealer].push(w.splice(0, 1)[0])

  // Bonus tiles are set aside and replaced from the back, in deal order.
  for (const seat of order) {
    const h = hands[seat]
    for (let i = h.findIndex(isBonus); i >= 0; i = h.findIndex(isBonus)) {
      bonus[seat].push(h[i])
      h.splice(i, 1)
      let r = w.pop()
      while (r !== undefined && isBonus(r)) {
        bonus[seat].push(r)
        r = w.pop()
      }
      if (r === undefined) throw new Error('wall exhausted during deal')
      h.push(r)
    }
    hands[seat] = sortTiles(h)
  }

  return {
    config,
    wall: w,
    hands,
    melds,
    bonus,
    discards,
    turn: dealer,
    phase: 'discard',
    pendingDiscard: null,
    claims: {},
    lastDraw: { seat: dealer, tile: hands[dealer][0], kongReplacement: false, lastWallTile: false },
    lastClaimed: null,
    roundWind,
    seatWinds,
    log: [],
    result: null,
  }
}

export function createGame(
  config: RuleConfig,
  seed: string,
  dealer: Seat = 0,
  roundWind: Wind = 'E',
): GameState {
  const wall = buildWall({ flowers: config.flowers }, makeRng(seed))
  return createGameWithWall(config, wall, dealer, roundWind)
}

function scoringContext(s: GameState, seat: Seat, byDiscard: boolean): ScoringContext {
  return {
    seatWind: s.seatWinds[seat],
    roundWind: s.roundWind,
    selfDraw: !byDiscard,
    flowers: s.bonus[seat],
    fullyConcealed: s.melds[seat].every((m) => m.concealed),
    lastWallTile: !byDiscard && (s.lastDraw?.lastWallTile ?? false),
    kongReplacement: !byDiscard && (s.lastDraw?.kongReplacement ?? false),
    ...(s.config.faanCap !== null
      ? { table: { ...defaultFanTable, faanCap: s.config.faanCap } }
      : {}),
  }
}

function winFan(s: GameState, seat: Seat, concealed: TileId[], byDiscard: boolean): FanResult | null {
  const ds = decompose(concealed, s.melds[seat])
  if (ds.length === 0) return null
  const fan = scoreBest(ds, scoringContext(s, seat, byDiscard))
  return winDeclarable(fan.totalFaan, s.config.faanMinimum) ? fan : null
}

function claimOptions(s: GameState, seat: Seat): ClaimKind[] {
  const pd = s.pendingDiscard
  if (!pd || seat === pd.from) return []
  const h = s.hands[seat]
  const tile = pd.tile

  // Robbing the kong: the added tile can be won, never melded from.
  if (pd.robKong) {
    return winFan(s, seat, [...h, tile], true) ? ['win'] : []
  }

  const out: ClaimKind[] = []
  const copies = h.filter((t) => t === tile).length

  if (winFan(s, seat, [...h, tile], true)) out.push('win')
  if (copies >= 2) out.push('pung')
  if (copies >= 3 && live(s) > 0) out.push('kong')

  if (seat === nextSeat(pd.from) && isSuit(tile)) {
    const r = rankOf(tile)!
    const suit = tile[0]
    const has = (n: number) => n >= 1 && n <= 9 && h.includes(`${suit}${n}`)
    const variants: [number, number][] = [
      [r - 2, r - 1],
      [r - 1, r + 1],
      [r + 1, r + 2],
    ]
    for (const [a, b] of variants) {
      if (has(a) && has(b)) out.push({ chow: [`${suit}${a}`, `${suit}${b}`] })
    }
  }
  return out
}

function eligibleSeats(s: GameState): Seat[] {
  return SEATS.filter((seat) => claimOptions(s, seat).length > 0)
}

export function legalActions(s: GameState, seat: Seat): Action[] {
  if (s.phase === 'finished') return []

  if (s.phase === 'draw') {
    return seat === s.turn ? [{ type: 'draw', seat }] : []
  }

  if (s.phase === 'discard') {
    if (seat !== s.turn) return []
    const out: Action[] = []
    const h = s.hands[seat]
    for (const tile of new Set(h)) out.push({ type: 'discard', seat, tile })
    // Self-win only on a hand refreshed by a draw/replacement (or the deal).
    if (s.lastDraw?.seat === seat && winFan(s, seat, h, false)) {
      out.push({ type: 'declareWin', seat })
    }
    if (live(s) > 0) {
      const counts = new Map<TileId, number>()
      for (const t of h) counts.set(t, (counts.get(t) ?? 0) + 1)
      for (const [tile, c] of counts) {
        if (c === 4) out.push({ type: 'kong', seat, tile, style: 'concealed' })
      }
      for (const m of s.melds[seat]) {
        if (m.type === 'pung' && !m.concealed && h.includes(m.tiles[0])) {
          out.push({ type: 'kong', seat, tile: m.tiles[0], style: 'added' })
        }
      }
    }
    return out
  }

  // claims phase
  if (s.claims[seat] !== undefined) return []
  const opts = claimOptions(s, seat)
  if (opts.length === 0) return []
  return [
    ...opts.map((claim): Action => ({ type: 'claim', seat, claim })),
    { type: 'pass', seat },
  ]
}

const canon = (a: Action): string =>
  JSON.stringify(a, (_k, v: unknown) =>
    Array.isArray(v) && v.length === 2 && typeof v[0] === 'string' ? [...(v as string[])].sort() : v,
  )

function removeTiles(h: TileId[], tiles: TileId[]): void {
  for (const t of tiles) {
    const i = h.indexOf(t)
    if (i < 0) throw new Error(`tile ${t} not in hand`)
    h.splice(i, 1)
  }
}

/** Draw from the back of the wall, skipping (and banking) bonus tiles. */
function replacementDraw(s: GameState, seat: Seat): TileId {
  let r = s.wall.pop()
  while (r !== undefined && isBonus(r)) {
    s.bonus[seat].push(r)
    r = s.wall.pop()
  }
  if (r === undefined) throw new Error('wall exhausted on replacement draw')
  return r
}

function finishWin(s: GameState, seat: Seat, byDiscard: boolean): void {
  if (byDiscard) {
    s.hands[seat] = sortTiles([...s.hands[seat], s.pendingDiscard!.tile])
  }
  const fan = winFan(s, seat, s.hands[seat], byDiscard)
  if (!fan) throw new Error('finishWin called on a non-declarable hand')
  s.result = {
    kind: 'win',
    winner: seat,
    ...(byDiscard ? { loser: s.pendingDiscard!.from } : {}),
    selfDraw: !byDiscard,
    fan,
  }
  s.pendingDiscard = null
  s.phase = 'finished'
}

/** All robbers passed: the added kong completes and draws its replacement. */
function completeAddedKong(s: GameState, from: Seat, tile: TileId): void {
  const pung = s.melds[from].find((m) => m.type === 'pung' && m.tiles[0] === tile)!
  pung.type = 'kong'
  pung.tiles = [tile, tile, tile, tile]
  pung.kongStyle = 'added'
  const r = replacementDraw(s, from)
  s.hands[from] = sortTiles([...s.hands[from], r])
  s.lastDraw = { seat: from, tile: r, kongReplacement: true, lastWallTile: live(s) <= 0 }
  s.pendingDiscard = null
  s.claims = {}
  s.turn = from
  s.phase = 'discard'
}

function resolveClaims(s: GameState): void {
  const from = s.pendingDiscard!.from
  const tile = s.pendingDiscard!.tile
  const robKong = s.pendingDiscard!.robKong === true
  const inOrder: Seat[] = [1, 2, 3].map((i) => (((from + i) % 4) as Seat))

  // Ties resolve by seat order counter-clockwise from the discarder —
  // multiple winners off one discard: the nearest seat takes it (§5.3).
  const winner = inOrder.find((seat) => s.claims[seat] === 'win')
  if (winner !== undefined) {
    finishWin(s, winner, true)
    return
  }

  if (robKong) {
    completeAddedKong(s, from, tile)
    return
  }

  // Priority §5.1: pung/kong outrank chow; within a rank the nearest seat
  // from the discarder wins. `inOrder` is already nearest-first, so a chow
  // (only ever claimable by the nearest seat) must NOT be picked ahead of a
  // farther seat's pung/kong — take all melds by rank, seat order breaking ties.
  const melder =
    inOrder.find((seat) => s.claims[seat] === 'pung' || s.claims[seat] === 'kong') ??
    inOrder.find((seat) => {
      const c = s.claims[seat]
      return typeof c === 'object' && c !== null
    })
  if (melder !== undefined) {
    const c = s.claims[melder]!
    const h = s.hands[melder]
    if (c === 'pung') {
      removeTiles(h, [tile, tile])
      s.melds[melder].push({ type: 'pung', tiles: [tile, tile, tile], concealed: false, claimedFrom: from })
    } else if (c === 'kong') {
      removeTiles(h, [tile, tile, tile])
      s.melds[melder].push({
        type: 'kong',
        tiles: [tile, tile, tile, tile],
        concealed: false,
        kongStyle: 'exposed',
        claimedFrom: from,
      })
      const r = replacementDraw(s, melder)
      h.push(r)
      s.lastDraw = { seat: melder, tile: r, kongReplacement: true, lastWallTile: live(s) <= 0 }
    } else if (typeof c === 'object') {
      removeTiles(h, c.chow)
      s.melds[melder].push({
        type: 'chow',
        tiles: sortTiles([...c.chow, tile]),
        concealed: false,
        claimedFrom: from,
      })
    }
    s.hands[melder] = sortTiles(h)
    if (c !== 'kong') s.lastDraw = null // pung/chow: no fresh tile, no self-win until next draw
    s.lastClaimed = tile
    s.pendingDiscard = null
    s.claims = {}
    s.turn = melder
    s.phase = 'discard'
    return
  }

  // Everyone passed: the tile lands in the discarder's pool.
  s.discards[from].push(tile)
  s.pendingDiscard = null
  s.claims = {}
  if (live(s) <= 0) {
    s.result = { kind: 'draw' }
    s.phase = 'finished'
  } else {
    s.turn = nextSeat(from)
    s.phase = 'draw'
  }
}

export function applyAction(state: GameState, action: Action): GameState {
  const legal = legalActions(state, action.seat)
  const key = canon(action)
  if (!legal.some((a) => canon(a) === key)) {
    throw new Error(`illegal action: ${JSON.stringify(action)} (phase ${state.phase}, turn ${state.turn})`)
  }

  const s = structuredClone(state)
  s.log.push(action)

  switch (action.type) {
    case 'draw': {
      let tile = s.wall.shift()!
      while (isBonus(tile)) {
        s.bonus[action.seat].push(tile)
        const r = s.wall.pop()
        if (r === undefined) throw new Error('wall exhausted on bonus replacement')
        tile = r
      }
      s.hands[action.seat] = sortTiles([...s.hands[action.seat], tile])
      s.lastDraw = { seat: action.seat, tile, kongReplacement: false, lastWallTile: live(s) <= 0 }
      s.phase = 'discard'
      break
    }
    case 'discard': {
      removeTiles(s.hands[action.seat], [action.tile])
      s.pendingDiscard = { tile: action.tile, from: action.seat }
      s.claims = {}
      s.phase = 'claims'
      if (eligibleSeats(s).length === 0) resolveClaims(s)
      break
    }
    case 'declareWin': {
      finishWin(s, action.seat, false)
      break
    }
    case 'kong': {
      const h = s.hands[action.seat]
      if (action.style === 'concealed') {
        removeTiles(h, [action.tile, action.tile, action.tile, action.tile])
        s.melds[action.seat].push({
          type: 'kong',
          tiles: [action.tile, action.tile, action.tile, action.tile],
          concealed: true,
          kongStyle: 'concealed',
        })
      } else {
        // An added kong is robbable (§5.3): the tile leaves the hand and a
        // win-only claim window opens BEFORE the kong completes. With no
        // eligible robber this resolves synchronously into the kong.
        removeTiles(h, [action.tile])
        s.pendingDiscard = { tile: action.tile, from: action.seat, robKong: true }
        s.claims = {}
        s.phase = 'claims'
        if (eligibleSeats(s).length === 0) resolveClaims(s)
        break
      }
      const r = replacementDraw(s, action.seat)
      s.hands[action.seat] = sortTiles([...h, r])
      s.lastDraw = { seat: action.seat, tile: r, kongReplacement: true, lastWallTile: live(s) <= 0 }
      s.phase = 'discard'
      break
    }
    case 'claim':
    case 'pass': {
      s.claims[action.seat] = action.type === 'pass' ? 'pass' : action.claim
      const waiting = eligibleSeats(s).filter((seat) => s.claims[seat] === undefined)
      if (waiting.length === 0) resolveClaims(s)
      break
    }
  }
  return s
}

export function playerView(s: GameState, seat: Seat): PlayerView {
  const melds = {} as Record<Seat, Meld[]>
  for (const other of SEATS) {
    melds[other] = s.melds[other].map((m) =>
      other !== seat && m.type === 'kong' && m.concealed ? { ...m, tiles: [] } : structuredClone(m),
    )
  }
  return {
    seat,
    seatWind: s.seatWinds[seat],
    roundWind: s.roundWind,
    seatWinds: { ...s.seatWinds },
    concealed: [...s.hands[seat]],
    handCounts: {
      0: s.hands[0].length,
      1: s.hands[1].length,
      2: s.hands[2].length,
      3: s.hands[3].length,
    },
    melds,
    bonus: structuredClone(s.bonus),
    discards: structuredClone(s.discards),
    wallCount: live(s),
    faanMinimum: s.config.faanMinimum,
    turn: s.turn,
    phase: s.phase,
    pendingDiscard: s.pendingDiscard ? { ...s.pendingDiscard } : null,
    lastClaimed: s.lastClaimed,
    legal: legalActions(s, seat),
  }
}
