# Mahjong — Play + Learn 🀄

A web app for learning **Hong Kong mahjong**: play full rounds against three
bots on a night-table felt, grind a Duolingo-style course with spaced
repetition, and drill the two skills beginners struggle with most — tile
efficiency and reading the discard pool. An AI coach narrates exact
engine-computed analysis, served through this app's own key-safe proxy.

Built for a player learning to play with family who use a **0 faan minimum** —
the minimum is configurable (0 / 1 / 3, default 3) and the "your hand is
complete but you can't declare it" moment is taught explicitly.

## Quick start

```bash
npm install
npm run dev      # game + lessons + local /api functions
npm test         # full suite (Vitest)
npm run build    # typecheck + build + key-hygiene check
```

Node LTS. The tile gallery (design reference) lives at `/#/gallery`.

**AI coach locally:** put a key in `.env.local` (gitignored, server-side only):

```bash
echo "ANTHROPIC_API_KEY=sk-ant-…" > .env.local   # no VITE_ prefix — never bundled
```

Restart `npm run dev` afterwards. Without a key everything else works; the
coach shows a clean "not configured" state.

**Deploying (Vercel):** the repo is a standard Vite app with `/api`
functions. Set `ANTHROPIC_API_KEY` in the project's environment variables —
that's the only configuration.

## How the pieces fit

```
src/
  engine/     pure TypeScript, zero React imports, fully unit-tested
  ui/         React components; renders engine state, dispatches engine actions
  lessons/    course engine (mastery/scheduler) + generators + drills
  analysis/   client for the /api coach proxy
api/          Vercel functions: validate game state, build prompts, call Anthropic
design-system/  generated MASTER.md + per-page art direction
```

The engine is the single source of truth. The UI renders from
`playerView(state, seat)`; bots receive the same `PlayerView` and nothing
else; lesson items validate every answer through engine calls; and the coach
proxy imports the same engine server-side.

### Tile notation

`m1..m9` characters 萬, `p1..p9` circles 筒, `s1..s9` bamboo 索, `wE wS wW wN`
winds, `dR dG dW` dragons, `bf/bs 1..4` flowers/seasons. `hand("m1 m2 m3")`
parses a list.

### Tiles are components, not fonts

Tile faces are procedural SVG (`src/ui/tiles/`): circles and bamboo drawn
from layout tables, a hand-drawn 1索 sparrow, 白 as the traditional blue
frame. The CJK faces use a **3.2 KB self-hosted Noto Serif TC subset** (17
glyphs), so every device renders identical tiles — no system-font or
emoji-presentation surprises. See `ATTRIBUTION.md` for licences.

## Engine API tour

| Module | Key exports | What it does |
| --- | --- | --- |
| `tiles.ts` | `t`, `hand`, `sortTiles`, `glyph`, `tileName` | Tile model and parsing |
| `rng.ts` | `makeRng(seed)`, `shuffle` | Seedable RNG — games and drills are reproducible |
| `wall.ts` | `buildWall` | 144-tile wall (136 with flowers off), dead wall = last 14 |
| `win.ts` | `decompose`, `isWinningHand`, `isValidChow/Pung/Kong` | Every valid reading of a hand (standard / seven pairs / thirteen orphans) |
| `fan.ts` / `fanTable.ts` | `score`, `scoreBest`, `winDeclarable`, `defaultFanTable` | Faan patterns with subsumption; every value in one tweakable table |
| `shanten.ts` | `shanten`, `usefulTiles` | Distance-from-win (−1 won, 0 tenpai) |
| `analysis.ts` | `rankDiscards`, `readOpponents` | Ranked discards (shanten, ukeire, per-opponent danger) and opponent reads — the facts the coach, aids and drills all share |
| `game.ts` | `createGame`, `applyAction`, `legalActions`, `playerView` | Pure serialisable reducer with the claim window and full action log |
| `bots.ts` | `botAction`, `dangerScore` | easy / intermediate / advanced policies over `PlayerView` |

`applyAction` validates against `legalActions` and throws on anything
illegal; `GameState` survives a JSON round-trip — the Phase 2 multiplayer
server runs this exact module as the authority.

## The AI coach

**The engine computes, the model explains.** The client posts raw game state
to `/api/coach`; the server validates it against a strict schema, runs
`rankDiscards`/`readOpponents`, and hands the model facts with orders not to
recompute. The ranked table renders locally at ~0 ms; the prose streams in
underneath (Haiku in-game for latency, Sonnet for the post-round review,
Haiku→Sonnet fallback on error/refusal). Responses are prefetched when it
becomes your turn (while the panel is open), cached per position, and
rate-limited server-side (20/min, 200/day per IP, in-memory — resets on cold
start; swap for KV if it ever matters).

**Key hygiene:** the key lives in `process.env` on the server only. The
proxy rejects non-same-origin requests and anything that isn't a validated
`PlayerView`/action log — no client-supplied prompts, models, or token
limits, ever. `scripts/check-no-keys.mjs` fails any build or test run where
`sk-ant-` or a `VITE_`-exposed key variable appears in `src/`, `api/`, or
`dist/`. Optional BYO key in Settings is forwarded as a header (memory only,
skips the shared rate limit).

## The course

- **~20 concepts** with prerequisite unlocking, per-concept mastery (EMA
  weighted by difficulty and response speed), and **spaced repetition**
  (Leitner boxes: 0/1/2/4/8/16-day intervals).
- **Sessions** of ~13 items: due reviews first, weakest concepts, a little
  new material. One answer per presentation — missed concepts requeue later
  in the session instead of retry-until-right.
- **Every item is generated** from the engine (recognition, set spotting,
  winning-hand near-misses, decompose-it accepting any valid reading, faan
  counting whose distractors are the real double-counting mistakes,
  can-I-declare at 0/1/3 minimums, best discard, suit reads, safe tiles).
  Infinite items; difficulty scales within each concept.
- **Progress persists** in `localStorage` under one versioned key with a
  migration path, plus export/import as JSON. Streak, daily goal, XP.
- **Explanations are instant and offline**: engine facts templated at render
  time plus static per-concept prose (`src/lessons/content/explanations.json`,
  regenerable offline via `scripts/generate-explanations.mjs`).

### The two drills

- **Tile efficiency trainer** — endless generated hands at a chosen tier
  (up to *expert*, where the efficient discard is dangerous against a
  threatening board). Graded on a curve (optimal / within-2-ukeire /
  suboptimal / blunder) with the full ranked table: shanten, live-tile
  count, and *which* tiles advance. Timed mode with decaying score; your
  recurring error patterns are mined locally from the answer log.
- **Discard-reading quiz** — one seeded real game shown at two depths
  (reads sharpen with evidence), confidence-rated answers with calibration
  tracking, and a ground-truth reveal: the inference next to what was
  actually in their hands.

## Rules implemented & documented decisions

Hong Kong style: 144 tiles, counter-clockwise turns; chow/pung/kong
(concealed, exposed, added; dead-wall replacements); flowers auto-replaced;
claim priority win > pung/kong > chow with chow restricted to the next seat;
dealer repeats on dealer win/draw; round wind advances each full rotation.

Decisions the spec left open (details in `docs/superpowers/specs/`):
Seven Pairs needs seven *distinct* pairs; All Honours ⊃ All Pungs, All Kongs
⊃ All Pungs, Nine Gates ⊃ Pure One Suit; Great/Small Dragons and Winds
subsume their contained pungs; no point settlement (cumulative-faan
scoreboard); no robbing-the-kong; positional dead wall.

**Bots, honestly:** the advanced bot is strong-heuristic play — shanten
efficiency, discard reading, safety, push/fold — not search, and nothing
close to superhuman.

## Tests

136 tests: engine gates (decomposition, faan exclusivity, shanten, scripted
rounds, bot legality fuzzing over whole games), the analysis primitives, the
proxy validators/limiter/prompt-builder, the mastery scheduler, and every
item generator (each answer cross-checked against the engine).

## Roadmap

Phase 2 (specced, not built): 2–4 humans across devices with bot fill-ins —
an authoritative server running this exact engine, `PlayerView` per client,
timed claim windows, reconnect from the action log.
