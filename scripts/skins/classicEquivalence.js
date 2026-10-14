#!/usr/bin/env node
/**
 * classicEquivalence.js — the PRIMARY gate of every unit: "Classic did not change".
 *
 * Rendering every signed-in surface is impossible from a worker (no sign-in), so prove it
 * statically. For each changed stylesheet, parse the base and head versions with postcss,
 * RESOLVE every declaration — var(--x) replaced by the scope's own custom property or by the
 * role's Classic value under each theme the sheet renders in (styles/skins/classic.css +
 * styles/roles.css + styles.css, as the browser cascades them, via skinHarness) — and compare
 * the resolved declarations selector by selector. Colours compare as numbers, so
 * `rgba(155,168,190,.20)`, `rgb(155 168 190 / .2)` and `var(--rule)` are the same thing.
 *
 * Output: "0 differences", or a list. A difference is fixed, or recorded in the unit's record
 * as an accepted Classic delta with its reason (the owner reviews those in a batch).
 * Removed rules are listed apart (deleting dead CSS is expected; say so in the record).
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const C = require('./lib/common');
const H = require('../../src/src/testing/skinHarness');
const { rangesFor } = require('./lib/units');
const R = require('./lib/roles');

let postcss;
try { postcss = require(path.join(C.REPO, 'src', 'node_modules', 'postcss')); } catch (e) {
  postcss = null;
}

const HELP = `usage: node scripts/skins/classicEquivalence.js --base <git-ref> (--files a.css,b.css | --unit <id>) [options]

  --base <ref>        the wave-start commit (what Classic looked like)
  --files <list>      comma-separated stylesheets, relative to src/src
  --unit <id>         the files of a unit from docs/design/themes/units.json
  --range SC-xx       styles.css: only rules inside that unit (by marker/banner, on each side)
  --theme dark|light|both   the theme(s) the sheets render in (default: from units.json, else dark)
  --head <dir>        compare against another src/src (a scratch copy) instead of the working tree
  --base-dir <dir>    compare against a src/src on disk instead of a git ref
  --json              machine output
  --selftest          fixtures: identical = 0, role swap = 0, a planted .20 -> .22 alpha = 1
  --selftest --plant  the .22 is planted where 0 is expected: must fail
  --help`;

/* ---------- reading the two sides ---------- */

function materialise(ref, files) {
  const dir = C.tmpDir('equiv-base');
  const want = new Set(files);
  for (const extra of ['styles.css', 'styles/roles.css', 'config/skins.js']) want.add(extra);
  let listed = [];
  try {
    listed = execFileSync('git', ['-C', C.REPO, 'ls-tree', '-r', '--name-only', ref, 'src/src/styles/skins'], { encoding: 'utf8' }).split('\n').filter(Boolean);
  } catch (_) { /* none */ }
  for (const p of listed) want.add(p.replace(/^src\/src\//, ''));
  for (const rel of want) {
    let text;
    try { text = execFileSync('git', ['-C', C.REPO, 'show', `${ref}:src/src/${rel}`], { encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'ignore'] }); } catch (_) { continue; }
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
  return dir;
}

/* ---------- canonical values ---------- */

function canonColours(v) {
  return v
    .replace(/#[0-9a-fA-F]{3,8}\b|\b(?:rgba?)\([^()]*\)|\b(?:white|black)\b/gi, (m) => {
      const k = R.colourKey(m);
      return k ? `rgba(${k})` : m;
    })
    .replace(/\s+/g, ' ')
    .replace(/\s*,\s*/g, ',')
    .replace(/\(\s+/g, '(').replace(/\s+\)/g, ')')
    .trim();
}

function substitute(value, get, depth = 0) {
  if (depth > 20) return value;
  let out = ''; let i = 0;
  while (i < value.length) {
    const k = value.indexOf('var(', i);
    if (k < 0) { out += value.slice(i); break; }
    out += value.slice(i, k);
    let d = 1; let j = k + 4;
    while (j < value.length && d) { if (value[j] === '(') d += 1; else if (value[j] === ')') d -= 1; j += 1; }
    const inner = value.slice(k + 4, j - 1);
    const comma = inner.indexOf(',');
    const name = (comma >= 0 ? inner.slice(0, comma) : inner).trim();
    let v = get(name);
    if (v === undefined && comma >= 0) v = substitute(inner.slice(comma + 1).trim(), get, depth + 1);
    out += v === undefined ? `var(${name})` : substitute(v, get, depth + 1);
    i = j;
  }
  return out;
}

/* ---------- one side, resolved ---------- */

function atChain(node) {
  const parts = [];
  let p = node.parent;
  while (p && p.type !== 'root') { if (p.type === 'atrule') parts.unshift(`@${p.name} ${p.params}`); p = p.parent; }
  return parts.join(' » ');
}

function scopeRoot(selector) {
  const m = selector.trim().match(/^[a-zA-Z]*\.([\w-]+)/);
  return m ? m[1] : null;
}

function sideDecls(rootDir, rel, range, themes) {
  if (!postcss) throw new Error('postcss not found at src/node_modules/postcss (it ships with css-loader); do not npm install — resolve it from the main checkout');
  const file = path.join(rootDir, rel);
  if (!fs.existsSync(file)) return null;
  const text = fs.readFileSync(file, 'utf8');
  let win = null;
  if (range) {
    win = rangesFor(text).find((r) => r.id === range);
    if (!win) throw new Error(`${rel}: no unit ${range} on this side`);
  }
  const X = H.create(rootDir);
  const ast = postcss.parse(text, { from: file });
  const rules = [];
  ast.walkRules((rule) => {
    if (rule.parent && rule.parent.type === 'atrule' && /keyframes$/i.test(rule.parent.name)) return;
    const line = rule.source && rule.source.start ? rule.source.start.line : 0;
    if (win && (line < win.from || line > win.to)) return;
    rules.push(rule);
  });
  // local custom properties, with the selectors that declare them
  const locals = {};
  ast.walkDecls((d) => {
    if (!d.prop.startsWith('--') || d.parent.type !== 'rule') return;
    (locals[d.prop] = locals[d.prop] || []).push({ selectors: d.parent.selectors, value: d.value, rule: d.parent });
  });
  const roleCache = {};
  const role = (name, theme) => {
    const k = `${theme}|${name}`;
    if (!(k in roleCache)) { try { roleCache[k] = X.role(name, { skin: 'classic', theme }); } catch (_) { roleCache[k] = undefined; } }
    return roleCache[k];
  };
  function localFor(name, rule) {
    const list = locals[name];
    if (!list) return undefined;
    const same = list.find((l) => l.rule === rule);
    if (same) return same.value;
    const roots = new Set(rule.selectors.map(scopeRoot).filter(Boolean));
    const scoped = list.filter((l) => l.selectors.some((s) => roots.has(scopeRoot(s)) && rule.selectors.some((rs) => rs.includes(s.trim()))));
    if (scoped.length) return scoped[scoped.length - 1].value;
    const byRoot = list.filter((l) => l.selectors.some((s) => roots.has(scopeRoot(s))));
    if (byRoot.length) return byRoot[0].value;
    return list.length === 1 ? list[0].value : undefined;
  }
  const out = {};
  for (const rule of rules) {
    const seen = {};
    const ctx = atChain(rule);
    for (const node of rule.nodes || []) {
      if (node.type !== 'decl') continue;
      seen[node.prop] = (seen[node.prop] || 0) + 1;
      const key = `${ctx ? `${ctx} » ` : ''}${rule.selector.replace(/\s+/g, ' ').trim()} :: ${node.prop}${seen[node.prop] > 1 ? ` #${seen[node.prop]}` : ''}`;
      out[key] = { line: node.source && node.source.start ? node.source.start.line : 0, raw: node.value, byTheme: {} };
      for (const t of themes) {
        const get = (n) => { const l = localFor(n, rule); return l !== undefined ? l : role(n, t); };
        out[key].byTheme[t] = canonColours(substitute(`${node.value}${node.important ? ' !important' : ''}`, get));
      }
    }
  }
  return out;
}

function compareFile(baseDir, headDir, rel, range, themes) {
  const b = sideDecls(baseDir, rel, range, themes);
  const h = sideDecls(headDir, rel, range, themes);
  const diffs = []; const removed = []; const added = [];
  if (!b && !h) return { rel, diffs, removed, added, missing: true };
  if (!b) return { rel, diffs, removed, added: Object.keys(h), newFile: true };
  if (!h) return { rel, diffs, removed: Object.keys(b), added, deleted: true };
  for (const k of Object.keys(b)) {
    if (!(k in h)) { removed.push(`${k}  (base line ${b[k].line})`); continue; }
    for (const t of themes) {
      if (b[k].byTheme[t] !== h[k].byTheme[t]) {
        diffs.push({ key: k, theme: t, line: h[k].line, base: b[k].byTheme[t], head: h[k].byTheme[t], baseRaw: b[k].raw, headRaw: h[k].raw });
      }
    }
  }
  for (const k of Object.keys(h)) if (!(k in b)) added.push(`${k}  (head line ${h[k].line})`);
  return { rel, diffs, removed, added };
}

function unitConfig(id) {
  const p = path.join(C.REPO, 'docs', 'design', 'themes', 'units.json');
  if (!fs.existsSync(p)) throw new Error('no docs/design/themes/units.json');
  const all = JSON.parse(fs.readFileSync(p, 'utf8')).units;
  const u = all.find((x) => x.id === id);
  if (!u) throw new Error(`unit ${id} is not in units.json`);
  return u;
}

function expandFiles(u) {
  const { expandUnitFiles } = require('./lib/manifest');
  return expandUnitFiles(u).css;
}

function run(o) {
  const headDir = o.head ? path.resolve(o.head) : C.SRC;
  let files = o.files ? String(o.files).split(',').map((f) => f.trim().replace(/^src\/src\//, '')).filter(Boolean) : [];
  let themes = o.theme ? (o.theme === 'both' ? ['dark', 'light'] : [o.theme]) : null;
  let ranges = {};
  if (o.unit) {
    const u = unitConfig(o.unit);
    files = files.length ? files : expandFiles(u);
    if (!themes) themes = u.themes || ['dark'];
    for (const r of u.scRanges || []) ranges[`styles.css#${r}`] = r;
    if ((u.scRanges || []).length) files = files.filter((f) => f !== 'styles.css');
  }
  if (!themes) themes = ['dark'];
  if (o.range) ranges = { [`styles.css#${o.range}`]: o.range };
  if (!o.base && !o['base-dir']) throw new Error('--base <git-ref> is required');
  const targets = [...files.map((f) => ({ rel: f, range: null })), ...Object.values(ranges).map((r) => ({ rel: 'styles.css', range: r }))];
  if (!targets.length) throw new Error('no files: give --files, --unit or --range');
  const baseDir = o['base-dir'] ? path.resolve(o['base-dir']) : materialise(o.base, targets.map((t) => t.rel));
  return { themes, results: targets.map((t) => ({ ...compareFile(baseDir, headDir, t.rel, t.range, themes), range: t.range })) };
}

function print(res) {
  let total = 0;
  for (const r of res.results) {
    const label = `${r.rel}${r.range ? ` ${r.range}` : ''}`;
    total += r.diffs.length;
    console.log(`\n## ${label} — ${r.diffs.length} difference(s)${r.removed.length ? `, ${r.removed.length} removed` : ''}${r.added.length ? `, ${r.added.length} added` : ''}${r.newFile ? ' (new file)' : ''}`);
    for (const d of r.diffs) console.log(`  [${d.theme}] line ${d.line}  ${d.key}\n      base: ${d.base}\n      head: ${d.head}   (written: ${d.headRaw})`);
    for (const k of r.removed) console.log(`  removed: ${k}`);
    for (const k of r.added) console.log(`  added:   ${k}`);
  }
  console.log(`\nthemes: ${res.themes.join('+')} · ${total} difference(s) in Classic`);
  return total;
}

/* ---------- self-test ---------- */

function runSelftest(plant) {
  const fx = path.join(__dirname, 'fixtures', 'equivalence');
  const tmp = C.tmpDir('equiv');
  fs.cpSync(fx, tmp, { recursive: true });
  // the head side carries the SPEC fixture roles (as after Phase 0a)
  fs.cpSync(path.join(R.FIXTURE, 'styles'), path.join(tmp, 'head', 'styles'), { recursive: true });
  if (plant) {
    const p = path.join(tmp, 'head', 'Same.css');
    fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace('.20)', '.22)'));
  }
  const cmp = (rel) => compareFile(path.join(tmp, 'base'), path.join(tmp, 'head'), rel, null, ['dark']);
  const same = cmp('Same.css');
  const swap = cmp('Swap.css');
  const drift = cmp('Drift.css');
  C.selftest('classicEquivalence', [
    ['an unchanged sheet has 0 differences', () => C.assert(same.diffs.length === 0, JSON.stringify(same.diffs))],
    ['literals re-pointed to roles and channels (rule, slate tint, --primary -> --action, local alias) resolve equal', () => C.assert(swap.diffs.length === 0, JSON.stringify(swap.diffs, null, 1))],
    ['a planted .20 -> .22 alpha is reported at the declaration and where it is read', () => C.assert(drift.diffs.length === 2 && drift.diffs.every((d) => /0\.2\)/.test(d.base) && /0\.22\)/.test(d.head)), JSON.stringify(drift.diffs))],
    ['a deleted rule is listed as removed, not as a value difference', () => C.assert(drift.removed.length === 1, JSON.stringify(drift.removed))],
  ]);
}

function main() {
  const o = C.args();
  if (o.help) { console.log(HELP); return; }
  if (o.selftest) { runSelftest(!!o.plant); return; }
  try {
    const res = run(o);
    if (o.json) { console.log(JSON.stringify(res, null, 2)); return; }
    const total = print(res);
    process.exitCode = total ? 1 : 0;
  } catch (e) {
    console.error(e.message);
    process.exit(2);
  }
}

if (require.main === module) main();
module.exports = { compareFile, run, canonColours };
