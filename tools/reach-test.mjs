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

const CSS_ESCAPE = (s) => s.replace(/["\\]/g, '\\$&');

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
    '  7. Every why / stakes / recommendation in the spec is shown before the',
    '     answer controls, at body size and color (not as a muted hint), and a',
    '     recommendation states its confidence and reason.',
    '  8. Every radio, checkbox and segmented question offers one "Other" choice',
    '     with a text field (unless "other": false), and the typed text reaches',
    '     the export. Choosing a recommended answer (radio, checkbox, segmented,',
    '     and inside a branch) is marked as following it; ticking only part of a',
    '     recommended checkbox set is marked as a departure.',
    '  9. No open-answer textarea, commentary included, has a character limit',
    '     unless the spec gives maxLengthReason, which the respondent can see.',
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

const specQuestions = spec.sections.flatMap((s) => s.questions);
const displayTypes = new Set(['narrative-card', 'embedded-media']);
const OTHER_VALUE = '__other__';
const otherEligible = (q) => ['radio', 'checkbox', 'segmented'].includes(q.type) &&
  q.other !== false && !(spec.other === false && q.other !== true) &&
  !(q.options || []).some((o) => o && (o.other === true || String(o.value).toLowerCase() === 'other'));

const browser = await chromium.launch();
const consoleErrors = [];
let menuPresets = [];
let toc = null;
let actions = null;
let mobileActions = null;
const decisionFacts = new Map();
const otherRuns = [];
const followRuns = [];
let recRun = null;
let exportText = '';

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

  // 7–9 (v1.4.0). Walk every question through its TOC entry, so each fact is read
  // from the step a respondent would actually see.
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.waitForTimeout(150);
  const openQuestion = async (i) => {
    await page.evaluate((k) => document.querySelectorAll('.toc-item')[k].click(), i);
    await page.waitForTimeout(80);
  };
  for (let i = 0; i < specQuestions.length; i++) {
    const q = specQuestions[i];
    if (displayTypes.has(q.type)) continue;
    await openQuestion(i);
    decisionFacts.set(q.id, await page.evaluate((id) => {
      const step = document.querySelector('.wizard-question.active');
      const w = step && step.querySelector(`.question[data-layout="w"][data-question-id="${CSS.escape(id)}"]`);
      if (!w) return { found: false };
      const visible = (el) => {
        if (!el) return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
      };
      const follows = (a, b) => !!(a && b && (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING));
      const textStyle = (el) => el ? { text: el.textContent, color: getComputedStyle(el).color, size: parseFloat(getComputedStyle(el).fontSize), visible: visible(el) } : null;
      const label = w.querySelector(':scope > .question-label label');
      const why = w.querySelector(':scope > .brief-why');
      const brief = w.querySelector(':scope > .decision-brief');
      const control = w.querySelector('.radio-group, .checkbox-group, .segmented-group, .scale-row, .priority-rank-list, .file-upload-zone, input[type="range"], textarea, input[type="text"]');
      const own = (el) => el.closest('.question') === w;
      return {
        found: true,
        label: textStyle(label),
        why: why ? { ...textStyle(why.querySelector('p')), beforeLabel: label ? follows(why, label) : true } : null,
        brief: brief ? {
          visible: visible(brief),
          beforeControl: control ? follows(brief, control) : true,
          stakes: textStyle(brief.querySelector('.brief-stakes p')),
          recOption: brief.querySelector('.recommendation-option')?.textContent ?? null,
          chip: brief.querySelector('.confidence-chip')?.textContent ?? null,
          because: brief.querySelector('.recommendation-because')?.textContent ?? null,
        } : null,
        badges: [...w.querySelectorAll('.choice-item')].filter(own).map((ci) => ({
          value: ci.querySelector('input')?.value, badge: ci.querySelector('.badge-inferred')?.textContent ?? null,
        })),
        otherControl: [...w.querySelectorAll(`input[value="__other__"], .segmented-btn[data-value="__other__"]`)].filter(own).length,
        otherField: [...w.querySelectorAll('.other-field textarea')].filter(own).length,
        textareas: [...w.querySelectorAll('textarea')].filter(own).map((t) => ({
          kind: t.classList.contains('commentary-input') ? 'commentary'
            : t.classList.contains('other-input') ? 'other'
            : t.closest('.conditional') ? 'conditional'
            : t.dataset.qid === id ? 'answer' : 'flag note',
          maxlength: t.getAttribute('maxlength'),
        })),
        limitReason: [...w.querySelectorAll('.char-limit-reason')].filter(own).map((e) => e.textContent),
      };
    }, q.id));
  }

  // The Other path, end to end: choose it, type, and find the text in the export.
  for (const type of ['radio', 'checkbox', 'segmented']) {
    const i = specQuestions.findIndex((q) => q.type === type && otherEligible(q));
    if (i === -1) continue;
    const q = specQuestions[i];
    await openQuestion(i);
    const sel = `.wizard-question.active .question[data-layout="w"][data-question-id="${q.id}"]`;
    const otherSel = type === 'segmented'
      ? `${sel} .segmented-btn[data-value="${OTHER_VALUE}"]`
      : `${sel} > div > label.choice-item:has(input[value="${OTHER_VALUE}"]), ${sel} > div > div > label.choice-item:has(input[value="${OTHER_VALUE}"])`;
    if (await page.locator(otherSel).count() === 0) {
      otherRuns.push({ q, missing: true });
      continue;
    }
    await page.locator(otherSel).first().click();
    await page.waitForTimeout(60);
    const field = `${sel} > .other-field textarea`;
    const fieldVisible = await page.$eval(field, (t) => t.getBoundingClientRect().height > 0).catch(() => false);
    const text = `reach-test answer for ${q.id}`;
    // Eight lines, so a box that fails to grow when the other layout is shown is visibly clipped.
    if (fieldVisible) await page.fill(field, text + '\nline 2\nline 3\nline 4\nline 5\nline 6\nline 7\nline 8');
    otherRuns.push({ q, fieldVisible, text });
  }

  // The recommendation marker: follow one recommendation and check the export says so.
  const ri = specQuestions.findIndex((q) => q.type === 'radio' && q.recommendation &&
    !otherRuns.some((r) => r.q.id === q.id));
  if (ri !== -1) {
    const q = specQuestions[ri];
    await openQuestion(ri);
    const sel = `.wizard-question.active .question[data-layout="w"][data-question-id="${q.id}"]`;
    await page.click(`${sel} label.choice-item:has(input[value="${CSS_ESCAPE(String(q.recommendation.value))}"])`);
    recRun = { q };
  }

  if (otherRuns.length || recRun) {
    await page.click('#topbar-review-btn');
    await page.waitForTimeout(150);
    exportText = await page.$eval('#export-text', (el) => el.textContent);
  }

  // An answer typed in one layout must be fully visible in the other: the hidden
  // copy used to be measured while display:none and collapse, clipping the text.
  const hasToggle = await page.evaluate(() => {
    const t = document.getElementById('layout-toggle');
    return !!t && !t.hidden;
  });
  const typed = otherRuns.filter((r) => !r.missing && r.fieldVisible);
  if (hasToggle && typed.length) {
    await page.click('#btn-grouped');
    await page.waitForTimeout(150);
    for (const run of typed) {
      run.grouped = await page.evaluate((id) => {
        const t = document.getElementById('if-other-g-' + id);
        return t ? { client: t.clientHeight, scroll: t.scrollHeight } : null;
      }, run.q.id);
    }
    await page.click('#btn-wizard');
    await page.waitForTimeout(150);
  }

  // Follow each recommendation on the Other-run questions (checkbox: first a strict
  // subset, which must still read as a departure), and one recommendation inside a
  // branch follow-up. Each must be marked "[= recommended" in a fresh export.
  const exportNow = async () => {
    await page.click('#topbar-review-btn');
    await page.waitForTimeout(150);
    return page.$eval('#export-text', (el) => el.textContent);
  };
  const choose = async (scope, type, value) => {
    const v = CSS_ESCAPE(String(value));
    if (type === 'segmented') await page.locator(`${scope} .segmented-btn[data-value="${v}"]`).first().click();
    else await page.locator(`${scope} label.choice-item:has(input[value="${v}"])`).first().click();
    await page.waitForTimeout(40);
  };
  for (const run of otherRuns.filter((r) => !r.missing && r.q.recommendation)) {
    const q = run.q;
    const i = specQuestions.indexOf(q);
    const sel = `.wizard-question.active .question[data-layout="w"][data-question-id="${q.id}"]`;
    const recVals = [].concat(q.recommendation.value).map(String);
    await openQuestion(i);
    if (q.type === 'checkbox') {
      await choose(sel, q.type, OTHER_VALUE);
      await choose(sel, q.type, recVals[0]);
      if (recVals.length > 1) {
        followRuns.push({ q, key: q.exportKey || q.id, rec: q.recommendation, expect: 'subset', text: await exportNow() });
        await openQuestion(i);
        for (const v of recVals.slice(1)) await choose(sel, q.type, v);
      }
    } else {
      await choose(sel, q.type, recVals[0]);
    }
    followRuns.push({ q, key: q.exportKey || q.id, rec: q.recommendation, expect: 'follow' });
  }
  const bi = specQuestions.findIndex((q) => q.type === 'radio' &&
    (q.options || []).some((o) => o && o.branch && o.branch.recommendation));
  if (bi !== -1) {
    const q = specQuestions[bi];
    const opt = q.options.find((o) => o && o.branch && o.branch.recommendation);
    const sel = `.wizard-question.active .question[data-layout="w"][data-question-id="${q.id}"]`;
    await openQuestion(bi);
    await choose(sel, 'radio', opt.value);
    const bsel = `${sel} .branch-conditional.visible`;
    await choose(bsel, opt.branch.type, [].concat(opt.branch.recommendation.value)[0]);
    followRuns.push({ q: opt.branch, key: opt.branch.exportKey || opt.branch.id, rec: opt.branch.recommendation, expect: 'follow' });
  }
  if (followRuns.some((f) => f.expect === 'follow')) {
    const text = await exportNow();
    followRuns.filter((f) => f.expect === 'follow').forEach((f) => { f.text = text; });
  }
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

// 7: decision context is shown before the decision, at body size and color. A
// why rendered after the options, or styled like a muted hint, is the "missing
// why" failure in a different form.
const CONFIDENCE = { high: 'High confidence', medium: 'Medium confidence', low: 'Low confidence' };
const bodyText = (t, label) => !!t && !!label && t.visible && t.color === label.color && t.size >= 12;
for (const q of expectedInputs) {
  const f = decisionFacts.get(q.id);
  check(!!f && f.found, `"${q.id}" opens from its TOC entry`);
  if (!f || !f.found) continue;
  if (q.why) {
    check(!!f.why && f.why.visible, `"${q.id}": why is shown`);
    check(!!f.why && f.why.beforeLabel, `"${q.id}": why comes before the question`, 'start with why');
    check(bodyText(f.why, f.label), `"${q.id}": why is body text, not a muted hint`,
      f.why ? `color ${f.why.color} vs label ${f.label?.color}; ${f.why.size}px` : 'missing');
  } else {
    check(!f.why, `"${q.id}": no why block when the spec has none`);
  }
  if (q.stakes || q.recommendation) {
    check(!!f.brief && f.brief.visible, `"${q.id}": decision brief is shown`);
    check(!!f.brief && f.brief.beforeControl, `"${q.id}": decision brief comes before the answer controls`);
  }
  if (q.stakes) {
    check(bodyText(f.brief?.stakes, f.label), `"${q.id}": stakes is body text, not a muted hint`,
      f.brief?.stakes ? `color ${f.brief.stakes.color} vs label ${f.label?.color}; ${f.brief.stakes.size}px` : 'missing');
  }
  if (q.recommendation) {
    check(f.brief?.chip === CONFIDENCE[q.recommendation.confidence], `"${q.id}": recommendation states its confidence`,
      `chip shows ${JSON.stringify(f.brief?.chip)}`);
    check(!!f.brief?.because, `"${q.id}": recommendation states its reason`);
    if (q.type !== 'segmented') {
      for (const v of [].concat(q.recommendation.value).map(String)) {
        const opt = f.badges.find((b) => b.value === v);
        check(!!opt && !!opt.badge, `"${q.id}": recommended option "${v}" is badged`);
      }
    }
  }
}

// 8: every closed question offers "Other" with a text field, unless opted out, and
// the typed answer survives into the export.
for (const q of expectedInputs) {
  const f = decisionFacts.get(q.id);
  if (!f || !f.found || !['radio', 'checkbox', 'segmented'].includes(q.type)) continue;
  const want = otherEligible(q);
  check(f.otherControl === (want ? 1 : 0), `"${q.id}": ${want ? 'offers one' : 'offers no'} automatic Other choice`,
    `found ${f.otherControl}`);
  if (want) check(f.otherField === 1, `"${q.id}": Other has a text field`);
}
for (const run of otherRuns) {
  const key = (run.q.exportKey || run.q.id).toUpperCase();
  if (run.missing) {
    check(false, `"${run.q.id}" (${run.q.type}): the Other choice can be selected`, 'no Other control rendered');
    continue;
  }
  const line = exportText.split('\n').find((l) => l.startsWith(key + ':')) || '';
  check(run.fieldVisible, `"${run.q.id}" (${run.q.type}): choosing Other reveals its text field`);
  check(line.includes(`Other: ${run.text}`), `"${run.q.id}" (${run.q.type}): the Other text reaches the export`,
    `export line: ${JSON.stringify(line)}`);
  const exportLines = exportText.split('\n');
  const after = exportLines[exportLines.indexOf(line) + 1] || '';
  check(/^\s+line 2$/.test(after), `"${run.q.id}" (${run.q.type}): a multi-line answer stays indented under its key`,
    `line after the key: ${JSON.stringify(after)}`);
  if (run.grouped) {
    check(run.grouped.scroll - run.grouped.client <= 2,
      `"${run.q.id}" (${run.q.type}): an answer typed in one layout is not clipped in the other`,
      `grouped box shows ${run.grouped.client}px of ${run.grouped.scroll}px`);
  }
  if (run.q.recommendation) {
    check(line.includes('[≠ recommended'), `"${run.q.id}": an Other answer is marked as departing from the recommendation`,
      `export line: ${JSON.stringify(line)}`);
  }
}
if (recRun) {
  const key = (recRun.q.exportKey || recRun.q.id).toUpperCase();
  const line = exportText.split('\n').find((l) => l.startsWith(key + ':')) || '';
  check(line.includes('[= recommended, ' + CONFIDENCE[recRun.q.recommendation.confidence].toLowerCase() + ']'),
    `"${recRun.q.id}": following the recommendation is marked in the export`, `export line: ${JSON.stringify(line)}`);
}
for (const f of followRuns) {
  const key = f.key.toUpperCase();
  const line = (f.text || '').split('\n').find((l) => l.startsWith(key + ':')) || '';
  if (f.expect === 'subset') {
    check(line.includes('[≠ recommended'), `"${f.q.id}": ticking only part of the recommended set is marked as a departure`,
      `export line: ${JSON.stringify(line)}`);
  } else {
    check(line.includes('[= recommended, ' + CONFIDENCE[f.rec.confidence].toLowerCase() + ']'),
      `"${f.q.id}" (${f.q.type}): choosing the recommended answer is marked as following it`,
      `export line: ${JSON.stringify(line)}`);
  }
}
const recommendable = (q) => ['radio', 'checkbox', 'segmented'].includes(q.type) && q.recommendation;
const specHasRecs = specQuestions.some((q) => recommendable(q) ||
  (q.options || []).some((o) => o && o.branch && recommendable(o.branch)));
const followedChecked = (recRun ? 1 : 0) + followRuns.filter((f) => f.expect === 'follow').length;
check(!specHasRecs || followedChecked > 0, 'a followed recommendation is checked in the export',
  'the spec has recommendations, but no run chose a recommended answer, so the "[= recommended" marker went untested');

// 9: no open answer is capped unless the spec says why, and the respondent sees why.
for (const q of expectedInputs) {
  const f = decisionFacts.get(q.id);
  if (!f || !f.found) continue;
  for (const t of f.textareas) {
    let expected = null;
    if (t.kind === 'answer' && q.maxLength && q.maxLengthReason) expected = String(q.maxLength);
    if (t.kind === 'conditional' && q.conditional?.maxLength && q.conditional?.maxLengthReason) {
      expected = String(q.conditional.maxLength);
    }
    check(t.maxlength === expected, `"${q.id}": ${t.kind} textarea is ${expected ? 'limited to ' + expected : 'uncapped'}`,
      `maxlength=${JSON.stringify(t.maxlength)}`);
  }
  if (q.type === 'textarea' && q.maxLength && q.maxLengthReason) {
    check(f.limitReason.includes(q.maxLengthReason), `"${q.id}": the limit's reason is shown to the respondent`);
  }
}

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
