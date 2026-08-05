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

/**
 * The review prompt after the engine has done the finding and the grading.
 *
 * The old prompt handed over the whole action log and asked the model to pick
 * the interesting turns itself — which is how it ended up guessing at counts
 * ("only the third one out") and narrating a turn nobody could see. Here the
 * engine has already chosen the moments and computed every number, so the model
 * has exactly one job: say why each one mattered.
 *
 * The strict M-numbered format exists so the client can attach each sentence to
 * the moment card it belongs to. Prose that fails to parse still renders — see
 * parseNarration — so the format is a lever, not a load-bearing contract.
 */
export function momentReviewPrompt(factsText: string, momentCount: number): string {
  const lines = Array.from({ length: momentCount }, (_, i) => `M${i + 1}: <one or two sentences>`)
  return `You are reviewing a finished round of Hong Kong mahjong for a beginner. They are weak at defensive play and discard reading.

The engine has already found the moments that matter and computed every number below. They are facts. Do not recompute them, do not contradict them, do not add counts of your own, and do not mention moments that are not listed.

${factsText}

Answer in EXACTLY this format and nothing else:

SUMMARY: <one sentence on how the round went, 25 words maximum>
${lines.join('\n')}

For each moment, explain why it mattered and the habit to carry forward — not what happened, which the player can already see. 40 words maximum per moment. Encouraging but honest; do not praise a mistake. No preamble, no headings, no bullet points, no markdown.`
}

export function postRoundPrompt(logText: string): string {
  return `You are reviewing a finished round of Hong Kong mahjong for a beginner (seat "ME"). They are weak at defensive play and discard reading, so weight your advice toward those skills when the log supports it.

Full action log of the round:

${logText}

Give EXACTLY three numbered improvements. Each must reference a specific moment ("around turn 23 when W punged...") and say what to do differently and why it matters. One sentence of praise maximum. 180 words maximum, no preamble.`
}
