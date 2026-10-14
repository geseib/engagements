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
const H = require('../testing/skinHarness');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const GLOBAL_CSS = require('../testing/classicGlobalCss')();
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
const parseHex = (c) => H.parseColor(c).rgb;     // any colour a role resolves to
const CLASSIC = { skin: 'classic', theme: 'dark' };
/** A scope-local custom property, every var() it reads resolved for one skin x theme. */
function token(css, block, name, opts = CLASSIC) {
  return H.scopeVar(css, block, name, opts);
}
function tint(name, opts = CLASSIC) {               // a translucent layer from the .evts block
  return token(MY_CSS, '.evts {', name, opts);
}
function composited(layers) {
  document.body.innerHTML = '';
  let host = document.body;
  for (const background of layers) {
    const el = document.createElement('div');
    const { rgb, a } = H.parseColor(background);   // jsdom reads only the comma form
    el.style.backgroundColor = `rgba(${rgb.join(', ')}, ${a})`;
    host.appendChild(el);
    host = el;
  }
  return bgOf(host, window);
}
const on = (fgHex, layers) => ratio(parseHex(fgHex), composited(layers));

const ROOT = ':root {';
/* The Events place renders dusk: every dusk case of every skin. */
const DUSK = H.CASES.filter(([, t]) => t === 'dark');
const tokensFor = (opts) => ({
  bg: H.role('--bg', opts),
  surface: H.role('--surface', opts),
  text: H.role('--text', opts),
  muted: H.role('--muted', opts),
  primary: H.role('--primary', opts),
  danger: H.role('--danger', opts),
  dangerText: H.role('--danger-text', opts),
  onAccent: token(MY_CSS, '.evts {', '--evts-on-accent', opts),
});
const AA = 4.5;

describe.each(DUSK)('the flat pairings this place paints — %s / %s', (skin, theme) => {
  const T = tokensFor({ skin, theme });
  const FIELD = [T.bg];
  const PANEL = [T.bg, T.surface];
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

describe.each(DUSK)('the tinted composites — %s / %s', (skin, theme) => {
  const T = tokensFor({ skin, theme });
  const tint = (name) => token(MY_CSS, '.evts {', name, { skin, theme });
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
  // Widened as eventBuilderPalette.test.js was (final review M6): a raw
  // rgba(...) is a colour too, and .evts-modal's shadow carried one.
  test('no hex or raw rgba(...) outside the token block, and --danger never carries text', () => {
    const css = stripped(MY_CSS);
    const start = css.indexOf('.evts {');
    const outside = css.slice(0, start) + css.slice(css.indexOf('}', start));
    expect(outside).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(outside).not.toMatch(/rgba\(/i);
    expect(css).toMatch(/\.evts-modal\s*\{[^}]*box-shadow:\s*var\(--evts-shadow-modal\)/);
    expect(css.split('\n').filter((l) => /(^|[^-])\bcolor\s*:\s*var\(--danger\)/.test(l))).toEqual([]);
  });
  // rejects: a size off the ladder — .evts-mono sat at 14px (final review
  // M6). Every size outside the token block is a ladder token; the one
  // exception is the close button's × glyph, which is an icon drawn as a
  // character at the console's close-button size, named as its own token and
  // used by .evts-x alone.
  test('every font size outside the token block is a ladder token (or the close glyph\'s, on .evts-x only)', () => {
    const css = stripped(MY_CSS);
    const start = css.indexOf('.evts {');
    const block = css.slice(start, css.indexOf('}', start));
    const outside = css.slice(0, start) + css.slice(css.indexOf('}', start));
    const LADDER = { floor: 12, label: 13, body: 15, head: 19, numeral: 30 };
    for (const [step, px] of Object.entries(LADDER)) expect(block).toMatch(new RegExp(`--evts-t-${step}:\\s*${px}px`));
    const declared = [...block.matchAll(/--evts-t-([a-z]+):\s*(\d+)px/g)].map((m) => [m[1], Number(m[2])]);
    declared.forEach(([step, px]) => expect(LADDER[step]).toBe(px));
    expect(outside).not.toMatch(/font-size:\s*\d|font:[^;]*\b\d+(\.\d+)?px/);
    const sizes = [...outside.matchAll(/font(?:-size)?:\s*([^;]+);/g)].map((m) => m[1]);
    expect(sizes.length).toBeGreaterThan(10);
    for (const value of sizes) {
      const token = (value.match(/var\((--evts-[a-z-]+)\)/) || [])[1];
      expect([token, value]).toEqual([expect.stringMatching(/^--evts-(t-(floor|label|body|head|numeral)|glyph-x)$/), value]);
    }
    const glyphUsers = [...outside.matchAll(/([^{}]+)\{[^}]*var\(--evts-glyph-x\)/g)].map((m) => m[1].trim());
    expect(glyphUsers).toEqual(['.evts-x']);
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
