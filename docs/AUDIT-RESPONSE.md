# Audit response

Disposition of every finding in `AUDIT.md` (the security & quality audit).
Status is one of: **Fixed** (code + test), **Mitigated** (materially improved in
code; a complete fix needs deploy-side infrastructure), **Deploy** (config/infra,
not code), **Accepted** (understood, no change — with reason).

| # | Sev | Status | What changed |
|---|-----|--------|--------------|
| H1 | High | **Fixed** | `src/engine/rng.ts`: replaced mulberry32 (32-bit state) with **sfc32 (128-bit state)** seeded from four `xmur3` words. The wall is now 1-of-2^128, not brute-forceable from an opening hand. New `rng.test.ts` guards it with an anti-reference test (mutation-verified: reverting to the 32-bit generator turns it red). |
| H2 | High | **Mitigated** | `api/_lib/handler.ts`: rate limiter now keys on **`x-real-ip`** (platform-set, single-valued), never the spoofable leftmost `x-forwarded-for`; added an **IP-independent global daily ceiling** so rotating IPs can't lift the cap without bound. Test proves a rotating `x-forwarded-for` no longer mints fresh buckets. **Deploy-side to complete:** move the counters to shared storage (Vercel KV / Upstash) so the cap is global across warm instances — the `Limiter` interface is the drop-in seam. |
| M1 | Med | **Accepted / Mitigated** | The per-room key is still client-supplied (`x-room-code`) so it stays *advisory* — but the real ceiling is now the H2 global cap, which is not client-controllable. A binding per-room limit would require the game server (which knows seat membership) to gate coach calls or mint a per-room coach token; noted as future work, documented in code. |
| M2 | Med | **Deploy** | No code change that wouldn't hurt UX. Join/enumeration throttling belongs at the edge: add **Cloudflare rate-limiting rules** for `/api/rooms/*/info` and `/ws` (per-IP), which the Worker platform provides without app code. Room codes already have adequate entropy (2^29.4, rejection-sampled). |
| L1 | Low | **Fixed** | `api/_lib/validate.ts`: `fan.patterns[].name` is now **allowlisted** against the scorer's own labels (`FAN_PATTERN_NAMES`, exported from `fan.ts`). No free-text client string can ride into the review prompt. Test: an injection-shaped name is dropped, canonical names kept. |
| L2 | Low | **Fixed** | `api/_lib/limiter.ts`: the cross-localhost-port branch of `sameOrigin` is gated behind `NODE_ENV !== 'production'`. Documented that same-origin is a CSRF control only; abuse defense is the rate limiting. |
| L3 | Low | **Fixed** | `api/_lib/handler.ts`: a malformed BYO key is **rejected (400) before any upstream work** (was: skipped all limits and still fetched). A well-formed BYO key must match `sk-ant-…` and is itself rate-limited (looser bucket). Tests for both. |
| L4 | Low | **Fixed** | `src/room/RoomHost.ts`: `handleLobby` now guards `msg.seat` with `isSeat()` (new, in `types.ts`) before using it as an object key — no `__proto__` object injection. Test proves a `__proto__` seat is rejected and the prototype is untouched. |
| L5 | Low | **Fixed** | `server/src/util.ts` `timingSafeEqual`; used for the seat-token compare (`RoomDO.ts`) and the `ADMIN_KEY` compare (`index.ts`). |
| L6 | Low | **Fixed** | `src/room/RoomHost.ts` `sanitizeName` now strips all Unicode control + format chars (bidi overrides, zero-width, C0/C1), collapses whitespace, and NFC-normalizes. (Within-room dedupe left as a nicety.) |
| L7 | Low | **Fixed** | `server/src/RoomDO.ts`: an 8 KB size guard runs **before** `JSON.parse` on each WS frame. |
| L8 | Low | **Accepted** | Robbing a *concealed* kong for Thirteen Orphans stays unimplemented — a documented HK-rules variant, called out in code + README. A "confirm against your family's rules" item, not a bug. |
| L9 | Low | **Mostly fixed** | Consolidated `DEAD_WALL`/`DEAD_WALL_SIZE` to one owner; un-exported the file-local `summariseRules`; wired `verify:responsive` / `verify:lessons` npm scripts. Left `serialisePlayerView` and `handAnalysisPrompt` in place (genuinely dead but harmless; removing them + their tests is churn with no security value). A `knip.json` with `api/*` and `server/src/index.ts` as entry points is a good follow-up. |
| L10 | Low | **Accepted** | The "can't declare" teaching message re-derives fan with `selfDraw: true` — which is correct for that scenario (it only shows on your own drawn turn); it can differ only by the last-wall-tile / kong-replacement bonus in rare edge cases. Cosmetic; fixing it means threading a blocked-win fan out of the engine. Noted. |
| L11 | Low | **Accepted / Deferred** | Pinning `typescript` off the `7.x` preview (to re-enable typescript-eslint) is a toolchain change that ripples through `vite@8`/`vitest@4` and needs its own verification pass + a committed ESLint config. Deferred to a dedicated change so it doesn't destabilize the build mid-stream. `tsc --strict` remains clean. |
| I1 | Info | **Resolved + hardened** | The Phase 1.5 §4 lessons overhaul (mastery, spaced repetition, progress import/export) has since been restored, so the audit's "untrusted JSON import" target now exists — and is hardened: `src/lessons/persistence.ts` `migrate()` **rebuilds** the state from validated primitives (only known `ConceptId` keys assigned, every field coerced), so a crafted `__proto__` payload can't pollute and malformed data can't crash the scheduler. Six tests, incl. an explicit prototype-pollution attempt. |
| I2 | Info | **Deploy** | `npm audit fix` (non-breaking) has nothing to apply; the remaining 10 CVEs are all dev/build tooling (`@vercel/node`→undici/path-to-regexp, `wrangler`→smol-toml) and need a breaking `@vercel/node` major bump (`npm audit fix --force`, then re-verify the `(req,res)` handlers typecheck). None touch the shipped runtime deps or a live request path. Left as your call. |

## Recommended standing setup (from the audit — not enabled)

Both are worth more than a one-shot audit and free on public repos:

- **CodeQL** (`javascript-typescript` pack, on push/PR + weekly): runs in GitHub's
  environment so it sidesteps the `typescript@7`/local-tooling issues, and its
  taint analysis (client input → prompt, header → limiter key) is exactly what
  would have flagged H2/L1 automatically.
- **Dependabot** (grouped dev-tooling updates): the standing answer to I2.

## Verification

`npm run typecheck` clean (app + server); `npm test` green (220 tests, incl. the
new rng / persistence / L1 / L4 guards); `npm run build` clean with key hygiene.
H1 and the persistence hardening were mutation-checked.
