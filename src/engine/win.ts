// Hand decomposition and win detection. The three winning shapes are
// standard (4 sets + pair), seven pairs, and thirteen orphans — everything
// else (All Pungs, Mixed One Suit, ...) is a faan pattern layered on top by
// fan.ts, never a shape.
//
// decompose() returns EVERY valid reading of the hand. The same 14 tiles can
// break up multiple ways and faan scoring must take the best one; returning
// only the first reading would silently under-score hands.

import { ALL_PLAY_KINDS, isSuit, rankOf, sortTiles } from './tiles'
import type { Meld, TileId } from './types'

export interface DecompSet {
  type: 'chow' | 'pung' | 'kong'
  tiles: TileId[]
  concealed: boolean
  /** True when this set came from an already-declared meld. */
  fromMeld: boolean
}

export type Decomposition =
  | { shape: 'standard'; sets: DecompSet[]; pair: [TileId, TileId] }
  | { shape: 'sevenPairs'; pairs: [TileId, TileId][] }
  | { shape: 'thirteenOrphans'; duplicated: TileId }

/** The 13 tile kinds of Thirteen Orphans. */
export const ORPHAN_KINDS: readonly TileId[] = [
  'm1', 'm9', 'p1', 'p9', 's1', 's9',
  'wE', 'wS', 'wW', 'wN', 'dR', 'dG', 'dW',
]

type Hist = Map<TileId, number>

function histogram(tiles: TileId[]): Hist {
  const h: Hist = new Map()
  for (const t of tiles) h.set(t, (h.get(t) ?? 0) + 1)
  return h
}

function meldToDecompSet(m: Meld): DecompSet {
  return { type: m.type, tiles: [...m.tiles], concealed: m.concealed, fromMeld: true }
}

const nextInSuit = (id: TileId, step: number): TileId | null => {
  if (!isSuit(id)) return null
  const r = rankOf(id)! + step
  return r >= 1 && r <= 9 ? `${id[0]}${r}` : null
}

/**
 * Enumerate every way to split `hist` entirely into pungs and chows.
 * Always works on the lowest remaining kind and tries BOTH the pung branch
 * and the chow branch — no early return, or we'd miss readings.
 */
function extractMelds(hist: Hist, acc: DecompSet[], out: DecompSet[][]): void {
  let lowest: TileId | null = null
  for (const kind of ALL_PLAY_KINDS) {
    if ((hist.get(kind) ?? 0) > 0) {
      lowest = kind
      break
    }
  }
  if (lowest === null) {
    out.push(acc.map((s) => ({ ...s, tiles: [...s.tiles] })))
    return
  }

  const count = hist.get(lowest)!

  // Branch 1: the lowest tile starts a pung.
  if (count >= 3) {
    hist.set(lowest, count - 3)
    acc.push({ type: 'pung', tiles: [lowest, lowest, lowest], concealed: true, fromMeld: false })
    extractMelds(hist, acc, out)
    acc.pop()
    hist.set(lowest, count)
  }

  // Branch 2: the lowest tile starts a chow. Honours never chow; chows never
  // wrap 9→1 (nextInSuit returns null past rank 9).
  const t2 = nextInSuit(lowest, 1)
  const t3 = nextInSuit(lowest, 2)
  if (t2 && t3 && (hist.get(t2) ?? 0) > 0 && (hist.get(t3) ?? 0) > 0) {
    hist.set(lowest, count - 1)
    hist.set(t2, hist.get(t2)! - 1)
    hist.set(t3, hist.get(t3)! - 1)
    acc.push({ type: 'chow', tiles: [lowest, t2, t3], concealed: true, fromMeld: false })
    extractMelds(hist, acc, out)
    acc.pop()
    hist.set(lowest, count)
    hist.set(t2, hist.get(t2)! + 1)
    hist.set(t3, hist.get(t3)! + 1)
  }
  // Neither branch fits → dead end, contributes nothing.
}

function standardDecompositions(concealed: TileId[], melds: Meld[]): Decomposition[] {
  // A legal winning hand has 3 concealed tiles per missing set plus the pair.
  // (Kong melds hold 4 tiles but still count as one set.)
  if (concealed.length !== 3 * (4 - melds.length) + 2) return []

  const results: Decomposition[] = []
  const seen = new Set<string>()
  const hist = histogram(concealed)

  for (const kind of [...hist.keys()].sort()) {
    if (hist.get(kind)! < 2) continue
    hist.set(kind, hist.get(kind)! - 2)
    const partitions: DecompSet[][] = []
    extractMelds(hist, [], partitions)
    hist.set(kind, hist.get(kind)! + 2)

    for (const sets of partitions) {
      const all = [...melds.map(meldToDecompSet), ...sets]
      const key = JSON.stringify([kind, all.map((s) => s.tiles.join('')).sort()])
      if (seen.has(key)) continue
      seen.add(key)
      results.push({ shape: 'standard', sets: all, pair: [kind, kind] })
    }
  }
  return results
}

function sevenPairsDecomposition(concealed: TileId[], melds: Meld[]): Decomposition | null {
  // Assumption (per spec §3): four-of-a-kind is NOT two pairs — a Seven Pairs
  // hand needs seven DISTINCT pairs, and must be fully concealed.
  if (melds.length > 0 || concealed.length !== 14) return null
  const hist = histogram(concealed)
  if (hist.size !== 7) return null
  for (const c of hist.values()) if (c !== 2) return null
  const pairs = sortTiles([...hist.keys()]).map((k) => [k, k] as [TileId, TileId])
  return { shape: 'sevenPairs', pairs }
}

function thirteenOrphansDecomposition(concealed: TileId[], melds: Meld[]): Decomposition | null {
  if (melds.length > 0 || concealed.length !== 14) return null
  const hist = histogram(concealed)
  let duplicated: TileId | null = null
  for (const kind of ORPHAN_KINDS) {
    const c = hist.get(kind) ?? 0
    if (c === 0 || c > 2) return null
    if (c === 2) {
      if (duplicated) return null
      duplicated = kind
    }
  }
  if (!duplicated || hist.size !== 13) return null
  return { shape: 'thirteenOrphans', duplicated }
}

/** Every valid reading of the hand (standard, seven pairs, thirteen orphans). */
export function decompose(concealed: TileId[], melds: Meld[]): Decomposition[] {
  const out = standardDecompositions(concealed, melds)
  const sp = sevenPairsDecomposition(concealed, melds)
  if (sp) out.push(sp)
  const to = thirteenOrphansDecomposition(concealed, melds)
  if (to) out.push(to)
  return out
}

export function isWinningHand(concealed: TileId[], melds: Meld[]): boolean {
  return decompose(concealed, melds).length > 0
}
