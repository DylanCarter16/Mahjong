import { ALL_PLAY_KINDS, BONUS_KINDS } from './tiles'
import { shuffle, type Rng } from './rng'
import type { TileId } from './types'

/** Tiles reserved at the back of the wall for kong/bonus replacement draws. */
export const DEAD_WALL_SIZE = 14

export interface WallOptions {
  /** When false the 8 flowers/seasons are left out entirely (136-tile wall). */
  flowers: boolean
}

/**
 * Build and shuffle a full wall. Index 0 is the front (normal draws);
 * replacement draws come from the back. The last DEAD_WALL_SIZE tiles are
 * never drawn normally — the round is a draw once live tiles run out.
 */
export function buildWall(opts: WallOptions, rng: Rng): TileId[] {
  const tiles: TileId[] = []
  for (const kind of ALL_PLAY_KINDS) tiles.push(kind, kind, kind, kind)
  if (opts.flowers) tiles.push(...BONUS_KINDS)
  return shuffle(tiles, rng)
}
