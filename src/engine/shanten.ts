// Distance-from-win. shanten = -1 means the hand is complete, 0 means tenpai
// (one tile from winning). Powers the intermediate/advanced bots and the
// tile-efficiency trainer, so correctness and speed both matter: we enumerate
// per-suit block extractions once (memoised) and combine across suits.

import { ALL_PLAY_KINDS, isSuit, suitOf, rankOf } from './tiles'
import type { Meld, Suit, TileId } from './types'

/** A way to carve one tile group: (complete sets, partial sets, reserved pair). */
type Option = [sets: number, partials: number, pair: 0 | 1]

const suitCache = new Map<string, Option[]>()

/**
 * All useful ways to extract blocks from one suit's rank histogram.
 * Partials are two-tile proto-sets (adjacent run, gap run, or a pair used as
 * proto-pung); at most one pair per hand is "reserved" as THE pair (q).
 */
function suitOptions(counts: number[]): Option[] {
  const key = counts.join('')
  const hit = suitCache.get(key)
  if (hit) return hit

  const found = new Set<string>()
  const out: Option[] = []
  const record = (s: number, p: number, q: 0 | 1) => {
    const k = `${s},${p},${q}`
    if (!found.has(k)) {
      found.add(k)
      out.push([s, p, q])
    }
  }

  const dfs = (r: number, s: number, p: number, q: 0 | 1): void => {
    while (r <= 9 && counts[r] === 0) r++
    if (r > 9) {
      record(s, p, q)
      return
    }
    const c = counts[r]

    // Drop one tile as a floater.
    counts[r] = c - 1
    dfs(r, s, p, q)
    counts[r] = c

    // Pung.
    if (c >= 3) {
      counts[r] = c - 3
      dfs(r, s + 1, p, q)
      counts[r] = c
    }
    // Chow.
    if (r <= 7 && counts[r + 1] > 0 && counts[r + 2] > 0) {
      counts[r] = c - 1
      counts[r + 1]--
      counts[r + 2]--
      dfs(r, s + 1, p, q)
      counts[r] = c
      counts[r + 1]++
      counts[r + 2]++
    }
    // Pair: reserved as THE pair, or spent as a proto-pung partial.
    if (c >= 2) {
      counts[r] = c - 2
      if (q === 0) dfs(r, s, p, 1)
      dfs(r, s, p + 1, q)
      counts[r] = c
    }
    // Partial runs.
    if (r <= 8 && counts[r + 1] > 0) {
      counts[r] = c - 1
      counts[r + 1]--
      dfs(r, s, p + 1, q)
      counts[r] = c
      counts[r + 1]++
    }
    if (r <= 7 && counts[r + 2] > 0) {
      counts[r] = c - 1
      counts[r + 2]--
      dfs(r, s, p + 1, q)
      counts[r] = c
      counts[r + 2]++
    }
  }

  dfs(1, 0, 0, 0)
  suitCache.set(key, out)
  return out
}

/** Options for one honour kind (pung / pair-as-partial / reserved pair / nothing). */
function honourOptions(count: number): Option[] {
  const out: Option[] = [[0, 0, 0]]
  if (count >= 3) out.push([1, 0, 0])
  if (count >= 2) out.push([0, 1, 0], [0, 0, 1])
  return out
}

function standardShanten(concealed: TileId[], meldCount: number): number {
  const suitCounts: Record<Suit, number[]> = {
    m: new Array(10).fill(0),
    p: new Array(10).fill(0),
    s: new Array(10).fill(0),
  }
  const honourCounts = new Map<TileId, number>()
  for (const t of concealed) {
    if (isSuit(t)) suitCounts[suitOf(t)!][rankOf(t)!]++
    else honourCounts.set(t, (honourCounts.get(t) ?? 0) + 1)
  }

  const groups: Option[][] = [
    suitOptions(suitCounts.m),
    suitOptions(suitCounts.p),
    suitOptions(suitCounts.s),
    ...[...honourCounts.values()].map(honourOptions),
  ]

  let best = 8
  // Fold the option groups together, tracking (sets, partials, pair).
  let states = new Map<string, Option>([['0,0,0', [0, 0, 0]]])
  for (const options of groups) {
    const next = new Map<string, Option>()
    for (const [, [s0, p0, q0]] of states) {
      for (const [s, p, q] of options) {
        if (q0 + q > 1) continue
        const ns = Math.min(4, s0 + s + meldCount) - meldCount // cap concealed sets
        const st: Option = [ns, Math.min(6, p0 + p), (q0 + q) as 0 | 1]
        next.set(st.join(','), st)
      }
    }
    states = next
  }

  for (const [, [s, p, q]] of states) {
    const sets = s + meldCount
    const usable = Math.min(p, 4 - sets)
    const shantenValue = 8 - 2 * sets - usable - q
    if (shantenValue < best) best = shantenValue
  }
  return best
}

function sevenPairsShanten(concealed: TileId[]): number {
  const counts = new Map<TileId, number>()
  for (const t of concealed) counts.set(t, (counts.get(t) ?? 0) + 1)
  // Distinct-pairs rule: a kind contributes at most one pair.
  let pairs = 0
  for (const c of counts.values()) if (c >= 2) pairs++
  const kinds = counts.size
  return 6 - pairs + Math.max(0, 7 - kinds)
}

const ORPHANS: readonly TileId[] = [
  'm1', 'm9', 'p1', 'p9', 's1', 's9',
  'wE', 'wS', 'wW', 'wN', 'dR', 'dG', 'dW',
]

function thirteenOrphansShanten(concealed: TileId[]): number {
  const counts = new Map<TileId, number>()
  for (const t of concealed) counts.set(t, (counts.get(t) ?? 0) + 1)
  let kinds = 0
  let hasPair = false
  for (const o of ORPHANS) {
    const c = counts.get(o) ?? 0
    if (c >= 1) kinds++
    if (c >= 2) hasPair = true
  }
  return 13 - kinds - (hasPair ? 1 : 0)
}

/** Minimum shanten across the three winning shapes. */
export function shanten(concealed: TileId[], melds: Meld[]): number {
  let best = standardShanten(concealed, melds.length)
  if (melds.length === 0) {
    best = Math.min(best, sevenPairsShanten(concealed), thirteenOrphansShanten(concealed))
  }
  return best
}

/** Tile kinds whose draw would strictly reduce shanten. */
export function usefulTiles(concealed: TileId[], melds: Meld[]): TileId[] {
  const base = shanten(concealed, melds)
  if (base === -1) return []
  const inHand = new Map<TileId, number>()
  for (const t of concealed) inHand.set(t, (inHand.get(t) ?? 0) + 1)
  const useful: TileId[] = []
  for (const kind of ALL_PLAY_KINDS) {
    if ((inHand.get(kind) ?? 0) >= 4) continue
    if (shanten([...concealed, kind], melds) < base) useful.push(kind)
  }
  return useful
}
