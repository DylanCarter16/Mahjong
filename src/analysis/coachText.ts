// Safety net for coach/review prose. The system prompt already asks the model
// for plain English tile names and no Markdown, but a model can slip — so we
// also scrub the returned text here, using the SAME tile → display-name map the
// table uses. This is presentation only; it never changes what the model said,
// just how a leaked code or stray asterisk renders.

import { tileName } from '../engine/tiles'
import type { TileId } from '../engine/types'

// Every internal tile code, matched only as a standalone token so real words are
// never touched: m1–m9 / p1–p9 / s1–s9, winds wE wS wW wN, dragons dR dG dW,
// bonus bf1–bf4 / bs1–bs4.
const TILE_CODE = /\b(?:[mps][1-9]|w[ESWN]|d[RGW]|b[fs][1-4])\b/g

/** Replace any leaked internal tile code with its plain-English name. */
export function humaniseTileCodes(text: string): string {
  return text.replace(TILE_CODE, (code) => tileName(code as TileId))
}

/**
 * Strip Markdown syntax so no raw `*`, `_`, backtick, or `#` reaches the screen.
 * We render plain prose (not Markdown), so this unwraps emphasis rather than
 * formatting it. Conservative: only well-formed pairs and line-leading markers.
 */
export function stripMarkdown(text: string): string {
  return text
    .replace(/`+([^`]*)`+/g, '$1') // `code` / ``code``
    .replace(/\*\*([^*]+)\*\*/g, '$1') // **bold**
    .replace(/\*([^*\n]+)\*/g, '$1') // *italic*
    .replace(/__([^_]+)__/g, '$1') // __bold__
    .replace(/_([^_\n]+)_/g, '$1') // _italic_
    .replace(/^\s{0,3}#{1,6}\s+/gm, '') // # headings
    .replace(/^\s{0,3}[-*+]\s+/gm, '') // - / * / + bullet markers
}

/** Full cleanup applied to every coach/review reply before display. */
export function cleanCoachText(text: string): string {
  return humaniseTileCodes(stripMarkdown(text))
}
