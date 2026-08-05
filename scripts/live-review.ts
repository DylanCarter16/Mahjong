// End-to-end check of the post-round review against a LIVE key.
//
// Everything else about the review is covered by unit tests with stubbed
// transports. The one thing they cannot answer is whether a real model, given
// the real engine-graded shortlist, actually answers in the format the client
// parses. That is what this does, and it is the reason it needs a key.
//
// It plays a genuine solo round through the real room and transport, captures
// hands exactly as the browser does, and then calls the REAL handler — the same
// validation, the same prompt builder, the same model config, the same response
// shape. Only the HTTP hop is simulated.
//
// Usage:
//   ANTHROPIC_API_KEY=sk-ant-... npx tsx scripts/live-review.ts
//
// Exits non-zero if the review fails or comes back unparseable.

import reviewHandler from '../api/_src/review'
import { parseNarration } from '../src/analysis/narration'
import { SnapshotRecorder } from '../src/analysis/snapshots'
import { botAction } from '../src/engine/bots'
import type { Action, PlayerView, RoundResult } from '../src/engine/game'
import { makeRng } from '../src/engine/rng'
import { scanRound } from '../src/engine/review'
import { FakeClock } from '../src/room/clock'
import { createSoloRoom } from '../src/room/solo'

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('Set ANTHROPIC_API_KEY. This script makes one real API call.')
  process.exit(1)
}

const RULES = { faanMinimum: 0 as const, flowers: true, faanCap: null }

/** Play one solo round the way the app does, recording this seat's hands. */
function playRound() {
  const clock = new FakeClock()
  const room = createSoloRoom(
    { rules: RULES, difficulties: { 0: 'easy', 1: 'intermediate', 2: 'intermediate', 3: 'intermediate' } },
    clock,
  )
  const rng = makeRng(`live-${Date.now()}`)
  const recorder = new SnapshotRecorder()
  const queue: Action[] = []
  let finished: { result: RoundResult; log: Action[] } | null = null
  let lastView: PlayerView | null = null

  room.conn.onMessage((m) => {
    if (m.type === 'view') {
      recorder.observe(m.seq, m.view, m.match.roundNo)
      lastView = m.view
      if (m.view.legal.length > 0) queue.push(botAction(m.view, 'easy', rng) as Action)
    } else if (m.type === 'finished') {
      finished = { result: m.result, log: [...m.log] }
    }
  })

  room.runner.start()
  let guard = 0
  while (finished === null && guard++ < 4000) {
    const next = queue.shift()
    if (next) room.conn.send({ type: 'intent', action: next })
    else clock.advance(1000)
  }
  room.runner.stop()
  if (!finished || !lastView) throw new Error('the round never finished')
  return { finished, view: lastView as PlayerView, snapshots: recorder.take() }
}

const { finished, view, snapshots } = playRound()
const body = {
  log: finished.log,
  result: finished.result,
  scan: {
    seat: view.seat,
    roundWind: view.roundWind,
    seatWinds: view.seatWinds,
    faanMinimum: view.faanMinimum,
    snapshots,
  },
}

const scan = scanRound({
  seat: view.seat,
  log: finished.log,
  result: finished.result,
  roundWind: view.roundWind,
  seatWinds: view.seatWinds,
  faanMinimum: view.faanMinimum,
  snapshots,
})

console.log('=== THE ROUND ===')
console.log(`  actions        : ${finished.log.length}`)
console.log(`  hands captured : ${snapshots.length}`)
console.log(`  summary        : ${scan.summary}`)
console.log(`  graded moments : ${scan.moments.length}, shortlisted ${scan.shortlist.length}`)
for (const [i, m] of scan.shortlist.entries()) {
  console.log(`   M${i + 1} [${m.verdict}] turn ${m.turn}: ${m.headline}`)
}
if (scan.degraded.length) {
  console.log('  DEGRADED (no hand recovered):')
  for (const d of scan.degraded) console.log(`   - ${d}`)
}

if (scan.shortlist.length === 0) {
  console.log('\nNo moments were shortlisted — this round would use the whole-log fallback.')
  console.log('Run again for a different round if you want to see the shortlist path.')
}

// Call the real handler with the request/response surface Vercel provides.
let status = 0
let payload: { text?: string; model?: string; error?: string } = {}
const res = {
  statusCode: 200,
  setHeader: () => res,
  status(code: number) {
    status = code
    return res
  },
  json(obj: unknown) {
    payload = obj as typeof payload
    return res
  },
  end: () => res,
  headersSent: false,
}
const req = {
  method: 'POST',
  headers: { origin: 'http://localhost:5173', host: 'localhost:5173' },
  socket: { remoteAddress: '127.0.0.1' },
  body,
}

console.log('\n=== CALLING THE REAL HANDLER ===')
const startedAt = Date.now()
// eslint-disable-next-line @typescript-eslint/no-explicit-any
await (reviewHandler as any)(req, res)
console.log(`  HTTP ${status || 200} in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`)
console.log(`  model: ${payload.model ?? '(none)'}`)

if (status >= 400 || !payload.text) {
  console.error(`\nFAILED: ${payload.error ?? 'no text in the response'}`)
  process.exit(1)
}

console.log('\n=== RAW ANSWER ===')
console.log(payload.text)

const n = parseNarration(payload.text, scan.shortlist.length)
console.log('\n=== PARSED ===')
console.log(`  summary  : ${n.summary || '(missing)'}`)
n.moments.forEach((m, i) => console.log(`  M${i + 1}       : ${m || '(missing)'}`))
if (n.rest) console.log(`  unmatched: ${n.rest}`)

if (scan.shortlist.length > 0 && !n.complete) {
  console.error('\nThe answer did not parse into every moment. The panel will fall back to prose.')
  console.error('That is survivable, but if it happens repeatedly the prompt format needs tightening.')
  process.exit(2)
}
console.log('\nOK: a real review came back and parsed into every moment.')
