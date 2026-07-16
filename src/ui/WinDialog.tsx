import type { GameState } from '../engine/game'
import type { MatchInfo } from './useGame'
import { SEAT_NAMES } from './panels'
import { SEATS } from '../engine/types'

export function WinDialog({ state, match, onNewRound, onClose }: {
  state: GameState
  match: MatchInfo
  onNewRound: () => void
  onClose: () => void
}) {
  const r = state.result
  if (!r) return null
  return (
    <div className="fixed inset-0 z-20 grid place-items-center bg-black/60 p-4 backdrop-blur-[2px]">
      <div className="w-full max-w-md rounded-2xl border border-felt-line bg-felt-deep p-6 shadow-panel">
        {r.kind === 'draw' ? (
          <>
            <h2 className="font-serif text-2xl font-semibold text-parchment">Wall exhausted — draw</h2>
            <p className="mt-2 text-sm text-parchment-dim">
              Nobody completed a hand before the live wall ran out. The dealer stays.
            </p>
          </>
        ) : (
          <>
            <h2 className="font-serif text-2xl font-semibold text-accent">
              {SEAT_NAMES[r.winner!]} win{r.winner === 0 ? '' : 's'}
              {r.selfDraw ? ' — self-draw 自摸' : ` off ${SEAT_NAMES[r.loser!]}`}
            </h2>
            <table className="mt-4 w-full text-sm">
              <tbody>
                {r.fan!.patterns.length === 0 && (
                  <tr>
                    <td className="py-1 text-parchment">Chicken hand 雞糊</td>
                    <td className="tabular py-1 text-right font-serif">0</td>
                  </tr>
                )}
                {r.fan!.patterns.map((p) => (
                  <tr key={p.name} className="border-b border-felt-line/50 last:border-0">
                    <td className="py-1 text-parchment">{p.name}</td>
                    <td className="tabular py-1 text-right font-serif">{p.faan}</td>
                  </tr>
                ))}
                <tr>
                  <td className="pt-2 font-semibold text-parchment">Total faan</td>
                  <td className="tabular pt-2 text-right font-serif text-lg font-bold text-accent">
                    {r.fan!.totalFaan}
                  </td>
                </tr>
              </tbody>
            </table>
          </>
        )}
        <div className="mt-5 rounded-xl bg-felt/70 p-3">
          <p className="mb-1 text-xs uppercase tracking-wide text-parchment-dim">Faan won so far</p>
          <div className="grid grid-cols-4 gap-2 text-center text-sm">
            {SEATS.map((s) => (
              <div key={s}>
                <div className="text-parchment-dim">{SEAT_NAMES[s]}</div>
                <div className="tabular font-serif font-bold text-parchment">{match.scores[s]}</div>
              </div>
            ))}
          </div>
        </div>
        <button
          className="mt-5 w-full cursor-pointer rounded-lg bg-accent py-2.5 font-semibold text-on-accent transition-colors duration-(--duration-ui) hover:brightness-110"
          onClick={onNewRound}
        >
          Next round
        </button>
        <button
          className="mt-2 w-full cursor-pointer rounded-lg bg-felt-light/60 py-2 text-sm text-parchment transition-colors duration-(--duration-ui) hover:bg-felt-light"
          onClick={onClose}
        >
          Review the table first (AI coach available below)
        </button>
      </div>
    </div>
  )
}
