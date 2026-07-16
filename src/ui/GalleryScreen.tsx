// §5.6 design gate: every tile face at three sizes and every state, on both
// surfaces. If the tiles don't look right here, nothing built on them will.

import { useState } from 'react'
import { ALL_PLAY_KINDS, BONUS_KINDS, tileName } from '../engine/tiles'
import { TileDefs } from './tiles/TileFace'
import { TileView, type TileState } from './TileView'

const STATES: TileState[] = ['normal', 'dimmed', 'highlighted', 'safe', 'danger', 'selected']

export function GalleryScreen() {
  const [numbered, setNumbered] = useState(true)

  return (
    <div className="felt-surface min-h-screen pb-24 text-parchment">
      <TileDefs />
      <div className="relative z-10 mx-auto max-w-5xl px-6 pt-10">
        <h1 className="font-serif text-3xl font-semibold text-ivory">Tile gallery</h1>
        <p className="mt-1 text-sm text-parchment-dim">
          Design gate for Phase 1.5 §5.6 — all 42 faces, three sizes, every state, both surfaces.
        </p>
        <label className="mt-4 inline-flex items-center gap-2 text-sm">
          <input type="checkbox" checked={numbered} onChange={(e) => setNumbered(e.target.checked)} />
          rank overlay (beginner toggle)
        </label>

        <h2 className="mt-8 font-serif text-xl text-ivory">All faces — md</h2>
        {(['m', 'p', 's'] as const).map((suit) => (
          <div key={suit} className="mt-3 flex flex-wrap gap-1.5">
            {ALL_PLAY_KINDS.filter((t) => t[0] === suit).map((t) => (
              <TileView key={t} tile={t} size="md" numbered={numbered} title={tileName(t)} />
            ))}
          </div>
        ))}
        <div className="mt-3 flex flex-wrap gap-1.5">
          {ALL_PLAY_KINDS.filter((t) => t[0] === 'w' || t[0] === 'd').map((t) => (
            <TileView key={t} tile={t} size="md" numbered={numbered} />
          ))}
          <span className="w-4" />
          <TileView tile={null} size="md" />
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {BONUS_KINDS.map((t) => (
            <TileView key={t} tile={t} size="md" />
          ))}
        </div>

        <h2 className="mt-10 font-serif text-xl text-ivory">Sizes</h2>
        <div className="mt-3 flex items-end gap-4">
          {(['sm', 'md', 'lg'] as const).map((size) => (
            <div key={size} className="flex flex-col items-center gap-1">
              <div className="flex gap-1">
                <TileView tile="m5" size={size} numbered={numbered} />
                <TileView tile="p7" size={size} numbered={numbered} />
                <TileView tile="s3" size={size} numbered={numbered} />
                <TileView tile="dR" size={size} />
              </div>
              <span className="text-xs text-parchment-dim">{size}</span>
            </div>
          ))}
        </div>

        <h2 className="mt-10 font-serif text-xl text-ivory">States</h2>
        <div className="mt-3 flex flex-wrap gap-6">
          {STATES.map((state) => (
            <div key={state} className="flex flex-col items-center gap-2 pt-2">
              <TileView tile="p5" size="lg" numbered={numbered} state={state} />
              <span className="text-xs text-parchment-dim">{state}</span>
            </div>
          ))}
        </div>

        <h2 className="mt-10 font-serif text-xl text-ivory">On the lessons surface</h2>
        <div className="mt-3 rounded-2xl bg-paper p-6">
          <div className="flex flex-wrap gap-1.5">
            {['m1', 'm9', 'p1', 'p5', 's1', 's9', 'wE', 'dR', 'dG', 'dW'].map((t) => (
              <TileView key={t} tile={t} size="md" numbered={numbered} />
            ))}
          </div>
          <p className="mt-3 text-xs" style={{ color: 'var(--color-parchment-dim)' }}>
            Calmer surface, same tokens — the course room next to the game room.
          </p>
        </div>
      </div>
    </div>
  )
}
