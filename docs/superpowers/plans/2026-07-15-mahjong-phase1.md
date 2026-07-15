# Hong Kong Mahjong Play + Learn — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A client-only React app where a beginner plays HK mahjong against three bots and learns via lessons, two drill modes, and optional Anthropic-powered analysis.

**Architecture:** Pure TypeScript engine (`src/engine`, zero React imports, reducer-style `GameState`) consumed by a React UI, a lesson/drill layer that validates only through engine calls, and a fetch-based Anthropic wrapper. Hidden information is enforced by the `PlayerView` type.

**Tech Stack:** Vite, React 18+, TypeScript (strict), Tailwind v4 (`@tailwindcss/vite`), Vitest. No other runtime deps.

## Global Constraints

- No `localStorage`/`sessionStorage` anywhere; progress lives in React state.
- No backend; no API keys on disk or in the repo; `.gitignore` covers `.env*` from the first commit.
- Engine never imports React; engine files import only other engine files.
- `GameState` fully serialisable (plain data, no functions/classes/Dates).
- Faan minimum config 0/1/3, default **3**; 0 fully supported.
- Every faan value lives in `fanTable.ts`, not in logic.
- Tiles render from the Unicode mahjong block via a glyph map in `tiles.ts`.
- Bots receive `PlayerView` only — never other hands or wall order.
- Commit at the end of every task; do not start task N+1 with task N's tests red.
- Tile notation used everywhere (tests, serialisation, docs): `m1..m9` characters 萬,
  `p1..p9` circles 筒, `s1..s9` bamboo 索, `wE wS wW wN` winds, `dR dG dW` dragons
  (red 中, green 發, white 白), `bf1..bf4` flowers, `bs1..bs4` seasons.
  `hand("m1 m2 m3")` parses a space-separated list.

---

### Task 1: Scaffold + tiles + seedable RNG + wall

**Files:**
- Create: `package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`, `.gitignore`,
  `src/main.tsx`, `src/App.tsx`, `src/index.css`
- Create: `src/engine/types.ts`, `src/engine/tiles.ts`, `src/engine/rng.ts`, `src/engine/wall.ts`
- Test: `src/engine/__tests__/tiles.test.ts`, `src/engine/__tests__/wall.test.ts`

**Interfaces (produced):**
```ts
// types.ts
export type Suit = 'm' | 'p' | 's';
export type Wind = 'E' | 'S' | 'W' | 'N';
export type Dragon = 'R' | 'G' | 'W';
export type TileId = string;               // canonical ids per Global Constraints
export type Seat = 0 | 1 | 2 | 3;          // seat 0 deals first round
export type MeldType = 'chow' | 'pung' | 'kong';
export type KongStyle = 'concealed' | 'exposed' | 'added';
export interface Meld { type: MeldType; tiles: TileId[]; concealed: boolean; kongStyle?: KongStyle; claimedFrom?: Seat }

// tiles.ts
export const t: (id: string) => TileId;                    // validate + canonicalise
export const hand: (s: string) => TileId[];                // "m1 m2 wE" -> ids, sorted
export const sortTiles: (ts: TileId[]) => TileId[];        // suit m<p<s<winds<dragons, rank asc
export const isSuit/isHonour/isBonus/isTerminal: (t: TileId) => boolean;
export const suitOf: (t: TileId) => Suit | null;
export const rankOf: (t: TileId) => number | null;
export const glyph: (t: TileId) => string;                 // U+1F000 block
export const tileName: (t: TileId) => string;              // "3 Circles", "Red Dragon"

// rng.ts
export interface Rng { next(): number }                    // [0,1)
export const makeRng: (seed: string) => Rng;               // mulberry32 + string hash

// wall.ts
export const buildWall: (opts: { flowers: boolean }, rng: Rng) => TileId[];  // shuffled
export const WALL_SIZE = 144; // 136 when flowers off; dead wall = last 14
```

- [x] Step 1: Write `package.json` by hand (no interactive scaffold: repo is non-empty). Deps: react, react-dom; dev: typescript, vite, @vitejs/plugin-react, vitest, tailwindcss, @tailwindcss/vite, @types/react, @types/react-dom. Scripts: `dev`, `build` (tsc -b && vite build), `test` (vitest run), `test:watch`.
- [x] Step 2: `npm install`; write `vite.config.ts` (react + tailwindcss plugins, vitest config `environment: 'node'` for engine tests), strict `tsconfig.json`, `index.html`, minimal `App.tsx` placeholder, `src/index.css` with `@import "tailwindcss";`. `.gitignore`: node_modules, dist, `.env*`.
- [x] Step 3: Failing tests — tiles: 144-tile composition by category (108 suits, 16 winds, 12 dragons, 8 bonus); `hand()` round-trips and sorts; glyph map covers all 42 distinct tiles and `glyph('m1') === '🀇'`; parse rejects `m0`, `x5`. wall: same seed ⇒ identical wall, different seed ⇒ different; flowers:false ⇒ 136 tiles with no bonus tiles; shuffle is a permutation of the multiset.
- [x] Step 4: Implement; run `npm test` until green.
- [x] Step 5: Commit `feat: scaffold + tile model, seedable RNG, wall`.

### Task 2: `win.ts` — decomposition + win detection (spec §4 gate)

**Files:**
- Create: `src/engine/win.ts`
- Test: `src/engine/__tests__/win.test.ts`

**Interfaces (produced):**
```ts
export interface DecompSet { type: 'chow' | 'pung' | 'kong'; tiles: TileId[]; concealed: boolean; fromMeld: boolean }
export type Decomposition =
  | { shape: 'standard'; sets: DecompSet[]; pair: [TileId, TileId] }
  | { shape: 'sevenPairs'; pairs: [TileId, TileId][] }
  | { shape: 'thirteenOrphans'; duplicated: TileId };
export const decompose: (concealed: TileId[], melds: Meld[]) => Decomposition[];   // ALL of them
export const isWinningHand: (concealed: TileId[], melds: Meld[]) => boolean;
```

Algorithm: histogram over concealed; for every tile with count ≥ 2, remove pair, then recursively strip the lowest remaining tile as pung AND as chow (both branches, honours never chow, no 9→1 wrap); success at zero remainder. Exposed melds are fixed sets. Seven Pairs: exactly 7 **distinct** pairs, melds must be empty (comment the four-of-a-kind ≠ 2 pairs rule). Thirteen Orphans: melds empty, the 13 orphan kinds each present, exactly one duplicated. Dedupe identical decompositions (e.g. two orders of the same chows).

- [x] Step 1: Failing gate tests (exact hands, hand-verified):
  - `m1 m2 m3 p4 p5 p6 s7 s8 s9 wE wE wE dR dR` → wins, 1 standard decomposition.
  - `m1 m1 m1 m2 m2 m2 m3 m3 m3 s5 s5 s5 wE wE` → **2** decompositions (3 pungs | 3 identical chows).
  - `m1 m1 m1 m2 m3 m4 m5 m6 m7 m8 m9 m9 m9` + `m2`, and + `m5` → each decomposes (Nine Gates waits).
  - Seven Pairs `m1 m1 m3 m3 m5 m5 s2 s2 s4 s4 p6 p6 wE wE` → wins; `m1 m1 m1 m1 m3 m3 s2 s2 s4 s4 p6 p6 wE wE` → does NOT win.
  - 13 Orphans complete (dup m1) → wins; wN→m5 swap → false.
  - `m1 m2 m3 m4 m5 m6 s1 s2 s3 p1 p2 p3 wE wS` (4 melds, no pair) → false.
  - 2 exposed melds (chow m1m2m3, pung wE) + concealed `s4 s5 s6 p7 p7 p7 dR dR` → wins.
  - Honours-only `wE wE wE wS wS wS wW wW wW dR dR dR dG dG` → wins.
  - `m1 m8 m9 s2 s2 s2 s5 s5 s5 p3 p3 p3 wE wE` → false (9→1 wrap rejected).
- [x] Step 2: Run, verify all fail. Step 3: Implement. Step 4: Green. Step 5: Commit `feat: hand decomposition and win detection`.

### Task 3: `fan.ts` + `fanTable.ts` (spec §5 gate)

**Files:**
- Create: `src/engine/fanTable.ts`, `src/engine/fan.ts`
- Test: `src/engine/__tests__/fan.test.ts`

**Interfaces (produced):**
```ts
// fanTable.ts — every value tweakable; faanCap: number | null (default null)
export interface FanTable { allChows: 1; allPungs: 3; mixedOneSuit: 3; pureOneSuit: 7; allHonours: 10;
  smallDragons: 4; greatDragons: 8; smallWinds: 6; greatWinds: 13; seatWindPung: 1; roundWindPung: 1;
  dragonPung: 1; selfDraw: 1; sevenPairs: 4; thirteenOrphans: 13; allKongs: 13; nineGates: 13;
  ownFlower: 1; flowerSetBonus: 2; lastWallTile: 1; kongReplacementWin: 1; faanCap: number | null }
export const defaultFanTable: FanTable;

// fan.ts
export interface ScoringContext { seatWind: Wind; roundWind: Wind; selfDraw: boolean;
  flowers: TileId[]; fullyConcealed: boolean; lastWallTile: boolean; kongReplacement: boolean;
  table?: FanTable }
export interface FanResult { totalFaan: number; patterns: { name: string; faan: number }[] }
export const score: (d: Decomposition, ctx: ScoringContext) => FanResult;
export const scoreBest: (ds: Decomposition[], ctx: ScoringContext) => FanResult;  // highest total
export const winDeclarable: (totalFaan: number, minimum: number) => boolean;      // total >= minimum
```

Subsumption (documented in code): Pure One Suit ⊃ Mixed; Great Dragons ⊃ Small Dragons ⊃ their dragon pungs; Great Winds ⊃ Small Winds ⊃ their seat/round wind pungs; **All Honours ⊃ All Pungs** (decision in design doc); All Kongs ⊃ All Pungs; Nine Gates ⊃ Pure One Suit. Nine Gates requires fully concealed, one suit, 1112345678999 + any duplicate. All Chows = 4 chows + non-honour pair. Own flower = index matches seat wind (E=1,S=2,W=3,N=4); full set of 4 flowers or 4 seasons adds `flowerSetBonus`. `faanCap` clamps the total when non-null.

- [x] Step 1: Failing tests — isolation per pattern (hands in test file, each asserting exact `patterns` array), plus:
  - Pure+AllPungs `m1×3 m3×3 m5×3 m7×3 m9 m9` → 7+3=10, no Mixed.
  - Mixed+seat/round E+self-draw (`m2m3m4 m6m7m8 wE×3 m5×3 dRdR`, seat E round E) → 3+1+1+1=6.
  - Great Dragons hand → exactly `[greatDragons 8]`; Small Dragons hand → exactly `[smallDragons 4]`.
  - Great Winds `wE×3 wS×3 wW×3 wN×3 m5m5` → greatWinds 13 + allPungs 3 = 16 (winds subsumed, All Pungs deliberately not — documented).
  - Multi-decomp: `m1×3 m2×3 m3×3 m7m8m9 m5m5` → pung-reading 7, chow-reading 8; `scoreBest` = 8.
  - `winDeclarable(1,3)` false, `winDeclarable(1,0)` true, `winDeclarable(0,0)` true.
- [x] Steps 2–4: fail → implement → green. Step 5: Commit `feat: faan scoring with config table and subsumption`.

### Task 4: `shanten.ts` (spec §6 gate)

**Files:**
- Create: `src/engine/shanten.ts`
- Test: `src/engine/__tests__/shanten.test.ts`

**Interfaces (produced):**
```ts
export const shanten: (concealed: TileId[], melds: Meld[]) => number;  // -1 won, 0 tenpai
export const usefulTiles: (concealed: TileId[], melds: Meld[]) => TileId[]; // draws that lower shanten
```

Standard shape: recursive search over histogram counting {sets, partials, pair} with memoisation on (histogram key), shanten = 8 − 2·sets − partials − pairFlag, blocks capped at 4+melds… implemented as exhaustive block extraction taking the best, honours pair/pung only. Seven Pairs: 6 − distinctPairs (+ adjust for insufficient kinds). Thirteen Orphans: 13 − orphanKinds − (hasOrphanPair ? 1 : 0). Result = min of the three (special shapes only when melds empty). `usefulTiles`: for each of the 34 kinds, does adding it reduce shanten.

- [x] Step 1: Failing tests (hand-verified): win → −1; `m1m2m3 p4p5p6 s7s8s9 wE×3 dR` → 0; `m1m2m3 p4p5p6 s7s8 wE×3 dR dG` → 1; `m1m2m3 p4p5p6 s7s8 wEwE dR dG p9` → 2; six-pairs hand `m1m1 m3m3 m5m5 s2s2 s4s4 p6p6 wE` → 0 via Seven Pairs (standard reading is 3); 13-orphans 12 kinds + pair → 1. `usefulTiles` on the tenpai hand returns exactly `[dR]`.
- [x] Steps 2–4: fail → implement → green (memoise; all tests < 2s). Step 5: Commit `feat: shanten and useful-tile calculation`.

### Task 5: `game.ts` — reducer, claims, action log (spec §8)

**Files:**
- Create: `src/engine/game.ts`
- Test: `src/engine/__tests__/game.test.ts`

**Interfaces (produced):**
```ts
export interface RuleConfig { faanMinimum: 0|1|3; flowers: boolean; faanCap: number | null }
export type Action =
  | { type: 'draw'; seat: Seat }
  | { type: 'discard'; seat: Seat; tile: TileId }
  | { type: 'declareWin'; seat: Seat }                       // self-draw or claim-win
  | { type: 'claim'; seat: Seat; claim: 'win' | 'pung' | 'kong' | { chow: [TileId, TileId] } }
  | { type: 'pass'; seat: Seat }
  | { type: 'kong'; seat: Seat; tile: TileId; style: 'concealed' | 'added' };
export interface RoundResult { kind: 'win' | 'draw'; winner?: Seat; loser?: Seat; selfDraw?: boolean; fan?: FanResult }
export interface GameState { config; seed; wall; deadWallCount: number; hands; melds; bonus; discards;
  turn: Seat; phase: 'draw' | 'discard' | 'claims' | 'finished';
  pendingDiscard: { tile: TileId; from: Seat } | null; claims: Partial<Record<Seat, ...>>;
  roundWind: Wind; seatWinds: Record<Seat, Wind>; log: Action[]; result: RoundResult | null }
export const createGame: (config: RuleConfig, seed: string, dealer?: Seat) => GameState; // deals, replaces bonus tiles, dealer has 14, phase 'discard'
export const createGameWithWall: (config: RuleConfig, wall: TileId[], dealer?: Seat) => GameState; // rigged walls for tests/drills
export const applyAction: (s: GameState, a: Action) => GameState;   // pure; throws on illegal
export const legalActions: (s: GameState, seat: Seat) => Action[];  // single source of truth
export const playerView: (s: GameState, seat: Seat) => PlayerView;  // hides others' hands, wall order; others' concealed kong tiles hidden
export interface PlayerView { seat; seatWind; roundWind; concealed; melds /*all seats, sanitised*/;
  discards /*all seats*/; bonus /*all seats*/; wallCount: number; faanMinimum: number;
  turn: Seat; phase; pendingDiscard; legal: Action[] }
```

Rules encoded: bonus tiles auto-replace on deal and on every draw (from dead wall end); kong ⇒ replacement from dead wall; discard opens `claims` phase listing eligible seats (win/pung/kong any seat, chow only `(from+1)%4`); resolution priority win > pung/kong > chow, multiple winners → seat order from discarder; all-pass ⇒ next seat draws; live wall empty at draw time ⇒ `result {kind:'draw'}`. `declareWin` legal only when `isWinningHand` and `winDeclarable(scoreBest(...), faanMinimum)` — the "complete but below minimum" case is thereby unclaimable. Every applied action appends to `log`.

- [x] Step 1: Failing tests, all via `createGameWithWall` (deterministic, no seed-hunting): full scripted round to a claimed win; a self-draw win; wall exhaustion draw; double-win claim resolved by seat order from discarder; chow claim restricted to next seat; kong replacement draw; bonus tile auto-replacement at deal; faan-minimum 3 blocks a 1-faan `declareWin` while minimum 0 allows it; `playerView` never contains other seats' concealed tiles or the wall array; serialisability (`structuredClone`-equal via JSON round-trip); legality (`applyAction` throws on out-of-turn discard).
- [x] Steps 2–4: fail → implement → green. Step 5: Commit `feat: game state machine with claims, kongs, action log`.

### Task 6: `bots.ts` (spec §7)

**Files:**
- Create: `src/engine/bots.ts`
- Test: `src/engine/__tests__/bots.test.ts`

**Interfaces (produced):**
```ts
export type Difficulty = 'easy' | 'intermediate' | 'advanced';
export const botAction: (view: PlayerView, difficulty: Difficulty, rng: Rng) => Action; // picks only from view.legal
```

Easy: win if legal; else mostly pass claims; discard isolated honours → isolated terminals → isolated middles → rightmost. Intermediate: win; claim pung/chow only if it lowers shanten; discard = argmin shanten, ties by max useful-tile count; never discards the tile kind an opponent just claimed. Advanced: intermediate + suit-frequency read of each opponent's discards, safety score (discarded-by-target = safe, adjacent-rank = safer), threat model (exposed melds ≥ 2, few discards, wall < 30 ⇒ fold: discard safest instead of most efficient). Honest comment: strong heuristics, not superhuman.

- [x] Step 1: Failing tests — 200 random seeded states per difficulty: returned action ∈ `legalActions` (legality fuzz); every difficulty declares an available win; advanced with a rigged threatening board discards a 100%-safe tile (present in threatener's discards) over an efficient dangerous one; easy discards isolated honour first on a rigged hand.
- [x] Steps 2–4: fail → implement → green. Step 5: Commit `feat: three-tier bot policies over PlayerView`.

### Task 7: UI — playable end-to-end (spec §11)

**Files:**
- Create: `src/ui/GameScreen.tsx`, `src/ui/TableLayout.tsx`, `src/ui/TileView.tsx`, `src/ui/HandView.tsx`,
  `src/ui/DiscardPool.tsx`, `src/ui/MeldRow.tsx`, `src/ui/ActionBar.tsx`, `src/ui/WinDialog.tsx`,
  `src/ui/SettingsPanel.tsx`, `src/ui/useGame.ts`; Modify: `src/App.tsx` (tab shell: Play | Learn)
- Test: `src/engine/__tests__/` already covers logic; UI gets a smoke test only if time allows (headless session — engine tests are the signal, per spec §14)

Contracts: `useGame(config)` wraps `useReducer(applyAction)`, auto-plays bot seats via effect (bot think delay ~600ms), exposes `view` (human `playerView`), `dispatch`, `newRound` (dealer repeats on dealer win/draw; else rotate seatWinds, advance roundWind after full rotation — per design doc). `TileView` renders glyph + optional rank overlay (numbered toggle, default ON) + selected/suggested states. `ActionBar` renders buttons strictly from `view.legal` (claim window: Win/Pung/Kong/Chow/Pass). Beginner aids (toggle, default ON): per legal discard compute shanten delta + useful count, best = green ring, worst = orange, tooltip explains — engine-powered only. `WinDialog` lists `FanResult.patterns` name+value rows and total vs minimum. `SettingsPanel`: faan minimum 0/1/3 (default 3), flowers on/off, per-seat difficulty, numbered tiles, beginner aids; new settings apply on next round. Layout: CSS grid table — my hand bottom (sorted), opponents' discard rows per seat, wall counter + wind indicator centre; responsive ≥ 360px; felt-green board, high-contrast ivory tiles.

- [x] Steps: build components → `npm run build` clean → manual smoke via `npm run dev` (headless: verify a full bot-vs-bot round completes by scripting `useGame`'s reducer loop in a node test `src/engine/__tests__/fullgame.test.ts`: 3 bots + scripted human policy play 20 seeded rounds to completion without illegal actions — this is the e2e signal). Commit `feat: playable game UI`.

### Task 8: Lessons + drills (spec §9, §9a)

**Files:**
- Create: `src/lessons/types.ts`, `src/lessons/units.tsx` (8 units), `src/lessons/LessonScreen.tsx`,
  `src/lessons/ExerciseRunner.tsx`, `src/lessons/efficiencyTrainer.ts`, `src/lessons/discardReading.ts`,
  `src/lessons/TrainerScreen.tsx`, `src/lessons/QuizScreen.tsx`
- Test: `src/lessons/__tests__/drills.test.ts`

Contracts: unit list per spec §9 order; progression = React state in `App` (`completedUnits: Set<number>`, unit N+1 locked until N complete). Exercise types: `identify-tile` (timed), `build-set`, `build-winning-hand`, `pick-discard`, `multiple-choice` — every validation calls engine (`isWinningHand`, `decompose`, `shanten`, `score`). `efficiencyTrainer.ts`: `generateHand(targetShanten, rng)` (deal random 14 from a shuffled wall, reject-sample until `shanten === target`, ≤ 500 tries) and `gradeDiscard(hand, tile)` → `{ verdict: 'optimal' | 'acceptable' | 'bad', perDiscard: { tile, shantenAfter, usefulCount }[] }` (optimal = best shanten & within 80% of best useful-count; acceptable = best shanten; bad = worse shanten). `discardReading.ts`: `generatePosition(seed, turns)` runs a seeded bot game N turns → `{ view, questions }` with generated questions: "which suit is seat X short on?" (from discard suit frequencies) and "safest of these 3 tiles vs seat X?" (graded by bots' safety scorer — export it from bots.ts). Tests: generated hands hit target shanten; grading matches hand-computed example; reading quiz answers consistent with the safety function; unit gating logic.

- [x] Steps: failing drill tests → implement engine-side generators → green → build screens → full test pass → Commit `feat: lesson track and both drill modes`.

### Task 9: Anthropic analysis (spec §10)

**Files:**
- Create: `src/analysis/client.ts`, `src/analysis/prompts.ts`, `src/analysis/AnalysisPanel.tsx`, `src/analysis/serialise.ts`
- Test: `src/analysis/__tests__/serialise.test.ts` (pure parts only)

Contracts: `serialisePlayerView(view)` / `serialiseLog(log, result)` → compact text (tile notation from Global Constraints). `client.ts`: `analyse(key, prompt): Promise<{ok:true,text:string}|{ok:false,error:string}>` — fetch `https://api.anthropic.com/v1/messages`, headers `x-api-key`, `anthropic-version: 2023-06-01`, `anthropic-dangerous-direct-browser-access: true`; model `claude-fable-5`, on HTTP error / thrown fetch / `stop_reason === 'refusal'` retry once with `claude-opus-4-8`; strip ``` fences; never throws. 8-second min interval between calls (button disabled with countdown). Key: component state only, `type="password"`, never logged/persisted. `prompts.ts`: hand-analysis prompt (asks exactly: realistic faan target, best discard + why, one defensive note, ≤ 150 words) and post-round prompt (action log + result, asks for exactly 3 concrete improvements referencing specific turns). Panel: key field, two buttons, loading/error/result states; renders in Play tab; errors dismissible; never crashes the game (error boundary).

- [x] Steps: serialiser tests → implement → green → wire panel → build clean → Commit `feat: Anthropic hand analysis and post-round review`.

### Task 10: README + full pass + cleanup

- [x] README: what/why, quick start (`npm install`, `npm run dev`, `npm test`), engine API tour (each module, key functions, tile notation), architecture map incl. PlayerView boundary + Phase 2 note, lessons/drills overview, analysis setup (key handling), honest bot-strength note, assumptions list (Seven Pairs rule, All Honours ⊃ All Pungs, no point settlement, no robbing-the-kong).
- [x] `npm test` + `npm run build` full pass; remove dead code; final commit `docs: README and cleanup`; push branch.

## Self-Review

Spec coverage: §1 stack/constraints→T1; §2 rules→T1/T5; §3 shapes→T2; §4→T2; §5→T3; §6→T4; §7→T6; §8→T5; §9/§9a→T8; §10→T9; §11→T7; §12 order = task order; §13 protected by engine purity/PlayerView (T5/T6); §14 in Global Constraints. Placeholders: none — every gate test lists exact hands with hand-verified expectations. Type consistency: `TileId`/`Meld`/`Decomposition`/`FanResult`/`PlayerView`/`Action` defined once (T1/T2/T3/T5) and consumed by name elsewhere. Known intentional deviations from skill defaults: UI tasks specify component contracts rather than full JSX (executor holds the spec + design doc; engine correctness is test-gated).
