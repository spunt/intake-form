#!/usr/bin/env node
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadSpec, writeFormFile, specBasename, SKILL_ROOT } from './lib/build-form.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out')        args.out = argv[++i];
    else if (a === '--theme') args.theme = argv[++i];
    else if (a === '--hue')   args.hue = Number(argv[++i]);
    else if (a.startsWith('--theme=')) args.theme = a.slice('--theme='.length);
    else if (a.startsWith('--hue='))   args.hue = Number(a.slice('--hue='.length));
    else if (a.startsWith('--out='))   args.out = a.slice('--out='.length);
    else if (a === '--help' || a === '-h') args.help = true;
    else if (!a.startsWith('--'))           args._.push(a);
  }
  return args;
}

function usage() {
  console.error([
    'usage: render-test.mjs <spec.json> [--out <dir>] [--theme <preset>] [--hue <0-360>]',
    '',
    'Renders the form, captures screenshots (wizard 1280x800, wizard 375x667, grouped 1280x800),',
    'console errors, page errors, the final export text, and cold-render timing.',
    '',
    'Default --out: tools/.last-render/<spec-basename>[-<theme>]/'
  ].join('\n'));
}

const args = parseArgs(process.argv.slice(2));
if (args.help || args._.length !== 1) { usage(); process.exit(args.help ? 0 : 2); }
const specPath = args._[0];

const { spec } = await loadSpec(specPath);
const tmpName = `${specBasename(specPath)}${args.theme ? '-' + args.theme : ''}${args.hue != null ? '-h' + args.hue : ''}`;
const { path: formPath } = await writeFormFile(spec, { theme: args.theme, hue: args.hue, tmpName });

const outDir = resolve(args.out || join(SKILL_ROOT, 'tools', '.last-render', tmpName));
await mkdir(outDir, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 2,
  reducedMotion: 'no-preference'
});
const page = await context.newPage();

const consoleMessages = [];
const pageErrors = [];

page.on('console', (msg) => {
  consoleMessages.push({ type: msg.type(), text: msg.text(), location: msg.location() });
});
page.on('pageerror', (err) => {
  pageErrors.push({ name: err.name, message: err.message, stack: err.stack });
});

const url = pathToFileURL(formPath).href;
const navStart = Date.now();
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!window.state && document.querySelectorAll('.wizard-question').length > 0);
const fcpMs = await page.evaluate(() => {
  const entries = performance.getEntriesByType('paint');
  const fcp = entries.find((e) => e.name === 'first-contentful-paint');
  return fcp ? Math.round(fcp.startTime) : null;
});
const navMs = Date.now() - navStart;

await page.addStyleTag({ content: '*, *::before, *::after { animation-duration: 0s !important; animation-delay: 0s !important; transition-duration: 0s !important; transition-delay: 0s !important; }' });
await page.evaluate(() => Promise.all(document.getAnimations().map((a) => { try { a.finish(); } catch (e) {} return a.finished.catch(() => null); })));
await page.waitForTimeout(40);

await page.screenshot({ path: join(outDir, 'wizard-1280x800.png'), fullPage: false });

await page.setViewportSize({ width: 375, height: 667 });
await page.waitForTimeout(60);
await page.screenshot({ path: join(outDir, 'wizard-375x667.png'), fullPage: false });

await page.setViewportSize({ width: 1280, height: 800 });
await page.waitForTimeout(60);

const hasGrouped = await page.evaluate(() => {
  const t = document.getElementById('layout-toggle');
  return !!t && !t.hidden;
});
if (hasGrouped) {
  await page.click('#btn-grouped');
  await page.waitForTimeout(80);
  await page.screenshot({ path: join(outDir, 'grouped-1280x800.png'), fullPage: false });
  await page.click('#btn-wizard');
  await page.waitForTimeout(60);
}

const stepCount = await page.evaluate(() => document.querySelectorAll('.wizard-question').length);
for (let i = 1; i < stepCount; i++) {
  const advanced = await page.evaluate(() => {
    const active = document.querySelector('.wizard-question.active');
    if (!active) return false;
    const next = active.querySelector('.btn-primary');
    if (!next) return false;
    next.click();
    return true;
  });
  if (!advanced) break;
  await page.waitForTimeout(40);
}

const exportText = await page.evaluate(() => {
  const el = document.getElementById('export-text');
  return el ? el.textContent : '';
});

const errorMessages = consoleMessages.filter((m) => m.type === 'error');
const warningMessages = consoleMessages.filter((m) => m.type === 'warning');

await writeFile(join(outDir, 'console-errors.json'),
  JSON.stringify({ errors: errorMessages, pageErrors, warnings: warningMessages }, null, 2));
await writeFile(join(outDir, 'export.txt'), exportText);
await writeFile(join(outDir, 'render-test.json'), JSON.stringify({
  spec: specPath,
  formHtml: formPath,
  outDir,
  theme: args.theme || null,
  hue: args.hue ?? null,
  firstContentfulPaintMs: fcpMs,
  navigationMs: navMs,
  consoleErrorCount: errorMessages.length,
  pageErrorCount: pageErrors.length,
  consoleWarningCount: warningMessages.length,
  stepCount,
  hasGroupedView: hasGrouped,
  exportLength: exportText.length
}, null, 2));

await browser.close();

const failed = errorMessages.length > 0 || pageErrors.length > 0;
const status = failed ? 'FAIL' : 'OK';
console.log(`[render-test] ${status}  spec=${specPath}  fcp=${fcpMs ?? 'n/a'}ms  nav=${navMs}ms  ` +
  `errors=${errorMessages.length}  pageErrors=${pageErrors.length}  warnings=${warningMessages.length}  ` +
  `steps=${stepCount}  out=${outDir}`);
if (failed) {
  for (const e of pageErrors) console.error('  pageError:', e.message);
  for (const e of errorMessages) console.error('  consoleError:', e.text);
  process.exit(1);
}
