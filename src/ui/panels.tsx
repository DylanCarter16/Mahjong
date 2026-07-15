// Table furniture: opponent panels, discard pools, meld rows.

import type { PlayerView } from '../engine/game'
import type { Meld, Seat, TileId } from '../engine/types'
import { TileView } from './TileView'

export const SEAT_NAMES: Record<Seat, string> = { 0: 'You', 1: 'South Bot', 2: 'West Bot', 3: 'North Bot' }

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

export function OpponentPanel({ view, seat, numbered, dealerSeat }: {
  view: PlayerView
  seat: Seat
  numbered: boolean
  dealerSeat: Seat
}) {
  const active = view.turn === seat && view.phase !== 'finished'
  return (
    <div className={`flex flex-col items-center gap-1.5 p-2 rounded-xl ${active ? 'bg-emerald-800/70 shadow-lg' : ''}`}>
      <div className="text-sm font-medium text-emerald-100/90">
        {SEAT_NAMES[seat]} · {view.seatWinds[seat]}
        {dealerSeat === seat && <span className="ml-1 text-amber-300" title="dealer">◆</span>}
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
