// A learning session: 12–15 scheduler-driven items. Missed concepts requeue
// later in the same session; the summary shows what moved and what's due.

import { useRef, useState } from 'react'
import { makeRng } from '../engine/rng'
import { FlameIcon } from '../ui/icons'
import { conceptById, type ConceptId } from './concepts'
import { generateItem, type Difficulty, type LessonItem } from './generators'
import { ItemRunner, type ItemResult } from './ItemRunner'
import {
  buildSession,
  DAILY_GOAL,
  gradeAnswer,
  masteryOf,
  type ProgressState,
} from './mastery'

const CONFIDENCE_CONCEPTS = new Set<string>(['read.suit-inference', 'read.threat', 'defence.safe-tiles', 'defence.push-fold'])

const difficultyFor = (mastery: number): Difficulty => (mastery < 0.35 ? 1 : mastery < 0.7 ? 2 : 3)

interface QueueEntry {
  concept: ConceptId
  item: LessonItem
  requeued: boolean
}

export function SessionScreen({ progress, update, onExit }: {
  progress: ProgressState
  update: (fn: (s: ProgressState) => ProgressState) => void
  onExit: () => void
}) {
  const rng = useRef(makeRng(`session-${Date.now()}-${Math.random()}`))
  const before = useRef<Partial<Record<ConceptId, number>>>({})
  const [queue, setQueue] = useState<QueueEntry[]>(() => {
    const plan = buildSession(progress, new Date())
    return plan.entries.map(({ concept }) => {
      before.current[concept] ??= masteryOf(progress, concept)
      return {
        concept,
        item: generateItem(concept, difficultyFor(masteryOf(progress, concept)), rng.current),
        requeued: false,
      }
    })
  })
  const [idx, setIdx] = useState(0)
  const [right, setRight] = useState(0)
  const xpStart = useRef(progress.xp)

  const entry = queue[idx]
  const done = idx >= queue.length

  const handleResult = (r: ItemResult) => {
    const e = queue[idx]
    update((s) =>
      gradeAnswer(
        s,
        {
          concept: e.concept,
          correct: r.correct,
          ms: r.ms,
          difficulty: e.item.difficulty,
          ...(e.item.timeLimitMs ? { timeLimitMs: e.item.timeLimitMs } : {}),
          ...(r.confidence ? { confidence: r.confidence } : {}),
        },
        new Date(),
      ),
    )
    if (r.correct) setRight((n) => n + 1)
    else if (!e.requeued) {
      // One answer per presentation — the concept comes back later instead.
      setQueue((q) => [
        ...q,
        { concept: e.concept, item: generateItem(e.concept, difficultyFor(0.3), rng.current), requeued: true },
      ])
    }
    setIdx((i) => i + 1)
  }

  if (done) {
    const touched = [...new Set(queue.map((e) => e.concept))]
    const soonDue = touched
      .map((c) => ({ c, due: progress.concepts[c]?.due }))
      .filter((x) => x.due)
      .sort((a, b) => new Date(a.due!).getTime() - new Date(b.due!).getTime())
      .slice(0, 3)
    return (
      <div className="mx-auto flex max-w-xl flex-col gap-5 p-6">
        <h2 className="font-serif text-2xl font-semibold text-parchment">Session complete</h2>
        <div className="flex items-center gap-6 rounded-2xl border border-paper-line bg-paper-raised p-4">
          <div className="text-center">
            <div className="tabular font-serif text-3xl font-bold text-accent">{right}/{queue.length}</div>
            <div className="text-xs text-parchment-dim">correct</div>
          </div>
          <div className="text-center">
            <div className="tabular font-serif text-3xl font-bold text-parchment">+{progress.xp - xpStart.current}</div>
            <div className="text-xs text-parchment-dim">xp</div>
          </div>
          <div className="text-center">
            <div className="flex items-center justify-center gap-1 font-serif text-3xl font-bold text-consider">
              <FlameIcon className="h-6 w-6" />
              <span className="tabular">{progress.streak.count}</span>
            </div>
            <div className="text-xs text-parchment-dim">
              streak · {Math.min(progress.today.count, DAILY_GOAL)}/{DAILY_GOAL} today
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-paper-line bg-paper-raised p-4">
          <h3 className="mb-2 text-xs uppercase tracking-wide text-parchment-dim">Concepts this session</h3>
          <div className="flex flex-col gap-2">
            {touched.map((c) => {
              const b = before.current[c] ?? 0
              const a = masteryOf(progress, c)
              const up = a >= b
              return (
                <div key={c} className="flex items-center gap-2 text-sm">
                  <span className="w-44 truncate text-parchment">{conceptById.get(c)?.title ?? c}</span>
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-paper">
                    <div className="h-full rounded-full bg-safe transition-all" style={{ width: `${a * 100}%` }} />
                  </div>
                  <span className={`tabular w-14 text-right text-xs ${up ? 'text-safe' : 'text-danger'}`}>
                    {up ? '+' : ''}
                    {Math.round((a - b) * 100)}%
                  </span>
                </div>
              )
            })}
          </div>
        </div>

        {soonDue.length > 0 && (
          <div className="text-sm text-parchment-dim">
            Next reviews due:{' '}
            {soonDue.map((x) => `${conceptById.get(x.c)?.title} (${new Date(x.due!).toLocaleDateString()})`).join(' · ')}
          </div>
        )}

        <button
          className="cursor-pointer rounded-xl bg-accent px-4 py-2.5 font-semibold text-on-accent transition-colors duration-(--duration-ui) hover:brightness-110"
          onClick={onExit}
        >
          Back to the course
        </button>
      </div>
    )
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 p-4">
      <div className="flex items-center justify-between text-xs text-parchment-dim">
        <button className="cursor-pointer hover:text-parchment" onClick={onExit}>
          ← end session
        </button>
        <span className="tabular">
          {idx + 1} / {queue.length}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-paper-raised">
        <div
          className="h-full rounded-full bg-accent transition-all duration-(--duration-settle)"
          style={{ width: `${(idx / queue.length) * 100}%` }}
        />
      </div>
      <ItemRunner
        key={idx}
        item={entry.item}
        askConfidence={CONFIDENCE_CONCEPTS.has(entry.concept)}
        onDone={handleResult}
      />
    </div>
  )
}
