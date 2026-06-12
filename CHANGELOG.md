# Changelog

All notable changes to this project are documented here. This project adheres to
[Semantic Versioning](https://semver.org/).

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
