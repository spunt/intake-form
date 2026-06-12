---
name: intake-form/plan-approval
parent: intake-form
description: |
  Generate a plan approval form — a structured, step-by-step HTML review interface that walks an approver through each section of a plan, capturing an approve/reject decision and optional feedback at every step, then producing a structured verdict payload for agent consumption.
  Use when: a plan needs human sign-off before execution, a multi-section spec needs stakeholder review, or any artifact requires a gated approval with attached feedback.
---

# Plan Approval Submodule

A specialized form mode for **reviewing and approving plans**, built on the `intake-form` foundation.

## What This Submodule Adds

The base `intake-form` skill collects underspecified requirements. This submodule is different:
- The content is **already written** (a plan, spec, or proposal)
- The approver's job is to **react section by section**, not generate answers
- Each section gets a **binary decision** (approve / request changes) plus optional feedback
- A **final verdict** (Approved / Approved with conditions / Rejected) is produced at the end
- The export payload is structured for **agent consumption**: which sections passed, what feedback is attached, and what the overall verdict is

---

## When to Use

- After generating a plan with `spec-shaping` or writing a project plan manually
- Before executing a plan with parallel agents (pairs with `plan-founder-review`)
- Any multi-section document needing structured stakeholder sign-off
- Product specs, feature designs, sprint plans, architectural proposals

---

## Approval Form Structure

### Sections

Each plan section maps to one approval step. Steps are sequential — the approver moves through them in order.

**Per-step layout:**

```
┌─────────────────────────────────────────────────┐
│  SECTION N OF N          [Approve] [Request Changes]
│
│  Section Title
│  ─────────────────────────────────────────────
│  [Section content displayed as read-only text]
│
│  ┌ Feedback (optional) ────────────────────────┐
│  │ textarea — appears immediately, not gated   │
│  │ "Add feedback or questions for this section"│
│  └─────────────────────────────────────────────┘
│
│  [← Back]                          [Next →]
└─────────────────────────────────────────────────┘
```

**Decision buttons:**
- `Approve` — green accent, marks section as approved
- `Request Changes` — amber/warning tone, marks section as needs-revision
- A section can be left **undecided** and revisited before final verdict
- Feedback textarea is always visible (not conditional) — low friction matters

### Final Verdict Step

After all sections are reviewed:

```
┌─────────────────────────────────────────────────┐
│  REVIEW SUMMARY
│
│  Section decisions:
│  ✓ Section 1 — Approved
│  ✗ Section 2 — Changes Requested
│  ✓ Section 3 — Approved
│  – Section 4 — No decision
│
│  Overall Verdict:
│  ○ Approved — proceed as planned
│  ○ Approved with conditions — proceed, address flagged feedback
│  ○ Rejected — do not proceed until plan is revised
│
│  [Final notes — optional free text]
│
│  [Copy verdict for Claude]
└─────────────────────────────────────────────────┘
```

---

## State Model

```javascript
var state = {
  planTitle: '',
  sections: [],      // array of { id, title, content } — set at form init
  decisions: {},     // { sectionId: 'approved' | 'changes' | null }
  feedback: {},      // { sectionId: string }
  verdict: null,     // 'approved' | 'approved-with-conditions' | 'rejected'
  finalNotes: ''
};
```

**Auto-verdict logic** (suggested, overridable):
- All sections approved → pre-select "Approved"
- Any section "changes" → pre-select "Approved with conditions"
- Majority "changes" or any section explicitly flagged critical → pre-select "Rejected"
- Pre-selection is visible with an inference badge; approver always has final say

---

## Export Payload Contract

```
PLAN APPROVAL VERDICT
─────────────────────────────────────────
Plan: [planTitle]
Reviewed: [date]
Verdict: APPROVED / APPROVED WITH CONDITIONS / REJECTED

SECTION DECISIONS
─────────────────────────────────────────
[Section 1 Title]: APPROVED
  Feedback: —

[Section 2 Title]: CHANGES REQUESTED
  Feedback: The risk mitigation for DB migration is vague. Needs a backup step specified.

[Section 3 Title]: APPROVED
  Feedback: Consider parallelizing Phase 1 and Phase 2 — no dependency between them.

FINAL NOTES
─────────────────────────────────────────
[finalNotes or "None"]

AGENT INSTRUCTIONS
─────────────────────────────────────────
[If APPROVED]: Proceed with execution. No blocking items.
[If APPROVED WITH CONDITIONS]: Proceed. Address flagged feedback before or during execution.
[If REJECTED]: Do not execute. Revise plan based on feedback below, then re-submit for approval.
```

---

## Implementation Notes

All CSS, JS patterns, and design tokens are inherited from the parent `intake-form` SKILL.md. This submodule only specifies what differs:

### New/modified CSS

```css
/* Decision buttons — inline in section header */
.decision-bar { display: flex; gap: 8px; margin-top: 12px; margin-bottom: 16px; }
.btn-approve { background: #15803d; color: white; border: none; }
.btn-approve:hover { background: #166534; }
.btn-approve.active { background: #14532d; box-shadow: 0 0 0 3px rgba(21,128,61,0.2); }
.btn-changes { background: transparent; color: var(--warning); border: 1px solid var(--warning); }
.btn-changes:hover { background: rgba(180,83,9,0.06); }
.btn-changes.active { background: rgba(180,83,9,0.10); box-shadow: 0 0 0 3px rgba(180,83,9,0.18); }

/* Section content display */
.plan-content {
  background: var(--surface2); border: 1px solid var(--border);
  border-radius: var(--radius-sm); padding: 14px 16px;
  font-size: 13px; line-height: 1.7; color: var(--text);
  white-space: pre-wrap; margin-bottom: 14px;
  max-height: 320px; overflow-y: auto;
}

/* Summary row in final step */
.summary-row {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 0; border-bottom: 1px solid var(--border);
  font-size: 13px;
}
.summary-row:last-child { border-bottom: none; }
.decision-icon { font-size: 14px; width: 20px; text-align: center; flex-shrink: 0; }
.decision-label { color: var(--text-muted); font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; margin-left: auto; }
.decision-label.approved { color: var(--success); }
.decision-label.changes { color: var(--warning); }
.decision-label.undecided { color: var(--text-dim); }
```

### Key JS logic

```javascript
function setDecision(sectionId, decision) {
  state.decisions[sectionId] = decision;
  // update button active states
  var bar = document.getElementById('decision-bar-' + sectionId);
  bar.querySelector('.btn-approve').classList.toggle('active', decision === 'approved');
  bar.querySelector('.btn-changes').classList.toggle('active', decision === 'changes');
}

function autoVerdictSuggestion() {
  var decisions = Object.values(state.decisions).filter(Boolean);
  var changes = decisions.filter(function(d) { return d === 'changes'; }).length;
  var approved = decisions.filter(function(d) { return d === 'approved'; }).length;
  if (changes === 0 && approved === state.sections.length) return 'approved';
  if (changes > 0 && changes < state.sections.length / 2) return 'approved-with-conditions';
  return 'rejected';
}
```

### Progress bar label

Use section titles instead of "Q1 of N" — reinforces that the approver is walking through plan structure, not answering questions.

---

## Form Generation Protocol

When asked to generate a plan approval form:

1. **Parse the plan** — extract sections (title + content). If the plan is provided as text, split by headers. If it's a file, read it.
2. **Set `state.sections`** — one entry per plan section. Include section title and full content text.
3. **Generate the HTML** using the canonical intake-form skeleton, substituting:
   - `layout-wizard` with the step-per-section approval layout
   - Each step = one plan section + decision bar + feedback textarea
   - Final step = verdict summary
4. **Configure export** using the payload contract above
5. **Open/save** as `app/stage/_sandbox/<plan-slug>-approval.html` or wherever appropriate

---

## Integration with Plan Review Workflow

```
spec-shaping (generate spec)
       ↓
plan-founder-review (technical review — automated)
       ↓
intake-form/plan-approval (human approval — this submodule)
       ↓
execution agents (proceed / revise / reject)
```

The `plan-founder-review` skill produces a **APPROVE/REVISE/REJECT** verdict from a technical lens. This submodule produces a verdict from the **human stakeholder lens**. Both are needed before execution when stakes are high.

---

## Anti-Patterns

| Anti-pattern | Why it fails |
|---|---|
| Gating feedback textarea behind "Request Changes" | Reduces feedback quality — approvers with notes don't always want to flag a section as problematic |
| Requiring a decision on every section before proceeding | Blocks approvers who want to read first, decide later |
| Collapsing section content into a summary | Approver can't evaluate what they can't see — show full content |
| Mixing approval form with intake questions | Different interaction modes; keep separate |
| No auto-verdict suggestion | Forces approver to reason from scratch on final verdict; pre-suggest from section decisions |
| Export without per-section feedback | Agents need section-level detail, not just overall verdict |
