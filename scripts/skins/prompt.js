#!/usr/bin/env node
/**
 * prompt.js — the coordinator's door: one unit in, one paste-ready worker prompt out.
 *
 *   node scripts/skins/prompt.js --list                       units by phase, with today's counts
 *   node scripts/skins/prompt.js --unit W4-b --base <sha> --worktree <path>
 *   node scripts/skins/prompt.js --check                      no file owned twice in a phase,
 *                                                              every stylesheet owned by a wave
 *
 * The template is the text between the PROMPT markers in docs/design/themes/WORKER-PROMPT.md.
 */
const fs = require('fs');
const path = require('path');
const C = require('./lib/common');
const M = require('./lib/manifest');
const S = require('./lib/scan');
const { unitRanges } = require('./lib/units');

const TEMPLATE = path.join(C.REPO, 'docs', 'design', 'themes', 'WORKER-PROMPT.md');
const HELP = `usage: node scripts/skins/prompt.js (--unit <id> --base <ref> --worktree <path> | --list | --check)

  --unit <id>        a unit from docs/design/themes/units.json
  --base <ref>       the wave-start commit the worker branches from
  --worktree <path>  where the worker works (default: this repo)
  --list             every unit, its phase, files and today's literal counts
  --check            ownership checks (also the --selftest)
  --selftest [--plant]   the checks on the real manifest; --plant makes one file owned twice
  --help`;

function bullet(list, empty) { return list.length ? list.map((x) => `    - ${x}`).join('\n') : `    - ${empty}`; }

function countsFor(u) {
  const files = M.expandUnitFiles(u);
  const lines = [];
  for (const f of files.css) {
    const c = S.gateCounts(S.scanCss(fs.readFileSync(path.join(C.SRC, f), 'utf8')).counts);
    lines.push(`${f}: colour=${c.colour} font=${c.font} primary=${c.primary}`);
  }
  if ((u.scRanges || []).length) {
    const css = fs.readFileSync(path.join(C.SRC, 'styles.css'), 'utf8');
    const ranges = unitRanges(css);
    for (const r of u.scRanges) {
      const rg = ranges.find((x) => x.id === r);
      const c = S.gateCounts(S.scanCss(css, rg).counts);
      lines.push(`styles.css ${r}: colour=${c.colour} font=${c.font} primary=${c.primary}`);
    }
  }
  for (const f of files.jsx) {
    const n = S.scanJsx(fs.readFileSync(path.join(C.SRC, f), 'utf8')).findings.length;
    if (n) lines.push(`${f}: ${n} JSX colour literal(s)`);
  }
  return lines;
}

function fill(u, o) {
  const text = fs.readFileSync(TEMPLATE, 'utf8');
  const m = text.match(/<!-- PROMPT START -->\n([\s\S]*?)<!-- PROMPT END -->/);
  if (!m) throw new Error('no PROMPT markers in WORKER-PROMPT.md');
  const units = M.load();
  const files = M.expandUnitFiles(u);
  const t = M.testsFor(u, units);
  const themes = u.themes || ['dark'];
  const fileList = [...files.css, ...files.jsx, ...files.missing.map((x) => `${x}  (new: create it)`), ...(u.backendFiles || []).map((x) => `${x}  (backend, repo-relative)`)];
  const vals = {
    UNIT_ID: u.id, TITLE: u.title, PHASE: u.phase,
    WORKTREE: o.worktree || C.REPO, BASE_REF: o.base || '<wave-start sha>',
    FILES: bullet(fileList.map((f) => (f.startsWith('lambda') || f.includes('(new') ? f : `src/src/${f}`)), 'none (see notes)'),
    SC_RANGE: (u.scRanges || []).join(', ') || 'none',
    THEMES: themes.join(' and '), THEME_ARG: themes.length > 1 ? 'both' : themes[0],
    TOKENS_ONLY: u.tokensOnly
      ? 'TOKENS ONLY (Phase 0b): re-point --custom-property declarations; never edit a rule. Use codemod.js --report --tokens-only.'
      : 'Rules and token declarations both.',
    BEFORE: bullet(countsFor(u), 'nothing measured yet (new files)'),
    TARGET: u.target === undefined ? 'colour=0 font=0 primary=0' : u.target,
    COMPONENTS: (u.components || []).join(', ') || 'none',
    OWNED_TESTS: bullet(t.owned, 'none: write a palette test for your sheets (references/testing-a-surface.md)'),
    FOREIGN_TESTS: bullet(t.foreign, 'none'),
    ROUTES: (u.routes || []).join(', ') || 'none (static check only: classicEquivalence)',
    NOTES: u.notes || 'none',
  };
  return m[1].replace(/\{([A-Z_]+)\}/g, (all, k) => (k in vals ? vals[k] : all));
}

function checks(units) {
  const problems = M.collisions(units);
  const waves = units.filter((u) => /^W/.test(u.phase) || u.id === 'P2' || u.id === '0c');
  const owned = new Set();
  for (const u of waves) M.expandUnitFiles(u).css.forEach((f) => owned.add(f));
  // styles/roles.css is the skin mapping itself (0a), like the values files: no wave owns it.
  for (const f of C.cssFiles()) if (f !== 'styles.css' && f !== 'styles/roles.css' && !C.isSkinValuesFile(f) && !owned.has(f)) problems.push(`no wave unit owns ${f}`);
  const css = fs.readFileSync(path.join(C.SRC, 'styles.css'), 'utf8');
  const sc = new Set(units.flatMap((u) => u.scRanges || []));
  for (const r of unitRanges(css)) if (r.id !== 'SC-00' && !sc.has(r.id)) problems.push(`no unit owns styles.css ${r.id}`);
  return problems;
}

function main() {
  const o = C.args();
  if (o.help) { console.log(HELP); return; }
  const units = M.load();
  if (o.check || o.selftest) {
    if (o.plant) units.push({ id: 'PLANT', phase: 'W4', files: ['QuestionSetsPanel.css'] });
    const p = checks(units);
    C.selftest('prompt (manifest checks)', [['every file has exactly one owner per phase, every stylesheet and SC unit is owned', () => C.assert(!p.length, p.join('\n'))]]);
    return;
  }
  if (o.list) {
    let phase = null;
    for (const u of units) {
      if (u.phase !== phase) { phase = u.phase; console.log(`\n## phase ${phase}`); }
      const tot = countsFor(u).reduce((a, l) => { const mm = l.match(/colour=(\d+) font=(\d+) primary=(\d+)/); return mm ? a + Number(mm[1]) + Number(mm[2]) + Number(mm[3]) : a; }, 0);
      console.log(`${u.id.padEnd(5)} ${u.title.padEnd(42)} ${String(M.expandUnitFiles(u).css.length).padStart(3)} sheets ${(u.scRanges || []).join(',').padEnd(12)} literals+reads ${tot}`);
    }
    return;
  }
  if (!o.unit) { console.log(HELP); process.exit(2); }
  const u = units.find((x) => x.id === o.unit);
  if (!u) { console.error(`no unit ${o.unit}; try --list`); process.exit(2); }
  console.log(fill(u, o));
}

main();
