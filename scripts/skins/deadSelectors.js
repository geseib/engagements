#!/usr/bin/env node
/**
 * deadSelectors.js — which classes in a stylesheet does any component still render?
 *
 * Converting a dead rule costs a decision and a test; deleting it costs nothing. So a unit
 * proves its selectors live BEFORE the codemod (WORKER-CHECKLIST step 3).
 *
 * For each class in the stylesheet (or one styles.css unit), search every .js/.jsx under
 * src/src (excluding __tests__) plus src/public/*.html for:
 *   live    the class as a whole word inside a string or template literal ('a b', `a ${x}`),
 *           a classnames-style key, or a querySelector('.a') / classList.add('a')
 *   unsure  a prefix or suffix of it is assembled at runtime: `phase-${x}`, 'phase-' + x,
 *           `${base}-active` — the class may be live; read the code
 *   dead    none of the above
 * REPORT ONLY. A worker deletes a dead rule after reading it (and after a grep of its own:
 * markdown renderers, third-party widgets and server-rendered HTML can set classes too).
 */
const fs = require('fs');
const path = require('path');
const S = require('./lib/scan');
const C = require('./lib/common');
const { rangesFor } = require('./lib/units');

const HELP = `usage: node scripts/skins/deadSelectors.js --file <css> [--range SC-xx] [options]

  --file <css>     stylesheet, relative to src/src (or a repo path)
  --range SC-xx    only the classes declared inside that styles.css unit
  --dead           list only dead and unsure classes
  --json           machine output: [{ class, status, cssLines[], evidence[] }]
  --root <dir>     another src/src (fixtures, scratch copies)
  --selftest       fixture run: finds the planted dead class, spares the template-built one
  --selftest --plant   the fixture's dead class is made live; the self-test must fail
  --help`;

/** Classes declared in a stylesheet (or a line window), with the lines they appear on. */
function classesIn(css, range) {
  const stripped = S.stripComments(css);
  const out = new Map();
  for (const p of S.pieces(stripped)) {
    if (p.kind !== 'prelude') continue;
    const head = p.text.trim();
    if (head.startsWith('@')) continue;               // @media / @keyframes preludes
    const line = S.lineAt(stripped, p.start + (p.text.length - p.text.replace(/^\s+/, '').length));
    if (range && (line < range.from || line > range.to)) continue;
    const sel = head.replace(/\[[^\]]*\]/g, '').replace(/url\([^)]*\)/g, '');
    for (const m of sel.matchAll(/\.(-?[A-Za-z_][\w-]*)/g)) {
      if (/^\d/.test(m[1])) continue;
      if (!out.has(m[1])) out.set(m[1], []);
      if (!out.get(m[1]).includes(line)) out.get(m[1]).push(line);
    }
  }
  return out;
}

/** Load the search corpus once: comment-stripped sources, with their paths. */
function corpus(root) {
  const files = C.jsxFiles(root).map((rel) => ({ rel, text: S.stripJsComments(fs.readFileSync(path.join(root, rel), 'utf8')) }));
  const pub = path.join(root, '..', 'public');
  if (fs.existsSync(pub)) {
    for (const f of fs.readdirSync(pub).filter((x) => x.endsWith('.html'))) {
      files.push({ rel: path.join('..', 'public', f), text: fs.readFileSync(path.join(pub, f), 'utf8') });
    }
  }
  // dynamic prefixes / suffixes assembled at runtime
  const prefixes = new Map();
  const suffixes = new Map();
  for (const f of files) {
    for (const m of f.text.matchAll(/[\s'"`]([A-Za-z_][\w-]*-)\$\{/g)) addTo(prefixes, m[1], f, m.index);      // `phase-${x}`
    for (const m of f.text.matchAll(/['"]([A-Za-z_][\w-]*-)['"]\s*\+/g)) addTo(prefixes, m[1], f, m.index);   // 'phase-' + x
    for (const m of f.text.matchAll(/\}(-[\w-]+)(?=[\s'"`$])/g)) addTo(suffixes, m[1], f, m.index);          // `${base}-active`
    for (const m of f.text.matchAll(/\+\s*['"](-[\w-]+)['"]/g)) addTo(suffixes, m[1], f, m.index);            // base + '-active'
  }
  return { files, prefixes, suffixes };
}

function addTo(map, key, f, index) {
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(`${f.rel}:${S.lineAt(f.text, index)}`);
}

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function classify(name, cor) {
  const word = escapeRe(name);
  // inside a string/template: bounded by quote, whitespace, backtick, `}` or a selector dot
  const inString = new RegExp(`(^|[\\s'"\`}.])${word}(?=$|[\\s'"\`$:.,)\\]])`, 'g');
  const evidence = [];
  for (const f of cor.files) {
    for (const m of f.text.matchAll(inString)) {
      // must sit in a quoted context on its line, or be a classnames-style key
      const lineStart = f.text.lastIndexOf('\n', m.index) + 1;
      const before = f.text.slice(lineStart, m.index + m[1].length);
      const quotes = (before.match(/['"`]/g) || []).length;
      const isKey = /(classNames|clsx|cx)\(\s*\{[^}]*$/.test(f.text.slice(Math.max(0, m.index - 300), m.index + 1));
      if (quotes % 2 === 1 || isKey || /\.\s*$/.test(m[1]) || /\$\{[^}]*$/.test(before)) {
        evidence.push(`${f.rel}:${S.lineAt(f.text, m.index)}`);
        if (evidence.length >= 3) break;
      }
    }
    if (evidence.length >= 3) break;
  }
  if (evidence.length) return { status: 'live', evidence };
  const dyn = [];
  for (const [p, where] of cor.prefixes) if (name.startsWith(p) && name.length > p.length) dyn.push(`prefix "${p}" at ${where[0]}`);
  for (const [s, where] of cor.suffixes) if (name.endsWith(s) && name.length > s.length) dyn.push(`suffix "${s}" at ${where[0]}`);
  if (dyn.length) return { status: 'unsure', evidence: dyn.slice(0, 3) };
  return { status: 'dead', evidence: [] };
}

function report(root, rel, rangeId) {
  const css = fs.readFileSync(path.join(root, rel), 'utf8');
  let range = null;
  if (rangeId) {
    range = rangesFor(css).find((r) => r.id === rangeId);
    if (!range) throw new Error(`no unit ${rangeId} in ${rel}`);
  }
  const cor = corpus(root);
  const rows = [];
  for (const [name, lines] of classesIn(css, range)) rows.push({ class: name, cssLines: lines, ...classify(name, cor) });
  return rows;
}

function runSelftest(plant) {
  const tmp = C.tmpDir('dead');
  fs.cpSync(path.join(__dirname, 'fixtures', 'dead'), tmp, { recursive: true });
  if (plant) fs.appendFileSync(path.join(tmp, 'src', 'Panel.jsx'), "\nexport const Ghost = () => <i className=\"fx-ghost\" />;\n");
  const rows = report(path.join(tmp, 'src'), 'Panel.css');
  const by = Object.fromEntries(rows.map((r) => [r.class, r.status]));
  C.selftest('deadSelectors', [
    ['a className string makes fx-panel live', () => C.assert(by['fx-panel'] === 'live', by['fx-panel'])],
    ['a template literal word makes fx-title live', () => C.assert(by['fx-title'] === 'live', by['fx-title'])],
    ['a classList.add makes fx-open live', () => C.assert(by['fx-open'] === 'live', by['fx-open'])],
    ['`fx-phase-${x}` makes fx-phase-ask unsure, not dead', () => C.assert(by['fx-phase-ask'] === 'unsure', by['fx-phase-ask'])],
    ['the planted fx-ghost is dead', () => C.assert(by['fx-ghost'] === 'dead', by['fx-ghost'])],
    ['a class named only in a comment is still dead (fx-comment)', () => C.assert(by['fx-comment'] === 'dead', by['fx-comment'])],
  ]);
}

function main() {
  const o = C.args();
  if (o.help || (!o.file && !o.selftest)) { console.log(HELP); process.exit(o.help ? 0 : 2); }
  if (o.selftest) { runSelftest(!!o.plant); return; }
  const root = o.root ? path.resolve(o.root) : C.SRC;
  const rel = C.relCss(o.file, root);
  const rows = report(root, rel, o.range).filter((r) => !o.dead || r.status !== 'live');
  if (o.json) { console.log(JSON.stringify(rows, null, 2)); return; }
  const n = (s) => rows.filter((r) => r.status === s).length;
  console.log(`# ${rel}${o.range ? ` ${o.range}` : ''}: ${n('live')} live · ${n('unsure')} unsure · ${n('dead')} dead\n`);
  console.log('| class | status | css lines | evidence |\n|---|---|---|---|');
  const order = { dead: 0, unsure: 1, live: 2 };
  rows.sort((a, b) => order[a.status] - order[b.status] || a.cssLines[0] - b.cssLines[0]);
  for (const r of rows) console.log(`| .${r.class} | ${r.status} | ${r.cssLines.join(', ')} | ${r.evidence.join('; ')} |`);
}

if (require.main === module) main();
module.exports = { classesIn, corpus, classify, report };
