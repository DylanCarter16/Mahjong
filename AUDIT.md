# Security & Quality Audit — Mahjong Play + Learn

**Date:** 2026-07-18
**Scope:** full repo at `claude/security-quality-audit-b1rp12` (HEAD `3e350ee`).
**Mandate:** report only — nothing in the codebase was changed by this audit.
**Method:** read the four committed specs + the two design docs as the contract,
then re-derived the security boundaries from the code as evidence. Automated
tooling where it would install (see [Tooling](#tooling)); manual pattern scanning
where it would not. Every "clean" verdict below was checked, not assumed; the
four load-bearing tests were mutation-tested to confirm they actually fail on a
broken implementation.

**Superpowers plugin:** already vendored in `.claude/skills/` (v6.1.1, from
`github.com/obra/superpowers`) and active this session — no GitHub fetch needed.
Used its `systematic-debugging` (independent boundary re-derivation),
`test-driven-development`/`verification-before-completion` (mutation-testing the
suite before trusting it), and `requesting-code-review` discipline.

---

## TL;DR

The engine and the multiplayer authority model are genuinely well-built. The
`PlayerView` boundary is sound, the leak test has real teeth, server authority is
enforced through one reducer that validates every action, and engine purity /
transport abstraction held across three phases of rework. `tsc --strict` is clean
and 177 tests pass.

Two things actually matter and both undercut a *stated* security property:

- **H1** — the "256-bit crypto wall seed" is hashed down to a **32-bit** PRNG
  state before it's used, so the whole wall is one of only ~4.3 billion
  arrangements. A player can brute-force it from their own opening hand and then
  see everyone's concealed tiles. This defeats the entire point of server
  authority.
- **H2** — the coach proxy's rate limiter, the thing standing between a stranger
  and your Anthropic bill, keys on the client-spoofable `x-forwarded-for` header
  and lives in per-instance memory. There is no effective global cap on the
  shared key.

Everything else is medium/low. One notable spec-vs-code gap: the **entire Phase
1.5 §4 lessons overhaul does not exist** — including the "lesson progress JSON
import" this audit was asked to attack. You can't have a prototype-pollution bug
in a feature that was never built (see [I1](#i1)).

---

## Findings by severity

| # | Sev | Area | File | One-line |
|---|-----|------|------|----------|
| [H1](#h1) | **High** | Seed / hidden info | `src/engine/rng.ts:22` | 256-bit seed collapsed to 32-bit PRNG state → wall brute-forceable → hidden-info defeat |
| [H2](#h2) | **High** | Coach proxy / cost | `api/_lib/handler.ts:27` | Rate limiter keyed on spoofable `x-forwarded-for` + per-instance memory → no real cap on the shared key |
| [M1](#m1) | Medium | Coach proxy / cost | `api/_lib/handler.ts:34` | Per-room limit keyed on client-supplied `x-room-code` → rotate/omit to bypass; §9 "per-room" limit not actually enforced |
| [M2](#m2) | Medium | Room join | `server/src/index.ts:19` | No join-attempt / enumeration rate limiting; `/info` is a room-existence oracle |
| [L1](#l1) | Low | Coach proxy / injection | `api/_lib/validate.ts:164` | Free-text `fan.patterns[].name` (≤800 chars) reaches the review prompt — the "no client prompt text" invariant leaks here |
| [L2](#l2) | Low | Coach proxy / origin | `api/_lib/limiter.ts:55` | Same-origin check is trivially bypassed by any non-browser client; localhost branch always passes if both headers are localhost |
| [L3](#l3) | Low | Coach proxy / DoS | `api/_lib/handler.ts:57` | Any non-empty `x-byo-key` skips rate limiting → free function-invocation DoS |
| [L4](#l4) | Low | Server authority | `src/room/RoomHost.ts:301` | `handleLobby` uses unvalidated `msg.seat` as an object key (host-only object-injection / `__proto__`) |
| [L5](#l5) | Low | Crypto hygiene | `server/src/RoomDO.ts:167` | Seat-token and `ADMIN_KEY` comparisons are non-constant-time |
| [L6](#l6) | Low | Untrusted input | `src/room/RoomHost.ts:432` | `sanitizeName` strips only `\r\n\t` — bidi/zero-width/control chars pass; display-spoofing (not XSS) |
| [L7](#l7) | Low | WS robustness | `server/src/RoomDO.ts:235` | No message-size guard before `JSON.parse` (bounded by CF's 1 MB, still worth a cap) |
| [L8](#l8) | Low | HK rules | `src/engine/game.ts:16` | Thirteen-Orphans robbing-a-concealed-kong exception not implemented (documented deviation) |
| [L9](#l9) | Low | Dead code | multiple | `serialisePlayerView`, `handAnalysisPrompt`, `evalDiscards`, `summariseRules`, `scripts/verify-responsive.mjs`, `DEAD_WALL` vs `DEAD_WALL_SIZE` |
| [L10](#l10) | Low | Engine/UI drift | `src/ui/ActionBar.tsx:30` | "Can't declare" teaching message recomputes fan with hardcoded context → displayed faan can be wrong (cosmetic) |
| [L11](#l11) | Low | Toolchain | `package.json:26` | Pins preview `typescript@7` (+ vite@8 / vitest@4) → breaks typescript-eslint and the standard static-analysis ecosystem |
| [I1](#i1) | Info | Spec vs code | `src/App.tsx:18` | Phase 1.5 §4 lessons overhaul (persistence, mastery, spaced repetition, **progress JSON import/export**) was never built |
| [I2](#i2) | Info | Dependencies | `package-lock.json` | 10 CVEs (6 high / 4 moderate), all in dev/build tooling; production runtime deps are clean |

---

### H1 — The wall seed has 32 bits of entropy, not 256; the wall is brute-forceable {#h1}

**Severity:** High
**Where:** `src/engine/rng.ts:22-24` (`makeRng`), consumed by `src/engine/wall.ts:18`
(`buildWall`) via `src/engine/game.ts:168` (`createGame`); production seed from
`src/room/codes.ts:55` (`makeSecretSeed`).

**What's actually wrong.** `makeSecretSeed()` correctly produces 256 bits of
`crypto.getRandomValues` entropy. But `makeRng` throws almost all of it away:

```ts
export function makeRng(seed: string): Rng {
  const seedFn = xmur3(seed)
  let a = seedFn()          // <-- ONE 32-bit word; the rest of the seed is unused
  return { next() { /* mulberry32 over the 32-bit `a` */ } }
}
```

`xmur3` hashes the whole seed string but `makeRng` pulls a **single 32-bit
value** and uses it as mulberry32's entire state. mulberry32 has a 32-bit state.
So regardless of the seed length, the wall is one of at most **2³² ≈ 4.29 billion**
possible arrangements. The README and `RoomDO.ts:74-75` advertise this as a 256-bit
secret; structurally it is a 32-bit secret.

**Exploit.** The deal is fully deterministic from the wall
(`createGameWithWall` splices 13 tiles per seat in dealer order, dealer gets the
14th; `game.ts:115-140`), and the dealer is public in every `view.match`. A
cheating client:

1. Reads its own opening hand (13–14 known tiles) — available at deal, turn one.
2. Enumerates all 2³² initial states, runs mulberry32 → Fisher-Yates → the deal
   for each, and keeps the state whose deal reproduces its own hand. 13 known
   tiles is ~60 bits of constraint on a 32-bit state, so the match is unique.
3. Now holds the exact wall order → **every opponent's concealed hand and every
   future draw for the rest of the round.**

That's ~2³² shuffles of a 144-element array (~10¹² ops) — minutes on a multicore
box, seconds on a GPU. It's offline, needs no server bug, and defeats the exact
property server authority exists to protect ("otherwise the game is trivially
cheatable" — build-spec §13). The leak test can't catch this because nothing
actually leaves the server — the client *derives* the hidden state.

**Proposed fix.** Use a CSPRNG for the production wall shuffle instead of seeding
a 32-bit PRNG. Keep `makeRng` for tests/replays only. Minimal change: give
`buildWall` an injected shuffle source and, on the server, back it with
`crypto.getRandomValues` (Fisher-Yates drawing rejection-sampled indices, same
pattern already in `codes.ts:15`). If a reproducible seed must remain the
interface, expand the state to ≥128 bits (e.g. seed a `xoshiro256**`/PCG from the
full 256-bit hex) so the deal isn't enumerable. Either way, stop calling a
32-bit-state PRNG a 256-bit secret in the README.

---

### H2 — The coach proxy has no enforceable cap on the shared key {#h2}

**Severity:** High
**Where:** `api/_lib/handler.ts:27-31` (`clientIp`), `:18-25` (the two in-memory
limiters), `api/_lib/limiter.ts:23-52`.

**What's actually wrong.** Two independent problems compound into "no real limit":

1. **Spoofable identity.** `clientIp` trusts the *leftmost* value of
   `x-forwarded-for`:
   ```ts
   const first = Array.isArray(fwd) ? fwd[0] : fwd
   return first?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown'
   ```
   The left end of `x-forwarded-for` is the client-controlled end — each hop
   *appends*. An attacker sends `X-Forwarded-For: <random>` on every request and
   lands in a fresh rate-limit bucket each time. The correct source on Vercel is
   the single-valued `x-real-ip` (or the rightmost trusted hop), never the
   leftmost XFF token.
2. **Per-instance, cold-start-resettable memory.** `makeLimiter` stores counts in
   a `Map` in one function instance (`limiter.ts:24`). Vercel scales horizontally
   and cold-starts constantly, so "200/day" is really "200/day *per warm
   instance*." Parallel requests fan out across instances, each with its own fresh
   budget. The code comment and README both admit this ("resets on cold start —
   fine for a hobby deployment"), but the spec asked for limits "actually
   enforced, not just written," and as deployed there is no global ceiling.

**Cheapest way for a stranger to run up your bill** (the question you asked):

```
POST https://<your-app>/api/coach?stream=1
Headers: Origin: https://<your-app>   Host: <your-app>   (both trivial for curl)
         X-Forwarded-For: <fresh random each request>     (defeats the per-IP bucket)
         (no x-byo-key, so YOUR ANTHROPIC_API_KEY is spent)
Body:    { "view": <a minimal valid PlayerView> }          (passes validation)
```

Each call spends your key on a Haiku completion up to `max_tokens: 500`, plus a
possible Sonnet fallback (`coach.ts:9-10`) if the first attempt errors/refuses —
so a crafted "refusal" doubles the cost. `max_tokens` caps per-call output; it
does **not** cap request volume. You wouldn't even need the XFF trick — cold-start
fan-out alone means the daily cap rarely holds. The proxy test
(`api/__tests__/proxy.test.ts:120-150`) rate-limits with a *fixed*
`x-forwarded-for`, so it validates the counter and has a blind spot exactly where
the bypass is.

**Proposed fix.** (a) Key the limiter on `x-real-ip` (Vercel-set, single-valued),
not leftmost XFF. (b) Move the counter to shared storage (Vercel KV / Upstash
Redis) so the cap is global, not per-instance — the code already isolates this
behind `Limiter`, so it's a drop-in. (c) Add a hard global daily ceiling on the
shared key independent of IP, since the BYO-key hatch ([L3](#l3)) already exists
for anyone who hits it. (d) Consider a lightweight proof-of-work or a signed
same-origin token so a scripted client can't trivially masquerade as the browser.

---

### M1 — The per-room coach limit is keyed on a client-supplied header {#m1}

**Severity:** Medium
**Where:** `api/_lib/handler.ts:34-39` (`roomBucket`), `:25` (`roomLimiter`).

`roomBucket` reads the room code from the `x-room-code` request header, which the
client sets freely. Rotate it (or omit it entirely — then `roomBucket` returns
`null` and only the per-IP bucket, already defeated in [H2](#h2), applies) and the
"this room has hit its shared coach limit" ceiling never triggers. README §"AI
coach" and phase1.5-spec §9 both claim the proxy "rate-limits **per room** as
well as per IP" to stop "one room, or one stranger in it, from draining the key."
As written, the per-room limit is advisory only — there is no binding between the
`x-room-code` header and any authenticated room membership.

**Proposed fix.** The room code alone is a weak key (it's shared and guessable-ish
— [M2](#m2)); the per-room budget only means something if it's enforced against a
credential that proves you're in that room. Simplest: fold the per-room accounting
into the game server (Cloudflare), which already knows real seat membership via
seat tokens, and have *it* gate coach calls (or mint a short-lived per-room coach
token the proxy verifies). Until then, treat the per-room limit as cosmetic and
lean on a real global cap ([H2](#h2)d).

---

### M2 — No rate limiting on room join / enumeration {#m2}

**Severity:** Medium
**Where:** `server/src/index.ts` (worker entry — no limiter anywhere),
`server/src/RoomDO.ts:140-153` (`/info`), `:155-200` (`/ws` join).

Room codes are 6 chars over a 30-symbol alphabet (`codes.ts:10`) = 30⁶ ≈ **2²⁹·⁴**
(~729 M). That's adequate entropy against *targeted* guessing, and the codes are
correctly generated with rejection sampling (`codes.ts:15`, no modulo bias). The
gap is that **nothing throttles attempts.** `GET /api/rooms/<CODE>/info` is an
oracle that returns `{ joinable: true|false }` for any code, and there's no
per-IP limit at the worker, so an attacker can scan for live, joinable rooms and
then sit down in an open seat (join needs only the code — by design, per
`codes.ts:6-8`). Low payoff (griefing a stranger's lobby), but the audit asked
specifically about "join-attempt rate limiting," and there is none.

**Proposed fix.** Add a per-IP throttle at the worker for `/info` and `/ws`
(Cloudflare rate-limiting rules, or a small counter in a shared DO). Consider not
distinguishing "no such room" from "room full" in `/info` responses so it's less
useful as an enumeration oracle.

---

### L1 — Client-supplied text reaches the review prompt via `fan.patterns[].name` {#l1}

**Severity:** Low
**Where:** `api/_lib/validate.ts:158-169` (validated but free-text `name`),
flows through `src/analysis/serialise.ts:61` into `buildReviewPrompt`
(`buildPrompts.ts:79-83`).

The review validator caps pattern names to 40 chars but accepts **arbitrary
string content**, up to 20 of them, and `serialiseLog` interpolates them straight
into the prompt: `result.fan?.patterns.map((p) => p.name).join(', ')`. That's up
to ~800 chars of attacker-chosen text landing in the model prompt — a real
prompt-injection channel. The spec's "the client sends game state, never prompt
text" (phase1.5-spec §2.1) is *mostly* honored (top-level `system`/`prompt`/
`model`/`max_tokens` are all dropped — verified in `proxy.test.ts:61-72`), but the
pattern-name field is an exception the test suite doesn't cover. Impact is bounded
(it's the attacker's own review, capped tokens, constrained system prompt), which
is why it's Low — but it contradicts a stated invariant.

**Proposed fix.** Don't pass client-provided pattern *names* through at all —
they're cosmetic. Either drop `name` from the review payload and reconstruct the
patterns server-side from the (already-validated) action log + result, or
allowlist names against the known fan-table labels (`fanTable.ts`).

---

### L2 — Same-origin check stops browsers, not scripts {#l2}

**Severity:** Low
**Where:** `api/_lib/limiter.ts:55-67` (`sameOrigin`).

`sameOrigin` only defends against a browser on *another* site (CSRF): a
non-browser client sets `Origin` and `Host` to whatever it likes, so it's no
barrier to the scripted bill-drain in [H2](#h2). Separately, the dev-convenience
branch returns `true` whenever *both* `Origin` host and `Host` header start with
`localhost`/`127.0.0.1` — fine locally, but it means the check is fully bypassed
by anyone who can get both headers to read `localhost` (some proxies rewrite
`Host`). Note it as defense-in-depth, not a control. **Proposed fix:** treat the
origin check as CSRF-only (which it is), and rely on the real fixes in [H2](#h2)
for abuse; gate the localhost branch behind an explicit `NODE_ENV !== 'production'`.

---

### L3 — Any non-empty BYO key skips rate limiting {#l3}

**Severity:** Low
**Where:** `api/_lib/handler.ts:54-71`.

`byoKey` is accepted if it's a non-empty string under 250 chars, and its presence
skips *all* rate limiting (`if (!byoKey) { ...limit... }`). A garbage BYO key
means the Anthropic call 401s (so your key isn't spent — good), but the request
still runs origin check → validation → an upstream fetch, unthrottled. That's a
free function-invocation / upstream-request DoS on *your* Vercel compute and
Anthropic connection budget, even though the model bill is safe. Low, but it means
"has a BYO header" is a rate-limit exemption that requires no proof the key is
real. **Proposed fix:** apply a (looser) rate limit to BYO requests too, and/or
cheap-validate the key shape (`sk-ant-…`) before doing any upstream work.

---

### L4 — `handleLobby` indexes seats with an unvalidated key {#l4}

**Severity:** Low
**Where:** `src/room/RoomHost.ts:301` (`const target = this.seats[msg.seat]`).

`RoomDO.webSocketMessage` (`RoomDO.ts:233-247`) only checks that the parsed
message has a string `type` before handing it to `RoomHost`/`RoomRunner` — the
rest of the payload is untrusted. `RoomRunner.handleIntent` defends itself well
(`action.seat !== seat` → reject, verified by mutation), but `handleLobby` uses
`msg.seat` directly as an object key without an `isSeat` guard. Sending
`{type:'lobby',op:'seatKind',seat:'__proto__',kind:'bot'}` makes
`this.seats['__proto__']` resolve to `Object.prototype` (truthy, passes the
`!target` check) and the later assignment `this.seats['__proto__'] = {…}` sets the
*prototype* of `this.seats`. It's host-only (the op is gated to `hostSeat`) and
the numeric-seat iteration elsewhere is unaffected, so real impact is minimal —
but it's an object-injection smell in the one authority path that skips seat
validation. **Proposed fix:** `if (!isSeat(msg.seat)) return reject(...)` at the
top of `handleLobby`, mirroring the runner. Validate `ClientMsg` shape once at the
`RoomDO` boundary while you're at it.

---

### L5 — Non-constant-time secret comparisons {#l5}

**Severity:** Low
**Where:** `server/src/RoomDO.ts:167` (seat token), `server/src/index.ts:43`
(`ADMIN_KEY`).

`tokens[s] === token` and `request.headers.get('x-admin-key') !== env.ADMIN_KEY`
short-circuit on the first differing byte. Over a network, against a 128-bit
random seat token, a timing attack is not practically exploitable; for a
long-lived `ADMIN_KEY` it's marginally more relevant. Flagged because you asked
about token comparison specifically. **Proposed fix:** compare with a
constant-time equal (hash both sides and compare, or WebCrypto
`crypto.subtle.timingSafeEqual`-equivalent) — cheap and removes the question.

---

### L6 — Display-name sanitizer is minimal (not an XSS, a spoofing surface) {#l6}

**Severity:** Low
**Where:** `src/room/RoomHost.ts:431-434` (`sanitizeName`).

`sanitizeName` strips `\r\n\t`, trims, and caps at 24 chars — good enough that
**names are not an XSS vector** (confirmed: every render site interpolates them
through escaped JSX — `LobbyScreen.tsx:97`, `MultiplayerTable.tsx:48` — and there
is no `dangerouslySetInnerHTML` anywhere in `src/`). What still passes: bidi
overrides (U+202E), zero-width joiners, and other C0/C1 control chars, so a player
can pick a name that visually impersonates another seat or scrambles the lobby
layout, and there's no uniqueness check. Cosmetic/social, not code execution.
**Proposed fix:** whitelist to printable Unicode (strip `\p{C}` and bidi controls),
optionally NFC-normalize, and dedupe display names within a room.

---

### L7 — No size guard before parsing WS messages {#l7}

**Severity:** Low
**Where:** `server/src/RoomDO.ts:235`.

`JSON.parse(typeof message === 'string' ? message : '')` runs on whatever the
socket delivers. Cloudflare caps WS frames at ~1 MB so this is bounded, but a
client can still force a 1 MB parse per message. Out-of-order and malformed
messages *are* handled well (bad JSON is caught and dropped; illegal game actions
are rejected by `legalActions`; non-string binary frames become `''` and no-op).
**Proposed fix:** reject messages over a few KB before parsing — no legitimate
`ClientMsg` is large.

---

### L8 — Robbing a concealed kong for Thirteen Orphans is not implemented {#l8}

**Severity:** Low (documented HK-rules deviation)
**Where:** `src/engine/game.ts:12-16`.

The engine deliberately makes only *added* kongs robbable and never concealed
ones. Some HK houses allow robbing a concealed kong specifically to complete a
Thirteen Orphans wait. It's called out honestly in the comment and the README, so
this is a "confirm you meant it" item, not a bug — but it's a real rules variant
and worth a five-minute check against how your family actually plays (the spec
explicitly invited exactly that conversation).

---

### L9 — Dead code / unused exports {#l9}

**Severity:** Low
**Where:** knip + manual confirmation.

- `src/analysis/serialise.ts:9` `serialisePlayerView` — only referenced by its own
  test; the client stopped serialising views when prompt-building moved
  server-side.
- `src/analysis/prompts.ts:5` `handAnalysisPrompt` — dead (superseded by
  `coachFacts`).
- `src/lessons/efficiencyTrainer.ts:32` `evalDiscards`, `src/ui/LobbyScreen.tsx:232`
  `summariseRules` — exported, unused.
- `scripts/verify-responsive.mjs` — not referenced by any npm script (only
  `verify-ui.mjs` is).
- `DEAD_WALL` (`game.ts:26`) vs `DEAD_WALL_SIZE` (`wall.ts:6`) — two names for the
  same constant (14); one is redundant.
- Several unused exported types (`Phase`, `MeldType`, `KongStyle`, `DecompSet`,
  `RoomPreflight`, …) — harmless but noise.

knip also lists `api/*.ts`, `server/src/*.ts` as "unused files" and their exports
(`makeSecretSeed`, `CODE_LENGTH`, etc.) as unused — those are **false positives**:
they're deployment entry points (Vercel functions, the Worker) knip can't see
without an entry config. **Proposed fix:** delete the genuinely-dead symbols; add
a `knip.json` declaring `api/*.ts` and `server/src/index.ts` as entry points so
future runs are trustworthy.

---

### L10 — `ActionBar` recomputes fan for the "can't declare" message {#l10}

**Severity:** Low (cosmetic)
**Where:** `src/ui/ActionBar.tsx:30-42`.

The actual win button correctly comes from `view.legal` (`ActionBar.tsx:20-24`) —
the single source of truth holds for *what's allowed*. But the "your hand is
complete but under the minimum" teaching message re-derives the fan total with a
locally-built `ScoringContext` that hardcodes `selfDraw: true`,
`lastWallTile: false`, `kongReplacement: false`. If the real winning context
differs (e.g. a kong-replacement or last-tile win), the **number shown** in that
message can be wrong even though the button behavior is correct. Teaching tool
showing a wrong faan count is worth fixing. **Proposed fix:** have the engine
expose the blocked-win fan (it already computes it inside `legalActions` →
`winFan`) rather than the UI reconstructing context.

---

### L11 — Bleeding-edge toolchain pins block static analysis {#l11}

**Severity:** Low
**Where:** `package.json:26` (`"typescript": "^7.0.2"`), also `vite@^8`,
`vitest@^4`, `wrangler@^4`.

`typescript@7` is the preview native (Go) port. It typechecks fine (`tsc -b` is
clean), but it is **not supported by typescript-eslint** — its peer range is
`>=4.8.4 <6.1.0`, and at runtime `@typescript-eslint/typescript-estree` crashes
trying to load the port's API (reproduced during this audit; see
[Tooling](#tooling)). Net effect: the project cannot run the standard
ESLint + typescript-eslint stack, which is why there's no lint config in the repo.
That's a real maintainability cost — you lose `eslint-plugin-security`,
`no-floating-promises`, exhaustive-deps, etc. — plus the usual supply-chain
exposure of pinning three tools to their newest majors. **Proposed fix:** pin
`typescript` to a released `5.x` for the toolchain's sake (nothing in the code
needs TS7 semantics), or wait for typescript-eslint TS7 support before relying on
it; then add a committed flat ESLint config with the security plugin.

---

### I1 — Phase 1.5 §4 lessons overhaul was never built {#i1}

**Severity:** Informational (spec-vs-code, and it neutralizes one of the audit's
target attack surfaces)
**Where:** `src/App.tsx:18`, `src/lessons/LessonScreen.tsx:89`, absence of any
`src/lessons/{persistence,mastery,scheduler}.ts` or `content/explanations.json`.

You asked me to attack "the lesson progress JSON import (prototype pollution,
malformed data, version mismatch)." **It doesn't exist.** The whole Phase 1.5 §4
lessons overhaul is absent:

- Lesson completion is ephemeral React state: `App.tsx:18`
  `const [completedUnits, setCompletedUnits] = useState<Set<number>>(new Set())`.
- `LessonScreen.tsx:89` literally renders "*Progress lives in this browser tab —
  refreshing starts the course over (by design: no storage).*"
- No `localStorage["mahjong.progress.v1"]`, no versioned envelope, no `migrate()`
  chain, no export/import buttons, no mastery/decay, no spaced-repetition
  scheduler, none of the §4.3 procedural generators beyond the two original
  trainers.

Meanwhile `docs/superpowers/specs/2026-07-16-mahjong-phase1.5-design.md:73-81`
describes all of it as designed and decided, and phase1.5-spec §4 requires it.
The committed README already reflects reality for lessons ("Progress lives in
React state only") — so the README and the design doc disagree with each other.
Phase 1.5's §2 (proxy), §3 (coach speed / `analysis.ts`), and §5 (design system /
tile components) *were* built; §4 was skipped, and then Phase 2 (multiplayer)
happened on top. Not a vulnerability — but the audit's "untrusted JSON import"
threat model has no target, and you should decide whether §4 is still on the
roadmap or whether the design doc should be corrected.

---

### I2 — Dependency CVEs are all in dev/build tooling {#i2}

**Severity:** Informational
`npm audit`: **10 vulnerabilities (6 high, 4 moderate), 0 critical.** Every one is
a transitive dev/build dependency — `@vercel/node` (→ `undici`, `path-to-regexp`,
`@vercel/build-utils`, `minimatch`, `ajv`, `js-yaml`) and `wrangler`
(→ `smol-toml`). **None are in the shipped runtime deps** (`react`, `react-dom`,
`@fontsource-variable/*` — all clean). The coach proxy uses the platform's global
`fetch` in production (Vercel-managed undici), not the pinned dev copy, so the
`undici` advisories don't map to a live request path. Still worth clearing since
`wrangler`/`@vercel/node` are your deploy path: `npm audit fix` handles the
`smol-toml` moderate cleanly; the `undici`/`path-to-regexp` chain needs a
`@vercel/node` major bump (`npm audit fix --force` → `@vercel/node@3`, verify the
`(req,res)` handlers still typecheck). No action is load-bearing for security.

---

## Answers to the specific questions you posed

**1. PlayerView boundary (re-derived from scratch).** Sound. `playerView`
(`game.ts:482-512`) projects only: the seat's own `concealed`; per-seat
`handCounts` (public tile-back counts); melds with **other seats' concealed kongs
masked to `tiles: []`** (`game.ts:485-487`); all discards/bonus (public);
`wallCount` as a number, never the wall array; and `legalActions` for that seat
only. `GameState` has **no seed field at all**, so no field can transitively leak
it. The dead wall is positional (last 14 of `wall`) and never projected. Error
paths reflect only the client's own action / public tiles / generic strings back
via `rejected` (`RoomRunner.handleIntent`), and the draw *action* carries no tile
(`game.ts:37`), so the post-round log discloses public events only — losers'
hands are never revealed. No transitive exposure of another seat's concealed
tiles, wall order, dead wall, or seed found.

**2. The leak test — does it have teeth?** Yes, real teeth. Three independent
prongs (`leak.test.ts`): a path allowlist that fails on any unexpected key (so a
`wall`/`hands`/`seed` field anywhere fails), a per-tile-kind **conservation**
check (`visible + hidden == total`, so a single leaked tile breaks the equation),
and concealed-kong masking — all reconstructed independently from the seed + the
disclosed log, *not* from `playerView`, so a projection bug can't vouch for
itself, plus a forbidden-key walk. **I mutation-tested it:** injecting a
neighbour's hand into `concealed` turns the main leak test red (conservation
prong). It is the strongest test in the repo. One coverage gap worth knowing:
`rejected.reason` is allowlisted as a free string and not scanned for tile
content, and the `room`/`joined` messages (from `RoomHost`, not the runner)
aren't covered by the harness — neither leaks today, but the guard wouldn't catch
a future regression there.

**3. The seed.** Crypto-random (256 bits, `codes.ts:55`), generated server-side in
a `RoomDO` closure (`RoomDO.ts:74-76`), consumed by `createGame`, never stored in
`GameState`, never in any `ServerMsg`, never logged. The `/debug` dump exposes the
realized wall but not the seed, and it's `ADMIN_KEY`-gated. Secrecy is intact —
the problem is **entropy, not exposure** ([H1](#h1)): it's a 32-bit secret in a
256-bit wrapper.

**4. Server authority.** Enforced. Every inbound message lands in
`RoomDO.webSocketMessage` → `RoomRunner`/`RoomHost`. Game actions go through one
reducer: `applyAction` (`game.ts:408-413`) canonicalizes the action and checks it
is a member of `legalActions(state, action.seat)` **before** mutating a
`structuredClone` — so malformed, illegal, out-of-turn, or impersonating actions
all throw and are rejected. `RoomRunner.handleIntent` additionally rejects any
intent whose `action.seat` ≠ the transport seat, and any intent for a non-human
seat. **Mutation-tested:** removing the legality gate turns `game.test` red;
removing the `action.seat !== seat` guard turns a `room` test red. The one weak
spot is `handleLobby` not validating `msg.seat` ([L4](#l4)), and the fact that the
runner-layer authority is thin — each guard is caught by a *single* test, so the
margin is small.

**5. Coach proxy.** Client **cannot** supply `model`, `system`, `messages`, or
`max_tokens` — those are pinned server-side (`coach.ts`/`review.ts` + `handler.ts`)
and the top-level `system`/`prompt` fields are dropped (verified by test). Body is
strictly schema-validated (`validate.ts`). The holes are: rate limits are **not**
effectively enforced ([H2](#h2), [M1](#m1)), origin check is CSRF-only
([L2](#l2)), and one free-text field slips into the review prompt ([L1](#l1)). The
cheapest bill-drain is written out in full under [H2](#h2).

**6. Seat tokens & room codes.** Tokens: 128-bit `crypto` hex (`codes.ts:49-51`) —
good entropy; comparison is non-constant-time but not practically exploitable
([L5](#l5)). Room codes: 2²⁹·⁴, rejection-sampled, no modulo bias — adequate, but
**no join-attempt rate limiting** ([M2](#m2)).

**7. Dependencies & secrets.** CVEs: dev-tooling only ([I2](#i2)). Secrets in
history: **verified clean** — the only `sk-ant-` string across all history is
`'sk-ant-fake'` in `proxy.test.ts`, deliberately too short to match the hygiene
pattern (`check-no-keys.mjs` requires `{8,}` trailing chars). The `check-no-keys`
gate (`pretest` + `postbuild`) is a genuine control and it passes.

**Quality: engine purity** — clean. No `react`/`react-dom`/DOM/`fetch`/
`WebSocket`/storage imports anywhere under `src/engine`. No rule logic is
reimplemented outside the engine: `bots.ts`, the lessons, and the server all
*call* `isWinningHand`/`decompose`/`scoreBest`/`legalActions`/`shanten` rather
than re-encoding rules. (`ActionBar` calls the engine too — [L10](#l10) is a
context-reconstruction nit, not a reimplementation.)

**Quality: transport abstraction** — clean. `RoomRunner` imports only
`type { Transport }` (+ clock + engine + protocol *types*); it has no socket,
`fetch`, or serialization knowledge. Local and network are genuinely one code
path, and `parity.test.ts` proves byte-for-byte identical per-seat output over
`LocalTransport` vs a JSON-serializing sim — this is not two implementations that
happen to agree.

**Quality: assumption comments** (grepped and listed):

| Where | Assumption | Verdict |
|---|---|---|
| `win.ts:125` | Seven Pairs = 7 *distinct* pairs; 4-of-a-kind is not two pairs | Matches spec §3; code enforces it (`hist.size !== 7` / `c !== 2`). Note: Seven Pairs is itself an unusual inclusion for pure HK, but the spec asked for it. |
| `game.ts:6-16` | Deal is 13-sequential-then-1 (≡ 4-4-4-1 on a shuffled wall); dead wall positional; added kongs robbable, concealed kongs not | Deal equivalence holds. Concealed-kong-rob deviation is the only real HK variant — see [L8](#l8). |
| `game.ts:16` | Thirteen-Orphans rob-concealed-kong exception deliberately omitted | HK-rules variant; confirm against family rules ([L8](#l8)). |
| `fan.ts` design doc | All Honours *subsumes* All Pungs; Great>Small; Pure>Mixed; Nine Gates>Pure | Consistent and enforced structurally + via the `SUBSUMES` map (`fan.ts:128-140`); mutation-tested. |
| `protocol.ts:36` | Default 0 faan minimum ("that's how the family plays") | Matches spec §4. |
| `bots.ts:6` | "advanced" is strong-heuristic, not superhuman | Honest, matches README. |

No assumption comment looks *wrong* about HK rules; the only one worth a
conversation is the concealed-kong-robbing omission, and it's already flagged in
code.

**Quality: dead code / `any` / `as` / `@ts-ignore` / raw hex-px.** Dead code:
[L9](#l9). `any`/`@ts-ignore`/`@ts-expect-error`: effectively **none** in non-test
source (one false hit — the word "any" in a comment). `as` assertions: 41, all
idiomatic (`{} as Record<Seat,…>` builders, post-guard narrowing like
`id[0] as Suit`, controlled-select `e.target.value as Difficulty`) — none unsafe.
Raw values in components: **0 hex, 0 real px** — the only 5 `px` matches are inside
comments describing 44px tap targets. The design-token discipline held.

**Quality: test teeth (mutation sample).** Baseline: 177/177 pass, `tsc --strict`
clean. Four mutations, all correctly caught:
1. Leak a neighbour's hand into `concealed` → leak test **fails**.
2. Disable `applyAction`'s legality gate → `game.test` **fails**.
3. Remove Great-Dragons subsumption → `fan.test` **fails**.
4. Remove the runner's `action.seat==seat` guard → `room` test **fails**.
Caveat noted above: authority mutations each trip only one test — the suite proves
the boundary exists but wouldn't survive much thinning.

---

## Tooling

| Tool | Ran? | Result |
|---|---|---|
| `tsc --strict` (`npm run typecheck`) | ✅ | Clean (app + server). |
| `vitest` (`npm test`) | ✅ | 177/177 pass; mutation-tested 4 key tests (all have teeth). |
| `npm audit` | ✅ | 10 vulns (6 high / 4 moderate), all dev/build tooling — [I2](#i2). |
| `knip` | ✅ | Dead code — [L9](#l9); note the api/server entry-point false positives. |
| **semgrep** | ❌ **could not run** | Installs, but crashes on execution: `pyo3_runtime.PanicException` in the system `cryptography`/PyJWT Rust bindings on this sandbox. Not silently skipped — **worked around** with manual pattern scans for its JS/TS/React sink rules: no `dangerouslySetInnerHTML`/`innerHTML`, no `eval`/`new Function`, no `child_process`, no dynamic `fs`, prototype-pollution surfaces reviewed (only [L4](#l4)), taint into `fetch` reviewed (coach proxy §H2/M1/L1). |
| **eslint + typescript-eslint + eslint-plugin-security** | ❌ **could not run** | `typescript-estree` crashes loading the preview `typescript@7` port ([L11](#l11)) — a genuine project issue, not just a sandbox one. Worked around with manual scans for the security-plugin rule set (object-injection, unsafe-regexp/ReDoS, non-literal-fs, eval) and the strict `tsc` pass covers the type layer. |

No `package.json`/lockfile changes were committed — the audit tooling was
installed with the working tree left clean (verified before writing this report).

---

## Proposed permanent setup (not enabled — your call)

Both are free on public repos and worth more than any one-shot audit:

**1. Dependabot** — `.github/dependabot.yml`:
```yaml
version: 2
updates:
  - package-ecosystem: npm
    directory: "/"
    schedule: { interval: weekly }
    open-pull-requests-limit: 10
    groups:
      dev-tooling:
        patterns: ["@vercel/*", "wrangler", "vite", "vitest", "typescript*", "eslint*"]
  - package-ecosystem: github-actions
    directory: "/"
    schedule: { interval: weekly }
```
This is the standing answer to [I2](#i2) — the dev-tooling CVEs would arrive as
grouped PRs instead of an audit finding.

**2. CodeQL** — `.github/workflows/codeql.yml` (default `javascript-typescript`
query pack, on push/PR to the default branch + weekly cron). It runs in GitHub's
environment, so it sidesteps the local semgrep/eslint sandbox breakage above and
gives you the taint analysis (client-input → prompt, header → limiter key) that
would have flagged [H2](#h2)/[L1](#l1) automatically. Because CodeQL builds with
its own toolchain it is unaffected by the `typescript@7` pin ([L11](#l11)) — it's
the most reliable static-analysis option for this repo right now.

Optional third: a committed flat **ESLint** config with `eslint-plugin-security`
once `typescript` is back on a 5.x line ([L11](#l11)), wired into CI, so the
lint-layer findings (floating promises, object injection, exhaustive-deps) are
caught on every PR rather than by hand.
