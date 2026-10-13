/* The moderation screen's paint stack, composited and asserted ≥ AA — the same
   text-parsing harness as sharePalette.test.js. Dusk only: the platform console
   sets contentTheme 'dark' for this section. */
const fs = require('fs');
const path = require('path');
const H = require('../testing/skinHarness');
const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const GLOBAL_CSS = read('styles.css');
const CSS = read('components', 'ModerationPanel.css');
function lin(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function lum(c) { return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]); }
function ratio(a, b) { const la = lum(a); const lb = lum(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); }
const hex = (h) => H.parseColor(h).rgb;
const over = (fg, bg, a) => fg.map((c, i) => c * a + bg[i] * (1 - a));
function token(css, block, name) {
  const start = css.indexOf(block); const body = css.slice(start, css.indexOf('}', start));
  const m = body.match(new RegExp(`${name}\\s*:\\s*(#[0-9A-Fa-f]{6})`));
  if (!m) throw new Error(`${name} not in ${block}`);
  return m[1];
}
const DUSK = H.CASES.filter(([, t]) => t === 'dark');
const tokens = (skin, theme) => { const o = { skin, theme }; return { bg: H.role('--bg', o), surface: H.role('--surface', o), text: H.role('--text', o), muted: H.role('--muted', o), primary: H.role('--primary', o), secondary: H.role('--secondary', o), dangerText: H.role('--danger-text', o) }; };
const tintAlpha = Number((CSS.match(/--modq-tint-alpha:\s*([\d.]+)/) || [])[1]);
const AA = 4.5;
/*
  RULING R22 — THE 12px FLOOR CHECK BELOW IS VACUOUS ON ITS OWN.

  It looks for a `px` literal with `font-size` within the preceding 40
  characters. Every font-size in this sheet is `var(--modq-t-…)`, so the
  literals only ever appear in the token block, where nothing says `font-size`
  — the loop runs, matches nothing, and passes no matter what the tokens say.
  The floor lives in the TOKENS, so that is what has to be read. Setting
  `--modq-t-floor` to 10px in a scratch copy fails `floorTokens` and did not
  fail the loop.
*/
const floorTokens = (css, scope) => [...css.matchAll(new RegExp(`--${scope}-t-[a-z]+:\\s*(\\d+)px`, 'g'))].map((m) => Number(m[1]));
describe.each(DUSK)('ModerationPanel palette, the pairings: %s / %s', (skin, theme) => {
  const T = tokens(skin, theme);
  test.each([
    ['--text on --bg', T.text, T.bg], ['--muted on --bg', T.muted, T.bg], ['--primary on --bg', T.primary, T.bg], ['--secondary on --bg', T.secondary, T.bg],
    ['--text on --surface', T.text, T.surface], ['--muted on --surface', T.muted, T.surface], ['--danger-text on --surface', T.dangerText, T.surface],
    ['--bg on --primary (filled Approve)', T.bg, T.primary],
  ])('%s clears AA', (_l, fg, bg) => expect(ratio(hex(fg), hex(bg))).toBeGreaterThanOrEqual(AA));
  test('the uncertain-question tint keeps --text and --muted at AA', () => {
    expect(tintAlpha).toBeGreaterThan(0);
    const tinted = over(hex(T.primary), hex(T.surface), tintAlpha);
    expect(ratio(hex(T.text), tinted)).toBeGreaterThanOrEqual(AA);
    expect(ratio(hex(T.muted), tinted)).toBeGreaterThanOrEqual(AA);
  });
});
describe('ModerationPanel palette', () => {
  test('every selector is rooted at .modq, no hex outside the token block, no --danger as text, nothing under 12px, rows 36px', () => {
    const stripped = CSS.replace(/\/\*[\s\S]*?\*\//g, ' ');
    const tokenBlock = stripped.slice(stripped.indexOf('.modq {'), stripped.indexOf('}', stripped.indexOf('.modq {')));
    expect((stripped.replace(tokenBlock, '').match(/#[0-9A-Fa-f]{3,6}\b/g) || [])).toEqual([]);
    expect(stripped).not.toMatch(/color:\s*var\(--danger\)/);
    for (const m of stripped.matchAll(/(\d+(?:\.\d+)?)px/g)) { if (/font-size/.test(stripped.slice(Math.max(0, m.index - 40), m.index))) expect(Number(m[1])).toBeGreaterThanOrEqual(12); }
    const sizes = floorTokens(stripped, 'modq');
    expect(sizes.length).toBeGreaterThan(3);
    for (const size of sizes) expect(size).toBeGreaterThanOrEqual(12);
    for (const sel of stripped.matchAll(/(^|\})\s*([^{@}]+)\{/g)) for (const part of sel[2].split(',')) expect(part.trim()).toMatch(/^\.modq(\b|-)/);
    expect(stripped).toMatch(/--modq-row-h:\s*36px/);
    expect(stripped).toMatch(/table-layout:\s*fixed/);
    expect(GLOBAL_CSS).not.toMatch(/\.modq(\b|-)/);
  });
});
