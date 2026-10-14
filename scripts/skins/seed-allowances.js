#!/usr/bin/env node
/**
 * seed-allowances.js — write every skin-allowance pragma at its MEASURED count.
 *
 * The gate (__tests__/skinLiteralsPalette.test.js) fails when a file's literals differ from
 * its pragma in either direction. This writes the pragmas so the gate is green at today's
 * counts; from then on counts only go down (codemod.js --apply lowers them as a unit lands).
 *
 * Seeded once when the tooling landed (2026-10-13, at the INVENTORY counts). PLAN's Phase 0e
 * re-runs it after the 0b units — which LOWERS pragmas only. Raising an allowance is refused
 * unless --allow-raise is given, and a raise is a reviewer conversation, not a fix.
 *
 * A pragma is a comment. Nothing it touches changes what any page paints.
 */
const fs = require('fs');
const path = require('path');
const S = require('./lib/scan');
const C = require('./lib/common');
const P = require('./lib/pragma');
const { unitRanges } = require('./lib/units');

const HELP = `usage: node scripts/skins/seed-allowances.js [--apply] [--file <path>] [--allow-raise]

  (default)        report what would be written, file by file
  --apply          write the pragmas
  --file <path>    one stylesheet or .jsx (relative to src/src); styles.css = all its units
  --allow-raise    permit an allowance to go UP (never in a unit's own change)
  --root <dir>     another src/src (fixtures, scratch copies)
  --selftest       fixture: seed, gate green, planted literal caught, a raise refused
  --selftest --plant   a literal is planted AFTER seeding and the self-test must fail
  --help`;

function plan(root, o) {
  const changes = []; const refused = [];
  const only = o.file ? path.relative(root, path.isAbsolute(o.file) ? o.file : path.join(root, o.file.replace(/^src\/src\//, ''))) : null;
  const css = C.cssFiles(root).filter((r) => !C.isSkinValuesFile(r) && (!only || r === only));
  for (const r of css) {
    const text = fs.readFileSync(path.join(root, r), 'utf8');
    if (r === 'styles.css') {
      const marked = S.unitPragmas(text);
      const ranges = marked.length ? marked.map((m) => ({ id: m.unit, from: m.from, to: m.to, old: m.fields })) : unitRanges(text);
      const byUnit = {}; let differs = !marked.length;
      for (const u of ranges) {
        const want = S.gateCounts(S.scanCss(text, u).counts);
        const old = u.old || null;
        if (old && !o['allow-raise'] && ['colour', 'font', 'primary'].some((k) => want[k] > (old[k] || 0))) {
          refused.push(`styles.css ${u.id}: would RAISE ${S.formatFields(old)} -> ${S.formatFields(want)}`);
          byUnit[u.id] = old;
          continue;
        }
        byUnit[u.id] = want;
        if (!old || S.formatFields(old) !== S.formatFields(want)) differs = true;
      }
      if (differs) changes.push({ file: r, kind: 'units', before: marked.length ? marked.map((m) => `${m.unit} ${S.formatFields(m.fields)}`).join(' | ') : 'none', after: Object.entries(byUnit).map(([k, v]) => `${k} ${S.formatFields(v)}`).join(' | '), write: () => P.setUnitPragmas(text, byUnit) });
      continue;
    }
    const want = S.gateCounts(S.scanCss(text).counts);
    const old = S.filePragma(text);
    const zero = !want.colour && !want.font && !want.primary;
    if (!old && zero) continue;
    if (old && S.formatFields(old) === S.formatFields(want)) continue;
    if (old && !o['allow-raise'] && ['colour', 'font', 'primary'].some((k) => want[k] > (old[k] || 0))) {
      refused.push(`${r}: would RAISE ${S.formatFields(old)} -> ${S.formatFields(want)}`);
      continue;
    }
    changes.push({ file: r, before: old ? S.formatFields(old) : 'none', after: S.formatFields(want), write: () => P.setFilePragma(text, want) });
  }
  const jsx = C.jsxFiles(root).filter((r) => !only || r === only);
  for (const r of jsx) {
    const text = fs.readFileSync(path.join(root, r), 'utf8');
    const n = S.scanJsx(text).findings.length;
    const old = S.jsxPragma(text);
    if (!old && !n) continue;
    if (old && (old.colour || 0) === n) continue;
    if (old && n > (old.colour || 0) && !o['allow-raise']) { refused.push(`${r}: would RAISE colour=${old.colour} -> ${n}`); continue; }
    changes.push({ file: r, before: old ? `colour=${old.colour || 0}` : 'none', after: `colour=${n}`, write: () => P.setJsxPragma(text, n) });
  }
  return { changes, refused };
}

function run(root, o) {
  const p = plan(root, o);
  if (o.apply) for (const c of p.changes) fs.writeFileSync(path.join(root, c.file), c.write());
  return p;
}

/** The gate's verdict over a tree, from the same shared check the jest gate runs. */
function gateProblems(root) {
  const problems = [];
  for (const r of C.cssFiles(root).filter((x) => !C.isSkinValuesFile(x))) {
    const text = fs.readFileSync(path.join(root, r), 'utf8');
    if (r === 'styles.css') {
      for (const u of S.unitPragmas(text)) {
        const s = S.scanCss(text, u);
        problems.push(...S.checkAllowance(`styles.css ${u.unit}`, s.findings, s.counts, u.fields, `styles.css --range ${u.unit}`));
      }
      continue;
    }
    const s = S.scanCss(text);
    problems.push(...S.checkAllowance(r, s.findings, s.counts, S.filePragma(text), r));
  }
  return problems;
}

function runSelftest(plant) {
  const tmp = C.tmpDir('seed');
  fs.cpSync(path.join(__dirname, 'fixtures', 'measure'), tmp, { recursive: true });
  const unseeded = gateProblems(tmp);
  run(tmp, { apply: true });
  const a = fs.readFileSync(path.join(tmp, 'a.css'), 'utf8');
  if (plant) fs.appendFileSync(path.join(tmp, 'a.css'), '\n.planted { background: #fff; }\n');
  const seeded = gateProblems(tmp);
  fs.appendFileSync(path.join(tmp, 'a.css'), '\n.more { color: #000; }\n');
  const raise = plan(tmp, {});
  C.selftest('seed-allowances', [
    ['before seeding the gate is red', () => C.assert(unseeded.length > 0, 'gate was green on an unseeded tree')],
    ['a.css gets its pragma as its first line', () => C.assert(/^\/\* skin-allowance: colour=7 font=2 primary=3 \*\/\n/.test(a), a.split('\n')[0])],
    ['the clean sheet gets no pragma', () => C.assert(!/skin-allowance/.test(fs.readFileSync(path.join(tmp, 'sub', 'b.css'), 'utf8')), 'b.css was touched')],
    ['after seeding the gate is green', () => C.assert(seeded.length === 0, seeded.join('\n'))],
    ['a later literal is never seeded upward without --allow-raise', () => C.assert(raise.refused.some((x) => /a\.css: would RAISE/.test(x)), JSON.stringify(raise))],
  ]);
}

function main() {
  const o = C.args();
  if (o.help) { console.log(HELP); return; }
  if (o.selftest) { runSelftest(!!o.plant); return; }
  const root = o.root ? path.resolve(o.root) : C.SRC;
  const p = run(root, o);
  for (const c of p.changes) console.log(`${o.apply ? 'wrote ' : 'would write'} ${c.file}: ${c.before} -> ${c.after}`);
  for (const r of p.refused) console.log(`REFUSED ${r} (needs --allow-raise and a reviewer)`);
  console.log(`${p.changes.length} file(s) ${o.apply ? 'written' : 'to write'}, ${p.refused.length} refused`);
  if (p.refused.length) process.exitCode = 1;
}

if (require.main === module) main();
module.exports = { plan, run, gateProblems };
