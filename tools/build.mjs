#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { loadSpec, buildFormHtml } from './lib/build-form.mjs';

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out')            args.out = argv[++i];
    else if (a === '--assets')    args.assets = argv[++i];
    else if (a === '--theme')     args.theme = argv[++i];
    else if (a === '--hue')       args.hue = Number(argv[++i]);
    else if (a.startsWith('--out='))    args.out = a.slice('--out='.length);
    else if (a.startsWith('--assets=')) args.assets = a.slice('--assets='.length);
    else if (a.startsWith('--theme='))  args.theme = a.slice('--theme='.length);
    else if (a.startsWith('--hue='))    args.hue = Number(a.slice('--hue='.length));
    else if (a === '--help' || a === '-h') args.help = true;
    else if (!a.startsWith('--'))          args._.push(a);
  }
  return args;
}

function usage() {
  console.error([
    'usage: build.mjs <spec.json> --out <path/to/form.html> [--assets inline|absolute|relative] [--theme <preset>] [--hue <0-360>]',
    '',
    'Builds a form from a JSON spec and writes it to --out. The spec is validated',
    'first (structure + theme); a bad spec fails here instead of in the browser.',
    '',
    '--assets inline   (default) embed ifbase.css/js — one self-contained, portable file',
    '--assets absolute absolute file:// URLs at the skill root (this machine only)',
    '--assets relative leave relative refs (works only beside the skill files)',
  ].join('\n'));
}

const args = parseArgs(process.argv.slice(2));
if (args.help || args._.length !== 1 || !args.out) {
  usage();
  process.exit(args.help ? 0 : 2);
}

const specPath = args._[0];
const outPath = resolve(args.out);

let spec;
try {
  ({ spec } = await loadSpec(specPath));
} catch (err) {
  console.error(`[build] spec error:\n${err.message}`);
  process.exit(1);
}

const html = await buildFormHtml(spec, {
  assets: args.assets || 'inline',
  theme: args.theme,
  hue: args.hue,
});

await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, html, 'utf8');
console.log(`[build] OK  wrote ${outPath}  (${(html.length / 1024).toFixed(0)} KB, assets=${args.assets || 'inline'})`);
