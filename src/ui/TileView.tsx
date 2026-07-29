// The one tile component (§5.3): used by the table, the hand, discard pools,
// lessons and trainers. Faces are procedural SVG (TileFace); no fonts or
// assets outside our control. Colours/relief come from design tokens.

import { tileName } from '../engine/tiles'
import type { TileId } from '../engine/types'
import { TileBack, TileFace } from './tiles/TileFace'

export type TileState = 'normal' | 'dimmed' | 'highlighted' | 'safe' | 'danger' | 'selected'

const SIZES = {
  xs: 'w-5',
  sm: 'w-7',
  md: 'w-10',
  lg: 'w-14',
  // The hand: 44px tap target on phones (the ≥44px minimum applies to the
  // tappable area), 56px from `sm` up. Lets 14 tiles wrap to two rows on a
  // narrow portrait screen while staying easy to tell apart and tap.
  hand: 'w-11 sm:w-14',
}

// Rings use the semantic scale: highlighted = suggested/consider (orange),
// safe = keep (green), danger = red. Gold is reserved for turn indication.
const STATE_CLS: Record<TileState, string> = {
  normal: '',
  dimmed: 'opacity-45 saturate-50',
  highlighted: 'ring-2 ring-consider ring-offset-1 ring-offset-felt-deep',
  safe: 'ring-2 ring-safe ring-offset-1 ring-offset-felt-deep',
  danger: 'ring-2 ring-danger ring-offset-1 ring-offset-felt-deep',
  selected: '-translate-y-1.5 ring-2 ring-ivory-bright',
}

export interface TileViewProps {
  /** null renders a face-down tile back. */
  tile: TileId | null
  /** Rank overlay, top-left, neutral tone. */
  numbered?: boolean
  size?: keyof typeof SIZES
  onClick?: () => void
  state?: TileState
  /** Legacy alias for state, used by older call sites. */
  ring?: 'suggest' | 'keep' | 'selected'
  title?: string
}

const RING_TO_STATE: Record<NonNullable<TileViewProps['ring']>, TileState> = {
  suggest: 'highlighted',
  keep: 'safe',
  selected: 'selected',
}

export function TileView({ tile, numbered = false, size = 'md', onClick, state, ring, title }: TileViewProps) {
  const resolved: TileState = state ?? (ring ? RING_TO_STATE[ring] : 'normal')
  const cls = `${SIZES[size]} aspect-[5/7] shrink-0 rounded-[8%] transition-transform duration-(--duration-ui) shadow-tile ${STATE_CLS[resolved]}`

  if (tile === null) {
    return (
      <div className={cls} aria-label="face-down tile">
        <TileBack />
      </div>
    )
  }

  // The accessible name always STARTS with the tile, then any extra context
  // (the beginner-aid evaluation). Before, a `title` replaced the name outright,
  // so with aids on a hand tile announced "discarding leaves 2 shanten" without
  // ever saying which tile it was.
  const name = tileName(tile)
  const label = title ? `${name} — ${title}` : name

  return onClick ? (
    <button
      type="button"
      onClick={onClick}
      title={title ?? name}
      aria-label={label}
      className={`${cls} cursor-pointer hover:-translate-y-1.5 hover:shadow-tile-lifted focus-visible:outline-2 focus-visible:outline-accent`}
    >
      <TileFace tile={tile} showRank={numbered} />
    </button>
  ) : (
    <div title={title ?? name} aria-label={label} role="img" className={cls}>
      <TileFace tile={tile} showRank={numbered} />
    </div>
  )
}
