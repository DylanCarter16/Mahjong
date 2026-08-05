// Splitting the model's answer into a summary plus a line per moment.
//
// The format is a lever, not a contract: models mostly comply and sometimes
// don't, and a review that renders nothing because a label was missing would be
// a worse bug than the one this replaced. So the tests are mostly about the
// messy cases — everything unmatched has to come back, never be dropped.

import { describe, expect, it } from 'vitest'
import { parseNarration } from '../narration'

describe('parseNarration', () => {
  it('splits the format we asked for', () => {
    const out = parseNarration(
      [
        'SUMMARY: A quick round that turned on one dragon.',
        'M1: Holding the Red Dragon one turn longer costs nothing when nobody is pushing.',
        'M2: North had two sets down — that is the moment to fold.',
        'M3: Good discipline taking the safe tile here.',
      ].join('\n'),
      3,
    )
    expect(out.summary).toBe('A quick round that turned on one dragon.')
    expect(out.moments[0]).toMatch(/^Holding the Red Dragon/)
    expect(out.moments[2]).toMatch(/^Good discipline/)
    expect(out.rest).toBe('')
    expect(out.complete).toBe(true)
  })

  it('joins wrapped lines onto the moment they continue', () => {
    const out = parseNarration(
      ['SUMMARY: One line', 'that wrapped.', 'M1: A sentence', 'that also wrapped.'].join('\n'),
      1,
    )
    expect(out.summary).toBe('One line that wrapped.')
    expect(out.moments[0]).toBe('A sentence that also wrapped.')
  })

  it('accepts the punctuation models actually use', () => {
    for (const head of ['M1:', 'M1.', 'M1 -', 'M1)', 'm1:', 'M 1:']) {
      const out = parseNarration(`${head} the text`, 1)
      expect(out.moments[0], head).toBe('the text')
    }
  })

  it('keeps prose that has no labels at all instead of dropping it', () => {
    const text = 'You played a steady round but let one dragon go too early.'
    const out = parseNarration(text, 2)
    expect(out.rest).toBe(text)
    expect(out.complete).toBe(false)
    expect(out.moments).toEqual(['', ''])
  })

  it('does not attach a moment number the engine never shortlisted', () => {
    // The model inventing an M5 must not silently land on a card, and must not
    // vanish either.
    const out = parseNarration('M1: real\nM5: invented', 2)
    expect(out.moments).toEqual(['real', ''])
    expect(out.rest).toContain('M5: invented')
    expect(out.complete).toBe(false)
  })

  it('reports incomplete when a moment went unnarrated', () => {
    const out = parseNarration('SUMMARY: fine\nM1: a\nM3: c', 3)
    expect(out.moments).toEqual(['a', '', 'c'])
    expect(out.complete).toBe(false)
  })

  it('reports incomplete when the summary is missing', () => {
    expect(parseNarration('M1: a', 1).complete).toBe(false)
  })

  it('survives empty input and zero moments', () => {
    expect(parseNarration('', 3)).toMatchObject({ summary: '', rest: '', complete: false })
    expect(parseNarration('SUMMARY: done', 0)).toMatchObject({ summary: 'done', complete: true })
  })

  it('does not treat a tile name starting with M as a moment header', () => {
    // "M1" is a label; "Mistake:" and "My hand" are not.
    const out = parseNarration('SUMMARY: s\nM1: text\nMistake: not a header', 1)
    expect(out.moments[0]).toBe('text Mistake: not a header')
  })
})
