// Tile efficiency trainer (§4.4): full ranked table with concrete waits,
// curve grading, difficulty tiers up to safety conflicts, timed mode, and
// local error-pattern tracking from the answer log.

import { useMemo, useRef, useState } from 'react'
import { dangerScore } from '../engine/bots'
import type { PlayerView } from '../engine/game'
import { makeRng, shuffle, type Rng } from '../engine/rng'
import { ALL_PLAY_KINDS, glyph, isHonour, suitOf, tileName } from '../engine/tiles'
import type { Seat, TileId } from '../engine/types'
import { TileView } from '../ui/TileView'
import { errorClassProse } from './explain'
import { curveVerdict, generateHand, gradeDiscard, type CurveVerdict, type DiscardGrade } from './efficiencyTrainer'
import { gradeAnswer, type ProgressState } from './mastery'

const TIME_LIMIT_MS = 12_000
const THREAT_SEAT: Seat = 2

const VERDICT_STYLE: Record<CurveVerdict, { cls: string; words: string }> = {
  optimal: { cls: 'border-safe bg-safe/10', words: 'Optimal — best shanten, widest wait.' },
  'within-2-ukeire': {
    cls: 'border-consider bg-consider/10',
    words: 'Close — same shanten, within 2 live tiles of the best.',
  },
  suboptimal: {
    cls: 'border-consider bg-consider/10',
    words: 'Suboptimal — same shanten but a much narrower wait.',
  },
  blunder: { cls: 'border-danger bg-danger/10', words: 'Blunder — this moves you away from ready.' },
}

/** Expert tier: a synthetic threatening board so the efficient discard can be dangerous. */
function threatView(hand: TileId[], rng: Rng): PlayerView {
  const suit = ['m', 'p', 's'][Math.floor(rng.next() * 3)]
  const floods = shuffle(ALL_PLAY_KINDS.filter((t) => suitOf(t) === suit), rng).slice(0, 6)
  const honours = shuffle(ALL_PLAY_KINDS.filter(isHonour), rng).slice(0, 2)
  const pungKinds = shuffle(ALL_PLAY_KINDS.filter((t) => suitOf(t) !== suit && !hand.includes(t)), rng).slice(0, 2)
  const empty = () => ({ 0: [], 1: [], 2: [], 3: [] })
  return {
    seat: 0,
    seatWind: 'E',
    roundWind: 'E',
    seatWinds: { 0: 'E', 1: 'S', 2: 'W', 3: 'N' },
    concealed: hand,
    handCounts: { 0: 14, 1: 13, 2: 7, 3: 13 },
    melds: {
      0: [],
      1: [],
      2: pungKinds.map((t) => ({ type: 'pung' as const, tiles: [t, t, t], concealed: false })),
      3: [],
    },
    bonus: empty(),
    discards: { 0: [], 1: [], 2: [...floods, ...honours], 3: [] },
    wallCount: 18,
    faanMinimum: 0,
    turn: 0,
    phase: 'discard',
    pendingDiscard: null,
    lastClaimed: null,
    legal: [],
  }
}

function errorTag(grade: DiscardGrade, verdict: CurveVerdict, chosen: TileId): string | null {
  if (verdict === 'blunder') return 'broke-set'
  if (verdict === 'optimal') return null
  if (grade.best.some(isHonour) && !isHonour(chosen)) return 'kept-isolated-honour'
  return 'narrowed-wait'
}

export function TrainerScreen({ progress, update, onExit }: {
  progress: ProgressState
  update: (fn: (s: ProgressState) => ProgressState) => void
  onExit: () => void
}) {
  const [tier, setTier] = useState<1 | 2 | 3>(1)
  const [timed, setTimed] = useState(false)
  const [handNo, setHandNo] = useState(1)
  const [score, setScore] = useState(0)
  const startRef = useRef(Date.now())
  const [choice, setChoice] = useState<{
    tile: TileId
    grade: DiscardGrade
    verdict: CurveVerdict
    danger?: number
    points: number
  } | null>(null)

  const rngKey = `trainer-${tier}-${handNo}`
  const { tiles, view } = useMemo(() => {
    const rng = makeRng(`${rngKey}-${Math.random()}`)
    const hand = generateHand(tier === 3 ? 2 : tier, rng)
    startRef.current = Date.now()
    return { tiles: hand, view: tier === 3 ? threatView(hand, rng) : null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rngKey])

  const danger = (t: TileId) => (view ? dangerScore(view, t, THREAT_SEAT) : undefined)

  const pick = (tile: TileId) => {
    if (choice) return
    const ms = Date.now() - startRef.current
    const grade = gradeDiscard(tiles, tile)
    let verdict = curveVerdict(grade, tile)
    let tag = errorTag(grade, verdict, tile)
    // Expert: an "optimal" pick that feeds the threat is downgraded.
    const d = danger(tile)
    if (view && verdict === 'optimal' && d !== undefined && d >= 5) {
      const saferBest = grade.best.some((t) => (danger(t) ?? 9) <= 2)
      if (saferBest) {
        verdict = 'suboptimal'
        tag = 'fed-the-threat'
      }
    }
    const correct = verdict === 'optimal' || verdict === 'within-2-ukeire'
    const decay = timed ? Math.max(0.4, 1 - ms / TIME_LIMIT_MS) : 1
    const points = correct ? Math.round(10 * tier * decay) : 0
    setScore((s) => s + points)
    setChoice({ tile, grade, verdict, ...(d !== undefined ? { danger: d } : {}), points })
    update((s) =>
      gradeAnswer(
        s,
        {
          concept: 'efficiency.discard-choice',
          correct,
          ms,
          difficulty: tier,
          ...(timed ? { timeLimitMs: TIME_LIMIT_MS } : {}),
          ...(tag ? { tag } : {}),
        },
        new Date(),
      ),
    )
  }

  // Local error-pattern mining from the persisted answer log (§4.4).
  const patterns = useMemo(() => {
    const counts = new Map<string, number>()
    for (const a of progress.answers.slice(-120)) {
      if (a.tag) counts.set(a.tag, (counts.get(a.tag) ?? 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
  }, [progress.answers])

  const dangerWord = (d: number | undefined) =>
    d === undefined ? '' : d === 0 ? 'safe' : d <= 2 ? 'low' : d <= 4 ? 'med' : 'HIGH'

  return (
    <div className="mx-auto flex max-w-3xl flex-col items-center gap-4 p-4 pb-16">
      <div className="flex w-full flex-wrap items-center justify-between gap-2 text-sm text-parchment-dim">
        <button className="cursor-pointer hover:text-parchment" onClick={onExit}>← back</button>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5">
            tier
            <select
              className="rounded-lg border border-paper-line bg-paper-raised px-2 py-1 text-parchment"
              value={tier}
              onChange={(e) => {
                setChoice(null)
                setTier(Number(e.target.value) as 1 | 2 | 3)
              }}
            >
              <option value={1}>1 · one from ready</option>
              <option value={2}>2 · competing shapes</option>
              <option value={3}>3 · expert (threat on the table)</option>
            </select>
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={timed} onChange={(e) => setTimed(e.target.checked)} /> timed
          </label>
          <span className="tabular font-serif text-parchment">score {score}</span>
        </div>
      </div>

      <h2 className="font-serif text-xl font-semibold text-parchment">Tile efficiency trainer</h2>

      {view && (
        <div className="w-full rounded-xl border border-danger/40 bg-paper-raised p-3 text-xs text-parchment">
          <span className="font-semibold text-danger">West is threatening:</span> 2 exposed pungs, {view.discards[2].length}{' '}
          discards, 18 wall tiles left. Their pool:{' '}
          <span className="text-parchment-dim">{view.discards[2].map(glyph).join(' ')}</span>
        </div>
      )}

      <div className="flex flex-wrap justify-center gap-1 rounded-2xl bg-felt p-3">
        {tiles.map((t, i) => (
          <TileView key={`${t}-${i}`} tile={t} size="lg" numbered onClick={() => pick(t)} />
        ))}
      </div>

      {choice && (
        <div className={`w-full rounded-xl border p-4 text-sm ${VERDICT_STYLE[choice.verdict].cls}`}>
          <p className="font-bold text-parchment">
            {tileName(choice.tile)} — {VERDICT_STYLE[choice.verdict].words}
            {timed && choice.points > 0 && <span className="tabular ml-2 text-consider">+{choice.points}</span>}
          </p>
          <p className="mt-1 text-parchment-dim">
            Best here: {choice.grade.best.map(tileName).join(' or ')}.
            {choice.danger !== undefined && ` Your pick was ${dangerWord(choice.danger)} against West.`}
          </p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-parchment-dim">
                  <th className="py-1 pr-3">discard</th>
                  <th className="py-1 pr-3">shanten</th>
                  <th className="py-1 pr-3">live</th>
                  <th className="py-1 pr-3">which tiles advance</th>
                  {view && <th className="py-1">vs West</th>}
                </tr>
              </thead>
              <tbody>
                {[...choice.grade.perDiscard]
                  .sort((a, b) => a.shantenAfter - b.shantenAfter || b.liveCount - a.liveCount)
                  .map((e) => (
                    <tr key={e.tile} className={`${e.tile === choice.tile ? 'font-bold text-parchment' : 'text-parchment-dim'}`}>
                      <td className="py-0.5 pr-3">{glyph(e.tile)} {tileName(e.tile)}</td>
                      <td className="tabular py-0.5 pr-3">{e.shantenAfter === -1 ? 'win' : e.shantenAfter}</td>
                      <td className="tabular py-0.5 pr-3">{e.liveCount}</td>
                      <td className="py-0.5 pr-3">{e.advancing.map(glyph).join(' ') || '—'}</td>
                      {view && <td className="py-0.5">{dangerWord(danger(e.tile))}</td>}
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <button
            className="mt-3 cursor-pointer rounded-lg bg-accent px-4 py-2 font-semibold text-on-accent transition-colors duration-(--duration-ui) hover:brightness-110"
            onClick={() => {
              setChoice(null)
              setHandNo((n) => n + 1)
            }}
          >
            Next hand
          </button>
        </div>
      )}

      {patterns.length > 0 && (
        <div className="w-full rounded-xl border border-paper-line bg-paper-raised p-3 text-xs">
          <p className="mb-1 font-semibold uppercase tracking-wide text-parchment-dim">Your patterns</p>
          {patterns.map(([tag, n]) => (
            <p key={tag} className="mt-1 text-parchment-dim">
              <span className="tabular text-parchment">{n}×</span> {errorClassProse(tag) ?? tag}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}
