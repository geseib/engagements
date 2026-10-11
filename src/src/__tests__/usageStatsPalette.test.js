/**
 * THE USAGE STATS SCREENS' CSS CONTRACT — components/UsageStatsPanel.css.
 *
 * Read as text and measured, the way every *Palette test here works (jsdom
 * resolves no custom property). Named `*Palette`, never `*Token*`:
 * `.gitignore` drops any file named for tokens.
 *
 * WHAT GREEN MEANS: the contrast arithmetic holds, the one orange is one,
 * the scope is the screen's own, and the narrow layout's stacking rules are
 * still there. It cannot prove the layout fits at 375px — that was measured
 * in a browser (docs/handoff/usage-stats-2026-10-11.md).
 */
const fs = require('fs');
const path = require('path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const GLOBAL_CSS = read('styles.css');
const MY_CSS = read('components', 'UsageStatsPanel.css');
const PANEL = read('components', 'UsageStatsPanel.jsx');
const DRILL = read('components', 'StaffStatsDrill.jsx');
const SECTIONS = read('config', 'consoleSections.js');

function lin(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function lum(c) { return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]); }
function ratio(a, b) {
  const la = lum(a); const lb = lum(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
const parseHex = (h) => [1, 3, 5].map((i) => parseInt(h.substr(i, 2), 16));
function token(css, blk, name) {
  const start = css.indexOf(blk);
  const body = css.slice(start, css.indexOf('}', start));
  const m = body.match(new RegExp(`${name}\\s*:\\s*(#[0-9A-Fa-f]{6})`));
  if (!m) throw new Error(`${name} not declared in ${blk}`);
  return parseHex(m[1]);
}
function tint(name) {
  const m = MY_CSS.match(new RegExp(`${name}\\s*:\\s*rgba\\(([^)]*)\\)`));
  if (!m) throw new Error(`${name} not declared`);
  const [r, g, b, a] = m[1].split(',').map((x) => parseFloat(x));
  return { rgb: [r, g, b], a };
}
const over = (layer, bg) => layer.rgb.map((c, i) => c * layer.a + bg[i] * (1 - layer.a));

const ROOT = ':root {';
const DUSK = '[data-theme="dark"] {';
const T = {
  bg: token(GLOBAL_CSS, DUSK, '--bg'),
  surface: token(GLOBAL_CSS, DUSK, '--surface'),
  text: token(GLOBAL_CSS, DUSK, '--text'),
  muted: token(GLOBAL_CSS, DUSK, '--muted'),
  primary: token(GLOBAL_CSS, ROOT, '--primary'),
  secondary: token(GLOBAL_CSS, ROOT, '--secondary'),
  dangerText: token(GLOBAL_CSS, ROOT, '--danger-text'),
};
const AA = 4.5;
const stripped = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
function block(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = stripped(css).match(new RegExp(`(^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`, 'm'));
  if (!m) throw new Error(`No rule for "${selector}"`);
  return m[2];
}

describe('measured contrast', () => {
  const blue = over(tint('--ust-tint-blue'), T.bg);
  const pairs = [
    ['numbers and names on the field', T.text, T.bg],
    ['heads, labels and dims on the field', T.muted, T.bg],
    ['a tile numeral', T.text, T.surface],
    ['a tile label', T.muted, T.surface],
    ['links (blue) on the field', T.secondary, T.bg],
    ['the counting-since note on its blue tint', T.text, blue],
    ['muted words on the blue tint', T.muted, blue],
    ['Download CSV: the field colour on amber', T.bg, T.primary],
    ['a refused load on its danger tint', T.dangerText, over(tint('--ust-tint-danger'), T.bg)],
  ];
  test.each(pairs)('%s clears AA', (_l, fg, bg) => {
    expect(ratio(fg, bg)).toBeGreaterThanOrEqual(AA);
  });
});

describe('one orange per screen', () => {
  // rejects: a second amber control — the owner's one-orange rule.
  test('only the primary button paints --primary', () => {
    const uses = stripped(MY_CSS).split('}').filter((b) => /var\(--primary\)/.test(b)).map((b) => b.split('{')[0].trim());
    expect(uses).toEqual(['.ust-btn--primary']);
  });
  // Each staff place (the platform block, a team, an account, a set) is its
  // own screen with one Download CSV; staffStatsDrill.test.jsx counts the
  // rendered buttons per screen.
  test('the team page carries the primary class once; each staff place once', () => {
    expect((PANEL.match(/ust-btn--primary/g) || []).length).toBe(1);
    expect((DRILL.match(/ust-btn--primary/g) || []).length).toBe(4);
  });
});

describe('the scope', () => {
  test('every selector is rooted at .ust', () => {
    const roots = new Set();
    for (const b of stripped(MY_CSS).split('}')) {
      const head = b.split('{')[0];
      if (!head || head.includes('@')) continue;
      for (const sel of head.split(',')) {
        const m = sel.trim().match(/^[a-zA-Z]*\.([\w-]+)/);
        if (m) roots.add(m[1]);
      }
    }
    expect([...roots].filter((n) => !n.startsWith('ust'))).toEqual([]);
  });
  test('styles.css declares nothing in this scope', () => {
    expect([...stripped(GLOBAL_CSS).matchAll(/\.(ust[\w-]*)/g)]).toEqual([]);
  });
  test('no hex literal, and --danger never carries text', () => {
    expect([...stripped(MY_CSS).matchAll(/(?:^|[\s:])(#[0-9A-Fa-f]{3,8})\b/g)]).toEqual([]);
    expect(/(^|[^-])\bcolor\s*:\s*var\(--danger\)/.test(MY_CSS)).toBe(false);
  });
  test('every custom property used is declared', () => {
    const declared = new Set();
    for (const css of [GLOBAL_CSS, MY_CSS]) for (const m of css.matchAll(/(--[a-z0-9-]+)\s*:/gi)) declared.add(m[1]);
    const used = [...MY_CSS.matchAll(/var\((--[a-z0-9-]+)/gi)].map((m) => m[1]);
    expect([...new Set(used)].filter((n) => !declared.has(n))).toEqual([]);
  });
  test('the section is mounted dark, and the root says so itself', () => {
    expect(SECTIONS).toMatch(/activity:\s*\{[^}]*contentTheme:\s*'dark'/);
    expect(PANEL).toMatch(/className="ust" data-theme="dark"/);
  });
});

describe('the ladder and the rows', () => {
  test('12/13/15/19/24/30, rows 36px', () => {
    for (const [step, v] of [['floor', 12], ['label', 13], ['body', 15], ['head', 19], ['title', 24], ['numeral', 30]]) {
      expect(MY_CSS).toMatch(new RegExp(`--ust-t-${step}:\\s*${v}px`));
    }
    expect(MY_CSS).toMatch(/--ust-row-h:\s*36px/);
    expect(block(MY_CSS, '.ust-tbl td')).toMatch(/height:\s*var\(--ust-row-h\)/);
  });
  test('no font size bypasses the ladder', () => {
    const px = [...stripped(MY_CSS).matchAll(/font(?:-size)?:[^;]*?(\d+)px/g)].map((m) => Number(m[1]));
    expect(px).toEqual([]);
  });
});

describe('laptops, tablets and phones', () => {
  // rejects: a fixed canvas, or a table that scrolls the page sideways.
  test('the root is a container and the tables are fixed-layout', () => {
    expect(block(MY_CSS, '.ust')).toMatch(/container-type:\s*inline-size/);
    expect(block(MY_CSS, '.ust-tbl')).toMatch(/table-layout:\s*fixed/);
    expect(stripped(MY_CSS)).not.toMatch(/min-width:\s*[1-9]\d*px/);
  });
  test('under 600px every table row stacks into labelled lines', () => {
    const narrow = stripped(MY_CSS).split('@container (max-width: 600px)')[1] || '';
    expect(narrow).toMatch(/\.ust-tbl thead\s*\{\s*display:\s*none/);
    expect(narrow).toMatch(/content:\s*attr\(data-l\)/);
    expect(narrow).toMatch(/\.ust-tiles\s*\{\s*grid-template-columns:\s*repeat\(2/);
  });
  test('the bar pushes its control right by margin, never flex-end', () => {
    expect(block(MY_CSS, '.ust-bar')).not.toMatch(/justify-content:\s*flex-end/);
    expect(block(MY_CSS, '.ust-bar > :first-child')).toMatch(/margin-right:\s*auto/);
  });
});
