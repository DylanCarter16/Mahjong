// Procedural SVG tile faces (§5.3). Circles and bamboo are drawn from layout
// tables; characters/winds/dragons use the self-hosted Noto Serif TC subset
// (see theme.css) so every device renders the same face — no system fonts,
// no emoji-presentation surprises. All colours come from design tokens.

import { rankOf, suitOf, tileName } from '../../engine/tiles'
import type { TileId } from '../../engine/types'
import { BAMBOO_LAYOUTS, CIRCLE_LAYOUTS, NUMERALS, WIND_CHARS, type Pigment } from './layouts'

const PIGMENT: Record<Pigment, string> = {
  red: 'var(--color-tile-red)',
  green: 'var(--color-tile-green)',
  blue: 'var(--color-tile-blue)',
  ink: 'var(--color-ink)',
}

/** Render once per screen; the face gradient the tiles reference by id. */
export function TileDefs() {
  return (
    <svg width="0" height="0" aria-hidden className="absolute">
      <defs>
        <linearGradient id="tile-face" x1="0" y1="0" x2="0" y2="1">
          {/* lit from above: cooler/brighter top, warmer bottom */}
          <stop offset="0" stopColor="var(--color-ivory-bright)" />
          <stop offset="0.45" stopColor="var(--color-ivory)" />
          <stop offset="1" stopColor="var(--color-ivory-warm)" />
        </linearGradient>
        <linearGradient id="tile-back" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--color-felt-light)" />
          <stop offset="1" stopColor="var(--color-felt-deep)" />
        </linearGradient>
      </defs>
    </svg>
  )
}

function FaceBase({ children }: { children?: React.ReactNode }) {
  return (
    <>
      <rect x="1" y="1" width="58" height="82" rx="7" fill="url(#tile-face)" stroke="var(--color-ivory-edge)" strokeWidth="1.2" />
      {/* 2px-relief light model: bevel highlight up top, cooler under-edge below */}
      <path d="M 8 3.2 H 52" stroke="var(--color-ivory-bright)" strokeWidth="1.6" strokeLinecap="round" opacity="0.9" />
      <path d="M 8 80.8 H 52" stroke="var(--color-ivory-under)" strokeWidth="1.4" strokeLinecap="round" opacity="0.45" />
      {children}
    </>
  )
}

function CircleDots({ rank }: { rank: number }) {
  if (rank === 1) {
    return (
      <g>
        <circle cx="30" cy="42" r="17" fill="none" stroke="var(--color-tile-red)" strokeWidth="3.2" />
        <circle cx="30" cy="42" r="11.2" fill="none" stroke="var(--color-tile-blue)" strokeWidth="2.4" />
        <circle cx="30" cy="42" r="5.6" fill="var(--color-tile-red)" />
        {Array.from({ length: 8 }, (_, i) => {
          const a = (i * Math.PI) / 4
          return (
            <circle
              key={i}
              cx={30 + 14.2 * Math.cos(a)}
              cy={42 + 14.2 * Math.sin(a)}
              r="1.5"
              fill="var(--color-tile-green)"
            />
          )
        })}
      </g>
    )
  }
  return (
    <g>
      {CIRCLE_LAYOUTS[rank].map((d, i) => (
        <g key={i}>
          <circle cx={d.cx} cy={d.cy} r={d.r} fill={PIGMENT[d.color]} />
          <circle cx={d.cx} cy={d.cy} r={d.r * 0.58} fill="var(--color-ivory-bright)" />
          <circle cx={d.cx} cy={d.cy} r={d.r * 0.24} fill={PIGMENT[d.color]} />
        </g>
      ))}
    </g>
  )
}

function BambooSticks({ rank }: { rank: number }) {
  if (rank === 1) return <BirdOne />
  return (
    <g>
      {BAMBOO_LAYOUTS[rank].map((s, i) => (
        <g key={i}>
          <rect x={s.cx - 3.4} y={s.cy - 10} width="6.8" height="20" rx="3" fill={PIGMENT[s.color]} />
          <rect x={s.cx - 3.4} y={s.cy - 4} width="6.8" height="1.7" fill="var(--color-ivory-warm)" />
          <rect x={s.cx - 3.4} y={s.cy + 2.5} width="6.8" height="1.7" fill="var(--color-ivory-warm)" />
          <circle cx={s.cx} cy={s.cy - 10} r="1.6" fill={PIGMENT[s.color]} />
          <circle cx={s.cx} cy={s.cy + 10} r="1.6" fill={PIGMENT[s.color]} />
        </g>
      ))}
    </g>
  )
}

/** 1索 — traditionally a bird. Hand-authored stylised sparrow on a perch. */
function BirdOne() {
  return (
    <g>
      {/* tail feathers */}
      <path d="M 20 46 L 9 55 L 14 44 L 8 46 L 17 39 Z" fill="var(--color-tile-green)" />
      {/* body */}
      <path d="M 17 40 C 17 29 27 22 34 25 C 43 28 45 39 40 47 C 36 53 26 54 21 49 C 18 46 17 43 17 40 Z" fill="var(--color-tile-green)" />
      {/* wing */}
      <path d="M 24 38 C 28 33 36 33 38 38 C 35 42 28 43 24 38 Z" fill="var(--color-ivory-bright)" opacity="0.85" />
      {/* head */}
      <circle cx="38.5" cy="27.5" r="6.2" fill="var(--color-tile-green)" />
      <circle cx="40.5" cy="26" r="1.3" fill="var(--color-ivory-bright)" />
      {/* beak */}
      <path d="M 44 26 L 50 28.5 L 44 30.5 Z" fill="var(--color-tile-red)" />
      {/* legs */}
      <path d="M 28 52 L 27 60 M 34 52 L 34 60" stroke="var(--color-tile-red)" strokeWidth="1.8" strokeLinecap="round" />
      {/* perch */}
      <rect x="14" y="60" width="32" height="4.6" rx="2.3" fill="var(--color-tile-red)" />
      <rect x="14" y="61.6" width="32" height="0.9" fill="var(--color-ivory-warm)" opacity="0.7" />
    </g>
  )
}

const CJK = {
  fontFamily: 'var(--font-tiles)',
  fontWeight: 700,
} as const

function CharacterFace({ rank }: { rank: number }) {
  return (
    <g style={CJK} textAnchor="middle">
      <text x="30" y="37" fontSize="27" fill="var(--color-ink)">
        {NUMERALS[rank - 1]}
      </text>
      <text x="30" y="72" fontSize="27" fill="var(--color-tile-red)">
        萬
      </text>
    </g>
  )
}

function WhiteDragon() {
  // 白 is traditionally a blue frame — a blank face reads as a bug.
  return (
    <g>
      <rect x="11" y="14" width="38" height="56" rx="4" fill="none" stroke="var(--color-tile-blue)" strokeWidth="3" />
      <rect x="17" y="20" width="26" height="44" rx="2.5" fill="none" stroke="var(--color-tile-blue)" strokeWidth="1.6" />
    </g>
  )
}

const SEASON_TINT: string[] = [
  'var(--color-tile-green)', // spring
  'var(--color-tile-red)', // summer
  'var(--color-consider)', // autumn
  'var(--color-tile-blue)', // winter
]

function BonusFace({ kind, index }: { kind: 'f' | 's'; index: number }) {
  return (
    <g>
      {kind === 'f' ? (
        <g>
          {Array.from({ length: 5 }, (_, i) => {
            const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5
            return (
              <circle
                key={i}
                cx={30 + 9.5 * Math.cos(a)}
                cy={44 + 9.5 * Math.sin(a)}
                r="6"
                fill="var(--color-tile-red)"
                opacity="0.88"
              />
            )
          })}
          <circle cx="30" cy="44" r="4.6" fill="var(--color-accent)" />
        </g>
      ) : (
        <g>
          <circle cx="30" cy="46" r="11" fill={SEASON_TINT[index - 1]} />
          <circle cx="30" cy="46" r="6.5" fill="var(--color-ivory-bright)" />
          <path d="M 14 60 Q 30 52 46 60" fill="none" stroke={SEASON_TINT[index - 1]} strokeWidth="2.4" strokeLinecap="round" />
        </g>
      )}
      <text
        x="12"
        y="20"
        textAnchor="middle"
        fontSize="12"
        style={{ fontFamily: 'var(--font-serif)', fontWeight: 700 }}
        fill={kind === 'f' ? 'var(--color-tile-red)' : 'var(--color-tile-blue)'}
      >
        {index}
      </text>
    </g>
  )
}

export function TileFace({ tile, showRank = false }: { tile: TileId; showRank?: boolean }) {
  const suit = suitOf(tile)
  const rank = rankOf(tile)

  let face: React.ReactNode
  if (suit === 'p') face = <CircleDots rank={rank!} />
  else if (suit === 's') face = <BambooSticks rank={rank!} />
  else if (suit === 'm') face = <CharacterFace rank={rank!} />
  else if (tile[0] === 'w')
    face = (
      <text x="30" y="56" textAnchor="middle" fontSize="40" fill="var(--color-ink)" style={CJK}>
        {WIND_CHARS[tile[1]]}
      </text>
    )
  else if (tile === 'dR')
    face = (
      <text x="30" y="56" textAnchor="middle" fontSize="40" fill="var(--color-tile-red)" style={CJK}>
        中
      </text>
    )
  else if (tile === 'dG')
    face = (
      <text x="30" y="56" textAnchor="middle" fontSize="40" fill="var(--color-tile-green)" style={CJK}>
        發
      </text>
    )
  else if (tile === 'dW') face = <WhiteDragon />
  else face = <BonusFace kind={tile[1] as 'f' | 's'} index={Number(tile[2])} />

  return (
    <svg viewBox="0 0 60 84" role="img" aria-label={tileName(tile)} className="block h-full w-full">
      <FaceBase>
        {face}
        {showRank && suit !== null && (
          <text
            x="7.5"
            y="13"
            fontSize="11"
            fill="var(--color-ink)"
            opacity="0.55"
            style={{ fontFamily: 'var(--font-serif)', fontWeight: 700 }}
          >
            {rank}
          </text>
        )}
      </FaceBase>
    </svg>
  )
}

/** A face-down tile back. */
export function TileBack() {
  return (
    <svg viewBox="0 0 60 84" role="img" aria-label="face-down tile" className="block h-full w-full">
      <rect x="1" y="1" width="58" height="82" rx="7" fill="url(#tile-back)" stroke="var(--color-felt-deep)" strokeWidth="1.2" />
      <rect x="6" y="6" width="48" height="72" rx="4" fill="none" stroke="var(--color-ivory-edge)" strokeWidth="0.8" opacity="0.22" />
      <path d="M 30 32 L 39 42 L 30 52 L 21 42 Z" fill="none" stroke="var(--color-ivory-edge)" strokeWidth="1" opacity="0.3" />
    </svg>
  )
}
