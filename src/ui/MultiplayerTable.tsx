// The multiplayer table (§7). Same felt, same tiles, same ActionBar as solo —
// no new visual language. The one structural difference from the solo screen
// is that the layout is viewer-relative: YOU are always at the bottom and the
// other three seats rotate around you, since in a room you may hold any seat.
// Real names and per-seat connection status come from RoomInfo; the claim
// window gets a depleting countdown ring on the claim buttons.

import { useMemo } from 'react'
import { evalMyDiscards } from './aids'
import type { Action, PlayerView } from '../engine/game'
import { nextSeat, type Seat } from '../engine/types'
import type { RoomInfo, MatchInfo } from '../room/protocol'
import type { FinishedInfo } from './useGame'
import type { ConnStatus } from '../net/RemoteRoom'
import { ActionBar } from './ActionBar'
import { BonusRow, DiscardPool, MeldRow, OpponentPanel } from './panels'
import { ReconnectingOverlay } from './ReconnectingOverlay'
import { TileView } from './TileView'
import { WinDialog } from './WinDialog'

export function MultiplayerTable({
  view,
  match,
  finished,
  room,
  status,
  statusDetail,
  numbered,
  beginnerAids,
  coachSlot,
  onDiscard,
  onAction,
  onNewRound,
  onLeave,
}: {
  view: PlayerView
  match: MatchInfo
  finished: FinishedInfo | null
  room: RoomInfo
  status: ConnStatus
  statusDetail?: string
  numbered: boolean
  beginnerAids: boolean
  /** The coach panel (wired with per-room policy in Phase 8). */
  coachSlot?: React.ReactNode
  onDiscard: (tile: string) => void
  onAction: (a: Action) => void
  onNewRound: () => void
  onLeave: () => void
}) {
  const me = view.seat
  // Viewer-relative arrangement: you at the bottom, others counter-clockwise.
  const right = nextSeat(me)
  const top = nextSeat(right)
  const left = nextSeat(top)

  const label = (seat: Seat) => room.seats[seat].name ?? (room.seats[seat].kind === 'bot' ? 'Bot' : `Seat ${seat}`)
  const seatStatus = (seat: Seat) => room.seats[seat].status
  const dealerSeat = ([0, 1, 2, 3] as const).find((s) => view.seatWinds[s] === 'E')!
  const isHost = room.hostSeat === me

  const myDiscardTurn = view.phase === 'discard' && view.turn === me
  const evals = useMemo(
    () => (beginnerAids && myDiscardTurn ? evalMyDiscards(view) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [view, beginnerAids, myDiscardTurn],
  )
  const evalFor = (tile: string) => evals.find((e) => e.tile === tile)

  const claimResetKey = `${view.pendingDiscard?.from ?? ''}:${view.pendingDiscard?.tile ?? ''}`

  const opponent = (seat: Seat) => (
    <OpponentPanel
      view={view}
      seat={seat}
      numbered={numbered}
      dealerSeat={dealerSeat}
      label={label(seat)}
      status={seatStatus(seat)}
    />
  )

  return (
    <div className="flex flex-col gap-3 items-stretch">
      <header className="flex items-center justify-between px-4 py-2">
        <button
          className="min-h-11 rounded-lg px-3 py-1.5 text-sm text-emerald-200 hover:bg-emerald-800 cursor-pointer"
          onClick={onLeave}
        >
          ← Leave
        </button>
        <div className="text-sm text-emerald-200/80">
          Round {match.roundNo} · {view.roundWind} · min {view.faanMinimum} faan · room {room.code}
        </div>
      </header>

      <div className="flex justify-center">{opponent(top)}</div>

      <div className="flex items-center justify-center gap-4">
        {opponent(left)}

        <div className="grid grid-cols-[11rem_auto_11rem] grid-rows-[auto_auto_auto] place-items-center gap-2 rounded-3xl bg-emerald-800/40 p-4 shadow-inner">
          <div />
          <DiscardPool view={view} seat={top} numbered={numbered} />
          <div />
          <DiscardPool view={view} seat={left} numbered={numbered} />
          <div className="grid place-items-center rounded-2xl bg-emerald-950/70 px-6 py-4 text-center">
            <div className="text-3xl font-bold tabular text-emerald-50">{view.wallCount}</div>
            <div className="text-xs text-emerald-300/70">tiles left</div>
          </div>
          <DiscardPool view={view} seat={right} numbered={numbered} />
          <div />
          <DiscardPool view={view} seat={me} numbered={numbered} />
          <div />
        </div>

        {opponent(right)}
      </div>

      {/* Your area. */}
      <div className="flex flex-col items-center gap-2 pb-6">
        <div className="flex items-center gap-3 text-sm text-emerald-100/90">
          {label(me)} · {view.seatWind}
          {dealerSeat === me && <span className="text-amber-300" title="dealer">◆</span>}
          <MeldRow melds={view.melds[me]} numbered={numbered} />
          <BonusRow tiles={view.bonus[me]} />
        </div>
        <div className="flex gap-1 flex-wrap justify-center">
          {view.concealed.map((t, i) => {
            const e = evalFor(t)
            const title = e
              ? `${e.suggested ? 'Suggested discard — ' : ''}discarding leaves ${
                  e.shantenAfter === -1 ? 'a winning hand' : `${e.shantenAfter} shanten`
                }, ${e.ukeire} live tiles`
              : undefined
            return (
              <TileView
                key={`${t}-${i}`}
                tile={t}
                size="lg"
                numbered={numbered}
                ring={e?.suggested ? 'suggest' : undefined}
                title={title}
                onClick={myDiscardTurn ? () => onDiscard(t) : undefined}
              />
            )
          })}
        </div>
        <ActionBar
          view={view}
          onAction={onAction}
          seatLabel={label}
          claimCountdown={{ durationMs: room.rules.claimWindowSec * 1000, resetKey: claimResetKey }}
        />
        {coachSlot}
        {finished && (
          <button
            className="min-h-11 rounded-lg bg-emerald-800 px-4 py-2 text-sm text-emerald-100 hover:bg-emerald-700 cursor-pointer disabled:opacity-40"
            onClick={onNewRound}
            disabled={!isHost}
            title={isHost ? '' : 'The host starts the next round'}
          >
            {isHost ? 'Next round →' : 'Waiting for host…'}
          </button>
        )}
      </div>

      {finished && (
        <WinDialog
          result={finished.result}
          match={match}
          seatLabel={label}
          youSeat={me}
          onNewRound={isHost ? onNewRound : () => {}}
          onClose={() => {}}
        />
      )}
      <ReconnectingOverlay status={status} detail={statusDetail} onLeave={onLeave} />
    </div>
  )
}
