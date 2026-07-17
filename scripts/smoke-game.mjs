// Phase 4 gate: 1 human + 3 bots over a real socket, playable to a finish.
// The server runs the authoritative loop and the bots; this client only ever
// sees PlayerViews and replies with actions from its own legal list.
// Requires:  npx wrangler dev -c server/wrangler.jsonc
// Usage:     node scripts/smoke-game.mjs [http://localhost:8787]

const base = process.argv[2] ?? 'http://localhost:8787'
const wsBase = base.replace(/^http/, 'ws')
const fail = (msg) => {
  console.error(`✗ ${msg}`)
  process.exit(1)
}
const ok = (msg) => console.log(`✓ ${msg}`)

// Wire-level leak check (§2.2): no GameState-only key may ever cross.
const FORBIDDEN = ['wall', 'hands', 'seed', 'claims', 'lastDraw', 'config']
function leakCheck(msg) {
  const walk = (v) => {
    if (v === null || typeof v !== 'object') return
    if (Array.isArray(v)) return v.forEach(walk)
    for (const [k, x] of Object.entries(v)) {
      if (FORBIDDEN.includes(k)) fail(`forbidden key "${k}" crossed the wire in a ${msg.type}`)
      walk(x)
    }
  }
  if (msg.type === 'log' || (msg.type !== 'finished' && 'log' in msg)) {
    fail('action log crossed the wire before the round finished')
  }
  walk(msg)
}

const { code } = await (await fetch(`${base}/api/rooms`, { method: 'POST' })).json()
ok(`room ${code}`)

const ws = new WebSocket(`${wsBase}/api/rooms/${code}/ws?name=Smoke`)
let seat = -1
let views = 0
let finished = null
let lastSeq = 0
let botActed = false
const done = new Promise((resolve, reject) => {
  const guard = setTimeout(() => reject(new Error('game did not finish in time')), 240_000)
  ws.onmessage = (e) => {
    if (e.data === 'pong') return
    const msg = JSON.parse(e.data)
    leakCheck(msg)
    if (msg.type === 'joined') {
      seat = msg.seat
      ws.send(JSON.stringify({ type: 'lobby', op: 'seatKind', seat: 1, kind: 'bot' }))
      ws.send(JSON.stringify({ type: 'lobby', op: 'seatKind', seat: 2, kind: 'bot' }))
      ws.send(JSON.stringify({ type: 'lobby', op: 'seatKind', seat: 3, kind: 'bot', difficulty: 'advanced' }))
      ws.send(JSON.stringify({ type: 'start' }))
      return
    }
    if (msg.type === 'view') {
      views++
      if (msg.seq < lastSeq) fail(`seq went backwards (${msg.seq} < ${lastSeq})`)
      lastSeq = msg.seq
      if (msg.view.seat !== seat) fail(`got a view for seat ${msg.view.seat}`)
      if (msg.view.handCounts && msg.view.concealed.length > 14) fail('impossible hand size')
      // Any tile in another seat's discard pile proves a bot acted server-side.
      for (const s of [1, 2, 3]) if (msg.view.discards[s].length > 0) botActed = true
      // Auto-play: answer with our first legal action (prefer a win).
      const legal = msg.view.legal
      if (legal.length > 0) {
        const win = legal.find((a) => a.type === 'declareWin' || (a.type === 'claim' && a.claim === 'win'))
        ws.send(JSON.stringify({ type: 'intent', action: win ?? legal[0] }))
      }
      return
    }
    if (msg.type === 'finished') {
      finished = msg
      clearTimeout(guard)
      resolve()
    }
  }
  ws.onclose = (e) => {
    if (!finished) reject(new Error(`socket closed early: ${e.code} ${e.reason}`))
  }
})

await done
ok(`game finished: ${finished.result.kind}${finished.result.winner !== undefined ? ` (seat ${finished.result.winner})` : ''}`)
if (!botActed) fail('no bot ever discarded — server-side bots did not run')
ok('server-side bots played (their discards appeared)')
if (views < 20) fail(`suspiciously few views (${views})`)
ok(`${views} view updates, seq monotonic, every payload leak-checked`)
if (finished.log.length < 20) fail('log too short')
ok(`post-round disclosure: ${finished.log.length} actions`)
ws.close()
console.log('\nPhase 4 gate: PASS — 1 human + 3 bots, playable over a socket.')
process.exit(0)
