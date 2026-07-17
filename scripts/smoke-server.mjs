// Phase 3 gate smoke test: two "browsers" in a room, no game yet.
// Requires the server running:  npx wrangler dev -c server/wrangler.jsonc
// Usage:                        node scripts/smoke-server.mjs [http://localhost:8787]

const base = process.argv[2] ?? 'http://localhost:8787'
const wsBase = base.replace(/^http/, 'ws')

const fail = (msg) => {
  console.error(`✗ ${msg}`)
  process.exit(1)
}
const ok = (msg) => console.log(`✓ ${msg}`)

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url)
    const msgs = []
    const waiters = []
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data)
      msgs.push(m)
      for (const w of [...waiters]) {
        if (w.pred(m)) {
          waiters.splice(waiters.indexOf(w), 1)
          w.resolve(m)
        }
      }
    }
    ws.onopen = () =>
      resolve({
        ws,
        msgs,
        send: (m) => ws.send(JSON.stringify(m)),
        next: (pred, why, ms = 5000) =>
          new Promise((res, rej) => {
            const found = msgs.find(pred)
            if (found) return res(found)
            const t = setTimeout(() => rej(new Error(`timeout waiting for ${why}`)), ms)
            waiters.push({ pred, resolve: (m) => (clearTimeout(t), res(m)) })
          }),
      })
    ws.onerror = () => reject(new Error(`could not connect ${url}`))
  })
}

// 1. Create a room.
const created = await fetch(`${base}/api/rooms`, { method: 'POST' })
if (!created.ok) fail(`create: HTTP ${created.status}`)
const { code } = await created.json()
if (!/^[A-HJ-NP-Z2-9]{6}$/.test(code)) fail(`bad room code shape: ${code}`)
ok(`room created: ${code}`)

// 2. Preflight info.
const info = await (await fetch(`${base}/api/rooms/${code}/info`)).json()
if (info.phase !== 'lobby' || !info.joinable) fail(`bad info: ${JSON.stringify(info)}`)
ok('info: lobby, joinable')

// 3. Browser one joins — becomes host in seat 0, gets a token.
const a = await connect(`${wsBase}/api/rooms/${code}/ws?name=Dylan`)
const joinedA = await a.next((m) => m.type === 'joined', 'joined (A)')
if (joinedA.seat !== 0) fail(`host seat: ${joinedA.seat}`)
if (!/^[0-9a-f]{32}$/.test(joinedA.token)) fail('host token shape')
if (joinedA.room.hostSeat !== 0) fail('hostSeat')
ok(`browser A joined seat 0 (host), token issued`)

// 4. Browser two joins — seat 1, sees both humans.
const b = await connect(`${wsBase}/api/rooms/${code}/ws?name=Mum`)
const joinedB = await b.next((m) => m.type === 'joined', 'joined (B)')
if (joinedB.seat !== 1) fail(`guest seat: ${joinedB.seat}`)
const roomB = joinedB.room
if (roomB.seats[0].name !== 'Dylan' || roomB.seats[1].name !== 'Mum') fail('names')
ok('browser B joined seat 1; sees both names')

// 5. A sees B arrive (room broadcast).
await a.next((m) => m.type === 'room' && m.room.seats[1].kind === 'human', 'A sees B')
ok('A received room update for B')

// 6. Guest tries a host-only op → rejected. Host does it → applied.
b.send({ type: 'lobby', op: 'seatKind', seat: 3, kind: 'bot', difficulty: 'advanced' })
await b.next((m) => m.type === 'rejected', 'guest rejection')
ok('guest lobby op rejected (host only)')
a.send({ type: 'lobby', op: 'seatKind', seat: 3, kind: 'bot', difficulty: 'advanced' })
await a.next(
  (m) => m.type === 'room' && m.room.seats[3].kind === 'bot' && m.room.seats[3].difficulty === 'advanced',
  'host seatKind applied',
)
ok('host assigned an advanced bot to seat 3')

// 7. Intents before start are rejected; no game state exists anywhere.
a.send({ type: 'intent', action: { type: 'draw', seat: 0 } })
await a.next((m) => m.type === 'rejected' && /not started/.test(m.reason), 'pre-start intent rejected')
if ([...a.msgs, ...b.msgs].some((m) => m.type === 'view')) fail('a view leaked before start')
ok('no game yet: intents rejected, zero views emitted')

// 8. Reconnect with the token reclaims the seat.
a.ws.close()
await new Promise((r) => setTimeout(r, 300))
const a2 = await connect(`${wsBase}/api/rooms/${code}/ws?token=${joinedA.token}`)
const rejoined = await a2.next((m) => m.type === 'joined', 'rejoined')
if (rejoined.seat !== 0) fail('reclaim seat mismatch')
ok('token reclaim returned seat 0')

// 9. A bad token is refused.
try {
  await connect(`${wsBase}/api/rooms/${code}/ws?token=${'0'.repeat(32)}`)
  fail('bad token accepted')
} catch {
  ok('bad token refused')
}

// 10. An unknown room 404s.
const gone = await fetch(`${base}/api/rooms/ZZZZZZ/info`)
if (gone.status !== 404) fail(`unknown room info: HTTP ${gone.status}`)
ok('unknown room 404s')

console.log('\nPhase 3 gate: PASS — two clients in a lobby, tokens, host ops, no game state.')
process.exit(0)
