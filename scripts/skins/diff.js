#!/usr/bin/env node
/**
 * diff.js — pixel-compare a unit's shots against a baseline, one skin at a time.
 *
 *   node scripts/skins/diff.js --unit W3-a --skin classic --base docs/design/themes/shots/W3-a.base
 *
 * The baseline is a shoot.js run of the wave-start build (see README "Screenshots"). Uses
 * Playwright's own image comparator (pixelmatch inside, from the repo-root playwright-core,
 * no install) at threshold 0 and prints the changed-pixel count per shot. Classic must be 0
 * (or each changed shot listed in the record as an accepted Classic delta). Diff images are
 * written beside the shots as <name>.diff.png.
 */
const fs = require('fs');
const path = require('path');
const C = require('./lib/common');

const SHOTS = path.join(C.REPO, 'docs', 'design', 'themes', 'shots');
const HELP = `usage: node scripts/skins/diff.js --unit <id> --skin classic --base <dir> [--dir <dir>]

  --unit <id>     shots in docs/design/themes/shots/<id>/ (or --dir)
  --skin <id>     which skin's shots to compare (default classic)
  --base <dir>    the baseline shots (same file names)
  --tolerance <n> count a shot with <= n changed pixels as unchanged (default 0). Two runs of
                  the same build differ by ~15 px on /present navigator @1280 (the canvas fit
                  settles a sub-pixel border differently); use --tolerance 32 for /present only.
  --json          machine output
  --selftest      identical PNGs -> 0; one changed pixel -> 1
  --selftest --plant   the "identical" pair differs: must fail
  --help`;

function comparator() {
  const p = path.join(C.REPO, 'node_modules', 'playwright-core', 'lib', 'server', 'utils', 'comparators.js');
  if (!fs.existsSync(p)) throw new Error('playwright-core comparator not found in the repo-root node_modules (do not npm install in a worktree)');
  return require(p).getComparator('image/png');
}

function changedPixels(cmp, actual, expected) {
  const r = cmp(actual, expected, { threshold: 0, maxDiffPixels: 0 });
  if (!r) return { pixels: 0 };
  const m = String(r.errorMessage || '').match(/(\d+) pixels/);
  return { pixels: m ? Number(m[1]) : -1, message: r.errorMessage, diff: r.diff };
}

function run(o) {
  const dir = path.resolve(o.dir || path.join(SHOTS, o.unit || 'adhoc'));
  const base = path.resolve(o.base);
  const skin = o.skin || 'classic';
  const cmp = comparator();
  const names = fs.readdirSync(dir).filter((f) => f.endsWith(`-${skin}.png`)).sort();
  const rows = [];
  for (const n of names) {
    const b = path.join(base, n);
    if (!fs.existsSync(b)) { rows.push({ name: n, pixels: null, note: 'no baseline' }); continue; }
    const r = changedPixels(cmp, fs.readFileSync(path.join(dir, n)), fs.readFileSync(b));
    if (r.diff) fs.writeFileSync(path.join(dir, n.replace(/\.png$/, '.diff.png')), r.diff);
    rows.push({ name: n, pixels: r.pixels, note: r.pixels ? (r.message || '').split('\n')[0] : '' });
  }
  return rows;
}

function selftest(plant) {
  const { PNG } = require(path.join(C.REPO, 'node_modules', 'playwright-core', 'lib', 'utilsBundle.js'));
  const make = (w, h, dot) => {
    const p = new PNG({ width: w, height: h });
    for (let i = 0; i < w * h * 4; i += 4) { p.data[i] = 15; p.data[i + 1] = 26; p.data[i + 2] = 46; p.data[i + 3] = 255; }
    if (dot) { p.data[0] = 246; p.data[1] = 169; p.data[2] = 76; }
    return PNG.sync.write(p);
  };
  const a = C.tmpDir('diff-a'); const b = C.tmpDir('diff-b');
  fs.writeFileSync(path.join(a, 'same@375-classic.png'), make(8, 8, false));
  fs.writeFileSync(path.join(b, 'same@375-classic.png'), make(8, 8, plant));
  fs.writeFileSync(path.join(a, 'dot@375-classic.png'), make(8, 8, true));
  fs.writeFileSync(path.join(b, 'dot@375-classic.png'), make(8, 8, false));
  const rows = run({ dir: a, base: b, skin: 'classic' });
  const by = Object.fromEntries(rows.map((r) => [r.name, r.pixels]));
  C.selftest('diff', [
    ['identical shots report 0 changed pixels', () => C.assert(by['same@375-classic.png'] === 0, JSON.stringify(rows))],
    ['one changed pixel is reported as 1', () => C.assert(by['dot@375-classic.png'] === 1, JSON.stringify(rows))],
  ]);
}

function main() {
  const o = C.args();
  if (o.help) { console.log(HELP); return; }
  if (o.selftest) { selftest(!!o.plant); return; }
  if (!o.base || (!o.unit && !o.dir)) { console.log(HELP); process.exit(2); }
  const rows = run(o);
  if (o.json) { console.log(JSON.stringify(rows, null, 2)); return; }
  let changed = 0;
  for (const r of rows) {
    console.log(`${r.pixels === null ? '   n/a' : String(r.pixels).padStart(6)}  ${r.name}${r.note ? `  (${r.note})` : ''}`);
    if (r.pixels && r.pixels > Number(o.tolerance || 0)) changed += 1;
  }
  console.log(`${changed} of ${rows.length} ${o.skin || 'classic'} shot(s) changed${o.tolerance ? ` (tolerance ${o.tolerance} px)` : ''}`);
  process.exitCode = changed ? 1 : 0;
}

main();
