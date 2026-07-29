// Runs one generated item: ONE answer per presentation (§4.1.2), optional
// countdown, optional confidence rating, then the full explanation.
//
// Timed items (§C1): the clock never starts while you are still reading, but
// the "you'll have 12 seconds — I'm ready" FULL-SCREEN GATE is gone. In a run
// of timed questions that was a modal to dismiss between every single one. The
// session warns once up front (SessionScreen), each timed item carries a small
// ⏱ badge, and the clock is preceded by a short auto-advancing count-in. You
// may answer during the count-in — it just means you were quick.

import { useEffect, useMemo, useRef, useState } from 'react'
import { sortTiles } from '../engine/tiles'
import { SEATS, type Seat, type TileId } from '../engine/types'
import { isValidChow, isValidPung } from '../engine/win'
import { DiscardPool, MeldRow, SEAT_NAMES } from '../ui/panels'
import { TileView } from '../ui/TileView'
import { conceptProse } from './explain'
import type { LessonItem } from './generators'
import type { Confidence } from './mastery'
import { COUNT_IN_MS } from './timing'

export interface ItemResult {
  correct: boolean
  ms: number
  confidence?: Confidence
}

const btn =
  'px-4 py-2 rounded-lg font-semibold transition-colors duration-(--duration-ui) cursor-pointer disabled:opacity-40'

export function ItemRunner({ item, askConfidence = false, onDone }: {
  item: LessonItem
  askConfidence?: boolean
  onDone: (r: ItemResult) => void
}) {
  const start = useRef(Date.now())
  const [picked, setPicked] = useState<number[]>([]) // pool indices (build) / option (choice)
  const [groups, setGroups] = useState<number[][]>([]) // locked triples (group)
  const [pendingCorrect, setPendingCorrect] = useState<boolean | null>(null)
  const [revealed, setRevealed] = useState<ItemResult | null>(null)
  const [timeLeft, setTimeLeft] = useState<number | null>(item.timeLimitMs ? item.timeLimitMs / 1000 : null)
  // Timed items never ambush: the clock waits out a short count-in first.
  const [armed, setArmed] = useState(!item.timeLimitMs)
  const [countIn, setCountIn] = useState(item.timeLimitMs ? Math.ceil(COUNT_IN_MS / 1000) : 0)

  const finish = (correct: boolean, confidence?: Confidence) =>
    setRevealed({
      correct,
      // Answering during the count-in is allowed; it reads as instant, not negative.
      ms: Math.max(0, Date.now() - start.current),
      ...(confidence ? { confidence } : {}),
    })

  const settle = (correct: boolean) => {
    if (askConfidence) setPendingCorrect(correct)
    else finish(correct)
  }

  // Count-in: the question is already on screen, so this is orientation time,
  // not an interruption — it advances itself, there is nothing to dismiss.
  useEffect(() => {
    if (!item.timeLimitMs || armed) return
    const startedAt = Date.now()
    const t = setInterval(() => {
      const left = COUNT_IN_MS - (Date.now() - startedAt)
      if (left <= 0) {
        clearInterval(t)
        start.current = Date.now()
        setCountIn(0)
        setArmed(true)
      } else setCountIn(Math.ceil(left / 1000))
    }, 100)
    return () => clearInterval(t)
  }, [item, armed])

  // Countdown for timed items — expiry counts as wrong.
  useEffect(() => {
    if (!item.timeLimitMs || !armed || revealed || pendingCorrect !== null) return
    const t = setInterval(() => {
      const left = (item.timeLimitMs! - (Date.now() - start.current)) / 1000
      if (left <= 0) {
        clearInterval(t)
        setTimeLeft(0)
        finish(false)
      } else setTimeLeft(left)
    }, 100)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item, armed, revealed, pendingCorrect])

  const ex = item.exercise

  const groupedIdx = useMemo(() => new Set(groups.flat()), [groups])

  const answerChoice = (i: number) => {
    if (revealed || pendingCorrect !== null || ex.kind !== 'choice') return
    setPicked([i])
    settle(i === ex.correct)
  }

  const toggleBuild = (i: number) => {
    if (revealed || pendingCorrect !== null || ex.kind !== 'build') return
    setPicked((p) => (p.includes(i) ? p.filter((x) => x !== i) : p.length < ex.pick ? [...p, i] : p))
  }

  const checkBuild = () => {
    if (ex.kind !== 'build') return
    settle(ex.isCorrect(sortTiles(picked.map((i) => ex.pool[i]))))
  }

  const toggleGroup = (i: number) => {
    if (revealed || pendingCorrect !== null || ex.kind !== 'group' || groupedIdx.has(i)) return
    setPicked((p) => {
      const next = p.includes(i) ? p.filter((x) => x !== i) : [...p, i]
      if (next.length === 3) {
        const newGroups = [...groups, next]
        setGroups(newGroups)
        if (newGroups.length === 4) {
          // four locked triples: valid melds + the leftover pair decides it
          const tiles = ex.tiles
          const used = new Set(newGroups.flat())
          const rest = tiles.filter((_, idx) => !used.has(idx))
          const ok =
            newGroups.every((g) => {
              const sel = sortTiles(g.map((idx) => tiles[idx]))
              return isValidChow(sel) || isValidPung(sel)
            }) &&
            rest.length === 2 &&
            rest[0] === rest[1]
          settle(ok)
        }
        return []
      }
      return next
    })
  }

  const chooseConfidence = (c: Confidence) => {
    if (pendingCorrect === null) return
    finish(pendingCorrect, c)
  }

  const verdictCls = revealed
    ? revealed.correct
      ? 'border-safe bg-safe/10'
      : 'border-danger bg-danger/10'
    : ''

  return (
    <div className="flex w-full flex-col items-center gap-4">
      <div className="flex w-full items-center justify-between gap-2 text-xs text-parchment-dim">
        <span className="min-w-0 truncate">{item.concept}</span>
        <span className="flex shrink-0 items-center gap-2">
          {/* The persistent marker: on a timed item, always visible, never a
              thing to dismiss. */}
          {item.timeLimitMs && (
            <span className="rounded-full border border-consider/50 bg-consider/10 px-2 py-0.5 text-[0.65rem] font-medium text-consider">
              ⏱ timed
            </span>
          )}
          {!armed && countIn > 0 && (
            <span className="tabular font-serif text-sm text-consider" role="status" aria-live="polite">
              in {countIn}s
            </span>
          )}
          {armed && timeLeft !== null && (
            <span className={`tabular font-serif text-sm ${timeLeft < 1.2 ? 'text-danger' : ''}`}>
              {Math.max(0, timeLeft).toFixed(1)}s
            </span>
          )}
        </span>
      </div>

      {item.board && (
        <div className="flex w-full flex-col gap-2">
          <div className="grid w-full gap-2 rounded-2xl bg-felt p-3 sm:grid-cols-3">
            {SEATS.filter((s) => s !== item.board!.seat).map((seat) => (
              <div key={seat} className="flex flex-col items-center gap-1 rounded-xl bg-felt-deep/50 p-2">
                <span className="text-xs text-parchment-dim">
                  {SEAT_NAMES[seat as Seat]} · {item.board!.discards[seat as Seat].length} discards
                </span>
                <DiscardPool view={item.board!} seat={seat as Seat} numbered />
                <MeldRow melds={item.board!.melds[seat as Seat]} numbered small />
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-center gap-0.5 rounded-xl bg-felt p-2">
            <span className="mr-2 text-xs text-parchment-dim">your hand:</span>
            {item.board.concealed.map((t, i) => (
              <TileView key={i} tile={t} size="sm" numbered />
            ))}
          </div>
        </div>
      )}

      <p className="text-center text-lg font-medium text-parchment">{ex.prompt}</p>

      {ex.kind === 'choice' && ex.showTiles && (
        <div className="flex flex-wrap justify-center gap-1 rounded-xl bg-felt p-2">
          {ex.showTiles.map((t: TileId, i: number) => (
            <TileView key={i} tile={t} size={ex.showTiles!.length > 8 ? 'sm' : 'md'} numbered />
          ))}
        </div>
      )}

      {ex.kind === 'choice' && (
        <div className="flex w-full max-w-md flex-col gap-2">
          {ex.options.map((o, i) => {
            const cls = revealed
              ? i === ex.correct
                ? 'border-safe bg-safe/15'
                : picked[0] === i
                  ? 'border-danger bg-danger/15'
                  : 'border-paper-line bg-paper-raised opacity-60'
              : picked[0] === i
                ? 'border-accent bg-paper-raised'
                : 'border-paper-line bg-paper-raised hover:border-parchment-dim'
            return (
              <button
                key={i}
                className={`cursor-pointer rounded-xl border px-4 py-2.5 text-left transition-colors duration-(--duration-ui) ${cls}`}
                onClick={() => answerChoice(i)}
              >
                {ex.optionTiles?.[i] ? (
                  <span className="flex items-center gap-2">
                    <span className="w-7">
                      <TileView tile={ex.optionTiles[i]} size="sm" />
                    </span>
                    {o}
                  </span>
                ) : (
                  o
                )}
              </button>
            )
          })}
        </div>
      )}

      {ex.kind === 'build' && (
        <>
          <div className="flex flex-wrap justify-center gap-1 rounded-xl bg-felt p-2">
            {ex.pool.map((t, i) => (
              <TileView
                key={i}
                tile={t}
                size="md"
                numbered
                state={picked.includes(i) ? 'selected' : 'normal'}
                onClick={() => toggleBuild(i)}
              />
            ))}
          </div>
          {!revealed && pendingCorrect === null && (
            <button className={`${btn} bg-accent text-on-accent`} disabled={picked.length !== ex.pick} onClick={checkBuild}>
              Check ({picked.length}/{ex.pick})
            </button>
          )}
        </>
      )}

      {ex.kind === 'group' && (
        <>
          <div className="flex flex-wrap justify-center gap-1 rounded-xl bg-felt p-2">
            {ex.tiles.map((t, i) => (
              <TileView
                key={i}
                tile={t}
                size="md"
                numbered
                state={groupedIdx.has(i) ? 'dimmed' : picked.includes(i) ? 'selected' : 'normal'}
                onClick={() => toggleGroup(i)}
              />
            ))}
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            {groups.map((g, gi) => (
              <div key={gi} className="flex gap-px rounded-lg bg-paper-raised p-1">
                {g.map((i) => (
                  <TileView key={i} tile={ex.tiles[i]} size="sm" />
                ))}
              </div>
            ))}
            <span className="self-center text-xs text-parchment-dim">{groups.length}/4 sets</span>
          </div>
        </>
      )}

      {pendingCorrect !== null && !revealed && (
        <div className="flex flex-col items-center gap-2">
          <p className="text-sm text-parchment-dim">How sure were you?</p>
          <div className="flex gap-2">
            {(['guess', 'sure', 'certain'] as const).map((c) => (
              <button key={c} className={`${btn} bg-paper-raised border border-paper-line text-parchment`} onClick={() => chooseConfidence(c)}>
                {c === 'guess' ? 'Guessing' : c === 'sure' ? 'Fairly sure' : 'Certain'}
              </button>
            ))}
          </div>
        </div>
      )}

      {revealed && (
        <div className={`w-full max-w-xl rounded-xl border p-4 text-sm ${verdictCls}`}>
          <p className="font-bold text-parchment">
            {revealed.correct ? 'Correct' : timeLeft === 0 ? "Time's up" : 'Not this time'}
          </p>
          <p className="mt-1 text-parchment">{item.explain}</p>
          <p className="mt-2 text-parchment-dim">{conceptProse(item.concept, revealed.correct)}</p>
          <button className={`${btn} mt-3 bg-accent text-on-accent`} onClick={() => onDone(revealed)}>
            Continue
          </button>
        </div>
      )}
    </div>
  )
}
