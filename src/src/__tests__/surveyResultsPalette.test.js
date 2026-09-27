/**
 * The CSS contract for components/survey/results/SurveyResults.css — Task 3
 * of the 2026-09-26 feature sweep.
 *
 * jest maps CSS to identity-obj-proxy and jsdom resolves no custom property,
 * so — per .claude/skills/engage-design/references/testing-a-surface.md —
 * this reads the stylesheet as TEXT and does the contrast arithmetic itself,
 * the same harness `questionSetsPalette.test.js` and `adminShellPalette.test.js`
 * use. Named `*Palette.test.js`, never `*Token*` (.gitignore:35 is an
 * unanchored `*token*` and would hide a `*Token*.test.js` from git entirely).
 *
 * A green run here means the CSS contract has not regressed — it is not proof
 * a real browser renders this legibly.
 */
const fs = require('fs');
const path = require('path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const GLOBAL_CSS = read('styles.css');
const MY_CSS = read('components', 'survey', 'results', 'SurveyResults.css');

/* ---- colour: lifted verbatim from docs/design/admin-redesign/audit.html ---- */
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
  primaryDeep: token(GLOBAL_CSS, ':root {', '--primary-deep'),
  secondary: token(GLOBAL_CSS, ':root {', '--secondary'),
  success: token(GLOBAL_CSS, ':root {', '--success'),
  danger: token(GLOBAL_CSS, ':root {', '--danger'),
  dangerDeep: token(GLOBAL_CSS, ':root {', '--danger-deep'),
  onAccent: token(MY_CSS, '.svr-card {', '--svr-on-accent'),
};

/* Composite the real paint stack: SurveyResultsPanel sets data-theme="dark"
   on its root, a card paints --surface on that field, and some elements
   (the split bars, the "Most picked" tag) paint a solid accent on the card. */
const on = (fgHex, bgHexes) => {
  // Opaque solid layers: the LAST one wins (nothing here is translucent).
  const bg = bgHexes[bgHexes.length - 1];
  return ratio(parseHex(fgHex), parseHex(bg));
};

const AA = 4.5;
const FIELD = [T.bg];
const CARD = [T.bg, T.surface];

describe('flat pairings this card paints', () => {
  const pairs = [
    ['--text on --surface (card title, body, values)', T.text, CARD],
    ['--muted on --surface (chip, count, foot notes)', T.muted, CARD],
    ['--secondary on --surface ("Read all N" link)', T.secondary, CARD],
    ['--primary on --surface (hover state of the link)', T.primary, CARD],
  ];
  test.each(pairs)('%s clears AA', (_l, fg, layers) => {
    expect(on(fg, layers)).toBeGreaterThanOrEqual(AA);
  });

  // A second, neutral surface nested inside the card: the quote/answer rows,
  // the kind chip, and the passive/not-sure split segment.
  const pairsOnSurface2 = [
    ['--text on --surface-2 (a quote, an open answer, a write-in)', T.text, [T.bg, T.surface, T.surface2]],
    ['--muted on --surface-2 (the kind chip, a quote\'s "said No")', T.muted, [T.bg, T.surface, T.surface2]],
  ];
  test.each(pairsOnSurface2)('%s clears AA', (_l, fg, layers) => {
    expect(on(fg, layers)).toBeGreaterThanOrEqual(AA);
  });
});

describe('text sitting directly on a solid accent fill (the split bars, the "Most picked" tag)', () => {
  test('--svr-on-accent on --primary (the "Most picked" tag)', () => {
    expect(on(T.onAccent, [T.primary])).toBeGreaterThanOrEqual(AA);
  });
  test('--svr-on-accent on --success (the yes / promoter segment)', () => {
    expect(on(T.onAccent, [T.success])).toBeGreaterThanOrEqual(AA);
  });
  test('--text on --danger-deep (the no / detractor segment)', () => {
    expect(on(T.text, [T.dangerDeep])).toBeGreaterThanOrEqual(AA);
  });
  test('--muted on --surface-2 (the not-sure / passive segment)', () => {
    expect(on(T.muted, [T.surface2])).toBeGreaterThanOrEqual(AA);
  });

  // rejects: reaching for the premise-breaking pairing this file exists to
  // rule out — --danger cannot carry any text colour that also clears AA on
  // --primary and --success, which is why the negative segment is
  // --danger-deep, never --danger, and the skill states this as a hard rule.
  test('the premise: no text colour usable on --primary/--success also clears AA on --danger', () => {
    expect(on(T.onAccent, [T.danger])).toBeLessThan(AA);
    expect(on(T.text, [T.danger])).toBeLessThan(AA);
  });
});

test('--primary-deep on --surface-2 fails AA, which is why the "Most picked" tag is not amber-on-neutral', () => {
  expect(on(T.primaryDeep, [T.surface2])).toBeLessThan(AA);
});

test('--danger never carries text in this stylesheet', () => {
  const offenders = MY_CSS.split('\n')
    .filter((l) => /(^|[^-])\bcolor\s*:\s*var\(--danger\)\s*;/.test(l));
  expect(offenders).toEqual([]);
});

test('no hex literal survives outside the one documented --svr-on-accent token', () => {
  const stripped = MY_CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  const literals = [...stripped.matchAll(/(?:^|[\s:])(#[0-9A-Fa-f]{3,8})\b/gm)].map((m) => m[1]);
  expect(literals.filter((h) => h.toUpperCase() !== '#1B2942')).toEqual([]);
  // And it appears exactly once — the declaration — never a second, drifted copy.
  expect(literals.filter((h) => h.toUpperCase() === '#1B2942').length).toBe(1);
});

test('every custom property this stylesheet uses is declared somewhere', () => {
  const declared = new Set();
  for (const css of [GLOBAL_CSS, MY_CSS]) {
    for (const m of css.matchAll(/(--[a-z0-9-]+)\s*:/gi)) declared.add(m[1]);
  }
  // `--n` (the histogram's column count) is set at RUNTIME, per-render, as an
  // inline `style` prop from RatingResult.jsx — the number of scale points
  // varies (5, 10 or 11), so no stylesheet could declare it. A text scan of
  // the CSS files alone cannot see a React inline style; allow-listed here,
  // by name, rather than widening the declared set silently.
  declared.add('--n');
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

  test('every selector is rooted at .svr', () => {
    expect(roots().filter((n) => !n.startsWith('svr'))).toEqual([]);
  });

  test('styles.css declares nothing in the .svr scope', () => {
    const global = [...stripped(GLOBAL_CSS).matchAll(/\.(svr[\w-]*)/g)].map((m) => m[1]);
    expect([...new Set(global)]).toEqual([]);
  });
});

describe('the ladder', () => {
  const LADDER = { floor: '12px', label: '13px', body: '15px', head: '19px', numeral: '30px' };
  test.each(Object.entries(LADDER))('--svr-t-%s is %s', (step, value) => {
    expect(MY_CSS).toMatch(new RegExp(`--svr-t-${step}:\\s*${value}`));
  });

  test('nothing is declared below the 12px floor', () => {
    const px = [...MY_CSS.matchAll(/font-size:\s*(\d+)px/g)].map((m) => Number(m[1]));
    expect(px.filter((n) => n < 12)).toEqual([]);
  });
});

test('no data-theme is declared here — the ancestor decides it (Task 4 mounts these in a light one)', () => {
  const stripped = MY_CSS.replace(/\/\*[\s\S]*?\*\//g, ''); // strip comments; this header names data-theme in prose
  expect(stripped).not.toMatch(/data-theme/);
});
