#!/usr/bin/env node
// Reachability gate.
//
// render-test.mjs and axe-audit.mjs both verify *rendering*: given a spec, does the
// form paint without errors and without accessibility violations. Neither asks whether
// a shipped feature can actually be reached through the UI. Two real bugs slipped past
// both gates for exactly that reason:
//
//   v1.2.0 — kraft/studio shipped in ifbase.css, theme.schema.json, the docs, and the
//            golden exports, but THEME_PRESETS in ifbase.js still listed three, so the
//            two new presets could not be selected in a rendered form.
//   v1.2.x — narrative-card and embedded-media rendered correctly but were filtered out
//            of the sidebar TOC, so the only way to reach them was clicking Next past
//            every question.
//
// This script asserts on the controls themselves, in a real browser.
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadSpec, writeFormFile, specBasename, SKILL_ROOT } from './lib/build-form.mjs';

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') args.help = true;
    else if (a === '--verbose' || a === '-v') args.verbose = true;
    else if (!a.startsWith('--')) args._.push(a);
  }
  return args;
}

function usage() {
  console.error([
    'usage: reach-test.mjs [<spec.json>] [--verbose]',
    '',
    'Asserts that shipped features are reachable through the UI, not merely renderable:',
    '  1. Every theme.schema.json preset enum value has a [data-theme] block in',
    '     ifbase.css AND an entry in the runtime theme menu.',
    '  2. The theme menu contains no preset the schema does not allow.',
    '  3. Every question in the spec — including the display-only types',
    '     (narrative-card, embedded-media) — has a sidebar TOC entry.',
    '  4. No TOC entry exposes a raw question id as its label.',
    '  5. Display-only types are excluded from each section\'s answered/total count.',
    '  6. The global actions (critique, review) are present and visible at desktop',
    '     and mobile widths.',
    '',
    'Default spec: examples/question-type-catalog.json (exercises every question type).'
  ].join('\n'));
}

const args = parseArgs(process.argv.slice(2));
if (args.help) { usage(); process.exit(0); }
if (args._.length > 1) { usage(); process.exit(2); }

const specPath = args._[0] || join(SKILL_ROOT, 'examples', 'question-type-catalog.json');

const failures = [];
const notes = [];
function check(ok, label, detail) {
  if (ok) { if (args.verbose) notes.push(`  ok    ${label}`); }
  else failures.push(`${label}${detail ? ` — ${detail}` : ''}`);
}

// ── Static sources: schema enum, CSS blocks, JS picker list ──────────────────
const schema = JSON.parse(await readFile(join(SKILL_ROOT, 'theme.schema.json'), 'utf8'));
const schemaPresets = schema?.properties?.preset?.enum;
if (!Array.isArray(schemaPresets) || !schemaPresets.length) {
  console.error('[reach-test] FAIL  cannot read properties.preset.enum from theme.schema.json');
  process.exit(1);
}

const css = await readFile(join(SKILL_ROOT, 'ifbase.css'), 'utf8');
const cssPresets = new Set(
  [...css.matchAll(/\[data-theme=["']?([a-z0-9-]+)["']?\]/gi)].map((m) => m[1])
);

// ── Render the form and interrogate the live DOM ─────────────────────────────
const { spec } = await loadSpec(specPath);
const tmpName = `reach-${specBasename(specPath)}`;
const { path: formPath } = await writeFormFile(spec, { tmpName });

const browser = await chromium.launch();
const consoleErrors = [];
let menuPresets = [];
let toc = null;
let actions = null;
let mobileActions = null;

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
  await page.goto(pathToFileURL(formPath).href);
  await page.waitForSelector('.toc-item', { timeout: 10000 });

  // The dropdown only populates its items on build, not on open, but opening it also
  // proves the control is operable rather than merely present in the DOM.
  await page.click('.theme-menu-btn');
  await page.waitForTimeout(200);
  menuPresets = await page.$$eval('.theme-menu-item', (els) =>
    els.filter((e) => e.getBoundingClientRect().width > 0).map((e) => e.dataset.preset)
  );
  await page.keyboard.press('Escape');

  toc = await page.evaluate(() => {
    const items = [...document.querySelectorAll('.toc-item')].map((el) => ({
      label: (el.querySelector('.toc-item-label')?.textContent || '').trim(),
      display: el.classList.contains('is-display'),
      clickable: el.tagName === 'BUTTON' && !el.disabled,
    }));
    const counts = [...document.querySelectorAll('.toc-group')].map((g) => ({
      section: (g.querySelector('.toc-section-name')?.textContent || '').trim(),
      count: (g.querySelector('.toc-count')?.textContent || '').trim(),
      inputs: g.querySelectorAll('.toc-item:not(.is-display)').length,
      displays: g.querySelectorAll('.toc-item.is-display').length,
    }));
    return { items, counts };
  });

  const readActions = () => page.evaluate(() => {
    // "Visible" must mean visible *without scrolling*. A control with a non-zero box
    // can still sit above the fold or inside a display:none ancestor — which is the
    // precise failure being tested, since the old sidebar footer sat below the whole
    // question tree and disappeared with the sidebar below 1100px. Require the element
    // to be within the viewport AND to be the topmost thing at its own centre.
    const onScreen = (el) => {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return false;
      if (r.top < 0 || r.left < 0) return false;
      if (r.bottom > window.innerHeight || r.right > window.innerWidth) return false;
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const hit = document.elementFromPoint(cx, cy);
      return !!hit && (el === hit || el.contains(hit) || hit.contains(el));
    };
    const critique = document.getElementById('toc-critique-btn');
    const review = document.getElementById('topbar-review-btn');
    const name = (el) => (el?.getAttribute('aria-label') || el?.textContent || '').trim();
    return {
      critique: onScreen(critique), review: onScreen(review),
      inTopbar: !!critique?.closest('.topbar') && !!review?.closest('.topbar'),
      critiqueName: name(critique), reviewName: name(review),
    };
  });

  actions = await readActions();
  await page.setViewportSize({ width: 375, height: 700 });
  await page.waitForTimeout(250);
  mobileActions = await readActions();
} finally {
  await browser.close();
}

// ── Assertions ───────────────────────────────────────────────────────────────
const menuSet = new Set(menuPresets);

// 1 + 2: a preset is only shipped if the schema allows it, the CSS implements it, and
// the picker exposes it. Any one of the three missing makes it unusable or a dead enum.
for (const p of schemaPresets) {
  check(cssPresets.has(p) || p === 'default', `preset "${p}" has a [data-theme] block in ifbase.css`,
    'schema allows it but no CSS block implements it');
  check(menuSet.has(p), `preset "${p}" is selectable in the runtime theme menu`,
    'shipped in schema/CSS but missing from THEME_PRESETS in ifbase.js');
}
for (const p of menuPresets) {
  check(schemaPresets.includes(p), `theme menu preset "${p}" is allowed by theme.schema.json`,
    'the picker offers a preset a spec cannot legally request');
}

// 3 + 4 + 5: every question is reachable from the TOC, display-only types included.
const specQuestions = spec.sections.flatMap((s) => s.questions);
const displayTypes = new Set(['narrative-card', 'embedded-media']);
const expectedDisplay = specQuestions.filter((q) => displayTypes.has(q.type));
const expectedInputs = specQuestions.filter((q) => !displayTypes.has(q.type));

check(toc.items.length === specQuestions.length,
  `TOC lists every question (${specQuestions.length})`,
  `spec has ${specQuestions.length} questions but the TOC shows ${toc.items.length}`);

const tocDisplay = toc.items.filter((i) => i.display);
check(tocDisplay.length === expectedDisplay.length,
  `display-only questions appear in the TOC (${expectedDisplay.length})`,
  `spec has ${expectedDisplay.length} display-only question(s) but the TOC marks ${tocDisplay.length}`);

check(toc.items.every((i) => i.clickable), 'every TOC entry is an operable button');

const ids = new Set(specQuestions.map((q) => q.id));
const leaked = toc.items.filter((i) => ids.has(i.label));
check(leaked.length === 0, 'no TOC entry falls back to a raw question id',
  leaked.length ? `id(s) shown as label: ${leaked.map((l) => l.label).join(', ')}` : '');

check(toc.items.every((i) => i.label.length > 0), 'every TOC entry has a non-empty label');

for (const g of toc.counts) {
  const [, total] = (g.count.match(/^(\d+)\s*\/\s*(\d+)$/) || []).slice(1);
  if (total == null) {
    check(false, `section "${g.section}" has a parseable answered/total count`, `got "${g.count}"`);
    continue;
  }
  check(Number(total) === g.inputs,
    `section "${g.section}" counts only answerable questions`,
    `count says /${total} but the section has ${g.inputs} input(s) and ${g.displays} display-only entr(ies)`);
}

// 6: the global actions must survive the breakpoint that hides the sidebar.
check(actions.inTopbar, 'global actions live in the topbar',
  'critique/review are not inside .topbar — a sidebar footer hides with the sidebar below 1100px');
check(actions.critique && actions.review, 'global actions are visible at 1440px');
check(mobileActions.critique && mobileActions.review, 'global actions are visible at 375px',
  'the actions vanish on mobile, which is exactly where the old sidebar footer failed');
check(mobileActions.critiqueName.length > 2 && mobileActions.reviewName.length > 2,
  'global actions keep an accessible name at 375px',
  `labels collapse to glyphs; got "${mobileActions.critiqueName}" / "${mobileActions.reviewName}"`);

check(consoleErrors.length === 0, 'no console or page errors',
  consoleErrors.slice(0, 3).join(' | '));

// ── Report ───────────────────────────────────────────────────────────────────
const status = failures.length ? 'FAIL' : 'OK';
if (args.verbose) notes.forEach((n) => console.log(n));
console.log(
  `[reach-test] ${status}  spec=${specPath}  presets=${schemaPresets.length}` +
  `  toc=${toc.items.length}(${tocDisplay.length} display)  failures=${failures.length}`
);
if (failures.length) {
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
