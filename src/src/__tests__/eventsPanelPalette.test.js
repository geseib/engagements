/**
 * THE EVENTS PLACE'S CSS CONTRACT — components/EventsPanel.css.
 *
 * jest maps CSS to identity-obj-proxy and jsdom resolves no custom property,
 * so the contract is pinned by reading the stylesheet AS TEXT and doing the
 * arithmetic (.claude/skills/engage-design/references/testing-a-surface.md).
 * Tokens are READ from styles.css, never retyped: change one and these
 * numbers move. `bgOf` is the audit's own compositing walk
 * (docs/design/admin-redesign/audit.html).
 *
 * Named `*Palette`, never `*Token*`: `.gitignore:35` is an unanchored
 * `*token*`, and a file named for tokens never reaches CI.
 *
 * WHAT GREEN MEANS: the arithmetic holds and the rules jsdom cannot see have
 * not been reverted. It cannot prove the screen reads well on a real panel.
 */
const fs = require('fs');
const path = require('path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const GLOBAL_CSS = read('styles.css');
const MY_CSS = read('components', 'EventsPanel.css');
const stripped = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

function lin(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function lum(c) { return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]); }
function ratio(a, b) {
  const la = lum(a); const lb = lum(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
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
function tint(name) {
  const m = MY_CSS.match(new RegExp(`${name}\\s*:\\s*(rgba\\([^)]*\\))`));
  if (!m) throw new Error(`${name} not declared in EventsPanel.css`);
  return m[1];
}
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
  onAccent: token(MY_CSS, '.evts {', '--evts-on-accent'),
};
const AA = 4.5;
const FIELD = [T.bg];
const PANEL = [T.bg, T.surface];

describe('the flat pairings this place paints', () => {
  test.each([
    ['names, dates and codes on the work field', T.text, FIELD],
    ['places, column heads and counts on the work field', T.muted, FIELD],
    ['dialog copy on the dialog surface', T.text, PANEL],
    ['dialog hints on the dialog surface', T.muted, PANEL],
    ['a name hovered amber on the field', T.primary, FIELD],
    ['the ink on a filled amber button', T.onAccent, [T.primary]],
  ])('%s clears AA', (_label, fg, layers) => {
    expect(on(fg, layers)).toBeGreaterThanOrEqual(AA);
  });
});

describe('the tinted composites', () => {
  test('a selected option in the dialog (amber tint on the surface, over --bg)', () => {
    // .evts-opt paints --bg itself, so the walk stops there: [bg, surface, bg, tint].
    expect(on(T.text, [T.bg, T.surface, T.bg, tint('--evts-row-sel')])).toBeGreaterThanOrEqual(AA);
    expect(on(T.muted, [T.bg, T.surface, T.bg, tint('--evts-row-sel')])).toBeGreaterThanOrEqual(AA);
  });
  test('the pressed filter and a hovered row, on the field', () => {
    expect(on(T.text, [T.bg, tint('--evts-row-sel')])).toBeGreaterThanOrEqual(AA);
    expect(on(T.muted, [T.bg, tint('--evts-row-hover')])).toBeGreaterThanOrEqual(AA);
  });
  test('the note in the dialog, and an error on its tint', () => {
    expect(on(T.muted, [T.bg, T.surface, tint('--evts-tint-note')])).toBeGreaterThanOrEqual(AA);
    expect(on(T.dangerText, [T.bg, T.surface, tint('--evts-tint-danger')])).toBeGreaterThanOrEqual(AA);
    expect(on(T.dangerText, [T.bg, tint('--evts-tint-danger')])).toBeGreaterThanOrEqual(AA);
  });
});

describe('the contract', () => {
  test('the ladder, the 12px floor and the 48px two-line rows', () => {
    for (const [step, px] of [['floor', 12], ['label', 13], ['body', 15], ['head', 19]]) {
      expect(MY_CSS).toMatch(new RegExp(`--evts-t-${step}:\\s*${px}px`));
    }
    expect(MY_CSS).toMatch(/--evts-row-h:\s*48px/);
    const sizes = [...stripped(MY_CSS).matchAll(/font-size:\s*(\d+)px/g)].map((m) => Number(m[1]));
    sizes.forEach((n) => expect(n).toBeGreaterThanOrEqual(12));
  });
  test('every selector is rooted at .evts, and styles.css declares nothing there', () => {
    const selectors = stripped(MY_CSS).match(/^[^\s@}][^{]*(?=\{)/gm) || [];
    expect(selectors.length).toBeGreaterThan(20);
    selectors.forEach((sel) => sel.split(',').forEach((s) => expect(s.trim()).toMatch(/^\.evts(\b|-|\.|\s|:)/)));
    expect(stripped(GLOBAL_CSS)).not.toMatch(/\.evts\b/);
  });
  test('no hex outside the token block, and --danger never carries text', () => {
    const css = stripped(MY_CSS);
    const start = css.indexOf('.evts {');
    const outside = css.slice(0, start) + css.slice(css.indexOf('}', start));
    expect(outside).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(css.split('\n').filter((l) => /(^|[^-])\bcolor\s*:\s*var\(--danger\)/.test(l))).toEqual([]);
  });
  test('every custom property used is declared somewhere', () => {
    const declared = new Set();
    for (const css of [GLOBAL_CSS, MY_CSS]) for (const m of css.matchAll(/(--[a-z0-9-]+)\s*:/gi)) declared.add(m[1]);
    const used = [...MY_CSS.matchAll(/var\((--[a-z0-9-]+)/gi)].map((m) => m[1]);
    expect([...new Set(used)].filter((n) => !declared.has(n))).toEqual([]);
  });
  test('the table is fixed-layout and its row actions never use flex-end (hard rules 9 and 11)', () => {
    const css = stripped(MY_CSS);
    expect(css).toMatch(/\.evts-tbl\s*\{[^}]*table-layout:\s*fixed/);
    expect(css).toMatch(/\.evts-rowact > :first-child\s*\{\s*margin-left:\s*auto;\s*\}/);
    expect(css).not.toMatch(/\.evts-rowact\s*\{[^}]*justify-content:\s*flex-end/);
  });
  test('a truncating name is one text node with min-width 0 (hard rule 8)', () => {
    const nm = stripped(MY_CSS).match(/\.evts-nm\s*\{([^}]*)\}/)[1];
    expect(nm).toMatch(/min-width:\s*0/);
    expect(nm).toMatch(/text-overflow:\s*ellipsis/);
  });
});
