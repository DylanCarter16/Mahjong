// The multiplayer table (§7) — the same responsive TableLayout as solo, so the
// two never drift. Multiplayer adds real names, per-seat connection status, a
// claim-window countdown on the claim buttons, and the reconnecting overlay.

import { useEffect, useMemo, useState } from 'react'
import { evalMyDiscards } from './aids'
import type { Action, PlayerView } from '../engine/game'
import type { Seat } from '../engine/types'
import type { RoomInfo, MatchInfo } from '../room/protocol'
import type { FinishedInfo } from './useGame'
import type { ConnStatus } from '../net/RemoteRoom'
import { ActionBar } from './ActionBar'
import { ReconnectingOverlay } from './ReconnectingOverlay'
import { TableLayout } from './TableLayout'
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
  coachSlot?: React.ReactNode
  onDiscard: (tile: string) => void
  onAction: (a: Action) => void
  onNewRound: () => void
  onLeave: () => void
}) {
  const me = view.seat
  const label = (seat: Seat) =>
    room.seats[seat].name ?? (room.seats[seat].kind === 'bot' ? 'Bot' : `Seat ${seat}`)
  const isHost = room.hostSeat === me
  const myDiscardTurn = view.phase === 'discard' && view.turn === me

  // The win dialog covers the whole table, including the coach panel below it.
  // Solo has always been able to dismiss it; multiplayer passed a no-op onClose,
  // so "review the table first" did nothing and the round review was
  // unreachable — you could only start the next round. Same dismiss state here.
  const [resultDismissed, setResultDismissed] = useState(false)
  const phase = view.phase
  useEffect(() => {
    if (phase !== 'finished') setResultDismissed(false)
  }, [phase])

  const evals = useMemo(
    () => (beginnerAids && myDiscardTurn ? evalMyDiscards(view) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [view, beginnerAids, myDiscardTurn],
  )
  const claimResetKey = `${view.pendingDiscard?.from ?? ''}:${view.pendingDiscard?.tile ?? ''}`

  return (
    <TableLayout
      view={view}
      me={me}
      numbered={numbered}
      seatLabel={label}
      seatStatus={(s) => room.seats[s].status}
      evals={evals}
      onDiscard={myDiscardTurn ? onDiscard : undefined}
      header={
        <header className="flex items-center justify-between gap-2 px-4 py-2">
          <button
            className="min-h-11 shrink-0 rounded-lg px-3 py-1.5 text-sm text-emerald-200 hover:bg-emerald-800 cursor-pointer"
            onClick={onLeave}
          >
            ← Leave
          </button>
          <div className="text-right text-xs text-emerald-200/80 sm:text-sm">
            Round {match.roundNo} · {view.roundWind} · min {view.faanMinimum} · room {room.code}
          </div>
        </header>
      }
      actionBar={
        <ActionBar
          view={view}
          onAction={onAction}
          seatLabel={label}
          claimCountdown={{ durationMs: room.rules.claimWindowSec * 1000, resetKey: claimResetKey }}
        />
      }
      coachSlot={coachSlot}
    >
      {finished && resultDismissed && (
        <div className="flex justify-center pb-6">
          <button
            className="min-h-11 rounded-lg bg-emerald-800 px-4 py-2 text-sm text-emerald-100 hover:bg-emerald-700 cursor-pointer disabled:opacity-40"
            onClick={onNewRound}
            disabled={!isHost}
            title={isHost ? '' : 'The host starts the next round'}
          >
            {isHost ? 'Next round →' : 'Waiting for host…'}
          </button>
        </div>
      )}
      {finished && !resultDismissed && (
        <WinDialog
          result={finished.result}
          match={match}
          seatLabel={label}
          youSeat={me}
          onNewRound={onNewRound}
          canStartNextRound={isHost}
          onClose={() => setResultDismissed(true)}
        />
      )}
      <ReconnectingOverlay status={status} detail={statusDetail} onLeave={onLeave} />
    </TableLayout>
  )
}
