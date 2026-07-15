import { useEffect, useState } from 'react'
import { sortTiles } from '../engine/tiles'
import type { TileId } from '../engine/types'
import { TileView } from '../ui/TileView'
import type { Exercise } from './exercises'

const btn = 'px-4 py-2 rounded-lg font-semibold shadow cursor-pointer transition-colors'

export function ExerciseRunner({ exercises, onComplete, onExit }: {
  exercises: Exercise[]
  onComplete: () => void
  onExit: () => void
}) {
  const [idx, setIdx] = useState(0)
  const [picked, setPicked] = useState<number[]>([]) // pool indexes for build
  const [outcome, setOutcome] = useState<'correct' | 'wrong' | 'timeout' | null>(null)
  const [timeLeft, setTimeLeft] = useState<number | null>(null)

  const ex = exercises[idx]
  const done = idx >= exercises.length

  useEffect(() => {
    if (done || outcome) return
    const limit = ex.kind === 'choice' ? ex.timed : undefined
    if (!limit) {
      setTimeLeft(null)
      return
    }
    setTimeLeft(limit)
    const t = setInterval(() => {
      setTimeLeft((s) => {
        if (s === null) return null
        if (s <= 1) {
          clearInterval(t)
          setOutcome('timeout')
          return 0
        }
        return s - 1
      })
    }, 1000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, outcome, done])

  if (done) {
    return (
      <div className="flex flex-col items-center gap-4 py-10">
        <div className="text-3xl">🎉</div>
        <p className="text-lg font-semibold">Unit complete!</p>
        <button className={`${btn} bg-amber-400 text-amber-950 hover:bg-amber-300`} onClick={onComplete}>
          Back to lessons
        </button>
      </div>
    )
  }

  const next = () => {
    setPicked([])
    setOutcome(null)
    setIdx((i) => i + 1)
  }
  const retry = () => {
    setPicked([])
    setOutcome(null)
  }

  const answerChoice = (i: number) => {
    if (outcome || ex.kind !== 'choice') return
    setOutcome(i === ex.correct ? 'correct' : 'wrong')
  }

  const togglePick = (i: number) => {
    if (outcome || ex.kind !== 'build') return
    setPicked((p) => (p.includes(i) ? p.filter((x) => x !== i) : p.length < ex.pick ? [...p, i] : p))
  }

  const checkBuild = () => {
    if (ex.kind !== 'build') return
    const sel = sortTiles(picked.map((i) => ex.pool[i]))
    setOutcome(ex.validate(sel) ? 'correct' : 'wrong')
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center gap-4 p-4">
      <div className="flex w-full items-center justify-between text-sm text-emerald-300/70">
        <button className="hover:text-white cursor-pointer" onClick={onExit}>← exit</button>
        <span>
          {idx + 1} / {exercises.length}
          {timeLeft !== null && <span className="ml-3 font-mono text-amber-300">⏱ {timeLeft}s</span>}
        </span>
      </div>

      <p className="text-center text-lg font-medium">{ex.prompt}</p>

      {ex.kind === 'choice' && ex.showTiles && (
        <div className="flex flex-wrap justify-center gap-1">
          {ex.showTiles.map((t: TileId, i: number) => (
            <TileView key={i} tile={t} size={ex.showTiles!.length > 6 ? 'md' : 'lg'} numbered />
          ))}
        </div>
      )}

      {ex.kind === 'choice' && (
        <div className="flex w-full max-w-md flex-col gap-2">
          {ex.options.map((o, i) => {
            const revealed = outcome !== null
            const cls = revealed
              ? i === ex.correct
                ? 'bg-lime-500/30 border-lime-400'
                : 'bg-emerald-900 border-emerald-700 opacity-60'
              : 'bg-emerald-900 border-emerald-700 hover:bg-emerald-800'
            return (
              <button key={i} className={`rounded-lg border px-4 py-2 text-left cursor-pointer ${cls}`} onClick={() => answerChoice(i)}>
                {o}
              </button>
            )
          })}
        </div>
      )}

      {ex.kind === 'build' && (
        <>
          <div className="flex flex-wrap justify-center gap-1">
            {ex.pool.map((t, i) => (
              <TileView
                key={i}
                tile={t}
                size="lg"
                numbered
                ring={picked.includes(i) ? 'selected' : undefined}
                onClick={() => togglePick(i)}
              />
            ))}
          </div>
          <button
            className={`${btn} bg-emerald-200 text-emerald-950 hover:bg-emerald-100 disabled:opacity-40`}
            disabled={picked.length !== ex.pick || outcome !== null}
            onClick={checkBuild}
          >
            Check ({picked.length}/{ex.pick})
          </button>
        </>
      )}

      {outcome && (
        <div
          className={`w-full max-w-md rounded-xl border p-4 text-sm ${
            outcome === 'correct'
              ? 'border-lime-500 bg-lime-500/15 text-lime-100'
              : 'border-rose-500 bg-rose-500/15 text-rose-100'
          }`}
        >
          <p className="font-bold">
            {outcome === 'correct' ? '✓ Correct!' : outcome === 'timeout' ? "⏱ Time's up" : '✗ Not quite'}
          </p>
          <p className="mt-1">{ex.explain}</p>
          <div className="mt-3 flex gap-2">
            {outcome === 'correct' ? (
              <button className={`${btn} bg-lime-400 text-lime-950 hover:bg-lime-300`} onClick={next}>
                Next →
              </button>
            ) : (
              <button className={`${btn} bg-rose-400 text-rose-950 hover:bg-rose-300`} onClick={retry}>
                Try again
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
