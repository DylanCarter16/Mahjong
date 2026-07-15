# Design: Hong Kong Mahjong — Play + Learn (Phase 1)

**Source of truth:** [`2026-07-15-mahjong-build-spec.md`](./2026-07-15-mahjong-build-spec.md) (the user's build spec). This
document does not restate it; it records the decisions the spec delegated, the approaches
chosen where alternatives existed, and the assumptions made under the spec's
"state your assumption and keep going" rule.

## Scope

Phase 1 only: single-player HK mahjong vs three bots, lesson track with two drill modes,
optional Anthropic-powered analysis. No backend, no storage, engine pure and serialisable
so Phase 2 (multiplayer server) can reuse it unchanged.

## Architecture

Exactly as spec §1: `src/engine` (pure TS, zero React imports, Vitest-tested),
`src/ui` (React, imports engine), `src/lessons` (content + drills, validates via engine),
`src/analysis` (Anthropic wrapper). Stack: Vite + React + TypeScript, Tailwind v4
(`@tailwindcss/vite`), Vitest. Node LTS, npm.

## Decisions the spec delegated

1. **Seven Pairs with four-of-a-kind** — spec dictates: NOT two pairs; seven *distinct*
   pairs required. (Comment lives in `win.ts`.)
2. **All Honours vs All Pungs** — All Honours *subsumes* All Pungs; only All Honours
   scores. Rationale: consistent with the spec's other subsumption rules (Pure > Mixed,
   Great > Small); All Honours is structurally always All Pungs, so scoring both
   double-counts the same property. Documented in `fan.ts`.
3. **Faan values** (`fanTable.ts`, all tweakable):
   Chicken/base 0; All Chows 1; Seat Wind 1; Round Wind 1; Dragon pung 1 each;
   Self-draw 1; own Flower/Season 1 each (non-own bonus tiles score 0; a full set of 4
   flowers or 4 seasons scores 2 extra); All Pungs 3; Mixed One Suit 3; Small Dragons 4;
   Seven Pairs 4; Small Winds 6; Pure One Suit 7; Great Dragons 8; All Honours 10;
   All Kongs 13; Nine Gates 13; Great Winds 13; Thirteen Orphans 13.
   Optional `faanCap` (default off) clamps the total when set (e.g. 13).
4. **Minimum faan** — setting 0 / 1 / 3, default 3. Enforced in `legalActions`: a
   complete hand below the minimum is not offered `declare-win` (the "complete but can't
   declare" teaching moment falls out of this for free).
5. **Claim resolution modelled as a phase** — after any discard the reducer enters an
   `awaiting-claims` phase listing which seats may claim what; each eligible seat submits
   `claim` or `pass` actions; when all have answered, resolution applies spec §2 priority
   (win > pung/kong > chow; multiple winners resolved in seat order from the discarder).
   Synchronous for bots in Phase 1, but it is the same shape as Phase 2's timed claim
   window, so the server can reuse it.
6. **Dealer rotation / multi-round play** — a round is the unit of play. "Next round"
   keeps the dealer on a dealer win or exhaustive draw, otherwise rotates seats and,
   after a full rotation, advances the round wind (E→S→W→N). Cumulative faan per seat is
   UI state only. Point *settlement* (base points, doubling, who-pays-whom) is out of
   scope for Phase 1 — the faan breakdown is the teaching tool.
7. **Flowers off** setting builds a 136-tile wall (no bonus tiles); flower faan rows
   simply never fire.

## Approaches considered

- **Shanten algorithm**: (a) full recursive search with memoisation over per-suit
  histograms — boring, correct, fast enough for 4 bots + trainer; (b) precomputed
  suit-shape tables (riichi-style) — fastest but complex to build and verify;
  (c) naive try-every-discard BFS — simplest but exponential. **Chose (a)**; optimise to
  (b) later only with a benchmark, per spec §14.
- **UI state**: (a) `useReducer` directly over the engine's `applyAction` + React
  context — no new dependency, engine stays the single source of truth; (b) Zustand or
  Redux — adds a store layer we don't need. **Chose (a)**.
- **Seedable RNG**: (a) in-repo mulberry32 + string-hash seed (~15 lines, zero deps);
  (b) `seedrandom` package. **Chose (a)**.
- **Anthropic access**: (a) plain `fetch` to `/v1/messages` with the
  `anthropic-dangerous-direct-browser-access` header — no dependency, explicit control
  of fallback (`claude-fable-5` → `claude-opus-4-8` on error/refusal); (b) official SDK with
  `dangerouslyAllowBrowser`. **Chose (a)** — the wrapper is ~60 lines and we own retry,
  rate-limit and fence-stripping behaviour.

## Data flow

`GameState` (engine) is held in a React `useReducer`. UI dispatches engine actions;
`legalActions(state, seat)` drives which controls render. Bot turns: UI effect asks
`botPolicy(playerView(state, seat), difficulty)` for an action and dispatches it.
`PlayerView` is constructed by the engine and is the *only* thing bots and the analysis
serialiser ever receive — concealed hands of other seats and wall order are structurally
absent from the type. Lessons import engine functions directly for validation; drills
generate positions by seeding `game.ts` and replaying to turn N.

## Error handling

Engine functions throw on illegal actions (programmer error — the UI/bots must only
submit legal actions); `applyAction` on an illegal action is a bug, surfaced loudly in
dev. Analysis wrapper never throws: every call returns a result-or-error object; UI
renders a dismissible error state. API key lives in a `useRef`/component state only —
never in props spread, never logged, never persisted.

## Testing

Vitest, colocated under `src/engine/__tests__/`. Gates per spec §4/§5/§6 must be green
before the next phase starts; scripted full-round tests per §8 with fixed seeds. Lessons
logic (progression, drill grading) gets its own tests; UI is exercised by the scripted
engine tests plus manual smoke (headless session — tests are the correctness signal).

## Phase order

Spec §12, unchanged, one commit per phase minimum.
