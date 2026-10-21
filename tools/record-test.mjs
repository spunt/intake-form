#!/usr/bin/env node
// Record gate (v1.5.0).
//
// 1. Round trip: build a form with build.mjs (which registers it), fill it in a real
//    browser, export, file it with ONE record.mjs command, and assert the parsed
//    answers equal the in-browser state: Other text, multi-line notes, skipped and
//    flagged questions, a branch, a conditional, recommendation markers, untouched
//    defaults and the form critique. A paste that lost its trailing spaces or got
//    CRLF line endings must parse identically.
// 2. The .decisions/ file says what was decided and by whom, and its folder keeps
//    itself out of commits (checked with a real `git add`).
// 3. The store can never be committed: nothing under .records/ is tracked, and a
//    real `git add` in a repo carrying this .gitignore stages nothing from it.
// 4. Parser constants match ifbase.js; a rebuild reuses the form id; an export
//    with no form id records with --form.
import { chromium } from 'playwright';
import { mkdtemp, readFile, writeFile, mkdir, readdir, copyFile, rm } from 'node:fs/promises';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { SKILL_ROOT } from './lib/build-form.mjs';
import { parseExport, SKIP_REASONS, CRITIQUE_KINDS, OTHER_VALUE } from './lib/parse-export.mjs';

const SPEC = join(SKILL_ROOT, 'test-specs', 'record-roundtrip.json');
let failures = 0;
let passes = 0;
function check(ok, label, detail) {
  if (ok) { passes++; return; }
  failures++;
  console.error(`  FAIL ${label}${detail ? `\n       ${detail}` : ''}`);
}

const work = await mkdtemp(join(tmpdir(), 'if-record-'));
const store = join(work, 'store');
const project = join(work, 'project');
await mkdir(project, { recursive: true });
const git = (cwd, ...a) => execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
git(project, 'init', '-q');
git(project, 'config', 'user.email', 't@example.com');
git(project, 'config', 'user.name', 't');
const env = { ...process.env, INTAKE_FORM_RECORDS: store };
const node = (args, opts = {}) => spawnSync(process.execPath, args, { encoding: 'utf8', env, ...opts });

// ── Build (registers) ──
const formPath = join(project, 'forms', 'round-trip.html');
let r = node([join(SKILL_ROOT, 'tools', 'build.mjs'), SPEC, '--out', formPath]);
check(r.status === 0, 'build.mjs succeeds', r.stderr);
const forms1 = await readdir(join(store, 'forms'));
check(forms1.length === 1, 'build registers exactly one form in the store', JSON.stringify(forms1));
const formId = forms1[0];
const meta0 = JSON.parse(await readFile(join(store, 'forms', formId, 'meta.json'), 'utf8'));
check(meta0.status === 'asked', 'a built form is recorded as asked');
check(meta0.project === git(project, 'rev-parse', '--show-toplevel').trim(), 'the form records its project root', meta0.project);
r = node([join(SKILL_ROOT, 'tools', 'build.mjs'), SPEC, '--out', formPath]);
const forms2 = await readdir(join(store, 'forms'));
const meta1 = JSON.parse(await readFile(join(store, 'forms', formId, 'meta.json'), 'utf8'));
check(forms2.length === 1 && meta1.revisions === 2, 'rebuilding an unanswered form to the same path revises it instead of adding a form');
r = node([join(SKILL_ROOT, 'tools', 'build.mjs'), SPEC, '--out', join(work, 'norec.html'), '--no-record']);
check((await readdir(join(store, 'forms'))).length === 1, '--no-record registers nothing');
const norecHtml = await readFile(join(work, 'norec.html'), 'utf8');
check(!norecHtml.includes('"record"'), '--no-record leaves the spec without a record block');

// ── Fill in a real browser ──
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(pathToFileURL(formPath).href);
await page.waitForFunction(() => !!window.state && document.querySelectorAll('.wizard-question').length > 0);
await page.click('#btn-grouped');
const G = '#layout-grouped';
const Q = (id) => `${G} .question[data-question-id="${id}"]`;
const pick = (id, v) => page.locator(`${Q(id)} label.choice-item:has(input[value="${v}"])`).first().click();

const TEXT = {
  depOther: 'Neither: a hash of the spec\nwith a second line',
  note: '  (aside) First paragraph of the note.\n\nSecond paragraph after a blank line.\n   indented line kept',
  where: '~/notes/decisions',
  branch: 'The work ones: they matter most',
  multiOther: 'show | where\nand a second line',
  txt: 'hello: world | not a key',
  essay: 'para one\n\npara two\n  indented line\nKEY_LIKE: not a new key\n--- Context already known ---\n',
  flagNote: 'Ask about the backfill instead\nnot the count',
  critique: 'Mostly right, but too many questions.\n\nCut the shapes section.',
};

await pick('pick_rec', 'skill');
await page.fill(`${Q('pick_rec')} textarea.commentary-input`, TEXT.note);
await pick('pick_dep', OTHER_VALUE);
await page.fill(`${Q('pick_dep')} textarea.other-input`, TEXT.depOther);
await pick('reveal', 'elsewhere');
await page.fill(`${Q('reveal')} input[data-qid="reveal_other"]`, TEXT.where);
await pick('branchy', 'yes');
await page.fill(`${Q('branchy')} input[data-qid="branch_which"]`, TEXT.branch);
await pick('multi', 'list');
await pick('multi', 'stats');
await pick('multi', OTHER_VALUE);
await page.fill(`${Q('multi')} textarea.other-input`, TEXT.multiOther);
await pick('decided', 'jsonl');
await page.locator(`${Q('seg')} .segmented-btn[data-value="fail"]`).first().click();
await page.locator(`${Q('sc')} .scale-btn[data-scale-val="4"]`).first().click();
await page.locator(`${Q('rank')} button[aria-label="Move Decisions down"]`).first().click();
await page.fill(`${Q('txt')} input[data-qid="txt"]`, TEXT.txt);
await page.fill(`${Q('essay')} textarea[data-qid="essay"]`, TEXT.essay);
await page.locator(`${Q('attach')} input[type="file"]`).first().setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('old notes\nKEY: not a key\n') });
await page.waitForFunction(() => !!window.state.attach);
await page.locator(`${Q('skipme')} .skip-btn`).first().click();
await page.locator(`${Q('skipme')} .skip-reason-btn[data-reason="dont_know"]`).first().click();
await pick('flagme', 'not_sure');
await page.locator(`${Q('flagme')} .flag-btn`).first().click();
await page.locator(`${Q('flagme')} .flag-kind-btn[data-kind="too_specific"]`).first().click();
await page.fill(`${Q('flagme')} textarea.flag-note`, TEXT.flagNote);
await page.evaluate(() => window.openCritique());
await page.locator('#critique-panel .critique-kind-btn', { hasText: 'Too specific' }).click();
await page.fill('#critique-panel textarea.critique-note', TEXT.critique);
await page.locator('#critique-panel .btn-primary').click();

const browserState = await page.evaluate(() => {
  window.buildExport('export-text-grouped');
  return {
    exportText: document.getElementById('export-text-grouped').textContent,
    state: JSON.parse(JSON.stringify(window.state)),
    skipped: JSON.parse(JSON.stringify(window.skipped)),
    flags: JSON.parse(JSON.stringify(window.flags)),
    touched: JSON.parse(JSON.stringify(window.touched)),
    critique: JSON.parse(JSON.stringify(window.formCritique)),
  };
});
await browser.close();
check(errors.length === 0, 'no console or page errors while filling', errors.join(' | '));

const exportText = browserState.exportText;
check(exportText.split('\n')[1] === `Form id: ${formId}`, 'the export names its form id on the line after the header', exportText.split('\n')[1]);
check(exportText.includes('--- Record this before acting ---') && exportText.includes(`tools/record.mjs" <saved-export-file>`),
  'the export ends with the exact record.mjs command');

// ── Record with one command ──
const exportFile = join(work, 'answers.txt');
await writeFile(exportFile, exportText);
r = node([join(SKILL_ROOT, 'tools', 'record.mjs'), exportFile], { cwd: work });
check(r.status === 0, 'record.mjs <export> succeeds', r.stderr);
const answers = JSON.parse(await readFile(join(store, 'forms', formId, 'answers.json'), 'utf8'));
const metaA = JSON.parse(await readFile(join(store, 'forms', formId, 'meta.json'), 'utf8'));
check(metaA.status === 'answered', 'the store marks the form answered');
check(answers.warnings.length === 0, 'the parser raises no warnings on a v1.5 export', answers.warnings.join(' | '));

// ── Compare to in-browser state ──
const spec = JSON.parse(await readFile(SPEC, 'utf8'));
const allQs = [];
for (const sec of spec.sections) for (const q of sec.questions) {
  allQs.push({ q, branch: false });
  for (const o of q.options || []) if (o.branch) allQs.push({ q: o.branch, branch: true, parent: q, opt: o });
}
const S = browserState.state;
for (const { q, branch, parent, opt } of allQs) {
  const a = answers.answers[q.id];
  check(!!a, `"${q.id}" is in the parsed answers`);
  if (!a) continue;
  if (branch && S[parent.id] !== opt.value) {
    check(a.status === 'not_shown', `"${q.id}": a hidden branch reads as not shown`, a.status);
    continue;
  }
  if (browserState.skipped[q.id]) {
    check(a.status === 'skipped', `"${q.id}": skipped`, a.status);
    check(a.skipReason === browserState.skipped[q.id].reason, `"${q.id}": skip reason`, `${a.skipReason} vs ${browserState.skipped[q.id].reason}`);
  } else {
    const v = S[q.id];
    const empty = v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length);
    const untouched = (q.type === 'slider' || q.type === 'priority-rank') && !browserState.touched[q.id];
    const want = untouched ? 'untouched' : empty ? 'unanswered' : 'answered';
    check(a.status === want, `"${q.id}": status ${want}`, a.status);
    if (!empty && q.type === 'file-upload') {
      const [head, ...rest] = String(v).split('\n');
      const m = head.match(/^\[(.+) \| (.+) \| (.+)\]$/);
      check(!!m && isDeepStrictEqual(a.value, { name: m[1], mime: m[2], size: m[3], dataUrlLength: rest.join('\n').length }),
        `"${q.id}": file upload round-trips (name, type, size, full data URL)`, JSON.stringify(a.value));
    } else if (!empty) {
      const got = Array.isArray(a.value) ? a.value : a.value;
      check(isDeepStrictEqual(got, Array.isArray(v) ? v.map(String) : (typeof v === 'number' ? v : String(v))),
        `"${q.id}": value equals the browser state`, `${JSON.stringify(got)} vs ${JSON.stringify(v)}`);
    }
    const isOther = Array.isArray(v) ? v.includes(OTHER_VALUE) : v === OTHER_VALUE;
    if (isOther) check(a.other === (S[q.id + '__other'] || '').trim(), `"${q.id}": Other text round-trips`, JSON.stringify(a.other));
    if (q.conditional && v && (q.options.find((o) => o.value === v) || {}).reveals) {
      const ck = q.conditional.stateKey || q.id + '_other';
      check(a.conditional === S[ck], `"${q.id}": conditional text round-trips`, JSON.stringify(a.conditional));
    }
    if (q.recommendation && !empty) {
      const rec = [].concat(q.recommendation.value).map(String);
      const chosen = [].concat(v).map(String);
      const same = rec.length === chosen.length && chosen.every((c) => rec.includes(c));
      check(a.followed === same, `"${q.id}": followed=${same}`, String(a.followed));
    }
  }
  const note = S[q.id + '_commentary'];
  check((a.note || '') === (note || ''), `"${q.id}": commentary round-trips`, `${JSON.stringify(a.note)} vs ${JSON.stringify(note)}`);
  const fl = browserState.flags[q.id];
  check(isDeepStrictEqual(a.flag || null, fl ? { kind: fl.kind, note: fl.note || '' } : null), `"${q.id}": flag round-trips`, JSON.stringify(a.flag));
}
check(isDeepStrictEqual(answers.critique, { problems: browserState.critique.kinds, detail: browserState.critique.note }),
  'form critique round-trips', JSON.stringify(answers.critique));
check(isDeepStrictEqual(answers.knownContext, spec.knownContext), 'known context round-trips');
// Coverage: the run must exercise every shape the acceptance criteria name.
const shapes = {
  other: Object.values(answers.answers).some((a) => a.other),
  multiLineNote: Object.values(answers.answers).some((a) => (a.note || '').includes('\n\n')),
  skipped: Object.values(answers.answers).some((a) => a.status === 'skipped'),
  flagged: Object.values(answers.answers).some((a) => a.flag && a.flag.note.includes('\n')),
  branch: answers.answers.branch_which.status === 'answered',
  followed: Object.values(answers.answers).some((a) => a.followed === true),
  departed: Object.values(answers.answers).some((a) => a.followed === false),
  untouched: Object.values(answers.answers).some((a) => a.status === 'untouched'),
  fileUpload: answers.answers.attach.status === 'answered',
  answerEndingInNewline: String(answers.answers.essay.value).endsWith('\n'),
  answerAfterFileUpload: answers.answers.skipme.status === 'skipped',
  critique: !!answers.critique,
};
for (const [k, v] of Object.entries(shapes)) check(v, `round trip covers: ${k}`);

// ── Damaged pastes parse identically ──
const strip = (o) => JSON.parse(JSON.stringify(o, (k, v) => (k === 'raw' ? undefined : v)));
const trimmed = exportText.split('\n').map((l) => l.replace(/\s+$/, '')).join('\n');
const crlf = exportText.replace(/\n/g, '\r\n');
const pTrim = parseExport(trimmed, JSON.parse(await readFile(join(store, 'forms', formId, 'spec.json'), 'utf8')));
const pCrlf = parseExport(crlf, JSON.parse(await readFile(join(store, 'forms', formId, 'spec.json'), 'utf8')));
const trailingFree = (o) => JSON.parse(JSON.stringify(strip(o), (k, v) => (typeof v === 'string' ? v.split('\n').map((l) => l.replace(/\s+$/, '')).join('\n') : v)));
check(isDeepStrictEqual(trailingFree(pTrim.answers), trailingFree(answers.answers)), 'a paste with trailing spaces stripped parses to the same answers');
check(isDeepStrictEqual(strip(pCrlf.answers), strip(answers.answers)), 'a CRLF paste parses to the same answers');

// ── Decisions file ──
const decDir = join(project, '.decisions');
const decFiles = (await readdir(decDir)).filter((f) => f.endsWith('.md'));
check(decFiles.length === 1, 'one .decisions/ entry is written', JSON.stringify(decFiles));
const md = decFiles.length ? await readFile(join(decDir, decFiles[0]), 'utf8') : '';
for (const { q } of allQs) {
  if (q.decidedForYou || q.id === 'branch_which') continue;
  check(md.includes(`\`${q.id.toUpperCase()}\``), `decisions file lists ${q.id}`);
}
check(md.includes('A form id line') && md.includes('**departed**'), 'decisions file shows the recommendation and the departure');
check(md.includes('Inside the skill checkout') && /\(high\): followed/.test(md), 'decisions file shows a followed recommendation with its confidence');
check(md.includes('The index is JSONL: **reopened by the respondent**'), 'a ticked decided-for-you call reads as reopened');
check(md.includes('Nothing is pushed: stands (agent call, not reopened)'), 'an unticked decided-for-you call stands as an agent call');
check(md.includes('open: not decided'), 'skipped and unanswered questions read as open');
check(md.includes('asked the wrong questions'), 'decisions file surfaces the form critique first');
check(md.includes('> Second paragraph after a blank line.'), 'multi-line notes are quoted intact');
check(md.includes(`Full record: \`${join(store, 'forms', formId)}/\``), 'decisions file points at the store record');
git(project, 'add', '-A');
const tracked = git(project, 'ls-files');
check(!tracked.includes('.decisions'), 'a real `git add -A` stages nothing from .decisions/', tracked);
check(tracked.includes('forms/round-trip.html'), 'control: the same `git add -A` did stage the form');

// ── Rebuilding an answered form never overwrites its record ──
r = node([join(SKILL_ROOT, 'tools', 'build.mjs'), SPEC, '--out', formPath]);
const forms3 = (await readdir(join(store, 'forms'))).sort();
const metaKept = JSON.parse(await readFile(join(store, 'forms', formId, 'meta.json'), 'utf8'));
check(forms3.length === 2 && forms3.includes(`${formId}-2`), 'rebuilding an answered form to the same path makes a new form id', JSON.stringify(forms3));
check(metaKept.status === 'answered' && !!metaKept.summary, 'the answered record survives the rebuild', metaKept.status);
await rm(join(store, 'forms', `${formId}-2`), { recursive: true });

// ── Same-day, same-name forms keep separate decisions files ──
{
  const other = join(project, 'other', 'round-trip.html');
  r = node([join(SKILL_ROOT, 'tools', 'build.mjs'), SPEC, '--out', other]);
  const otherId = (await readdir(join(store, 'forms'))).find((f) => f !== formId);
  const otherExport = exportText.replace(`Form id: ${formId}`, `Form id: ${otherId}`);
  await writeFile(join(work, 'other.txt'), otherExport);
  r = node([join(SKILL_ROOT, 'tools', 'record.mjs'), join(work, 'other.txt')], { cwd: work });
  const mds = (await readdir(decDir)).filter((f) => f.endsWith('.md'));
  const firstMd = await readFile(join(decDir, decFiles[0]), 'utf8');
  check(mds.length === 2 && firstMd.includes(`\`${formId}\``), 'a second same-name form answered the same day gets its own decisions file', JSON.stringify(mds));
  await rm(join(store, 'forms', otherId), { recursive: true });
  for (const f of mds) if (f !== decFiles[0]) await rm(join(decDir, f));
}

// ── Index ──
const idx = (await readFile(join(store, 'index.jsonl'), 'utf8')).trim().split('\n').map((l) => JSON.parse(l));
check(idx.some((e) => e.event === 'asked' && e.formId === formId) && idx.some((e) => e.event === 'answered' && e.formId === formId),
  'index.jsonl has the asked and answered events');

// ── A pre-v1.4 export (continuation lines not indented) still parses ──
{
  const old = exportText.split('\n').filter((l) => !l.startsWith('Form id: '))
    .map((l) => l.replace(/^ {16}/, '')).join('\n');
  const p = parseExport(old, spec);
  check((p.answers.pick_rec.note || '').startsWith('  (aside)') && p.answers.pick_rec.note.includes('Second paragraph after a blank line.'),
    'a legacy export with unindented continuation keeps the whole note', JSON.stringify(p.answers.pick_rec.note));
  check(String(p.answers.essay.value).includes('para two') && String(p.answers.essay.value).includes('KEY_LIKE: not a new key'),
    'a legacy export keeps every line of a multi-line answer', JSON.stringify(p.answers.essay.value));
  check(p.warnings.some((x) => x.includes('pre-v1.4 export')), 'legacy continuation is reported as a warning');
}

// ── Views ──
r = node([join(SKILL_ROOT, 'tools', 'record.mjs'), 'stats']);
check(r.status === 0 && /high\s+followed 1\/1/.test(r.stdout) && /medium\s+followed 0\/1/.test(r.stdout), 'stats reports calibration by confidence', r.stdout);
r = node([join(SKILL_ROOT, 'tools', 'record.mjs'), 'search', 'store', 'location']);
check(r.status === 0 && r.stdout.includes(formId), 'search finds the form by question text', r.stdout);
r = node([join(SKILL_ROOT, 'tools', 'record.mjs'), 'where']);
check(r.stdout.trim() === store, 'where honours INTAKE_FORM_RECORDS');

// ── Export without a form id (pre-v1.5) records with --form ──
const legacy = exportText.split('\n').filter((l) => !l.startsWith('Form id: ')).join('\n');
await writeFile(join(work, 'legacy.txt'), legacy);
r = node([join(SKILL_ROOT, 'tools', 'record.mjs'), join(work, 'legacy.txt'), '--no-decisions'], { cwd: work });
check(r.status !== 0 && /--form/.test(r.stderr), 'an export without a form id asks for --form', r.stderr);
r = node([join(SKILL_ROOT, 'tools', 'record.mjs'), join(work, 'legacy.txt'), '--form', SPEC, '--no-decisions', '--project', project], { cwd: work });
check(r.status === 0, 'record.mjs --form records an export without a form id', r.stderr);

// ── Parser constants match the renderer ──
const ifbase = await readFile(join(SKILL_ROOT, 'ifbase.js'), 'utf8');
const pairs = (name) => {
  const block = ifbase.match(new RegExp(`var ${name} = \\[([\\s\\S]*?)\\];`))[1];
  return [...block.matchAll(/value: '([^']+)',\s*label: (?:'([^']*)'|"([^"]*)")/g)].map((m) => ({ value: m[1], label: m[2] ?? m[3] }));
};
check(isDeepStrictEqual(pairs('SKIP_REASONS'), SKIP_REASONS), 'parser SKIP_REASONS match ifbase.js');
check(isDeepStrictEqual(pairs('CRITIQUE_KINDS'), CRITIQUE_KINDS), 'parser CRITIQUE_KINDS match ifbase.js');

// ── The store can never be committed ──
const unsetEnv = { ...process.env };
delete unsetEnv.INTAKE_FORM_RECORDS;
r = spawnSync(process.execPath, [join(SKILL_ROOT, 'tools', 'record.mjs'), 'where'], { encoding: 'utf8', env: unsetEnv });
const defaultStore = r.stdout.trim();
check(defaultStore === join(SKILL_ROOT, '.records'), 'in a git checkout the default store is <skill-dir>/.records', defaultStore);
check(git(SKILL_ROOT, 'ls-files', '--', '.records', '.decisions').trim() === '', 'nothing under .records/ or .decisions/ is tracked in this repo');
let ignored = true;
try { git(SKILL_ROOT, 'check-ignore', '-q', '.records/index.jsonl'); } catch { ignored = false; }
check(ignored, 'this repo ignores .records/');
const guard = join(work, 'guard');
await mkdir(join(guard, '.records', 'forms', 'x'), { recursive: true });
await mkdir(join(guard, '.decisions'), { recursive: true });
await copyFile(join(SKILL_ROOT, '.gitignore'), join(guard, '.gitignore'));
await writeFile(join(guard, '.records', 'index.jsonl'), '{"secret":"work content"}\n');
await writeFile(join(guard, '.records', 'forms', 'x', 'spec.json'), '{}');
await writeFile(join(guard, '.decisions', 'd.md'), '# d');
await writeFile(join(guard, 'README.md'), 'control');
git(guard, 'init', '-q');
git(guard, 'add', '-A');
const explicit = spawnSync('git', ['-C', guard, 'add', '.records'], { encoding: 'utf8' });
const guardTracked = git(guard, 'ls-files');
check(!/\.records|\.decisions/.test(guardTracked), "a real `git add -A` and `git add .records` stage nothing from the store", guardTracked);
check(explicit.status !== 0 && /ignored/.test(explicit.stderr), 'git refuses an explicit `git add .records`', explicit.stderr);
check(guardTracked.includes('README.md'), 'control: the guard repo did stage its README');

if (process.env.KEEP_RECORD_TEST) console.log(`kept ${work}`); else await rm(work, { recursive: true, force: true });
console.log(`[record-test] ${failures ? 'FAIL' : 'OK'}  checks=${passes + failures}  failures=${failures}`);
process.exit(failures ? 1 : 0);
