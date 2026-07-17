// Ties the multiplayer hook to the lobby and table (§7). Routes on room phase:
// connecting → lobby → playing, with a calm card for the not-yet-connected and
// fatal-error states. Solo is untouched and still fully offline; this screen is
// only mounted when the player chose Create or Join.

import { AnalysisPanel } from '../analysis/AnalysisPanel'
import { useRoom, type JoinOptions } from '../net/useRoom'
import { LobbyScreen } from './LobbyScreen'
import { MultiplayerTable } from './MultiplayerTable'
import type { Settings } from './useGame'

export function MultiplayerScreen({
  join,
  settings,
  onLeave,
}: {
  join: JoinOptions
  settings: Settings
  onLeave: () => void
}) {
  const room = useRoom(join)
  const { state } = room
  const leave = () => {
    room.leave()
    onLeave()
  }

  if (state.error) {
    return (
      <Card title="Couldn't join">
        <p className="text-sm text-emerald-200/80">{state.error}</p>
        <LeaveButton onLeave={leave} label="Back to menu" />
      </Card>
    )
  }

  if (!state.room || state.you === null) {
    return (
      <Card title={join.mode === 'create' ? 'Creating room…' : 'Joining room…'}>
        <Spinner />
        <LeaveButton onLeave={leave} />
      </Card>
    )
  }

  if (state.room.phase === 'lobby') {
    return (
      <LobbyScreen
        room={state.room}
        you={state.you}
        onSetSeatKind={room.setSeatKind}
        onSetRules={room.setRules}
        onStart={room.start}
        onLeave={leave}
      />
    )
  }

  // Playing — but the first view may not have arrived on the very first frame.
  if (!state.view || !state.match) {
    return (
      <Card title="Dealing…">
        <Spinner />
      </Card>
    )
  }

  const you = state.you
  const coachSlot = state.room.rules.coachAllowed ? (
    <AnalysisPanel view={state.view} finished={state.finished} byoKey={settings.byoKey || undefined} />
  ) : (
    <p className="max-w-2xl rounded-lg border border-emerald-800 bg-emerald-900/40 p-2 text-center text-xs text-emerald-300/60">
      The AI coach is turned off for this room. The local ranked-discard hints still show on your turn.
    </p>
  )

  return (
    <MultiplayerTable
      view={state.view}
      match={state.match}
      finished={state.finished}
      room={state.room}
      status={state.status}
      statusDetail={state.statusDetail}
      numbered={settings.numberedTiles}
      beginnerAids={settings.beginnerAids}
      coachSlot={coachSlot}
      onDiscard={(tile) => room.dispatch({ type: 'discard', seat: you, tile })}
      onAction={room.dispatch}
      onNewRound={room.newRound}
      onLeave={leave}
    />
  )
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto mt-16 flex max-w-sm flex-col items-center gap-4 rounded-2xl border border-emerald-700 bg-emerald-900/60 p-8 text-center text-emerald-50">
      <h2 className="text-lg font-bold">{title}</h2>
      {children}
    </div>
  )
}

function Spinner() {
  return <div className="h-8 w-8 animate-spin rounded-full border-2 border-emerald-600 border-t-amber-300 motion-reduce:animate-none" />
}

function LeaveButton({ onLeave, label = 'Cancel' }: { onLeave: () => void; label?: string }) {
  return (
    <button
      className="min-h-11 rounded-lg bg-emerald-800 px-4 py-2 text-sm text-emerald-100 hover:bg-emerald-700 cursor-pointer"
      onClick={onLeave}
    >
      {label}
    </button>
  )
}
