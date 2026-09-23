# Changelog

All notable changes to this project are documented here. This project adheres to
[Semantic Versioning](https://semver.org/).

## [1.3.1] — 2026-09-22

### Added

- **`tools/reach-test.mjs` — a reachability gate.** `render-test.mjs`, the golden
  exports, and `axe-audit.mjs` all verify *rendering*; none verify *reachability*.
  Twice a feature shipped complete in CSS, schema, docs, and goldens while remaining
  unreachable in the UI, passing every gate: `kraft`/`studio` were missing from
  `THEME_PRESETS` in v1.2.0, and `narrative-card`/`embedded-media` were filtered out of
  the sidebar TOC. This script asserts on the controls themselves in a real browser:

  | Assertion | Catches |
  |---|---|
  | Every `theme.schema.json` preset enum value has a `[data-theme]` block in `ifbase.css` | A documented preset that silently renders as `default` |
  | Every preset enum value appears in the runtime theme menu | The v1.2.0 `kraft`/`studio` bug |
  | The theme menu offers no preset the schema disallows | A picker entry a spec cannot legally request |
  | Every question — display-only types included — has a TOC entry | The `narrative-card`/`embedded-media` bug |
  | No TOC entry falls back to a raw question id | A developer identifier leaking into the nav |
  | Display-only types are excluded from each section's answered/total count | Progress counts inflated by unanswerable steps |
  | The global actions are inside `.topbar` and on-screen at 1440 px and 375 px | A regression back to the sidebar footer that hid below 1100 px |

  Verified by mutation: each of the six defect shapes above was reintroduced and
  confirmed to fail the gate, then reverted. Visibility means within the viewport and
  topmost at its own centre, not merely a non-zero box — a control above the fold or
  behind an overlay counts as unreachable.

- `npm run reach` in `tools/package.json`. Defaults to
  `examples/question-type-catalog.json`, which exercises every question type; accepts
  any spec path.

## [1.3.0] — 2026-09-22

Navigation and chrome release. The global actions move out of the sidebar into a
sticky topbar, and the two display-only question types become reachable.

### Changed

- **`⚑ Wrong questions?` and `Review & export` moved to the topbar.** Both were in a
  sidebar footer, below the full question tree — so on a long form they were scrolled
  out of view, and below 1100 px they vanished entirely with the sidebar. They are
  global actions rather than navigation, so they now sit in the topbar, which has the
  room and is present at every width. At ≤720 px the form title hides and both buttons
  reduce to their glyphs, keeping an `aria-label` so they stay operable and labelled.
- **The topbar is sticky** (`position: sticky; top: 0`), so the layout toggle, both
  promoted actions, and the theme switcher stay reachable while scrolling — most
  noticeable in the long "All sections" view. Stacking order is now explicit: topbar 90
  < theme dropdown 100 < critique modal 200. The critique overlay was previously also
  `z-index: 90`, tying with the topbar and resolving only by DOM order.
- **Side gutters come from the wizard track, not the card.** `.card` had `width: 100%`
  plus `margin: 0 16px`, which overflowed its track and clamped back to full width — so
  the card rendered edge-to-edge on phones instead of inset. The 16 px gutter now lives
  on `.if-main` (`672px` = the 640 px card measure + gutters), and `.header` /
  `.progress-bar` drop their own padding so all three share one alignment. Measured:
  card inset 16 px at 375/480/640 px, previously 0 px.

### Fixed

- **`narrative-card` and `embedded-media` are now reachable.** `refreshTOC` skipped
  both display-only types, so the only way to see them was to click Next past every
  question and notice them in passing — in the published catalog they were effectively
  invisible. Both now get an italic TOC entry with a reference glyph, excluded from the
  section's answered/total count (which still shows `0/0`) because neither is
  answerable. The label falls back `tocLabel → label → title → caption → alt →
  placeholder`, so a raw question id never surfaces in the nav.
- **The catalog's `embedded-media` example no longer needs network access.** It pointed
  at a remote Wikimedia URL, which renders as an empty box offline, behind a firewall,
  or when the host blocks hotlinking — and defeats the purpose of an `--assets inline`
  build. It is now an inline SVG data URI. Note for spec authors: percent-encode `#`
  in an inline SVG, since a literal `#` starts a URI fragment and silently truncates
  the image.

### Removed

- **The mobile critique FAB.** It existed only because the sidebar (and its critique
  button) hid below 1100 px. The topbar is present at every width, so the workaround
  and its duplicate entry point are gone.

## [1.2.1] — 2026-09-22

Runtime fixes for two defects visible in the published demo.

### Fixed

- **Card width no longer jumps between questions.** `.if-main` used `flex: 0 1 auto`,
  which sized the wizard column to its content, so `.card`'s `max-width: 640px` acted
  as a ceiling rather than a fixed width. Measured across the ten questions of
  `examples/question-type-catalog.json`, the card rendered at ten different widths
  spanning 355–616 px (a 261 px spread), producing a visible jolt on every step
  change. `.if-main` is now a fixed 640 px track (`flex: 0 1 640px; width: 640px;
  max-width: 100%`), so the card holds 640 px on every question and in every preset
  while still shrinking below 640 px viewports. Measured after the fix: a single
  distinct width, 0 px spread; header, progress bar, and card stay left-aligned at
  1440/1200/1100/900/768/480/375 px with no horizontal overflow.
- **`kraft` and `studio` are now reachable from the theme switcher.** v1.2.0 shipped
  both presets in `ifbase.css`, the schema, and the docs, but `THEME_PRESETS` in
  `ifbase.js` still listed only three, so the two new presets could not be selected in
  a rendered form — they were documented but invisible. All five presets are now in the
  menu and verified to apply a distinct accent and background.

### Documentation

- Documented the **runtime theme switcher** in `references/theming.md` — previously an
  undocumented user-facing feature, which is why the missing presets went unnoticed.
  Adds the rule that a new preset must be added to both `ifbase.css` and
  `THEME_PRESETS`, and notes that switching presets does not revert spec `hue`/`palette`
  overrides.
- Rebuilt `docs/demo.html` so the published demo carries both fixes.

## [1.2.0] — 2026-09

Agent-ergonomics release. The theme: building a form should be one documented,
validated command — not a hand-rolled string substitution each agent reimplements
slightly differently. Everything here is authoring-path, with one runtime exception:
the `kraft`/`studio` preset blocks added to `ifbase.css` (see below). `ifbase.js` is
unchanged.

### Added

- **`tools/build.mjs` — the authoring CLI.** `node tools/build.mjs spec.json --out
  path/to/form.html` builds a form to any caller-chosen path. Flags: `--assets
  inline|absolute|relative`, `--theme`, `--hue`. Replaces the previous per-agent
  hand-substitution of the spec into `template.html`.
- **Self-contained forms by default.** `--assets inline` embeds `ifbase.css` and
  `ifbase.js` into the HTML, so a built form is one portable file that opens anywhere
  and survives being emailed or moved — no dependence on where the skill is installed.
  `absolute` (file:// URLs at the skill root) and `relative` (beside the skill files)
  remain available.
- **`validateSpec()` — structural validation before render.** `loadSpec` now rejects a
  malformed spec with a clear message instead of producing a form that breaks silently
  in the browser. Checks: unknown question types, duplicate ids (including branch ids),
  `branch` on a non-`radio` type, nested branches, `segmented` option count (2–5),
  `priority-rank`/`scale` option requirements, empty `sections`.
- **`tools/` documented in SKILL.md.** The authoring procedure now points at the CLI
  and library as the preferred path, with a tools reference table and a
  defaults-by-type table (which types honor `default`, which export an untouched
  marker) so the no-pre-selection asymmetry is stated in one place.
- **`kraft` and `studio` theme presets shipped.** Both were reserved enum values whose
  CSS had not shipped, so a spec using them passed validation but rendered as `default`.
  `kraft` (warm amber, terracotta accent) and `studio` (neutral surfaces, violet accent)
  now have `[data-theme=...]` blocks in `ifbase.css` and pass the accessibility audit
  (zero axe violations on both layouts). The schema, SKILL.md, and `references/theming.md`
  now agree with the CSS.

## [1.1.0] — 2026-09

Response-quality release. The theme: a form should be able to tell you it asked the
wrong questions, and should never make a guess look like an answer. The behavioral
changes below cite the survey-methodology and accessibility findings they rest on.

### Breaking

- **Pre-selection removed.** `options[].selected` and `default` are now **ignored at
  runtime** for `radio`, `checkbox`, `scale`, and `segmented`. A pre-selected answer that
  the user waves through is indistinguishable in the export from one they chose, which
  defeats the point of asking. Put the agent's hypothesis in a `badge` or `inferenceBox`
  instead. `slider` and `priority-rank` keep defaults (they cannot represent "empty") but
  export an `[UNTOUCHED DEFAULT]` marker until the user interacts.
- **Section tabs removed.** "All sections" renders every section in one continuous
  scroll. The old tab strip showed one section at a time despite its name, and wrapped
  and clipped past roughly seven sections. The sidebar TOC replaces it.
- **Mandatory "Not sure" replaced by `kind`.** Set `"kind": "factual"` and the renderer
  injects the escape hatch; `"kind": "judgment"` omits it. Omitting `kind` adds nothing.
  Rationale: nine experiments (Krosnick et al. 2002) found omitting no-opinion options
  does not degrade data quality, and they attract satisficing.
- **Progress percentage replaced** by a plain "Section 2 of 4". A 32-experiment
  meta-analysis found constant progress indicators give no completion benefit, and
  slow-to-fast designs raise drop-off odds ×1.56.

### Added

- **Skip on every question**, including `required` ones (`required` is now advisory).
  Optional one-tap reason: doesn't apply / don't know / prefer not to say. Skips export
  as `SKIPPED (reason)` — information about the question, not missing data.
- **Meta-feedback, two channels.** A per-question `⚑ Flag` and a form-level
  `⚑ Wrong questions?` panel reachable from every question (floating button below
  1100px). Exports as a `FORM_CRITIQUE` block that instructs the consuming agent to
  consider regenerating the form rather than proceeding.
- **Sidebar table of contents** — persistent sections → questions outline with
  per-question status (`✓` answered, `⊘` skipped, `○` unanswered, `⚑` flagged) and
  click-to-jump. Hidden below 1100px. `tocLabel` overrides a long label.
- **Export reading instructions.** Every export opens with a `--- How to read this ---`
  block stating that free-text notes outweigh the selections they annotate, and closes
  with a `--- Response quality ---` count of skips and flags.
- **Cited materials** — `sources` at spec root or on any question, rendered as links that
  open in a new tab with `rel="noopener noreferrer"`. Only `http(s):`, `file:`, and
  relative URLs are linked; anything else renders as plain text, so a hostile `url`
  cannot become a script vector.
- **Fully labeled scales** — `labels: [...]` gives one label per point, which measures
  more reliably than endpoint-only `anchors`. `anchors` still works.
- **Jump-to-edit in review** — every review row has a "Change" button.

### Fixed

- **Scale is now a real radio group.** It rendered five plain `<button>`s with no
  `role="radio"`, no `aria-checked`, and no keyboard navigation — individually valid, so
  axe passed them, but not announced as a single-choice group. Now implements the APG
  rating pattern with roving tabindex and arrow-key selection.
- **Scrollable export box was keyboard-inaccessible** (serious axe violation, previously
  masked because the box sat behind an inactive tab). Now focusable with an accessible
  name.
- **Export key alignment** broke for ids longer than 16 characters; padding is now
  computed from the longest key.
- Commentary textarea is roomier by default — a one-line box signalled "not expected",
  and commentary is the highest-signal field in the export.

### Changed

- `SKILL.md` gained a writing standard for question text, the question-altitude triage
  rule (altitude, not count, drives form pain), and documentation for every item above.
  The "max 2 textareas" cap is gone: question count alone does not reliably predict
  abandonment.
- Verified: 11/11 test specs render clean, 0 axe violations across both layouts.

## [1.0.1] — 2026-06

Documentation/structure refactor — no runtime behavior change.

- Moved the full `--if-*` token contract, preset catalog, and `theme`-block field
  reference out of `SKILL.md` into `references/theming.md`. `SKILL.md` keeps a condensed
  pointer plus the load-bearing constraints (spec-block-only theming, no per-form CSS,
  OKLCH-only). Trims the always-loaded skill body from 421 to 345 lines; the cold-path
  theming detail is now read on demand.
- Removed internal roadmap codes (C3/C4/E2/D1–D3) from user-facing docs.
- Added a worked-example pointer to `examples/question-type-catalog.json`.
- Consolidated duplicated save-path guidance.

## [1.0.0] — 2026-06

First public release.

### Spec-driven renderer
- Single `<script id="form-spec">` JSON block drives **both** the step-by-step wizard and
  the all-sections view; state stays in sync across views (no duplicated DOM to drift).
- Auto-formatted **Copy for Claude** export and review panel generated from the spec —
  no custom `buildExport`/`buildReview` needed.
- Optional free-text **commentary** auto-attached to every closed-choice question.

### Question types
`radio`, `checkbox`, `text`, `textarea`, `scale`, `slider`, `segmented`,
`priority-rank` (drag-reorder), `file-upload` (base64-embedded), `narrative-card`
(non-input story beat), and `embedded-media`, plus per-option **multi-branch** follow-ups
and `reveals`/`conditional` follow-ups.

### Theming
- Single `--if-*` OKLCH token layer for color, typography, motion, density, and elevation.
- `theme` block in the spec (`preset`, `hue`, `palette`, `typography`, `motion`, `density`).
- Presets: `default`, `editorial`, `terminal` (`kraft`, `studio` reserved).

### Quality
- Headless Playwright render harness (`tools/render-test.mjs`) with golden-export checks
  for every question type and theme preset (`test-specs/`).
- Programmatic accessibility audit (`tools/axe-audit.mjs`) across both views.

### Submodules
- `plan-approval` — section-by-section plan review with per-section approve/reject.
