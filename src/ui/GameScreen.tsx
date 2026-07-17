import { useEffect, useMemo, useState } from 'react'
import { AnalysisPanel } from '../analysis/AnalysisPanel'
import { evalMyDiscards } from './aids'
import { ActionBar } from './ActionBar'
import { SEAT_NAMES } from './panels'
import { SettingsPanel } from './SettingsPanel'
import { TableLayout } from './TableLayout'
import { HUMAN, useGame, type Settings } from './useGame'
import { WinDialog } from './WinDialog'

export function GameScreen({ settings, onChangeSettings }: {
  settings: Settings
  onChangeSettings: (s: Settings) => void
}) {
  const { view, match, finished, dispatch, newRound } = useGame(settings)
  const [showSettings, setShowSettings] = useState(false)
  const [resultDismissed, setResultDismissed] = useState(false)

  const phase = view?.phase
  useEffect(() => {
    if (phase !== 'finished') setResultDismissed(false)
  }, [phase])

  const myDiscardTurn = view !== null && view.phase === 'discard' && view.turn === HUMAN
  const evals = useMemo(
    () => (view && settings.beginnerAids && myDiscardTurn ? evalMyDiscards(view) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [view, settings.beginnerAids, myDiscardTurn],
  )

  // First view arrives synchronously on mount; this only guards the types.
  if (!view) return null

  return (
    <>
      <TableLayout
        view={view}
        me={HUMAN}
        numbered={settings.numberedTiles}
        seatLabel={(s) => SEAT_NAMES[s]}
        evals={evals}
        onDiscard={myDiscardTurn ? (tile) => dispatch({ type: 'discard', seat: HUMAN, tile }) : undefined}
        header={
          <header className="flex items-center justify-between px-4 py-2">
            <div className="text-sm text-emerald-200/80">
              Round {match.roundNo} · {view.roundWind} round · min {view.faanMinimum} faan
            </div>
            <button
              className="min-h-11 rounded-lg bg-emerald-800 px-3 py-1.5 text-sm hover:bg-emerald-700 cursor-pointer"
              onClick={() => setShowSettings(true)}
            >
              ⚙ Settings
            </button>
          </header>
        }
        actionBar={<ActionBar view={view} onAction={dispatch} />}
        coachSlot={<AnalysisPanel view={view} finished={finished} byoKey={settings.byoKey || undefined} />}
      >
        {view.phase === 'finished' && resultDismissed && (
          <div className="flex justify-center pb-6">
            <button
              className="min-h-11 rounded-lg bg-amber-400 px-4 py-2 font-semibold text-amber-950 hover:bg-amber-300 cursor-pointer"
              onClick={newRound}
            >
              Next round →
            </button>
          </div>
        )}
        {finished && !resultDismissed && (
          <WinDialog
            result={finished.result}
            match={match}
            onNewRound={newRound}
            onClose={() => setResultDismissed(true)}
          />
        )}
      </TableLayout>
      {showSettings && (
        <SettingsPanel settings={settings} onChange={onChangeSettings} onClose={() => setShowSettings(false)} />
      )}
    </>
  )
}
