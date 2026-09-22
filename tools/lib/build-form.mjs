import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = resolve(__dirname, '..', '..');
const TEMPLATE_PATH = join(SKILL_ROOT, 'template.html');
const SCHEMA_PATH = join(SKILL_ROOT, 'theme.schema.json');
const TMP_DIR = join(SKILL_ROOT, 'tools', '.tmp');

const SPEC_BLOCK_RE =
  /(<script id="form-spec" type="application\/json">\s*)([\s\S]*?)(\s*<\/script>)/;

let cachedSchema = null;
async function getSchema() {
  if (!cachedSchema) cachedSchema = JSON.parse(await readFile(SCHEMA_PATH, 'utf8'));
  return cachedSchema;
}

// Hand-rolled theme validator. Covers the schema's actual constraints:
// additionalProperties:false, enum membership, type checks, oneOf for density,
// OKLCH pattern for palette values. Returns { ok, errors }.
export async function validateTheme(theme) {
  const errors = [];
  if (theme === undefined) return { ok: true, errors };
  const schema = await getSchema();
  const props = schema.properties;
  if (theme === null || typeof theme !== 'object' || Array.isArray(theme)) {
    return { ok: false, errors: ['theme must be an object'] };
  }
  for (const k of Object.keys(theme)) {
    if (!(k in props)) {
      errors.push(`theme: unknown key "${k}" (allowed: ${Object.keys(props).join(', ')})`);
    }
  }
  if ('preset' in theme && !props.preset.enum.includes(theme.preset)) {
    errors.push(`theme.preset: expected one of ${props.preset.enum.join('|')}, got ${JSON.stringify(theme.preset)}`);
  }
  if ('hue' in theme) {
    const v = theme.hue;
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 360) {
      errors.push(`theme.hue: expected number in [0, 360], got ${JSON.stringify(v)}`);
    }
  }
  if ('palette' in theme) {
    const palette = theme.palette;
    const pp = props.palette.properties;
    if (palette === null || typeof palette !== 'object' || Array.isArray(palette)) {
      errors.push('theme.palette: must be an object');
    } else {
      for (const k of Object.keys(palette)) {
        if (!(k in pp)) {
          errors.push(`theme.palette: unknown key "${k}" (allowed: ${Object.keys(pp).join(', ')})`);
          continue;
        }
        const v = palette[k];
        if (typeof v !== 'string' || !/^oklch\(/.test(v)) {
          errors.push(`theme.palette.${k}: must be an OKLCH string (got ${JSON.stringify(v)})`);
        }
      }
    }
  }
  if ('typography' in theme) {
    const ty = theme.typography;
    const tp = props.typography.properties;
    if (ty === null || typeof ty !== 'object' || Array.isArray(ty)) {
      errors.push('theme.typography: must be an object');
    } else {
      for (const k of Object.keys(ty)) {
        if (!(k in tp)) errors.push(`theme.typography: unknown key "${k}" (allowed: ${Object.keys(tp).join(', ')})`);
      }
      if ('display' in ty && !tp.display.enum.includes(ty.display)) {
        errors.push(`theme.typography.display: expected one of ${tp.display.enum.join('|')}, got ${JSON.stringify(ty.display)}`);
      }
      if ('body' in ty && !tp.body.enum.includes(ty.body)) {
        errors.push(`theme.typography.body: expected one of ${tp.body.enum.join('|')}, got ${JSON.stringify(ty.body)}`);
      }
      if ('scale' in ty) {
        const v = ty.scale;
        if (typeof v !== 'number' || !Number.isFinite(v) || v < 0.85 || v > 1.3) {
          errors.push(`theme.typography.scale: expected number in [0.85, 1.3], got ${JSON.stringify(v)}`);
        }
      }
    }
  }
  if ('motion' in theme) {
    const m = theme.motion;
    const mp = props.motion.properties;
    if (m === null || typeof m !== 'object' || Array.isArray(m)) {
      errors.push('theme.motion: must be an object');
    } else {
      for (const k of Object.keys(m)) {
        if (!(k in mp)) errors.push(`theme.motion: unknown key "${k}" (allowed: ${Object.keys(mp).join(', ')})`);
      }
      if ('intensity' in m && !mp.intensity.enum.includes(m.intensity)) {
        errors.push(`theme.motion.intensity: expected one of ${mp.intensity.enum.join('|')}, got ${JSON.stringify(m.intensity)}`);
      }
      if ('curve' in m && !mp.curve.enum.includes(m.curve)) {
        errors.push(`theme.motion.curve: expected one of ${mp.curve.enum.join('|')}, got ${JSON.stringify(m.curve)}`);
      }
    }
  }
  if ('density' in theme) {
    const v = theme.density;
    const isStr = typeof v === 'string' && ['compact','default','airy'].includes(v);
    const isNum = typeof v === 'number' && Number.isFinite(v) && v >= 0.7 && v <= 1.4;
    if (!isStr && !isNum) {
      errors.push(`theme.density: expected "compact"|"default"|"airy" or number in [0.7, 1.4], got ${JSON.stringify(v)}`);
    }
  }
  if ('voice' in theme && typeof theme.voice !== 'string') {
    errors.push(`theme.voice: must be a string, got ${JSON.stringify(theme.voice)}`);
  }
  return { ok: errors.length === 0, errors };
}

const KNOWN_TYPES = new Set([
  'radio', 'checkbox', 'text', 'textarea', 'scale', 'segmented', 'slider',
  'priority-rank', 'narrative-card', 'embedded-media', 'file-upload',
]);
const OPTION_TYPES = new Set(['radio', 'checkbox', 'segmented']);

// Walk every question in the spec, including branch sub-questions, yielding
// { question, sectionName, viaBranch }. Order matches render order.
function* iterQuestions(spec) {
  const sections = Array.isArray(spec?.sections) ? spec.sections : [];
  for (const section of sections) {
    const name = section?.name;
    const questions = Array.isArray(section?.questions) ? section.questions : [];
    for (const q of questions) {
      yield { question: q, sectionName: name, viaBranch: false };
      const options = Array.isArray(q?.options) ? q.options : [];
      for (const opt of options) {
        if (opt && opt.branch) yield { question: opt.branch, sectionName: name, viaBranch: true };
      }
    }
  }
}

// Structural validator for the whole spec (theme aside). Mirrors validateTheme's
// house style: collect messages, return { ok, errors }. Catches the silent
// structural failures that otherwise only surface as a broken form in a browser.
export function validateSpec(spec) {
  const errors = [];
  if (spec === null || typeof spec !== 'object' || Array.isArray(spec)) {
    return { ok: false, errors: ['spec must be an object'] };
  }
  if (!Array.isArray(spec.sections) || spec.sections.length === 0) {
    errors.push('spec.sections must be a non-empty array');
  }
  const seenIds = new Map();
  for (const { question: q, viaBranch } of iterQuestions(spec)) {
    if (q === null || typeof q !== 'object' || Array.isArray(q)) {
      errors.push('question must be an object');
      continue;
    }
    const where = q.id ? `question "${q.id}"` : `question with label ${JSON.stringify(q.label)}`;
    if (typeof q.id !== 'string' || q.id.length === 0) {
      errors.push(`${where}: id must be a non-empty string`);
    } else if (seenIds.has(q.id)) {
      errors.push(`duplicate question id "${q.id}" (ids must be globally unique across the form, including branch ids)`);
    } else {
      seenIds.set(q.id, true);
    }
    if (!KNOWN_TYPES.has(q.type)) {
      errors.push(`${where}: unknown type ${JSON.stringify(q.type)} (allowed: ${[...KNOWN_TYPES].join(', ')})`);
      continue;
    }
    if (OPTION_TYPES.has(q.type)) {
      if (!Array.isArray(q.options) || q.options.length === 0) {
        errors.push(`${where}: type "${q.type}" requires a non-empty options array`);
      } else if (q.type === 'segmented' && (q.options.length < 2 || q.options.length > 5)) {
        errors.push(`${where}: segmented requires 2–5 options, got ${q.options.length}`);
      }
    }
    if (q.type === 'priority-rank' && (!Array.isArray(q.options) || q.options.length < 2)) {
      errors.push(`${where}: priority-rank requires at least 2 options`);
    }
    if (q.type === 'scale' && !Array.isArray(q.options) && !Array.isArray(q.labels) && !Array.isArray(q.anchors)) {
      errors.push(`${where}: scale requires options, labels, or anchors`);
    }
    if (Array.isArray(q.options)) {
      for (const opt of q.options) {
        if (opt && opt.branch) {
          if (q.type !== 'radio') {
            errors.push(`${where}: branch is only supported on radio options, not "${q.type}"`);
          }
          const nested = Array.isArray(opt.branch.options) &&
            opt.branch.options.some((o) => o && o.branch);
          if (nested) errors.push(`${where}: nested branches are not supported`);
        }
      }
    }
    if (viaBranch && q.type === 'radio' && Array.isArray(q.options) &&
      q.options.some((o) => o && o.branch)) {
      errors.push(`${where}: nested branches are not supported`);
    }
  }
  return { ok: errors.length === 0, errors };
}

export async function loadSpec(specPath) {
  const abs = resolve(specPath);
  const raw = await readFile(abs, 'utf8');
  const spec = JSON.parse(raw);
  if (spec.theme !== undefined) {
    const res = await validateTheme(spec.theme);
    if (!res.ok) {
      const err = new Error(`Invalid spec.theme in ${abs}:\n  - ${res.errors.join('\n  - ')}`);
      err.specPath = abs;
      err.themeErrors = res.errors;
      throw err;
    }
  }
  const structural = validateSpec(spec);
  if (!structural.ok) {
    const err = new Error(`Invalid spec in ${abs}:\n  - ${structural.errors.join('\n  - ')}`);
    err.specPath = abs;
    err.specErrors = structural.errors;
    throw err;
  }
  return { spec, path: abs };
}

// How ifbase.css/js are referenced in the built HTML:
//   'inline'   — embed both files into the HTML (self-contained, portable). Default.
//   'absolute' — absolute file:// URLs at the skill root (styled only while the
//                skill stays put on this machine; used by the render harness).
//   'relative' — leave the template's relative href/src (works only when the form
//                is saved beside the skill files).
const ASSET_MODES = new Set(['inline', 'absolute', 'relative']);

export async function buildFormHtml(spec, opts = {}) {
  const assets = opts.assets || 'inline';
  if (!ASSET_MODES.has(assets)) {
    throw new Error(`build-form: unknown assets mode "${assets}" (allowed: ${[...ASSET_MODES].join(', ')})`);
  }
  const tpl = await readFile(TEMPLATE_PATH, 'utf8');
  const finalSpec = applyOverrides(spec, opts);
  const json = JSON.stringify(finalSpec, null, 2);
  let replaced = tpl.replace(SPEC_BLOCK_RE, (_, open, _body, close) => {
    return `${open}\n${json}\n${close}`;
  });
  if (replaced === tpl) {
    throw new Error('build-form: failed to substitute spec block; template may have drifted');
  }
  replaced = await applyAssets(replaced, assets);
  return replaced;
}

async function applyAssets(html, mode) {
  if (mode === 'relative') return html;
  if (mode === 'absolute') {
    const cssUrl = pathToFileURL(join(SKILL_ROOT, 'ifbase.css')).href;
    const jsUrl = pathToFileURL(join(SKILL_ROOT, 'ifbase.js')).href;
    return html
      .replace('href="ifbase.css"', `href="${cssUrl}"`)
      .replace('src="ifbase.js"', `src="${jsUrl}"`);
  }
  // inline
  const css = await readFile(join(SKILL_ROOT, 'ifbase.css'), 'utf8');
  const js = await readFile(join(SKILL_ROOT, 'ifbase.js'), 'utf8');
  return html
    .replace(
      /<link rel="stylesheet" href="ifbase\.css">/,
      () => `<style>\n${css}\n</style>`,
    )
    .replace(
      /<script src="ifbase\.js"><\/script>/,
      () => `<script>\n${js}\n</script>`,
    );
}

export async function writeFormFile(spec, opts = {}) {
  // The render harness writes to a temp dir and loads via file://; absolute
  // file:// asset URLs are what it has always relied on. Callers can override.
  const html = await buildFormHtml(spec, { assets: 'absolute', ...opts });
  await mkdir(TMP_DIR, { recursive: true });
  const name = (opts.tmpName || `form-${Date.now()}`) + '.html';
  const out = join(TMP_DIR, name);
  await writeFile(out, html, 'utf8');
  return { path: out, html };
}

function applyOverrides(spec, opts) {
  if (!opts.theme && !opts.hue) return spec;
  const next = JSON.parse(JSON.stringify(spec));
  next.theme = next.theme || {};
  if (opts.theme) next.theme.preset = opts.theme;
  if (opts.hue != null) next.theme.hue = Number(opts.hue);
  return next;
}

export { SKILL_ROOT, TEMPLATE_PATH, TMP_DIR };

export function specBasename(specPath) {
  return basename(specPath).replace(/\.json$/i, '');
}
