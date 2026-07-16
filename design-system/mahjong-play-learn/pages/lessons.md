# Page: lessons (the course surface)

> Overrides MASTER.md. Same tokens as the table, different density and far
> less atmosphere — the felt belongs to the game; the course is a calm,
> structured study room next door. Hand-authored from MASTER.md + spec §5.5.

## Point of view

Calmer and lighter-weight than the table: more air, more structure, no felt
gradient, no grain, no vignette. Flat `--color-paper` surfaces with
`--color-paper-raised` cards and `--color-paper-line` hairlines.

## Colour

- Background: flat `--color-paper` (no felt-surface class here).
- Cards/list rows: `--color-paper-raised`, 1px `--color-paper-line` border,
  radius 12px, shadow none or `--shadow-panel` for modals only.
- Accent `--color-accent` marks the single primary action per screen
  (Continue, Check, Next) and streak flame only.
- Semantic scale grades answers: `--color-safe` correct, `--color-danger`
  wrong, `--color-consider` partially right / acceptable. Always with a
  textual verdict, never colour alone.
- Tiles rendered inside lessons sit on small `--color-felt` chips so ivory
  keeps its contrast.

## Type

- `--font-serif` for unit titles, session headings, big numerals (XP, streak,
  mastery %) — `.tabular` on all changing numbers.
- `--font-sans` for questions, options, explanations, buttons.

## Layout & density

- Single centred column, max-width ~40rem, generous vertical rhythm
  (`--space-lg` between blocks, `--space-2xl` between sections).
- Progress is structural, not decorative: mastery bars are thin, labelled,
  and comparable; the unit map reads top-to-bottom as terrain.
- The session summary screen is a real layout (concept deltas, due-next,
  streak) — designed, not a modal with a list.
- One question on screen at a time; feedback appears in place, options lock
  after one answer (no retry-until-right).

## Motion

- Feedback: 150–200ms fade/slide-in; correct/incorrect never bounces.
- Item-to-item transition: quick horizontal slide (`--duration-ui`), no
  stagger theatrics on data.

## Forbidden here

Felt texture, vignettes, ambient glow, gold on anything but the primary
action/streak, timers that pulse, decorative colour on semantic elements.
