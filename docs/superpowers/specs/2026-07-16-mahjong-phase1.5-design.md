# Design: Phase 1.5 — Key, Speed, Lessons, Design

**Source of truth:** [`2026-07-16-mahjong-phase1.5-spec.md`](./2026-07-16-mahjong-phase1.5-spec.md).
This records delegated decisions only. Engine behaviour from Phase 1 is frozen —
additions only (`analysis.ts`), never semantic changes.

## Delegated decisions

**Proxy (§2)**
- Vercel Node functions in `/api` (`coach.ts`, `review.ts`) using the classic
  `(req, res)` handler shape; they import `src/engine` directly — the same pure
  module the client uses, which is the Phase-2 pattern arriving early.
- The client posts **game state JSON** (a `PlayerView` or an action log), never
  prompt text. The server validates with hand-rolled strict validators
  (tile-id regex, seat-keyed records, length caps — ~no deps), computes facts
  with `rankDiscards`/`readOpponents` server-side, and builds the prompt there.
- Rate limit: fixed-window in-memory `Map` per function instance (20/min,
  200/day per IP). Documented limitation: per-instance, resets on cold start —
  acceptable for a hobby deployment, swappable for KV later.
- Same-origin check: `Origin` host must match `Host` (localhost/127.0.0.1
  allowed for dev). Missing Origin → 403.
- BYO key: `x-byo-key` request header; proxy uses it instead of the env key and
  skips rate limiting. Never persisted anywhere, never logged.
- Key hygiene: `scripts/check-no-keys.mjs` fails if `sk-ant-` appears in `src/`,
  `api/`, or `dist/`; wired as `pretest` and `postbuild`.

**Coach speed (§3)**
- Models: coach = `claude-haiku-4-5-20251001`, review = `claude-sonnet-5`,
  fallback haiku→sonnet on error/refusal. `claude-fable-5` removed from runtime.
- Streaming: proxy passes the Anthropic SSE stream through; client renders
  incremental text. Prefetch fires when it becomes the human's discard turn,
  aborts on action; cache keyed by a hash of the serialised view; one in-flight
  request max.
- The ranked-discard table renders locally and instantly from `rankDiscards`;
  prose streams in under it.

**Engine additions (§3.2)** — new `src/engine/analysis.ts`:
- `rankDiscards(view)` → per distinct tile: `shantenAfter`, `ukeire` (unseen
  advancing-tile count), `advancing` kinds, `dangerByOpponent`, sorted
  best-first. Reuses `shanten`, `usefulTiles`, `dangerScore` — no duplicated
  rules.
- `readOpponents(view)` → per opponent: suit discard counts, `likelyCollecting`
  (suits with the fewest discards when evidence is sufficient), `threat` 0–3
  (exposed melds + few discards + late wall), `safeTiles` (danger 0 kinds).

**Tiles (§5.3)**
- One `<TileFace>` SVG component: circles and bamboo fully procedural from
  layout tables; characters/winds/dragons as SVG `<text>` in **self-hosted
  subsetted Noto Serif TC** (OFL) — 17 glyphs (一二三四五六七八九萬東南西北中發白),
  built with `fonttools` to woff2, loaded via `@font-face`, recorded in
  `ATTRIBUTION.md`. 1索 is a hand-authored stylised sparrow path. White dragon
  is a blue double frame. Flowers/seasons are simple procedural motifs (petal /
  season glyph on a coloured corner tag). No Commons raster assets → no
  share-alike entanglement.
- Unicode glyph map stays in `tiles.ts` (engine, still used for text
  serialisation); the UI renderer swap happens entirely in `src/ui`.

**Design system (§5.1)**
- Generated with the vendored ui-ux-pro-max search script into
  `design-system/MASTER.md` (+ `table` and `lessons` page overrides); distilled
  into CSS custom properties in `src/theme.css` (Tailwind v4 `@theme` tokens).
  Components consume tokens only — no raw hex/px in component files. Where the
  generated system conflicts with §5.4 art direction, §5.4 wins.

**Lessons (§4)**
- Concepts: ~20 ids under `tile.*`, `set.*`, `shape.*`, `faan.*`, `declare.*`,
  `efficiency.*`, `defence.*`, `read.*`.
- Mastery per concept: exponential moving average of graded answers (weight by
  item difficulty; timed items scale by response speed), 0–1.
- Scheduling: SM-2-lite — per concept `box` 0–5 with intervals
  [0, 1, 2, 4, 8, 16] days; correct promotes, wrong demotes to box 1; overdue
  concepts sort first. Sessions: 12–15 items ≈ 3 new + rest due/weakest.
- Persistence: `localStorage["mahjong.progress.v1"]` — versioned envelope
  `{ version: 1, ... }` with a `migrate()` chain; export/import JSON buttons.
  The API key remains banned from storage.
- One answer per presentation; missed items re-queue later in the same session.
- Explanations: template prose filled from engine facts at render time, plus a
  static per-concept/error-class JSON (`src/lessons/content/explanations.json`)
  authored offline and committed; `scripts/generate-explanations.mjs` documents
  how to regenerate it with Sonnet (requires `ANTHROPIC_API_KEY` at build time,
  never at runtime).

**Ground rules carried over:** commit per phase; §5.6 is a hard user gate —
tile gallery + MASTER.md get reviewed before any UI is built on top.
