#!/usr/bin/env node
// Record an answered intake form, and read the record back.
//
//   record.mjs <export.txt | ->            file the answers (decisions + store)
//   record.mjs import <form.html|spec.json> [--answers <export>] [--project <dir>]
//   record.mjs list [--project <dir>]      forms in the store
//   record.mjs show <form-id>              one form: meta and decisions file
//   record.mjs search <word>...            past forms whose questions or answers match
//   record.mjs stats [--project <dir>]     calibration + response-quality rates
//   record.mjs where                       print the store location
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import {
  storeDir, recordExport, registerForm, loadSpecFile, listMetas, loadForm,
  computeStats, searchRecords, localDate, makeFormId, fileMtime, projectRoot, attachRawAnswers,
} from './lib/records.mjs';

const SUBCOMMANDS = new Set(['import', 'list', 'show', 'search', 'stats', 'where', 'help']);

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const eq = a.indexOf('=');
    const name = a.startsWith('--') ? (eq === -1 ? a.slice(2) : a.slice(2, eq)) : null;
    const val = () => (eq === -1 ? argv[++i] : a.slice(eq + 1));
    if (name === 'form' || name === 'project' || name === 'answers' || name === 'slug' || name === 'date' || name === 'answered-at') args[name] = val();
    else if (name === 'no-decisions') args.noDecisions = true;
    else if (name === 'decisions') args.decisions = true;
    else if (name === 'dry-run') args.dryRun = true;
    else if (name === 'json') args.json = true;
    else if (a === '-h' || name === 'help') args.help = true;
    else args._.push(a);
  }
  return args;
}

const USAGE = `usage:
  record.mjs <export.txt | ->  [--form <form.html|spec.json>] [--project <dir>] [--no-decisions] [--dry-run]
      File an answered form: writes <project>/.decisions/<date>-<slug>.md and the store record.
      "-" reads the export from stdin. --form is needed only for exports without a "Form id:" line.
  record.mjs import <form.html|spec.json> [--answers <export>] [--project <dir>] [--date YYYY-MM-DD] [--decisions]
      Add a form built elsewhere (or before v1.5.0) to the store. Writes no .decisions/ unless --decisions.
  record.mjs list [--project <dir>] [--json]
  record.mjs show <form-id>
  record.mjs search <word>...
  record.mjs stats [--project <dir>] [--json]
  record.mjs where`;

async function readInput(p) {
  if (p === '-') {
    const chunks = [];
    for await (const c of process.stdin) chunks.push(c);
    return Buffer.concat(chunks).toString('utf8');
  }
  return readFile(p, 'utf8');
}

function pct(n, d) {
  return d ? `${Math.round((100 * n) / d)}%` : 'n/a';
}

async function cmdRecord(args) {
  const src = args._[0];
  const text = await readInput(src);
  const spec = args.form ? await loadSpecFile(args.form) : null;
  const res = await recordExport(text, {
    spec, formPath: args.form, project: args.project, decisions: !args.noDecisions,
    dryRun: args.dryRun, slug: args.slug,
  });
  if (res.dryRun) {
    process.stdout.write(res.markdown + '\n');
    console.error(`[record] dry run: would write ${res.decisionsPath || '(no decisions file)'} and store ${res.store}/forms/${res.id}/`);
  } else {
    console.log(`[record] OK  form ${res.id}`);
    if (res.decisionsPath) console.log(`  decisions: ${res.decisionsPath}`);
    console.log(`  store:     ${res.store}/forms/${res.id}/`);
  }
  const s = res.meta.summary;
  console.error(`  ${s.answered}/${s.questions} answered, ${s.skipped} skipped, ${s.flagged} flagged, ` +
    `${s.followed}/${s.recommended} recommendations followed${s.critique ? ', FORM_CRITIQUE present: redo the form first' : ''}`);
  for (const w of res.parsed.warnings) console.error(`  warning: ${w}`);
}

async function cmdImport(args) {
  const formPath = args._[0];
  if (!formPath) throw new Error('import needs a form .html or spec .json');
  const spec = await loadSpecFile(formPath);
  const abs = resolve(formPath);
  const date = args.date || localDate((await fileMtime(abs)) || new Date());
  const project = resolve(args.project || projectRoot(dirname(abs)));
  const already = (await listMetas()).find((m) => m.out === abs);
  if (already && !args.answers) {
    console.log(`[record] already in the store as ${already.formId} (${already.status}); nothing imported`);
    return;
  }
  if (args.answers) {
    const text = await readFile(args.answers, 'utf8');
    const answeredAt = args['answered-at'] || ((await fileMtime(resolve(args.answers))) || new Date()).toISOString();
    const formId = spec.record && spec.record.id ? spec.record.id : (already ? already.formId : makeFormId({ outPath: abs, date }));
    try {
      const res = await recordExport(text, {
        spec, formId, formPath: abs, project, decisions: !!args.decisions, source: 'import', answeredAt,
      });
      const answered = Object.values(res.parsed.answers).filter((a) => a.status === 'answered').length;
      if (answered === 0) throw new Error('no answers matched the spec');
      console.log(`[record] imported ${res.id} (answered: ${answered} parsed; ${res.parsed.warnings.length} parser warnings)`);
      return;
    } catch (err) {
      const { id } = await registerForm(spec, { outPath: abs, cwd: project, source: 'import', id: formId, date });
      const dest = await attachRawAnswers(id, resolve(args.answers), { answeredAt });
      console.log(`[record] imported ${id} (answers kept verbatim, not parsed: ${err.message}) → ${dest}`);
      return;
    }
  }
  const { id } = await registerForm(spec, { outPath: abs, cwd: project, source: 'import', date });
  console.log(`[record] imported ${id} (asked; no answers found)`);
}

async function cmdList(args) {
  let metas = await listMetas();
  if (args.project) metas = metas.filter((m) => m.project === resolve(args.project));
  if (args.json) { console.log(JSON.stringify(metas, null, 2)); return; }
  if (!metas.length) { console.log(`(no forms recorded in ${await storeDir()})`); return; }
  for (const m of metas) {
    console.log(`${m.status.padEnd(9)} ${m.formId}  ${m.title}\n          ${m.project}${m.decisionsFile ? '  → ' + m.decisionsFile : ''}`);
  }
}

async function cmdShow(args) {
  const f = await loadForm(args._[0] || '');
  if (!f) throw new Error(`no form ${args._[0]} in ${await storeDir()}`);
  console.log(JSON.stringify(f.meta, null, 2));
  if (f.meta.decisionsFile) {
    try { console.log('\n' + await readFile(f.meta.decisionsFile, 'utf8')); } catch { console.log('\n(decisions file not found; it may have been moved)'); }
  }
  console.log(`\nfiles: ${f.dir}/`);
}

async function cmdSearch(args) {
  if (!args._.length) throw new Error('search needs at least one word');
  const hits = await searchRecords(args._);
  if (!hits.length) { console.log('(no matches)'); return; }
  for (const h of hits) {
    console.log(`${h.meta.formId}  [${h.meta.status}]  ${h.meta.title}`);
    for (const l of h.matched.slice(0, 8)) console.log(`    · ${l}`);
  }
}

async function cmdStats(args) {
  const st = await computeStats({ project: args.project });
  if (args.json) { console.log(JSON.stringify(st, null, 2)); return; }
  const { total, agg, calib, departures } = st;
  console.log(`Forms: ${total.forms} (${total.answeredForms} answered and parsed, ${total.unparsedForms} answered in another format, ${total.unansweredForms} never answered)`);
  console.log(`Questions shown: ${agg.questions}; skipped ${pct(agg.skipped, agg.questions)}, flagged ${pct(agg.flagged, agg.questions)}, ` +
    `Other ${pct(agg.other, agg.questions)}, noted ${pct(agg.notes, agg.questions)}; FORM_CRITIQUE in ${agg.critiques} form(s)`);
  console.log('\nRecommendation calibration (how often the respondent followed it):');
  for (const c of ['high', 'medium', 'low', 'unstated']) {
    if (!calib[c]) continue;
    const n = calib[c].followed + calib[c].departed;
    console.log(`  ${c.padEnd(8)} followed ${calib[c].followed}/${n} (${pct(calib[c].followed, n)})`);
  }
  if (!Object.keys(calib).length) console.log('  (no answered recommendations yet)');
  if (departures.length) {
    console.log('\nDepartures (where the recommender misjudged):');
    for (const d of departures.slice(-15)) console.log(`  ${d.confidence.padEnd(6)} ${d.key}  ${d.label}  (${d.formId})`);
  }
}

const argv = process.argv.slice(2);
const args = parseArgs(argv);
const sub = SUBCOMMANDS.has(args._[0]) ? args._.shift() : null;
try {
  if (args.help || sub === 'help' || (!sub && !args._.length)) {
    console.log(USAGE);
    process.exit(args.help || sub === 'help' ? 0 : 2);
  }
  if (sub === 'where') console.log(await storeDir());
  else if (sub === 'import') await cmdImport(args);
  else if (sub === 'list') await cmdList(args);
  else if (sub === 'show') await cmdShow(args);
  else if (sub === 'search') await cmdSearch(args);
  else if (sub === 'stats') await cmdStats(args);
  else await cmdRecord(args);
} catch (err) {
  console.error(`[record] error: ${err.message}`);
  process.exit(1);
}
