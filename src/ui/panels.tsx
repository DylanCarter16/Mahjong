// Table furniture: opponent panels, discard pools, meld rows.

import type { PlayerView } from '../engine/game'
import type { Meld, Seat, TileId } from '../engine/types'
import type { SeatStatus } from '../room/protocol'
import { TileView } from './TileView'

export const SEAT_NAMES: Record<Seat, string> = { 0: 'You', 1: 'South Bot', 2: 'West Bot', 3: 'North Bot' }

/** Per-seat connection chip for the multiplayer table (§7). Solo omits it. */
export function SeatStatusBadge({ status }: { status: SeatStatus }) {
  if (status === 'connected' || status === 'open') return null
  const cls =
    status === 'reconnecting'
      ? 'bg-amber-500/20 text-amber-200 border-amber-400/40'
      : 'bg-emerald-700/40 text-emerald-200 border-emerald-500/40' // 'bot'
  const label = status === 'reconnecting' ? 'reconnecting…' : 'bot'
  return (
    <span
      className={`rounded-full border px-1.5 py-0.5 text-[0.6rem] font-medium ${cls}`}
      role="status"
      aria-label={status === 'reconnecting' ? 'player reconnecting' : 'seat played by bot'}
    >
      {label}
    </span>
  )
}

export function MeldRow({ melds, numbered, small = false }: { melds: Meld[]; numbered: boolean; small?: boolean }) {
  if (melds.length === 0) return null
  const size = small ? 'xs' : 'sm'
  return (
    <div className="flex gap-2 flex-wrap">
      {melds.map((m, i) => (
        <div key={i} className="flex gap-px">
          {m.tiles.length === 0
            ? [0, 1, 2, 3].map((j) => <TileView key={j} tile={null} size={size} />)
            : m.tiles.map((t, j) => <TileView key={j} tile={t} size={size} numbered={numbered} />)}
        </div>
      ))}
    </div>
  )
}

export function BonusRow({ tiles }: { tiles: TileId[] }) {
  if (tiles.length === 0) return null
  return (
    <div className="flex gap-px">
      {tiles.map((t, i) => (
        <TileView key={i} tile={t} size="sm" />
      ))}
    </div>
  )
}

/** Tile widths, in rem, matching TileView's SIZES — used to cap a pool's width
 *  at exactly `perRow` tiles so it wraps in reading order like a real table. */
const TILE_REM: Record<'xs' | 'sm' | 'md' | 'lg', number> = { xs: 1.25, sm: 1.75, md: 2.5, lg: 3.5 }
const POOL_GAP_REM = 0.125

/**
 * A pool of tiles in reading order — the ONE way a row of tiles is drawn, at
 * whatever size the surface needs. Everything that shows a discard pool goes
 * through here (the table, the drills), so there is a single rendering path and
 * no place for a text-glyph fallback to survive.
 *
 * Width is capped at `perRow` tiles but still fluid, so it wraps to fewer per
 * row on a narrow phone instead of overflowing.
 */
export function TilePool({
  tiles,
  numbered = false,
  size = 'sm',
  perRow = 6,
  pending = null,
}: {
  tiles: TileId[]
  numbered?: boolean
  size?: 'xs' | 'sm' | 'md' | 'lg'
  perRow?: number
  /** The tile mid-flight, drawn with the "consider" ring and a soft pulse. */
  pending?: TileId | null
}) {
  const maxWidth = `${perRow * TILE_REM[size] + (perRow - 1) * POOL_GAP_REM}rem`
  return (
    <div
      data-tile-pool={size}
      className="mx-auto flex min-h-9 w-full flex-wrap content-start justify-center gap-0.5"
      style={{ maxWidth }}
    >
      {tiles.map((t, i) => (
        <TileView key={i} tile={t} size={size} numbered={numbered} />
      ))}
      {pending && (
        <div className="animate-pulse">
          <TileView tile={pending} size={size} numbered={numbered} ring="suggest" />
        </div>
      )}
    </div>
  )
}

export function DiscardPool({ view, seat, numbered }: { view: PlayerView; seat: Seat; numbered: boolean }) {
  // Fluid width capped at ~6 sm-tiles wide, so it fills a stack grid cell yet
  // holds the functional 6-per-row per-seat layout (§5.4) that teaches discard
  // reading — shrunk to fit a phone, never merged into an undifferentiated blob.
  return (
    <TilePool
      tiles={view.discards[seat]}
      numbered={numbered}
      size="sm"
      pending={view.pendingDiscard?.from === seat ? view.pendingDiscard.tile : null}
    />
  )
}
