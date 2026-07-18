// Build-time explanation generator (§4.5). Regenerates the per-concept /
// per-error-class prose in src/lessons/content/explanations.json using a
// model — run OFFLINE by a developer, never at runtime.
//
//   ANTHROPIC_API_KEY=sk-ant-… node scripts/generate-explanations.mjs
//
// The committed JSON was authored the same way; runtime code only ever reads
// the static file, so drills stay instant and offline.

import { readFileSync, writeFileSync } from 'node:fs'

const MODEL = 'claude-sonnet-5'
const OUT = 'src/lessons/content/explanations.json'

const key = process.env.ANTHROPIC_API_KEY
if (!key) {
  console.error('Set ANTHROPIC_API_KEY (build-time only; the key never ships).')
  process.exit(1)
}

const current = JSON.parse(readFileSync(OUT, 'utf8'))
const conceptIds = Object.keys(current.concepts)
const errorIds = Object.keys(current.errorClasses)

const prompt = `You are writing micro-copy for a Hong Kong mahjong learning app.
For each CONCEPT id below, write:
  "core": 1-2 sentences teaching the concept crisply (beginner audience, concrete, no fluff)
  "onError": 1 sentence of advice shown after a wrong answer (specific, kind, actionable)
For each ERROR CLASS id, write 1-2 sentences a coach would say when that mistake pattern shows up repeatedly.
House rules to respect: 0-faan minimum is common ("family rules"); Seven Pairs needs seven DISTINCT pairs; chows never wrap 9-1-2; superseded faan patterns never double-count.
Return STRICT JSON: {"concepts": {id: {"core": "...", "onError": "..."}}, "errorClasses": {id: "..."}}.

Concept ids: ${conceptIds.join(', ')}
Error class ids: ${errorIds.join(', ')}`

const res = await fetch('https://api.anthropic.com/v1/messages', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-api-key': key,
    'anthropic-version': '2023-06-01',
  },
  body: JSON.stringify({
    model: MODEL,
    max_tokens: 4000,
    messages: [{ role: 'user', content: prompt }],
  }),
})
if (!res.ok) {
  console.error(`API error ${res.status}: ${await res.text()}`)
  process.exit(1)
}
const data = await res.json()
const text = data.content
  .filter((b) => b.type === 'text')
  .map((b) => b.text)
  .join('')
  .replace(/^```[a-z]*\n|\n```$/g, '')

const generated = JSON.parse(text)
const merged = {
  _meta: { ...current._meta, generated: `regenerated ${new Date().toISOString()} with ${MODEL}` },
  concepts: { ...current.concepts, ...generated.concepts },
  errorClasses: { ...current.errorClasses, ...generated.errorClasses },
}
writeFileSync(OUT, JSON.stringify(merged, null, 2) + '\n')
console.log(`wrote ${OUT} (${Object.keys(merged.concepts).length} concepts, ${Object.keys(merged.errorClasses).length} error classes)`)
