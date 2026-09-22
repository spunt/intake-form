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

**Preferred — build with the bundled CLI.** The skill ships a builder that substitutes the spec, validates it, and writes a self-contained form. Use it instead of hand-editing `template.html`; every agent that hand-rolls the substitution writes a slightly different one, which is the duplication this skill exists to prevent.

1. Decide your sections + questions.
2. Write the spec to a `.json` file (see § Spec schema).
3. Build the form:
   ```
   node <skill-dir>/tools/build.mjs spec.json --out path/to/form.html
   ```
   `<skill-dir>` is this skill's install directory. `--out` is relative to the current working directory (see § Save path). The default `--assets inline` embeds `ifbase.css`/`ifbase.js` into the HTML, so the form is one portable file that opens anywhere — no dependence on where the skill lives. A bad spec (unknown question type, duplicate id, malformed theme) fails here with a clear message, not silently in the browser.
4. Tell the user the full path.

**Tools reference:**

| File | Role | Agent-facing? |
|---|---|---|
| `tools/build.mjs <spec> --out <path>` | Build a form to any path. `--assets inline\|absolute\|relative`, `--theme`, `--hue`. | Yes — the authoring entry point |
| `tools/lib/build-form.mjs` | Library: `loadSpec`, `validateSpec`, `validateTheme`, `buildFormHtml`, `writeFormFile`. Import it to build in-process. | Yes |
| `tools/render-test.mjs <spec> [--out <dir>]` | Headless render check: screenshots, console errors, export text, cold-render timing. | Dev/verification only |
| `tools/axe-audit.mjs` | Accessibility audit. | Dev/verification only |

**Fallback — hand-edit the template** (only if Node is unavailable):

1. Read `template.html`.
2. Replace the placeholder spec inside `<script id="form-spec" type="application/json">…</script>` with your real spec. Keep everything else byte-for-byte identical.
3. The template references `ifbase.css`/`ifbase.js` relatively, so a hand-edited form is styled **only when saved beside the skill files**. To save it elsewhere, inline the two files by hand or use the CLI.
4. Save to a sensible folder relative to the current working directory (see § Save path), and tell the user the full path.

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
  "sources":     [ { "url": "https://…", "label": "…", "note": "…" } ],  // optional; form-level references
  "sourcesLabel": "string — heading above the sources list. Default 'Background material'",

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
          "required":  true,              // advisory only — every question is skippable
          "kind":      "factual | judgment",  // radio: controls the auto "Not sure" option
          "tocLabel":  "string (optional) — shorter label for the sidebar TOC",
          "sources":   [ { "url": "https://…", "label": "…", "note": "…" } ],  // optional; open in new tab
          "exportKey": "OPTIONAL_OVERRIDE — defaults to id.toUpperCase()",
          "inferenceBox": "string (optional) — shown as 'What I'm seeing: …' above the question",

          // For radio / checkbox:
          "options": [
            {
              "value":       "snake_case",
              "label":       "Visible label",
              "description": "string (optional) — sub-label under the option",
              "badge":       "string (optional) — e.g. 'Likely match — reason'",
              "selected":    true,        // IGNORED at runtime — see § No default selections
              "unsure":       true,        // dashed border + italics; the escape-hatch option
              "reveals":     true         // selecting this option reveals the conditional follow-up
            }
          ],

          // For text / textarea:
          "placeholder": "string",
          "maxLength":   500,             // textarea only — adds a char counter
          "default":     "string",        // optional initial value

          // For scale (5 points; nothing pre-selected):
          "labels":  ["Wide open", "Leaning", "Mostly set", "Firm", "Locked"],  // preferred
          "anchors": ["Left trade-off", "Right trade-off"],                      // endpoint-only fallback

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

## Writing the questions

Default to clarity-first prose. If a `doc-clarity` skill (or equivalent house writing
standard) is available in the environment, apply it to all question text. The rules below
are the load-bearing subset, restated so this skill does not depend on that skill existing.

1. **One question per question.** "What's the scope and timeline?" is two questions; the
   user will answer one and drop the other silently.
2. **Conditions before instructions.** "If you already have a schema, paste it" — never
   the reverse.
3. **One term per concept.** Pick `entitlement` or `subscription` and reuse it. A rotated
   synonym makes the user wonder whether you mean something different.
4. **Name the actor.** "Who approves the rollout?" beats "How is approval handled?"
5. **No stacked hedges.** "It may possibly be worth considering whether…" is noise. Ask.
6. **Label uncertainty in `inferenceBox`.** Distinguish what you *measured* from what you
   *inferred* from what you *assumed*: "Your last three services used AWS" (measured)
   reads differently from "You probably want AWS" (assumed) — and only the first lets the
   user correct the actual error.
7. **Expand an unavoidable term of art once, on first use.** Do not simplify away
   precision for a domain expert.

Keep labels short and put the qualification in `hint`. A question label longer than about
12 words is usually two questions or one unstated assumption.

## Design rules the renderer enforces

These are not style preferences. The renderer implements them, so a spec that
violates them is silently corrected rather than honored. Each states its reason,
because an agent that understands the reason writes better specs.

### No default selections

Radio, checkbox, scale, and segmented questions all start empty. `options[].selected`
and `default` are **ignored at runtime** for those types.

A pre-selected answer that the user waves through is indistinguishable, in the export,
from an answer they actively chose. That defeats the purpose of asking. Pre-selection
also anchors the response toward the pre-selected value.

Surface your hypothesis where the user can *reject* it:

```json
{ "id": "target", "type": "radio", "kind": "factual",
  "label": "Which deployment target?",
  "inferenceBox": "Your last three services deployed to AWS.",
  "options": [
    { "value": "aws", "label": "AWS", "badge": "Likely — matches prior services" },
    { "value": "gcp", "label": "GCP" }
  ] }
```

Note that a badge still anchors: it is visible emphasis. That is acceptable — it is
*stated reasoning*, which the user can disagree with — whereas a checked box is a
silent claim about what they think.

`slider` and `priority-rank` are the two exceptions, because a range input always has a
thumb position and a list always has an order. They keep their defaults, but an untouched
control exports with `[UNTOUCHED DEFAULT — not confirmed by respondent]`.

**Defaults by type** — the whole rule in one place, so you never re-derive it:

| Type | Starts empty? | Honors `default`/`selected`? | Untouched export marker |
|---|---|---|---|
| `radio` | yes | no (ignored) | — (empty = skipped) |
| `checkbox` | yes | no (ignored) | — (empty = skipped) |
| `scale` | yes | no (ignored) | — (empty = skipped) |
| `segmented` | yes | no (ignored) | — (empty = skipped) |
| `slider` | no | yes | `[UNTOUCHED DEFAULT — not confirmed by respondent]` |
| `priority-rank` | no | yes (initial order) | `[UNTOUCHED DEFAULT — not confirmed by respondent]` |

### Escape hatches: declare `kind`, don't hand-add "Not sure"

Set `"kind"` on every radio:

| `kind` | Renderer adds "Not sure" | Use for |
|---|---|---|
| `factual` | yes | Anything the user could genuinely not know — current stack, team size, existing deadline |
| `judgment` | no | Preferences and trade-offs — the user *has* a view, and an escape hatch invites them to duck it |

Omitting `kind` adds nothing; supply your own `"unsure": true` option if you want one.

Every question is skippable regardless, so no user is ever trapped.

### Every question is skippable

The renderer puts a **Skip** control on every question, including `"required": true`
ones. `required` is advisory — it marks importance in the UI, and does not block.

A skip is recorded, not silent:

```
BUDGET:          SKIPPED (Doesn't apply)
```

Optional one-tap reasons: *Doesn't apply*, *Don't know*, *Prefer not to say*. Treat a
skip as **information about the question**, not as missing data. Do not re-ask a skipped
question verbatim in a follow-up form.

### Question altitude beats question count

There is no cap on question count. Length is not what makes a form painful — *altitude*
is. Question count alone does not reliably predict abandonment; topic and pitch do.

Before including a question, ask: **does the answer change what gets built?**

| Altitude | Example | Include? |
|---|---|---|
| Decision-changing | "Batch or streaming?" | Yes |
| Detail derivable later | "What retry interval?" | No — assume, state in `knownContext` |
| Below the agent's reach | "Which variable name?" | No |
| Above the user's knowledge | "What's the p99 target?" when they've never measured | No — or mark `kind: factual` |

When in doubt, ask the higher-altitude question and let commentary carry the detail.

## Meta-feedback: letting the user say the form is wrong

Two channels, both automatic — no spec needed.

1. **Per-question flag** (`⚑ Flag this question`) — categorizes one question as wrong
   level / too specific / too vague / missing the point / irrelevant, plus a free-text
   "what should we have asked instead".
2. **Form-level critique** (`⚑ Wrong questions?` in the sidebar, reachable from every
   question) — same categories applied to the whole instrument.

This exists because the worst failure of an intake form is being *well-completed and
wrong*. A user must be able to report a mis-targeted form without first completing it.

When `FORM_CRITIQUE` appears in an export, treat it as the highest-priority content:

```
--- FORM_CRITIQUE (read first) ---
PROBLEM:         Wrong level of detail
DETAIL:          These are all about mechanics, not what we're trying to decide.
```

**Regenerate the form at the corrected altitude. Do not proceed with the answers as if
the critique were a side note.**

## Reading the export

The export opens with a `--- How to read this ---` block instructing the consuming agent:

1. **Free-text `_NOTE` lines outweigh the selections they annotate.** Where a note and a
   selection conflict, trust the note. A selection is the closest available box; the note
   is what the user actually meant.
2. **`SKIPPED` is information, not absence.**
3. **`_FLAG` lines mark questions the user judged wrong.**

A `--- Response quality ---` footer counts skips and flags. High counts are evidence
about the *form*, not only about the respondent.

## Cited materials

Attach reference links at spec root (`sources`) or on any question (`sources`). They
render as real links that **open in a new tab**, so following a citation never discards
form state.

```json
"sources": [
  { "url": "https://example.com/spec", "label": "Platform spec", "note": "section 4" },
  { "url": "./docs/brief.md", "label": "Local brief" }
]
```

A bare string works as shorthand for `{ "url": ... }`. Only `http(s):`, `file:`, and
relative paths are linked; anything else renders as plain text, so a malicious `url`
cannot become a script vector. Override the heading with `sourcesLabel`.

## Navigation and layout

- **Sidebar TOC** — persistent hierarchical outline (sections → questions) with per-question
  status: `✓` answered, `⊘` skipped, `○` unanswered, `⚑` flagged. Click any entry to jump.
  Hidden below 1100px. Override a long label in the TOC with `"tocLabel"`.
- **Step-by-step / All sections** — "All sections" renders every section in one continuous
  scroll. (It previously showed one section at a time behind a tab strip, contradicting its
  own name; the tabs are gone.)
- **Position, not percentage** — the header shows "Section 2 of 4". Percentage progress
  indicators show no completion benefit in controlled comparisons, and some designs increase
  drop-off, so the form does not use one.
- **Review panel** — every row has a **Change** button that jumps back to that question.

## Question type rules

Worked example of every type in one spec: `examples/question-type-catalog.json` (rendered: `examples/question-type-catalog.html`).

- **Radio:** never pre-select. State your best guess as a `"badge"` or in `inferenceBox` — as visible reasoning the user can reject, not as a checked box. Set `"kind": "factual"` and the renderer adds "Not sure" for you; set `"kind": "judgment"` and it does not (see § Escape hatches).
- **Checkbox:** nothing is pre-checked. `"selected"` is ignored at runtime.
- **Text:** single-line. Use for short identifiers / names / "something else" follow-ups.
- **Textarea:** multi-line. Cap to 2 textareas per form — recognition over recall.
- **Scale:** 5 points, nothing pre-selected. Prefer `"labels": [...]` — one label per point — over endpoint-only `anchors`: fully labeled scales measure more reliably. `anchors` still works for two-ended trade-offs. Implements the APG radio-group pattern (arrow keys move and select). Five is deliberate, though not because five measures better: reliability and validity plateau at about five categories, and 5- and 7-point scales produce equivalent rescaled means. Five is *not worse* and costs the respondent less — which is the whole argument. The known cost is midpoint pile-up, since some respondents want a half-step, so when you need to separate *degrees* of a middle position rather than direction, write the distinction into the five labels instead of adding points.
- **File-upload:** drag-and-drop zone with click-to-browse fallback. `accept` filters by MIME type. `maxSizeKb` (default 2048) enforces a size cap with an inline error on violation. Export embeds a `[filename | mime | size]` header followed by the base64 data-URL. Review display shows filename and size only (no data-URL). Does not get auto-commentary.
- **Segmented:** pill-button toggle for 2–5 mutually-exclusive options. Options are `{value, label}` — no description field. Nothing is pre-selected. Does not get auto-commentary (it's a fast-tap choice). Export format: selected label (same as radio).
- **Slider (discouraged):** prefer `segmented` or a labeled `scale`. Drag interaction measurably raises item nonresponse, worst on mobile, and distorts the value distribution. An untouched slider exports with an `[UNTOUCHED DEFAULT]` marker because a range input cannot represent "unanswered". Single-handle range. `min`/`max`/`step` default to 0/100/1. `anchors` array is optional — each entry `{at, label}` marks a threshold; the nearest anchor is highlighted as the thumb moves. Export format: numeric value only. Review display: `"42 — Medium"` (nearest anchor appended when anchors defined). Does not get an auto-commentary box.
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
- **Free text as default** — recognition patterns first; free text is the fallback.
- **Pre-selecting an answer** — `selected`/`default` on closed-choice types is ignored at runtime. Put your hypothesis in a `badge` or `inferenceBox`.
- **A blanket "Not sure" on every radio** — declare `kind` instead and let the renderer decide.
- **Padding the form with low-altitude questions** — see § Question altitude.
- **Asking about assumable gaps** — assume with stated default in `knownContext` instead.
- **Inlining CSS/JS or modifying the template HTML** — use the skill's files via absolute path.
- **Editing template.html itself for a one-off form** — the template is canonical. If you need new behavior, change `ifbase.js` once and benefit forever.
