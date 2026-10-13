/**
 * THE SKINS GATE (docs/design/themes/SPEC.md §7, TOOLING-BRIEF §4).
 *
 * A stylesheet may not paint a colour or name a font family outside the skin values,
 * except as far as its own `skin-allowance` pragma allows — and the allowance only ever
 * goes DOWN. It is a ratchet in both directions:
 *   count > allowance  ->  fail: "N new literal(s) in X" (with each one's line and selector)
 *   count < allowance  ->  fail: "lower X's allowance to N" (so an allowance never goes stale)
 * The allowance lives IN THE FILE IT GOVERNS, so parallel units never edit a shared list:
 *   stylesheet   /* skin-allowance: colour=16 font=0 primary=3 *\/  as its first comment
 *   styles.css   /* skin-allowance SC-03: colour=106 font=2 primary=44 *\/  above each unit
 *                banner; it governs the lines down to the next marker
 *   .js / .jsx   // skin-allowance: colour=4
 * A file with no pragma must be clean.
 *
 * What counts (src/src/testing/skinScan.js — the same scanner as scripts/skins/measure.js):
 *   colour   #hex, rgb[a](), hsl[a](), and white/black as a value, in a rule OR in a scoped
 *            token declaration; rgb(var(--x-rgb) / a) is allowed
 *   font     a font-family that is not var()/inherit, or a font: shorthand naming a family
 *   primary  reads of var(--primary…) and var(--secondary). Each is an accent-vs-action
 *            decision (SPEC §4.4). TOOLING-BRIEF §4 asked for "no --primary in a file at
 *            colour=0"; on today's code that fails dozens of files that have no literal but
 *            do read --primary, so it is a third ratcheted number instead: it reaches 0 file
 *            by file, and Phase 8 deletes the aliases.
 * Skin values files (styles/skins/*.css) are exempt: they ARE the values.
 *
 * Fix a failure with: node scripts/skins/codemod.js --report --file <file>  (then --apply).
 *
 * Named *Palette.test.js, never *token*: .gitignore:35 is an unanchored `*token*`.
 * What green means: no stylesheet gained a literal and no allowance is stale. It does NOT
 * mean a surface skins correctly — only that it reads no colour the skins cannot reach.
 */
const fs = require('fs');
const path = require('path');
const S = require('../testing/skinScan');

const SRC = path.join(__dirname, '..');

function walk(dir, pred, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (['node_modules', '__tests__', 'testing'].includes(e.name)) continue;
      walk(p, pred, out);
    } else if (pred(p)) out.push(p);
  }
  return out;
}
const rel = (p) => path.relative(SRC, p).split(path.sep).join('/');
const isSkinFile = (r) => r.startsWith('styles/skins/');

const CSS = walk(SRC, (p) => p.endsWith('.css')).map(rel).sort();
const JSX = walk(SRC, (p) => /\.(jsx?|mjs)$/.test(p)).map(rel).sort();
const read = (r) => fs.readFileSync(path.join(SRC, r), 'utf8');

const ratchet = S.checkAllowance;

describe('every stylesheet stays within its skin-allowance', () => {
  const sheets = CSS.filter((r) => !isSkinFile(r) && r !== 'styles.css');
  test.each(sheets)('%s', (r) => {
    const css = read(r);
    const { findings, counts } = S.scanCss(css);
    const problems = ratchet(r, findings, counts, S.filePragma(css), r);
    if (problems.length) throw new Error(problems.join('\n\n'));
  });
});

describe('styles.css stays within each unit\'s skin-allowance', () => {
  const css = read('styles.css');
  const units = S.unitPragmas(css);
  test('every line of styles.css is governed by a unit marker', () => {
    if (!units.length) {
      const { counts } = S.scanCss(css);
      const c = S.gateCounts(counts);
      // no markers at all is only allowed for a clean file
      expect(c).toEqual({ colour: 0, font: 0, primary: 0 });
      return;
    }
    const before = S.scanCss(css, { from: 1, to: units[0].from - 1 });
    expect(units[0].from === 1 || S.gateCounts(before.counts).colour + S.gateCounts(before.counts).font + S.gateCounts(before.counts).primary === 0).toBe(true);
  });
  test.each(units.map((u) => [u.unit, u]))('styles.css %s', (id, u) => {
    const { findings, counts } = S.scanCss(css, { from: u.from, to: u.to });
    const problems = ratchet(`styles.css ${id}`, findings, counts, u.fields, `styles.css --range ${id}`);
    if (problems.length) throw new Error(problems.join('\n\n'));
  });
});

describe('JSX paints no colour of its own beyond its allowance', () => {
  test.each(JSX)('%s', (r) => {
    const src = read(r);
    const { findings } = S.scanJsx(src);
    const allowed = (S.jsxPragma(src) || {}).colour || 0;
    if (findings.length > allowed) {
      throw new Error(`${findings.length - allowed} new colour literal(s) in ${r} (allowance colour=${allowed}):\n${findings.map((f) => `    line ${f.line}  ${f.literal}`).join('\n')}\n  fix: use a role (var(--text), var(--accent)…) in a stylesheet instead of an inline colour`);
    }
    if (findings.length < allowed) {
      throw new Error(`lower ${r}'s allowance to colour=${findings.length} (it says ${allowed}). Run: node scripts/skins/seed-allowances.js --apply --file ${r}`);
    }
  });
});

describe('the skin lives on <html> only', () => {
  const ALLOWED = ['components/SkinProvider.jsx', 'components/SiteSkinPanel.jsx'];
  test('no element-level data-skin outside SkinProvider and the SiteSkinPanel swatch', () => {
    const offenders = [];
    for (const r of JSX) {
      if (ALLOWED.includes(r)) continue;
      for (const line of S.scanJsx(read(r)).dataSkinLines) offenders.push(`${r}:${line}`);
    }
    expect(offenders).toEqual([]);
  });
});

describe('skin values stay in the skin files', () => {
  test('no --sk-* is read outside styles/roles.css and the skin files', () => {
    const offenders = [];
    for (const r of CSS) {
      if (r === 'styles/roles.css' || isSkinFile(r)) continue;
      const text = S.stripComments(read(r));
      for (const m of text.matchAll(/var\(\s*--sk-[\w-]+/g)) offenders.push(`${r}:${S.lineAt(text, m.index)} ${m[0]}`);
      for (const m of text.matchAll(/(^|[;{\s])(--sk-[\w-]+)\s*:/g)) offenders.push(`${r}:${S.lineAt(text, m.index)} declares ${m[2]}`);
    }
    expect(offenders).toEqual([]);
  });
  test('a skin file declares no layout: no --L-*, --floor, --hair, --*-t-*', () => {
    const offenders = [];
    for (const r of CSS.filter(isSkinFile)) {
      const text = S.stripComments(read(r));
      for (const m of text.matchAll(/(--[\w-]+)\s*:/g)) {
        const n = m[1];
        if (/^--L-/.test(n) || n === '--floor' || n === '--hair' || /^--[\w-]+-t-[\w-]+$/.test(n)) offenders.push(`${r}: ${n}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('the gate can fail (it is not vacuous)', () => {
  test('a planted #fff in an allowed file is reported with its line and the fix command', () => {
    const css = '/* skin-allowance: colour=1 font=0 primary=0 */\n.x { color: #0F1A2E; }\n.y { background: #fff; }\n';
    const { findings, counts } = S.scanCss(css);
    const problems = ratchet('fixture.css', findings, counts, S.filePragma(css), 'fixture.css');
    expect(problems.join('\n')).toMatch(/1 new colour literal\(s\) in fixture\.css[\s\S]*line 3[\s\S]*#fff[\s\S]*codemod\.js --report --file fixture\.css/);
  });
  test('an allowance above the count asks to be lowered', () => {
    const css = '/* skin-allowance: colour=3 font=0 primary=0 */\n.x { color: #0F1A2E; }\n';
    const { findings, counts } = S.scanCss(css);
    expect(ratchet('fixture.css', findings, counts, S.filePragma(css), 'fixture.css').join('\n')).toMatch(/lower fixture\.css's allowance to colour=1/);
  });
  test('rgb(var(--x-rgb) / a) is not a literal; a pragma in a later comment does not count', () => {
    const css = '.x { color: rgb(var(--slate-rgb) / .28); }\n/* skin-allowance: colour=9 */\n';
    expect(S.scanCss(css).counts.colour).toBe(0);
    expect(S.filePragma(css)).toBeNull();
  });
});
