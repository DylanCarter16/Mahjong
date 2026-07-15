import { useState } from 'react'
import { ExerciseRunner } from './ExerciseRunner'
import { UNITS } from './exercises'
import { QuizScreen } from './QuizScreen'
import { TrainerScreen } from './TrainerScreen'

type Screen = 'list' | 'trainer' | 'quiz' | number // number = running unit id

export function LessonScreen({ completed, onCompleteUnit }: {
  completed: Set<number>
  onCompleteUnit: (id: number) => void
}) {
  const [screen, setScreen] = useState<Screen>('list')

  if (screen === 'trainer') return <TrainerScreen onExit={() => setScreen('list')} />
  if (screen === 'quiz') return <QuizScreen onExit={() => setScreen('list')} />
  if (typeof screen === 'number') {
    const unit = UNITS.find((u) => u.id === screen)!
    return (
      <ExerciseRunner
        exercises={unit.exercises()}
        onExit={() => setScreen('list')}
        onComplete={() => {
          onCompleteUnit(unit.id)
          setScreen('list')
        }}
      />
    )
  }

  const allUnitsDone = UNITS.every((u) => completed.has(u.id))

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <button
          className="rounded-2xl border border-amber-500/50 bg-amber-500/10 p-4 text-left hover:bg-amber-500/20 cursor-pointer"
          onClick={() => setScreen('trainer')}
        >
          <div className="text-lg font-bold text-amber-300">🀄 Tile efficiency trainer</div>
          <p className="mt-1 text-sm text-emerald-200/80">
            Endless generated hands. Pick a discard, get graded — optimal, acceptable or bad — and see why.
          </p>
        </button>
        <button
          className="rounded-2xl border border-sky-500/50 bg-sky-500/10 p-4 text-left hover:bg-sky-500/20 cursor-pointer"
          onClick={() => setScreen('quiz')}
        >
          <div className="text-lg font-bold text-sky-300">🔍 Discard-reading quiz</div>
          <p className="mt-1 text-sm text-emerald-200/80">
            Real mid-game positions: work out what opponents are collecting and which tile is safe.
          </p>
        </button>
      </div>

      <h2 className="mt-2 text-sm font-semibold uppercase tracking-wide text-emerald-300/70">
        Lessons {allUnitsDone && '— all complete 🎓'}
      </h2>
      <ol className="flex flex-col gap-2">
        {UNITS.map((u, i) => {
          const done = completed.has(u.id)
          const locked = i > 0 && !completed.has(UNITS[i - 1].id)
          return (
            <li key={u.id}>
              <button
                disabled={locked}
                onClick={() => setScreen(u.id)}
                className={`w-full rounded-xl border p-3 text-left transition-colors ${
                  locked
                    ? 'cursor-not-allowed border-emerald-800 bg-emerald-950/50 opacity-50'
                    : done
                      ? 'cursor-pointer border-lime-600/60 bg-lime-500/10 hover:bg-lime-500/20'
                      : 'cursor-pointer border-emerald-700 bg-emerald-900/60 hover:bg-emerald-800'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold">
                    {u.id}. {u.title}
                  </span>
                  <span className="text-sm">{done ? '✓' : locked ? '🔒' : '→'}</span>
                </div>
                <p className="mt-0.5 text-sm text-emerald-200/70">{u.blurb}</p>
              </button>
            </li>
          )
        })}
      </ol>
      <p className="text-xs text-emerald-300/50">
        Progress lives in this browser tab — refreshing starts the course over (by design: no storage).
      </p>
    </div>
  )
}
