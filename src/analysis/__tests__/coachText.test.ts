import { describe, expect, it } from 'vitest'
import { cleanCoachText, humaniseTileCodes, stripMarkdown } from '../coachText'

describe('humaniseTileCodes', () => {
  it('replaces leaked internal codes with plain English names', () => {
    expect(humaniseTileCodes('Discard wW or dW')).toBe('Discard West Wind or White Dragon')
    expect(humaniseTileCodes('keep m9 and p1')).toBe('keep 9 of Characters and 1 of Circles')
    expect(humaniseTileCodes('s5 is safe')).toBe('5 of Bamboo is safe')
  })

  it('leaves ordinary prose untouched', () => {
    // "we", "west", "draw" etc. must not be mangled — only standalone codes match.
    const prose = 'We went west to draw a winning tile; that was wise.'
    expect(humaniseTileCodes(prose)).toBe(prose)
    // Already-humanised names are not re-matched.
    expect(humaniseTileCodes('West Wind and White Dragon')).toBe('West Wind and White Dragon')
  })
})

describe('stripMarkdown', () => {
  it('unwraps emphasis and removes stray markup', () => {
    expect(stripMarkdown('**Discard wW** now')).toBe('Discard wW now')
    expect(stripMarkdown('a _soft_ read')).toBe('a soft read')
    expect(stripMarkdown('use `dR` carefully')).toBe('use dR carefully')
    expect(stripMarkdown('# Heading\ntext')).toBe('Heading\ntext')
    expect(stripMarkdown('- bullet point')).toBe('bullet point')
  })
})

describe('cleanCoachText', () => {
  it('strips markdown AND humanises codes, so no raw * or code reaches the screen', () => {
    const raw = '**Discard wW or dW** — they read _dangerous_.'
    const out = cleanCoachText(raw)
    expect(out).toBe('Discard West Wind or White Dragon — they read dangerous.')
    expect(out).not.toMatch(/[*_`#]/)
    expect(out).not.toMatch(/\b(?:[mps][1-9]|w[ESWN]|d[RGW])\b/)
  })
})
