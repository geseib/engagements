/**
 * PLAN & USAGE — the CSS contract for components/BillingPanel.css.
 *
 * NAMED `*Palette.test.js` AND NEVER `*Token*`: .gitignore:35 is an unanchored
 * `*token*`, so a file named for tokens is invisible to git — it passes locally
 * and never reaches CI. Do not rename it back.
 *
 * WHAT GREEN MEANS. jest maps CSS to identity-obj-proxy and jsdom resolves no
 * custom property across files, so the only honest way to pin a design contract
 * here is to read the stylesheet as text and do the arithmetic on it. Green
 * means the contrast, the ladder, the namespace and the two geometry traps have
 * not been reverted. It cannot prove the screen LOOKS right in a browser.
 *
 * NO GEOMETRIC ASSERTIONS. jsdom has no layout engine; every measured width is
 * 0 and an assertion about one passes unconditionally.
 */

const fs = require('fs');
const path = require('path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const GLOBAL_CSS = read('styles.css');
const MY_CSS = read('components', 'BillingPanel.css');
const MY_JSX = read('components', 'BillingPanel.jsx');

/* ---- colour: lifted verbatim from docs/design/admin-redesign/audit.html ---- */
function lin(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function lum(c) { return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]); }
function ratio(a, b) {
  const la = lum(a); const lb = lum(b);
  const h = Math.max(la, lb); const l = Math.min(la, lb);
  return (h + 0.05) / (l + 0.05);
}
function alphaOver(fg, bg, a) { return fg.map((c, i) => c * a + bg[i] * (1 - a)); }
function bgOf(el, win) {
  let node = el; const stack = [];
  while (node && node.nodeType === 1) {
    const c = win.getComputedStyle(node).backgroundColor;
    const m = String(c).match(/[\d.]+/g);
    if (m) {
      const a = m.length > 3 ? parseFloat(m[3]) : 1;
      if (a > 0) { stack.push([m.slice(0, 3).map(Number), a]); if (a >= 0.999) break; }
    }
    node = node.parentElement;
  }
  if (!stack.length) return [15, 26, 46];
  let out = stack[stack.length - 1][0];
  for (let i = stack.length - 2; i >= 0; i -= 1) out = alphaOver(stack[i][0], out, stack[i][1]);
  return out;
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
/* An rgba() layer, read from MY_CSS so a change to the tint moves these
   numbers instead of quietly invalidating the test. */
function tint(name) {
  const m = MY_CSS.match(new RegExp(`${name}\\s*:\\s*(rgba\\([^)]*\\))`));
  if (!m) throw new Error(`${name} not declared in BillingPanel.css`);
  return m[1];
}

const ROOT = ':root {';
const DUSK = '[data-theme="dark"] {';
const T = {
  bg: token(GLOBAL_CSS, DUSK, '--bg'),
  surface: token(GLOBAL_CSS, DUSK, '--surface'),
  text: token(GLOBAL_CSS, DUSK, '--text'),
  muted: token(GLOBAL_CSS, DUSK, '--muted'),
  primary: token(GLOBAL_CSS, ROOT, '--primary'),
  danger: token(GLOBAL_CSS, ROOT, '--danger'),
  dangerText: token(GLOBAL_CSS, ROOT, '--danger-text'),
};

function composited(layers) {
  document.body.innerHTML = '';
  let host = document.body;
  for (const background of layers) {
    const el = document.createElement('div');
    el.style.backgroundColor = background;
    host.appendChild(el);
    host = el;
  }
  return bgOf(host, window);
}
const on = (fgHex, layers) => ratio(parseHex(fgHex), composited(layers));

const AA = 4.5;
const FIELD = [T.bg];                 // AdminShell's dark work body
const PANEL = [T.bg, T.surface];      // a .bill-panel on that field

// rejects: any pairing this screen paints falling under AA — including the
// filled primary, which is the ONE control on the free screen.
describe('every flat pairing this screen paints', () => {
  const pairs = [
    ['the screen title and the table values', T.text, FIELD],
    ['the subtitle and the column heads', T.muted, FIELD],
    ['panel copy, the invoice lines, the total', T.text, PANEL],
    ['the `why` line under each invoice line', T.muted, PANEL],
    ['the over value carried through from the meter', T.primary, PANEL],
    ['a failed load', T.dangerText, PANEL],
    ['"Create a team" — --bg on the filled primary', T.bg, [T.primary]],
    ['its hover', T.bg, ['#FFBB66']],
  ];
  test.each(pairs)('%s clears AA', (_label, fg, layers) => {
    expect(on(fg, layers)).toBeGreaterThanOrEqual(AA);
  });
});

// rejects: a tint that looks harmless in a token table and eats the copy on
// top of it. Each stack below is the REAL nesting on the screen.
describe('every tinted composite', () => {
  test('the amber warn box, inside a panel — the overage and the limit', () => {
    const stack = [T.bg, T.surface, tint('--bill-tint-warn')];
    expect(on(T.text, stack)).toBeGreaterThanOrEqual(AA);
    expect(on(T.muted, stack)).toBeGreaterThanOrEqual(AA);
    expect(on(T.primary, stack)).toBeGreaterThanOrEqual(AA);
  });
  test('the plain note box, inside a panel', () => {
    const stack = [T.bg, T.surface, tint('--bill-tint-note')];
    expect(on(T.text, stack)).toBeGreaterThanOrEqual(AA);
    expect(on(T.muted, stack)).toBeGreaterThanOrEqual(AA);
  });
  test('the closing "nothing is interrupted" box, on the bare field', () => {
    const stack = [T.bg, tint('--bill-tint-note')];
    expect(on(T.text, stack)).toBeGreaterThanOrEqual(AA);
    expect(on(T.muted, stack)).toBeGreaterThanOrEqual(AA);
  });
  test('the failed-load box', () => {
    const stack = [T.bg, tint('--bill-tint-danger')];
    expect(on(T.dangerText, stack)).toBeGreaterThanOrEqual(AA);
    expect(on(T.text, stack)).toBeGreaterThanOrEqual(AA);
  });
  test('a hovered row of Recent periods', () => {
    const stack = [T.bg, tint('--bill-row-hover')];
    expect(on(T.text, stack)).toBeGreaterThanOrEqual(AA);
    expect(on(T.muted, stack)).toBeGreaterThanOrEqual(AA);
  });
});

// rejects: --danger carrying copy. 4.38:1 on --surface, under AA — which is
// exactly why --danger-text exists. --danger keeps borders and tints.
test('--danger never carries text here', () => {
  expect(ratio(parseHex(T.danger), parseHex(T.surface))).toBeLessThan(AA);
  const offenders = MY_CSS.split('\n')
    .filter((l) => /(^|[^-])\bcolor\s*:\s*var\(--danger\)/.test(l));
  expect(offenders).toEqual([]);
});

// rejects: a hand-picked colour outside the token block. #FFBB66 is allowed BY
// NAME: styles.css has no lighter-amber token and QuestionSetsPanel.css:181
// already settled on this exact value for the same hover.
test('no hex literal survives outside the token block', () => {
  const declarations = MY_CSS
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\.bill\s*\{[^}]*\}/, '');
  const literals = [...declarations.matchAll(/(?:^|[\s:])(#[0-9A-Fa-f]{3,8})\b/g)].map((m) => m[1]);
  expect(literals.filter((h) => h.toUpperCase() !== '#FFBB66')).toEqual([]);
});

// rejects: borrowing a token from a stylesheet that merely happens to be in the
// bundle. An undefined custom property invalidates the WHOLE declaration.
test('every custom property the stylesheet uses is declared somewhere', () => {
  const declared = new Set();
  for (const css of [GLOBAL_CSS, MY_CSS]) {
    for (const m of css.matchAll(/(--[a-z0-9-]+)\s*:/gi)) declared.add(m[1]);
  }
  const used = [...MY_CSS.matchAll(/var\((--[a-z0-9-]+)/gi)].map((m) => m[1]);
  expect([...new Set(used)].filter((n) => !declared.has(n))).toEqual([]);
});

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

// rejects: a bare `.panel` / `.btn` / `.calc` / `.tbl` / `.note-box` — the
// mockup's own names, every one of which styles.css or the host stage owns.
test('every selector is rooted at the .bill scope', () => {
  expect(roots().filter((n) => !n.startsWith('bill'))).toEqual([]);
});

// rejects: the `.qs` collision repeating one prefix later.
test('styles.css declares nothing in this scope', () => {
  const global = [...stripped(GLOBAL_CSS).matchAll(/\.(bill[\w-]*)/g)].map((m) => m[1]);
  expect([...new Set(global)]).toEqual([]);
});

// rejects: importing the host stage's ladder onto a laptop surface, or dropping
// a tier below the 12px floor.
const LADDER = {
  floor: '12px', label: '13px', body: '15px', head: '19px', title: '24px', numeral: '30px',
};
test.each(Object.entries(LADDER))('--bill-t-%s is %s', (step, value) => {
  expect(MY_CSS).toMatch(new RegExp(`--bill-t-${step}:\\s*${value}`));
});
test('nothing is declared below the 12px floor', () => {
  const px = [...MY_CSS.matchAll(/font-size:\s*(\d+)px/g)].map((m) => Number(m[1]));
  expect(px.filter((n) => n < 12)).toEqual([]);
});
test('rows are 36px, because cards were rejected', () => {
  expect(MY_CSS).toMatch(/--bill-row-h:\s*36px/);
});

// rejects: spending the 30px display tier twice. A panel gets ONE display
// number, and here it is the total — the figure the whole screen is about.
test('--bill-t-numeral is spent exactly once, on the total', () => {
  const uses = [...stripped(MY_CSS).matchAll(/var\(--bill-t-numeral\)/g)];
  expect(uses).toHaveLength(1);
  expect(stripped(MY_CSS)).toMatch(/\.bill-bignum\s*\{[^}]*var\(--bill-t-numeral\)/);
});

// rejects: `table-layout: auto`, under which the declared widths are hints and
// one nowrap cell sets a min-content width that grows the whole table.
test('every table is table-layout: fixed', () => {
  for (const sel of ['.bill-calc', '.bill-tbl']) {
    const block = stripped(MY_CSS).match(new RegExp(`\\${sel}\\s*\\{([^}]*)\\}`));
    expect(block).not.toBeNull();
    expect(block[1]).toMatch(/table-layout:\s*fixed/);
  }
});

// rejects: `justify-content: flex-end` on the row action group. Flex-end
// overflows toward the START of the cell, where an `overflow: hidden` clip is
// unreachable — see __tests__/rowActionsReachable.test.js for the original.
test('the row action group is pushed right by margin, never by flex-end', () => {
  const block = stripped(MY_CSS).match(/\.bill-rowacts\s*\{([^}]*)\}/);
  expect(block).not.toBeNull();
  expect(block[1]).not.toMatch(/justify-content:\s*flex-end/);
  expect(stripped(MY_CSS)).toMatch(/\.bill-rowacts\s*>\s*:first-child\s*\{[^}]*margin-left:\s*auto/);
  expect(block[1]).toMatch(/flex-wrap:\s*wrap/);
});

// rejects: letting the surface inherit its theme. index.html puts
// data-theme="light" on <html>, so a dusk panel that does not declare its own
// renders #F4EDE4 on #FBF7F1.
test('the panel declares its own theme on its root, and defaults to dusk', () => {
  expect(MY_JSX).toMatch(/theme\s*=\s*'dark'/);
  expect(MY_JSX).toMatch(/data-theme=\{theme\}/);
});
