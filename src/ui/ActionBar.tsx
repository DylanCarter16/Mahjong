import type { Action, PlayerView } from '../engine/game'
import { winDeclarable } from '../engine/fan'
import { scoreBest } from '../engine/fan'
import { decompose, isWinningHand } from '../engine/win'
import { glyph, tileName } from '../engine/tiles'
import { ClaimCountdown } from './ClaimCountdown'
import { SEAT_NAMES } from './panels'

const btn =
  'px-4 py-2 rounded-lg font-semibold shadow transition-colors disabled:opacity-40 cursor-pointer min-h-11'

export function ActionBar({ view, onAction, claimCountdown, seatLabel }: {
  view: PlayerView
  onAction: (a: Action) => void
  /** Multiplayer (§7): wrap the claim buttons in a depleting ring. */
  claimCountdown?: { durationMs: number; resetKey: string | number }
  /** Multiplayer: real name of the discarder (solo falls back to SEAT_NAMES). */
  seatLabel?: (seat: PlayerView['seat']) => string
}) {
  const legal = view.legal
  const claims = legal.filter((a) => a.type === 'claim')
  const pass = legal.find((a) => a.type === 'pass')
  const win = legal.find((a) => a.type === 'declareWin')
  const kongs = legal.filter((a) => a.type === 'kong')
  const nameOf = (seat: PlayerView['seat']) => seatLabel?.(seat) ?? SEAT_NAMES[seat]

  // Teaching moment: the hand is complete but under the faan minimum.
  const myTurnToDiscard = view.phase === 'discard' && view.turn === view.seat
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

  const status = (() => {
    if (view.phase === 'finished') return 'Round over'
    if (view.phase === 'claims') {
      const from = view.pendingDiscard!.from
      return claims.length > 0
        ? `${nameOf(from)} discarded ${tileName(view.pendingDiscard!.tile)} — claim it?`
        : 'Waiting for claims…'
    }
    if (myTurnToDiscard) return 'Your turn — pick a tile to discard'
    return `${nameOf(view.turn)} is thinking…`
  })()

  const inClaimWindow = view.phase === 'claims' && claims.length > 0

  const buttons = (
    <div className="flex gap-2 flex-wrap justify-center">
      {win && (
        <button className={`${btn} bg-amber-400 text-amber-950 hover:bg-amber-300`} onClick={() => onAction(win)}>
          Win! 食糊
        </button>
      )}
      {claims.map((a, i) => {
        if (a.type !== 'claim') return null
        const label =
          a.claim === 'win'
            ? 'Win! 食糊'
            : a.claim === 'pung'
              ? 'Pung 碰'
              : a.claim === 'kong'
                ? 'Kong 槓'
                : `Chow 上 ${a.claim.chow.map(glyph).join('')}`
        const cls =
          a.claim === 'win'
            ? 'bg-amber-400 text-amber-950 hover:bg-amber-300'
            : 'bg-emerald-200 text-emerald-950 hover:bg-emerald-100'
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
            className={`${btn} bg-emerald-200 text-emerald-950 hover:bg-emerald-100`}
            onClick={() => onAction(a)}
          >
            Kong 槓 {glyph(a.tile)}
          </button>
        ) : null,
      )}
      {pass && (
        <button className={`${btn} bg-emerald-800 text-emerald-100 hover:bg-emerald-700`} onClick={() => onAction(pass)}>
          Pass
        </button>
      )}
    </div>
  )

  return (
    <div className="flex flex-col items-center gap-2 min-h-20">
      <p className="text-emerald-100/80 text-sm">{status}</p>
      {blockedWin && (
        <p className="text-amber-300 text-sm font-medium max-w-xl text-center">{blockedWin}</p>
      )}
      {claimCountdown && inClaimWindow ? (
        <ClaimCountdown durationMs={claimCountdown.durationMs} resetKey={claimCountdown.resetKey}>
          {buttons}
        </ClaimCountdown>
      ) : (
        buttons
      )}
    </div>
  )
}
