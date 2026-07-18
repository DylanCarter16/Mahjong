// Instant, offline explanations: static per-concept prose + engine facts
// templated at render time. The live LLM never sits in the drill loop.

import explanations from './content/explanations.json'
import type { ConceptId } from './concepts'

interface ConceptProse {
  core: string
  onError: string
}

const CONCEPT_PROSE = explanations.concepts as Record<string, ConceptProse>
const ERROR_PROSE = explanations.errorClasses as Record<string, string>

export function conceptProse(concept: ConceptId, wasCorrect: boolean): string {
  const p = CONCEPT_PROSE[concept]
  if (!p) return ''
  return wasCorrect ? p.core : `${p.onError} ${p.core}`
}

export function errorClassProse(tag: string): string | null {
  return ERROR_PROSE[tag] ?? null
}
