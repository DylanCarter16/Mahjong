// Real prompts, not generic ones. Both explicitly frame the variant (Hong
// Kong scoring, the configured faan minimum) and demand short, concrete,
// structured answers a beginner can act on immediately.

export function handAnalysisPrompt(situation: string): string {
  return `You are coaching a beginner at Hong Kong mahjong (faan scoring; chows score nothing by themselves; the configured faan minimum below applies — a complete hand under the minimum cannot be declared).

Current situation, from my point of view:

${situation}

Answer in EXACTLY this format, 150 words maximum, no preamble:

TARGET: <the most realistic faan target for this hand — name the pattern(s), the faan value, and how many tile changes away it is>
DISCARD: <the single best discard right now and one sentence why>
DEFENCE: <one concrete defensive observation about a specific opponent, based on their discards or melds>`
}

export function postRoundPrompt(logText: string): string {
  return `You are reviewing a finished round of Hong Kong mahjong for a beginner (seat "ME"). They are weak at defensive play and discard reading, so weight your advice toward those skills when the log supports it.

Full action log of the round:

${logText}

Give EXACTLY three numbered improvements. Each must reference a specific moment ("around turn 23 when W punged...") and say what to do differently and why it matters. One sentence of praise maximum. 180 words maximum, no preamble.`
}
