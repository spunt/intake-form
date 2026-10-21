// The intake-form record layer.
//
// Two layers, written by one step (tools/record.mjs):
//   1. Per project: <project>/.decisions/YYYY-MM-DD-<slug>.md, human-readable
//      decisions of record. Gitignored by default (the folder ignores itself).
//   2. Cross-project store: every form and every answer, for reference when
//      writing later forms and for improving the skill. Local only; never
//      committed, never sent anywhere.
import { appendFile, mkdir, readFile, readdir, writeFile, access, stat } from 'node:fs/promises';
import { constants as FS, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { SKILL_ROOT, FORM_ID_RE } from './build-form.mjs';
import { parseExport, OTHER_VALUE, SKIP_REASONS, CRITIQUE_KINDS } from './parse-export.mjs';

export const RECORD_SCRIPT = join(SKILL_ROOT, 'tools', 'record.mjs');

const STORE_README = `# intake-form interaction record (private)

Every intake form built with tools/build.mjs and every answer recorded with
tools/record.mjs, across all projects on this machine. Read it before writing a
form (don't re-ask what is decided; calibrate recommendation confidence) and in
skill-improvement work (\`node tools/record.mjs stats\`).

This folder can hold work content. Keep it local: never commit it, never upload
it, and don't copy it into another knowledge base without the owner's yes.

Layout: index.jsonl (one line per event), forms/<form-id>/{spec.json, meta.json,
answers.json, exports/*.txt}.
`;

async function exists(p) {
  try { await access(p); return true; } catch { return false; }
}

async function writable(dir) {
  try { await access(dir, FS.W_OK); return true; } catch { return false; }
}

// Where the store lives, in priority order:
//   1. $INTAKE_FORM_RECORDS
//   2. <skill-dir>/.records/ when the skill is a git checkout (gitignored there;
//      a plugin cache gets replaced on update, a checkout does not)
//   3. $XDG_STATE_HOME/intake-form/records (default ~/.local/state/…)
export async function storeDir() {
  if (process.env.INTAKE_FORM_RECORDS) return resolve(process.env.INTAKE_FORM_RECORDS);
  if (await exists(join(SKILL_ROOT, '.git')) && await writable(SKILL_ROOT)) {
    return join(SKILL_ROOT, '.records');
  }
  const state = process.env.XDG_STATE_HOME || join(homedir(), '.local', 'state');
  return join(state, 'intake-form', 'records');
}

async function ensureStore() {
  const dir = await storeDir();
  await mkdir(join(dir, 'forms'), { recursive: true });
  if (!(await exists(join(dir, 'README.md')))) await writeFile(join(dir, 'README.md'), STORE_README);
  return dir;
}

export async function skillVersion() {
  try {
    const p = JSON.parse(await readFile(join(SKILL_ROOT, '.claude-plugin', 'plugin.json'), 'utf8'));
    return p.version || null;
  } catch { return null; }
}

// The nearest existing ancestor's git root (a form's folder may not exist yet).
export function projectRoot(dir) {
  dir = resolve(dir);
  while (!existsSync(dir) && dirname(dir) !== dir) dir = dirname(dir);
  try {
    return execFileSync('git', ['-C', dir, 'rev-parse', '--show-toplevel'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return resolve(dir);
  }
}

export function slugify(s, max = 48) {
  const slug = String(s || 'form').toLowerCase()
    .replace(/\.html?$/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/, '');
  return slug || 'form';
}

export function localDate(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function stamp(d = new Date()) {
  return d.toISOString().replace(/[:.]/g, '-');
}

export function makeFormId({ outPath, date = localDate(), slugSource }) {
  // The id leads with a date, so drop dates already in the file name.
  const source = String(slugSource || basename(outPath || 'form')).replace(/[-_]?\d{4}-\d{2}-\d{2}[-_]?/g, '-');
  const slug = slugify(source);
  const hash = createHash('sha1').update(resolve(outPath || slug)).digest('hex').slice(0, 6);
  const id = `${date}-${slug}-${hash}`;
  if (!FORM_ID_RE.test(id)) throw new Error(`generated form id is invalid: ${id}`);
  return id;
}

export function recordCommand() {
  return `node "${RECORD_SCRIPT}"`;
}

function formDir(store, id) {
  if (!FORM_ID_RE.test(id)) throw new Error(`invalid form id: ${JSON.stringify(id)}`);
  return join(store, 'forms', id);
}

async function readJson(p, fallback = null) {
  try { return JSON.parse(await readFile(p, 'utf8')); } catch { return fallback; }
}

async function appendIndex(store, event) {
  await appendFile(join(store, 'index.jsonl'), JSON.stringify(event) + '\n');
}

export async function listMetas() {
  const store = await storeDir();
  const forms = join(store, 'forms');
  if (!(await exists(forms))) return [];
  const out = [];
  for (const id of (await readdir(forms)).sort()) {
    const meta = await readJson(join(forms, id, 'meta.json'));
    if (meta) out.push(meta);
  }
  return out;
}

export async function loadForm(id) {
  const store = await storeDir();
  const dir = formDir(store, id);
  const meta = await readJson(join(dir, 'meta.json'));
  if (!meta) return null;
  const spec = await readJson(join(dir, 'spec.json'));
  const answers = await readJson(join(dir, 'answers.json'));
  return { meta, spec, answers, dir };
}

// Called by build.mjs before it renders: assigns a form id (reusing the id of an
// unanswered form built to the same path, so a rebuild is a revision rather than
// a new form) and returns the spec with `record` set.
export async function registerForm(spec, { outPath, cwd = process.cwd(), source = 'build', id: wantId, date } = {}) {
  const store = await ensureStore();
  const absOut = resolve(outPath);
  const project = source === 'import' ? resolve(cwd) : projectRoot(dirname(absOut));
  const metas = await listMetas();
  const prior = metas.filter((m) => m.out === absOut && (m.status === 'asked' || m.formId === wantId)).pop();
  const id = prior ? prior.formId : (wantId || makeFormId({ outPath: absOut, date }));
  const dir = formDir(store, id);
  await mkdir(dir, { recursive: true });
  const now = new Date().toISOString();
  const recorded = { ...spec, record: { id, command: recordCommand() } };
  const meta = {
    formId: id,
    title: spec.title || spec.exportTitle || basename(absOut),
    project,
    out: absOut,
    cwd: resolve(cwd),
    source,
    skillVersion: await skillVersion(),
    status: 'asked',
    created: prior ? prior.created : now,
    updated: now,
    revisions: prior ? (prior.revisions || 1) + 1 : 1,
    questionCount: countQuestions(spec),
  };
  await writeFile(join(dir, 'spec.json'), JSON.stringify(recorded, null, 2));
  await writeFile(join(dir, 'meta.json'), JSON.stringify(meta, null, 2));
  await appendIndex(store, { ts: now, event: prior ? 'revised' : 'asked', formId: id, title: meta.title, project, out: absOut, skillVersion: meta.skillVersion });
  return { id, spec: recorded, meta, store };
}

function countQuestions(spec) {
  let n = 0;
  for (const sec of spec.sections || []) {
    for (const q of sec.questions || []) {
      if (q && q.type !== 'narrative-card' && q.type !== 'embedded-media') n++;
    }
  }
  return n;
}

export function extractSpecFromHtml(html) {
  const m = html.match(/<script id="form-spec" type="application\/json">\s*([\s\S]*?)\s*<\/script>/);
  if (!m) throw new Error('no <script id="form-spec"> block found in the HTML');
  return JSON.parse(m[1]);
}

export async function loadSpecFile(p) {
  const raw = await readFile(p, 'utf8');
  return /\.html?$/i.test(p) ? extractSpecFromHtml(raw) : JSON.parse(raw);
}

// ── Recording an answered form ──

export async function recordExport(text, opts = {}) {
  const store = await ensureStore();
  let spec = opts.spec || null;
  let meta = null;
  const head = String(text).match(/^Form id: (\S+)\s*$/m);
  const formId = opts.formId || (head && head[1]) || null;
  if (formId) {
    const loaded = await loadForm(formId);
    if (loaded) { meta = loaded.meta; spec = spec || loaded.spec; }
  }
  if (!spec) {
    throw new Error(formId
      ? `form ${formId} is not in the record at ${store}; pass --form <form.html|spec.json>`
      : 'this export has no "Form id:" line (built before v1.5.0 or without build.mjs); pass --form <form.html|spec.json>');
  }
  const parsed = parseExport(text, spec);
  const id = formId || makeFormId({ outPath: opts.formPath || spec.title || 'form', slugSource: opts.slug || spec.title });
  const now = new Date();
  const project = resolve(opts.project || (meta && meta.project) || projectRoot(process.cwd()));
  meta = {
    formId: id,
    title: (meta && meta.title) || spec.title || parsed.title,
    project,
    out: (meta && meta.out) || (opts.formPath ? resolve(opts.formPath) : null),
    source: (meta && meta.source) || opts.source || 'record',
    skillVersion: (meta && meta.skillVersion) || null,
    created: (meta && meta.created) || now.toISOString(),
    revisions: (meta && meta.revisions) || 1,
    questionCount: countQuestions(spec),
    ...(meta || {}),
    status: 'answered',
    answeredAt: opts.answeredAt || now.toISOString(),
    updated: now.toISOString(),
    recordedBySkillVersion: await skillVersion(),
  };
  meta.project = project;
  const summary = summarize(parsed);
  meta.summary = summary;

  const decisionsPath = opts.decisions === false ? null
    : join(project, '.decisions', `${meta.answeredAt.slice(0, 10)}-${slugify(id.replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/-[0-9a-f]{6}$/, ''))}.md`);
  const md = renderDecisions({ spec, parsed, meta, store });

  if (opts.dryRun) return { id, meta, parsed, decisionsPath, markdown: md, store, dryRun: true };

  const dir = formDir(store, id);
  await mkdir(join(dir, 'exports'), { recursive: true });
  const exportFile = join(dir, 'exports', `${stamp(now)}.txt`);
  await writeFile(exportFile, text);
  if (!(await exists(join(dir, 'spec.json')))) await writeFile(join(dir, 'spec.json'), JSON.stringify(spec, null, 2));
  await writeFile(join(dir, 'answers.json'), JSON.stringify(parsed, null, 2));
  if (decisionsPath) {
    await writeDecisionsFile(decisionsPath, md);
    meta.decisionsFile = decisionsPath;
  }
  await writeFile(join(dir, 'meta.json'), JSON.stringify(meta, null, 2));
  await appendIndex(store, {
    ts: now.toISOString(), event: 'answered', formId: id, title: meta.title, project,
    decisionsFile: decisionsPath, warnings: parsed.warnings.length, ...summary,
  });
  return { id, meta, parsed, decisionsPath, exportFile, store };
}

// The folder ignores itself, so decisions stay out of commits without editing the
// project's .gitignore. A project that already tracks .decisions/ keeps doing so.
export async function writeDecisionsFile(path, md) {
  const dir = dirname(path);
  if (!(await exists(dir))) {
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, '.gitignore'), '# intake-form decisions of record: local by default.\n# Delete this file to commit them.\n*\n');
  }
  await writeFile(path, md);
}

// For answers kept in a form record.mjs can't parse (hand-written notes, other
// tools' formats): keep the file verbatim so it is still there to read.
export async function attachRawAnswers(id, srcPath, { answeredAt } = {}) {
  const store = await ensureStore();
  const dir = formDir(store, id);
  const meta = await readJson(join(dir, 'meta.json'));
  if (!meta) throw new Error(`no form ${id} in ${store}`);
  await mkdir(join(dir, 'exports'), { recursive: true });
  const dest = join(dir, 'exports', `raw-${basename(srcPath)}`);
  await writeFile(dest, await readFile(srcPath));
  Object.assign(meta, {
    status: 'answered', answersFormat: 'unparsed', answersSource: resolve(srcPath),
    answeredAt: answeredAt || new Date().toISOString(), updated: new Date().toISOString(),
  });
  await writeFile(join(dir, 'meta.json'), JSON.stringify(meta, null, 2));
  await appendIndex(store, { ts: meta.updated, event: 'answered', formId: id, title: meta.title, project: meta.project, answersFormat: 'unparsed' });
  return dest;
}

export function summarize(parsed) {
  const s = {
    questions: 0, answered: 0, skipped: 0, unanswered: 0, untouched: 0, flagged: 0,
    other: 0, notes: 0, recommended: 0, followed: 0, departed: 0, critique: !!parsed.critique,
    byConfidence: {},
  };
  for (const a of Object.values(parsed.answers)) {
    if (a.status === 'not_shown' || a.status === 'missing') continue;
    s.questions++;
    if (a.status in s) s[a.status]++;
    if (a.flag) s.flagged++;
    if (a.note) s.notes++;
    if (a.value === OTHER_VALUE || (Array.isArray(a.value) && a.value.includes(OTHER_VALUE))) s.other++;
    if (a.recommendation && (a.status === 'answered')) {
      s.recommended++;
      const c = a.recommendation.confidence || 'unstated';
      s.byConfidence[c] = s.byConfidence[c] || { followed: 0, departed: 0 };
      if (a.followed === true) { s.followed++; s.byConfidence[c].followed++; }
      if (a.followed === false) { s.departed++; s.byConfidence[c].departed++; }
    }
  }
  return s;
}

// ── Decisions markdown ──

const labelOf = (list, v) => (list.find((x) => x.value === v) || {}).label || v;

function optionLabel(q, v) {
  if (v === OTHER_VALUE) return 'Other';
  if (v === 'not_sure') return 'Not sure';
  const o = (q.options || []).find((x) => String(x.value) === String(v));
  return o ? o.label : String(v);
}

function answerText(q, a) {
  if (a.status === 'skipped') return `(skipped${a.skipReason ? ': ' + labelOf(SKIP_REASONS, a.skipReason) : ''})`;
  if (a.status === 'unanswered') return '(not answered)';
  const v = a.value;
  const withOther = (label, val) => (val === OTHER_VALUE ? `Other: ${a.other || '(no details)'}` : label);
  if (Array.isArray(v)) {
    const sep = q.type === 'priority-rank' ? ' > ' : '; ';
    return v.map((x) => withOther(optionLabel(q, x), x)).join(sep) || '(none)';
  }
  if (v && typeof v === 'object') return `${v.name} (${v.mime}, ${v.size})`;
  if (['radio', 'segmented'].includes(q.type)) {
    return withOther(optionLabel(q, v), v) + (a.conditional ? ` — ${a.conditional}` : '');
  }
  return String(v);
}

function quote(text) {
  return String(text).split('\n').map((l) => `> ${l}`).join('\n');
}

function questionsById(spec) {
  const m = new Map();
  for (const sec of spec.sections || []) {
    for (const q of sec.questions || []) {
      m.set(q.id, q);
      for (const o of q.options || []) if (o && o.branch) m.set(o.branch.id, o.branch);
    }
  }
  return m;
}

export function renderDecisions({ spec, parsed, meta, store }) {
  const qs = questionsById(spec);
  const out = [];
  out.push(`# Decisions: ${meta.title}`, '');
  out.push(`Answered ${meta.answeredAt.slice(0, 10)} in intake form \`${meta.formId}\`. ` +
    'These are decisions of record: a decision not written here is a reason to ask; one written here is not.');
  out.push(`Full record: \`${join(store, 'forms', meta.formId)}/\`. Written by intake-form tools/record.mjs.`, '');
  const s = meta.summary;
  out.push(`Answered ${s.answered} of ${s.questions}; skipped ${s.skipped}; flagged ${s.flagged}; ` +
    `Other ${s.other}; followed ${s.followed} of ${s.recommended} recommendations.`, '');

  if (parsed.critique) {
    out.push('## The respondent said the form asked the wrong questions', '');
    if (parsed.critique.problems.length) out.push(`Problem: ${parsed.critique.problems.map((k) => labelOf(CRITIQUE_KINDS, k)).join('; ')}`, '');
    if (parsed.critique.detail) out.push(quote(parsed.critique.detail), '');
    out.push('Treat the answers below as provisional until the form is redone at the right level.', '');
  }

  const decided = [];
  let section = null;
  for (const sec of spec.sections || []) {
    for (const q0 of sec.questions || []) {
      const ids = [q0.id, ...(q0.options || []).filter((o) => o && o.branch).map((o) => o.branch.id)];
      for (const id of ids) {
        const q = qs.get(id);
        const a = parsed.answers[id];
        if (!q || !a || a.status === 'not_shown' || a.status === 'missing') continue;
        if (q.decidedForYou) { decided.push({ q, a }); continue; }
        if (section !== sec.name) { section = sec.name; out.push(`## ${sec.name || 'Questions'}`, ''); }
        out.push(`### ${q.label || q.title || q.id} \`${a.key}\``, '');
        const ans = answerText(q, a);
        if (ans.includes('\n')) out.push('- **Answer:**', '', quote(ans), '');
        else out.push(`- **Answer:** ${ans}`);
        const authority = a.value === 'not_sure' ? 'open: the respondent is not sure'
          : a.status === 'answered' ? 'respondent'
          : a.status === 'untouched' ? 'unconfirmed default (respondent never moved it)'
          : 'open: not decided';
        out.push(`- **Decided by:** ${authority}`);
        if (a.recommendation) {
          const rv = Array.isArray(a.recommendation.value) ? a.recommendation.value : [a.recommendation.value];
          const verdict = a.followed === true ? 'followed' : a.followed === false ? '**departed**' : 'n/a';
          out.push(`- **Recommended:** ${rv.map((v) => optionLabel(q, v)).join('; ')} ` +
            `(${a.recommendation.confidence || 'confidence not stated'}): ${verdict}`);
        }
        if (a.note) out.push(`- **Note:**`, '', quote(a.note), '');
        if (a.flag) {
          out.push(`- **Flagged as wrong:** ${labelOf(CRITIQUE_KINDS, a.flag.kind)}`);
          if (a.flag.note) out.push('', quote(a.flag.note), '');
        }
        out.push('');
      }
    }
  }

  if (decided.length) {
    out.push('## Decided by the agent without asking', '');
    for (const { q, a } of decided) {
      const reopened = new Set(Array.isArray(a.value) ? a.value.map(String) : []);
      out.push(`From \`${a.key}\` (${q.label || q.id}):`, '');
      for (const o of q.options || []) {
        const r = reopened.has(String(o.value));
        out.push(`- ${o.label}: ${r ? '**reopened by the respondent**' : 'stands (agent call, not reopened)'}`);
      }
      if (reopened.has(OTHER_VALUE)) out.push(`- Respondent added: ${a.other || '(no details)'}`);
      if (a.status === 'skipped') out.push('- The respondent skipped this list; treat every call as unconfirmed.');
      if (a.note) out.push('', quote(a.note));
      out.push('');
    }
  }

  if (parsed.knownContext.length) {
    out.push('## Context the agent stated as known', '');
    for (const l of parsed.knownContext) out.push(`- ${l}`);
    out.push('');
  }
  if (parsed.warnings.length) {
    out.push('## Parser warnings', '', ...parsed.warnings.map((w) => `- ${w}`), '');
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n');
}

// ── Reference and improvement views ──

export async function loadAllAnswered() {
  const store = await storeDir();
  const rows = [];
  for (const meta of await listMetas()) {
    if (meta.status !== 'answered' || meta.answersFormat === 'unparsed') continue;
    const answers = await readJson(join(store, 'forms', meta.formId, 'answers.json'));
    if (answers) rows.push({ meta, answers });
  }
  return rows;
}

export async function computeStats({ project } = {}) {
  const rows = (await loadAllAnswered()).filter((r) => !project || r.meta.project === resolve(project));
  const metas = (await listMetas()).filter((m) => !project || m.project === resolve(project));
  const total = {
    forms: metas.length, answeredForms: rows.length,
    unparsedForms: metas.filter((m) => m.answersFormat === 'unparsed').length,
    unansweredForms: metas.filter((m) => m.status === 'asked').length,
  };
  const agg = { questions: 0, answered: 0, skipped: 0, unanswered: 0, untouched: 0, flagged: 0, other: 0, notes: 0, critiques: 0 };
  const calib = {};
  const departures = [];
  for (const { meta, answers } of rows) {
    const s = summarize(answers);
    for (const k of Object.keys(agg)) if (k in s) agg[k] += s[k];
    if (s.critique) agg.critiques++;
    for (const [c, v] of Object.entries(s.byConfidence)) {
      calib[c] = calib[c] || { followed: 0, departed: 0 };
      calib[c].followed += v.followed;
      calib[c].departed += v.departed;
    }
    for (const a of Object.values(answers.answers)) {
      if (a.followed === false) {
        departures.push({ formId: meta.formId, key: a.key, confidence: a.recommendation.confidence, label: a.label });
      }
    }
  }
  return { total, agg, calib, departures };
}

export async function searchRecords(terms) {
  const needles = terms.map((t) => t.toLowerCase());
  const store = await storeDir();
  const hits = [];
  for (const meta of await listMetas()) {
    const dir = join(store, 'forms', meta.formId);
    const spec = await readJson(join(dir, 'spec.json'), {});
    const answers = await readJson(join(dir, 'answers.json'));
    const matched = [];
    for (const sec of spec.sections || []) {
      for (const q of sec.questions || []) {
        const a = answers && answers.answers[q.id];
        const hay = [q.label, q.why, q.stakes, q.hint, a && a.raw, a && a.note].filter(Boolean).join(' ').toLowerCase();
        if (needles.every((n) => hay.includes(n))) matched.push(q.label || q.id);
      }
    }
    const titleHit = needles.every((n) => String(meta.title).toLowerCase().includes(n));
    if (matched.length || titleHit) hits.push({ meta, matched });
  }
  return hits;
}

export async function fileMtime(p) {
  try { return (await stat(p)).mtime; } catch { return null; }
}
