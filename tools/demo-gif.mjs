#!/usr/bin/env node
// Regenerates docs/demo.gif: builds test-specs/decision-brief.json into a scratch
// dir (with a scratch record store, so the real store is untouched), walks the
// decision flow in Chromium, and encodes the frames with ffmpeg.
// usage: node demo-gif.mjs [--out ../docs/demo.gif] [--keep]
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const outIdx = argv.indexOf('--out');
const OUT = resolve(outIdx >= 0 ? argv[outIdx + 1] : join(HERE, '..', 'docs', 'demo.gif'));
const KEEP = argv.includes('--keep');
const WIDTH = 900;

const work = await mkdtemp(join(tmpdir(), 'if-demo-gif-'));
const form = join(work, 'decision-brief.html');
execFileSync('node', [join(HERE, 'build.mjs'), join(HERE, '..', 'test-specs', 'decision-brief.json'), '--out', form],
  { env: { ...process.env, INTAKE_FORM_RECORDS: join(work, 'store') }, stdio: 'ignore' });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1120, height: 860 }, deviceScaleFactor: 1 });
await page.goto('file://' + form);
await page.waitForTimeout(400);

const frames = [];
async function shot(hold) {
  const path = join(work, `f${String(frames.length).padStart(2, '0')}.png`);
  await page.waitForTimeout(250);
  await page.screenshot({ path });
  frames.push({ path, hold });
}
const card = page.locator('#layout-wizard');
const pick = text => card.locator('label:visible', { hasText: text }).first().click();
const next = async () => {
  await card.locator('.btn-primary:visible', { hasText: 'Next' }).click();
  await page.evaluate(() => window.scrollTo(0, 0));
};

// 1. A decision with why, stakes and a recommendation; take the recommendation.
await shot(2.6);
await pick('When its tests pass');
await page.evaluate(() => window.scrollBy(0, 220));
await shot(1.4);

// 2. Checkbox: tick the two recommended events.
await next();
await shot(1.2);
await pick('A check fails twice');
await pick('Spend passes the estimate');
await shot(1.4);

// 3. Segmented: none of the options fit, so answer in your own words.
await next();
await shot(1.0);
await card.locator('button:visible, label:visible', { hasText: /^Other$/ }).first().click();
const other = card.locator('textarea.other-input:visible').first();
await other.click();
for (const chunk of ['Only when ', 'something ', 'needs me']) {
  await other.type(chunk, { delay: 15 });
  await shot(0.35);
}
await shot(1.4);

// 4. Review & export: the export names the form and how to file the answers.
await page.locator('#topbar-review-btn').click();
await page.waitForTimeout(400);
await page.evaluate(() => window.scrollTo(0, 0));
await shot(1.8);
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
await shot(1.6);
const root = resolve(HERE, '..');
await page.evaluate(root => {
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (w.nextNode()) if (w.currentNode.nodeValue.includes(root))
    w.currentNode.nodeValue = w.currentNode.nodeValue.split(root).join('~/.claude/skills/intake-form');
  for (const el of document.querySelectorAll('textarea')) if (el.value.includes(root))
    el.value = el.value.split(root).join('~/.claude/skills/intake-form');
}, root);
await page.evaluate(() => {
  for (const el of document.querySelectorAll('pre, textarea, .export-box, [class*="export"]'))
    if (el.offsetParent && el.scrollHeight > el.clientHeight + 4) el.scrollTop = el.scrollHeight;
});
await shot(4.0);
await browser.close();

const list = frames.map(f => `file '${f.path}'\nduration ${f.hold}`).join('\n') + `\nfile '${frames.at(-1).path}'\n`;
await writeFile(join(work, 'frames.txt'), list);
const palette = join(work, 'palette.png');
const scale = `scale=${WIDTH}:-1:flags=lanczos`;
execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', join(work, 'frames.txt'),
  '-vf', `${scale},palettegen=stats_mode=diff`, palette]);
execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', join(work, 'frames.txt'),
  '-i', palette, '-lavfi', `${scale}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`, '-loop', '0', OUT]);
console.log(`[demo-gif] wrote ${OUT} (${frames.length} frames)${KEEP ? `; frames kept in ${work}` : ''}`);
if (!KEEP) await rm(work, { recursive: true, force: true });
