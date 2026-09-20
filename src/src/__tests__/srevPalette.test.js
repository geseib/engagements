/* The needs-changes banner sits inside the set editor, which is part-paper:
   it declares no theme of its own, so every pairing is asserted on BOTH grounds. */
const fs = require('fs');
const path = require('path');
const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const GLOBAL_CSS = read('styles.css');
const CSS = read('components', 'SetReviewBanner.css');
function lin(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function lum(c) { return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]); }
function ratio(a, b) { const la = lum(a); const lb = lum(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); }
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.substr(i, 2), 16));
const over = (fg, bg, a) => fg.map((c, i) => c * a + bg[i] * (1 - a));
function token(css, block, name) {
  const start = css.indexOf(block); const body = css.slice(start, css.indexOf('}', start));
  const m = body.match(new RegExp(`${name}\\s*:\\s*(#[0-9A-Fa-f]{6})`));
  if (!m) throw new Error(`${name} not in ${block}`);
  return m[1];
}
const DUSK = '[data-theme="dark"] {'; const PAPER = '[data-theme="light"] {'; const ROOT = ':root {';
const grounds = {
  dusk: { bg: hex(token(GLOBAL_CSS, DUSK, '--bg')), text: hex(token(GLOBAL_CSS, DUSK, '--text')), muted: hex(token(GLOBAL_CSS, DUSK, '--muted')) },
  paper: { bg: hex(token(GLOBAL_CSS, PAPER, '--bg')), text: hex(token(GLOBAL_CSS, PAPER, '--text')), muted: hex(token(GLOBAL_CSS, PAPER, '--muted')) },
};
const dangerText = hex(token(GLOBAL_CSS, ROOT, '--danger-text'));
const tintAlpha = Number((CSS.match(/--srev-tint-alpha:\s*([\d.]+)/) || [])[1]);
const AA = 4.5;
describe.each(Object.entries(grounds))('on %s', (_name, g) => {
  const tinted = over(hex(token(GLOBAL_CSS, ROOT, '--danger')), g.bg, tintAlpha);
  test('the banner tint is declared and the text on it clears AA', () => {
    expect(tintAlpha).toBeGreaterThan(0);
    expect(ratio(g.text, tinted)).toBeGreaterThanOrEqual(AA);
    expect(ratio(g.muted, tinted)).toBeGreaterThanOrEqual(AA);
  });
  test('the flagged-question heading colour clears AA on the tint', () => {
    // --danger-text is a dusk-derived token; on paper the sheet must swap it.
    const flaggedInk = _name === 'paper' ? hex((CSS.match(/--srev-flag-ink-paper:\s*(#[0-9A-Fa-f]{6})/) || [])[1] || '#000000') : dangerText;
    expect(ratio(flaggedInk, tinted)).toBeGreaterThanOrEqual(AA);
  });
});
test('every selector is rooted at .srev and no --danger carries text', () => {
  const stripped = CSS.replace(/\/\*[\s\S]*?\*\//g, ' ');
  expect(stripped).not.toMatch(/color:\s*var\(--danger\)/);
  for (const sel of stripped.matchAll(/(^|\})\s*([^{@}]+)\{/g)) for (const part of sel[2].split(',')) expect(part.trim()).toMatch(/^(\.srev(\b|-)|\[data-theme="light"\] \.srev)/);
  expect(GLOBAL_CSS).not.toMatch(/\.srev(\b|-)/);
});

/*
  THE MEASUREMENT BLOCK. Five category rows and a band word each; the words
  themselves carry high/medium/low, so only HIGH takes an ink and it takes the
  one already measured above. These pin that no second ink crept in and that
  the two greys the block leans on still clear AA on the tint, on both grounds.
*/
describe.each(Object.entries(grounds))('the measurement block on %s', (_name, g) => {
  const tinted = over(hex(token(GLOBAL_CSS, ROOT, '--danger')), g.bg, tintAlpha);
  test('the band word and the counts beside it clear AA on the tint', () => {
    expect(CSS).toMatch(/\.srev-band\b[^}]*color:\s*var\(--text\)/);
    expect(CSS).toMatch(/\.srev-band--high\s*\{\s*color:\s*var\(--srev-flag-ink\)/);
    expect(CSS).toMatch(/\.srev-cat-where\b[^}]*color:\s*var\(--muted\)/);
    expect(ratio(g.text, tinted)).toBeGreaterThanOrEqual(AA);
    expect(ratio(g.muted, tinted)).toBeGreaterThanOrEqual(AA);
  });
  test('no band ink is declared that the tests above do not composite', () => {
    const bands = [...CSS.matchAll(/\.srev-band--(\w+)\s*\{\s*color:\s*var\((--[\w-]+)\)/g)];
    expect(bands.map((m) => m[1])).toEqual(['high']);
    expect(bands.map((m) => m[2])).toEqual(['--srev-flag-ink']);
  });
});
test('the measurement block stays on the ladder and declares every token it uses', () => {
  // Nothing below the 12px floor, and the floor is where the band word sits.
  expect(CSS).toMatch(/\.srev-band\b[^}]*font-size:\s*var\(--srev-t-floor\)/);
  const declared = new Set([...CSS.matchAll(/(--srev-[\w-]+)\s*:/g)].map((m) => m[1]));
  for (const used of CSS.matchAll(/var\((--srev-[\w-]+)\)/g)) {
    expect(declared.has(used[1])).toBe(true);
  }
});
