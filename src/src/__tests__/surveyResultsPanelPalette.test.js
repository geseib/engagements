/**
 * The CSS contract for components/SurveyResultsPanel.css (the console page
 * chrome: toolbar, header, loading/error states, and the open-answers
 * detail's search box and list) — Task 3 of the 2026-09-26 feature sweep.
 *
 * Same harness as surveyResultsPalette.test.js — see that file's header for
 * why a text-and-arithmetic read of the stylesheet is the only honest way to
 * pin this under jsdom. `.svrp-` is the page chrome; the KindResult cards
 * inside it (`.svr-`) are covered by surveyResultsPalette.test.js.
 */
const fs = require('fs');
const path = require('path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const GLOBAL_CSS = read('styles.css');
const MY_CSS = read('components', 'SurveyResultsPanel.css');

function lin(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }
function lum(c) { return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]); }
function ratio(a, b) {
  const la = lum(a); const lb = lum(b);
  const h = Math.max(la, lb); const l = Math.min(la, lb);
  return (h + 0.05) / (l + 0.05);
}
const parseHex = (h) => [1, 3, 5].map((i) => parseInt(h.substr(i, 2), 16));

function token(css, block, name) {
  const start = css.indexOf(block);
  if (start < 0) throw new Error(`no ${block} block`);
  const body = css.slice(start, css.indexOf('}', start));
  const m = body.match(new RegExp(`${name}\\s*:\\s*(#[0-9A-Fa-f]{6})`));
  if (!m) throw new Error(`${name} not declared in ${block}`);
  return m[1];
}

const DUSK = '[data-theme="dark"] {';
const T = {
  bg: token(GLOBAL_CSS, DUSK, '--bg'),
  surface: token(GLOBAL_CSS, DUSK, '--surface'),
  surface2: token(GLOBAL_CSS, DUSK, '--surface-2'),
  text: token(GLOBAL_CSS, DUSK, '--text'),
  muted: token(GLOBAL_CSS, DUSK, '--muted'),
  primary: token(GLOBAL_CSS, ':root {', '--primary'),
  onPrimary: token(MY_CSS, '.svrp-page {', '--svrp-on-primary'),
};

const on = (fgHex, bgHexes) => ratio(parseHex(fgHex), parseHex(bgHexes[bgHexes.length - 1]));
const AA = 4.5;

describe('flat pairings this page paints', () => {
  const pairs = [
    ['--text on --bg (the page field: h1, kpi numeral)', T.text, [T.bg]],
    ['--muted on --bg (subtitle, kpi label, empty state)', T.muted, [T.bg]],
    ['--text on --surface (a toolbar tool, the open-answers panel)', T.text, [T.bg, T.surface]],
    ['--muted on --surface (the panel note)', T.muted, [T.bg, T.surface]],
    ['--text on --surface-2 (the names chip is muted; an answer row is --text)', T.text, [T.bg, T.surface, T.surface2]],
    ['--muted on --surface-2 (the names chip, the search box)', T.muted, [T.bg, T.surface, T.surface2]],
  ];
  test.each(pairs)('%s clears AA', (_l, fg, layers) => {
    expect(on(fg, layers)).toBeGreaterThanOrEqual(AA);
  });
});

test('--svrp-on-primary on --primary (the filled "Try again" button) clears AA', () => {
  expect(on(T.onPrimary, [T.primary])).toBeGreaterThanOrEqual(AA);
});

test('--danger never carries text in this stylesheet', () => {
  const offenders = MY_CSS.split('\n')
    .filter((l) => /(^|[^-])\bcolor\s*:\s*var\(--danger\)\s*;/.test(l));
  expect(offenders).toEqual([]);
});

test('no hex literal survives outside the one documented --svrp-on-primary token', () => {
  const stripped = MY_CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  const literals = [...stripped.matchAll(/(?:^|[\s:])(#[0-9A-Fa-f]{3,8})\b/gm)].map((m) => m[1]);
  expect(literals.filter((h) => h.toUpperCase() !== '#1B2942')).toEqual([]);
  expect(literals.filter((h) => h.toUpperCase() === '#1B2942').length).toBe(1);
});

test('every custom property this stylesheet uses is declared somewhere', () => {
  const declared = new Set();
  for (const css of [GLOBAL_CSS, MY_CSS]) {
    for (const m of css.matchAll(/(--[a-z0-9-]+)\s*:/gi)) declared.add(m[1]);
  }
  const used = [...MY_CSS.matchAll(/var\((--[a-z0-9-]+)/gi)].map((m) => m[1]);
  expect([...new Set(used)].filter((n) => !declared.has(n))).toEqual([]);
});

describe('the namespace, both ways', () => {
  const stripped = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
  const roots = () => {
    const out = new Set();
    for (const blk of stripped(MY_CSS).split('}')) {
      const head = blk.split('{')[0];
      if (!head || head.includes('@')) continue;
      for (const sel of head.split(',')) {
        const m = sel.trim().match(/^[a-zA-Z]*\.([\w-]+)/);
        if (m) out.add(m[1]);
      }
    }
    return [...out];
  };

  test('every selector is rooted at .svrp', () => {
    expect(roots().filter((n) => !n.startsWith('svrp'))).toEqual([]);
  });

  test('styles.css declares nothing in the .svrp scope', () => {
    const global = [...stripped(GLOBAL_CSS).matchAll(/\.(svrp[\w-]*)/g)].map((m) => m[1]);
    expect([...new Set(global)]).toEqual([]);
  });
});

describe('the ladder', () => {
  const LADDER = {
    floor: '12px', label: '13px', body: '15px', head: '19px', title: '24px', numeral: '30px',
  };
  test.each(Object.entries(LADDER))('--svrp-t-%s is %s', (step, value) => {
    expect(MY_CSS).toMatch(new RegExp(`--svrp-t-${step}:\\s*${value}`));
  });

  test('nothing is declared below the 12px floor', () => {
    const px = [...MY_CSS.matchAll(/font-size:\s*(\d+)px/g)].map((m) => Number(m[1]));
    expect(px.filter((n) => n < 12)).toEqual([]);
  });
});

test('the root declares data-theme="dark" — a console surface, not paper', () => {
  const rendererSrc = read('components', 'SurveyResultsPanel.jsx');
  expect(rendererSrc).toMatch(/data-theme="dark"/);
});
