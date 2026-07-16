// Layout tables for procedural tile faces (viewBox 0 0 60 84).
// Colouring follows common tile-set tradition where sets agree and picks a
// consistent stylistic rule where they don't (documented per suit below);
// values are pigment token names resolved in TileFace.

export type Pigment = 'red' | 'green' | 'blue' | 'ink'

export interface Dot {
  cx: number
  cy: number
  r: number
  color: Pigment
}

// Circles 筒 — 2..9 as dot arrangements; 1筒 is the big rosette (special-cased).
// Tradition: red appears at 1 (rosette), 5 (centre), 7 (top diagonal).
export const CIRCLE_LAYOUTS: Record<number, Dot[]> = {
  2: [
    { cx: 30, cy: 26, r: 9, color: 'blue' },
    { cx: 30, cy: 58, r: 9, color: 'green' },
  ],
  3: [
    { cx: 17, cy: 21, r: 8, color: 'blue' },
    { cx: 30, cy: 42, r: 8, color: 'red' },
    { cx: 43, cy: 63, r: 8, color: 'green' },
  ],
  4: [
    { cx: 19, cy: 24, r: 8, color: 'blue' },
    { cx: 41, cy: 24, r: 8, color: 'green' },
    { cx: 19, cy: 60, r: 8, color: 'green' },
    { cx: 41, cy: 60, r: 8, color: 'blue' },
  ],
  5: [
    { cx: 17, cy: 22, r: 7.5, color: 'blue' },
    { cx: 43, cy: 22, r: 7.5, color: 'green' },
    { cx: 30, cy: 42, r: 7, color: 'red' },
    { cx: 17, cy: 62, r: 7.5, color: 'green' },
    { cx: 43, cy: 62, r: 7.5, color: 'blue' },
  ],
  6: [
    { cx: 19, cy: 20, r: 7, color: 'green' },
    { cx: 41, cy: 20, r: 7, color: 'green' },
    { cx: 19, cy: 42, r: 7, color: 'red' },
    { cx: 41, cy: 42, r: 7, color: 'red' },
    { cx: 19, cy: 64, r: 7, color: 'red' },
    { cx: 41, cy: 64, r: 7, color: 'red' },
  ],
  7: [
    { cx: 14, cy: 15, r: 5.5, color: 'red' },
    { cx: 27, cy: 19, r: 5.5, color: 'red' },
    { cx: 40, cy: 23, r: 5.5, color: 'red' },
    { cx: 19, cy: 46, r: 7, color: 'blue' },
    { cx: 41, cy: 46, r: 7, color: 'blue' },
    { cx: 19, cy: 66, r: 7, color: 'blue' },
    { cx: 41, cy: 66, r: 7, color: 'blue' },
  ],
  8: [
    { cx: 20, cy: 17, r: 6.5, color: 'blue' },
    { cx: 40, cy: 17, r: 6.5, color: 'blue' },
    { cx: 20, cy: 34, r: 6.5, color: 'blue' },
    { cx: 40, cy: 34, r: 6.5, color: 'blue' },
    { cx: 20, cy: 51, r: 6.5, color: 'blue' },
    { cx: 40, cy: 51, r: 6.5, color: 'blue' },
    { cx: 20, cy: 68, r: 6.5, color: 'blue' },
    { cx: 40, cy: 68, r: 6.5, color: 'blue' },
  ],
  9: [
    { cx: 16, cy: 20, r: 6, color: 'green' },
    { cx: 30, cy: 20, r: 6, color: 'green' },
    { cx: 44, cy: 20, r: 6, color: 'green' },
    { cx: 16, cy: 42, r: 6, color: 'red' },
    { cx: 30, cy: 42, r: 6, color: 'red' },
    { cx: 44, cy: 42, r: 6, color: 'red' },
    { cx: 16, cy: 64, r: 6, color: 'blue' },
    { cx: 30, cy: 64, r: 6, color: 'blue' },
    { cx: 44, cy: 64, r: 6, color: 'blue' },
  ],
}

export interface Stick {
  cx: number
  cy: number // centre of the stick
  color: Pigment
}

// Bamboo 索 — 2..9 as stick arrangements; 1索 is the bird (special-cased).
// Tradition: red sticks at 5 (centre), 7 (top), 9 (middle row).
export const BAMBOO_LAYOUTS: Record<number, Stick[]> = {
  2: [
    { cx: 30, cy: 26, color: 'green' },
    { cx: 30, cy: 58, color: 'green' },
  ],
  3: [
    { cx: 30, cy: 22, color: 'green' },
    { cx: 20, cy: 60, color: 'green' },
    { cx: 40, cy: 60, color: 'green' },
  ],
  4: [
    { cx: 20, cy: 24, color: 'green' },
    { cx: 40, cy: 24, color: 'green' },
    { cx: 20, cy: 60, color: 'green' },
    { cx: 40, cy: 60, color: 'green' },
  ],
  5: [
    { cx: 18, cy: 22, color: 'green' },
    { cx: 42, cy: 22, color: 'green' },
    { cx: 30, cy: 42, color: 'red' },
    { cx: 18, cy: 62, color: 'green' },
    { cx: 42, cy: 62, color: 'green' },
  ],
  6: [
    { cx: 17, cy: 26, color: 'green' },
    { cx: 30, cy: 26, color: 'green' },
    { cx: 43, cy: 26, color: 'green' },
    { cx: 17, cy: 58, color: 'green' },
    { cx: 30, cy: 58, color: 'green' },
    { cx: 43, cy: 58, color: 'green' },
  ],
  7: [
    { cx: 30, cy: 17, color: 'red' },
    { cx: 17, cy: 42, color: 'green' },
    { cx: 30, cy: 42, color: 'green' },
    { cx: 43, cy: 42, color: 'green' },
    { cx: 17, cy: 66, color: 'green' },
    { cx: 30, cy: 66, color: 'green' },
    { cx: 43, cy: 66, color: 'green' },
  ],
  8: [
    { cx: 15, cy: 24, color: 'green' },
    { cx: 25, cy: 24, color: 'green' },
    { cx: 35, cy: 24, color: 'green' },
    { cx: 45, cy: 24, color: 'green' },
    { cx: 15, cy: 60, color: 'green' },
    { cx: 25, cy: 60, color: 'green' },
    { cx: 35, cy: 60, color: 'green' },
    { cx: 45, cy: 60, color: 'green' },
  ],
  9: [
    { cx: 17, cy: 20, color: 'green' },
    { cx: 30, cy: 20, color: 'green' },
    { cx: 43, cy: 20, color: 'green' },
    { cx: 17, cy: 42, color: 'red' },
    { cx: 30, cy: 42, color: 'red' },
    { cx: 43, cy: 42, color: 'red' },
    { cx: 17, cy: 64, color: 'blue' },
    { cx: 30, cy: 64, color: 'blue' },
    { cx: 43, cy: 64, color: 'blue' },
  ],
}

// CJK faces: characters (numeral over 萬), winds, dragons.
export const NUMERALS = ['一', '二', '三', '四', '五', '六', '七', '八', '九']
export const WIND_CHARS: Record<string, string> = { E: '東', S: '南', W: '西', N: '北' }
