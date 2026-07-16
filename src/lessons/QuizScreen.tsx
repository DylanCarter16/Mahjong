// Discard-reading quiz (§4.4): one real seeded game shown at two depths
// (reads sharpen with evidence), confidence-rated answers with calibration,
// and a ground-truth reveal — the inference next to what was actually there.

import { useMemo, useState } from 'react'
import { readOpponents } from '../engine/analysis'
import { SEATS, type Seat } from '../engine/types'
import { DiscardPool, MeldRow, SEAT_NAMES } from '../ui/panels'
import { TileView } from '../ui/TileView'
import type { ConceptId } from './concepts'
import { generateProgressive, type QuizQuestion } from './discardReading'
import { gradeAnswer, type Confidence, type ProgressState } from './mastery'

const CONCEPT_FOR: Record<QuizQuestion['kind'], ConceptId> = {
  suit: 'read.suit-inference',
  safest: 'defence.safe-tiles',
  closest: 'read.threat',
  oneAway: 'read.threat',
}

const SUIT_WORDS = { m: 'characters', p: 'circles', s: 'bamboo' } as const

export function QuizScreen({ progress, update, onExit }: {
  progress: ProgressState
  update: (fn: (s: ProgressState) => ProgressState) => void
  onExit: () => void
}) {
  const [round, setRound] = useState(1)
  const [stageIdx, setStageIdx] = useState(0)
  const [qIdx, setQIdx] = useState(0)
  const [picked, setPicked] = useState<number | null>(null)
  const [confidence, setConfidence] = useState<Confidence | null>(null)
  const [revealed, setRevealed] = useState(false)
  const [phase, setPhase] = useState<'question' | 'interlude' | 'truth'>('question')
  const [score, setScore] = useState({ right: 0, total: 0 })
  const startedAt = useMemo(() => Date.now(), [round, stageIdx, qIdx]) // eslint-disable-line react-hooks/exhaustive-deps

  const quiz = useMemo(
    () => generateProgressive(`quiz-${round}-${Math.random().toString(36).slice(2)}`),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [round],
  )
  const stage = quiz.stages[stageIdx]
  const q = stage.questions[qIdx]

  const answer = (i: number) => {
    if (picked !== null) return
    setPicked(i)
  }

  const lockConfidence = (c: Confidence) => {
    if (picked === null || revealed) return
    setConfidence(c)
    setRevealed(true)
    const correct = picked === q.correct
    setScore((s) => ({ right: s.right + (correct ? 1 : 0), total: s.total + 1 }))
    update((s) =>
      gradeAnswer(
        s,
        {
          concept: CONCEPT_FOR[q.kind],
          correct,
          ms: Date.now() - startedAt,
          difficulty: 2,
          confidence: c,
          ...(c === 'certain' && !correct ? { tag: 'overconfident' } : {}),
        },
        new Date(),
      ),
    )
  }

  const next = () => {
    setPicked(null)
    setConfidence(null)
    setRevealed(false)
    if (qIdx + 1 < stage.questions.length) return setQIdx(qIdx + 1)
    if (stageIdx === 0) {
      setStageIdx(1)
      setQIdx(0)
      setPhase('interlude')
      return
    }
    setPhase('truth')
  }

  const nextRound = () => {
    setRound((r) => r + 1)
    setStageIdx(0)
    setQIdx(0)
    setPhase('question')
    setPicked(null)
    setConfidence(null)
    setRevealed(false)
  }

  const cal = progress.calibration
  const pct = (x: { right: number; total: number }) => (x.total === 0 ? '—' : `${Math.round((100 * x.right) / x.total)}%`)

  const opponents = SEATS.filter((s) => s !== 0) as Seat[]

  if (phase === 'truth') {
    const reads = readOpponents(quiz.stages[1].view)
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-4 p-4 pb-16">
        <h2 className="font-serif text-2xl font-semibold text-parchment">The reveal</h2>
        <p className="text-sm text-parchment-dim">
          Your read next to what was actually in their hands — this is the whole skill.
        </p>
        {opponents.map((seat) => {
          const read = reads.find((r) => r.seat === seat)!
          return (
            <div key={seat} className="rounded-2xl border border-paper-line bg-paper-raised p-3">
              <div className="mb-1.5 flex items-baseline justify-between">
                <span className="font-serif font-semibold text-parchment">{SEAT_NAMES[seat]}</span>
                <span className={`text-xs ${quiz.truthShanten[seat] === 0 ? 'font-bold text-danger' : 'text-parchment-dim'}`}>
                  truth: {quiz.truthShanten[seat] === 0 ? 'TENPAI' : `${quiz.truthShanten[seat]} from ready`}
                </span>
              </div>
              <div className="flex flex-wrap gap-0.5">
                {quiz.truth[seat].map((t, i) => (
                  <TileView key={i} tile={t} size="sm" numbered />
                ))}
              </div>
              <p className="mt-1.5 text-xs text-parchment-dim">
                The inference said: threat {read.threat}/3
                {read.likelyCollecting.length > 0 && read.likelyCollecting.length < 3
                  ? `, likely collecting ${read.likelyCollecting.map((s) => SUIT_WORDS[s]).join('/')}`
                  : ''}
                .
              </p>
            </div>
          )
        })}
        <div className="rounded-2xl border border-paper-line bg-paper-raised p-3 text-sm">
          <p className="mb-1 text-xs uppercase tracking-wide text-parchment-dim">Your calibration</p>
          <div className="flex gap-5">
            <span>guessing: <span className="tabular text-parchment">{pct(cal.guess)}</span></span>
            <span>fairly sure: <span className="tabular text-parchment">{pct(cal.sure)}</span></span>
            <span>certain: <span className="tabular text-parchment">{pct(cal.certain)}</span></span>
          </div>
          <p className="mt-1 text-xs text-parchment-dim">
            "Certain" answers should be right far more often than guesses — being confidently wrong is the expensive habit.
          </p>
        </div>
        <div className="flex gap-2">
          <button className="flex-1 cursor-pointer rounded-xl bg-accent px-4 py-2.5 font-semibold text-on-accent hover:brightness-110" onClick={nextRound}>
            New position
          </button>
          <button className="cursor-pointer rounded-xl bg-paper-raised px-4 py-2.5 text-parchment border border-paper-line" onClick={onExit}>
            Done
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 p-4 pb-16">
      <div className="flex items-center justify-between text-xs text-parchment-dim">
        <button className="cursor-pointer hover:text-parchment" onClick={onExit}>← back</button>
        <span>
          stage {stageIdx + 1}/2 · <span className="tabular">{score.right}/{score.total}</span> correct
        </span>
      </div>

      {phase === 'interlude' && (
        <div className="rounded-2xl border border-paper-line bg-paper-raised p-4 text-center">
          <p className="font-serif text-lg text-parchment">The game moves on…</p>
          <p className="mt-1 text-sm text-parchment-dim">
            Twelve more discards hit the table. Same opponents — how much sharper is your read now?
          </p>
          <button
            className="mt-3 cursor-pointer rounded-lg bg-accent px-4 py-2 font-semibold text-on-accent hover:brightness-110"
            onClick={() => setPhase('question')}
          >
            Show the later position
          </button>
        </div>
      )}

      {phase === 'question' && (
        <>
          <div className="grid w-full gap-2 rounded-2xl bg-felt p-3 sm:grid-cols-2">
            {opponents.map((seat) => (
              <div key={seat} className="flex flex-col items-center gap-1 rounded-xl bg-felt-deep/50 p-2">
                <span className="text-xs text-parchment-dim">
                  {SEAT_NAMES[seat]} · {stage.view.discards[seat].length} discards
                </span>
                <DiscardPool view={stage.view} seat={seat} numbered />
                <MeldRow melds={stage.view.melds[seat]} numbered small />
              </div>
            ))}
          </div>
          <div className="flex flex-wrap justify-center gap-0.5 rounded-xl bg-felt p-2">
            {stage.view.concealed.map((t, i) => (
              <TileView key={i} tile={t} size="sm" numbered />
            ))}
          </div>

          <p className="text-center font-medium text-parchment">{q.prompt}</p>
          <div className="flex w-full flex-col gap-2">
            {q.options.map((o, i) => {
              const cls = revealed
                ? i === q.correct
                  ? 'border-safe bg-safe/15'
                  : i === picked
                    ? 'border-danger bg-danger/15'
                    : 'border-paper-line bg-paper-raised opacity-60'
                : picked === i
                  ? 'border-accent bg-paper-raised'
                  : 'border-paper-line bg-paper-raised hover:border-parchment-dim'
              return (
                <button key={i} className={`cursor-pointer rounded-xl border px-4 py-2 text-left transition-colors duration-(--duration-ui) ${cls}`} onClick={() => answer(i)}>
                  {q.optionTiles?.[i] ? (
                    <span className="flex items-center gap-2">
                      <span className="w-7"><TileView tile={q.optionTiles[i]} size="sm" /></span>
                      {o}
                    </span>
                  ) : (
                    o
                  )}
                </button>
              )
            })}
          </div>

          {picked !== null && !revealed && (
            <div className="flex flex-col items-center gap-2">
              <p className="text-sm text-parchment-dim">How sure?</p>
              <div className="flex gap-2">
                {(['guess', 'sure', 'certain'] as const).map((c) => (
                  <button
                    key={c}
                    className="cursor-pointer rounded-lg border border-paper-line bg-paper-raised px-4 py-2 font-semibold text-parchment hover:border-parchment-dim"
                    onClick={() => lockConfidence(c)}
                  >
                    {c === 'guess' ? 'Guessing' : c === 'sure' ? 'Fairly sure' : 'Certain'}
                  </button>
                ))}
              </div>
            </div>
          )}

          {revealed && (
            <div className="w-full rounded-xl border border-paper-line bg-paper-raised p-4 text-sm">
              <p className={`font-bold ${picked === q.correct ? 'text-safe' : 'text-danger'}`}>
                {picked === q.correct ? 'Correct' : 'Not this time'}
                {confidence === 'certain' && picked !== q.correct && ' — and you were certain. Note that.'}
              </p>
              <p className="mt-1 text-parchment">{q.explain}</p>
              <button className="mt-3 cursor-pointer rounded-lg bg-accent px-4 py-2 font-semibold text-on-accent hover:brightness-110" onClick={next}>
                {qIdx + 1 < stage.questions.length ? 'Next question' : stageIdx === 0 ? 'Continue' : 'See the truth'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
