import { useMemo, useState } from 'react'
import { SEATS } from '../engine/types'
import { DiscardPool, MeldRow, SEAT_NAMES } from '../ui/panels'
import { TileView } from '../ui/TileView'
import { generatePosition } from './discardReading'

export function QuizScreen({ onExit }: { onExit: () => void }) {
  const [round, setRound] = useState(1)
  const [qIdx, setQIdx] = useState(0)
  const [answer, setAnswer] = useState<number | null>(null)
  const [score, setScore] = useState({ right: 0, total: 0 })

  const position = useMemo(
    () => generatePosition(`quiz-${round}-${Math.random().toString(36).slice(2)}`),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [round],
  )
  const q = position.questions[qIdx]

  const respond = (i: number) => {
    if (answer !== null) return
    setAnswer(i)
    setScore((s) => ({ right: s.right + (i === q.correct ? 1 : 0), total: s.total + 1 }))
  }
  const next = () => {
    setAnswer(null)
    if (qIdx + 1 < position.questions.length) setQIdx(qIdx + 1)
    else {
      setQIdx(0)
      setRound((r) => r + 1)
    }
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col items-center gap-4 p-4">
      <div className="flex w-full items-center justify-between text-sm text-emerald-300/70">
        <button className="hover:text-white cursor-pointer" onClick={onExit}>← back</button>
        <span className="font-mono">
          {score.right}/{score.total} correct
        </span>
      </div>
      <h2 className="text-lg font-semibold">Discard-reading quiz</h2>
      <p className="text-sm text-emerald-200/70">A real mid-game position. Read the pools.</p>

      <div className="grid w-full gap-3 rounded-2xl bg-emerald-800/40 p-4 sm:grid-cols-2">
        {SEATS.filter((s) => s !== 0).map((seat) => (
          <div key={seat} className="flex flex-col items-center gap-1 rounded-xl bg-emerald-900/50 p-2">
            <span className="text-xs text-emerald-200/80">
              {SEAT_NAMES[seat]} — {position.view.discards[seat].length} discards
            </span>
            <DiscardPool view={position.view} seat={seat} numbered />
            <MeldRow melds={position.view.melds[seat]} numbered />
          </div>
        ))}
      </div>

      <div className="flex flex-col items-center gap-1">
        <span className="text-xs text-emerald-200/80">Your hand</span>
        <div className="flex flex-wrap justify-center gap-0.5">
          {position.view.concealed.map((t, i) => (
            <TileView key={i} tile={t} size="md" numbered />
          ))}
        </div>
      </div>

      <p className="text-center font-medium">{q.prompt}</p>
      <div className="flex w-full max-w-md flex-col gap-2">
        {q.options.map((o, i) => {
          const cls =
            answer === null
              ? 'bg-emerald-900 border-emerald-700 hover:bg-emerald-800'
              : i === q.correct
                ? 'bg-lime-500/30 border-lime-400'
                : i === answer
                  ? 'bg-rose-500/30 border-rose-400'
                  : 'bg-emerald-900 border-emerald-700 opacity-60'
          return (
            <button key={i} className={`rounded-lg border px-4 py-2 text-left cursor-pointer ${cls}`} onClick={() => respond(i)}>
              {o}
            </button>
          )
        })}
      </div>
      {answer !== null && (
        <div className="w-full max-w-md rounded-xl border border-emerald-600 bg-emerald-900/70 p-4 text-sm">
          <p>{q.explain}</p>
          <button
            className="mt-3 rounded-lg bg-emerald-200 px-4 py-2 font-semibold text-emerald-950 hover:bg-emerald-100 cursor-pointer"
            onClick={next}
          >
            {qIdx + 1 < position.questions.length ? 'Next question →' : 'New position →'}
          </button>
        </div>
      )}
    </div>
  )
}
