import { useEffect, useMemo, useState } from 'react'
import { AnalysisPanel } from '../analysis/AnalysisPanel'
import { evalMyDiscards } from './aids'
import { ActionBar } from './ActionBar'
import { SlidersIcon } from './icons'
import { BonusRow, DiscardPool, MeldRow, SeatStrip, WallRing } from './panels'
import { SettingsPanel } from './SettingsPanel'
import { WIND_CHARS } from './tiles/layouts'
import { TileView } from './TileView'
import { HUMAN, useGame, type Settings } from './useGame'
import { WinDialog } from './WinDialog'
import { DealerIcon } from './icons'

/** Live tiles at deal time: full wall minus the 53 dealt minus the dead 14. */
const initialLive = (flowers: boolean) => (flowers ? 144 : 136) - 53 - 14

export function GameScreen({ settings, onChangeSettings }: {
  settings: Settings
  onChangeSettings: (s: Settings) => void
}) {
  const { state, view, match, dispatch, newRound } = useGame(settings)
  const [showSettings, setShowSettings] = useState(false)
  const [resultDismissed, setResultDismissed] = useState(false)

  useEffect(() => {
    if (state.phase !== 'finished') setResultDismissed(false)
  }, [state.phase])

  const myDiscardTurn = view.phase === 'discard' && view.turn === HUMAN
  const evals = useMemo(
    () => (settings.beginnerAids && myDiscardTurn ? evalMyDiscards(view) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [view, settings.beginnerAids, myDiscardTurn],
  )
  const evalFor = (tile: string) => evals.find((e) => e.tile === tile)

  const dealerSeat = ([0, 1, 2, 3] as const).find((s) => view.seatWinds[s] === 'E')!
  const myTurnGlow = view.turn === HUMAN && view.phase !== 'finished' ? 'seat-glow' : ''

  return (
    <div className="flex flex-col items-stretch gap-2">
      <header className="flex items-center justify-between px-4 py-1.5">
        <div className="tabular text-xs text-parchment-dim">Round {match.roundNo}</div>
        <button
          className="flex cursor-pointer items-center gap-1.5 rounded-lg bg-felt-light/60 px-3 py-1.5 text-sm text-parchment transition-colors duration-(--duration-ui) hover:bg-felt-light"
          onClick={() => setShowSettings(true)}
        >
          <SlidersIcon /> Settings
        </button>
      </header>

      {/* West across the table */}
      <div className="flex justify-center">
        <SeatStrip view={view} seat={2} numbered={settings.numberedTiles} dealerSeat={dealerSeat} />
      </div>

      {/* The table centre: pools laid in front of each seat, oriented to it */}
      <div className="flex items-center justify-center gap-3">
        <div className="hidden md:block">
          <SeatStrip view={view} seat={3} numbered={settings.numberedTiles} dealerSeat={dealerSeat} />
        </div>

        <div className="hidden grid-cols-[6.5rem_minmax(12rem,15rem)_6.5rem] grid-rows-[auto_minmax(9rem,auto)_auto] place-items-center gap-1 rounded-[2rem] p-3 md:grid">
          <div />
          <div className="rotate-180">
            <DiscardPool view={view} seat={2} numbered={settings.numberedTiles} />
          </div>
          <div />

          <div className="relative h-52 w-24">
            <div className="absolute inset-0 grid place-items-center">
              <div className="w-52 rotate-90">
                <DiscardPool view={view} seat={3} numbered={settings.numberedTiles} />
              </div>
            </div>
          </div>
          <WallRing
            live={view.wallCount}
            total={initialLive(state.config.flowers)}
            roundWind={view.roundWind}
            faanMinimum={view.faanMinimum}
          />
          <div className="relative h-52 w-24">
            <div className="absolute inset-0 grid place-items-center">
              <div className="w-52 -rotate-90">
                <DiscardPool view={view} seat={1} numbered={settings.numberedTiles} />
              </div>
            </div>
          </div>

          <div />
          <DiscardPool view={view} seat={0} numbered={settings.numberedTiles} />
          <div />
        </div>

        <div className="hidden md:block">
          <SeatStrip view={view} seat={1} numbered={settings.numberedTiles} dealerSeat={dealerSeat} />
        </div>

        {/* Small screens: wall ring only in the middle row */}
        <div className="md:hidden">
          <WallRing
            live={view.wallCount}
            total={initialLive(state.config.flowers)}
            roundWind={view.roundWind}
            faanMinimum={view.faanMinimum}
          />
        </div>
      </div>

      {/* Small screens: opponent strips, then pools 2x2 (unrotated) */}
      <div className="flex justify-center gap-2 md:hidden">
        <SeatStrip view={view} seat={3} numbered={settings.numberedTiles} dealerSeat={dealerSeat} />
        <SeatStrip view={view} seat={1} numbered={settings.numberedTiles} dealerSeat={dealerSeat} />
      </div>
      <div className="mx-auto grid max-w-full grid-cols-2 justify-items-center gap-x-3 gap-y-2 px-2 md:hidden">
        {([2, 3, 1, 0] as const).map((seat) => (
          <div key={seat} className="flex flex-col items-center gap-0.5">
            <span className="text-[0.6rem] uppercase tracking-wider text-parchment-dim">
              {view.seatWinds[seat]} pool
            </span>
            <DiscardPool view={view} seat={seat} numbered={settings.numberedTiles} />
          </div>
        ))}
      </div>

      {/* My seat */}
      <div className="flex flex-col items-center gap-2 pb-8">
        <div className="flex items-center gap-2 text-sm text-parchment-dim">
          <span className={view.turn === HUMAN ? 'text-accent' : ''} style={{ fontFamily: 'var(--font-tiles)' }}>
            {WIND_CHARS[view.seatWind]}
          </span>
          {dealerSeat === HUMAN && <DealerIcon className="h-3 w-3 text-accent" />}
          <MeldRow melds={view.melds[0]} numbered={settings.numberedTiles} />
          <BonusRow tiles={view.bonus[0]} />
        </div>
        <div className={`flex flex-wrap justify-center gap-1 rounded-2xl p-2 transition-shadow duration-(--duration-ui) ${myTurnGlow}`}>
          {view.concealed.map((t, i) => {
            const e = evalFor(t)
            const title = e
              ? `${e.suggested ? 'Suggested — ' : ''}leaves ${
                  e.shantenAfter === -1 ? 'a winning hand' : `${e.shantenAfter} shanten`
                }, ${e.ukeire} live tiles${e.advancing.length ? ` (${e.advancing.join(' ')})` : ''}`
              : undefined
            return (
              <TileView
                key={`${t}-${i}`}
                tile={t}
                size="lg"
                numbered={settings.numberedTiles}
                state={e?.suggested ? 'highlighted' : 'normal'}
                title={title}
                onClick={myDiscardTurn ? () => dispatch({ type: 'discard', seat: HUMAN, tile: t }) : undefined}
              />
            )
          })}
        </div>
        <ActionBar view={view} onAction={dispatch} />
        <AnalysisPanel view={view} state={state} byoKey={settings.byoKey || undefined} />
        {state.phase === 'finished' && resultDismissed && (
          <button
            className="cursor-pointer rounded-lg bg-accent px-4 py-2 font-semibold text-on-accent transition-colors duration-(--duration-ui) hover:brightness-110"
            onClick={newRound}
          >
            Next round
          </button>
        )}
      </div>

      {state.phase === 'finished' && !resultDismissed && (
        <WinDialog state={state} match={match} onNewRound={newRound} onClose={() => setResultDismissed(true)} />
      )}
      {showSettings && (
        <SettingsPanel settings={settings} onChange={onChangeSettings} onClose={() => setShowSettings(false)} />
      )}
    </div>
  )
}
