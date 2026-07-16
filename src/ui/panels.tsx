// Table furniture: seat strips, oriented discard pools, meld rows, wall ring.
// The seat IS the label (wind character + dealer mark + glow on turn) —
// no "West Bot" boxes. Discards run 6 per row in draw order, in front of
// their seat, oriented toward it: that layout is how you learn to read.

import type { PlayerView } from '../engine/game'
import { WIND_CHARS } from './tiles/layouts'
import type { Meld, Seat, TileId } from '../engine/types'
import { DealerIcon } from './icons'
import { TileView } from './TileView'

export const SEAT_NAMES: Record<Seat, string> = { 0: 'You', 1: 'South', 2: 'West', 3: 'North' }

export function MeldRow({ melds, numbered, small = false }: { melds: Meld[]; numbered: boolean; small?: boolean }) {
  if (melds.length === 0) return null
  return (
    <div className="flex flex-wrap gap-1.5">
      {melds.map((m, i) => (
        <div key={i} className="flex gap-px">
          {m.tiles.length === 0
            ? [0, 1, 2, 3].map((j) => <TileView key={j} tile={null} size={small ? 'xs' : 'sm'} />)
            : m.tiles.map((t, j) => <TileView key={j} tile={t} size={small ? 'xs' : 'sm'} numbered={numbered} />)}
        </div>
      ))}
    </div>
  )
}

export function BonusRow({ tiles, small = false }: { tiles: TileId[]; small?: boolean }) {
  if (tiles.length === 0) return null
  return (
    <div className="flex gap-px">
      {tiles.map((t, i) => (
        <TileView key={i} tile={t} size={small ? 'xs' : 'sm'} />
      ))}
    </div>
  )
}

/** An opponent's seat: wind mark, hidden hand, melds, bonus. Glows on turn. */
export function SeatStrip({ view, seat, numbered, dealerSeat }: {
  view: PlayerView
  seat: Seat
  numbered: boolean
  dealerSeat: Seat
}) {
  const active = view.turn === seat && view.phase !== 'finished'
  return (
    <div
      className={`flex flex-col items-center gap-1.5 rounded-2xl px-3 py-2 transition-shadow duration-(--duration-ui) ${
        active ? 'seat-breathe' : ''
      }`}
      aria-label={`${SEAT_NAMES[seat]}, ${view.seatWinds[seat]} seat${active ? ', playing now' : ''}`}
    >
      <div className="flex items-center gap-1.5">
        <span
          className={`text-xl leading-none ${active ? 'text-accent' : 'text-parchment-dim'}`}
          style={{ fontFamily: 'var(--font-tiles)' }}
        >
          {WIND_CHARS[view.seatWinds[seat]]}
        </span>
        {dealerSeat === seat && <DealerIcon className="h-3 w-3 text-accent" />}
      </div>
      <div className="flex max-w-40 flex-wrap justify-center gap-px">
        {Array.from({ length: view.handCounts[seat] }, (_, i) => (
          <TileView key={i} tile={null} size="xs" />
        ))}
      </div>
      <MeldRow melds={view.melds[seat]} numbered={numbered} small />
      <BonusRow tiles={view.bonus[seat]} small />
    </div>
  )
}

/** Discards: 6 per row, draw order; the newest settles with a one-beat ring. */
export function DiscardPool({ view, seat, numbered }: { view: PlayerView; seat: Seat; numbered: boolean }) {
  const tiles = view.discards[seat]
  const pending = view.pendingDiscard?.from === seat ? view.pendingDiscard.tile : null
  return (
    <div className="grid w-fit grid-cols-6 content-start gap-1" aria-label={`${SEAT_NAMES[seat]} discards`}>
      {tiles.map((t, i) => {
        const newest = i === tiles.length - 1 && pending === null
        return (
          <div key={`${i}-${t}`} className={newest ? 'tile-settle discard-beat' : ''}>
            <TileView tile={t} size="sm" numbered={numbered} />
          </div>
        )
      })}
      {pending && (
        <div className="tile-settle">
          <TileView tile={pending} size="sm" numbered={numbered} state="highlighted" />
        </div>
      )}
    </div>
  )
}

/** The wall as a thin, quiet depletion ring — glanceable, never loud. */
export function WallRing({ live, total, roundWind, faanMinimum }: {
  live: number
  total: number
  roundWind: string
  faanMinimum: number
}) {
  const C = 2 * Math.PI * 45
  const frac = Math.max(0, Math.min(1, live / total))
  return (
    <div className="relative grid h-32 w-32 place-items-center">
      <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
        <circle cx="50" cy="50" r="45" fill="none" stroke="var(--color-felt-line)" strokeWidth="2.5" opacity="0.6" />
        <circle
          cx="50"
          cy="50"
          r="45"
          fill="none"
          stroke="var(--color-parchment-dim)"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray={`${C * frac} ${C}`}
          className="transition-[stroke-dasharray] duration-(--duration-settle)"
        />
      </svg>
      <div className="absolute text-center">
        <div className="tabular font-serif text-2xl font-semibold text-parchment">{live}</div>
        <div className="text-[0.6rem] uppercase tracking-widest text-parchment-dim">
          {roundWind} round · min {faanMinimum}
        </div>
      </div>
    </div>
  )
}
