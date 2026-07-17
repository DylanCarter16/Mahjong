// The shared, responsive table (Phase 1.5 §5.5 — portrait-first). Used by both
// solo and multiplayer so the two never drift. Same felt, same tiles, same
// tokens — no new visual language; this is purely layout.
//
//   < md  (phones/portrait): a vertical STACK — opponents in a compact row,
//         every seat's discard pool shown labeled in a 2×2 grid (kept per-seat
//         distinguishable, never merged — discard reading is the whole point),
//         then your hand wrapping to two rows of 44px-tap tiles.
//   ≥ md  (tablets/desktop): the four-seat felt CROSS, opponents around the
//         central discard cross and wall counter.
//
// Both orientations work: the page only ever scrolls vertically, never
// sideways, at any width.

import { nextSeat, type Seat } from '../engine/types'
import type { PlayerView } from '../engine/game'
import type { SeatStatus } from '../room/protocol'
import type { DiscardEval } from './aids'
import { BonusRow, DiscardPool, MeldRow, SeatStatusBadge } from './panels'
import { TileView } from './TileView'

const WIND_NAME: Record<string, string> = { E: 'East', S: 'South', W: 'West', N: 'North' }

export interface TableLayoutProps {
  view: PlayerView
  me: Seat
  numbered: boolean
  seatLabel: (seat: Seat) => string
  /** Multiplayer connection state; solo passes undefined (no badge). */
  seatStatus?: (seat: Seat) => SeatStatus
  /** Beginner-aid discard evaluations for the hand (empty to disable). */
  evals: DiscardEval[]
  /** Present only when it's your turn to discard. */
  onDiscard?: (tile: string) => void
  header: React.ReactNode
  actionBar: React.ReactNode
  coachSlot?: React.ReactNode
  /** Overlays (win dialog, reconnecting cover). */
  children?: React.ReactNode
}

export function TableLayout(props: TableLayoutProps) {
  const { view, me, numbered } = props
  const right = nextSeat(me)
  const top = nextSeat(right)
  const left = nextSeat(top)
  const dealerSeat = ([0, 1, 2, 3] as const).find((s) => view.seatWinds[s] === 'E')!

  const opp = (seat: Seat) => (
    <OppCard
      view={view}
      seat={seat}
      numbered={numbered}
      dealer={dealerSeat === seat}
      label={props.seatLabel(seat)}
      status={props.seatStatus?.(seat)}
    />
  )
  const discardCard = (seat: Seat, labelled: boolean) => (
    <div className="flex flex-col items-center gap-1">
      {labelled && (
        <span className="text-[0.65rem] text-emerald-300/70">
          {props.seatLabel(seat)} · {view.seatWinds[seat]}
        </span>
      )}
      <DiscardPool view={view} seat={seat} numbered={numbered} />
    </div>
  )

  const wall = (
    <div className="grid place-items-center rounded-2xl bg-emerald-950/70 px-5 py-3 text-center">
      <div className="text-2xl font-bold tabular text-emerald-50 md:text-3xl">{view.wallCount}</div>
      <div className="text-[0.65rem] text-emerald-300/70">tiles left</div>
    </div>
  )

  return (
    <div className="flex flex-col gap-3 items-stretch">
      {props.header}

      {/* ---- STACK (phones / portrait, < md) ---- */}
      <div className="flex flex-col gap-3 px-2 md:hidden">
        <div className="flex flex-wrap justify-center gap-2">
          {opp(left)}
          {opp(top)}
          {opp(right)}
        </div>
        <div className="flex justify-center">{wall}</div>
        <div className="grid grid-cols-2 gap-2">
          {discardCard(top, true)}
          {discardCard(right, true)}
          {discardCard(left, true)}
          {discardCard(me, true)}
        </div>
      </div>

      {/* ---- CROSS (tablet / desktop, ≥ md) ---- */}
      <div className="hidden md:flex md:flex-col md:items-stretch md:gap-3">
        <div className="flex justify-center">{opp(top)}</div>
        <div className="flex items-center justify-center gap-4">
          {opp(left)}
          <div className="grid grid-cols-[11rem_auto_11rem] grid-rows-[auto_auto_auto] place-items-center gap-2 rounded-3xl bg-emerald-800/40 p-4 shadow-inner">
            <div />
            {discardCard(top, false)}
            <div />
            {discardCard(left, false)}
            {wall}
            {discardCard(right, false)}
            <div />
            {discardCard(me, false)}
            <div />
          </div>
          {opp(right)}
        </div>
      </div>

      {/* ---- YOUR AREA (shared) ---- */}
      <div className="flex flex-col items-center gap-2 px-2 pb-6">
        <div className="flex flex-wrap items-center justify-center gap-2 text-sm text-emerald-100/90">
          <span className="font-medium">{props.seatLabel(me)}</span> · {WIND_NAME[view.seatWind]}
          {dealerSeat === me && <span className="text-amber-300" title="dealer">◆</span>}
          <MeldRow melds={view.melds[me]} numbered={numbered} />
          <BonusRow tiles={view.bonus[me]} />
        </div>
        <div className="flex max-w-full flex-wrap justify-center gap-1">
          {view.concealed.map((t, i) => {
            const e = props.evals.find((x) => x.tile === t)
            const title = e
              ? `${e.suggested ? 'Suggested discard — ' : ''}discarding leaves ${
                  e.shantenAfter === -1 ? 'a winning hand' : `${e.shantenAfter} shanten`
                }, ${e.ukeire} live tiles`
              : undefined
            return (
              <TileView
                key={`${t}-${i}`}
                tile={t}
                size="hand"
                numbered={numbered}
                ring={e?.suggested ? 'suggest' : undefined}
                title={title}
                onClick={props.onDiscard ? () => props.onDiscard!(t) : undefined}
              />
            )
          })}
        </div>
        {props.actionBar}
        {props.coachSlot}
      </div>

      {props.children}
    </div>
  )
}

/** Compact opponent card: works in the stack (3 across) and the cross (sides).
 * Overlapped backs keep a hand of tiles legible without eating a phone's width;
 * the exact concealed count rides alongside. */
function OppCard({
  view,
  seat,
  numbered,
  dealer,
  label,
  status,
}: {
  view: PlayerView
  seat: Seat
  numbered: boolean
  dealer: boolean
  label: string
  status?: SeatStatus
}) {
  const active = view.turn === seat && view.phase !== 'finished'
  const count = view.handCounts[seat]
  const backs = Math.min(count, 6)
  return (
    <div className={`flex min-w-24 flex-col items-center gap-1 rounded-xl p-2 ${active ? 'bg-emerald-800/70 shadow-lg' : ''}`}>
      <div className="flex max-w-full flex-wrap items-center justify-center gap-1 text-xs font-medium text-emerald-100/90">
        <span className="max-w-24 truncate">{label}</span>
        <span className="text-emerald-300/70">{view.seatWinds[seat]}</span>
        {dealer && <span className="text-amber-300" title="dealer">◆</span>}
        {status && <SeatStatusBadge status={status} />}
      </div>
      <div className="flex items-center gap-1">
        <div className="flex -space-x-4">
          {Array.from({ length: backs }, (_, i) => (
            <TileView key={i} tile={null} size="sm" />
          ))}
        </div>
        <span className="text-[0.65rem] tabular text-emerald-300/70">{count}</span>
      </div>
      <MeldRow melds={view.melds[seat]} numbered={numbered} />
      <BonusRow tiles={view.bonus[seat]} />
    </div>
  )
}
