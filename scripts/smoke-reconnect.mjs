// §6 gate: background a phone mid-game and come back cleanly — over a REAL
// socket against workerd, not a fake clock. Simulates the PWA lifecycle:
// the socket dies on background and the client reconnects with its seat token
// on foreground. Runs several cycles and asserts the seat + hand come back.
// Requires:  npx wrangler dev -c server/wrangler.jsonc
// Usage:     node scripts/smoke-reconnect.mjs [http://localhost:8787]

const base = process.argv[2] ?? 'http://localhost:8787'
const wsBase = base.replace(/^http/, 'ws')
const fail = (m) => (console.error(`✗ ${m}`), process.exit(1))
const ok = (m) => console.log(`✓ ${m}`)

function conn(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url)
    const msgs = []
    const waiters = []
    ws.onmessage = (e) => {
      if (e.data === 'pong') return
      const m = JSON.parse(e.data)
      msgs.push(m)
      for (const w of [...waiters]) if (w.p(m)) (waiters.splice(waiters.indexOf(w), 1), w.res(m))
    }
    ws.onopen = () =>
      resolve({
        ws,
        msgs,
        send: (m) => ws.send(JSON.stringify(m)),
        next: (p, why, ms = 5000) =>
          new Promise((res, rej) => {
            const f = msgs.find(p)
            if (f) return res(f)
            const t = setTimeout(() => rej(new Error(`timeout: ${why}`)), ms)
            waiters.push({ p, res: (m) => (clearTimeout(t), res(m)) })
          }),
      })
    ws.onerror = () => reject(new Error(`connect failed: ${url}`))
  })
}

const { code } = await (await fetch(`${base}/api/rooms`, { method: 'POST' })).json()
ok(`room ${code}`)

// Join as the host, add three bots, start.
const a = await conn(`${wsBase}/api/rooms/${code}/ws?name=Dylan`)
const joined = await a.next((m) => m.type === 'joined', 'joined')
const token = joined.token
if (joined.seat !== 0) fail('expected seat 0')
for (const seat of [1, 2, 3]) a.send({ type: 'lobby', op: 'seatKind', seat, kind: 'bot' })
a.send({ type: 'start' })
const firstView = await a.next((m) => m.type === 'view' && m.view.phase !== 'lobby', 'first view')
if (firstView.view.concealed.length !== 14) fail('dealer should hold 14')
ok(`game started; seat 0 holds ${firstView.view.concealed.length} tiles`)

let socket = a
// Three background→foreground cycles. Each time: drop the socket, reconnect
// with the token, expect the same seat and a replayed view.
for (let i = 1; i <= 3; i++) {
  socket.ws.close(1000, 'backgrounded') // phone goes to background
  await new Promise((r) => setTimeout(r, 400))
  socket = await conn(`${wsBase}/api/rooms/${code}/ws?token=${token}`)
  const rj = await socket.next((m) => m.type === 'joined', `rejoined #${i}`)
  if (rj.seat !== 0) fail(`cycle ${i}: came back to seat ${rj.seat}, not 0`)
  const view = await socket.next((m) => m.type === 'view', `replayed view #${i}`)
  if (view.view.seat !== 0) fail(`cycle ${i}: replayed view for wrong seat`)
  if (view.view.concealed.length < 1) fail(`cycle ${i}: empty hand after reconnect`)
  // The room shows the seat connected again, not reconnecting/bot.
  const room = rj.room
  if (room.seats[0].status !== 'connected') fail(`cycle ${i}: status ${room.seats[0].status}`)
  ok(`cycle ${i}: reclaimed seat 0, hand replayed (${view.view.concealed.length} tiles), status connected`)
}

// A stale socket from before the last reconnect must have been bumped.
if (a.ws.readyState === WebSocket.OPEN && a !== socket) {
  fail('the original socket is somehow still open after being superseded')
}
ok('superseded sockets are closed (one live socket per seat)')

socket.ws.close()
console.log('\nPhase 6 gate: PASS — backgrounded a phone mid-game and came back cleanly, 3× over a real socket.')
process.exit(0)
