# Mahjong — Play + Learn 🀄

A client-only web app for learning **Hong Kong mahjong**: play full rounds against
three bots, work through a Duolingo-style lesson track, and drill the two skills
beginners struggle with most — tile efficiency and reading the discard pool. An
optional AI coach (bring your own Anthropic API key) analyses your hand mid-round
and reviews the round afterwards.

Built for a player learning to play with family who use a **0 faan minimum** —
the minimum is configurable (0 / 1 / 3, default 3) and the "your hand is complete
but you can't declare it" moment is taught explicitly.

## Quick start

```bash
npm install
npm run dev      # dev server
npm test         # run the whole test suite (Vitest)
npm run build    # typecheck + production build
```

Node LTS. No backend, no storage, no env vars. The Anthropic key (if you use the
AI coach) is typed into the UI at runtime and held in component memory only.

## How the pieces fit

```
src/
  engine/     pure TypeScript, zero React imports, fully unit-tested
  ui/         React components; renders engine state, dispatches engine actions
  lessons/    lesson units + the two drills; validates ONLY via engine calls
  analysis/   Anthropic API wrapper (fetch, fallback model, rate-limited)
```

The engine is the single source of truth. The UI holds a `GameState` in a
`useReducer`-style hook and renders from `playerView(state, seat)`; bots receive
the same `PlayerView` and nothing else. Lessons never re-implement a rule — if a
drill needs to know whether a hand wins, it calls `isWinningHand`.

### Tile notation

Used everywhere (tests, serialisation, docs): `m1..m9` characters 萬, `p1..p9`
circles 筒, `s1..s9` bamboo 索, `wE wS wW wN` winds, `dR dG dW` dragons,
`bf1..bf4` flowers, `bs1..bs4` seasons. `hand("m1 m2 m3")` parses a list.
Glyphs come from the Unicode mahjong block via `glyph()` — no image assets.

## Engine API tour

| Module | Key exports | What it does |
| --- | --- | --- |
| `tiles.ts` | `t`, `hand`, `sortTiles`, `glyph`, `tileName`, classifiers | Tile model and parsing |
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

## Bots — honest strength note

The advanced bot is **strong-heuristic play, not superhuman**: shanten
efficiency, per-opponent discard reading, safety estimation, and push/fold. It
should punish beginner mistakes and lose to a good club player. `dangerScore`
is exported and reused by the defence lesson and the discard-reading quiz, so
the drills grade with the same model the bots play by.

## Lessons and drills

Eight units in order (tiles → sets → winning shape → special hands → faan &
the minimum → reading discards → defence → guided play), each unlocking the
next. Progress lives in React state only — refreshing resets it (by design; the
app runs where browser storage is unavailable).

- **Tile efficiency trainer** — procedurally generated hands at a target
  shanten; your discard is graded optimal / acceptable / bad with a full
  per-discard table of shanten and live-tile counts.
- **Discard-reading quiz** — real mid-game positions from seeded bot games:
  which suit is an opponent short on, and which of your tiles is safest.

## AI coach (`src/analysis`)

Paste an Anthropic API key into the panel (memory only). Two actions, both
rate-limited and error-safe: **Analyse my hand** (realistic faan target, best
discard, one defensive note) and **Review that round** (three improvements tied
to specific turns from the action log). Uses `claude-fable-5`, falls back to
`claude-opus-4-8` on error or refusal.

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
- **Robbing the kong** is not implemented.
- The dead wall is positional (last 14 tiles) and not replenished.

## Tests

96 tests cover the engine gates (decomposition, faan exclusivity, shanten,
scripted full rounds on rigged walls, bot legality fuzzing over complete seeded
games) plus drill generators and prompt serialisation. The engine test suite is
the correctness signal for the whole app — the UI renders engine state and
dispatches engine actions, nothing more.

## Roadmap

Phase 2 (specced, not built): 2–4 humans across devices with bot fill-ins —
authoritative server running this exact engine, `PlayerView` per client, timed
claim windows, reconnect from the action log.
