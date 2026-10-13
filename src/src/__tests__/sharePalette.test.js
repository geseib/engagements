// src/src/__tests__/sharePalette.test.js
/* The share dialog's paint stack: every pairing composited and asserted ≥ AA.
   Same harness as questionSetsPalette.test.js. */
const fs = require('fs');
const path = require('path');
const H = require('../testing/skinHarness');
const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const GLOBAL_CSS = read('styles.css');
const CSS = read('components', 'ShareSetDialog.css');
const CLASSIC_DUSK = { skin: 'classic', theme: 'dark' };
/** A scope-local token READ out of its block, every var() resolved for one skin x theme. */
function token(css, block, name, opts = CLASSIC_DUSK) {
  return H.scopeVar(css, block, name, opts);
}
/** Colour equality tolerant to spelling: rgb channels, alpha to 3 dp. */
const norm = (c) => {
  const p = H.parseColor(c);
  return { rgb: p.rgb.map((n) => Math.round(n)), a: Math.round(p.a * 1000) / 1000 };
};
const palette = (opts) => ({
  bg: H.role('--bg', opts),
  surface: H.role('--surface', opts),
  text: H.role('--text', opts),
  muted: H.role('--muted', opts),
  primary: H.role('--primary', opts),
  dangerText: H.role('--danger-text', opts),
  success: token(CSS, '.pubshare {', '--pubshare-success-text', opts),
});
const AA = H.AA;
const DUSK_CASES = H.CASES.filter(([, t]) => t === 'dark');
describe('ShareSetDialog palette', () => {
  describe.each(DUSK_CASES)('%s / %s', (skin, theme) => {
    const T = palette({ skin, theme });
    test.each([
      ['--text on --surface', T.text, T.surface],
      ['--muted on --surface', T.muted, T.surface],
      ['--primary on --surface', T.primary, T.surface],
      ['--danger-text on --surface', T.dangerText, T.surface],
      ['--pubshare-success-text on --surface', T.success, T.surface],
      ['--bg on --primary (the filled Submit)', T.bg, T.primary],
    ])('%s clears AA', (_l, fg, bg) => expect(H.ratio(fg, bg)).toBeGreaterThanOrEqual(AA));
  });
  test.each([
    ['--pubshare-success-text', '#6FD0A4'],
    ['--pubshare-rule', 'rgba(155, 168, 190, .20)'],
    ['--pubshare-tint', 'rgba(246, 169, 76, .09)'],
  ])('Classic stays pinned: %s in Classic / dark is %s', (name, literal) => {
    expect(norm(token(CSS, '.pubshare {', name))).toEqual(norm(literal));
  });
  test('every selector is rooted at .pubshare, no hex outside the token block, no --danger as text, nothing under 12px', () => {
    const stripped = CSS.replace(/\/\*[\s\S]*?\*\//g, ' ');
    const tokenBlock = stripped.slice(stripped.indexOf('.pubshare {'), stripped.indexOf('}', stripped.indexOf('.pubshare {')));
    const outside = stripped.replace(tokenBlock, '');
    expect(outside.match(/#[0-9A-Fa-f]{3,6}\b/g) || []).toEqual([]);
    expect(stripped).not.toMatch(/color:\s*var\(--danger\)/);
    for (const m of stripped.matchAll(/(\d+(?:\.\d+)?)px/g)) { if (/font-size/.test(stripped.slice(Math.max(0, m.index - 40), m.index))) expect(Number(m[1])).toBeGreaterThanOrEqual(12); }
    for (const sel of stripped.matchAll(/(^|\})\s*([^{@}]+)\{/g)) {
      for (const part of sel[2].split(',')) expect(part.trim()).toMatch(/^\.pubshare(\b|-)/);
    }
    expect(GLOBAL_CSS).not.toMatch(/\.pubshare(\b|-)/);
  });
});
