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
const H = require('../testing/skinHarness');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const GLOBAL_CSS = require('../testing/classicGlobalCss')();
const MY_CSS = read('components', 'SurveyResultsPanel.css');

/*
 * EVERY SKIN, DUSK ONLY. The page root declares data-theme="dark" (asserted at
 * the foot of this file), so the paper column of H.CASES is not a surface this
 * sheet paints and is left out on purpose.
 */
const DUSK_CASES = H.CASES.filter(([, theme]) => theme === 'dark');

const palette = (skin, theme) => {
  const opts = { skin, theme };
  return {
    bg: H.role('--bg', opts),
    surface: H.role('--surface', opts),
    surface2: H.role('--surface-2', opts),
    text: H.role('--text', opts),
    muted: H.role('--muted', opts),
    primary: H.role('--primary', opts),
    onPrimary: H.scopeVar(MY_CSS, '.svrp-page {', '--svrp-on-primary', opts),
  };
};

describe.each(DUSK_CASES)('%s / %s: flat pairings this page paints', (skin, theme) => {
  const T = palette(skin, theme);
  const pairs = [
    ['--text on --bg (the page field: h1, kpi numeral)', T.text, [T.bg]],
    ['--muted on --bg (subtitle, kpi label, empty state)', T.muted, [T.bg]],
    ['--text on --surface (a toolbar tool, the open-answers panel)', T.text, [T.bg, T.surface]],
    ['--muted on --surface (the panel note)', T.muted, [T.bg, T.surface]],
    ['--text on --surface-2 (the names chip is muted; an answer row is --text)', T.text, [T.bg, T.surface, T.surface2]],
    ['--muted on --surface-2 (the names chip, the search box)', T.muted, [T.bg, T.surface, T.surface2]],
  ];
  test.each(pairs)('%s clears AA', (_l, fg, layers) => {
    expect(H.on(fg, layers)).toBeGreaterThanOrEqual(H.AA);
  });

  test('--svrp-on-primary on --primary (the filled "Try again" button) clears AA', () => {
    expect(H.on(T.onPrimary, [T.primary])).toBeGreaterThanOrEqual(H.AA);
  });

  test('--svrp-on-primary reads the --on-accent role, Classic keeping #1B2942', () => {
    expect(T.onPrimary.toUpperCase()).toBe(H.role('--on-accent', { skin, theme }).toUpperCase());
    if (skin === 'classic') expect(T.onPrimary.toUpperCase()).toBe('#1B2942');
  });
});

test('--danger never carries text in this stylesheet', () => {
  const offenders = MY_CSS.split('\n')
    .filter((l) => /(^|[^-])\bcolor\s*:\s*var\(--danger\)\s*;/.test(l));
  expect(offenders).toEqual([]);
});

test('no hex literal survives: --svrp-on-primary reads --on-accent since 0b-4', () => {
  const stripped = MY_CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  const literals = [...stripped.matchAll(/(?:^|[\s:])(#[0-9A-Fa-f]{3,8})\b/gm)].map((m) => m[1]);
  expect(literals).toEqual([]);
  expect(stripped).toMatch(/--svrp-on-primary:\s*var\(--on-accent\)/);
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
