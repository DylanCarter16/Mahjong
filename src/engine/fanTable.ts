// Every faan value lives here, not in scoring logic, so house rules are a
// one-line tweak. Values chosen for a common Hong Kong table; see the design
// doc for rationale. `faanCap` (limit) clamps the hand total when non-null.

export interface FanTable {
  allChows: number
  allPungs: number
  mixedOneSuit: number
  pureOneSuit: number
  allHonours: number
  smallDragons: number
  greatDragons: number
  smallWinds: number
  greatWinds: number
  seatWindPung: number
  roundWindPung: number
  dragonPung: number
  selfDraw: number
  sevenPairs: number
  thirteenOrphans: number
  allKongs: number
  nineGates: number
  /** Per flower/season whose index matches the winner's seat wind. */
  ownFlower: number
  /** Extra for holding a complete set of 4 flowers or 4 seasons. */
  flowerSetBonus: number
  lastWallTile: number
  kongReplacementWin: number
  faanCap: number | null
}

export const defaultFanTable: FanTable = {
  allChows: 1,
  allPungs: 3,
  mixedOneSuit: 3,
  pureOneSuit: 7,
  allHonours: 10,
  smallDragons: 4,
  greatDragons: 8,
  smallWinds: 6,
  greatWinds: 13,
  seatWindPung: 1,
  roundWindPung: 1,
  dragonPung: 1,
  selfDraw: 1,
  sevenPairs: 4,
  thirteenOrphans: 13,
  allKongs: 13,
  nineGates: 13,
  ownFlower: 1,
  flowerSetBonus: 2,
  lastWallTile: 1,
  kongReplacementWin: 1,
  faanCap: null,
}
