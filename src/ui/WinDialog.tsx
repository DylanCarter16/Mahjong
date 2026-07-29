import type { RoundResult } from '../engine/game'
import type { MatchInfo } from './useGame'
import { SEAT_NAMES } from './panels'
import { SEATS, type Seat } from '../engine/types'

export function WinDialog({
  result,
  match,
  onNewRound,
  onClose,
  seatLabel,
  youSeat = 0,
  canStartNextRound = true,
}: {
  result: RoundResult
  match: MatchInfo
  onNewRound: () => void
  onClose: () => void
  /** Multiplayer: real names. Solo falls back to the fixed SEAT_NAMES. */
  seatLabel?: (seat: Seat) => string
  /** Which seat is the viewer, for "you win" vs "they win" phrasing. */
  youSeat?: Seat
  /** Multiplayer: only the host deals the next round; others wait. */
  canStartNextRound?: boolean
}) {
  const r = result
  const name = (seat: Seat) => seatLabel?.(seat) ?? SEAT_NAMES[seat]
  return (
    <div className="fixed inset-0 z-20 grid place-items-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-2xl bg-emerald-950 border border-emerald-700 p-6 shadow-2xl">
        {r.kind === 'draw' ? (
          <>
            <h2 className="text-2xl font-bold text-emerald-50">Wall exhausted — draw</h2>
            <p className="mt-2 text-emerald-200/80 text-sm">
              Nobody completed a hand before the live wall ran out. The dealer stays.
            </p>
          </>
        ) : (
          <>
            <h2 className="text-2xl font-bold text-amber-300">
              {name(r.winner!)} win{r.winner === youSeat ? '' : 's'}
              {r.selfDraw ? ' — self-draw 自摸' : ` off ${name(r.loser!)}`}
            </h2>
            <table className="mt-4 w-full text-sm">
              <tbody>
                {r.fan!.patterns.length === 0 && (
                  <tr>
                    <td className="py-1 text-emerald-200">Chicken hand 雞糊</td>
                    <td className="py-1 text-right font-mono">0</td>
                  </tr>
                )}
                {r.fan!.patterns.map((p) => (
                  <tr key={p.name} className="border-b border-emerald-800/50 last:border-0">
                    <td className="py-1 text-emerald-100">{p.name}</td>
                    <td className="py-1 text-right font-mono text-emerald-100">{p.faan}</td>
                  </tr>
                ))}
                <tr>
                  <td className="pt-2 font-semibold text-emerald-50">Total faan</td>
                  <td className="pt-2 text-right font-mono font-bold text-amber-300">{r.fan!.totalFaan}</td>
                </tr>
              </tbody>
            </table>
          </>
        )}
        <div className="mt-5 rounded-lg bg-emerald-900/60 p-3">
          <p className="text-xs uppercase tracking-wide text-emerald-300/70 mb-1">Faan won so far</p>
          <div className="grid grid-cols-4 gap-2 text-center text-sm">
            {SEATS.map((s) => (
              <div key={s}>
                <div className="truncate text-emerald-200/70">{name(s).replace(' Bot', '')}</div>
                <div className="font-mono font-bold text-emerald-50">{match.scores[s]}</div>
              </div>
            ))}
          </div>
        </div>
        <button
          className="mt-5 min-h-11 w-full rounded-lg bg-amber-400 py-2.5 font-semibold text-amber-950 hover:bg-amber-300 disabled:opacity-40 cursor-pointer"
          onClick={onNewRound}
          disabled={!canStartNextRound}
          title={canStartNextRound ? '' : 'The host starts the next round'}
        >
          {canStartNextRound ? 'Next round →' : 'Waiting for host…'}
        </button>
        <button
          className="mt-2 min-h-11 w-full rounded-lg bg-emerald-800 py-2 text-sm text-emerald-100 hover:bg-emerald-700 cursor-pointer"
          onClick={onClose}
        >
          Review this round (coach panel below)
        </button>
      </div>
    </div>
  )
}
