/* THE VERSION CHIP'S INKS, AND THE WORKIE GROUP'S REFUSAL TO HAVE ONE.
 *
 * R3 / Important #3: neither of the version chip's non-token inks carried the
 * surface it was drawn on. The chip declares two scoped custom properties
 * instead of reusing --success / --secondary, and that is still true — only the
 * surface changed. The editor moved onto the product's dark ground (the owner:
 * *"the white background really contrasts the rest of the site, as we are
 * entirely dark background throughout, except for question set editors and
 * previews"*), so the inks are the dusk pair and they are measured on the two
 * grounds a version row can actually be drawn on: the row itself, and the row
 * under the active version's tint.
 *
 * THE ORIGINAL DEFECT IS STILL PINNED, in the form it takes here: the ink each
 * chip declines is measured too, so "it declares its own token" cannot become
 * decorative. The helpers below are copied from srevPalette.test.js. */
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
const ROOT = ':root {';
const DUSK = '[data-theme="dark"] {';
const AA = 4.5;

/* The scope's token block — where the editor's raw values live now. */
const EDITOR_CSS = read('components', 'QuestionSetEditor.css');
const SCOPE = '.qs-editor {';

function alphaOver(fg, bg, a) { return fg.map((c, i) => c * a + bg[i] * (1 - a)); }
function tint(css, block, name) {
  const start = css.indexOf(block); const body = css.slice(start, css.indexOf('}', start));
  const m = body.match(new RegExp(`${name}\\s*:\\s*rgba\\(([^)]*)\\)`));
  if (!m) throw new Error(`${name} is not an rgba in ${block}`);
  const parts = m[1].split(',').map((n) => Number(n.trim()));
  return { rgb: parts.slice(0, 3), a: parts[3] };
}

/* A version row is `background: var(--surface)`, read from the rule rather than
   named here; the active one carries the ok tint on top of it. */
const rowToken = GLOBAL_CSS
  .slice(GLOBAL_CSS.indexOf('.qs-version-row {'))
  .match(/background:\s*var\((--[\w-]+)\)/)[1];
const row = hex(token(GLOBAL_CSS, DUSK, rowToken));
const ok = tint(EDITOR_CSS, SCOPE, '--qs-tint-ok');
const activeRow = alphaOver(ok.rgb, row, ok.a);

const dangerText = hex(token(GLOBAL_CSS, ROOT, '--danger-text'));
const dangerDeep = hex(token(GLOBAL_CSS, ROOT, '--danger-deep'));
const success = hex(token(GLOBAL_CSS, ROOT, '--success'));
const secondary = hex(token(GLOBAL_CSS, ROOT, '--secondary'));
const publicInkHex = token(EDITOR_CSS, SCOPE, '--qs-chip-public-ink');
const publicInk = hex(publicInkHex);
const waitingInkHex = token(EDITOR_CSS, SCOPE, '--qs-chip-waiting-ink');
const waitingInk = hex(waitingInkHex);

describe.each([
  ['a version row', row],
  ['the active version row', activeRow],
])('the version chip ink on %s', (_name, bg) => {
  test('the public chip ink clears AA', () => {
    expect(ratio(publicInk, bg)).toBeGreaterThanOrEqual(AA);
  });
  test('the flagged/unfinished chip ink (--danger-text) clears AA', () => {
    expect(ratio(dangerText, bg)).toBeGreaterThanOrEqual(AA);
  });
  test('the waiting-for-Engage chip ink clears AA', () => {
    expect(ratio(waitingInk, bg)).toBeGreaterThanOrEqual(AA);
  });
});

test('the public chip ink is the one the SET LIST uses for the same state', () => {
  // The reason for a scoped token has changed and this says so rather than
  // keeping a premise that has stopped being true: on paper, --success
  // (#4FB286) was 2.6:1 and the token existed because the global was
  // unreadable. On dusk --success is 5.6:1 on this row and would pass — so the
  // token now earns its place a different way. A version that reached the
  // public library shows a chip in `.qsets` (the list this editor opens from)
  // and a chip here, and they are the same fact about the same set; the ink is
  // read out of QuestionSetsPanel.css so the two cannot drift apart.
  expect(ratio(success, row)).toBeGreaterThanOrEqual(AA);
  const list = read('components', 'QuestionSetsPanel.css');
  expect(publicInkHex.toUpperCase()).toBe(token(list, '.qsets {', '--qsets-success-text').toUpperCase());
});

test('the flagged chip takes --danger-text, not the deep red under a white label', () => {
  // --danger-deep (#B03A34) is the FILL a --text label sits on; as ink on the
  // row it is 2.4:1. rejects: carrying the paper choice across unexamined.
  expect(ratio(dangerDeep, row)).toBeLessThan(AA);
  const rule = GLOBAL_CSS.match(/\.qs-version-chip--flagged[^{]*\{([^}]*)\}/);
  expect(rule).not.toBeNull();
  expect(rule[1]).toMatch(/color:\s*var\(--danger-text\)/);
});

test('the waiting chip declares its own scoped token rather than reusing --secondary', () => {
  // --secondary (#7CA7E6) IS text-safe on the row (5.9:1), so this one is a
  // scoped token for consistency with its sibling rather than out of need —
  // and the token being its own is what lets the pair move together the next
  // time the surface does.
  expect(waitingInkHex.toUpperCase()).toBe('#7CA7E6');
  expect(ratio(secondary, row)).toBeGreaterThanOrEqual(AA);
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
