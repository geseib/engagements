/* R3 / Important #3: neither of the version chip's non-token inks carries the
   editor's own paper theme. --success (#4FB286) is only 2.6:1 on the paper
   editor's --bg for the "public" chip, and --secondary (#7CA7E6, 6.8:1 on the
   dusk list where it was written) is only ~2.3:1 there for the "waiting for
   Engage" chip — the exact same defect R3 already fixed once, missed the
   second time because the list's own waiting chip sits on dusk and passes.
   .qs-version-chip instead declares two scoped custom properties,
   --qs-chip-public-ink: #1E7A52 and --qs-chip-waiting-ink: #2B5F9E, and the
   flagged/unfinished chip carries --danger-deep. This asserts all three clear
   AA on paper --bg AND on white, following srevPalette.test.js's method (the
   helpers below are copied from there). */
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
const secondary = hex(token(GLOBAL_CSS, ROOT, '--secondary'));
const publicInkHex = token(GLOBAL_CSS, '.qs-version-chip {', '--qs-chip-public-ink');
const publicInk = hex(publicInkHex);
const waitingInkHex = token(GLOBAL_CSS, '.qs-version-chip {', '--qs-chip-waiting-ink');
const waitingInk = hex(waitingInkHex);

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
  test('the waiting-for-Engage chip ink (--qs-chip-waiting-ink) clears AA', () => {
    expect(ratio(waitingInk, bg)).toBeGreaterThanOrEqual(AA);
  });
});

test('the public chip declares its own scoped token rather than reusing --success', () => {
  // --success (#4FB286) is only 2.6:1 on paper --bg — the bug this token fixes.
  expect(publicInkHex.toUpperCase()).toBe('#1E7A52');
  expect(ratio(hex('#4FB286'), paperBg)).toBeLessThan(AA);
});

test('the waiting chip declares its own scoped token rather than reusing --secondary', () => {
  // --secondary (#7CA7E6) is ~2.3:1 on paper --bg — text-safe only on dusk,
  // where the list's own waiting chip lives (7.0:1, questionSetsPanel.css).
  expect(waitingInkHex.toUpperCase()).toBe('#2B5F9E');
  expect(ratio(secondary, paperBg)).toBeLessThan(AA);
});

/* ── THE WORKIE GROUP: THE SAME DEFECT, DECLINED RATHER THAN MEASURED ────────

   `.qs-workie` boxes the set's two Workie settings, and this editor renders on
   BOTH the paper console and the host's dusk dialog. That is exactly the split
   that produced the chip inks above: a colour measured against one surface and
   shipped onto the other.

   So the group declares no ink at all, and these tests pin that decision rather
   than a ratio. There is nothing to measure, which is the point — copy that
   inherits its surface's own --text cannot fail in either theme, and a future
   edit that adds `color:` here has to come past this file first. */
const block = (selector) => {
  const start = GLOBAL_CSS.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`${selector} is not declared in styles.css`);
  return GLOBAL_CSS.slice(start, GLOBAL_CSS.indexOf('}', start));
};

describe('the Workie group is theme-proof by declining ink', () => {
  test.each([
    ['.qs-workie'],
    ['.qs-workie h4'],
    ['.qs-workie-warning'],
  ])('%s sets no text or background colour', (selector) => {
    const body = block(selector);
    expect(body).not.toMatch(/(^|[;{\s])color\s*:/);
    expect(body).not.toMatch(/(^|[;{\s])background(-color)?\s*:/);
  });

  test('the group hairline is the token, not a hand-written rgba', () => {
    // Fifty-odd rules in this sheet spell rgba(155,168,190,.35) by hand. The
    // token exists (:root --hairline); new rules use it.
    expect(block('.qs-workie')).toMatch(/border:\s*var\(--hairline\)/);
    expect(block('.qs-workie')).not.toMatch(/#[0-9A-Fa-f]{3,8}|rgba?\(/);
  });

  test("the warning's only colour is a border, where no ratio applies", () => {
    const body = block('.qs-workie-warning');
    expect(body).toMatch(/border-left:\s*3px solid var\(--primary\)/);
    expect(body).not.toMatch(/#[0-9A-Fa-f]{3,8}|rgba?\(/);
  });

  test('both type sizes sit on the 12/13/15/19/24/30 ladder', () => {
    const sizes = [block('.qs-workie h4'), block('.qs-workie-warning')]
      .map((b) => Number((b.match(/font-size:\s*(\d+)px/) || [])[1]));
    expect(sizes).toEqual([15, 13]);
  });
});
