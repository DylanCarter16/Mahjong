# Page: table (the game surface)

> Overrides MASTER.md. Where MASTER and this file disagree, this file wins —
> it encodes the Phase 1.5 §5.4 art direction ("a real table, photographed at
> night"), which the spec declares authoritative over the generated system.
> Hand-authored from MASTER.md + spec §5.4/§5.5 (the generation script could
> not be re-run in this sandbox; see the design gate note in the session log).

## Point of view

Bone tiles on deep felt under a warm hanging bulb. The tiles are the hero —
the only bright, warm, high-contrast objects. Every other surface recedes.

## Colour

- Surface: `--color-felt` family only (`felt-light` at the lamp's centre,
  `felt-deep` at the vignetted edges). Never a flat fill; always the
  `felt-surface` gradient + grain.
- Tiles: `--color-ivory*` gradient faces, `--color-ivory-edge` hairline,
  bevel highlight top, cooler under-edge below. Depth = light at ~2px relief,
  never drop-shadow 3D.
- Accent `--color-accent` (gold) means exactly one thing: **whose turn it is**
  (seat glow, active hand ring). Nothing else may be gold.
- Semantic scale carries meaning only: `--color-safe` keep/safe,
  `--color-consider` consider discarding, `--color-danger` dangerous. Always
  paired with a non-colour signal (rank position, icon, or text) — never
  colour alone.
- Text on felt: `--color-parchment` / `--color-parchment-dim`. Contrast ≥ 4.5:1
  for meaningful text.

## Type

- `--font-serif` (Source Serif 4) for headings, seat wind characters and all
  numerals that matter (wall count, faan, scores) — `font-variant-numeric:
  tabular-nums` (`.tabular`) wherever a number can change.
- `--font-sans` (Inter) for UI chrome, buttons, tooltips, body.
- `--font-tiles` is exclusively for tile-face glyphs. Never for UI text.
- Two families max on screen (the tile face font is part of the tile asset,
  not the type system).

## Layout

- Discards: rows of 6 per seat, in front of that seat, in draw order,
  oriented toward the seat (rotated per side). The pool is how you learn to
  read — it is functional, never a shapeless cluster.
- The wall counter is a thin quiet ring at the table centre that depletes;
  small tabular numeral inside. It must never be the loudest element.
- Seats are positions, not labelled boxes: wind character + dealer marker at
  the seat, gold glow when it is that seat's turn. No "West Bot is
  thinking…" text labels.
- Portrait-first under 600px: my hand and discards stay primary; opponent
  seats compress to slim strips. Touch targets ≥ 44px.

## Motion

- A discarded tile slides from the hand to the pool and settles:
  `--duration-settle` with `--ease-settle`, tiny overshoot, then stillness.
- The newest discard carries a soft ring for one beat (~900ms), then rests.
- Bot thinking = subtle seat glow pulse (opacity, not scale). Nothing loops
  forever; nothing bounces.
- Respect `prefers-reduced-motion` (global rule in theme.css).

## Components on this page

- `<TileView>` (SVG faces, states: normal / dimmed / highlighted / safe /
  danger / selected; optional rank overlay top-left, small, neutral tone).
- Coach panel slides in from the edge; engine table renders instantly, prose
  streams under it.
- Icons are inline SVG strokes (no emoji as icons).

## Forbidden here

Flat bright greens; boxes that compete with tiles; gold for anything except
turn; skeuomorphic bevels/gradients beyond the 2px light model; permanent
pulsing; text labels doing a layout's job.
