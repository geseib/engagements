/* R3: the version chip's "public" ink cannot be --success (#4FB286) — that is
   only 2.6:1 on the paper editor's --bg, not text-safe. .qs-version-chip
   instead declares a scoped custom property, --qs-chip-public-ink: #1E7A52,
   and the flagged/unfinished chip carries --danger-deep. This asserts both
   clear AA on paper --bg AND on white, following srevPalette.test.js's method
   (the helpers below are copied from there). */
const fs = require('fs');
const path = require('path');
const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const GLOBAL_CSS = read('styles.css');
function lin(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function lum(c) { return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]); }
function ratio(a, b) { const la = lum(a); const lb = lum(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); }
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.substr(i, 2), 16));
function token(css, block, name) {
  const start = css.indexOf(block); const body = css.slice(start, css.indexOf('}', start));
  const m = body.match(new RegExp(`${name}\\s*:\\s*(#[0-9A-Fa-f]{6})`));
  if (!m) throw new Error(`${name} not in ${block}`);
  return m[1];
}
const PAPER = '[data-theme="light"] {';
const ROOT = ':root {';
const WHITE = hex('#FFFFFF');
const AA = 4.5;

const paperBg = hex(token(GLOBAL_CSS, PAPER, '--bg'));
const dangerDeep = hex(token(GLOBAL_CSS, ROOT, '--danger-deep'));
const publicInkHex = token(GLOBAL_CSS, '.qs-version-chip {', '--qs-chip-public-ink');
const publicInk = hex(publicInkHex);

describe.each([
  ['paper --bg', paperBg],
  ['#FFFFFF', WHITE],
])('the version chip ink on %s', (_name, bg) => {
  test('the public chip ink (#1E7A52) clears AA', () => {
    expect(ratio(publicInk, bg)).toBeGreaterThanOrEqual(AA);
  });
  test('the flagged/unfinished chip ink (--danger-deep) clears AA', () => {
    expect(ratio(dangerDeep, bg)).toBeGreaterThanOrEqual(AA);
  });
});

test('the public chip declares its own scoped token rather than reusing --success', () => {
  // --success (#4FB286) is only 2.6:1 on paper --bg — the bug this token fixes.
  expect(publicInkHex.toUpperCase()).toBe('#1E7A52');
  expect(ratio(hex('#4FB286'), paperBg)).toBeLessThan(AA);
});
