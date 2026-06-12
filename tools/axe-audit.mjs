#!/usr/bin/env node
import { chromium } from 'playwright';
import { AxeBuilder } from '@axe-core/playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadSpec, writeFormFile, specBasename, SKILL_ROOT } from './lib/build-form.mjs';

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out')        args.out = argv[++i];
    else if (a === '--theme') args.theme = argv[++i];
    else if (a === '--hue')   args.hue = Number(argv[++i]);
    else if (a === '--tags')  args.tags = argv[++i];
    else if (a.startsWith('--theme=')) args.theme = a.slice('--theme='.length);
    else if (a.startsWith('--hue='))   args.hue = Number(a.slice('--hue='.length));
    else if (a.startsWith('--out='))   args.out = a.slice('--out='.length);
    else if (a.startsWith('--tags='))  args.tags = a.slice('--tags='.length);
    else if (a === '--help' || a === '-h') args.help = true;
    else if (!a.startsWith('--'))          args._.push(a);
  }
  return args;
}

function usage() {
  console.error([
    'usage: axe-audit.mjs <spec.json> [--out <dir>] [--theme <preset>] [--hue <0-360>] [--tags <list>]',
    '',
    'Default --tags: wcag2a,wcag2aa,wcag21a,wcag21aa,wcag22aa',
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

const tagList = (args.tags || 'wcag2a,wcag2aa,wcag21a,wcag21aa,wcag22aa').split(',').map((t) => t.trim()).filter(Boolean);

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();
await page.goto(pathToFileURL(formPath).href, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!window.state && document.querySelectorAll('.wizard-question').length > 0);

// Disable all CSS animations and transitions so axe never sees opacity < 1 from entry animations.
// axe's calculateBlendedForegroundColor multiplies fgColor.alpha by ancestor opacity; any
// element mid-animation (e.g. .fade-in on wizard cards) causes fg colors to blend with bg,
// producing wrong fgColor values and false contrast failures.
await page.evaluate(() => {
  const s = document.createElement('style');
  s.textContent = '*, *::before, *::after { animation-duration: 0ms !important; animation-delay: 0ms !important; transition-duration: 0ms !important; transition-delay: 0ms !important; }';
  document.head.appendChild(s);
});

// axe-core 4.x misparses oklch() color values returned by getComputedStyle, causing false
// contrast failures. Fix: monkey-patch window.getComputedStyle so any oklch() token axe reads
// is converted to gamut-mapped sRGB before axe sees it. Handles both .color and .getPropertyValue().
await page.evaluate(() => {
  function oklchToSRGB(L, C, H) {
    const hRad = H * Math.PI / 180;
    const a = C * Math.cos(hRad);
    const b = C * Math.sin(hRad);
    const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
    const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
    const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
    const r  =  4.0767416621*(l_**3) - 3.3077115913*(m_**3) + 0.2309699292*(s_**3);
    const g  = -1.2684380046*(l_**3) + 2.6097574011*(m_**3) - 0.3413193965*(s_**3);
    const bl = -0.0041960863*(l_**3) - 0.7034186147*(m_**3) + 1.7076147010*(s_**3);
    const lin2srgb = x => {
      const c = Math.max(0, Math.min(1, x));
      return c <= 0.0031308 ? 12.92 * c : 1.055 * c**(1/2.4) - 0.055;
    };
    return `rgb(${Math.round(lin2srgb(r)*255)},${Math.round(lin2srgb(g)*255)},${Math.round(lin2srgb(bl)*255)})`;
  }

  function replaceOklch(val) {
    if (typeof val !== 'string' || !val.includes('oklch')) return val;
    return val.replace(/oklch\(\s*([\d.]+%?)\s+([\d.]+%?)\s+([\d.]+)[^)]*\)/gi, (_, L, C, H) => {
      const lv = L.endsWith('%') ? parseFloat(L) / 100 : parseFloat(L);
      // C: 0–0.4 raw or 0%–100% where 100% = 0.4
      const cv = C.endsWith('%') ? parseFloat(C) / 100 * 0.4 : parseFloat(C);
      return oklchToSRGB(lv, cv, parseFloat(H));
    });
  }

  // Layer 1: patch getComputedStyle so axe always reads sRGB values
  const origGCS = window.getComputedStyle;
  window.getComputedStyle = function(el, pseudo) {
    const style = origGCS.call(window, el, pseudo);
    return new Proxy(style, {
      get(target, prop) {
        if (prop === 'getPropertyValue') {
          return (name) => replaceOklch(target.getPropertyValue(name));
        }
        const val = Reflect.get(target, prop);
        if (typeof val === 'function') return val.bind(target);
        return typeof val === 'string' ? replaceOklch(val) : val;
      }
    });
  };

});

const wizardResults = await new AxeBuilder({ page }).withTags(tagList).analyze();

let groupedResults = null;
const hasGrouped = await page.evaluate(() => {
  const t = document.getElementById('layout-toggle');
  return !!t && !t.hidden;
});
if (hasGrouped) {
  await page.click('#btn-grouped');
  await page.waitForTimeout(250);
  groupedResults = await new AxeBuilder({ page }).withTags(tagList).analyze();
}

await browser.close();

function summarize(r) {
  if (!r) return null;
  const byImpact = { critical: 0, serious: 0, moderate: 0, minor: 0, unknown: 0 };
  for (const v of r.violations) byImpact[v.impact || 'unknown']++;
  return {
    violationCount: r.violations.length,
    byImpact,
    incompleteCount: r.incomplete.length,
    passCount: r.passes.length
  };
}

const summary = {
  spec: specPath,
  formHtml: formPath,
  outDir,
  theme: args.theme || null,
  hue: args.hue ?? null,
  tags: tagList,
  wizard: summarize(wizardResults),
  grouped: summarize(groupedResults)
};

await writeFile(join(outDir, 'axe-report.json'),
  JSON.stringify({ summary, wizard: wizardResults, grouped: groupedResults }, null, 2));

const moderatePlus = (summary.wizard?.byImpact.moderate || 0) +
                     (summary.wizard?.byImpact.serious  || 0) +
                     (summary.wizard?.byImpact.critical || 0) +
                     (summary.grouped?.byImpact.moderate || 0) +
                     (summary.grouped?.byImpact.serious  || 0) +
                     (summary.grouped?.byImpact.critical || 0);

const status = moderatePlus === 0 ? 'OK' : 'FAIL';
const wv = summary.wizard?.violationCount ?? 0;
const gv = summary.grouped?.violationCount ?? 0;
console.log(`[axe-audit] ${status}  spec=${specPath}  wizard.violations=${wv}  grouped.violations=${gv}  moderate+=${moderatePlus}  out=${outDir}`);
if (status === 'FAIL') {
  const all = [...(wizardResults?.violations || []), ...(groupedResults?.violations || [])];
  for (const v of all) {
    if (['critical','serious','moderate'].includes(v.impact)) {
      console.error(`  [${v.impact}] ${v.id}: ${v.help}`);
      for (const n of v.nodes.slice(0, 3)) console.error(`    target: ${(n.target || []).join(' ')}`);
    }
  }
  process.exit(1);
}
