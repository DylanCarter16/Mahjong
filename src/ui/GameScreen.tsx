import { useEffect, useMemo, useState } from 'react'
import { AnalysisPanel } from '../analysis/AnalysisPanel'
import { evalMyDiscards } from './aids'
import { ActionBar } from './ActionBar'
import { BonusRow, DiscardPool, MeldRow, OpponentPanel, SEAT_NAMES } from './panels'
import { SettingsPanel } from './SettingsPanel'
import { TileView } from './TileView'
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
  const evalFor = (tile: string) => evals.find((e) => e.tile === tile)

  // First view arrives synchronously on mount; this only guards the types.
  if (!view) return null

  const dealerSeat = ([0, 1, 2, 3] as const).find((s) => view.seatWinds[s] === 'E')!

  return (
    <div className="flex flex-col gap-3 items-stretch">
      <header className="flex items-center justify-between px-4 py-2">
        <div className="text-sm text-emerald-200/80">
          Round {match.roundNo} · {view.roundWind} round · min {view.faanMinimum} faan
        </div>
        <button
          className="rounded-lg bg-emerald-800 px-3 py-1.5 text-sm hover:bg-emerald-700 cursor-pointer"
          onClick={() => setShowSettings(true)}
        >
          ⚙ Settings
        </button>
      </header>

      {/* West bot across the table */}
      <div className="flex justify-center">
        <OpponentPanel view={view} seat={2} numbered={settings.numberedTiles} dealerSeat={dealerSeat} />
      </div>

      <div className="flex items-center justify-center gap-4">
        {/* North bot on the left */}
        <OpponentPanel view={view} seat={3} numbered={settings.numberedTiles} dealerSeat={dealerSeat} />

        {/* Discard cross with the wall counter in the middle */}
        <div className="grid grid-cols-[11rem_auto_11rem] grid-rows-[auto_auto_auto] place-items-center gap-2 rounded-3xl bg-emerald-800/40 p-4 shadow-inner">
          <div />
          <DiscardPool view={view} seat={2} numbered={settings.numberedTiles} />
          <div />
          <DiscardPool view={view} seat={3} numbered={settings.numberedTiles} />
          <div className="grid place-items-center rounded-2xl bg-emerald-950/70 px-6 py-4 text-center">
            <div className="text-3xl font-bold font-mono text-emerald-50">{view.wallCount}</div>
            <div className="text-xs text-emerald-300/70">tiles left</div>
          </div>
          <DiscardPool view={view} seat={1} numbered={settings.numberedTiles} />
          <div />
          <DiscardPool view={view} seat={0} numbered={settings.numberedTiles} />
          <div />
        </div>

        {/* South bot on the right */}
        <OpponentPanel view={view} seat={1} numbered={settings.numberedTiles} dealerSeat={dealerSeat} />
      </div>

      {/* My area */}
      <div className="flex flex-col items-center gap-2 pb-6">
        <div className="flex items-center gap-3 text-sm text-emerald-100/90">
          {SEAT_NAMES[0]} · {view.seatWind}
          {dealerSeat === 0 && <span className="text-amber-300" title="dealer">◆</span>}
          <MeldRow melds={view.melds[0]} numbered={settings.numberedTiles} />
          <BonusRow tiles={view.bonus[0]} />
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
                numbered={settings.numberedTiles}
                ring={e?.suggested ? 'suggest' : undefined}
                title={title}
                onClick={myDiscardTurn ? () => dispatch({ type: 'discard', seat: HUMAN, tile: t }) : undefined}
              />
            )
          })}
        </div>
        <ActionBar view={view} onAction={dispatch} />
        <AnalysisPanel view={view} finished={finished} byoKey={settings.byoKey || undefined} />
        {view.phase === 'finished' && resultDismissed && (
          <button
            className="rounded-lg bg-amber-400 px-4 py-2 font-semibold text-amber-950 hover:bg-amber-300 cursor-pointer"
            onClick={newRound}
          >
            Next round →
          </button>
        )}
      </div>

      {finished && !resultDismissed && (
        <WinDialog result={finished.result} match={match} onNewRound={newRound} onClose={() => setResultDismissed(true)} />
      )}
      {showSettings && (
        <SettingsPanel settings={settings} onChange={onChangeSettings} onClose={() => setShowSettings(false)} />
      )}
    </div>
  )
}
