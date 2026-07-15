// Pure engine types. Nothing in src/engine may import React or src/ui —
// the same code runs headless in tests and, in Phase 2, on a server.

export type Suit = 'm' | 'p' | 's'
export type Wind = 'E' | 'S' | 'W' | 'N'
export type Dragon = 'R' | 'G' | 'W'

/**
 * Canonical tile id.
 *   m1..m9  characters 萬   p1..p9  circles 筒   s1..s9  bamboo 索
 *   wE wS wW wN  winds      dR dG dW  dragons (red 中, green 發, white 白)
 *   bf1..bf4 flowers        bs1..bs4 seasons
 */
export type TileId = string

/** Seat index around the table; turn order is ascending (counter-clockwise). */
export type Seat = 0 | 1 | 2 | 3

export const SEATS: readonly Seat[] = [0, 1, 2, 3]

export const nextSeat = (s: Seat): Seat => (((s + 1) % 4) as Seat)

export type MeldType = 'chow' | 'pung' | 'kong'
export type KongStyle = 'concealed' | 'exposed' | 'added'

export interface Meld {
  type: MeldType
  tiles: TileId[]
  /** Concealed kongs score differently from exposed ones, so track it. */
  concealed: boolean
  kongStyle?: KongStyle
  claimedFrom?: Seat
}
