// The ~20 concepts the course tracks — finer-grained than units. Every
// generated item is tagged with the concepts it exercises; unlocking is by
// prerequisite mastery, not unit completion.

export type ConceptId =
  | 'tile.recognition.characters'
  | 'tile.recognition.circles'
  | 'tile.recognition.bamboo'
  | 'tile.recognition.honours'
  | 'set.chow'
  | 'set.pung-kong'
  | 'shape.standard'
  | 'shape.decompose'
  | 'shape.seven-pairs'
  | 'shape.thirteen-orphans'
  | 'faan.patterns'
  | 'faan.exclusivity'
  | 'declare.minimum'
  | 'efficiency.shanten'
  | 'efficiency.ukeire'
  | 'efficiency.discard-choice'
  | 'defence.safe-tiles'
  | 'defence.push-fold'
  | 'read.suit-inference'
  | 'read.threat'

export interface Concept {
  id: ConceptId
  title: string
  /** Unit on the course map (1..8) this concept belongs to. */
  unit: number
  prereqs: ConceptId[]
}

const RECOG: ConceptId[] = [
  'tile.recognition.characters',
  'tile.recognition.circles',
  'tile.recognition.bamboo',
  'tile.recognition.honours',
]

export const CONCEPTS: Concept[] = [
  { id: 'tile.recognition.characters', title: 'Reading characters 萬', unit: 1, prereqs: [] },
  { id: 'tile.recognition.circles', title: 'Reading circles 筒', unit: 1, prereqs: [] },
  { id: 'tile.recognition.bamboo', title: 'Reading bamboo 索', unit: 1, prereqs: [] },
  { id: 'tile.recognition.honours', title: 'Winds & dragons', unit: 1, prereqs: [] },
  { id: 'set.chow', title: 'Chows', unit: 2, prereqs: RECOG },
  { id: 'set.pung-kong', title: 'Pungs & kongs', unit: 2, prereqs: RECOG },
  { id: 'shape.standard', title: 'The winning shape', unit: 3, prereqs: ['set.chow', 'set.pung-kong'] },
  { id: 'shape.decompose', title: 'Decomposing hands', unit: 3, prereqs: ['shape.standard'] },
  { id: 'shape.seven-pairs', title: 'Seven Pairs', unit: 4, prereqs: ['shape.standard'] },
  { id: 'shape.thirteen-orphans', title: 'Thirteen Orphans', unit: 4, prereqs: ['shape.standard'] },
  { id: 'faan.patterns', title: 'Faan patterns', unit: 5, prereqs: ['shape.standard'] },
  { id: 'faan.exclusivity', title: 'Pattern exclusivity', unit: 5, prereqs: ['faan.patterns'] },
  { id: 'declare.minimum', title: 'The faan minimum', unit: 5, prereqs: ['faan.patterns'] },
  { id: 'efficiency.shanten', title: 'Shanten', unit: 3, prereqs: ['shape.standard'] },
  { id: 'efficiency.ukeire', title: 'Live tiles (ukeire)', unit: 6, prereqs: ['efficiency.shanten'] },
  { id: 'efficiency.discard-choice', title: 'Best discard', unit: 6, prereqs: ['efficiency.ukeire'] },
  { id: 'defence.safe-tiles', title: 'Safe tiles', unit: 7, prereqs: ['shape.standard'] },
  { id: 'defence.push-fold', title: 'Push or fold', unit: 7, prereqs: ['defence.safe-tiles', 'read.threat'] },
  { id: 'read.suit-inference', title: 'Reading discard suits', unit: 6, prereqs: ['shape.standard'] },
  { id: 'read.threat', title: 'Spotting threats', unit: 7, prereqs: ['read.suit-inference'] },
]

export const conceptById = new Map(CONCEPTS.map((c) => [c.id, c]))
