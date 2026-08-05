// The table as it actually stood at one turn of a finished round.
//
// This is the point of the whole review. "You discarded the third Red Dragon
// into North's dragon collection" is a sentence you have to take on trust;
// seeing the two earlier dragons lit up in the pools, with North's exposed sets
// sitting right there, is a lesson that sticks. So the board is reconstructed
// from the action log rather than described — same tile components as the real
// table, in the same reading order.
//
// Everything drawn here is either exact (pools, melds, the tile in flight, all
// folded out of the log by engine/replay.ts) or captured (your own hand, from
// the view stream). Nothing is inferred. The one derived number is the wall
// count when no snapshot covers the turn, and it says "about" when it is.

import { derivedWallCount, replayTo, stepTurn, visibleOnTable } from '../engine/replay'
import type { Action } from '../engine/game'
import type { HandSnapshot } from '../engine/review'
import { sortTiles, tileName } from '../engine/tiles'
import type { Seat, TileId, Wind } from '../engine/types'
import { TileView } from '../ui/TileView'
import { MeldRow, TilePool } from '../ui/panels'

const WIND_NAMES: Record<Wind, string> = { E: 'East', S: 'South', W: 'West', N: 'North' }

export function ReplayBoardView({
  log,
  index,
  seat,
  seatWinds,
  hands,
  highlight,
  suggest = null,
  numbered,
  onStep,
}: {
  log: Action[]
  /** Log index the board is drawn at — the state just BEFORE that action. */
  index: number
  /** The seat being reviewed; drawn last, with its hand face up. */
  seat: Seat
  seatWinds: Record<Seat, Wind>
  /** Own hands by log index, from engine/review.ts handsByDecision. */
  hands: Map<number, HandSnapshot>
  /** The tile this moment is about; every copy on the table lights up. */
  highlight: TileId | null
  /**
   * The discard the engine says was better. Ringed green in the hand, against
   * the played tile's orange, so the alternative is a tile you can SEE you were
   * holding rather than a name in a sentence above the board.
   */
  suggest?: TileId | null
  numbered: boolean
  /** null disables a direction — the caller knows where the round's ends are. */
  onStep: (dir: -1 | 1) => void
}) {
  const board = replayTo(log, index)
  const snap = hands.get(index)
  const myHand = snap ? sortTiles([...snap.concealed]) : null
  const turn = log.slice(0, index + 1).filter((a) => a.type === 'discard').length
  const acting = log[index]

  const label = (s: Seat) => (s === seat ? 'You' : WIND_NAMES[seatWinds[s]])

  const canStep = (dir: -1 | 1) => stepTurn(log, index, dir) !== null
  const seen = highlight ? visibleOnTable(board, highlight) : 0

  return (
    <div className="rounded-lg border border-emerald-800 bg-felt-deep/60 p-2">
      <p className="flex flex-wrap items-baseline justify-between gap-x-2 text-[0.7rem] text-emerald-300/70">
        <span>
          Turn {turn} · {label(board.toAct)} to play
        </span>
        <span>
          {snap ? `${snap.wallCount} tiles left` : `about ${derivedWallCount(board)} tiles left`}
        </span>
      </p>

      {highlight && (
        <p className="mt-1 text-[0.7rem] text-emerald-200/80">
          {seen === 0
            ? `No ${tileName(highlight)} on the table yet.`
            : `${seen} ${tileName(highlight)}${seen === 1 ? '' : 's'} visible — lit up below.`}
        </p>
      )}

      <div className="mt-2 space-y-2">
        {seatOrderFrom(seat).map((s) => (
          <div key={s} className="rounded-md bg-emerald-950/40 p-1.5">
            <p className="mb-1 flex items-baseline gap-2 text-[0.7rem]">
              <span className={s === seat ? 'font-semibold text-emerald-100' : 'text-emerald-300/80'}>
                {label(s)}
              </span>
              {board.melds[s].length > 0 && (
                <span className="text-emerald-400/60">
                  {board.melds[s].length} set{board.melds[s].length === 1 ? '' : 's'} down
                </span>
              )}
              {acting?.seat === s && <span className="text-amber-300/80">acting</span>}
            </p>
            {board.melds[s].length > 0 && (
              <div className="mb-1">
                <MeldRow melds={board.melds[s]} numbered={numbered} small />
              </div>
            )}
            <TilePool
              tiles={board.discards[s]}
              numbered={numbered}
              size="xs"
              perRow={10}
              highlight={highlight}
              pending={board.pending?.from === s ? board.pending.tile : null}
            />
          </div>
        ))}
      </div>

      {/* Your hand as it was. Missing only when the round wasn't watched from
          the start — say so rather than drawing a hand that isn't yours. */}
      <div className="mt-2 rounded-md bg-emerald-950/40 p-1.5">
        <p className="mb-1 text-[0.7rem] text-emerald-300/80">Your hand</p>
        {myHand ? (
          <>
          <div className="flex flex-wrap justify-center gap-0.5">
            {myHand.map((t, i) => (
              <TileView
                key={i}
                tile={t}
                size="xs"
                numbered={numbered}
                {...ringFor(t, highlight, suggest)}
              />
            ))}
          </div>
          {/* A legend, because two rings with no key is a puzzle. Only shown
              when there is actually something to tell apart. */}
          {highlight && suggest && suggest !== highlight && myHand.includes(suggest) && (
            <p className="mt-1 text-center text-[0.65rem] text-emerald-300/70">
              <span className="text-consider">orange</span> = what you played ·{' '}
              <span className="text-safe">green</span> = the better discard
            </p>
          )}
          </>
        ) : (
          <p className="text-[0.7rem] text-emerald-400/60">
            Not recorded for this turn — the public table above is still exact.
          </p>
        )}
      </div>

      <div className="mt-2 flex justify-between gap-2">
        <button
          className="min-h-11 rounded-lg border border-emerald-700 px-3 py-1.5 text-xs text-emerald-100 disabled:opacity-35 cursor-pointer"
          disabled={!canStep(-1)}
          onClick={() => onStep(-1)}
        >
          ‹ Previous turn
        </button>
        <button
          className="min-h-11 rounded-lg border border-emerald-700 px-3 py-1.5 text-xs text-emerald-100 disabled:opacity-35 cursor-pointer"
          disabled={!canStep(1)}
          onClick={() => onStep(1)}
        >
          Next turn ›
        </button>
      </div>
    </div>
  )
}

/**
 * Seats in reading order: the three opponents in play order starting from the
 * one after you, then you — so your own pool sits nearest your hand, the same
 * spatial logic as the real table. Exported so a test can assert the order.
 */
export const seatOrderFrom = (seat: Seat): Seat[] => [
  ...[1, 2, 3].map((i) => ((seat + i) % 4) as Seat),
  seat,
]

/**
 * Which ring a tile in the hand wears. The played tile and the suggested one
 * carry different meanings, so they must not share a colour: orange is
 * "consider this", green is "this was safe" — the same scale the beginner aids
 * and the discard drills already use.
 */
function ringFor(
  tile: TileId,
  highlight: TileId | null,
  suggest: TileId | null,
): { state?: 'highlighted' | 'safe' } {
  if (suggest && tile === suggest && tile !== highlight) return { state: 'safe' }
  if (highlight && tile === highlight) return { state: 'highlighted' }
  return {}
}
