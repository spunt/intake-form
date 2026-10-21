// Parses the text export that ifbase.js produces back into structured answers.
//
// The export is human-first, so parsing needs the spec: keys map to questions,
// labels map back to option values, and the key column width tells continuation
// lines apart from new keys. Since v1.4.0 the format is unambiguous given the
// spec: every continuation line is indented to the value column, and the
// recommendation marker sits on the key's own line.
import { iterQuestions } from './build-form.mjs';

// Mirrors ifbase.js. tools/record-test.mjs fails if the two drift.
export const SKIP_REASONS = [
  { value: 'not_applicable', label: "Doesn't apply" },
  { value: 'dont_know',      label: "Don't know" },
  { value: 'prefer_not',     label: 'Prefer not to say' },
];
export const CRITIQUE_KINDS = [
  { value: 'wrong_level',    label: 'Wrong level of detail' },
  { value: 'too_specific',   label: 'Too specific / in the weeds' },
  { value: 'underspecified', label: 'Too vague to answer' },
  { value: 'missing_topic',  label: 'Missing the real question' },
  { value: 'irrelevant',     label: 'Not relevant to this work' },
];
export const OTHER_VALUE = '__other__';

const NON_ANSWER_TYPES = new Set(['narrative-card', 'embedded-media']);
const EMPTY_VALUES = new Set(['(not answered)', '(none)', '(no file)', '(not ranked)']);
const BLOCK_HEADER_RE = /^--- (.+?) ---$/;
const UNTOUCHED_RE = /   \[UNTOUCHED DEFAULT — not confirmed by respondent\]$/;
const MARKER_RE = /   \[(?:= recommended, (.+?)|≠ recommended: (.+) \((.+?)\))\]$/;

// Same formula as buildExport: top-level questions only, branches excluded.
export function keyWidthFor(spec) {
  let w = 16;
  for (const sec of spec.sections || []) {
    for (const q of sec.questions || []) {
      if (NON_ANSWER_TYPES.has(q.type)) continue;
      w = Math.max(w, String(q.exportKey || q.id).toUpperCase().length + 7);
    }
  }
  return w;
}

function exportKey(q) {
  return String(q.exportKey || q.id).toUpperCase();
}

function stripIndent(line, width) {
  let n = 0;
  while (n < width && line[n] === ' ') n++;
  return line.slice(n);
}

function otherEnabled(spec, q) {
  if (!['radio', 'checkbox', 'segmented'].includes(q.type)) return false;
  if (q.other === false) return false;
  if (spec.other === false && q.other !== true) return false;
  return !(q.options || []).some((o) => o && (o.other === true || String(o.value).toLowerCase() === 'other'));
}

function matchOption(q, text) {
  const opts = q.options || [];
  const byLabel = opts.find((o) => o && o.label === text);
  if (byLabel) return String(byLabel.value);
  const byValue = opts.find((o) => o && String(o.value) === text);
  if (byValue) return String(byValue.value);
  // The renderer adds "Not sure" to factual questions (exported as its value before v1.5.0).
  if (q.kind === 'factual' && !opts.some((o) => o && o.unsure) && (text === 'Not sure' || text === 'not_sure')) return 'not_sure';
  return null;
}

function parseOther(text) {
  if (text === 'Other (no details given)') return { other: '' };
  if (text.startsWith('Other: ')) return { other: text.slice('Other: '.length) };
  return null;
}

// Split "a | b | c" back into option values. A label may itself contain the
// separator, so prefer the longest run of tokens that is a known label.
function splitLabels(spec, q, text, sep) {
  const tokens = text.split(sep);
  const values = [];
  let other = null;
  const unknown = [];
  let i = 0;
  const longestMatch = (from) => {
    for (let j = tokens.length; j > from; j--) {
      const v = matchOption(q, tokens.slice(from, j).join(sep));
      if (v !== null) return { v, next: j };
    }
    return null;
  };
  while (i < tokens.length) {
    const m = longestMatch(i);
    if (m) { values.push(m.v); i = m.next; continue; }
    if (otherEnabled(spec, q) && parseOther(tokens[i]) && other === null) {
      // Other text runs until the next token that starts a known label.
      let j = i + 1;
      while (j < tokens.length && !longestMatch(j)) j++;
      other = parseOther(tokens.slice(i, j).join(sep)).other;
      values.push(OTHER_VALUE);
      i = j;
      continue;
    }
    unknown.push(tokens[i]);
    i++;
  }
  return { values, other, unknown };
}

function parseValue(spec, q, text, warnings) {
  const key = exportKey(q);
  switch (q.type) {
    case 'radio':
    case 'segmented': {
      const v = matchOption(q, text);
      if (v !== null) return { value: v };
      if (otherEnabled(spec, q)) {
        const o = parseOther(text);
        if (o) return { value: OTHER_VALUE, other: o.other };
      }
      // "Label — conditional text" when a reveals option was chosen.
      if (q.type === 'radio' && q.conditional) {
        for (const opt of q.options || []) {
          if (opt && opt.reveals && text.startsWith(opt.label + ' — ')) {
            return { value: String(opt.value), conditional: text.slice(opt.label.length + 3) };
          }
        }
      }
      warnings.push(`${key}: answer ${JSON.stringify(text)} matches no option; kept as text`);
      return { value: text, unmatched: true };
    }
    case 'checkbox': {
      const { values, other, unknown } = splitLabels(spec, q, text, ' | ');
      if (unknown.length) warnings.push(`${key}: ${unknown.length} item(s) match no option: ${JSON.stringify(unknown)}`);
      const out = { value: values };
      if (other !== null) out.other = other;
      if (unknown.length) out.unmatched = unknown;
      return out;
    }
    case 'priority-rank': {
      const { values, unknown } = splitLabels(spec, q, text, ' > ');
      if (unknown.length) warnings.push(`${key}: ${unknown.length} ranked item(s) match no option`);
      return unknown.length ? { value: values, unmatched: unknown } : { value: values };
    }
    case 'scale':
    case 'slider': {
      const n = Number(text);
      if (!Number.isFinite(n)) {
        warnings.push(`${key}: expected a number, got ${JSON.stringify(text)}`);
        return { value: text, unmatched: true };
      }
      return { value: n };
    }
    case 'file-upload': {
      const [head, ...rest] = text.split('\n');
      const m = head.match(/^\[(.+) \| (.+) \| (.+)\]$/);
      const dataUrl = rest.join('\n');
      return { value: m ? { name: m[1], mime: m[2], size: m[3], dataUrlLength: dataUrl.length } : head };
    }
    default:
      return { value: text };
  }
}

function questionIndex(spec) {
  const byKey = new Map();
  for (const { question: q, sectionName, viaBranch } of iterQuestions(spec)) {
    if (!q || NON_ANSWER_TYPES.has(q.type)) continue;
    byKey.set(exportKey(q), { q, section: sectionName, viaBranch });
  }
  return byKey;
}

function readMarker(line) {
  const m = line.match(MARKER_RE);
  if (!m) return { line, marker: null };
  const marker = m[1] !== undefined
    ? { followed: true, confidence: m[1] }
    : { followed: false, recommendedLabels: m[2], confidence: m[3] };
  return { line: line.slice(0, m.index), marker };
}

// Read "KEY: value" entries plus their continuation lines. A line at column 0
// starts an entry only if its key is one we expect; everything else at column 0
// ends the block. An empty line is a paragraph break inside an entry when the
// next non-empty line is indented (pasting can strip the indent's spaces).
// Lenient mode is for exports from before v1.4.0, whose continuation lines were
// not indented: an unknown column-0 line joins the entry above it.
function readEntries(lines, start, width, isKnownKey, lenient = false, warnings = [], isFileKey = () => false) {
  const entries = [];
  const keyOf = (l) => { const m = l.match(/^([^\s:][^:]*):(.*)$/); return m && isKnownKey(m[1]) ? m : null; };
  const absorbable = (l) => lenient && entries.length > 0 && l.trim() !== '' && !BLOCK_HEADER_RE.test(l.trim()) && !keyOf(l);
  let i = start;
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (line === '' || /^\s+$/.test(line)) {
      let j = i + 1;
      while (j < lines.length && lines[j].trim() === '') j++;
      if (entries.length && j < lines.length && (lines[j].startsWith(' ') || absorbable(lines[j]))) {
        for (let k = i; k < j; k++) entries[entries.length - 1].lines.push('');
        i = j - 1;
        continue;
      }
      // An answer that ends in a newline leaves one indent-only line before the
      // next key; keep the newline and read on.
      if (entries.length && j === i + 1 && j < lines.length && keyOf(lines[j])) {
        entries[entries.length - 1].lines.push('');
        continue;
      }
      break;
    }
    if (line.startsWith(' ')) {
      if (entries.length) entries[entries.length - 1].lines.push(stripIndent(line, width));
      continue;
    }
    const m = keyOf(line);
    if (!m && absorbable(line)) {
      entries[entries.length - 1].lines.push(line);
      warnings.push(`line ${i + 1}: unindented continuation joined to ${entries[entries.length - 1].key} (pre-v1.4 export)`);
      continue;
    }
    if (!m) break;
    const valueStart = Math.max(width, m[1].length + 1);
    const first = line.length > valueStart ? line.slice(valueStart) : m[2].replace(/^ +/, '');
    entries.push({ key: m[1], lines: [first] });
    // A file upload exports "[name | mime | size]" and then its data URL flush left.
    if (isFileKey(m[1]) && /^\[.+ \| .+ \| .+\]$/.test(first) && i + 1 < lines.length) {
      entries[entries.length - 1].lines.push(lines[++i]);
    }
  }
  return { entries, next: i };
}

export function parseExport(text, spec) {
  const warnings = [];
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
  const width = keyWidthFor(spec);
  const index = questionIndex(spec);
  const result = {
    title: null, formId: null, critique: null, answers: {}, order: [],
    knownContext: [], routing: {}, recordFooter: false, warnings,
  };

  let i = lines.findIndex((l) => /^=== .* ===$/.test(l.trim()));
  if (i === -1) throw new Error('not an intake-form export: no "=== … ===" header line');
  result.title = lines[i].trim().replace(/^=== /, '').replace(/ ===$/, '');
  i++;
  const idLine = (lines[i] || '').match(/^Form id: (\S+)\s*$/);
  if (idLine) { result.formId = idLine[1]; i++; }

  const knownKey = (k) => {
    if (index.has(k)) return true;
    const base = k.replace(/_(NOTE|FLAG)$/, '');
    return base !== k && index.has(base);
  };

  let sawAnswers = false;
  while (i < lines.length) {
    const line = lines[i].replace(/\s+$/, '');
    const header = line.match(BLOCK_HEADER_RE);
    if (line === '') { i++; continue; }
    if (header) {
      const name = header[1];
      i++;
      if (name === 'How to read this') {
        while (i < lines.length && lines[i].trim() !== '') i++;
      } else if (name === 'FORM_CRITIQUE (read first)') {
        const { entries, next } = readEntries(lines, i, width, (k) => k === 'PROBLEM' || k === 'DETAIL');
        result.critique = { problems: [], detail: null };
        for (const e of entries) {
          const v = e.lines.join('\n');
          if (e.key === 'PROBLEM') {
            result.critique.problems = v.split(' | ').map((label) => {
              const k = CRITIQUE_KINDS.find((c) => c.label === label);
              return k ? k.value : label;
            });
          } else result.critique.detail = v;
        }
        i = next;
      } else if (name === 'Context already known') {
        while (i < lines.length && lines[i].trim() !== '' && !BLOCK_HEADER_RE.test(lines[i])) {
          result.knownContext.push(lines[i]);
          i++;
        }
      } else if (name === 'Routing suggestion') {
        while (i < lines.length && lines[i].trim() !== '' && !BLOCK_HEADER_RE.test(lines[i])) {
          const m = lines[i].match(/^(.*?)\s*-> (.*)$/);
          if (m) result.routing[m[1]] = m[2];
          i++;
        }
      } else {
        if (name === 'Record this before acting') result.recordFooter = true;
        while (i < lines.length && lines[i].trim() !== '' && !BLOCK_HEADER_RE.test(lines[i])) i++;
      }
      continue;
    }
    if (!sawAnswers) {
      const isFileKey = (k) => index.has(k) && index.get(k).q.type === 'file-upload';
      const { entries, next } = readEntries(lines, i, width, knownKey, !result.formId, warnings, isFileKey);
      if (entries.length) {
        sawAnswers = true;
        applyEntries(entries, spec, index, result);
        i = next;
        continue;
      }
    }
    warnings.push(`line ${i + 1} not understood: ${JSON.stringify(line.slice(0, 80))}`);
    i++;
  }

  // Questions the export never mentions: branch follow-ups that were not shown.
  for (const [key, { q, section, viaBranch }] of index) {
    if (!result.answers[q.id]) {
      result.answers[q.id] = baseAnswer(q, key, section, viaBranch, viaBranch ? 'not_shown' : 'missing');
      if (!viaBranch) warnings.push(`${key}: missing from the export`);
    }
  }
  return result;
}

function baseAnswer(q, key, section, viaBranch, status) {
  return {
    id: q.id, key, type: q.type, label: q.label || q.title || q.id, section,
    viaBranch, status, value: null,
  };
}

function applyEntries(entries, spec, index, result) {
  for (const e of entries) {
    const text = e.lines.join('\n');
    if (index.has(e.key) && !result.answers[index.get(e.key).q.id]) {
      const { q, section, viaBranch } = index.get(e.key);
      result.answers[q.id] = interpretAnswer(spec, q, e.key, section, viaBranch, text, result.warnings);
      result.order.push(q.id);
      continue;
    }
    const sfx = e.key.match(/^(.*)_(NOTE|FLAG)$/);
    const target = sfx && index.get(sfx[1]);
    if (!target) { result.warnings.push(`${e.key}: unexpected key`); continue; }
    const a = result.answers[target.q.id];
    if (!a) { result.warnings.push(`${e.key}: appears before its question`); continue; }
    if (sfx[2] === 'NOTE') a.note = text;
    else {
      const sepAt = text.indexOf(' — ');
      const label = sepAt === -1 ? text : text.slice(0, sepAt);
      const kind = CRITIQUE_KINDS.find((c) => c.label === label);
      a.flag = { kind: kind ? kind.value : label, note: sepAt === -1 ? '' : text.slice(sepAt + 3) };
    }
  }
}

function interpretAnswer(spec, q, key, section, viaBranch, text, warnings) {
  const a = baseAnswer(q, key, section, viaBranch, 'answered');
  a.raw = text;
  const lines = text.split('\n');
  const skip = lines.length === 1 && text.match(/^SKIPPED(?: \((.+)\))?$/);
  if (skip) {
    a.status = 'skipped';
    const r = SKIP_REASONS.find((s) => s.label === skip[1]);
    a.skipReason = r ? r.value : (skip[1] || null);
    return a;
  }
  let body = text;
  if (UNTOUCHED_RE.test(lines[0])) {
    a.status = 'untouched';
    body = [lines[0].replace(UNTOUCHED_RE, ''), ...lines.slice(1)].join('\n');
  }
  // The marker is on the key's line; a file upload appends it after its data URL.
  const markerLineIdx = q.type === 'file-upload' ? lines.length - 1 : 0;
  const bodyLines = body.split('\n');
  const { line: cleaned, marker } = readMarker(bodyLines[markerLineIdx]);
  bodyLines[markerLineIdx] = cleaned;
  body = bodyLines.join('\n');
  if (EMPTY_VALUES.has(body)) {
    a.status = 'unanswered';
    return a;
  }
  Object.assign(a, parseValue(spec, q, body, warnings));
  if (q.recommendation) {
    const rv = q.recommendation.value;
    a.recommendation = {
      value: Array.isArray(rv) ? rv.map(String) : String(rv),
      confidence: q.recommendation.confidence || null,
      because: q.recommendation.because || null,
    };
    a.followed = marker ? marker.followed : null;
  }
  return a;
}
