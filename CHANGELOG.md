# Changelog

All notable changes to this project are documented here. This project adheres to
[Semantic Versioning](https://semver.org/).

## [1.2.0] — 2026-09

Agent-ergonomics release. The theme: building a form should be one documented,
validated command — not a hand-rolled string substitution each agent reimplements
slightly differently. Everything here is authoring-path; the runtime (`ifbase.js`,
`ifbase.css`) is unchanged.

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
