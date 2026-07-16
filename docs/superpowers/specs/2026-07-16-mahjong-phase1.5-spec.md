# Build Spec — Phase 1.5: Key, Speed, Lessons, Design

> Paste into Claude Code on the `mahjong` repo. Phase 1 is built and working; this is a rework, not a rebuild.
>
> **Do not touch `src/engine/` behaviour.** It's tested and correct. You may *add* pure functions to it (§3.2, §4.3 need this). You may not change existing semantics. If an engine test goes red, you broke something — revert, don't "fix the test."
>
> Same rules as before: phase gates, commit after each, show me test output before moving on.

---

## 0. Correction to the Phase 1 spec — read this first

**I was wrong about `localStorage`.** I banned browser storage in the Phase 1 spec. That constraint came from a sandboxed-artifact environment and **does not apply to this app** — it's a real Vite app on real hosting. The ban is why the lessons page says progress dies on refresh, and it's the single biggest reason the lessons feel shallow: no persistence means no streaks, no spaced repetition, no mastery tracking across days. A Duolingo-style course that forgets you every refresh isn't a course, it's a quiz.

**The ban is lifted.** Use `localStorage` (or IndexedDB if the payload outgrows it) for lesson progress, mastery state, and settings. §4 depends on this.

Still banned: **the API key never touches client storage.** See §2.

---

## 1. Priorities

1. §2 — API key architecture (security; do this first, it's the only thing here that can cost me money)
2. §3 — analysis speed
3. §5 — design system + UI overhaul
4. §4 — lessons overhaul (biggest scope)

---

## 2. Serve my API key — via a proxy, never baked into the client

**What I want:** users (me, and anyone I show it to) shouldn't have to paste a key.

**What you must not do:** put my key in the client. Vite inlines every `VITE_*` env var into the bundle as plaintext. A key in the client is a key in devtools, and anyone who loads the page can extract it and spend my credits until I notice. `.env` in `.gitignore` does not help — the key is in the *built JavaScript*, not the repo.

**What to build instead:** a serverless proxy. The key lives server-side only.

### 2.1 The proxy

- `/api/coach` and `/api/review` as serverless functions (Vercel functions — I already deploy Prospect there; use the same pattern).
- Key read from `process.env.ANTHROPIC_API_KEY`, set in the hosting dashboard. Never in the repo, never in a `VITE_*` var, never logged. Add a CI/lint check or a simple grep in a pretest script that fails the build if `sk-ant-` appears anywhere in `src/` or `dist/`.
- **This must not be an open proxy to Claude.** It accepts *my* request shapes only:
  - Validate the body against a strict schema (a serialised `PlayerView` / action log — reject anything else).
  - The system prompt is **constructed server-side**. The client sends game state, never prompt text. No client-supplied `system`, `model`, `messages`, or `max_tokens`.
  - Hard-cap `max_tokens` server-side.
  - Rate limit per IP (something like 20/min, 200/day) and return 429 cleanly. Use the hosting platform's KV/Redis offering or an in-memory limiter if the function runtime allows it.
  - Reject requests without a same-origin `Origin` header.
- Client shows a friendly "coach is rate-limited, try again in a moment" state on 429. Never crash the game.

### 2.2 Keep BYO key as an option

Don't delete the existing path — demote it. Settings gets an "Use my own API key" field. If set, the client sends it to the proxy as a header and the proxy uses it **instead of mine** and skips the rate limit. In-memory only, never persisted, never logged. This is the escape hatch for when I hit my own limits, and it means the app still works for anyone else without costing me anything.

### 2.3 Local dev

`.env.local` with `ANTHROPIC_API_KEY=` (no `VITE_` prefix — that's the point) and run the functions locally via the platform CLI. Document this in the README. Add `.env*` to `.gitignore` if it somehow isn't already.

---

## 3. Make analysis fast — and *more* accurate at the same time

The coach is slow because it's doing the wrong job. Right now we hand the model a pile of tiles and ask it to reason out shanten, useful tiles, and safety from scratch — slow, token-heavy, and it can get the arithmetic wrong. **We already compute all of that exactly, in the engine.**

### 3.1 The core change: the engine computes, the model explains

Don't ask the LLM to calculate anything the engine knows. Compute first, then hand the model *facts* and ask for prose.

Currently the prompt is roughly "here's my hand, what should I discard?" It becomes:

```
Hand: 7m 8m 8m 3p 5p 1s(bird) 2s 4s 6s E S N R  (+ drawn: G)
Shanten: 3
Discard options, ranked by the engine:
  N  -> shanten 3, 24 live tiles advance, safe vs South (in their discards)
  G  -> shanten 3, 24 live tiles advance, DANGEROUS vs South (2 melds exposed, no G discarded)
  3p -> shanten 4, ...
Round: E. Seat: E. Faan minimum: 0. Wall: 61.
South has 2 exposed melds and has discarded 6 bamboo -> likely collecting circles/characters.

Explain in <=60 words: the best discard and why, plus one defensive note.
Do not recompute the numbers. Use the ones given.
```

That's faster (fewer output tokens, no reasoning-from-scratch), cheaper, and **strictly more accurate**, because the numbers are now coming from tested code instead of a language model doing combinatorics in its head. The model is a narrator, not a calculator.

### 3.2 Engine additions needed

Add to `engine/` (pure, tested, additive only):
- `rankDiscards(view): DiscardEval[]` — for every tile in hand: resulting shanten, ukeire (count of live tiles that advance the hand, accounting for tiles visible in discards/melds), and a safety score per opponent.
- `readOpponents(view): OpponentRead[]` — per seat: inferred suits being collected, threat level (exposed melds, discard count, wall position), tiles known-safe against them.

These are the same primitives §4's drills need, so build them properly. Test them.

### 3.3 Model routing

| Feature | Model | Why |
|---|---|---|
| In-game coach ("best discard") | `claude-haiku-4-5-20251001` | Interactive; must feel instant. With §3.1 it's just explaining given facts — Haiku is plenty. |
| Post-round review ("why did I lose") | `claude-sonnet-5` | Latency doesn't matter, I've stopped playing. Quality does. |
| Lesson explanation generation | `claude-sonnet-5`, offline | See §4.5 — generate at build time, not runtime. |

Fall back Haiku → Sonnet on error or `stop_reason: "refusal"`. Drop `claude-fable-5` from runtime entirely — it's a build-time tool, not a per-request one, and I may not have access to it after the 19th.

### 3.4 Make it *feel* instant

- **Stream the response.** Tokens appear as they arrive. This alone changes the perceived speed more than the model swap does.
- **Prefetch.** The instant it becomes my turn, fire the coach request in the background. By the time I've looked at my hand and tapped the button, it's already there. Cancel on discard.
- **Show engine output immediately, model prose when it lands.** The ranked discard table from `rankDiscards` is local and instant — render it right away with the top pick highlighted. The LLM's explanation streams in underneath. The useful information is on screen in ~0ms; the prose is a bonus, not a blocker. **This is the most important item in §3.**
- **Cache** by hashed game-state key. Same position, same answer, no request.
- Debounce the button; one in-flight request at a time.

---

## 4. Lessons overhaul

Current state: 8 units, a few hand-written items each, wrong answers retry freely, progress dies on refresh. It's a quiz that a person finishes once. I want something I'd actually grind for two weeks before seeing my girlfriend's parents.

### 4.1 The three structural problems to fix

1. **Finite hand-authored content.** ~30 items total means you memorise the items, not the game. → **Generate every item procedurally from the engine.** Infinite, and it's the real game's logic, not a paraphrase of it.
2. **Retry-until-right.** Guessing costs nothing, so nothing is learned. → **One answer per presentation.** Answer, see the full explanation, item goes back in the queue and returns later in the session. You don't get to brute-force it.
3. **Completion, not mastery.** A ✓ on "Tiles & suits" means I clicked through once. → **Per-concept mastery with decay** (§4.2). The course is never "done"; it tells me what's rusty.

### 4.2 Mastery + scheduling

- Define **concepts** (~20), finer-grained than units: `tile.recognition.bamboo`, `set.chow`, `shape.seven-pairs`, `faan.mixed-one-suit`, `faan.exclusivity`, `defence.safe-tiles`, `read.suit-inference`, `efficiency.ukeire`, etc. Every generated item is tagged with the concepts it exercises.
- Per concept: a **mastery score** (0–1) updated on each answer, weighted by item difficulty and response time. Correct-but-slow ≠ correct-and-instant, especially for recognition drills.
- **Spaced repetition** — Leitner boxes or SM-2-lite, whichever you can implement cleanly and test. Concepts decay over time; the scheduler surfaces the ones due.
- A **session** = ~12–15 items: a few new, the rest due-for-review, weighted toward my weakest concepts. Not "unit 3, questions 1–5."
- **Unlocking** by mastery threshold on prerequisite concepts, not by completion. Keep the unit list as a *map* of the terrain, but let the scheduler drive what I actually see.
- Persist all of it to `localStorage` under one versioned key with a migration path. Add an **export/import progress as JSON** button so it survives a cleared cache.
- Streak counter, daily goal, XP. Yes, it's a Skinner box. That's the point.

### 4.3 Item generators (all engine-driven)

Every generator: takes a difficulty parameter, emits a seeded, reproducible item, and **validates the answer by calling the engine**. Never hardcode a rule inside a lesson — if a lesson needs to know whether something wins, it calls `isWinningHand`.

- **Recognition** — tile flashes, name it (or inverse). Timed. Difficulty = exposure duration + confusable distractors (2s vs 3s bamboo, 東 vs 南).
- **Set spotting** — from N tiles, tap a valid chow/pung. Difficulty = decoys that *almost* work (9-1-2 wraps, mixed-suit runs).
- **Is this a winning hand?** — generate hands at shanten 0 and shanten 1; yes/no. Near-misses only, so pattern-matching fails and you have to actually decompose.
- **Decompose it** — given a winning hand, tap out the four sets and the pair. Use hands with **multiple valid decompositions** and accept any of them (`decompose` returns them all — this is why it returns all of them). Excellent for the intuition I'm missing.
- **Faan counting** — given a winning hand + context, pick the total. Distractors generated from the *specific* mistakes the scoring rules invite: double-counting Mixed + Pure One Suit, missing seat wind, counting Small Dragons under Great Dragons. Difficulty = number of interacting patterns.
- **Can I declare?** — a complete hand under a faan minimum. Yes/no + why. Generate at 0/1/3 minimums. **Include the 0-minimum case prominently** — that's how my family plays, and every other app assumes 3.
- **Best discard** — see §4.4.
- **Who's collecting what?** — see §4.4.
- **Safe tile** — mid-game position, one opponent visibly threatening, pick the safest discard from three. Graded against `readOpponents`.

Difficulty scales *within* a concept, so a concept never runs out of headroom.

### 4.4 The two trainers, upgraded

Both stay standalone **and** get pulled into the lesson scheduler as item types.

**Tile efficiency trainer**
- After I answer, show the **complete ranked discard table** from `rankDiscards`: every tile, resulting shanten, ukeire count, and *which specific tiles* would advance the hand. Seeing "discarding 3p leaves you waiting on 4 tiles; discarding N leaves you waiting on 24" is the entire lesson. Right now it just says right/wrong.
- Grade on a curve, not binary: optimal / within-2-ukeire / suboptimal / blunder.
- Difficulty tiers: shanten 1 (easy, obvious) → shanten 2–3 with competing shapes (hard) → shanten 2–3 *with* a safety consideration (expert: the efficient discard is dangerous).
- **Timed mode** with a decaying score — real games have tempo, and hesitation at the table is what'll give me away.
- Track my error *patterns* across sessions ("you over-value isolated honours", "you break up two-sided waits"). Compute this locally from the answer log — no LLM needed.

**Discard-reading quiz**
- Generate positions by running a **seeded real game** to turn N via `game.ts`. Real positions, not synthetic ones.
- **Progressive reveal**: show turn 6, ask for a read; show turn 12, ask again. Teaches that reads sharpen with evidence.
- Multiple question types off one position: which suit is South collecting / who's closest to winning / which of these three is safest / is North one tile away.
- **Confidence rating** on each answer (guess / fairly sure / certain) and grade calibration separately. Being confidently wrong is the actual dangerous failure mode at a real table.
- Explanation reveals `readOpponents` output alongside the ground truth from the seeded game — you see both the inference *and* what was actually in their hand. That reveal is the strongest teaching moment in the whole app; make it feel like one.

### 4.5 Explanations

Explanations must be **instant and offline** — an LLM call in the feedback loop kills the drill rhythm.

- Template the explanations from engine facts, filled at render time. `rankDiscards` output is already an explanation; it just needs prose scaffolding.
- Where you want richer prose, **generate it at build time**: a script that produces explanation text for each *concept and error class* (not each item — items are infinite), commits the output as JSON, and ships it static. Use Sonnet for that script. Zero runtime cost.
- Reserve the live LLM for the "explain this position to me" escape hatch — user-initiated, not automatic.

---

## 5. UI overhaul + design system

### 5.1 Use the skill

`ui-ux-pro-max` will be vendored into `.claude/skills/`. Use it. Generate and persist a design system before writing components:

```
python3 .claude/skills/ui-ux-pro-max/scripts/search.py "premium tactile board game, warm minimal, dark" \
  --design-system --persist -p "Mahjong play + learn" --variance 6 --motion 4 --density 4
```

That writes `design-system/MASTER.md`. Everything below is **art direction the generated system must respect** — where they conflict, this document wins. Then: tokens first, and after that no raw hex or px values anywhere in components. Ever.

Also generate page-level overrides for the two very different surfaces:
```
... --design-system --persist -p "Mahjong play + learn" --page "table"
... --design-system --persist -p "Mahjong play + learn" --page "lessons"
```

### 5.2 Fix the red dragon — root cause

You noticed right: one tile looks 3D and wrong. Here's why.

We render tiles as Unicode glyphs from the Mahjong Tiles block. **U+1F004 MAHJONG TILE RED DRAGON is the only tile in that block with `Emoji_Presentation=Yes`** — it's in the emoji set (it came from the Japanese carrier sets), so the system renders it as a full-colour emoji, while U+1F000–1F003 and U+1F005–1F02B render as flat monochrome text glyphs. One tile is drawn by the emoji font; the other 42 are drawn by a text font. Hence the mismatch.

The band-aid is appending U+FE0E (variation selector-15) to force text presentation. It's unreliable across platforms and I don't want it.

The real problem is bigger: **we're rendering game assets with whatever font the user's device happens to have.** That's why it looks different for you than for me, and it's a ceiling on the design — you cannot art-direct a system font. So:

### 5.3 Tiles become real components

Drop Unicode glyph rendering entirely. Keep the `Tile → renderer` map in `tiles.ts` — that indirection was put there in Phase 1 for exactly this swap, so no engine or game logic changes.

**Approach: procedural SVG components, with a self-hosted font for the CJK faces.**

- **Circles (筒) 1–9** — fully procedural. Canonical dot arrangements, drawn as SVG circles from a layout table. Traditional colouring (1筒 large and multi-ring; 2–4 with blue/green; 5筒 with a red centre; the 8筒 stack). Zero assets.
- **Bamboo (索) 2–9** — fully procedural. Stylised segmented sticks from a layout table, traditional green with red accents on 5索 and 7索.
- **1索** — the exception: traditionally a bird, not a stick. Draw a simple stylised sparrow as a hand-authored SVG, or use a Commons asset (see below). Don't let this one tile hold up the other 42 — ship a placeholder stick if you must and flag it in the README.
- **Characters (萬) 1–9, winds 東南西北, dragons 中發白** — SVG `<text>` using a **self-hosted, subsetted CJK font**. Noto Serif TC or similar with an open licence, subset to the ~20 glyphs we actually need (一二三四五六七八九萬東南西北中發白). That's a handful of KB and it renders identically on every device. **This is what actually fixes the red dragon** — 中 becomes text in a font we control, not an emoji.
- **White dragon (白)** — traditionally a blank tile or a blue frame. Pick the frame; the blank reads as a bug.
- **Flowers/seasons** — Commons assets or simple procedural motifs. Lowest priority, they're decorative.

**If you use Commons assets** (the "Unicode 1F000-1F02F Mahjong Tiles" category has a complete set matching the codepoints): check each file's licence individually — that category is a mix of PD-self, GPL, and CC-BY-SA-3.0, and share-alike has downstream implications if I ever license this differently. Record every file, author, and licence in `ATTRIBUTION.md`. Prefer procedural for anything you can draw, precisely to avoid this.

**Tile component API**: `<Tile tile={t} size="sm|md|lg" state="normal|dimmed|highlighted|danger|selected" showRank={bool} />`. One component, used by the table, the hand, the discard pool, the lessons, and the trainers. Rank overlay (§5.5) is a prop, not a separate component.

### 5.4 Art direction — the thing I actually want

The current UI's problem isn't ugliness, it's that it has no point of view. Flat green rectangles, a system-font sans, and a giant "61 tiles left" box that dominates the screen with the least interesting fact on it. It looks like a wireframe someone forgot to finish.

**The direction: a real table, photographed at night.** Mahjong is a *tactile* game — bone tiles, felt, weight, the clack. The screen should feel like an object, not a form.

- **The tiles are the hero. Everything else recedes.** They're the only thing that should be bright, warm, and high-contrast. Every other surface is a dim, desaturated backdrop. Right now the table competes with the tiles; it shouldn't.
- **Tile faces: warm ivory**, not white. Real tiles are bone/resin — slightly yellow, slightly uneven. A subtle vertical gradient (cooler top, warmer bottom, as if lit from above) plus a hairline warm border. The face should look like it has a surface.
- **Depth through light, not skeuomorphism.** No drop-shadow-and-gradient 3D. A tile is a flat plane with a 1–2px bevel highlight on the top edge, a soft contact shadow beneath, and a slightly cooler bottom edge. It should read as an object lit from above, at 2px of relief — not a button from 2009. This is the discipline that stops it looking like the red dragon emoji.
- **Felt: not flat.** A deep, desaturated green — closer to `#1f3b30` than the current bright forest — with a large soft radial light falling from above-centre, a strong vignette at the edges, and a fine SVG turbulence-filter grain at very low opacity for felt texture. Warm the light slightly (the room is lit by a hanging bulb, not a fluorescent panel).
- **The wall counter must stop shouting.** "61 tiles left" is the least important number on screen and it's currently the biggest element. Make it a thin, quiet ring or bar at the table's centre that fills as the wall depletes — glanceable, unobtrusive, and creates real tension as it empties. The number can be small inside it.
- **Discards laid out like a real table**: 6 per row, in front of each seat, oriented to that seat, in draw order. Not a shapeless cluster. This is functional, not decorative — it's *how you learn to read discards*, and the current layout actively prevents the skill I'm trying to build. The most recent discard gets a soft ring for one beat, then settles.
- **Typography with a point of view.** A humanist serif for headings and numerals — the game is a century old, lean into it — paired with a clean grotesk for UI chrome and body. Numerals tabular everywhere they change (scores, wall count, timers) so nothing jitters. Two families maximum. Do not ship the default sans stack.
- **Colour discipline**: felt greens + ivory tiles + exactly one accent. The current yellow is fine — keep it, and use it for *one* thing only (whose turn it is). Semantic colour is reserved for meaning: green = safe/keep, amber = consider, red = dangerous. If the accent and the safety colours are both firing, the safety colours lose their meaning.
- **Motion has weight.** A discarded tile slides and *settles* — 180–240ms, a decelerating ease, a tiny overshoot on landing, then still. Nothing bounces, nothing springs, nothing pulses forever. Bot "thinking" is a subtle seat-glow, not a text label reading "West Bot is thinking…". Respect `prefers-reduced-motion`.
- **Kill the labels doing a UI's job.** "West Bot · W" as literal text in a box is placeholder energy. The seat *is* the label: position it, mark it with the wind character, glow it on turn.
- **The AI coach isn't a generic pill button at the bottom.** It's a panel that slides from the edge, showing the ranked discard table instantly (local) with the prose streaming in below (§3.4). It should feel like a person leaning over your shoulder mid-game, not a form submission.

### 5.5 Specific UI requirements

- **Rank overlay toggle** (currently "numbered tiles") — keep it, default on, but restyle: a small numeral in the tile's top-left corner in the accent-neutral tone, not stamped over the face. I read hands faster with it; it shouldn't cost the design anything.
- **Beginner aids** — highlight suggested discards using `rankDiscards`, tinted by the semantic scale. Tap/hover shows the *why* (shanten delta + ukeire count) inline. Local, instant, no LLM.
- **Responsive**: the table must work on my phone. Portrait-first for the hand and discards; the four-seat layout compresses to a vertical stack under ~600px. Touch targets ≥44px. I will use this on the bus.
- **Lessons surface is a different world from the table.** The felt belongs to the game; the course should be calmer and lighter-weight — more air, more structure, less atmosphere. Same tokens, different density. Don't just paint the lesson list on green felt and call it done (which is what it is now).
- **Session summary screen** after each lesson session: which concepts moved, what's due next, streak. This is the retention hook — give it real design attention, not a modal with a list.
- **Accessibility**: real contrast ratios on the semantic colours (they carry meaning, they can't be decorative), keyboard navigation on the table, ARIA labels on tiles reading the actual tile name. Never encode safe/dangerous in colour alone — pair it with the icon or the ranking, or it's useless to a colourblind player.

### 5.6 Design gate

Before building components: show me the generated `design-system/MASTER.md` and a single static "tile gallery" page rendering all 42 faces at three sizes and every state. **If the tiles don't look right in the gallery, nothing built on top of them will.** I'll look at it on desktop and tell you before you go further. That's the gate.

---

## 6. Skills to vendor

Same treatment as Superpowers — clone into `.claude/skills/`, commit, restart the session:

- **`ui-ux-pro-max`** (`nextlevelbuilder/ui-ux-pro-max-skill`) — design system generation, palettes, font pairings, UX rule checks, React/Tailwind stack guidance. Note its scripts need Python 3. Worth it for §5.
- **`frontend-design`** — already available to you; it's the taste layer against generic AI aesthetics. Use both; they don't conflict.
- **Superpowers** — already vendored. Its TDD discipline still applies to every engine addition in §3.2 and §4.3.

Skip skill-routers/finders — with three focused skills there's nothing to route.

---

## 7. Phase order

| # | Work | Gate |
|---|---|---|
| 1 | §2 proxy + key hygiene + `sk-ant-` build check | Coach works with no key in the client. Verify the built bundle contains no key. |
| 2 | §3.2 engine additions (`rankDiscards`, `readOpponents`) | Tests green. Engine tests still green. |
| 3 | §3.1/3.3/3.4 rewire + stream + prefetch + instant local table | Coach feels instant. |
| 4 | §5.1 design system + §5.3 tile components + gallery | **§5.6 — I look at the gallery before you continue.** |
| 5 | §5.4/5.5 table + UI overhaul | Playable, responsive, looks like the direction. |
| 6 | §4.2 mastery + scheduler + persistence | Tests green (schedulers are very testable — test them). |
| 7 | §4.3 generators | Every generator validates via the engine. Tests. |
| 8 | §4.4 trainer upgrades | |
| 9 | §4.5 explanation templates + build-time generation script | |
| 10 | README, ATTRIBUTION.md, full test pass | |

Commit each. If something in here is ambiguous or wrong about HK rules, state the assumption in a comment and keep going — don't stall.

**Grep your own assumption comments from Phase 1 before you start** and surface them to me as a list. Some of them are probably wrong about how my family actually plays, and that's a five-minute conversation that could save a rebuild.
