# Build Spec: Hong Kong Mahjong — Play + Learn

> **How to use this file:** paste the whole thing into Claude Code as your opening message on the `mahjong` repo.
>
> **If Superpowers is installed:** treat this document as the input to your brainstorming/planning phase. Run your normal brainstorm → plan → TDD → verify flow against it. Don't skip the planning phase; do skip re-asking me things this spec already answers.
>
> **If it isn't:** follow the phase order in §12 yourself, and enforce the gates.
>
> **Commit after every phase.** The session may be interrupted; the git log is the recovery mechanism. Small, working commits with real messages.

---

## 0. Context you need

I'm a first-year CS student, comfortable with TypeScript and React, but I've never built a game before. I'm learning Hong Kong mahjong to play with family — I know the tiles, I'm weak on defensive play and reading the discard pool, and the people I play with use a **0 faan minimum**. That's why this app is a *play + learn* app, not just a game: the lessons are the point, not a bolt-on.

Build **Phase 1 only** unless I explicitly say to continue. Phase 2 (multiplayer) is specced at the end so you make Phase 1 decisions that don't block it — do not build it now.

---

## 1. Stack and constraints

- **React + TypeScript + Vite.** Tailwind for styling. Vitest for tests.
- **No backend in Phase 1.** Everything client-side.
- **No `localStorage` / `sessionStorage`.** React state only. (This matters — the app has to run in environments where browser storage is unavailable.)
- **No API keys in the repo, ever.** The Anthropic key is entered at runtime in a UI field and held in memory only. Add a `.gitignore` that covers `.env*` regardless.
- Node LTS, npm.

### Architecture — non-negotiable

The game engine is a **pure, UI-independent TypeScript module with its own tests**. UI imports the engine; the engine never imports React. This is not stylistic — it's what lets the same engine run server-side in Phase 2 without a rewrite.

```
src/
  engine/              # pure logic, no React, fully unit-tested
    tiles.ts           # tile model, parsing, sorting, glyph map
    wall.ts            # wall build + seedable shuffle + dealing
    win.ts             # decomposition + win detection      <- hard
    fan.ts             # faan scoring                        <- hard
    shanten.ts         # distance-from-win calculation       <- hard
    bots.ts            # bot policies (pure functions)
    game.ts            # GameState + action reducer
    types.ts
    __tests__/
  ui/                  # React components; imports engine only
  lessons/             # lesson content + progression + drills
  analysis/            # Anthropic API wrapper
```

Write a real `README.md`: what the engine API is, how to run tests, how to run the dev server, and a short "here's how the pieces fit" section. Assume a future contributor (me, in three months) has forgotten everything.

---

## 2. Rules to implement (Hong Kong style)

- **144 tiles**: 3 suits (characters 萬 / bamboo 索 / circles 筒), 1–9 ×4 each = 108; 4 winds (E/S/W/N) ×4 = 16; 3 dragons (red 中 / green 發 / white 白) ×4 = 12; 8 bonus tiles (4 flowers + 4 seasons). Bonus tiles are set aside on draw and trigger a replacement draw from the back of the wall.
- 13 tiles per hand. Dealer (East) starts with 14 and discards first.
- Turn order **counter-clockwise**: E → S → W → N.
- **Melds**: chow (3-run, same suit, no wrapping 9-1-2), pung (triplet), kong (four — draw a replacement tile). Concealed vs exposed kongs are tracked separately (they score differently).
- **Claims on a discard**: win > pung/kong > chow. Chow may only be claimed by the player to the discarder's immediate right (i.e. next to play). If multiple players can win off the same discard, resolve in seat order starting from the discarder.
- **Winning shape**: 4 melds + 1 pair, or Seven Pairs, or Thirteen Orphans.
- **Configurable minimum faan**: settings option for 0 / 1 / 3, **default 3** for the main game but **0 must be fully supported** — my family plays 0. Below the minimum, a complete hand cannot be declared.
- **Round end**: win, or wall exhausted (draw). Wall exhaustion means the live wall is empty — the last 14 tiles are the dead wall reserved for kong replacements.

## 3. Special hands (shapes — only three exist)

- **Standard**: 4 melds + 1 pair.
- **Seven Pairs**: 7 pairs. Decide and document whether four-of-a-kind counts as two pairs — pick "no" (must be 7 *distinct* pairs) and note the assumption in a comment.
- **Thirteen Orphans**: 1 & 9 of each suit + all 4 winds + all 3 dragons + one duplicate of any of those 13.

Everything else people call a "hand" (All Pungs, Mixed One Suit, etc.) is a **faan pattern scored on top of a shape**, not a separate shape. Do not model them as shapes.

---

## 4. `engine/win.ts` — the hard part

```ts
decompose(concealed: Tile[], melds: Meld[]): Decomposition[]
isWinningHand(concealed: Tile[], melds: Meld[]): boolean
```

`decompose` returns **every valid way** to break the hand into sets + pair. This matters: the same 14 tiles can decompose multiple ways, and faan scoring must evaluate all of them and take the highest. Returning only the first decomposition is a bug that will silently under-score hands.

Standard-shape algorithm (recursive decomposition over a histogram):
1. Build a count-by-tile-type histogram.
2. For each type with count ≥ 2: tentatively remove 2 as the **pair**, then attempt to decompose the remainder entirely into melds. Collect every success.
3. Meld decomposition: take the lowest remaining tile. Try removing it as (a) a pung, and (b) a chow with the next two in the same suit. **Try both branches** — don't return early on the first that works. Recurse on the remainder.
4. Success when zero tiles remain. Honours can only form pungs/kongs, never chows. Chows never wrap around 9→1.
5. Already-exposed melds are fixed and count toward the 4.

Then check Seven Pairs and Thirteen Orphans separately.

### Gate: these tests must pass before you touch faan scoring
- Simple standard win (3 chows + 1 pung + pair).
- A hand that legitimately decomposes **two different ways** — assert both are returned.
- `1112345678999` in one suit — assert it decomposes (it's Nine Gates; multiple valid readings).
- Seven Pairs; and a hand with a four-of-a-kind that must NOT count as Seven Pairs under our rule.
- Thirteen Orphans complete → true; one tile away → false.
- Near-miss hands → false (e.g. 4 melds and no pair; 13 tiles with no pair candidate).
- A hand with 2 exposed melds + concealed remainder.
- Honours-only pung hand.
- A chow attempt spanning 9→1 must be rejected.

---

## 5. `engine/fan.ts` — the other hard part

```ts
score(decomposition, ctx: ScoringContext): { totalFaan: number; patterns: {name: string; faan: number}[] }
scoreBest(decompositions, ctx): ...   // picks the highest-scoring decomposition
```

`ScoringContext` carries seat wind, round wind, self-draw vs discard, flowers held, concealed status, last-tile conditions.

Put every faan value in a **config table** (`fanTable.ts`) so values are tweakable without touching logic. Implement at minimum:

All Chows (平和), All Pungs (對對糊), Mixed One Suit (混一色), Pure One Suit (清一色), All Honours (字一色), Small Dragons, Great Dragons, Small Winds, Great Winds, Seat Wind pung, Round Wind pung, Dragon pung (each), Self-draw (自摸), Seven Pairs, Thirteen Orphans, All Kongs, Nine Gates, flowers/seasons bonus (own flower vs any).

**Exclusivity and subsumption matter more than coverage.** Handle:
- Pure One Suit supersedes Mixed One Suit — never both.
- Great Dragons supersedes Small Dragons, and supersedes the individual dragon pungs it contains.
- Great Winds supersedes Small Winds.
- All Honours implies All Pungs — decide and document whether both score.
- Support an optional **faan cap** (limit hand) in config; off by default.

### Gate: tests before moving on
- Each pattern scored in isolation.
- Every exclusivity pair above, asserting the *loser* is absent from `patterns`.
- 2–3 combined hands with hand-checked expected totals.
- A hand with multiple decompositions where the naive-first decomposition scores lower than the best — assert `scoreBest` picks the higher.
- Faan minimum enforcement: a 1-faan hand under a 3-faan minimum cannot be declared; the same hand under 0-faan minimum can.

---

## 6. `engine/shanten.ts`

```ts
shanten(concealed: Tile[], melds: Meld[]): number   // 0 = tenpai (one tile from winning), -1 = won
usefulTiles(hand): Tile[]                            // tiles that would reduce shanten
```

Standard shape + Seven Pairs + Thirteen Orphans, take the minimum. This powers the intermediate/advanced bots **and** the tile-efficiency trainer in §9, so it needs to be right and reasonably fast.

Tests: known tenpai hands → 0; a winning hand → -1; hands at 1- and 2-shanten with hand-verified answers; a Seven Pairs draft where the pairs count beats the standard count.

---

## 7. `engine/bots.ts`

Pure functions. Signature shape:

```ts
type BotPolicy = (view: PlayerView, difficulty: Difficulty) => Action
```

`PlayerView` = what that seat can legally see: own hand, all discards, all exposed melds, seat/round winds, tiles remaining. **A bot must never receive another player's concealed hand or the wall order.** Enforce this at the type level if you can — it's the same boundary the Phase 2 server needs.

- **Easy** — discards by simple heuristic (isolated honours first, then isolated terminals, then isolated middles). Claims a win if available; otherwise rarely claims. Makes visible mistakes; that's intentional.
- **Intermediate** — discards to minimise shanten (ties broken by which discard keeps more useful tiles live). Claims pung/chow only when it reduces shanten. Light defence: won't discard a tile that was just claimed by someone.
- **Advanced** — intermediate, plus:
  - **Discard-pool reading**: tracks each opponent's discarded suits to infer what they're collecting (heavy discarding of one suit ⇒ likely not collecting it).
  - **Safety estimation**: a tile already discarded by an opponent is safe against that opponent; tiles adjacent to their discards are relatively safe.
  - **Push/fold**: when an opponent looks close (many exposed melds, few discards, late wall), switch from advancing own hand to discarding the safest tile.
  - Comment honestly that this is strong-heuristic play, not superhuman. Don't oversell it in the README.

Tests: every difficulty returns only **legal** actions across many random states; advanced folds when given an obviously-threatening board; each bot claims a win when one is available.

---

## 8. `engine/game.ts`

`GameState` + a reducer-style `applyAction(state, action): GameState`. Pure, serialisable, no timers, no React.

Cover: deal → draw → discard → claim resolution (with the priority in §2) → kong + replacement draw from the dead wall → bonus tile replacement → win declaration + scoring → round end → wall exhausted draw.

- **Seedable RNG** for the wall so games are reproducible in tests and replayable in lessons. Pass a seed in; log every action.
- Keep a full **action log** on the state. This gives replay and post-round analysis for free — don't skip it, §9 and §10 depend on it.
- Expose `legalActions(state, seat)` — the UI uses it to decide which buttons to show, and the bots use it to stay legal. One source of truth.

Tests: script whole rounds via action sequences with a fixed seed, no UI. Include a scripted round that ends in a claimed win, one in a self-draw, one in wall exhaustion, and one where two seats can claim the same discard (assert priority).

---

## 9. Lessons + drills (`src/lessons`)

Duolingo-style: short units, each a handful of interactive exercises with immediate feedback, unlocking the next unit on completion. Progress in React state (no storage).

**All validation must call the engine.** Never reimplement a rule inside a lesson — if a lesson needs to know whether a hand wins, it calls `isWinningHand`. This is a hard requirement; duplicated rules will drift.

Units, in order:
1. **Tiles & suits** — recognition drills, timed.
2. **Sets** — chow / pung / kong; tap tiles to build a valid one.
3. **The winning shape** — 4 sets + a pair; build one from a given hand.
4. **Special hands** — Seven Pairs, Thirteen Orphans.
5. **Faan basics & the minimum** — including the "your hand is complete but you can't declare it" moment, and a 0-faan-minimum variant since that's how my family plays.
6. **Reading discards** — see §9a.
7. **Defence** — safe vs dangerous tiles; when to fold.
8. **Guided half-game** — play with hints on.

### 9a. Two drill modes (these are the point of the app — build them properly)

- **Tile efficiency trainer.** Show a 13- or 14-tile hand. I pick a discard. Grade it against `shanten` + `usefulTiles`: was it optimal, acceptable, or bad — and *why*, showing what each candidate discard does to shanten and live tile count. Generate hands procedurally at a target shanten so it never runs out.
- **Discard-reading quiz.** Show a discard pool + exposed melds mid-game (generate by running a scripted game with a seed to turn N). Ask: which suit is South collecting? Which of these three tiles is safest to discard? Score and explain. This drill exists specifically because reading discards is my weakest area.

---

## 10. Anthropic API analysis (`src/analysis`) — build last, it's the easiest part

- Runtime API key input field. Memory only. Never written to disk, never logged, never committed.
- **"Analyse my hand"** — serialise the current `PlayerView` (my hand, all discards, exposed melds, winds, faan minimum, wall count) to compact text and ask for: (1) the closest realistic faan target, (2) the best discard and why, (3) one defensive note. Keep the response short and structured.
- **"Why did I lose that hand?"** — post-round, serialise the action log and ask for 3 concrete things I could have done differently. This is the highest-value feature in the app for me; give it a real prompt, not a generic one.
- Model: default `claude-fable-5`, fall back to `claude-opus-4-8` on error or `stop_reason: "refusal"`. Wrap everything in try/catch, show a clean error state, never crash the game. If you request structured output, strip ``` fences before parsing.
- Rate-limit the button (no spamming a request per tile hover).

---

## 11. UI (`src/ui`) — build after the engine is green

- Four seats around a table, wall counter, per-player discard pools laid out in rows, my hand sorted, exposed melds visible, faan/score breakdown on win (show *which* patterns fired and their values — it's a teaching tool).
- **Tiles**: use the Unicode mahjong block (U+1F000 🀇🀈🀉…) via a `Tile → glyph` map in `tiles.ts`, so there are zero image assets to host and we can swap to SVGs later without touching logic.
- **Numbered-tile toggle**: overlay the rank number on suit tiles. Beginners (me) read hands much faster this way. Default on.
- **Beginner aids toggle**: highlight the suggested discard (green = keep / safe, orange = consider discarding), with a hover/tap explanation. Powered by `shanten`, not by the API.
- **Settings panel**: faan minimum (0/1/3), flowers on/off, bot difficulty per seat, numbered tiles, beginner aids.
- Follow the frontend-design skill: intentional typography and layout, not a template default. Green felt is fine but make it considered — good tile contrast, readable at a glance, works on desktop and phone.

---

## 12. Phase order — enforce this

Do not start a phase until the previous phase's tests are green and committed.

1. Scaffold, `types.ts`, `tiles.ts`, `wall.ts`, seedable RNG. Tests. **Commit.**
2. **`win.ts`** — gate at §4. **Commit.**
3. **`fan.ts`** — gate at §5. **Commit.**
4. **`shanten.ts`** — gate at §6. **Commit.**
5. `game.ts` + claim priority. Tests. **Commit.**
6. `bots.ts` easy → intermediate → advanced. Tests. **Commit.**
7. UI. Playable end-to-end. **Commit.**
8. Lessons + both drills (§9a). **Commit.**
9. Analysis (§10). **Commit.**
10. README, full test pass, cleanup. **Commit.**

After each phase: show me a short summary of what changed and the passing test output before continuing. If a rule is ambiguous, **state your assumption in a code comment and keep going** — don't stall waiting for me.

Correctness and clear structure over cleverness. If you find yourself writing a clever one-liner in `win.ts`, write the boring version instead.

---

## 13. Phase 2 — multiplayer (DO NOT BUILD YET; design so it isn't blocked)

Specced here so Phase 1 doesn't paint us into a corner. Build only when I say so.

**Target:** 2–4 humans across devices, empty seats filled by bots (2+2, 3+1, 4+0), room-code lobby.

**Why the Phase 1 architecture matters:** the server will run the *exact same* `engine/` module as the authority. Clients become thin views. That only works if the engine stayed pure, `GameState` stayed serialisable, and `PlayerView` is a real boundary rather than a convention. All three are Phase 1 requirements above — keep them honest.

Anticipated shape:
- **Authoritative server.** The server holds the wall and all concealed hands, validates every action against `legalActions`, and pushes each client only its own `PlayerView`. Hidden information must never reach a client that shouldn't see it — otherwise the game is trivially cheatable by opening devtools.
- **Transport**: WebSockets, or a hosted realtime layer (Supabase Realtime / PartyKit / Firebase) to avoid running infrastructure.
- **Claim window**: the genuinely new problem. After a discard, open a ~3–5s window for claims, collect them, resolve by the §2 priority, then proceed. Handle simultaneous claims and a claimer who disconnects mid-window.
- **Disconnect/reconnect**: a bot takes over a dropped seat after a timeout; the human resumes on reconnect. State recovery from the action log.
- **Lobby**: room codes, seating, per-seat human/bot assignment, host settings (faan minimum etc.).

Rough scope: **as much work again as Phase 1.** That's why it's phase two.

---

## 14. Ground rules

- Tests are the correctness signal. This session may be running headless — if nobody can see the UI, the tests are the only thing that knows the game works. Weight them accordingly.
- Never commit secrets. `.gitignore` `.env*` from the first commit.
- No `localStorage`/`sessionStorage` anywhere.
- Prefer boring, readable code in `engine/`. Optimise later, and only with a benchmark.
- Every phase ends with a commit. If the session dies, I should be able to `git log` and know exactly where we are.
