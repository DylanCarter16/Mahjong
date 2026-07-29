// Ties the multiplayer hook to the lobby and table (§7). Routes on room phase:
// connecting → lobby → playing, with a calm card for the not-yet-connected and
// fatal-error states. Solo is untouched and still fully offline; this screen is
// only mounted when the player chose Create or Join.

import { useState } from 'react'
import { AnalysisPanel } from '../analysis/AnalysisPanel'
import { useRoom, type JoinOptions } from '../net/useRoom'
import { LobbyScreen } from './LobbyScreen'
import { MultiplayerTable } from './MultiplayerTable'
import { SettingsPanel } from './SettingsPanel'
import type { Settings } from './useGame'

export function MultiplayerScreen({
  join,
  settings,
  onChangeSettings,
  onLeave,
}: {
  join: JoinOptions
  settings: Settings
  onChangeSettings: (s: Settings) => void
  onLeave: () => void
}) {
  const room = useRoom(join)
  const { state } = room
  const [showSettings, setShowSettings] = useState(false)
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
        byoKeySlot={<ByoKeyField settings={settings} onChange={onChangeSettings} />}
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
  // Two independent gates (§B3). The house rule decides whether MODEL calls are
  // allowed at all; the aids — engine-computed, free, no request — are gated by
  // the room's own aid rule. When both are off the panel renders nothing rather
  // than a launcher that opens an empty box.
  //
  // The personal toggle is a third, narrower thing: it governs the ring
  // overlays drawn on your tiles unasked, which is why it can be off (its
  // default) while the panel you deliberately opened still shows its table.
  const aidsAllowedByHost = state.room.rules.beginnerAidsAllowed
  const aidsOn = settings.beginnerAids && aidsAllowedByHost
  const coachSlot = (
    <AnalysisPanel
      view={state.view}
      finished={state.finished}
      byoKey={settings.byoKey || undefined}
      roomCode={state.room.code}
      coachEnabled={state.room.rules.coachAllowed}
      aidsEnabled={aidsAllowedByHost}
    />
  )

  return (
    <>
      <MultiplayerTable
        view={state.view}
        match={state.match}
        finished={state.finished}
        room={state.room}
        status={state.status}
        statusDetail={state.statusDetail}
        numbered={settings.numberedTiles}
        beginnerAids={aidsOn}
        coachSlot={coachSlot}
        onDiscard={(tile) => room.dispatch({ type: 'discard', seat: you, tile })}
        onAction={room.dispatch}
        onNewRound={room.newRound}
        onLeave={leave}
        onOpenSettings={() => setShowSettings(true)}
      />
      {showSettings && (
        <SettingsPanel
          settings={settings}
          onChange={onChangeSettings}
          onClose={() => setShowSettings(false)}
          scope="multiplayer"
          aidsAllowedByHost={aidsAllowedByHost}
        />
      )}
    </>
  )
}

/** BYO-key control, surfaced in the lobby (§9) — memory only, never stored. */
function ByoKeyField({ settings, onChange }: { settings: Settings; onChange: (s: Settings) => void }) {
  return (
    <section aria-label="Your API key" className="rounded-2xl border border-emerald-800 bg-emerald-900/40 p-3">
      <label htmlFor="lobby-byo" className="block text-sm font-medium text-emerald-100">
        Use your own Anthropic key <span className="text-emerald-400/60">(optional)</span>
      </label>
      <p className="mt-0.5 text-xs text-emerald-300/60">
        The coach spends the host's shared budget by default. Paste your own key to skip the room's
        limit — it stays in this tab's memory only, never saved or sent to the game server.
      </p>
      <input
        id="lobby-byo"
        type="password"
        autoComplete="off"
        placeholder="sk-ant-…  (held in memory only)"
        value={settings.byoKey}
        onChange={(e) => onChange({ ...settings, byoKey: e.target.value })}
        className="mt-2 min-h-11 w-full rounded-lg border border-emerald-600 bg-emerald-800 px-3 py-2 font-mono text-sm"
      />
    </section>
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
