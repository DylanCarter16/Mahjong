// Strict request validation. The proxy only accepts our own game-state
// shapes; anything else is rejected before a prompt is ever built. Every
// validator returns a SANITISED copy (unknown fields dropped, sizes capped) —
// client input never flows into a prompt except through these.

import type { Action, PlayerView, RoundResult } from '../../src/engine/game'
import { ALL_PLAY_KINDS, BONUS_KINDS } from '../../src/engine/tiles'
import type { Meld, Seat, TileId, Wind } from '../../src/engine/types'

const TILE_IDS = new Set<string>([...ALL_PLAY_KINDS, ...BONUS_KINDS])
const WINDS = new Set(['E', 'S', 'W', 'N'])
const SEATS: Seat[] = [0, 1, 2, 3]
const PHASES = new Set(['discard', 'draw', 'claims', 'finished'])
const MELD_TYPES = new Set(['chow', 'pung', 'kong'])

const isObj = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x)

const isTile = (x: unknown): x is TileId => typeof x === 'string' && TILE_IDS.has(x)
const isSeat = (x: unknown): x is Seat => x === 0 || x === 1 || x === 2 || x === 3
const isWind = (x: unknown): x is Wind => typeof x === 'string' && WINDS.has(x)

function tileArray(x: unknown, max: number): TileId[] | null {
  if (!Array.isArray(x) || x.length > max || !x.every(isTile)) return null
  return [...(x as TileId[])]
}

function seatRecord<T>(x: unknown, each: (v: unknown) => T | null): Record<Seat, T> | null {
  if (!isObj(x)) return null
  const out = {} as Record<Seat, T>
  for (const s of SEATS) {
    const v = each(x[String(s)])
    if (v === null) return null
    out[s] = v
  }
  return out
}

function meld(x: unknown): Meld | null {
  if (!isObj(x)) return null
  if (typeof x.type !== 'string' || !MELD_TYPES.has(x.type)) return null
  const tiles = tileArray(x.tiles, 4)
  if (tiles === null) return null
  if (typeof x.concealed !== 'boolean') return null
  const m: Meld = { type: x.type as Meld['type'], tiles, concealed: x.concealed }
  if (x.kongStyle !== undefined) {
    if (x.kongStyle !== 'concealed' && x.kongStyle !== 'exposed' && x.kongStyle !== 'added') return null
    m.kongStyle = x.kongStyle
  }
  if (x.claimedFrom !== undefined) {
    if (!isSeat(x.claimedFrom)) return null
    m.claimedFrom = x.claimedFrom
  }
  return m
}

/** Validate + sanitise a posted PlayerView. Returns null on anything off-shape. */
export function validatePlayerView(x: unknown): PlayerView | null {
  if (!isObj(x)) return null
  if (!isSeat(x.seat) || !isWind(x.seatWind) || !isWind(x.roundWind)) return null
  const seatWinds = seatRecord(x.seatWinds, (v) => (isWind(v) ? v : null))
  const concealed = tileArray(x.concealed, 14)
  const handCounts = seatRecord(x.handCounts, (v) =>
    typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 14 ? v : null,
  )
  const melds = seatRecord(x.melds, (v) => {
    if (!Array.isArray(v) || v.length > 4) return null
    const ms: Meld[] = []
    for (const raw of v) {
      const m = meld(raw)
      if (!m) return null
      ms.push(m)
    }
    return ms
  })
  const bonus = seatRecord(x.bonus, (v) => tileArray(v, 8))
  const discards = seatRecord(x.discards, (v) => tileArray(v, 40))
  if (!seatWinds || !concealed || !handCounts || !melds || !bonus || !discards) return null
  if (typeof x.wallCount !== 'number' || x.wallCount < 0 || x.wallCount > 130) return null
  if (x.faanMinimum !== 0 && x.faanMinimum !== 1 && x.faanMinimum !== 3) return null
  if (!isSeat(x.turn) || typeof x.phase !== 'string' || !PHASES.has(x.phase)) return null

  let pendingDiscard: PlayerView['pendingDiscard'] = null
  if (x.pendingDiscard !== null && x.pendingDiscard !== undefined) {
    if (!isObj(x.pendingDiscard) || !isTile(x.pendingDiscard.tile) || !isSeat(x.pendingDiscard.from)) return null
    pendingDiscard = { tile: x.pendingDiscard.tile, from: x.pendingDiscard.from }
  }
  const lastClaimed = isTile(x.lastClaimed) ? x.lastClaimed : null

  return {
    seat: x.seat,
    seatWind: x.seatWind as Wind,
    roundWind: x.roundWind as Wind,
    seatWinds,
    concealed,
    handCounts,
    melds,
    bonus,
    discards,
    wallCount: Math.floor(x.wallCount),
    faanMinimum: x.faanMinimum,
    turn: x.turn,
    phase: x.phase as PlayerView['phase'],
    pendingDiscard,
    lastClaimed,
    legal: [], // never trusted from the client; prompts don't use it
  }
}

function action(x: unknown): Action | null {
  if (!isObj(x) || !isSeat(x.seat)) return null
  switch (x.type) {
    case 'draw':
      return { type: 'draw', seat: x.seat }
    case 'declareWin':
      return { type: 'declareWin', seat: x.seat }
    case 'pass':
      return { type: 'pass', seat: x.seat }
    case 'discard':
      return isTile(x.tile) ? { type: 'discard', seat: x.seat, tile: x.tile } : null
    case 'kong':
      if (!isTile(x.tile) || (x.style !== 'concealed' && x.style !== 'added')) return null
      return { type: 'kong', seat: x.seat, tile: x.tile, style: x.style }
    case 'claim': {
      const c = x.claim
      if (c === 'win' || c === 'pung' || c === 'kong') return { type: 'claim', seat: x.seat, claim: c }
      if (isObj(c) && Array.isArray(c.chow) && c.chow.length === 2 && c.chow.every(isTile)) {
        return { type: 'claim', seat: x.seat, claim: { chow: [c.chow[0], c.chow[1]] as [TileId, TileId] } }
      }
      return null
    }
    default:
      return null
  }
}

export interface ReviewPayload {
  log: Action[]
  result: RoundResult | null
}

/** Validate + sanitise a posted round review (action log + result). */
export function validateReview(x: unknown): ReviewPayload | null {
  if (!isObj(x) || !Array.isArray(x.log) || x.log.length === 0 || x.log.length > 600) return null
  const log: Action[] = []
  for (const raw of x.log) {
    const a = action(raw)
    if (!a) return null
    log.push(a)
  }
  let result: RoundResult | null = null
  if (x.result !== null && x.result !== undefined) {
    if (!isObj(x.result)) return null
    if (x.result.kind === 'draw') result = { kind: 'draw' }
    else if (x.result.kind === 'win' && isSeat(x.result.winner)) {
      result = { kind: 'win', winner: x.result.winner, selfDraw: x.result.selfDraw === true }
      if (isSeat(x.result.loser)) result.loser = x.result.loser
      if (isObj(x.result.fan) && typeof x.result.fan.totalFaan === 'number') {
        const patterns = Array.isArray(x.result.fan.patterns)
          ? x.result.fan.patterns
              .slice(0, 20)
              .filter(
                (p): p is { name: string; faan: number } =>
                  isObj(p) && typeof p.name === 'string' && p.name.length <= 40 && typeof p.faan === 'number',
              )
              .map((p) => ({ name: p.name, faan: p.faan }))
          : []
        result.fan = { totalFaan: x.result.fan.totalFaan, patterns }
      }
    } else return null
  }
  return { log, result }
}
