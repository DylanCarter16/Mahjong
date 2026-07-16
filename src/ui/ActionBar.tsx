import type { Action, PlayerView } from '../engine/game'
import { scoreBest, winDeclarable } from '../engine/fan'
import { decompose, isWinningHand } from '../engine/win'
import { tileName } from '../engine/tiles'
import { SEAT_NAMES } from './panels'
import { TileFace } from './tiles/TileFace'

const btn =
  'px-4 py-2 rounded-lg font-semibold transition-colors duration-(--duration-ui) disabled:opacity-40 cursor-pointer'

const MiniTile = ({ tile }: { tile: string }) => (
  <span className="inline-block w-4 align-[-3px]">
    <TileFace tile={tile} />
  </span>
)

export function ActionBar({ view, onAction }: { view: PlayerView; onAction: (a: Action) => void }) {
  const legal = view.legal
  const claims = legal.filter((a) => a.type === 'claim')
  const pass = legal.find((a) => a.type === 'pass')
  const win = legal.find((a) => a.type === 'declareWin')
  const kongs = legal.filter((a) => a.type === 'kong')

  const myTurnToDiscard = view.phase === 'discard' && view.turn === view.seat

  // Teaching moment: the hand is complete but under the faan minimum.
  let blockedWin: string | null = null
  if (myTurnToDiscard && !win && isWinningHand(view.concealed, view.melds[view.seat])) {
    const fan = scoreBest(decompose(view.concealed, view.melds[view.seat]), {
      seatWind: view.seatWind,
      roundWind: view.roundWind,
      selfDraw: true,
      flowers: view.bonus[view.seat],
      fullyConcealed: view.melds[view.seat].every((m) => m.concealed),
      lastWallTile: false,
      kongReplacement: false,
    })
    if (!winDeclarable(fan.totalFaan, view.faanMinimum)) {
      blockedWin = `Your hand is complete — but it's only worth ${fan.totalFaan} faan and the minimum is ${view.faanMinimum}. You cannot declare it yet.`
    }
  }

  const claimPrompt =
    view.phase === 'claims' && claims.length > 0 && view.pendingDiscard
      ? `${SEAT_NAMES[view.pendingDiscard.from]} discarded ${tileName(view.pendingDiscard.tile)}`
      : null

  const hasButtons = Boolean(win) || claims.length > 0 || kongs.length > 0 || Boolean(pass)

  return (
    <div className={`flex flex-col items-center gap-2 ${hasButtons || blockedWin ? 'min-h-16' : 'min-h-6'}`}>
      {myTurnToDiscard && !blockedWin && (
        <p className="text-xs text-parchment-dim">your discard</p>
      )}
      {claimPrompt && <p className="text-sm text-parchment">{claimPrompt} — claim it?</p>}
      {blockedWin && <p className="max-w-xl text-center text-sm font-medium text-consider">{blockedWin}</p>}
      <div className="flex flex-wrap justify-center gap-2">
        {win && (
          <button className={`${btn} bg-accent text-on-accent hover:brightness-110`} onClick={() => onAction(win)}>
            Win! 食糊
          </button>
        )}
        {claims.map((a, i) => {
          if (a.type !== 'claim') return null
          const label =
            a.claim === 'win' ? (
              <>Win! 食糊</>
            ) : a.claim === 'pung' ? (
              <>Pung 碰</>
            ) : a.claim === 'kong' ? (
              <>Kong 槓</>
            ) : (
              <>
                Chow 上 {a.claim.chow.map((t) => <MiniTile key={t} tile={t} />)}
              </>
            )
          const cls =
            a.claim === 'win'
              ? 'bg-accent text-on-accent hover:brightness-110'
              : 'bg-ivory text-ink hover:bg-ivory-bright'
          return (
            <button key={i} className={`${btn} ${cls}`} onClick={() => onAction(a)}>
              {label}
            </button>
          )
        })}
        {kongs.map((a, i) =>
          a.type === 'kong' ? (
            <button
              key={`k${i}`}
              className={`${btn} bg-ivory text-ink hover:bg-ivory-bright`}
              onClick={() => onAction(a)}
            >
              Kong 槓 <MiniTile tile={a.tile} />
            </button>
          ) : null,
        )}
        {pass && (
          <button
            className={`${btn} bg-felt-light/70 text-parchment hover:bg-felt-light`}
            onClick={() => onAction(pass)}
          >
            Pass
          </button>
        )}
      </div>
    </div>
  )
}
