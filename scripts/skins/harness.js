#!/usr/bin/env node
/**
 * harness.js — the command-line face of src/src/testing/skinHarness.js.
 *
 * Ask what a role resolves to, and where from, without writing a test:
 *   node scripts/skins/harness.js --role --accent-text --skin present --theme dark
 *   node scripts/skins/harness.js --role --action --skin present --surface wall --explain
 *   node scripts/skins/harness.js --all --skin classic --theme light
 * and run the harness self-test: every role in both skins x both themes against a fixture
 * copy of SPEC.md §4 (scripts/skins/fixtures/spec-skins/).
 */
const fs = require('fs');
const path = require('path');
const C = require('./lib/common');
const H = require('../../src/src/testing/skinHarness');

const HELP = `usage: node scripts/skins/harness.js [options]

  --role <--name>      print the resolved value
  --all                print every custom property that resolves at this skin x theme
  --skin <id>          classic (default) | present | …   (must have styles/skins/<id>.css)
  --theme dark|light   default dark
  --surface wall       resolve under [data-surface="wall"]
  --profile d-call     resolve under a display profile class on <html>
  --explain            also print which file and selector won
  --root <dir>         another src/src (e.g. scripts/skins/fixtures/spec-skins/src)
  --selftest           SPEC §4 fixture: every row and every quoted ratio must match
  --selftest --plant   same, with Present's dusk --accent-text planted back to #7CA7E6 (must fail)
  --help`;

const near = (a, b) => Math.abs(a - b) < 0.011;

function same(actual, expected) {
  try {
    const a = H.parseColor(actual); const e = H.parseColor(expected);
    return a.rgb.every((v, i) => Math.abs(v - e.rgb[i]) < 0.5) && Math.abs(a.a - e.a) < 0.001;
  } catch (_) {
    const norm = (s) => String(s).replace(/\s+/g, ' ').replace(/\s*,\s*/g, ', ').trim().toLowerCase();
    return norm(actual) === norm(expected);
  }
}

function runSelftest(plant) {
  const fixture = path.join(__dirname, 'fixtures', 'spec-skins');
  const tmp = C.tmpDir('harness');
  fs.cpSync(path.join(fixture, 'src'), tmp, { recursive: true });
  if (plant) {
    const p = path.join(tmp, 'styles', 'skins', 'present.css');
    fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace('--sk-dark-accent-text: #9CBEF0', '--sk-dark-accent-text: #7CA7E6'));
  }
  const X = H.create(tmp);
  const spec = JSON.parse(fs.readFileSync(path.join(fixture, 'expected.json'), 'utf8'));
  const cases = [
    ['SKINS come from config/skins.js', () => C.assert(X.SKINS.join() === 'classic,present', X.SKINS.join())],
    ['CASES are both skins x both themes', () => C.assert(X.CASES.length === 4, JSON.stringify(X.CASES))],
  ];
  for (const [role, skin, theme, want, extra] of spec.rows) {
    const opts = { skin, theme, ...(extra || {}) };
    cases.push([`${role} ${skin}/${theme}${extra ? ` ${JSON.stringify(extra)}` : ''} = ${want}`, () => {
      const got = X.role(role, opts);
      C.assert(same(got, want), `got ${got} (from ${X.explain(role, opts)})`);
    }]);
  }
  for (const [label, skin, theme, fg, layers, want] of spec.ratios) {
    cases.push([`${label} = ${want}`, () => {
      const r = X.on(X.role(fg, { skin, theme }), layers.map((l) => (l.startsWith('--') ? X.role(l, { skin, theme }) : l)));
      C.assert(near(r, want), `measured ${r.toFixed(3)}`);
    }]);
  }
  cases.push(['the --k trap is modelled: a skin value that reads a ROLE resolves on <html> (paper)', () => {
    const t2 = C.tmpDir('harness-trap');
    fs.cpSync(path.join(fixture, 'src'), t2, { recursive: true });
    const p = path.join(t2, 'styles', 'skins', 'classic.css');
    fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace('--sk-dark-eyebrow-color: var(--sk-dark-muted)', '--sk-dark-eyebrow-color: var(--muted)'));
    const got = H.create(t2).role('--eyebrow-color', { skin: 'classic', theme: 'dark' });
    C.assert(same(got, '#5E6167'), `expected the PAPER muted (the bug), got ${got}`);
  }]);
  cases.push(['an unknown skin throws instead of quietly returning Classic', () => {
    let threw = false; try { X.role('--bg', { skin: 'nope' }); } catch (_) { threw = true; }
    C.assert(threw, 'did not throw');
  }]);
  cases.push(['today\'s tree (no skin files): Classic dusk --bg is #0F1A2E, --primary #F6A94C', () => {
    C.assert(H.role('--bg', { theme: 'dark' }) === '#0F1A2E' || H.SOURCES.length > 1, H.role('--bg', { theme: 'dark' }));
    C.assert(same(H.role('--primary'), '#F6A94C'), H.role('--primary'));
  }]);
  C.selftest('skinHarness', cases);
}

function main() {
  const o = C.args();
  if (o.help) { console.log(HELP); return; }
  if (o.selftest) { runSelftest(!!o.plant); return; }
  const X = o.root ? H.create(path.resolve(o.root)) : H;
  const opts = { skin: o.skin || 'classic', theme: o.theme || 'dark' };
  if (o.surface) opts.surface = o.surface;
  if (o.profile) opts.profile = o.profile;
  if (o.role) {
    console.log(X.role(o.role, opts));
    if (o.explain) console.log(`  from ${X.explain(o.role, opts)}`);
    return;
  }
  if (o.all) {
    console.log(`sources: ${X.SOURCES.join(', ')} · skins: ${X.SKINS.join(', ')}`);
    const names = new Set();
    for (const src of X.SOURCES) for (const m of X.css(src).matchAll(/(--[\w-]+)\s*:/g)) names.add(m[1]);
    for (const n of [...names].sort()) {
      try { console.log(`${n}: ${X.role(n, opts)}`); } catch (_) { /* scope-only property */ }
    }
    return;
  }
  console.log(HELP);
}

main();
