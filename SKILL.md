---
name: intake-form
description: Use when a project request, task, or prompt is underspecified — missing goal, scope, success criteria, stakeholders, or constraints. Generates a standalone HTML intake or clarification form that collects structured information from a human and exports a Claude-ready payload. Triggers on vague requests, incomplete specs, when "what are we building?" cannot be answered, or explicit phrases like "draft an intake form", "spin up a clarification form", "get a brief from the user", "gather requirements before starting".
---

# Intake Form

Generate a standalone HTML form by **filling in a JSON spec** inside the canonical template. Do **not** write form HTML by hand.

## How it works (read this once, then never break it)

The skill is template + renderer + spec — single source of truth.

1. `template.html` — canonical shell. **Copy verbatim.** Do not modify any HTML.
2. `ifbase.js` — at runtime, reads `<script id="form-spec">`, builds **both** the wizard layout *and* the grouped layout from it, wires native `<input>` controls, and keeps state in sync between the two views.
3. `ifbase.css` — styles. Untouched by agents.

Your only job is the JSON spec. There is no second copy of the questions to keep in sync — the renderer produces both views from one source. This is the structural fix for the recurring "All sections is empty" bug: previous designs required agents to duplicate every question into two parallel DOM trees, and agents (correctly applying DRY instinct) skipped the duplication. Don't try to "fix" the form by hand-writing HTML — fix the spec.

**Files in the skill** (they all sit together in this skill's install directory):
- Template: `template.html`
- CSS: `ifbase.css`
- JS: `ifbase.js`

A generated form must be able to load `ifbase.css` and `ifbase.js` at runtime, so set the form's `<link rel="stylesheet">` and `<script src>` to resolve them. Two supported ways:

1. **Install-relative reference (default).** Point both tags at this skill's directory on the current machine (the absolute path where intake-form is installed). The form then resolves the CSS/JS from the skill folder no matter where the form itself is saved.
2. **Self-contained form (portable).** Inline the contents of `ifbase.css` into a `<style>` block and `ifbase.js` into a `<script>` block in the saved form. The form then works anywhere with no external files — best for sharing, emailing, or hosting.

The template ships with **relative** references (`ifbase.css`, `ifbase.js`), which work as-is when a form is saved beside the skill files (as in the bundled demo). When saving a form elsewhere, switch to option 1 or 2. Nothing in the skill references files outside the skill directory.

## Authoring procedure

1. Read `template.html`.
2. Decide your sections + questions.
3. Replace the placeholder spec inside `<script id="form-spec" type="application/json">…</script>` with your real spec. Keep everything else byte-for-byte identical.
4. Save the form to a sensible output folder relative to the current working directory (see § Save path).
5. Tell the user the full path.

## Save path

Save relative to the **current working directory**, in a sensible folder (e.g. `research/`, `docs/`, `stage/`). Never reuse a hardcoded path from another project.

## When to generate

- 2+ gaps needing human input → generate form

## When NOT to use

- Single factual gap — ask inline
- Autonomous run with no human in the loop — state assumptions and proceed
- Request is already fully specified — execute
- User has provided the missing details in the current turn — do not re-ask
- **Editing an existing form** — modify the spec block inside it, do not regenerate the whole file

## Gap triage

| Class | Action |
|---|---|
| Blocker | Ask in form |
| High-value | Ask in form |
| Assumable | Assume in `knownContext` with a stated default |
| Deferrable | Note in routing as deferred |

---

## Quick start: theming

Add a `"theme"` block to the spec to control the visual style. Three common patterns:

**1. Named preset** — swaps the full color + type personality in one field:
```json
"theme": { "preset": "terminal" }
```
Available presets: `default` (blue SaaS), `editorial` (serif, warm paper), `terminal` (dark mono, green accent).

**2. Hue shift** — keeps the default layout but rotates the accent and tinted neutrals to a new hue (0–360):
```json
"theme": { "hue": 30 }
```

**3. Custom palette** — override specific OKLCH color tokens. Keys are the `--if-color-*` names without the `--if-color-` prefix:
```json
"theme": {
  "palette": {
    "accent":  "oklch(54% 0.18 12)",
    "surface": "oklch(99.5% 0.003 235)"
  }
}
```

**In the generated HTML page:** The `data-theme` attribute on `<html>` drives the active preset (set by `applyTheme()` at load time). To override after the page loads, open the browser console and run `document.documentElement.dataset.theme = 'editorial'` — or edit the spec's `theme.preset` field and reload.

---

## Spec schema

```jsonc
{
  "title":       "string — shown in tab/topbar",
  "heading":     "string — main h1",
  "subhead":     "string — paragraph under h1",
  "exportTitle": "string — header row in the copy-for-Claude block. Default 'INTAKE EXPORT'",

  "theme": {
    "preset":   "default | editorial | terminal | kraft | studio",   // optional; default = 'default'
    "hue":      235,                                                  // optional; 0–360, sets --if-hue
    "palette": {                                                      // optional; per-token OKLCH overrides
      "accent":  "oklch(48% 0.13 235)",
      "surface": "oklch(99.5% 0.003 235)",
      "text":    "oklch(18% 0.02 235)"
      // any --if-color-* token (without --if-color- prefix); see references/theming.md § Token layer
    },
    "typography": {                                                   // optional
      "display": "sans | serif | mono",                               // sets --if-font-display
      "body":    "sans | serif | mono",                               // sets --if-font-body
      "scale":   1.0                                                  // 0.85–1.3 multiplier on type scale
    },
    "motion": {                                                       // optional
      "intensity": "off | subtle | default | expressive",
      "curve":     "quart | quint | expo"                             // ease-out curve family
    },
    "density":  "compact | default | airy | <number 0.7–1.4>",        // optional
    "voice":    "string — tone hint (e.g., 'editorial', 'warm', 'terse'); reserved for storytelling layers"
  },

  "sections": [
    {
      "name": "string — section label, shown above each question in wizard view AND as a tab in 'All sections'",
      "questions": [
        {
          "id":        "snake_case — used as state key and form field name",
          "type":      "radio | checkbox | text | textarea | scale",
          "label":     "string — the question",
          "hint":      "string (optional) — sub-label",
          "required":  true,
          "exportKey": "OPTIONAL_OVERRIDE — defaults to id.toUpperCase()",
          "inferenceBox": "string (optional) — shown as 'What I'm seeing: …' above the question",

          // For radio / checkbox:
          "options": [
            {
              "value":       "snake_case",
              "label":       "Visible label",
              "description": "string (optional) — sub-label under the option",
              "badge":       "string (optional) — e.g. 'Likely match — reason'",
              "selected":    true,        // pre-select
              "unsure":      true,        // dashed border + italics; reserved for the 'Not sure' option
              "reveals":     true         // selecting this option reveals the conditional follow-up
            }
          ],

          // For text / textarea:
          "placeholder": "string",
          "maxLength":   500,             // textarea only — adds a char counter
          "default":     "string",        // optional initial value

          // For scale:
          "anchors": ["Left trade-off", "Right trade-off"],
          "default": 3,

          // For narrative-card:
          // "title": "string"    // bold headline
          // "body":  "string"    // italic caption — the story beat
          // "icon":  "💡"        // optional emoji; rendered aria-hidden above title
          // Non-input: has no value, not included in review panel, not included in export.
          // An "id" field is still required by the spec parser but is ignored at runtime.
          // Example:
          { "id": "frame_stakes", "type": "narrative-card",
            "icon": "⚖️", "title": "Now for the stakes.",
            "body": "The next few questions help us understand what's on the line — and how to weight the factors." }

          // For embedded-media:
          // "src":       "string"          // URL to image or video
          // "alt":       "string"          // alt text for images (required for accessibility)
          // "caption":   "string"          // optional figcaption beneath the asset
          // "mediaType": "video"           // omit for image; set "video" to render <video> tag
          // Non-input: not included in review panel or export.
          // Example:
          { "id": "dashboard_screenshot", "type": "embedded-media",
            "src": "https://example.com/chart.png", "alt": "Q3 revenue chart",
            "caption": "Q3 performance — 14% above target." }

          // For file-upload:
          // "accept":    "image/*,application/pdf"  // optional MIME filter (passed to input[accept])
          // "maxSizeKb": 2048,                       // optional; default 2048 (2 MB)
          // Export: "[filename.png | image/png | 42.1 KB]\ndata:image/png;base64,..."
          // Review: "filename.png (42.1 KB)"
          // Example:
          { "id": "brief", "type": "file-upload", "label": "Attach your project brief",
            "accept": "application/pdf", "maxSizeKb": 1024, "commentary": false }

          // For segmented:
          // "options": [{value, label}] — 2 to 5 options; no description field
          // "default": "value"  // or use options[].selected
          // Export: selected label (same as radio)
          // Example:
          { "id": "scope", "type": "segmented", "label": "Who is affected?", "default": "team",
            "options": [{"value": "self", "label": "Just me"}, {"value": "team", "label": "My team"}, {"value": "org", "label": "Whole org"}] }

          // For slider:
          // "min": 0, "max": 100, "step": 1, "default": 50  (all optional)
          // "anchors": [{at, label}] — optional threshold labels; nearest animates active
          // Export: numeric value as string ("EFFORT: 42")
          // Review: "42 — Medium" (nearest anchor appended when anchors defined)
          // Example:
          { "id": "effort", "type": "slider", "label": "Estimated effort", "min": 0, "max": 100, "step": 10, "default": 30,
            "anchors": [{"at": 0, "label": "Trivial"}, {"at": 50, "label": "Moderate"}, {"at": 100, "label": "Heroic"}] }

          // For priority-rank:
          // "options": [{value, label, description?}] — each row; minimum 2
          // "default": ["v1","v2","v3"]  // initial order; omit to use options order
          // Export: "Label 1 > Label 2 > Label 3"
          // Example:
          { "id": "priorities", "type": "priority-rank", "label": "Order your priorities",
            "options": [{"value": "accuracy", "label": "Accuracy", "description": "Model correctness"},
                        {"value": "speed",    "label": "Speed",    "description": "Inference latency"},
                        {"value": "cost",     "label": "Cost",     "description": "Per-query cost"}] }

          // Multi-branch follow-up (richer alternative to conditional):
          // Add "branch": {<question object>} to any radio option. When that option is selected,
          // the branch question appears below (any type). Only one branch visible at a time.
          // Branch answer exported on its own line using the branch question's id as the key.
          // Backwards-compatible: existing "reveals" + "conditional" still works unchanged.
          // Example:
          { "id": "output_format", "type": "radio", "label": "What format do you need?",
            "options": [
              { "value": "report", "label": "Report",
                "branch": { "id": "report_pages", "type": "slider", "label": "How many pages?", "min": 1, "max": 50, "default": 10 } },
              { "value": "dashboard", "label": "Dashboard",
                "branch": { "id": "dashboard_refresh", "type": "segmented", "label": "Refresh cadence",
                  "options": [{"value": "live", "label": "Live"}, {"value": "daily", "label": "Daily"}, {"value": "weekly", "label": "Weekly"}] } },
              { "value": "unsure", "label": "Not sure", "unsure": true }
            ] }

          // Conditional follow-up (paired with options[].reveals):
          "conditional": {
            "id":          "weight_other",
            "type":        "text | textarea",
            "placeholder": "string",
            "stateKey":    "weight_other",   // optional; defaults to '<id>_other'
            "maxLength":   200               // textarea only
          }
        }
      ]
    }
  ],

  "knownContext": [
    "Free-form lines appended to the export under '--- Context already known ---'",
    "Use this for things Claude already knows so the user doesn't have to re-state them"
  ],

  "routing": {
    "ask.reason_fork": "route to a structured decision workflow with FORK_FACTOR as the primary axis"
  }
}
```

## Question type rules

Worked example of every type in one spec: `examples/question-type-catalog.json` (rendered: `examples/question-type-catalog.html`).

- **Radio:** include `"unsure": true` on the "Not sure" option (last). Pre-select your best guess (`"selected": true`) and add a `"badge"` explaining why. Always include a "Not sure" escape hatch.
- **Checkbox:** any number of `"selected": true` options become pre-checked. Don't pre-check anything you'd rather the user actively pick.
- **Text:** single-line. Use for short identifiers / names / "something else" follow-ups.
- **Textarea:** multi-line. Cap to 2 textareas per form — recognition over recall.
- **Scale:** 5 buttons. `anchors` are trade-off labels (not good/bad).
- **File-upload:** drag-and-drop zone with click-to-browse fallback. `accept` filters by MIME type. `maxSizeKb` (default 2048) enforces a size cap with an inline error on violation. Export embeds a `[filename | mime | size]` header followed by the base64 data-URL. Review display shows filename and size only (no data-URL). Does not get auto-commentary.
- **Segmented:** pill-button toggle for 2–5 mutually-exclusive options. Options are `{value, label}` — no description field. Use `default` or `options[].selected` for pre-selection. Does not get auto-commentary (it's a fast-tap choice). Export format: selected label (same as radio).
- **Slider:** single-handle range. `min`/`max`/`step` default to 0/100/1. `anchors` array is optional — each entry `{at, label}` marks a threshold; the nearest anchor is highlighted as the thumb moves. Export format: numeric value only. Review display: `"42 — Medium"` (nearest anchor appended when anchors defined). Does not get an auto-commentary box.
- **Priority-rank:** renders a drag-reorderable list. Each `options` entry becomes one row with a grip handle and ↑/↓ buttons. Minimum 2 options required (a single-item list cannot be ranked). `default` sets the initial order as an array of values; omit to use the options array order. Keyboard: ArrowUp/Down on the ↑/↓ buttons also move the item. Export format: `Label 1 > Label 2 > Label 3` (ordered by rank). Commentary is attached by default (users often need to explain their ranking).
- **Narrative-card:** non-input story beat rendered in the question flow. Has `title`, `body`, and optional `icon` (emoji). Does not appear in review or export. Use to frame sections, provide context, or add emotional punctuation between questions.
- **Multi-branch:** add `"branch": {<question object>}` to any radio option. When that option is selected, the branch question appears below the radio group (any primitive type). Only one branch is visible at a time. Branch answer exports on its own line keyed by the branch's `id`. Backwards-compatible with existing `reveals`/`conditional` pattern. **Constraints:** radio-only (not checkbox); nested branches (a branch with its own `branch` options) are not supported; branch question `id` must be globally unique within the form.
- **Conditional follow-up:** pair with an option that has `"reveals": true`. The follow-up appears when that option is selected, hides otherwise.

## Commentary (automatic — usually no spec needed)

Every closed-choice question (`radio`, `checkbox`, `scale`) gets an auto-attached free-text "Add commentary (optional)" textarea below it. It's there because picking an option is rarely the whole truth — users want to explain *why*, qualify the choice, or note context the choices don't capture.

- **Open-ended question types (`text`, `textarea`) do NOT get a commentary box** — they're already free-form.
- The commentary textarea auto-grows as the user types and stays empty/unobtrusive when not used.
- Per-question opt-out: `"commentary": false`
- Form-wide opt-out: `"commentary": false` at the spec root (individual questions can still opt back in with `"commentary": true`)
- Override the placeholder: `"commentaryPlaceholder": "Why this choice?"` — per-question or at spec root for a default
- Override the max length: `"commentaryMaxLength": 300` (default 500)

In the export, commentary appears on its own line with a `_NOTE` suffix:

```
WEIGHT:           career_fork
WEIGHT_NOTE:      it's the heaviest, but only because the sprint outcome is unknown
```

In the review view, commentary appears indented under the question with a `↳ commentary` marker.

Use the commentary feature instead of adding "Tell us more" textareas — it's already there for every question, so don't duplicate.

## Output format

The renderer produces the export when the user clicks "Copy for Claude". It auto-formats:

```
=== INTAKE EXPORT ===

QUESTION_ID:     value (with conditional appended if reveals option chosen)
MULTI_FIELD:     val1 | val2

--- Context already known ---
…knownContext lines…

--- Routing suggestion ---
ask.reason_fork       -> route to a structured decision workflow with FORK_FACTOR as the primary axis
```

You don't need to write a custom `buildExport` — the renderer reads from the spec.

## Theming

Style forms **only** through the spec's `theme` block — `preset`, `hue`, and per-token `palette` (the three patterns in § "Quick start: theming" above). The renderer maps spec values to `--if-*` CSS custom properties via `applyTheme(spec)` in `ifbase.js`. **Never** write per-form CSS files or inline `<style>` blocks, and use OKLCH (not hex/rgb) for any color value.

`kraft` and `studio` are reserved preset names but their CSS has not shipped yet — they fall back silently to default tokens.

**Full theming reference** — the complete `--if-*` token contract, preset catalog, and every `theme`-block field (`typography`, `motion`, `density`, `voice`, resolution order) — lives in **`references/theming.md`**. Read it only when a form needs customization beyond the three quick-start patterns.

## Override hooks (rare)

If you genuinely need custom export logic, override `window.buildExport(boxId)` and/or `window.buildReview(containerId)` in a `<script>` block placed AFTER `ifbase.js`. The spec-driven defaults are usually right.

## Submodules

| Submodule | Path | Use when |
|---|---|---|
| `plan-approval` | `submodules/plan-approval/SKILL.md` | Section-by-section plan review with approve/reject + feedback per section |

## Anti-patterns

- **Hand-writing question HTML.** That's the bug class this skill exists to prevent. If you find yourself writing `<div class="wizard-question">` or `<div class="grouped-section">`, stop — edit the spec instead.
- **Writing a `buildReview`/`buildExport` function in the form.** The renderer has spec-driven defaults. Only override if you really need to.
- **Saving to a hardcoded path from another project** — save relative to the invoking project's cwd.
- **Free text as default** — recognition patterns first; free text is fallback (max 2 per form).
- **No "Not sure" option on radios** — always required.
- **Asking about assumable gaps** — assume with stated default in `knownContext` instead.
- **Inlining CSS/JS or modifying the template HTML** — use the skill's files via absolute path.
- **Editing template.html itself for a one-off form** — the template is canonical. If you need new behavior, change `ifbase.js` once and benefit forever.
