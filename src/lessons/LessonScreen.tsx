// The course home: streak/XP/goal, one primary CTA (start a session), the two
// trainers, and a unit map of concept mastery. Calm paper surface — the felt
// stays at the table.

import { useRef, useState } from 'react'
import { DownloadIcon, FlameIcon, LockIcon, UploadIcon } from '../ui/icons'
import { CONCEPTS } from './concepts'
import { DAILY_GOAL, isUnlocked, masteryOf } from './mastery'
import { QuizScreen } from './QuizScreen'
import { SessionScreen } from './SessionScreen'
import { TrainerScreen } from './TrainerScreen'
import { useProgress } from './useProgress'

type Screen = 'home' | 'session' | 'trainer' | 'quiz'

const UNIT_TITLES: Record<number, string> = {
  1: 'Tiles & suits',
  2: 'Sets',
  3: 'The winning shape',
  4: 'Special hands',
  5: 'Faan & the minimum',
  6: 'Efficiency & reading',
  7: 'Defence',
  8: 'At the table',
}

export function LessonScreen() {
  const { progress, update, exportProgress, importProgress } = useProgress()
  const [screen, setScreen] = useState<Screen>('home')
  const fileRef = useRef<HTMLInputElement>(null)

  if (screen === 'session') return <SessionScreen progress={progress} update={update} onExit={() => setScreen('home')} />
  if (screen === 'trainer') return <TrainerScreen progress={progress} update={update} onExit={() => setScreen('home')} />
  if (screen === 'quiz') return <QuizScreen progress={progress} update={update} onExit={() => setScreen('home')} />

  const units = [...new Set(CONCEPTS.map((c) => c.unit))].sort((a, b) => a - b)

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5 p-4 pb-16">
      <div className="flex items-center justify-between rounded-2xl border border-paper-line bg-paper-raised px-4 py-3">
        <div className="flex items-center gap-2 text-consider">
          <FlameIcon className="h-5 w-5" />
          <span className="tabular font-serif text-xl font-bold">{progress.streak.count}</span>
          <span className="text-xs text-parchment-dim">day streak</span>
        </div>
        <div className="tabular text-sm text-parchment-dim">
          {Math.min(progress.today.count, DAILY_GOAL)}/{DAILY_GOAL} today
        </div>
        <div className="tabular font-serif text-xl font-bold text-parchment">
          {progress.xp} <span className="font-sans text-xs font-normal text-parchment-dim">xp</span>
        </div>
      </div>

      <button
        className="cursor-pointer rounded-2xl bg-accent px-4 py-3.5 font-serif text-lg font-bold text-on-accent transition-colors duration-(--duration-ui) hover:brightness-110"
        onClick={() => setScreen('session')}
      >
        Start a session
      </button>
      <p className="-mt-3 text-center text-xs text-parchment-dim">
        ~13 items: due reviews first, weakest concepts, a little new material.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <button
          className="cursor-pointer rounded-2xl border border-paper-line bg-paper-raised p-4 text-left transition-colors duration-(--duration-ui) hover:border-parchment-dim"
          onClick={() => setScreen('trainer')}
        >
          <div className="font-serif text-lg font-bold text-parchment">Tile efficiency trainer</div>
          <p className="mt-1 text-sm text-parchment-dim">
            Endless hands, graded on a curve, with the full ranked table and your error patterns.
          </p>
        </button>
        <button
          className="cursor-pointer rounded-2xl border border-paper-line bg-paper-raised p-4 text-left transition-colors duration-(--duration-ui) hover:border-parchment-dim"
          onClick={() => setScreen('quiz')}
        >
          <div className="font-serif text-lg font-bold text-parchment">Discard-reading quiz</div>
          <p className="mt-1 text-sm text-parchment-dim">
            Real positions, progressive reveal, confidence grading — then see what was actually in their hands.
          </p>
        </button>
      </div>

      <h2 className="mt-2 text-xs font-semibold uppercase tracking-wide text-parchment-dim">The terrain</h2>
      <ol className="flex flex-col gap-3">
        {units.map((u) => (
          <li key={u} className="rounded-2xl border border-paper-line bg-paper-raised p-3">
            <div className="mb-2 font-serif font-semibold text-parchment">
              {u}. {UNIT_TITLES[u]}
            </div>
            <div className="flex flex-col gap-1.5">
              {CONCEPTS.filter((c) => c.unit === u).map((c) => {
                const unlocked = isUnlocked(progress, c.id)
                const m = masteryOf(progress, c.id)
                return (
                  <div key={c.id} className={`flex items-center gap-2 text-sm ${unlocked ? '' : 'opacity-45'}`}>
                    <span className="w-44 truncate text-parchment">{c.title}</span>
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-paper">
                      <div
                        className={`h-full rounded-full ${m >= 0.7 ? 'bg-safe' : m >= 0.35 ? 'bg-consider' : 'bg-parchment-dim'}`}
                        style={{ width: `${Math.max(2, m * 100)}%` }}
                      />
                    </div>
                    <span className="tabular flex w-10 items-center justify-end text-right text-xs text-parchment-dim">
                      {unlocked ? `${Math.round(m * 100)}%` : <LockIcon className="h-3.5 w-3.5" />}
                    </span>
                  </div>
                )
              })}
            </div>
          </li>
        ))}
      </ol>

      <div className="flex items-center gap-3 text-xs text-parchment-dim">
        <button className="flex cursor-pointer items-center gap-1 hover:text-parchment" onClick={exportProgress}>
          <DownloadIcon className="h-3.5 w-3.5" /> export progress
        </button>
        <button className="flex cursor-pointer items-center gap-1 hover:text-parchment" onClick={() => fileRef.current?.click()}>
          <UploadIcon className="h-3.5 w-3.5" /> import
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (!f) return
            void f.text().then((t) => {
              if (!importProgress(t)) window.alert('That file is not a valid progress export.')
            })
          }}
        />
        <span className="ml-auto">Progress is saved in this browser. Export it to move devices.</span>
      </div>
    </div>
  )
}
