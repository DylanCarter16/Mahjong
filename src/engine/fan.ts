// Faan scoring. Values come from fanTable.ts; this file only detects
// patterns and applies subsumption. Scoring decisions documented here:
//   - All Honours subsumes All Pungs (an all-honours hand is structurally
//     all pungs; scoring both would double-count one property).
//   - All Kongs subsumes All Pungs, for the same reason.
//   - Nine Gates subsumes Pure One Suit (definitionally pure).
//   - Great/Small Dragons subsume the individual dragon pungs they contain;
//     Great Dragons also subsumes Small Dragons (spec §5).
//   - Great/Small Winds subsume seat/round wind pungs; Great subsumes Small.
//   - Mixed One Suit and All Pungs are NOT subsumed by wind/honour patterns
//     unless listed above — they stack, as on most HK tables.

import { defaultFanTable, type FanTable } from './fanTable'
import { isHonour, isSuit, rankOf, suitOf } from './tiles'
import type { Dragon, TileId, Wind } from './types'
import type { Decomposition } from './win'

export interface ScoringContext {
  seatWind: Wind
  roundWind: Wind
  selfDraw: boolean
  /** Bonus tiles set aside by the winner. */
  flowers: TileId[]
  /** No exposed melds (concealed kongs permitted, but not for Nine Gates). */
  fullyConcealed: boolean
  lastWallTile: boolean
  kongReplacement: boolean
  table?: FanTable
}

export interface FanResult {
  totalFaan: number
  patterns: { name: string; faan: number }[]
}

const DRAGON_NAMES: Record<Dragon, string> = {
  R: 'Red Dragon Pung',
  G: 'Green Dragon Pung',
  W: 'White Dragon Pung',
}

/** Seat wind → the flower/season index that belongs to that seat. */
const OWN_INDEX: Record<Wind, number> = { E: 1, S: 2, W: 3, N: 4 }

function allTilesOf(d: Decomposition): TileId[] {
  if (d.shape === 'standard') return [...d.sets.flatMap((s) => s.tiles), ...d.pair]
  if (d.shape === 'sevenPairs') return d.pairs.flat()
  return [] // thirteen orphans: suit patterns never apply
}

function isNineGates(d: Decomposition, ctx: ScoringContext): boolean {
  if (d.shape !== 'standard' || !ctx.fullyConcealed) return false
  if (d.sets.some((s) => s.fromMeld)) return false // no declared melds at all
  const tiles = allTilesOf(d)
  const suit = suitOf(tiles[0])
  if (!suit || tiles.some((t) => suitOf(t) !== suit)) return false
  const counts = new Array<number>(10).fill(0)
  for (const t of tiles) counts[rankOf(t)!]++
  if (counts[1] < 3 || counts[9] < 3) return false
  for (let r = 2; r <= 8; r++) if (counts[r] < 1) return false
  return true // 14 one-suit tiles ⊇ 1112345678999 is exactly base + 1 extra
}

/**
 * Every faan pattern name the scorer can emit. The coach proxy allowlists
 * client-supplied `fan.patterns[].name` against this set (audit L1), so no
 * free-text client string can ride into the review prompt.
 */
export const FAN_PATTERN_NAMES: ReadonlySet<string> = new Set([
  'All Chows',
  'All Honours',
  'All Kongs',
  'All Pungs',
  'Flower Set',
  'Great Dragons',
  'Great Winds',
  'Kong Replacement',
  'Last Wall Tile',
  'Mixed One Suit',
  'Nine Gates',
  'Own Flowers',
  'Pure One Suit',
  'Round Wind',
  'Seat Wind',
  'Self-draw',
  'Seven Pairs',
  'Small Dragons',
  'Small Winds',
  'Thirteen Orphans',
])

export function score(d: Decomposition, ctx: ScoringContext): FanResult {
  const table = ctx.table ?? defaultFanTable
  const patterns: { name: string; faan: number }[] = []
  const add = (name: string, faan: number) => {
    if (faan !== 0) patterns.push({ name, faan })
  }

  if (d.shape === 'thirteenOrphans') {
    add('Thirteen Orphans', table.thirteenOrphans)
  } else {
    // Suit composition (standard and seven pairs).
    const tiles = allTilesOf(d)
    const suits = new Set(tiles.filter(isSuit).map((t) => suitOf(t)!))
    const hasHonours = tiles.some(isHonour)
    if (suits.size === 0 && hasHonours) add('All Honours', table.allHonours)
    else if (suits.size === 1 && hasHonours) add('Mixed One Suit', table.mixedOneSuit)
    else if (suits.size === 1 && !hasHonours) add('Pure One Suit', table.pureOneSuit)

    if (d.shape === 'sevenPairs') add('Seven Pairs', table.sevenPairs)

    if (d.shape === 'standard') {
      const sets = d.sets
      if (sets.every((s) => s.type === 'kong')) add('All Kongs', table.allKongs)
      if (sets.every((s) => s.type !== 'chow')) add('All Pungs', table.allPungs)
      if (sets.every((s) => s.type === 'chow') && !isHonour(d.pair[0]))
        add('All Chows', table.allChows)

      const pungKind = (s: (typeof sets)[number]) => s.tiles[0]
      const windPungs = sets.filter((s) => s.type !== 'chow' && pungKind(s)[0] === 'w')
      const dragonPungs = sets.filter((s) => s.type !== 'chow' && pungKind(s)[0] === 'd')
      const windPair = d.pair[0][0] === 'w'
      const dragonPair = d.pair[0][0] === 'd'

      for (const s of windPungs) {
        const w = pungKind(s)[1] as Wind
        if (w === ctx.seatWind) add('Seat Wind', table.seatWindPung)
        if (w === ctx.roundWind) add('Round Wind', table.roundWindPung)
      }
      for (const s of dragonPungs) add(DRAGON_NAMES[pungKind(s)[1] as Dragon], table.dragonPung)

      if (dragonPungs.length === 3) add('Great Dragons', table.greatDragons)
      else if (dragonPungs.length === 2 && dragonPair) add('Small Dragons', table.smallDragons)

      if (windPungs.length === 4) add('Great Winds', table.greatWinds)
      else if (windPungs.length === 3 && windPair) add('Small Winds', table.smallWinds)

      if (isNineGates(d, ctx)) add('Nine Gates', table.nineGates)
    }
  }

  // Circumstantial faan (any shape).
  if (ctx.selfDraw) add('Self-draw', table.selfDraw)
  if (ctx.lastWallTile) add('Last Wall Tile', table.lastWallTile)
  if (ctx.kongReplacement) add('Kong Replacement', table.kongReplacementWin)

  const ownIdx = OWN_INDEX[ctx.seatWind]
  const own = ctx.flowers.filter((f) => Number(f[2]) === ownIdx).length
  if (own > 0) add('Own Flowers', own * table.ownFlower)
  const flowerCount = ctx.flowers.filter((f) => f[1] === 'f').length
  const seasonCount = ctx.flowers.filter((f) => f[1] === 's').length
  const fullSets = (flowerCount === 4 ? 1 : 0) + (seasonCount === 4 ? 1 : 0)
  if (fullSets > 0) add('Flower Set', fullSets * table.flowerSetBonus)

  // Subsumption: when a pattern is present, remove the patterns it implies.
  const SUBSUMES: Record<string, string[]> = {
    'All Honours': ['All Pungs'],
    'All Kongs': ['All Pungs'],
    'Nine Gates': ['Pure One Suit'],
    'Great Dragons': ['Small Dragons', 'Red Dragon Pung', 'Green Dragon Pung', 'White Dragon Pung'],
    'Small Dragons': ['Red Dragon Pung', 'Green Dragon Pung', 'White Dragon Pung'],
    'Great Winds': ['Small Winds', 'Seat Wind', 'Round Wind'],
    'Small Winds': ['Seat Wind', 'Round Wind'],
  }
  const present = new Set(patterns.map((p) => p.name))
  const dropped = new Set<string>()
  for (const name of present) for (const loser of SUBSUMES[name] ?? []) dropped.add(loser)
  const kept = patterns.filter((p) => !dropped.has(p.name))

  let totalFaan = kept.reduce((sum, p) => sum + p.faan, 0)
  if (table.faanCap !== null) totalFaan = Math.min(totalFaan, table.faanCap)
  return { totalFaan, patterns: kept }
}

/** Score every reading and keep the highest total. */
export function scoreBest(ds: Decomposition[], ctx: ScoringContext): FanResult {
  let bestResult: FanResult = { totalFaan: 0, patterns: [] }
  let found = false
  for (const d of ds) {
    const r = score(d, ctx)
    if (!found || r.totalFaan > bestResult.totalFaan) {
      bestResult = r
      found = true
    }
  }
  return bestResult
}

/** A complete hand below the table minimum cannot be declared. */
export function winDeclarable(totalFaan: number, minimum: number): boolean {
  return totalFaan >= minimum
}
