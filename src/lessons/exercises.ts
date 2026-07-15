// Lesson units. Every correctness decision is computed by the engine at
// generation time or checked through an engine validator at answer time —
// lessons never re-encode a rule.

import { scoreBest } from '../engine/fan'
import { glyph, hand, tileName } from '../engine/tiles'
import type { TileId } from '../engine/types'
import { decompose, isValidChow, isValidKong, isValidPung, isWinningHand } from '../engine/win'
import { generatePosition } from './discardReading'

export type Exercise =
  | {
      kind: 'choice'
      prompt: string
      showTiles?: TileId[]
      options: string[]
      correct: number
      explain: string
      /** Seconds allowed (tile-recognition drills are timed). */
      timed?: number
    }
  | {
      kind: 'build'
      prompt: string
      pool: TileId[]
      pick: number
      validate: (sel: TileId[]) => boolean
      explain: string
    }

export interface Unit {
  id: number
  title: string
  blurb: string
  exercises: () => Exercise[]
}

const tileChoice = (tile: TileId, wrong: TileId[], timed?: number): Exercise => {
  const options = [tile, ...wrong]
  // stable rotation keeps the correct answer from always sitting first
  const rot = tile.charCodeAt(1) % options.length
  const rotated = [...options.slice(rot), ...options.slice(0, rot)]
  return {
    kind: 'choice',
    prompt: 'What is this tile?',
    showTiles: [tile],
    options: rotated.map(tileName),
    correct: rotated.indexOf(tile),
    explain: `${glyph(tile)} is ${tileName(tile)}.`,
    timed,
  }
}

/** Faan total for a concealed hand won by discard, default winds. */
const faanOf = (tiles: string): number =>
  scoreBest(decompose(hand(tiles), []), {
    seatWind: 'S',
    roundWind: 'E',
    selfDraw: false,
    flowers: [],
    fullyConcealed: false,
    lastWallTile: false,
    kongReplacement: false,
  }).totalFaan

const ORPHAN_12 = 'm1 m9 s1 s9 p1 p9 wE wS wW wN dR dG'

export const UNITS: Unit[] = [
  {
    id: 1,
    title: 'Tiles & suits',
    blurb: 'Learn to read all 42 tile faces — fast. These are timed.',
    exercises: () => [
      tileChoice('m3', ['s3', 'p3', 'm7'], 10),
      tileChoice('p7', ['s7', 'm7', 'p2'], 10),
      tileChoice('s5', ['p5', 'm5', 's6'], 10),
      tileChoice('wN', ['wE', 'wS', 'wW'], 10),
      tileChoice('dG', ['dR', 'dW', 'wE'], 8),
      tileChoice('bf2', ['bs2', 'bf3', 'bs1'], 8),
    ],
  },
  {
    id: 2,
    title: 'Sets: chow, pung, kong',
    blurb: 'The three building blocks of every hand.',
    exercises: () => [
      {
        kind: 'build',
        prompt: 'Build a CHOW (three consecutive tiles, one suit) from these tiles.',
        pool: hand('m4 m5 m6 m9 p2 wE'),
        pick: 3,
        validate: isValidChow,
        explain: '4-5-6 of Characters is the only run here. Honours never form chows.',
      },
      {
        kind: 'build',
        prompt: 'Build a PUNG (three identical tiles).',
        pool: hand('s7 s7 s7 s2 m1 dR'),
        pick: 3,
        validate: isValidPung,
        explain: 'Three 7 of Bamboo. Any tile kind can pung — including honours.',
      },
      {
        kind: 'build',
        prompt: 'Build a KONG (all four copies of one tile).',
        pool: hand('p3 p3 p3 p3 m8 wS'),
        pick: 4,
        validate: isValidKong,
        explain: 'All four 3 of Circles. A kong earns a replacement tile from the dead wall.',
      },
      {
        kind: 'choice',
        prompt: 'Which of these is NOT a valid chow?',
        options: ['2-3-4 of Bamboo', '7-8-9 of Circles', '8-9-1 of Circles', '1-2-3 of Characters'],
        correct: 2,
        explain: 'Runs never wrap around the end: 9 is followed by nothing, so 8-9-1 is illegal.',
      },
    ],
  },
  {
    id: 3,
    title: 'The winning shape',
    blurb: 'Four sets plus a pair — 14 tiles that fit together.',
    exercises: () => {
      const winning = 'm1 m2 m3 p4 p5 p6 s7 s8 s9 wE wE wE dR dR'
      const waits = hand('m1 m2 m3 p4 p5 p6 s7 s8 s9 wE wE wE dR')
      const candidates: TileId[] = ['dR', 'm5', 's1', 'wS']
      const correct = candidates.findIndex((c) => isWinningHand([...waits, c], []))
      return [
        {
          kind: 'choice',
          prompt: 'A standard winning hand is…',
          options: ['4 sets + 1 pair', '5 sets', '7 pairs only', 'any 14 tiles of one suit'],
          correct: 0,
          explain:
            'Four sets (chows/pungs/kongs) plus one pair = 14 tiles. Seven Pairs and Thirteen Orphans are the only other shapes.',
        },
        {
          kind: 'build',
          prompt: 'Select the 14 tiles that form a winning hand (two of these tiles are junk).',
          pool: hand(`${winning} m9 s1`),
          pick: 14,
          validate: (sel) => isWinningHand(sel, []),
          explain: 'Three chows + a pung of East winds + a pair of Red Dragons.',
        },
        {
          kind: 'choice',
          prompt: 'This hand is one tile from winning. Which tile completes it?',
          showTiles: waits,
          options: candidates.map((c) => `${glyph(c)} ${tileName(c)}`),
          correct,
          explain: 'The hand already has four complete sets — it only needs the second Red Dragon to pair.',
        },
      ]
    },
  },
  {
    id: 4,
    title: 'Special hands',
    blurb: 'Seven Pairs and Thirteen Orphans — the two non-standard shapes.',
    exercises: () => {
      const candidates: TileId[] = ['dW', 'm5', 'p2', 'wE']
      const correct = candidates.findIndex((c) =>
        isWinningHand([...hand(`${ORPHAN_12} m1`), c], []),
      )
      return [
        {
          kind: 'choice',
          prompt: 'Seven Pairs: does m1 m1 m1 m1 + five other pairs win?',
          showTiles: hand('m1 m1 m1 m1 m3 m3 s2 s2 s4 s4 p6 p6 wE wE'),
          options: ['Yes — four of a kind counts as two pairs', 'No — the seven pairs must be distinct'],
          correct: 1,
          explain:
            'Under our (common) rule a four-of-a-kind is NOT two pairs: Seven Pairs needs seven different pairs.',
        },
        {
          kind: 'choice',
          prompt: 'Thirteen Orphans needs one of each terminal and honour, plus a duplicate. Which tile completes this hand?',
          showTiles: hand(`${ORPHAN_12} m1`),
          options: candidates.map((c) => `${glyph(c)} ${tileName(c)}`),
          correct,
          explain: 'Every 1, 9, wind and dragon is present except the White Dragon — m1 is already the duplicate.',
        },
      ]
    },
  },
  {
    id: 5,
    title: 'Faan & the minimum',
    blurb: 'Why a complete hand sometimes cannot be declared.',
    exercises: () => {
      const mixed = 's1 s2 s3 s5 s5 s5 s9 s9 s9 wW wW wW s7 s7'
      const mixedFaan = faanOf(mixed)
      const chicken = 'm1 m2 m3 s4 s5 s6 p7 p7 p7 m7 m8 m9 s2 s2'
      return [
        {
          kind: 'choice',
          prompt: 'This hand (won by discard) is Mixed One Suit. How many faan is it worth?',
          showTiles: hand(mixed),
          options: ['1', String(mixedFaan), '7', '13'],
          correct: 1,
          explain: `One suit plus honours = Mixed One Suit, worth ${mixedFaan} faan in our table.`,
        },
        {
          kind: 'choice',
          prompt: `This "chicken hand" is complete but worth ${faanOf(chicken)} faan. The table minimum is 3. Can you declare it?`,
          showTiles: hand(chicken),
          options: ['Yes — complete is complete', 'No — it is below the minimum'],
          correct: 1,
          explain:
            'Below the minimum a complete hand cannot be declared. You must keep playing and add value (or wait for a scoring condition like self-draw).',
        },
        {
          kind: 'choice',
          prompt: 'Same hand, but your family plays a 0 faan minimum. Now can you declare it?',
          options: ['Yes — any complete hand wins', 'No'],
          correct: 0,
          explain: 'With a 0 minimum every complete hand may be declared. Set this in Settings → Minimum faan.',
        },
      ]
    },
  },
  {
    id: 6,
    title: 'Reading discards',
    blurb: 'What opponents throw away tells you what they keep.',
    exercises: () =>
      generatePosition('lesson-reading', 24).questions.map(
        (q): Exercise => ({
          kind: 'choice',
          prompt: q.prompt,
          options: q.options,
          correct: q.correct,
          explain: q.explain,
        }),
      ),
  },
  {
    id: 7,
    title: 'Defence',
    blurb: 'Safe tiles, dangerous tiles, and when to stop pushing.',
    exercises: () => {
      const pos = generatePosition('lesson-defence', 28)
      const safest = pos.questions.filter((q) => q.kind === 'safest')
      return [
        {
          kind: 'choice',
          prompt: 'Which tile is ALWAYS safe against a given opponent?',
          options: [
            'A tile they have already discarded',
            'A middle tile like 5 of Circles',
            'A dragon',
            'The tile you just drew',
          ],
          correct: 0,
          explain:
            'They cannot be waiting on a tile they threw away themselves. Middle tiles are the most dangerous — they connect to the most waits.',
        },
        {
          kind: 'choice',
          prompt: 'An opponent has two exposed pungs, few discards, and the wall is running low. You are 2-shanten. What now?',
          options: [
            'Fold: discard only safe tiles',
            'Push: keep the most efficient discard',
            'Declare a kong for luck',
          ],
          correct: 0,
          explain:
            'A loud board against a far-from-ready hand is exactly when to fold. Losing less is winning more.',
        },
        ...safest.map(
          (q): Exercise => ({
            kind: 'choice',
            prompt: q.prompt,
            options: q.options,
            correct: q.correct,
            explain: q.explain,
          }),
        ),
      ]
    },
  },
  {
    id: 8,
    title: 'Guided half-game',
    blurb: 'Put it together at the table, with the beginner aids switched on.',
    exercises: () => [
      {
        kind: 'choice',
        prompt: 'In the Play tab with beginner aids on, the amber ring on a tile means…',
        options: [
          'The suggested discard (best shanten, most live tiles)',
          'A dangerous tile',
          'A tile you must never discard',
        ],
        correct: 0,
        explain:
          'The ring marks the engine-suggested discard; hover any tile to see what discarding it does to your shanten and live-tile count. Now go play a round or two with the aids on — then come back and try the drills below.',
      },
    ],
  },
]
