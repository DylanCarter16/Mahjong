import type { Suit, TileId, Wind } from './types'

const SUITS: Suit[] = ['m', 'p', 's']
const WINDS: Wind[] = ['E', 'S', 'W', 'N']
const DRAGONS = ['R', 'G', 'W'] as const

/** The 34 play-tile kinds (each appears ×4 in the wall). */
export const ALL_PLAY_KINDS: readonly TileId[] = [
  ...SUITS.flatMap((s) => Array.from({ length: 9 }, (_, i) => `${s}${i + 1}`)),
  ...WINDS.map((w) => `w${w}`),
  ...DRAGONS.map((d) => `d${d}`),
]

/** The 8 bonus kinds (each appears ×1): flowers bf1..bf4, seasons bs1..bs4. */
export const BONUS_KINDS: readonly TileId[] = [
  'bf1', 'bf2', 'bf3', 'bf4',
  'bs1', 'bs2', 'bs3', 'bs4',
]

const VALID = new Set<TileId>([...ALL_PLAY_KINDS, ...BONUS_KINDS])

// Sort order: characters, circles, bamboo, winds E S W N, dragons R G W, bonus last.
const ORDER = new Map<TileId, number>(
  [...ALL_PLAY_KINDS, ...BONUS_KINDS].map((id, i) => [id, i]),
)

/** Validate and canonicalise a tile id. Throws on anything unknown. */
export function t(id: string): TileId {
  if (!VALID.has(id)) throw new Error(`Unknown tile id: ${id}`)
  return id
}

/** Parse a space-separated tile list, e.g. hand("m1 m2 wE"), sorted. */
export function hand(s: string): TileId[] {
  return sortTiles(s.trim().split(/\s+/).filter(Boolean).map(t))
}

export function sortTiles(tiles: TileId[]): TileId[] {
  return [...tiles].sort((a, b) => ORDER.get(a)! - ORDER.get(b)!)
}

export const isSuit = (id: TileId): boolean => id[0] === 'm' || id[0] === 'p' || id[0] === 's'
export const isHonour = (id: TileId): boolean => id[0] === 'w' || id[0] === 'd'
export const isBonus = (id: TileId): boolean => id[0] === 'b'
export const isTerminal = (id: TileId): boolean =>
  isSuit(id) && (rankOf(id) === 1 || rankOf(id) === 9)

export const suitOf = (id: TileId): Suit | null => (isSuit(id) ? (id[0] as Suit) : null)
export const rankOf = (id: TileId): number | null => (isSuit(id) ? Number(id[1]) : null)

// NOTE (§D1): there is deliberately NO glyph(id) here any more.
//
// Tiles used to have two rendering paths — the procedural SVG <TileView>, and a
// Unicode-mahjong-block character (U+1F000–U+1F02A) dropped inline as text. The
// text path is the one that produced the red-dragon problem (🀄 renders as an
// emoji on some platforms and as a tiny mono glyph on others), and it kept
// resurfacing in corners: a trainer's threat pool, a claim button, a table
// cell. Deleting the function is what makes "one rendering path" enforceable
// rather than a convention. Everything that shows a tile calls <TileView>, and
// a row of them calls <TilePool>.

const WIND_NAMES: Record<Wind, string> = { E: 'East', S: 'South', W: 'West', N: 'North' }
const DRAGON_NAMES: Record<string, string> = { R: 'Red', G: 'Green', W: 'White' }
const SUIT_NAMES: Record<Suit, string> = { m: 'Characters', p: 'Circles', s: 'Bamboo' }
const FLOWER_NAMES = ['Plum', 'Orchid', 'Bamboo', 'Chrysanthemum']
const SEASON_NAMES = ['Spring', 'Summer', 'Autumn', 'Winter']

export function tileName(id: TileId): string {
  t(id)
  if (isSuit(id)) return `${rankOf(id)} of ${SUIT_NAMES[suitOf(id)!]}`
  if (id[0] === 'w') return `${WIND_NAMES[id[1] as Wind]} Wind`
  if (id[0] === 'd') return `${DRAGON_NAMES[id[1]]} Dragon`
  const idx = Number(id[2])
  return id[1] === 'f'
    ? `Flower ${idx} (${FLOWER_NAMES[idx - 1]})`
    : `Season ${idx} (${SEASON_NAMES[idx - 1]})`
}
