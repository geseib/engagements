const fs = require('fs');
const path = require('path');
const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const GLOBAL_CSS = read('styles.css');
const CSS = read('components', 'ScoreCard.css');
function lin(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function lum(c) { return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]); }
function ratio(a, b) { const la = lum(a); const lb = lum(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); }
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.substr(i, 2), 16));
function token(css, block, name) { const s = css.indexOf(block); const body = css.slice(s, css.indexOf('}', s)); const m = body.match(new RegExp(`${name}\\s*:\\s*(#[0-9A-Fa-f]{6})`)); if (!m) throw new Error(`${name} not in ${block}`); return m[1]; }
const DUSK = '[data-theme="dark"] {'; const ROOT = ':root {';
const T = { bg: token(GLOBAL_CSS, DUSK, '--bg'), surface: token(GLOBAL_CSS, DUSK, '--surface'), text: token(GLOBAL_CSS, DUSK, '--text'), muted: token(GLOBAL_CSS, DUSK, '--muted'), primary: token(GLOBAL_CSS, ROOT, '--primary'), dangerText: token(GLOBAL_CSS, ROOT, '--danger-text') };
const AA = 4.5;
/*
  RULING R22 — THE 12px FLOOR CHECK BELOW IS VACUOUS ON ITS OWN.

  It looks for a `px` literal with `font-size` within the preceding 40
  characters. Every font-size in this sheet is `var(--scard-t-…)`, so the
  literals only ever appear in the token block, where nothing says `font-size`
  — the loop runs, matches nothing, and passes no matter what the tokens say.
  The floor lives in the TOKENS, so that is what has to be read. Setting
  `--scard-t-floor` to 10px in a scratch copy fails `floorTokens` and did not
  fail the loop.
*/
const floorTokens = (css, scope) => [...css.matchAll(new RegExp(`--${scope}-t-[a-z]+:\\s*(\\d+)px`, 'g'))].map((m) => Number(m[1]));
describe('ScoreCard palette', () => {
  test.each([
    ['--text on --bg', T.text, T.bg], ['--muted on --bg', T.muted, T.bg], ['--primary on --bg', T.primary, T.bg], ['--danger-text on --bg', T.dangerText, T.bg],
    ['--text on --surface', T.text, T.surface], ['--muted on --surface', T.muted, T.surface],
  ])('%s clears AA', (_l, fg, bg) => expect(ratio(hex(fg), hex(bg))).toBeGreaterThanOrEqual(AA));
  test('scoped, token-only, no --danger text, 12px floor', () => {
    const stripped = CSS.replace(/\/\*[\s\S]*?\*\//g, ' ');
    const tokenBlock = stripped.slice(stripped.indexOf('.scard {'), stripped.indexOf('}', stripped.indexOf('.scard {')));
    expect((stripped.replace(tokenBlock, '').match(/#[0-9A-Fa-f]{3,6}\b/g) || [])).toEqual([]);
    expect(stripped).not.toMatch(/color:\s*var\(--danger\)/);
    for (const m of stripped.matchAll(/(\d+(?:\.\d+)?)px/g)) { if (/font-size/.test(stripped.slice(Math.max(0, m.index - 40), m.index))) expect(Number(m[1])).toBeGreaterThanOrEqual(12); }
    const sizes = floorTokens(stripped, 'scard');
    expect(sizes.length).toBeGreaterThan(3);
    for (const size of sizes) expect(size).toBeGreaterThanOrEqual(12);
    for (const sel of stripped.matchAll(/(^|\})\s*([^{@}]+)\{/g)) for (const part of sel[2].split(',')) expect(part.trim()).toMatch(/^\.scard(\b|-)/);
    expect(GLOBAL_CSS).not.toMatch(/\.scard(\b|-)/);
  });
  /*
    R15 removed `--modq-success-text` from the moderation sheet for being a
    token nothing used; this one was the same token, one sheet over, and the
    assertion above it was the only thing keeping it alive — a colour measured
    and pinned for a surface that never paints. Nothing in ScoreCard.jsx is
    green, and Stage 3's reports are not this sheet's to pre-declare.
  */
  test('no token is declared that nothing paints with', () => {
    const declared = [...CSS.matchAll(/(--scard-[a-z-]+):/g)].map((m) => m[1]);
    const unused = declared.filter((name) => !new RegExp(`var\\(${name}\\)`).test(CSS));
    expect(unused).toEqual([]);
  });
});
