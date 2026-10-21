# Intake Form

**Turn a batch of decisions or an underspecified request into a clean, native-feeling HTML form by filling in one JSON spec — no form HTML by hand, no backend, no build step.** The reviewer fills it out in the browser and clicks **Copy for Claude**; you get back a structured, agent-ready payload.

![Answering a decision brief: each question shows why it matters, what is at stake and the agent's recommendation with its confidence; the reviewer takes the recommended option, ticks two recommended checkboxes, answers the third question with Other in their own words, then opens Review & export, whose export ends with the command that files the answers as decisions of record](docs/demo.gif)

<sub>Each decision says why it matters, what is at stake and what the agent recommends; every closed question has an Other answer, and every question can be skipped or flagged. The export names the form and ends with the one command that files the answers as the project's decisions of record. **Try it live:** [www.bobspunt.com/intake-form/docs/demo.html](https://www.bobspunt.com/intake-form/docs/demo.html) — one self-contained file showing every question type. Or open [`examples/question-type-catalog.html`](examples/question-type-catalog.html) locally.</sub>

## Why this exists

Agents do their worst work when the request is vague. The usual fix is a wall of clarifying questions in chat, which is slow, easy to lose, and hard for a person to answer carefully. The other failure mode is just as bad: an agent (or a developer) hand-writing form HTML, which drifts, duplicates state across views, and quietly breaks.

Intake Form is the small thing in between. You describe the questions as a **JSON spec**; a single bundled renderer builds the whole form — both a step-by-step wizard *and* an all-sections view — from that one source. The human answers in a calm, well-designed UI, and the export comes back as a tidy block an agent can act on directly.

It came out of agent workflows: before starting ambiguous work, an agent generates a form, the human fills it in, and the answers flow back as structured context instead of a half-remembered chat thread.

## Who it's for

Anyone who wants a person's input captured **structured and unambiguous** before work begins — without standing up a survey tool, a database, or a login.

- **Scoping agent work.** An agent hits 2+ real gaps, generates a form, and waits for a grounded brief instead of guessing.
- **Batched decisions.** An agent has several calls only you can make. It decides what it confidently can, then puts the rest on one page, each with why it matters, what's at stake, and its recommendation with a confidence level.
- **Lightweight requirements gathering.** Drop a form into any project folder, send the file, get a clean export back.
- **Decision intake.** Capture the frame of a decision (reversibility, stakes, deciders, constraints) in one pass.

## What you get back

The reviewer clicks **Copy for Claude** and the renderer auto-formats every answer into a labeled export — no custom code:

```
=== INTAKE EXPORT ===

--- How to read this ---
1. Free-text NOTE lines carry more signal than the selections they
   annotate. Where a note and a selection conflict, trust the note.
2. SKIPPED is information, not absence. It means the question missed —
   do not re-ask it verbatim. Check the reason.
3. FLAGGED questions were judged wrong by the respondent.
4. [= recommended] / [≠ recommended] compare an answer with the
   recommendation the form offered. A departure from a high-confidence
   recommendation means the recommender misjudged something: find out
   what before relying on its other assumptions.

APPROVAL:           When its tests pass   [= recommended, high confidence]
REVERSIBILITY:      Easily reversible
REVERSIBILITY_NOTE: reversible on paper, but the migration is one-way
CLEANUP:            Other: gzip it with recovery steps, then delete   [≠ recommended: Delete it (medium confidence)]
CONSTRAINTS:        Time | Compliance
BUDGET:             SKIPPED (Doesn't apply)
EFFORT:             30   [UNTOUCHED DEFAULT — not confirmed by respondent]
FORMAT:             Report
FORMAT_FLAG:        Too specific / in the weeds — ask what the decision is first
REPORT_PAGES:       10

--- Context already known ---
User: a senior engineer on a small product team.

--- Routing suggestion ---
ask.reversibility     -> route to a structured decision workflow ...

--- Response quality ---
1 question(s) skipped.
1 question(s) flagged as mis-targeted.
Treat these as evidence about the form, not only about the respondent.
```

When the reviewer says the form itself is wrong, a `FORM_CRITIQUE` block leads the
export and tells the consuming agent to regenerate rather than proceed.

## Answers that outlast the session

A form built with `tools/build.mjs` gets a form id, and its export ends with the one
command that files it:

```bash
node tools/record.mjs answers.txt
```

That writes the project's decisions of record to `.decisions/YYYY-MM-DD-<slug>.md`
(question, answer, note, the recommendation and whether it was followed, and who
decided) and keeps the whole interaction in a local store shared by every project on
the machine. Before writing the next form, an agent reads `.decisions/` so it doesn't
re-ask what's settled, runs `record.mjs search <topic>` to find past forms on the same
subject, and checks `record.mjs stats` to see how often its high-, medium- and
low-confidence recommendations were followed.

Both layers stay local: `.decisions/` ignores itself, and the store lives in the
skill's gitignored `.records/` (or `~/.local/state/intake-form/records`, or
`$INTAKE_FORM_RECORDS`). Nothing is uploaded. `--no-record` builds without any of it.

## Quick start

There is no install step for the form itself — it's a template plus a renderer.

**As an agent skill (Claude Code, Codex, or any SKILL.md-aware agent).** Drop this folder into your skills directory (e.g. `~/.claude/skills/intake-form` for Claude Code, `~/.agents/skills/intake-form` for Codex). The agent reads [`SKILL.md`](SKILL.md), writes a JSON spec, and builds a form into your project.

**As a Claude Code plugin.**

```
/plugin marketplace add spunt/intake-form
/plugin install intake-form@intake-form
```

**By hand.** Write a JSON spec (schema in [`SKILL.md`](SKILL.md)) and build it with the bundled CLI:

```bash
node tools/build.mjs my-spec.json --out my-form.html
```

The default `--assets inline` embeds `ifbase.css` and `ifbase.js`, so `my-form.html` is one self-contained file that opens anywhere and survives being emailed — see [`examples/question-type-catalog.html`](examples/question-type-catalog.html) for the result. A malformed spec (unknown question type, duplicate id, bad theme) fails at build time with a clear message instead of a broken form in the browser. No Node? Edit [`template.html`](template.html) directly — replace the JSON inside `<script id="form-spec">` and open it beside the skill files.

## How it works

- **One spec, two views.** `ifbase.js` reads a single `<script id="form-spec">` block and builds *both* the wizard and the grouped layout from it, keeping state in sync. There is no second copy of the questions to drift out of sync — the structural fix for the classic "duplicate the DOM and one copy goes empty" bug.
- **Native controls.** Real `<input>`/`<textarea>`/range elements, keyboard-navigable, with an inference box, a commentary field on every answerable question except free text, and Skip + Flag controls on every question.
- **Every question can start with why.** A question can say why it matters to the reader and what's at stake before showing its options, and carry the agent's recommendation with a confidence level and its reason. All of it renders at body size, not as a muted hint, so the reader can decide from the card alone.
- **Room to answer.** Every closed question offers an "Other" choice with a text box, because the best answer is often one the options didn't list. Open answers and commentary have no character limit unless the spec gives a reason the reader can see.
- **Nothing is pre-selected.** A guess the user waves through would be indistinguishable from an answer they chose, so the agent's recommendation appears as stated reasoning and a badge to accept or reject — never as a checked box. The export marks each answer as following or departing from it.
- **The form can tell you it is wrong.** Any question can be skipped (with a reason) or flagged, and a form-level critique panel reachable from every question exports a `FORM_CRITIQUE` block telling the consuming agent to regenerate rather than proceed.
- **Sidebar navigation.** A persistent table of contents lists every section and question with live status — answered, skipped, unanswered, flagged — and jumps to any of them.
- **Cited material stays reachable.** Attach `sources` to the form or any question; they render as links that open in a new tab, so following a citation never discards the reviewer's answers.
- **Themeable from the spec.** A single `--if-*` OKLCH token layer drives color, type, motion, and density. Set a `theme` block (`preset`, `hue`, `palette`, …) in the spec; no per-form CSS. Five presets ship: `default`, `editorial`, `terminal`, `kraft`, and `studio` — all pass the accessibility audit.
- **Client-side only.** Nothing is sent anywhere. Answers live in the page until the user clicks Copy for Claude or exports.

## Question types

`radio` · `checkbox` · `text` · `textarea` · `scale` · `slider` · `segmented` · `priority-rank` (drag-reorder) · `file-upload` (base64-embedded) · `narrative-card` (non-input story beat) · `embedded-media` · plus per-option `multi-branch` follow-ups. Every type is demonstrated in [`examples/question-type-catalog.html`](examples/question-type-catalog.html); the full schema and authoring rules are in [`SKILL.md`](SKILL.md).

## Quality

The renderer is backed by tooling in [`tools/`](tools/): `build.mjs` (the authoring CLI, with `validateSpec` rejecting malformed specs before render and warning about ignored fields), `render-test.mjs` (headless Playwright render → screenshot + console-error capture + export capture against golden files in [`test-specs/`](test-specs/)), `axe-audit.mjs` (programmatic accessibility audit on both views), `record-test.mjs` (fills a form in a real browser, files the export with `record.mjs`, and asserts the parsed answers equal the in-browser state; also checks with a real `git add` that neither the store nor `.decisions/` can be committed), and `reach-test.mjs` (reachability gate: asserts every theme preset is actually selectable, every question — display-only types included — has a navigation entry, every why/stakes/recommendation is shown before its options at body size, every closed question's Other choice works end to end, and no answer box is capped without a stated reason). Every shipped question type and theme preset has a golden export captured under `test-specs/`.

The reachability gate exists because render, golden, and axe checks all verify *rendering* and none verify *reachability* — twice a feature shipped complete in CSS, schema, docs, and goldens while remaining unselectable in the UI, passing every gate.

Current state: all 16 test specs and the catalog render with zero console errors and zero axe violations across both layouts, each in its own theme preset. The design decisions behind v1.1.0 — no pre-selection, conditional escape hatches, labeled scales, position instead of percentage — rest on published survey-methodology and WAI-ARIA guidance, summarized per change in [`CHANGELOG.md`](CHANGELOG.md).

```bash
cd tools && npm install
node render-test.mjs ../test-specs/demo-all.json
node axe-audit.mjs ../test-specs/demo-all.json
node demo-gif.mjs        # regenerates docs/demo.gif (needs ffmpeg)
```

## License

[MIT](LICENSE) © 2026 Bob Spunt. Use it in anything, including commercial work. Keep the copyright notice.
