/**
 * THE CONSOLE OVERVIEW AND THE SCOPE ROW — CSS CONTRACT.
 * components/OverviewPanel.css (scope .ovw) and components/ScopeTabs.css (.scp).
 *
 * jsdom loads no stylesheet and resolves no custom property, so the contract
 * is pinned by reading the CSS as text and doing the arithmetic: every pairing
 * composited from its real paint stack (the walk is lifted from
 * docs/design/admin-redesign/audit.html, as every *Palette test here does).
 *
 * Named `*Palette`, NEVER `*Token*`: `.gitignore:35` is an unanchored
 * `*token*`, and a file named for tokens never reaches CI.
 */
const fs = require('fs');
const path = require('path');
const H = require('../testing/skinHarness');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const GLOBAL_CSS = read('styles.css');
const OVW = read('components', 'OverviewPanel.css');
const SCP = read('components', 'ScopeTabs.css');
const OVW_JSX = read('components', 'OverviewPanel.jsx');
const SCP_JSX = read('components', 'ScopeTabs.jsx');
const ADMIN = read('AdminPage.jsx');
const SECTIONS = read('config', 'consoleSections.js');

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
function token(css, blockStart, name) {
  const start = css.indexOf(blockStart);
  if (start < 0) throw new Error(`no ${blockStart} block`);
  const body = css.slice(start, css.indexOf('}', start));
  const m = body.match(new RegExp(`${name}\\s*:\\s*(#[0-9A-Fa-f]{6})`));
  if (!m) throw new Error(`${name} not declared in ${blockStart}`);
  return m[1];
}
function local(css, name, kind = 'hex') {
  const re = kind === 'hex'
    ? new RegExp(`${name}\\s*:\\s*(#[0-9A-Fa-f]{6})`)
    : new RegExp(`${name}\\s*:\\s*(rgba\\([^)]*\\))`);
  const m = css.match(re);
  if (!m) throw new Error(`${name} not declared`);
  return m[1];
}

const ROOT = ':root {';
const DUSK = '[data-theme="dark"] {';
const T = {
  bg: H.role('--bg', { skin: 'classic', theme: 'dark' }),
  surface: H.role('--surface', { skin: 'classic', theme: 'dark' }),
  surface2: H.role('--surface-2', { skin: 'classic', theme: 'dark' }),
  text: H.role('--text', { skin: 'classic', theme: 'dark' }),
  muted: H.role('--muted', { skin: 'classic', theme: 'dark' }),
  primary: H.role('--primary', { skin: 'classic', theme: 'dark' }),
  secondary: H.role('--secondary', { skin: 'classic', theme: 'dark' }),
  dangerText: H.role('--danger-text', { skin: 'classic', theme: 'dark' }),
};
const SCP_BG = local(SCP, '--scp-bg');
const SCP_MENU = local(SCP, '--scp-menu');

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
const stripped = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

describe('the Overview: flat pairings', () => {
  const BOX = [T.bg, T.surface];
  test.each([
    ['a box title and its count, on the box', T.text, BOX],
    ['a box summary and a row’s detail', T.muted, BOX],
    ['the heading’s “3 things” on the work field', T.muted, [T.bg]],
    ['links (Members ›) on the box', T.secondary, BOX],
    ['Reject, the danger outline, on the box', T.dangerText, BOX],
    ['a plain button’s label on --surface-2', T.text, [T.bg, T.surface2]],
    ['a row note on --bg', T.text, [T.bg]],
    ['a tile numeral', T.text, BOX],
    ['a tile label and sub line', T.muted, BOX],
  ])('%s clears AA', (_l, fg, layers) => {
    expect(on(fg, layers)).toBeGreaterThanOrEqual(AA);
  });

  // rejects: a white label on the amber fill (1.96:1). The label is --bg.
  test('the one orange button carries --bg on --primary', () => {
    expect(OVW).toMatch(/\.ovw \.ovw-btn--primary\s*\{[^}]*background:\s*var\(--primary\)[^}]*color:\s*var\(--bg\)/);
    expect(on(T.bg, [T.primary])).toBeGreaterThanOrEqual(AA);
  });
});

describe('the Overview: tinted composites', () => {
  test('“Nothing needs you.” on the green-tinted card', () => {
    const layers = [T.bg, T.surface, local(OVW, '--ovw-tint-green', 'rgba')];
    expect(on(T.text, layers)).toBeGreaterThanOrEqual(AA);
    expect(on(T.muted, layers)).toBeGreaterThanOrEqual(AA);
    expect(on(local(OVW, '--ovw-success-text'), layers)).toBeGreaterThanOrEqual(AA);
  });
});

describe('the scope row: pairings', () => {
  test.each([
    ['an inactive tab name', T.muted],
    ['the active tab name', T.text],
    ['+ New team', T.secondary],
  ])('%s on the row clears AA', (_l, fg) => {
    expect(on(fg, [SCP_BG])).toBeGreaterThanOrEqual(AA);
  });
  test('the active tab on its tint', () => {
    expect(on(T.text, [SCP_BG, local(SCP, '--scp-active-tint', 'rgba')])).toBeGreaterThanOrEqual(AA);
  });
  test('a count pill', () => {
    expect(on(T.text, [T.surface2])).toBeGreaterThanOrEqual(AA);
  });
  test('“n elsewhere” on its tint', () => {
    expect(on(T.secondary, [SCP_BG, local(SCP, '--scp-else-tint', 'rgba')])).toBeGreaterThanOrEqual(AA);
  });
  test('the More menu and the phone sheet', () => {
    expect(on(T.text, [SCP_MENU])).toBeGreaterThanOrEqual(AA);
    expect(on(T.muted, [SCP_MENU])).toBeGreaterThanOrEqual(AA);
    expect(on(T.secondary, [SCP_MENU])).toBeGreaterThanOrEqual(AA);
  });
});

describe('the rules a stylesheet can break without any test noticing', () => {
  // rejects: orange creeping into the scope row. The page has the one orange.
  test('the scope row never paints --primary', () => {
    expect(stripped(SCP)).not.toMatch(/background[^;]*var\(--primary\)|color:\s*var\(--primary\)/);
  });
  // rejects: --danger on text (4.38:1 on --surface).
  test('--danger is a border only, never text, in either sheet', () => {
    expect(stripped(OVW)).not.toMatch(/(^|[^-])color:\s*var\(--danger\)/m);
    expect(stripped(SCP)).not.toMatch(/(^|[^-])color:\s*var\(--danger\)/m);
  });
  test('nothing under the 12px floor', () => {
    for (const css of [OVW, SCP]) {
      const sizes = [...stripped(css).matchAll(/(\d+(?:\.\d+)?)px\s*\/|font-size:\s*(\d+(?:\.\d+)?)px|--ovw-t-\w+:\s*(\d+)px/g)]
        .map((m) => Number(m[1] || m[2] || m[3]));
      for (const px of sizes) expect(px).toBeGreaterThanOrEqual(12);
    }
  });
  test('every selector is rooted in its own scope', () => {
    const roots = (css) => stripped(css).replace(/@media[^{]*\{/g, '').split('}')
      .map((r) => r.split('{')[0].trim()).filter((sel) => sel && !sel.startsWith('@'));
    for (const sel of roots(OVW)) {
      for (const part of sel.split(',')) expect(part.trim()).toMatch(/^\.ovw(\s|$|\s*\*|\s*:)/);
    }
    for (const sel of roots(SCP)) {
      for (const part of sel.split(',')) expect(part.trim()).toMatch(/^\.scp(-sheet|-sheet-scrim|--phone)?(\s|$|\.|\s*\*|:)/);
    }
  });
  test('styles.css declares nothing in either scope', () => {
    expect(GLOBAL_CSS).not.toMatch(/\.ovw[\s.{-]/);
    expect(GLOBAL_CSS).not.toMatch(/\.scp[\s.{-]/);
  });
  test('no hex literal outside the token blocks', () => {
    const outsideTokens = (css, first) => stripped(css).split('}')
      .filter((rule) => !rule.includes(first))
      .join('}');
    expect(outsideTokens(OVW, '--ovw-t-floor')).not.toMatch(/#[0-9A-Fa-f]{3,6}\b/);
    // The phone sheet is portalled outside .scp and repeats --scp-menu by value.
    expect(outsideTokens(SCP, '--scp-bg').replace(/#1E2D4A/g, '')).not.toMatch(/#[0-9A-Fa-f]{3,6}\b/);
  });
  // rejects: justify-content:flex-end on a row's actions (engage-design rule 9).
  test('row actions are pushed with margin-left:auto and wrap', () => {
    expect(OVW).toMatch(/\.ovw \.ovw-acts\s*\{[^}]*flex-wrap:\s*wrap[^}]*margin-left:\s*auto/);
    expect(stripped(OVW)).not.toMatch(/justify-content:\s*flex-end/);
  });
  test('both roots declare dusk', () => {
    expect(OVW_JSX).toMatch(/className="ovw" data-theme="dark"/);
    expect(SCP_JSX).toMatch(/className="scp" data-theme="dark"/);
  });
  // rejects: the markup converted and the theme not, or the reverse.
  test('the Overview section is a dusk section', () => {
    expect(SECTIONS).toMatch(/overview:\s*\{[^}]*contentTheme:\s*'dark'/);
    expect(ADMIN).toMatch(/overview:\s*\{[\s\S]{0,900}?contentTheme:\s*'dark'/);
  });
});
