import { useMemo, useState } from 'react'
import { makeRng } from '../engine/rng'
import { glyph, tileName } from '../engine/tiles'
import type { TileId } from '../engine/types'
import { TileView } from '../ui/TileView'
import { generateHand, gradeDiscard, type DiscardGrade } from './efficiencyTrainer'

const VERDICT_STYLES = {
  optimal: 'border-lime-500 bg-lime-500/15 text-lime-100',
  acceptable: 'border-amber-500 bg-amber-500/15 text-amber-100',
  bad: 'border-rose-500 bg-rose-500/15 text-rose-100',
}
const VERDICT_WORDS = {
  optimal: '✓ Optimal — best shanten, widest wait.',
  acceptable: '~ Acceptable — same shanten, but a narrower wait than the best choice.',
  bad: '✗ Bad — this leaves you further from winning than you need to be.',
}

export function TrainerScreen({ onExit }: { onExit: () => void }) {
  const [target, setTarget] = useState(1)
  const [handNo, setHandNo] = useState(1)
  const [choice, setChoice] = useState<{ tile: TileId; grade: DiscardGrade } | null>(null)

  const tiles = useMemo(
    () => generateHand(target, makeRng(`trainer-${target}-${handNo}-${Math.random()}`)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [target, handNo],
  )

  const pick = (tile: TileId) => {
    if (!choice) setChoice({ tile, grade: gradeDiscard(tiles, tile) })
  }
  const nextHand = () => {
    setChoice(null)
    setHandNo((n) => n + 1)
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col items-center gap-4 p-4">
      <div className="flex w-full items-center justify-between text-sm text-emerald-300/70">
        <button className="hover:text-white cursor-pointer" onClick={onExit}>← back</button>
        <label className="flex items-center gap-2">
          difficulty:
          <select
            className="rounded bg-emerald-800 px-2 py-1 text-emerald-50"
            value={target}
            onChange={(e) => {
              setChoice(null)
              setTarget(Number(e.target.value))
            }}
          >
            <option value={0}>tenpai decisions (0-shanten)</option>
            <option value={1}>1-shanten</option>
            <option value={2}>2-shanten</option>
          </select>
        </label>
      </div>

      <h2 className="text-lg font-semibold">Tile efficiency trainer</h2>
      <p className="text-sm text-emerald-200/70">Pick the discard that keeps your hand fastest.</p>

      <div className="flex flex-wrap justify-center gap-1">
        {tiles.map((t, i) => (
          <TileView key={`${t}-${i}`} tile={t} size="lg" numbered onClick={() => pick(t)} />
        ))}
      </div>

      {choice && (
        <div className={`w-full rounded-xl border p-4 text-sm ${VERDICT_STYLES[choice.grade.verdict]}`}>
          <p className="font-bold">
            You discarded {glyph(choice.tile)} {tileName(choice.tile)} — {VERDICT_WORDS[choice.grade.verdict]}
          </p>
          <p className="mt-1">
            Best here: {choice.grade.best.map((t) => `${glyph(t)} ${tileName(t)}`).join(' or ')}.
          </p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left opacity-70">
                  <th className="py-1 pr-3">discard</th>
                  <th className="py-1 pr-3">shanten after</th>
                  <th className="py-1">live tiles</th>
                </tr>
              </thead>
              <tbody>
                {[...choice.grade.perDiscard]
                  .sort((a, b) => a.shantenAfter - b.shantenAfter || b.liveCount - a.liveCount)
                  .map((e) => (
                    <tr key={e.tile} className={e.tile === choice.tile ? 'font-bold' : ''}>
                      <td className="py-0.5 pr-3">
                        {glyph(e.tile)} {tileName(e.tile)}
                      </td>
                      <td className="py-0.5 pr-3 font-mono">
                        {e.shantenAfter === -1 ? 'win' : e.shantenAfter}
                      </td>
                      <td className="py-0.5 font-mono">{e.liveCount}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <button
            className="mt-3 rounded-lg bg-emerald-200 px-4 py-2 font-semibold text-emerald-950 hover:bg-emerald-100 cursor-pointer"
            onClick={nextHand}
          >
            Next hand →
          </button>
        </div>
      )}
    </div>
  )
}
