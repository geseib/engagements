#!/usr/bin/env node
/**
 * measure.js — re-derive every count in docs/design/themes/INVENTORY.md.
 *
 * Workers and reviewers RE-MEASURE; nobody trusts a number in a doc. The scanner is
 * src/src/testing/skinScan.js, the same module the build gate reads, so a count here
 * and a count in a gate message are the same count.
 *
 * Columns that reproduce INVENTORY exactly (verified at 16e8c3dd: 1,731 / 514 / 40 / 796 / 153):
 *   ruleLiterals  #hex / rgb[a]() / hsl[a]() in an ordinary declaration
 *   declLiterals  the same inside a --custom-property declaration
 *   fontLiterals  font-family not starting var( / inherit
 *   primary       var(--primary…) reads (incl. --primary-deep) · secondary: var(--secondary)
 * Extra columns the GATE also counts (INVENTORY was measured without them):
 *   namedLiterals the words white / black as a value
 *   fontShorthand a font: shorthand naming a family
 *   gate colour = rule + decl + named · gate font = fontLiterals + fontShorthand
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const S = require('./lib/scan');
const C = require('./lib/common');
const GROUPS = require('./lib/groups');
const { unitRanges } = require('./lib/units');

const HELP = `usage: node scripts/skins/measure.js [options]

  (no options)        markdown tables = INVENTORY §1-§3, to stdout
  --json              { file: { lines, ruleLiterals, declLiterals, fontLiterals, primary,
                        secondary, amberTints, blueTints, namedLiterals, fontShorthand,
                        colour, font, paletteTests[], cssTests[] } }
  --file <path>       one stylesheet (relative to src/src, or a repo path)
  --range SC-03       one styles.css unit, found by its banner (scripts/skins/lib/units.js)
  --jsx               quoted colour literals and fill=/stroke= in .js/.jsx (excl. __tests__)
  --ref <git-ref>     measure the tree at a commit instead of the working copy
                        (e.g. --ref 16e8c3dd reproduces INVENTORY.md)
  --root <dir>        measure another src/src (fixtures, a scratch copy)
  --selftest          run on scripts/skins/fixtures/measure/ and exit 0/1
  --selftest --plant  same, with a planted literal the self-test must catch (exits 1)
  --help`;

/* ---------- reading a tree: the working copy or a git ref ---------- */

function treeReader(opts) {
  if (opts.ref) {
    const ref = opts.ref;
    const names = execFileSync('git', ['-C', C.REPO, 'ls-tree', '-r', '--name-only', ref, 'src/src'], { encoding: 'utf8' })
      .split('\n').filter(Boolean).map((p) => p.replace(/^src\/src\//, ''));
    const read = (rel) => execFileSync('git', ['-C', C.REPO, 'show', `${ref}:src/src/${rel}`], { encoding: 'utf8', maxBuffer: 64 << 20 });
    const tests = names.filter((n) => /^__tests__\/[^/]+\.(js|jsx)$/.test(n)).map((n) => ({ f: path.basename(n), t: read(n) }));
    return {
      css: names.filter((n) => n.endsWith('.css')).sort(),
      jsx: names.filter((n) => /\.(jsx?|mjs)$/.test(n) && !n.split('/').includes('__tests__') && !n.startsWith('testing/')).sort(),
      read,
      tests,
    };
  }
  const root = opts.root ? path.resolve(opts.root) : C.SRC;
  return {
    css: C.cssFiles(root),
    jsx: C.jsxFiles(root),
    read: (rel) => fs.readFileSync(path.join(root, rel), 'utf8'),
    tests: C.testTexts(root),
  };
}

function testsNaming(rel, tests) {
  const base = path.basename(rel).replace(/\./g, '\\.');
  const re = new RegExp(`(^|[^\\w.-])${base}`);
  const hits = tests.filter((x) => re.test(x.t)).map((x) => x.f).sort();
  return {
    cssTests: hits,
    paletteTests: hits.filter((f) => /Palette\.test\.js$/.test(f)).map((f) => f.replace(/\.test\.js$/, '')),
  };
}

function measureFile(tree, rel, range) {
  const css = tree.read(rel);
  const counts = S.scanCss(css, range || {}).counts;
  return { ...counts, ...testsNaming(rel, tree.tests) };
}

function measureAll(tree) {
  const out = {};
  for (const rel of tree.css) out[rel] = measureFile(tree, rel);
  return out;
}

function measureUnits(tree) {
  const css = tree.read('styles.css');
  return unitRanges(css).map((r) => ({ ...r, ...S.scanCss(css, r).counts }));
}

function measureJsx(tree) {
  const out = {};
  for (const rel of tree.jsx) {
    const r = S.scanJsx(tree.read(rel));
    if (r.findings.length || r.dataSkinLines.length) {
      out[rel] = {
        colour: r.counts.colour,
        lines: [...new Set(r.findings.map((f) => f.line))].length,
        literals: r.findings.map((f) => `${f.line}:${f.literal}`),
        dataSkinLines: r.dataSkinLines,
      };
    }
  }
  return out;
}

/* ---------- markdown ---------- */

function effort(m) {
  if (m.ruleLiterals <= 8 && m.lines < 350) return 'S';
  if (m.ruleLiterals <= 30 && m.lines < 1000) return 'M';
  return 'L';
}

function sum(rows, k) { return rows.reduce((a, r) => a + (r[k] || 0), 0); }

function markdown(all, units, tree) {
  const files = Object.keys(all);
  const rows = files.map((f) => all[f]);
  const lines = [];
  // INVENTORY counted this one on the RAW text (comments included); kept so the number reproduces.
  const amberHex = files.reduce((a, f) => a + (tree.read(f).match(/#F6A94C\b/gi) || []).length, 0);
  lines.push('## 1. Totals', '', '| | Count |', '|---|---:|');
  lines.push(`| Stylesheets under \`src/src\` | **${files.length}** (${sum(rows, 'lines').toLocaleString('en-US')} lines) |`);
  lines.push(`| Colour literals in rules | **${sum(rows, 'ruleLiterals').toLocaleString('en-US')}** (${(all['styles.css'] || {}).ruleLiterals || 0} of them in \`styles.css\`) |`);
  lines.push(`| Colour literals in scoped token declarations | **${sum(rows, 'declLiterals')}** |`);
  lines.push(`| Literal \`font-family\` | **${sum(rows, 'fontLiterals')}** |`);
  lines.push(`| \`var(--primary…)\` reads | **${sum(rows, 'primary')}** · \`var(--secondary)\` **${sum(rows, 'secondary')}** |`);
  lines.push(`| Hard-coded amber tints \`rgba(246,169,76,…)\` | **${sum(rows, 'amberTints')}** · blue tints \`rgba(124,167,230,…)\` **${sum(rows, 'blueTints')}** · literal \`#F6A94C\` **${amberHex}** |`);
  lines.push(`| *Gate only:* named \`white\`/\`black\` values · \`font:\` shorthands naming a family | **${sum(rows, 'namedLiterals')}** · **${sum(rows, 'fontShorthand')}** |`);
  lines.push(`| \`*Palette.test.js\` | **${tree.tests.filter((t) => /Palette\.test\.jsx?$/.test(t.f)).length}**; stylesheets with none: **${rows.filter((r) => !r.paletteTests.length).length}** |`);
  lines.push(`| Frontend tests that read a stylesheet as text | **${new Set(rows.flatMap((r) => r.cssTests)).size}** of ${tree.tests.length} |`);
  lines.push('');

  const grouped = {};
  const assigned = new Set();
  for (const [g, list] of Object.entries(GROUPS)) {
    grouped[g] = list.filter((f) => all[f]);
    list.forEach((f) => assigned.add(f));
  }
  const loose = files.filter((f) => !assigned.has(f));
  if (loose.length) grouped['? Unassigned (add to scripts/skins/lib/groups.js)'] = loose;

  lines.push('### By group', '', '| Group | Sheets | Lines | Literals in rules | Literals in token decls | Literal font-family | var(--primary) | Sheets with no palette test |', '|---|---:|---:|---:|---:|---:|---:|---:|');
  for (const [g, list] of Object.entries(grouped)) {
    const r = list.map((f) => all[f]);
    lines.push(`| ${g} | ${list.length} | ${sum(r, 'lines')} | ${sum(r, 'ruleLiterals')} | ${sum(r, 'declLiterals')} | ${sum(r, 'fontLiterals')} | ${sum(r, 'primary')} | ${r.filter((x) => !x.paletteTests.length).length} |`);
  }
  lines.push(`| **Total** | ${files.length} | ${sum(rows, 'lines')} | ${sum(rows, 'ruleLiterals')} | ${sum(rows, 'declLiterals')} | ${sum(rows, 'fontLiterals')} | ${sum(rows, 'primary')} | ${rows.filter((x) => !x.paletteTests.length).length} |`, '');

  lines.push('## 2. Every stylesheet, by group', '');
  for (const [g, list] of Object.entries(grouped)) {
    lines.push(`### ${g}`, '', '| Stylesheet | Lines | Colour literals in rules | Colour literals in token decls | Literal font-family | var(--primary) | Palette test(s) | CSS-reading tests | Effort | gate colour/font |', '|---|---:|---:|---:|---:|---:|---|---:|:-:|---|');
    for (const f of list) {
      const m = all[f];
      lines.push(`| \`${f}\` | ${m.lines} | ${m.ruleLiterals} | ${m.declLiterals} | ${m.fontLiterals} | ${m.primary} | ${m.paletteTests.join(', ') || '**none**'} | ${m.cssTests.length} | ${effort(m)} | ${m.colour}/${m.font} |`);
    }
    lines.push('');
  }

  if (units) {
    lines.push('## 3. `styles.css` units', '', '| Unit | Lines | Literals in rules | Literals in token decls | var(--primary) | var(--secondary) | Literal font-family | gate colour/font |', '|---|---|---:|---:|---:|---:|---:|---|');
    for (const u of units) lines.push(`| ${u.id} | ${u.from}-${u.to} | ${u.ruleLiterals} | ${u.declLiterals} | ${u.primary} | ${u.secondary} | ${u.fontLiterals} | ${u.colour}/${u.font} |`);
    lines.push('');
  }
  return lines.join('\n');
}

/* ---------- self-test ---------- */

function runSelftest(plant) {
  const fixRoot = path.join(__dirname, 'fixtures', 'measure');
  const tmp = C.tmpDir('measure');
  fs.cpSync(fixRoot, tmp, { recursive: true });
  if (plant) fs.appendFileSync(path.join(tmp, 'a.css'), '\n.planted { color: #fff; }\n');
  const tree = treeReader({ root: tmp });
  const all = measureAll(tree);
  const a = all['a.css'];
  const b = all[path.join('sub', 'b.css')];
  C.selftest('measure', [
    ['a.css: 4 rule literals (hex, 2 rgba, hsl), channel form not counted', () => C.assert(a.ruleLiterals === 4, `ruleLiterals=${a.ruleLiterals}`)],
    ['a.css: 2 token-declaration literals', () => C.assert(a.declLiterals === 2, `declLiterals=${a.declLiterals}`)],
    ['a.css: comments are stripped (the #000 in the header is not counted)', () => C.assert(a.colour === 7, `colour=${a.colour}`)],
    ['a.css: one named white, one font: shorthand, one literal font-family', () => C.assert(a.namedLiterals === 1 && a.fontShorthand === 1 && a.fontLiterals === 1, JSON.stringify(a))],
    ['a.css: 2 --primary reads (incl. -deep), 1 --secondary', () => C.assert(a.primary === 2 && a.secondary === 1, `${a.primary}/${a.secondary}`)],
    ['a.css: one amber tint, one blue tint', () => C.assert(a.amberTints === 1 && a.blueTints === 1, `${a.amberTints}/${a.blueTints}`)],
    ['sub/b.css is clean', () => C.assert(b.colour === 0 && b.font === 0 && b.primary === 0, JSON.stringify(b))],
    ['a palette test that names a.css is listed', () => C.assert(a.paletteTests.join() === 'aPalette', a.paletteTests.join())],
  ]);
}

/* ---------- main ---------- */

function main() {
  const o = C.args();
  if (o.help) { console.log(HELP); return; }
  if (o.selftest) { runSelftest(!!o.plant); return; }
  const tree = treeReader(o);

  if (o.jsx) {
    const j = measureJsx(tree);
    if (o.json) { console.log(JSON.stringify(j, null, 2)); return; }
    const files = Object.keys(j);
    console.log('| File | Colour literals | Lines | data-skin |', '\n|---|---:|---:|---|');
    for (const f of files) console.log(`| \`${f}\` | ${j[f].colour} | ${j[f].lines} | ${j[f].dataSkinLines.join(', ')} |`);
    console.log(`\n**${files.reduce((a, f) => a + j[f].colour, 0)}** literals on ${files.reduce((a, f) => a + j[f].lines, 0)} lines in ${files.length} files`);
    return;
  }

  if (o.range) {
    const u = measureUnits(tree).find((x) => x.id === o.range);
    if (!u) { console.error(`no unit ${o.range}; known: ${measureUnits(tree).map((x) => x.id).join(' ')}`); process.exit(2); }
    const m = { ...u, ...testsNaming('styles.css', tree.tests) };
    console.log(o.json ? JSON.stringify({ [`styles.css#${u.id}`]: m }, null, 2) : `styles.css ${u.id} (lines ${u.from}-${u.to}): rule ${u.ruleLiterals} · decl ${u.declLiterals} · font ${u.fontLiterals} · --primary ${u.primary} · --secondary ${u.secondary} · named ${u.namedLiterals} · font: ${u.fontShorthand} · gate colour=${u.colour} font=${u.font}`);
    return;
  }

  if (o.file) {
    const rel = o.ref ? o.file.replace(/^src\/src\//, '') : C.relCss(o.file, o.root ? path.resolve(o.root) : C.SRC);
    const m = measureFile(tree, rel);
    console.log(o.json ? JSON.stringify({ [rel]: m }, null, 2) : `${rel}: lines ${m.lines} · rule ${m.ruleLiterals} · decl ${m.declLiterals} · font ${m.fontLiterals} · --primary ${m.primary} · --secondary ${m.secondary} · amber tints ${m.amberTints} · blue tints ${m.blueTints} · named ${m.namedLiterals} · font: ${m.fontShorthand} · gate colour=${m.colour} font=${m.font} · palette tests: ${m.paletteTests.join(', ') || 'none'} · css-reading tests: ${m.cssTests.length}`);
    return;
  }

  const all = measureAll(tree);
  if (o.json) { console.log(JSON.stringify(all, null, 2)); return; }
  const hasStyles = tree.css.includes('styles.css');
  console.log(markdown(all, hasStyles ? measureUnits(tree) : null, tree));
}

if (require.main === module) main();
module.exports = { treeReader, measureAll, measureFile, measureUnits, measureJsx };
