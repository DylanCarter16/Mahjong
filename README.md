# Mahjong — Play + Learn 🀄

A web app for learning **Hong Kong mahjong**: play full rounds against three bots,
play **cross-device multiplayer** with 2–4 humans (empty seats filled by bots),
work through a Duolingo-style lesson track, and drill the two skills beginners
struggle with most — tile efficiency and reading the discard pool. An optional AI
coach (shared, or bring your own Anthropic API key) analyses your hand mid-round
and reviews the round afterwards.

Built for a player learning to play with family who use a **0 faan minimum** —
the minimum is configurable (0 / 1 / 3) and the "your hand is complete but you
can't declare it" moment is taught explicitly.

**Single-player stays fully local and fully offline** — solo games and lessons
run with no network at all. Multiplayer is the same game engine behind an
authoritative server; the browser only ever sees its own seat's view.

## Quick start

```bash
npm install
npm run dev       # front-end dev server (Vite)
npm test          # the whole test suite (Vitest) — engine, room, proxy, parity
npm run build     # typecheck + production build
npm run typecheck # tsc for both the app and the server package
```

Node LTS. Solo play and lessons need **no backend, no storage, no env vars** —
the app runs where browser storage is unavailable, and the Anthropic key (if you
use the AI coach) is typed into the UI at runtime and held in component memory
only.

**Multiplayer** additionally needs the game server running (a Cloudflare Worker +
Durable Objects — see [Multiplayer server](#multiplayer-server-server)) and the
front end pointed at it via `VITE_GAME_SERVER`:

```bash
npm run server:dev                              # game server on :8787 (workerd)
VITE_GAME_SERVER=http://localhost:8787 npm run dev
npm run smoke:server                            # gate: two clients in a lobby
```

## How the pieces fit

```
src/
  engine/     pure TypeScript, zero React imports, fully unit-tested — the rules
  room/       transport-agnostic room orchestration (RoomRunner, RoomHost,
              LocalTransport, protocol, clock, room codes/tokens) — no React,
              no sockets; the same code drives solo and multiplayer
  net/        browser multiplayer client (WebSocket ClientConn + reconnect)
  ui/         React components; render a PlayerView, dispatch engine actions
  lessons/    lesson units + the two drills; validate ONLY via engine calls
  analysis/   Anthropic proxy client (fetch, fallback model, rate-limited)
api/          Vercel functions: the coach/review proxy (holds the key)
server/       Cloudflare Worker + Durable Objects: the multiplayer game server
```

The engine is the single source of truth. Both solo and multiplayer run the same
`RoomRunner` over a `Transport` interface (§ [Multiplayer](#multiplayer)); the UI
renders from `playerView(state, seat)` and never sees another seat's tiles. Bots
receive the same `PlayerView` and nothing else. Lessons never re-implement a rule
— if a drill needs to know whether a hand wins, it calls `isWinningHand`.

### Tile notation

Used everywhere (tests, serialisation, docs): `m1..m9` characters 萬, `p1..p9`
circles 筒, `s1..s9` bamboo 索, `wE wS wW wN` winds, `dR dG dW` dragons,
`bf1..bf4` flowers, `bs1..bs4` seasons. `hand("m1 m2 m3")` parses a list.
Tiles are drawn by one component and one only: `<TileView>` (procedural SVG,
`src/ui/tiles/`), with `<TilePool>` for a row of them. There is no text-glyph
renderer — the Unicode mahjong block is not used for display anywhere, because a
second path is how the red-dragon mismatch happened.

## Engine API tour

| Module | Key exports | What it does |
| --- | --- | --- |
| `tiles.ts` | `t`, `hand`, `sortTiles`, `tileName`, classifiers | Tile model and parsing |
| `rng.ts` | `makeRng(seed)`, `shuffle` | Seedable RNG (mulberry32) — games are reproducible |
| `wall.ts` | `buildWall({flowers}, rng)` | 144-tile wall (136 with flowers off), dead wall = last 14 |
| `win.ts` | `decompose`, `isWinningHand`, `isValidChow/Pung/Kong` | Returns **every** valid reading of a hand (standard / seven pairs / thirteen orphans) |
| `fan.ts` | `score`, `scoreBest`, `winDeclarable` | Faan patterns with subsumption; `scoreBest` picks the highest-scoring reading |
| `fanTable.ts` | `defaultFanTable` | Every faan value in one tweakable table (+ optional `faanCap`) |
| `shanten.ts` | `shanten`, `usefulTiles` | Distance-from-win (−1 = won, 0 = tenpai) across all three shapes |
| `game.ts` | `createGame`, `applyAction`, `legalActions`, `playerView` | Pure reducer: deal → draw → discard → claims → kongs → win/draw. Full action log on state |
| `bots.ts` | `botAction(view, difficulty, rng)`, `dangerScore` | easy / intermediate / advanced policies |

`applyAction` validates every action against `legalActions` (one source of
truth) and throws loudly on anything illegal. `GameState` is plain serialisable
data — `JSON.parse(JSON.stringify(state))` round-trips it, which is what makes
the Phase 2 multiplayer server (same engine, authoritative, thin clients)
possible without a rewrite.

### The claim window

After any discard the reducer enters a `claims` phase listing which seats may
claim what. Priority: **win > pung/kong > chow**; multiple winners resolve in
seat order from the discarder; chow is only offered to the next seat. This is
deliberately the same shape as a timed multiplayer claim window.

## Multiplayer

2–4 humans on different devices play one game; empty seats are filled by bots.
Room-code entry, no accounts. The design decision and its trade-offs are written
up in `docs/superpowers/specs/` — the short version:

**One runner, two transports.** The rules live in `engine/` (unchanged). A
transport-agnostic, clock-injected `RoomRunner` orchestrates a room — seats, the
turn cycle, claim windows, timers, bot invocation — and talks to seats only
through a `Transport` interface. Solo play uses `LocalTransport` (in-memory, no
network, works offline on a bus). Multiplayer uses a WebSocket transport on the
server. The same runner drives both, and a **parity test** (`src/room/__tests__/
parity.test.ts`) proves the two paths produce byte-identical results from the
same seed — the guard against drift.

**Transport choice: Cloudflare Durable Objects.** One room = one DO instance:
single-threaded (so authority is inherent), stateful in memory, WebSocket-native
with hibernation, scales to zero. `GameState` is one flat JSON blob and the RNG
is spent at the deal, so a room serializes and rehydrates trivially — the DO
write-throughs a snapshot after every change, and deploys/evictions recover
through the same reconnect path phones exercise constantly.

**Security properties (each has a test):**

- **The server is the only authority.** Clients send *intents*; the server
  validates against `legalActions` and applies or rejects. A modified client
  can't do anything illegal.
- **Hidden information never leaves the server.** Each client receives only its
  own `PlayerView` — never another seat's tiles, the wall, or the dead wall. The
  **leak test** (`src/room/__tests__/leak.test.ts`) captures every payload sent
  to a seat across a full game and proves no hidden tile appears; it's
  mutation-checked and deliberately hard to weaken.
- **The seed is a secret.** Production walls are seeded from `crypto`
  server-side; the seed and the wall array never leave the server, never get
  logged.
- **Bots run server-side.** A modified client can't be a cheating bot with full
  information.

**Claim windows.** After a discard, claims are collected across the whole window
and resolved by rule priority (**win > pung/kong > chow**; ties by seat order
from the discarder) — never by arrival order, so a fast connection can't beat a
slow one to a contested tile. Latency only affects whether your claim lands at
all. Robbing the kong (搶槓) gets its own win-only window.

**Disconnects & reconnect (the PWA common path).** Backgrounding a phone kills
the socket, so reconnect is normal, not an edge case: a 60s grace shows the seat
as "reconnecting", then it flips to a bot (also on two consecutive turn
timeouts); presenting the seat token replays the current view and hands control
back. Bot decisions stand.

### Multiplayer server (`server/`)

A Cloudflare Worker routes room requests to per-room Durable Objects.

```bash
npm run server:dev      # run locally on workerd (wrangler dev)
npm run server:deploy   # deploy to Cloudflare
npm run server:tail     # stream logs (your 2am window)
npm run smoke:server    # Phase-3 gate: two clients in a lobby, tokens, no game
npm run smoke:game      # a full 1-human + 3-bot game over a real socket
npm run smoke:reconnect # background/foreground a phone mid-game, come back clean
```

Config lives in `server/wrangler.jsonc`. Environment:

| Name | Where | Purpose |
| --- | --- | --- |
| `VITE_GAME_SERVER` | front-end build/dev env | URL of the game server the browser opens a socket to (e.g. your `*.workers.dev`). Unset in a **dev** build ⇒ `http://localhost:8787`; unset in a **prod** build ⇒ the app throws a clear "not configured" error at connect time (it will not silently dial localhost). |
| `ALLOWED_ORIGINS` | worker `vars` | comma-separated browser origins allowed to connect. Empty ⇒ allow any (dev posture; set your front-end origin in production). |
| `ADMIN_KEY` | worker **secret** | gates the `/debug` state dump and `/reset` escape hatches. Unset ⇒ those routes are disabled. Set with `npx wrangler secret put ADMIN_KEY -c server/wrangler.jsonc`. |
| `ANTHROPIC_API_KEY` | the **coach proxy** (Vercel), not the game server | the shared coach key. The game server never touches it — the two systems are separate on purpose. |

The front end deploys as today (Vercel/static). The coach proxy stays on Vercel
functions (`api/`). Only the sockets live on Cloudflare, so two providers — the
front end + coach on one, the game server on the other.

**Deploying multiplayer to production** — wiring the two hosts together, the exact
env vars to set, and a real two-device smoke test — is its own runbook:
[`DEPLOY.md`](DEPLOY.md). `.env.example` documents the front-end var.

**Debugging a stuck room at 2am:** `npm run server:tail` for logs;
`GET /api/rooms/<CODE>/debug` (with `x-admin-key`) dumps the room's full
server-side state; `POST /api/rooms/<CODE>/reset` (same header) tears it down.

## Bots — honest strength note

The advanced bot is **strong-heuristic play, not superhuman**: shanten
efficiency, per-opponent discard reading, safety estimation, and push/fold. It
should punish beginner mistakes and lose to a good club player. `dangerScore`
is exported and reused by the defence lesson and the discard-reading quiz, so
the drills grade with the same model the bots play by.

## Lessons and drills

Eight units in order (tiles → sets → winning shape → special hands → faan &
the minimum → reading discards → defence → guided play), each unlocking the
next. Progress lives in one versioned `localStorage` key with export/import
(`src/lessons/persistence.ts`), and degrades to memory where storage is
unavailable.

Two ways in, **one mastery score per concept**: "Start a session" runs the
scheduler's mix (due reviews, weakest concepts, a little new material), and the
concept map underneath it is tappable for **targeted practice** — drill defence
directly instead of waiting for the chain to reach it. Both read and write the
same state through the same `gradeAnswer`, so practising defence is what the
scheduler sees next time. A concept whose prerequisites aren't mastered can
still be practised; it's marked as being ahead of the chain, and practising it
doesn't fake an unlock (unlocking is a statement about its *prerequisites*).

Timed items warn **once** per session ("the next N questions are timed"), then
carry a small ⏱ badge and a two-second count-in — no modal between questions.

- **Tile efficiency trainer** — procedurally generated hands at a target
  shanten; your discard is graded optimal / acceptable / bad with a full
  per-discard table of shanten and live-tile counts.
- **Discard-reading quiz** — real mid-game positions from seeded bot games:
  which suit is an opponent short on, and which of your tiles is safest.

## AI coach (`src/analysis`, `api/`)

Three actions, all rate-limited and error-safe: **Analyse my hand** (realistic
faan target, best discard, one defensive note), **Should I claim it?** (whether
to pung/chow/kong a discard — single-player only, since a multiplayer claim
window is too short for a round trip), and **Review that round** (three
improvements tied to specific turns from the action log). Coach requests
originate client-side and hit the proxy directly; the game server never touches
the key. The prompt is built server-side from a validated `PlayerView` — no
client-supplied prompt/model/messages; even the claim-vs-discard *mode* is
derived from the validated state's own phase.

Every request has a ceiling at both ends — an upstream budget inside the
function's `maxDuration`, and a client timeout above it — so a stalled model
always becomes "couldn't generate a review" with a retry, never a spinner that
runs forever.

In multiplayer the coach is exposed to strangers spending the host's key, so:
it's a **host setting** (default on, shown in the lobby rule summary and visible
to the room); the proxy rate-limits per real IP (`x-real-ip`), per room, and
under a **global daily ceiling** independent of IP; a malformed BYO key is
rejected before any upstream call; and the **bring-your-own-key** hatch is
surfaced in the lobby (memory only, never saved, never sent to the game server)
to skip the shared limit. When the coach is off its launcher is **gone**, but
the **local ranked-discard table** — computed by the engine, free, instant, and
gated by a separate "beginner aids allowed" house rule — still has its own
entry point. Uses `claude-fable-5`, falls back to `claude-opus-4-8`.

### House rules vs display preferences

A **house rule** is the host's, applies to the room, and is locked once the game
starts (faan minimum, flowers, timers, `coachAllowed`, `beginnerAidsAllowed`). A
**display preference** is yours, lives only in this browser, never crosses the
wire, and is changeable any time in either mode — numbered tiles, whether *you*
want the beginner aids, reduced motion, your own API key. The ⚙ on the
multiplayer table opens exactly those. Where the two meet, the host wins: with
`beginnerAidsAllowed` off, your personal aids toggle is disabled and says why.

> **Deploy note:** the in-memory limiters are per warm serverless instance, so
> the daily ceiling is a true global cap only once the counters are moved to
> shared storage (Vercel KV / Upstash) — the `Limiter` interface is the drop-in
> seam. For the game server, add Cloudflare rate-limiting rules on
> `/api/rooms/*/info` and `/ws`. See `docs/AUDIT-RESPONSE.md`.

## Rules implemented & documented decisions

Hong Kong style: 144 tiles, counter-clockwise turns, dealer starts with 14;
chow/pung/kong (concealed, exposed, and added kongs with dead-wall replacement
draws); flowers/seasons auto-replaced; win by discard or self-draw; round ends
on win or wall exhaustion. Dealer repeats on dealer win/draw, otherwise the
deal rotates and the round wind advances each full rotation.

Decisions the spec left open (details in `docs/superpowers/specs/`):

- **Seven Pairs** requires seven *distinct* pairs — four-of-a-kind is not two pairs.
- **All Honours subsumes All Pungs** (and All Kongs subsumes All Pungs, Nine
  Gates subsumes Pure One Suit); Great/Small Dragons and Winds subsume the
  wind/dragon pungs they contain.
- **No point settlement** — the scoreboard tracks cumulative faan (it's a
  teaching tool); who-pays-whom is out of scope for Phase 1.
- **Robbing the kong** (搶槓) *is* implemented as of Phase 2: an added kong
  opens a win-only claim window before it completes; a concealed kong is not
  robbable. (Phase 1 did not implement it — noted here for history.)
- The dead wall is positional (last 14 tiles) and not replenished.

## Tests

`npm test` runs the whole suite (177 tests). Highlights:

- **Engine** — decomposition, faan exclusivity, shanten, claim priority
  (incl. pung-beats-chow and robbing the kong), scripted full rounds on rigged
  walls, bot-legality fuzzing over complete seeded games.
- **Room** — RoomRunner/RoomHost with a fake clock; the **leak test** (no hidden
  tile ever reaches a client); claim-window mechanics (skip-empty, collect-then-
  resolve, timeout=pass, all-bots-instant, illegal→reject+pass+log); turn
  timers, disconnect grace, bot takeover, reconnect, background/foreground.
- **Parity** — a full scripted 4-player game and **local-vs-network transport
  parity**: the same seed over `LocalTransport` and a JSON-serialising network
  sim must produce byte-identical output. Mutation-checked.
- **Proxy** — request validation, prompt-injection resistance, per-IP and
  per-room rate limits.

No `setTimeout`/sleeps in tests — the clock is injected. The engine and room
suites are the correctness signal for the whole app; the UI just renders a
`PlayerView` and dispatches actions.

`npm run verify:ui` drives the real app in a browser (mobile viewport) as a
self-check: menu → solo → create → lobby → table, asserting a11y labels, ≥44px
touch targets, and no console errors. (Needs `playwright-core` + a Chromium.)

## Roadmap

Phase 2 (**shipped**): cross-device multiplayer — authoritative Durable-Object
server running this exact engine, a `PlayerView` per client, timed claim
windows, disconnect→bot→reconnect. Not yet: spectators, chat, multi-round
scoring across a full game of four winds (single rounds land first), accounts /
matchmaking (room codes are enough).
