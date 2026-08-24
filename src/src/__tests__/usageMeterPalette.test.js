/**
 * THE USAGE METER'S CSS CONTRACT — components/UsageMeter.css.
 *
 * NAMED `*Palette.test.js` AND NEVER `*Token*`: .gitignore:35 is an unanchored
 * `*token*`, so a file named for tokens is invisible to git — it passes locally
 * and never reaches CI. Do not rename it back.
 *
 * WHAT GREEN MEANS HERE. jest maps CSS to identity-obj-proxy and jsdom resolves
 * no custom property across files, so the only honest way to pin a design
 * contract is to read the stylesheet as text and do the arithmetic on it. Green
 * means the contrast, the ladder and the namespace have not been reverted. It
 * cannot prove the meter LOOKS right in a browser — only a real screen can.
 *
 * NO GEOMETRIC ASSERTIONS anywhere in this file. jsdom has no layout engine, so
 * every measured width is 0 and an assertion about one passes unconditionally.
 * The meter's fill and notch are asserted as STRINGS in usageMeter.test.jsx.
 */

const fs = require('fs');
const path = require('path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const GLOBAL_CSS = read('styles.css');
const MY_CSS = read('components', 'UsageMeter.css');

/* ---- colour: lifted verbatim from docs/design/admin-redesign/audit.html ---- */
function lin(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function lum(c) { return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]); }
function ratio(a, b) {
  const la = lum(a); const lb = lum(b);
  const h = Math.max(la, lb); const l = Math.min(la, lb);
  return (h + 0.05) / (l + 0.05);
}
function alphaOver(fg, bg, a) { return fg.map((c, i) => c * a + bg[i] * (1 - a)); }
/* Walk UP compositing every alpha layer. Reading only the element's own
   background is how dark-on-dark passes an audit. */
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

/* ---- tokens, READ rather than retyped: change a token and these numbers move ---- */
const parseHex = (h) => [1, 3, 5].map((i) => parseInt(h.substr(i, 2), 16));
function token(css, block, name) {
  const start = css.indexOf(block);
  if (start < 0) throw new Error(`no ${block} block`);
  const body = css.slice(start, css.indexOf('}', start));
  const m = body.match(new RegExp(`${name}\\s*:\\s*(#[0-9A-Fa-f]{6})`));
  if (!m) throw new Error(`${name} not declared in ${block}`);
  return m[1];
}

const ROOT = ':root {';
const DUSK = '[data-theme="dark"] {';
const T = {
  bg: token(GLOBAL_CSS, DUSK, '--bg'),
  surface: token(GLOBAL_CSS, DUSK, '--surface'),
  surface2: token(GLOBAL_CSS, DUSK, '--surface-2'),
  text: token(GLOBAL_CSS, DUSK, '--text'),
  muted: token(GLOBAL_CSS, DUSK, '--muted'),
  primary: token(GLOBAL_CSS, ROOT, '--primary'),
  success: token(GLOBAL_CSS, ROOT, '--success'),
  danger: token(GLOBAL_CSS, ROOT, '--danger'),
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
/* The two places this component is mounted: bare on the host's front door
   (the dusk field), and inside a --surface panel on Plan & usage. */
const FIELD = [T.bg];
const PANEL = [T.bg, T.surface];

// rejects: dropping --muted to a dimmer grey, or painting the value in
// --danger, or mounting the meter on a tier where its text stops clearing AA.
describe('every flat pairing the meter paints', () => {
  const pairs = [
    ['the row label, on the host front door', T.muted, FIELD],
    ['the row label, inside a panel', T.muted, PANEL],
    ['the value ("3 of 5"), on the host front door', T.text, FIELD],
    ['the value, inside a panel', T.text, PANEL],
    ['the over value ("20 · 15 over"), on the host front door', T.primary, FIELD],
    ['the over value, inside a panel', T.primary, PANEL],
    ['the notch label ("5 included"), on the host front door', T.muted, FIELD],
    ['the notch label, inside a panel', T.muted, PANEL],
  ];
  test.each(pairs)('%s clears AA', (_label, fg, layers) => {
    expect(on(fg, layers)).toBeGreaterThanOrEqual(AA);
  });
});

// rejects: painting text on the bar itself. --success is 5.58:1 against
// --surface as a FILL, but it is not a text colour and must never become one;
// the track is --surface-2, which carries --muted at only 4.93:1 in a panel.
test('the fills are fills and carry no text', () => {
  const declarations = MY_CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  expect(declarations).toMatch(/\.usg-fill\s*\{[^}]*background:\s*var\(--success\)/);
  expect(declarations).toMatch(/background:\s*var\(--primary\)/);
  expect(declarations.split('\n').filter((l) => /color:\s*var\(--success\)/.test(l))).toEqual([]);
});

// rejects: `color: var(--danger)` sneaking in as an over-limit colour. It is
// 4.38:1 on --surface — under AA — which is exactly why --danger-text exists.
test('--danger never carries text here', () => {
  expect(ratio(parseHex(T.danger), parseHex(T.surface))).toBeLessThan(AA);
  const offenders = MY_CSS.split('\n')
    .filter((l) => /(^|[^-])\bcolor\s*:\s*var\(--danger\)/.test(l));
  expect(offenders).toEqual([]);
});

// rejects: a paper-theme literal, or any hand-picked colour, surviving outside
// the token block. Comments are stripped first — a previous test in this repo
// passed on prose in a header comment.
test('no hex literal survives outside the token block', () => {
  const declarations = MY_CSS
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\.usg\s*\{[^}]*\}/, '');
  const literals = [...declarations.matchAll(/(?:^|[\s:])(#[0-9A-Fa-f]{3,8})\b/g)].map((m) => m[1]);
  expect(literals).toEqual([]);
});

// rejects: reaching for a custom property declared in a stylesheet that merely
// happens to be in the bundle. An undefined custom property invalidates the
// WHOLE declaration, silently.
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

// rejects: a bare `.meter` / `.track` / `.fill` — the mockup's own names, which
// are far too generic to put in a shared bundle.
test('every selector is rooted at the .usg scope', () => {
  expect(roots().filter((n) => !n.startsWith('usg'))).toEqual([]);
});

// rejects: the `.qs` collision repeating. styles.css already owned sixteen
// `.qs-*` names when a panel claimed that prefix, and nothing caught it.
test('styles.css declares nothing in this scope', () => {
  const global = [...stripped(GLOBAL_CSS).matchAll(/\.(usg[\w-]*)/g)].map((m) => m[1]);
  expect([...new Set(global)]).toEqual([]);
});

// rejects: importing the host stage's ladder, or shrinking the notch label to
// fit the compact strip. There is no tier below 12px on a laptop surface.
const LADDER = { floor: '12px', label: '13px', body: '15px' };
test.each(Object.entries(LADDER))('--usg-t-%s is %s', (step, value) => {
  expect(MY_CSS).toMatch(new RegExp(`--usg-t-${step}:\\s*${value}`));
});
test('nothing is declared below the 12px floor', () => {
  const px = [...MY_CSS.matchAll(/font-size:\s*(\d+)px/g)].map((m) => Number(m[1]));
  expect(px.filter((n) => n < 12)).toEqual([]);
});

// rejects: `overflow: hidden` on the track. The notch deliberately overhangs it
// by 4px top and bottom, and its label sits 17px above — clipping the track
// deletes both and the allowance stops being visible at all.
test('the track does not clip the notch that overhangs it', () => {
  const block = MY_CSS.match(/\.usg-track\s*\{([^}]*)\}/);
  expect(block).not.toBeNull();
  expect(block[1]).toMatch(/overflow:\s*visible/);
  expect(block[1]).not.toMatch(/overflow:\s*hidden/);
});

// rejects: a grid per row. With `display: grid` on each row the `auto` value
// column is sized per row, so "15 over" and "3 of 5" land at different x.
test('one grid owns every row, so the value column is a column', () => {
  expect(MY_CSS).toMatch(/\.usg\s*\{[^}]*display:\s*grid/);
  expect(MY_CSS).toMatch(/\.usg-row\s*\{\s*display:\s*contents;?\s*\}/);
});
