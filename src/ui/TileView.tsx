import { glyph, isSuit, rankOf, suitOf, tileName } from '../engine/tiles'
import type { TileId } from '../engine/types'

const SUIT_COLORS: Record<string, string> = {
  m: 'text-rose-600',
  p: 'text-sky-600',
  s: 'text-emerald-600',
}

const SIZES = {
  sm: 'h-8 w-6 text-[1.35rem] rounded',
  md: 'h-11 w-8 text-[1.9rem] rounded-md',
  lg: 'h-16 w-12 text-[2.8rem] rounded-lg',
}

export interface TileViewProps {
  /** null renders a face-down tile back. */
  tile: TileId | null
  numbered?: boolean
  size?: keyof typeof SIZES
  onClick?: () => void
  /** Beginner-aid ring: orange = suggested discard, green = keep. */
  ring?: 'suggest' | 'keep' | 'selected'
  title?: string
}

export function TileView({ tile, numbered = false, size = 'md', onClick, ring, title }: TileViewProps) {
  const ringCls =
    ring === 'suggest'
      ? 'ring-2 ring-amber-400 ring-offset-1 ring-offset-emerald-900'
      : ring === 'keep'
        ? 'ring-2 ring-lime-400 ring-offset-1 ring-offset-emerald-900'
        : ring === 'selected'
          ? 'ring-2 ring-white -translate-y-1'
          : ''

  if (tile === null) {
    return (
      <div
        className={`${SIZES[size]} shrink-0 bg-emerald-700 border border-emerald-950/60 shadow-sm`}
        aria-label="face-down tile"
      />
    )
  }

  const numberedOverlay = numbered && isSuit(tile) && (
    <span
      className={`absolute -top-0.5 right-0.5 text-[0.6rem] font-bold leading-none ${SUIT_COLORS[suitOf(tile)!]}`}
    >
      {rankOf(tile)}
    </span>
  )

  const inner = (
    <>
      <span className="leading-none select-none text-neutral-900">{glyph(tile)}</span>
      {numberedOverlay}
    </>
  )

  const cls = `${SIZES[size]} shrink-0 relative flex items-center justify-center bg-amber-50 border border-neutral-400/70 shadow-[0_2px_0_rgba(0,0,0,0.35)] ${ringCls}`

  return onClick ? (
    <button type="button" onClick={onClick} title={title ?? tileName(tile)} className={`${cls} cursor-pointer transition-transform hover:-translate-y-1`}>
      {inner}
    </button>
  ) : (
    <div title={title ?? tileName(tile)} className={cls}>
      {inner}
    </div>
  )
}
