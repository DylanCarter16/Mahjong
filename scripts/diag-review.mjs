// Raw-response diagnostic for the review path. Prints EXACTLY what the model
// returns for a real review — every SSE event, every content block with its
// type, the stop_reason, and the final assembled object — before any of our
// parsing touches it.
//
// This exists because "the review returns empty" is a parsing question, and you
// cannot answer a parsing question from the parsed result.
//
// Usage:
//   ANTHROPIC_API_KEY=sk-ant-... node scripts/diag-review.mjs [model]
//
// Defaults to the model api/_src/review.ts actually uses. It sends the real
// review system prompt and a real serialised action log, so the request shape
// is the one that fails in production — not a toy prompt.

const KEY = process.env.ANTHROPIC_API_KEY
if (!KEY) {
  console.error('Set ANTHROPIC_API_KEY. This script makes one real API call.')
  process.exit(1)
}

const MODEL = process.argv[2] ?? 'claude-sonnet-5'
const MAX_TOKENS = Number(process.env.MAX_TOKENS ?? 700)

// The real review prompt, inlined so this script has no build step.
const SYSTEM =
  'You are a Hong Kong mahjong teacher reviewing a finished round for a beginner. Be concrete and reference specific turns. Follow the requested output format exactly.' +
  ' Write plain prose only — no Markdown or formatting syntax of any kind (no asterisks, underscores, backticks, headings, or bullet lists). Always name tiles in plain English ("West Wind", "White Dragon", "9 of Characters") and never use internal codes like wW, dW, or m9.'

const LOG = [
  '1. ME draws', '2. ME discards s1', '3. S passes', '4. W passes', '5. N passes',
  '6. S draws', '7. S discards dR', '8. ME passes', '9. W pungs', '10. W discards m2',
  '11. N chows with m3 m4', '12. N discards p9', '13. ME draws', '14. ME discards wN',
  '15. S draws', '16. S discards s5', '17. ME passes', '18. W draws', '19. W discards dG',
  '20. N wins off the discard',
].join('\n')

const PROMPT = `You are reviewing a finished round of Hong Kong mahjong for a beginner (seat "ME"). They are weak at defensive play and discard reading, so weight your advice toward those skills when the log supports it.

Full action log of the round:

${LOG}
RESULT: N won off W's discard for 3 faan (All Chows, Own Flowers)

Give EXACTLY three numbered improvements. Each must reference a specific moment ("around turn 23 when W punged...") and say what to do differently and why it matters. One sentence of praise maximum. 180 words maximum, no preamble.`

const body = {
  model: MODEL,
  max_tokens: MAX_TOKENS,
  system: SYSTEM,
  stream: true,
  messages: [{ role: 'user', content: PROMPT }],
}

// Optional experiment: THINKING=disabled|adaptive
if (process.env.THINKING === 'disabled') body.thinking = { type: 'disabled' }
if (process.env.THINKING === 'adaptive') body.thinking = { type: 'adaptive' }

console.log('=== REQUEST ===')
console.log(JSON.stringify({ ...body, system: `<${SYSTEM.length} chars>`, messages: '<prompt>' }, null, 2))

const res = await fetch('https://api.anthropic.com/v1/messages', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-api-key': KEY,
    'anthropic-version': '2023-06-01',
  },
  body: JSON.stringify(body),
})

console.log(`\n=== HTTP ${res.status} ${res.statusText} ===`)
if (!res.ok) {
  console.log(await res.text())
  process.exit(1)
}

// Reassemble the message exactly as the API describes it, tracking every
// block type — this is the object our parser should have been reading.
const blocks = []
const eventCounts = new Map()
let stopReason = null
let stopDetails = null
let usage = null
let messageMeta = null
let textDeltaChars = 0
let thinkingDeltaChars = 0

const reader = res.body.getReader()
const decoder = new TextDecoder()
let buf = ''
for (;;) {
  const { done, value } = await reader.read()
  if (done) break
  buf += decoder.decode(value, { stream: true })
  const lines = buf.split('\n')
  buf = lines.pop() ?? ''
  for (const line of lines) {
    if (!line.startsWith('data:')) continue
    const raw = line.slice(5).trim()
    if (!raw || raw === '[DONE]') continue
    let ev
    try { ev = JSON.parse(raw) } catch { continue }
    eventCounts.set(ev.type, (eventCounts.get(ev.type) ?? 0) + 1)

    if (ev.type === 'message_start') {
      messageMeta = { id: ev.message?.id, model: ev.message?.model, role: ev.message?.role }
      usage = ev.message?.usage ?? null
    }
    if (ev.type === 'content_block_start') {
      blocks[ev.index] = { type: ev.content_block?.type, text: '', thinking: '', raw: ev.content_block }
    }
    if (ev.type === 'content_block_delta') {
      const b = (blocks[ev.index] ??= { type: '?', text: '', thinking: '' })
      const d = ev.delta ?? {}
      if (d.type === 'text_delta') { b.text += d.text ?? ''; textDeltaChars += (d.text ?? '').length }
      else if (d.type === 'thinking_delta') { b.thinking += d.thinking ?? ''; thinkingDeltaChars += (d.thinking ?? '').length }
      else { b.other = (b.other ?? 0) + 1; b.otherDeltaType = d.type }
    }
    if (ev.type === 'message_delta') {
      stopReason = ev.delta?.stop_reason ?? stopReason
      stopDetails = ev.delta?.stop_details ?? stopDetails
      if (ev.usage) usage = { ...(usage ?? {}), ...ev.usage }
    }
    if (ev.type === 'error') console.log('\n!! SSE error event:', JSON.stringify(ev))
  }
}

console.log('\n=== SSE EVENT TYPES SEEN ===')
for (const [t, n] of [...eventCounts].sort()) console.log(`  ${String(n).padStart(4)}  ${t}`)

console.log('\n=== CONTENT BLOCKS ===')
if (blocks.length === 0) console.log('  (none — the response carried NO content blocks)')
blocks.forEach((b, i) => {
  if (!b) return
  console.log(`  [${i}] type=${b.type}`)
  console.log(`       text     : ${b.text.length} chars${b.text ? ` — ${JSON.stringify(b.text.slice(0, 120))}` : ' (EMPTY)'}`)
  console.log(`       thinking : ${b.thinking.length} chars${b.thinking ? ` — ${JSON.stringify(b.thinking.slice(0, 120))}` : ''}`)
  if (b.other) console.log(`       other deltas: ${b.other} of type ${b.otherDeltaType}`)
  if (b.raw && Object.keys(b.raw).length) console.log(`       block start: ${JSON.stringify(b.raw).slice(0, 200)}`)
})

console.log('\n=== MESSAGE ===')
console.log(`  meta        : ${JSON.stringify(messageMeta)}`)
console.log(`  stop_reason : ${JSON.stringify(stopReason)}`)
console.log(`  stop_details: ${JSON.stringify(stopDetails)}`)
console.log(`  usage       : ${JSON.stringify(usage)}`)

console.log('\n=== WHAT OUR PARSER WOULD HAVE EXTRACTED ===')
console.log(`  text_delta chars accumulated : ${textDeltaChars}`)
console.log(`  thinking_delta chars ignored : ${thinkingDeltaChars}`)
console.log(
  textDeltaChars === 0
    ? '\n  >>> ZERO text. This is the "empty answer" the UI reports.\n' +
      `      Block types present: ${blocks.filter(Boolean).map((b) => b.type).join(', ') || 'none'}\n` +
      `      stop_reason: ${stopReason}\n`
    : '\n  >>> Text present — this request would have rendered prose.\n',
)
