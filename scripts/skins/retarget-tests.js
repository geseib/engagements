#!/usr/bin/env node
/**
 * retarget-tests.js — move palette tests' hand-rolled styles.css token reads onto the
 * skin harness, mechanically (TOOLING-BRIEF §2; PLAN Phase 0a).
 *
 *   token(GLOBAL_CSS, ROOT, '--primary')        ->  H.role('--primary', { skin: 'classic', theme: 'dark' })
 *   token(GLOBAL, '[data-theme="light"]', '--bg') ->  H.role('--bg', { skin: 'classic', theme: 'light' })
 *
 * Only rewrites a call when ALL hold, else lists it as skipped with the reason:
 *   - the first argument is a variable bound to styles.css in that file;
 *   - the block is `:root`, `[data-theme="dark"]` or `[data-theme="light"]` (a literal, or a
 *     const in the file holding one of those);
 *   - VERIFIED: the value the old read returns today (first such block in styles.css, a
 *     6-digit hex) equals what H.role returns today. So applying it before Phase 0a cannot
 *     move a number, and after 0a it reads the same Classic values from skins + roles.
 * Adds `const H = require('../testing/skinHarness');` after the file's last top-level require.
 * The old token()/ROOT/DUSK helpers are left in place (they may still read scoped sheets).
 *
 * Report-only by default. --apply writes.
 */
const fs = require('fs');
const path = require('path');
const C = require('./lib/common');

const HELP = `usage: node scripts/skins/retarget-tests.js [--apply] [--file <test>] [--json]

  (default)        dry run over src/src/__tests__/*Palette.test.js[x]: list every rewrite and skip
  --apply          write the rewrites
  --file <name>    one test file (name or path)
  --all-tests      every __tests__ file, not only *Palette.test.js
  --root <dir>     another src/src (fixtures, scratch copies)
  --json           machine output
  --selftest       fixture: 3 rewrites, 2 skips (non-hex value, scoped sheet)
  --selftest --plant   the fixture's GLOBAL_CSS is bound to another sheet: must fail
  --help`;

const BLOCK_THEME = {
  ':root': 'dark',
  '[data-theme="dark"]': 'dark',
  '[data-theme="light"]': 'light',
};

function normBlock(s) { return s.replace(/\s*\{\s*$/, '').trim(); }

/** What today's hand-rolled token() returns: first block, up to its first }, a 6-digit hex. */
function oldValue(css, block, name) {
  const start = css.indexOf(`${block} {`) >= 0 ? css.indexOf(`${block} {`) : css.indexOf(block);
  if (start < 0) return { error: `no ${block} block` };
  const body = css.slice(start, css.indexOf('}', start));
  const m = body.match(new RegExp(`${name}\\s*:\\s*([^;]+);`));
  if (!m) return { error: `${name} not declared in ${block}` };
  const v = m[1].replace(/\/\*[\s\S]*?\*\//g, '').trim();
  if (!/^#[0-9A-Fa-f]{6}$/.test(v)) return { error: `${name} in ${block} is "${v}", not a 6-digit hex` };
  return { value: v };
}

function plan(root, file) {
  const H = require('../../src/src/testing/skinHarness').create(root);
  const styles = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
  const text = fs.readFileSync(path.join(root, '__tests__', file), 'utf8');
  const globals = new Set();
  for (const m of text.matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*[^;\n]*['"]styles\.css['"]/g)) globals.add(m[1]);
  const consts = {};
  for (const m of text.matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*(?:'([^'\n]*)'|"([^"\n]*)")\s*;/g)) consts[m[1]] = m[2] !== undefined ? m[2] : m[3];

  // How does THIS file's token() hand its value back? `return m[1]` (a string) or
  // `return parseHex(m[1])` (wrapped) are recognised; anything else is skipped whole.
  let wrap = null; let tokenShape = 'none';
  const def = text.match(/function\s+token\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/);
  if (def) {
    const ret = def[1].match(/return\s+(?:(\w+)\(\s*m\[1\]\s*\)|m\[1\])\s*;/);
    if (ret) { wrap = ret[1] || null; tokenShape = 'known'; } else tokenShape = 'unknown';
  }

  const rewrites = []; const skips = [];
  const CALL = /\btoken\(\s*(\w+)\s*,\s*(?:(\w+)|'([^'\n]*)'|"([^"\n]*)")\s*,\s*['"](--[\w-]+)['"]\s*\)/g;
  for (const m of text.matchAll(CALL)) {
    const line = text.slice(0, m.index).split('\n').length;
    const [whole, cssVar, blockVar, lit1, lit2, name] = m;
    const where = { file, line, old: whole };
    if (tokenShape !== 'known') { skips.push({ ...where, reason: tokenShape === 'none' ? 'no function token() in this file' : 'token() returns a shape the codemod does not recognise' }); continue; }
    if (!globals.has(cssVar)) { skips.push({ ...where, reason: `${cssVar} is not styles.css in this file (a scoped sheet: use H.scopeVar by hand)` }); continue; }
    const blockText = blockVar ? consts[blockVar] : (lit1 !== undefined ? lit1 : lit2);
    if (blockText === undefined) { skips.push({ ...where, reason: `block ${blockVar} is not a string constant in this file` }); continue; }
    const block = normBlock(blockText);
    const theme = BLOCK_THEME[block];
    if (!theme) { skips.push({ ...where, reason: `block "${block}" is not :root / [data-theme]` }); continue; }
    const before = oldValue(styles, block, name);
    if (before.error) { skips.push({ ...where, reason: before.error }); continue; }
    let after;
    try { after = H.role(name, { skin: 'classic', theme }); } catch (e) { skips.push({ ...where, reason: e.message }); continue; }
    if (after.toUpperCase() !== before.value.toUpperCase()) {
      skips.push({ ...where, reason: `H.role gives ${after}, the old read gives ${before.value}` });
      continue;
    }
    rewrites.push({ ...where, index: m.index, length: whole.length, replacement: wrap ? `${wrap}(H.role('${name}', { skin: 'classic', theme: '${theme}' }))` : `H.role('${name}', { skin: 'classic', theme: '${theme}' })`, value: before.value });
  }
  return { file, text, rewrites, skips };
}

function apply(root, p) {
  if (!p.rewrites.length) return false;
  let out = p.text;
  for (const r of p.rewrites.slice().sort((a, b) => b.index - a.index)) {
    out = out.slice(0, r.index) + r.replacement + out.slice(r.index + r.length);
  }
  if (!/\bconst\s+H\s*=\s*require\(['"]\.\.\/testing\/skinHarness['"]\)/.test(out)) {
    const lines = out.split('\n');
    let last = -1;
    lines.forEach((l, i) => { if (/^(const|let|var)\s.*\brequire\(/.test(l) || /^import\s/.test(l)) last = i; });
    const insertAt = last >= 0 ? last + 1 : (() => { // after the header comment
      const end = out.indexOf('*/');
      return end >= 0 ? out.slice(0, end).split('\n').length : 0;
    })();
    lines.splice(insertAt, 0, "const H = require('../testing/skinHarness');");
    out = lines.join('\n');
  }
  fs.writeFileSync(path.join(root, '__tests__', p.file), out);
  return true;
}

function files(root, o) {
  const dir = path.join(root, '__tests__');
  if (o.file) return [path.basename(o.file)];
  return fs.readdirSync(dir).filter((f) => (o['all-tests'] ? /\.(js|jsx)$/ : /Palette\.test\.jsx?$/).test(f)).sort();
}

function run(root, o) {
  const plans = files(root, o).map((f) => plan(root, f));
  if (o.apply) for (const p of plans) apply(root, p);
  return plans;
}

function runSelftest(plant) {
  const tmp = C.tmpDir('retarget');
  fs.cpSync(path.join(__dirname, 'fixtures', 'retarget'), tmp, { recursive: true });
  if (plant) {
    const t = path.join(tmp, '__tests__', 'fxPalette.test.js');
    fs.writeFileSync(t, fs.readFileSync(t, 'utf8').replace("read('styles.css')", "read('other.css')"));
  }
  const plans = run(tmp, { apply: true });
  const p = plans[0];
  const after = fs.readFileSync(path.join(tmp, '__tests__', 'fxPalette.test.js'), 'utf8');
  C.selftest('retarget-tests', [
    ['three reads rewritten', () => C.assert(p.rewrites.length === 3, `${p.rewrites.length}: ${JSON.stringify(p.skips)}`)],
    ['the non-hex --hairline read is skipped', () => C.assert(p.skips.some((s) => /--hairline/.test(s.old) && /not a 6-digit hex/.test(s.reason)), JSON.stringify(p.skips))],
    ['the scoped-sheet read is skipped', () => C.assert(p.skips.some((s) => /MINE/.test(s.old)), JSON.stringify(p.skips))],
    ['the harness require is added once', () => C.assert((after.match(/require\('\.\.\/testing\/skinHarness'\)/g) || []).length === 1, after)],
    ['a light read becomes theme light', () => C.assert(after.includes("H.role('--bg', { skin: 'classic', theme: 'light' })"), after)],
  ]);
}

function main() {
  const o = C.args();
  if (o.help) { console.log(HELP); return; }
  if (o.selftest) { runSelftest(!!o.plant); return; }
  const root = o.root ? path.resolve(o.root) : C.SRC;
  const plans = run(root, o);
  if (o.json) {
    console.log(JSON.stringify(plans.map(({ text, ...rest }) => rest), null, 2));
    return;
  }
  let nr = 0; let ns = 0;
  for (const p of plans) {
    if (!p.rewrites.length && !p.skips.length) continue;
    console.log(`\n## ${p.file}: ${p.rewrites.length} rewrite(s), ${p.skips.length} skipped`);
    for (const r of p.rewrites) console.log(`  ${r.line}: ${r.old}\n      -> ${r.replacement}   (${r.value})`);
    for (const s of p.skips) console.log(`  ${s.line}: SKIP ${s.old}\n      ${s.reason}`);
    nr += p.rewrites.length; ns += p.skips.length;
  }
  const touched = plans.filter((p) => p.rewrites.length).length;
  console.log(`\n${o.apply ? 'APPLIED' : 'DRY RUN'}: ${nr} rewrites in ${touched} files, ${ns} skipped, ${plans.length} files scanned`);
}

main();
