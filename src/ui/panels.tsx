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

export function OpponentPanel({ view, seat, numbered, dealerSeat, label, status }: {
  view: PlayerView
  seat: Seat
  numbered: boolean
  dealerSeat: Seat
  /** Multiplayer: the real display name. Solo falls back to SEAT_NAMES. */
  label?: string
  /** Multiplayer: connection state chip. Solo omits it. */
  status?: SeatStatus
}) {
  const active = view.turn === seat && view.phase !== 'finished'
  return (
    <div className={`flex flex-col items-center gap-1.5 p-2 rounded-xl ${active ? 'bg-emerald-800/70 shadow-lg' : ''}`}>
      <div className="flex items-center gap-1.5 text-sm font-medium text-emerald-100/90">
        <span className="max-w-28 truncate">{label ?? SEAT_NAMES[seat]}</span> · {view.seatWinds[seat]}
        {dealerSeat === seat && <span className="text-amber-300" title="dealer">◆</span>}
        {status && <SeatStatusBadge status={status} />}
      </div>
      <div className="flex gap-px">
        {Array.from({ length: view.handCounts[seat] }, (_, i) => (
          <TileView key={i} tile={null} size="sm" />
        ))}
      </div>
      <MeldRow melds={view.melds[seat]} numbered={numbered} />
      <BonusRow tiles={view.bonus[seat]} />
    </div>
  )
}

export function DiscardPool({ view, seat, numbered }: { view: PlayerView; seat: Seat; numbered: boolean }) {
  const tiles = view.discards[seat]
  const pending = view.pendingDiscard?.from === seat ? view.pendingDiscard.tile : null
  return (
    <div className="min-h-9 w-44 flex flex-wrap gap-0.5 content-start justify-center">
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
