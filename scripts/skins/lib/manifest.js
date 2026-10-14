/**
 * docs/design/themes/units.json, expanded against the tree: which files a unit owns, which
 * tests read them, and which of those tests it OWNS (PLAN §7: a shared test belongs to the
 * unit owning the first stylesheet it names; every other unit sends assertions to it).
 */
const fs = require('fs');
const path = require('path');
const C = require('./common');

const MANIFEST = path.join(C.REPO, 'docs', 'design', 'themes', 'units.json');

function load() { return JSON.parse(fs.readFileSync(MANIFEST, 'utf8')).units; }

function globToRe(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') { re += '.*'; i += 1; if (glob[i + 1] === '/') i += 1; } else if (c === '*') re += '[^/]*';
    else if ('.+?^${}()|[]\\'.includes(c)) re += `\\${c}`;
    else re += c;
  }
  return new RegExp(`^${re}$`);
}

let ALL = null;
function allFiles() {
  if (ALL) return ALL;
  ALL = C.walk(C.SRC, (p) => /\.(css|jsx?|mjs)$/.test(p))
    .map((p) => path.relative(C.SRC, p).split(path.sep).join('/'))
    .filter((p) => !p.split('/').includes('__tests__') && !p.startsWith('testing/'))
    .sort();
  return ALL;
}

function matchPattern(pattern) {
  if (pattern.startsWith('../')) return [];          // outside src/src (public/index.html)
  if (!pattern.includes('/')) {
    const re = globToRe(pattern);
    return allFiles().filter((f) => re.test(path.posix.basename(f)));
  }
  if (pattern.includes('*')) { const re = globToRe(pattern); return allFiles().filter((f) => re.test(f)); }
  return allFiles().includes(pattern) ? [pattern] : [];
}

/** { css[], jsx[], missing[] } — missing = patterns that match nothing today (new files are fine). */
function expandUnitFiles(u) {
  const out = new Set(); const missing = [];
  for (const p of u.files || []) {
    const hits = matchPattern(p);
    if (!hits.length) missing.push(p);
    hits.forEach((h) => out.add(h));
  }
  for (const x of u.exclude || []) out.delete(x);
  const list = [...out].sort();
  return { css: list.filter((f) => f.endsWith('.css')), jsx: list.filter((f) => !f.endsWith('.css')), missing };
}

/** Owner of each stylesheet within one phase: { 'components/X.css': 'W4-a' }. */
function ownersInPhase(units, phase) {
  const own = {};
  for (const u of units.filter((x) => x.phase === phase)) {
    for (const f of expandUnitFiles(u).css) own[f] = own[f] ? `${own[f]},${u.id}` : u.id;
    for (const r of u.scRanges || []) own[`styles.css#${r}`] = u.id;
  }
  return own;
}

/** Tests that read any of the unit's stylesheets, split into owned and foreign. */
function testsFor(u, units) {
  const files = expandUnitFiles(u).css;
  if (u.scRanges && u.scRanges.length) files.push('styles.css');
  const owners = ownersInPhase(units, u.phase);
  const owned = new Set(u.ownedTests || []); const foreign = new Set(u.foreignTestsOverride || []);
  const names = (text) => [...text.matchAll(/([\w-]+\.css)\b/g)].map((m) => m[1]);
  for (const t of C.testTexts()) {
    const mentioned = names(t.t);
    const mine = files.filter((f) => mentioned.includes(path.posix.basename(f)));
    if (!mine.length) continue;
    if (/^skin[A-Z]/.test(t.f)) continue;              // the skins gate/harness tests: the coordinator's
    if (owned.has(t.f) || foreign.has(t.f)) continue;
    // the first stylesheet the test names that some unit of this phase owns
    let first = null;
    for (const b of mentioned) {
      if (b === 'styles.css') continue;
      const f = Object.keys(owners).find((k) => path.posix.basename(k) === b);
      if (f) { first = owners[f]; break; }
    }
    if (!first && mentioned.every((b) => b === 'styles.css')) first = (u.scRanges || []).length ? u.id : null;
    if (first === u.id || (first && first.split(',').includes(u.id))) owned.add(t.f); else foreign.add(t.f);
  }
  return { owned: [...owned].sort(), foreign: [...foreign].sort() };
}

/** Files owned by two units of the same phase — must be empty for a wave to run in parallel. */
function collisions(units) {
  const out = [];
  const phases = [...new Set(units.map((u) => u.phase))];
  for (const ph of phases) {
    const own = ownersInPhase(units, ph);
    for (const [f, ids] of Object.entries(own)) if (ids.includes(',')) out.push(`${ph}: ${f} owned by ${ids}`);
  }
  return out;
}

module.exports = { load, expandUnitFiles, testsFor, collisions, ownersInPhase, MANIFEST };
