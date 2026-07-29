// Runs one generated item: ONE answer per presentation (§4.1.2), optional
// countdown, optional confidence rating, then the full explanation.

import { useEffect, useMemo, useRef, useState } from 'react'
import { sortTiles } from '../engine/tiles'
import { SEATS, type Seat, type TileId } from '../engine/types'
import { isValidChow, isValidPung } from '../engine/win'
import { DiscardPool, MeldRow, SEAT_NAMES } from '../ui/panels'
import { TileView } from '../ui/TileView'
import { conceptProse } from './explain'
import type { LessonItem } from './generators'
import type { Confidence } from './mastery'

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
  // Timed items never ambush: they wait behind a "ready?" tap.
  const [armed, setArmed] = useState(!item.timeLimitMs)

  const finish = (correct: boolean, confidence?: Confidence) =>
    setRevealed({ correct, ms: Date.now() - start.current, ...(confidence ? { confidence } : {}) })

  const settle = (correct: boolean) => {
    if (askConfidence) setPendingCorrect(correct)
    else finish(correct)
  }

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

  // All hooks are above this line — the ready-gate return must not skip any.
  if (!armed) {
    return (
      <div className="flex w-full flex-col items-center gap-4 py-8">
        <p className="text-xs uppercase tracking-wide text-parchment-dim">{item.concept}</p>
        <p className="font-serif text-lg text-parchment">Timed question</p>
        <p className="text-sm text-parchment-dim">
          You'll have {(item.timeLimitMs! / 1000).toFixed(0)} seconds. Fast, correct answers earn the most mastery.
        </p>
        <button
          className={`${btn} bg-accent text-on-accent`}
          onClick={() => {
            start.current = Date.now()
            setArmed(true)
          }}
        >
          I'm ready
        </button>
      </div>
    )
  }

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
      <div className="flex w-full items-center justify-between text-xs text-parchment-dim">
        <span>{item.concept}</span>
        {timeLeft !== null && (
          <span className={`tabular font-serif text-sm ${timeLeft < 1.2 ? 'text-danger' : ''}`}>
            {Math.max(0, timeLeft).toFixed(1)}s
          </span>
        )}
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
