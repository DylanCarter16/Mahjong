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

export function MeldRow({ melds, numbered }: { melds: Meld[]; numbered: boolean }) {
  if (melds.length === 0) return null
  return (
    <div className="flex gap-2 flex-wrap">
      {melds.map((m, i) => (
        <div key={i} className="flex gap-px">
          {m.tiles.length === 0
            ? [0, 1, 2, 3].map((j) => <TileView key={j} tile={null} size="sm" />)
            : m.tiles.map((t, j) => <TileView key={j} tile={t} size="sm" numbered={numbered} />)}
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

export function DiscardPool({ view, seat, numbered }: { view: PlayerView; seat: Seat; numbered: boolean }) {
  const tiles = view.discards[seat]
  const pending = view.pendingDiscard?.from === seat ? view.pendingDiscard.tile : null
  // Fluid width capped at ~6 sm-tiles wide, so it fills a stack grid cell yet
  // holds the functional 6-per-row per-seat layout (§5.4) that teaches discard
  // reading — shrunk to fit a phone, never merged into an undifferentiated blob.
  return (
    <div className="min-h-9 w-full max-w-44 mx-auto flex flex-wrap gap-0.5 content-start justify-center">
      {tiles.map((t, i) => (
        <TileView key={i} tile={t} size="sm" numbered={numbered} />
      ))}
      {pending && (
        <div className="animate-pulse">
          <TileView tile={pending} size="sm" numbered={numbered} ring="suggest" />
        </div>
      )}
    </div>
  )
}
