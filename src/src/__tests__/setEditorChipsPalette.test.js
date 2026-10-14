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
 * decorative. Every value is resolved through testing/skinHarness.js and the
 * pairings are measured for every skin on dusk. */
const fs = require('fs');
const path = require('path');
const H = require('../testing/skinHarness');
const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const GLOBAL_CSS = require('../testing/classicGlobalCss')();
const ratio = (a, b) => H.ratio(a, b);
const CLASSIC_DUSK = { skin: 'classic', theme: 'dark' };
/** A scope-local token READ out of its block, every var() resolved for one skin x theme. */
function token(css, block, name, opts = CLASSIC_DUSK) {
  return H.scopeVar(css, block, name, opts);
}
const AA = H.AA;

/* The scope's token block — where the editor's raw values live now (as roles). */
const EDITOR_CSS = read('components', 'QuestionSetEditor.css');
const SCOPE = '.qs-editor {';

function tint(css, block, name, opts = CLASSIC_DUSK) {
  const c = H.parseColor(token(css, block, name, opts));
  if (!(c.a < 1)) throw new Error(`${name} is not a translucent tint in ${block}`);
  return c;
}

/** Colour equality tolerant to spelling: rgb channels, alpha to 3 dp. */
const norm = (c) => {
  const p = H.parseColor(c);
  return { rgb: p.rgb.map((n) => Math.round(n)), a: Math.round(p.a * 1000) / 1000 };
};

/* A version row is `background: var(--surface)`, read from the rule rather than
   named here; the active one carries the ok tint on top of it. */
const rowToken = GLOBAL_CSS
  .slice(GLOBAL_CSS.indexOf('.qs-version-row {'))
  .match(/background:\s*var\((--[\w-]+)\)/)[1];

function palette(opts) {
  const row = H.parseColor(H.role(rowToken, opts)).rgb;
  const ok = tint(EDITOR_CSS, SCOPE, '--qs-tint-ok', opts);
  return {
    row,
    activeRow: H.alphaOver(ok.rgb, row, ok.a),
    dangerText: H.role('--danger-text', opts),
    dangerDeep: H.role('--danger-deep', opts),
    success: H.role('--success', opts),
    secondary: H.role('--secondary', opts),
    publicInk: token(EDITOR_CSS, SCOPE, '--qs-chip-public-ink', opts),
    waitingInk: token(EDITOR_CSS, SCOPE, '--qs-chip-waiting-ink', opts),
  };
}

const DUSK_CASES = H.CASES.filter(([, t]) => t === 'dark');

describe.each(DUSK_CASES)('%s / %s', (skin, theme) => {
  const opts = { skin, theme };
  const P = palette(opts);

  describe.each([
    ['a version row', P.row],
    ['the active version row', P.activeRow],
  ])('the version chip ink on %s', (_name, bg) => {
    test('the public chip ink clears AA', () => {
      expect(ratio(P.publicInk, bg)).toBeGreaterThanOrEqual(AA);
    });
    test('the flagged/unfinished chip ink (--danger-text) clears AA', () => {
      expect(ratio(P.dangerText, bg)).toBeGreaterThanOrEqual(AA);
    });
    test('the waiting-for-Engage chip ink clears AA', () => {
      expect(ratio(P.waitingInk, bg)).toBeGreaterThanOrEqual(AA);
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
    expect(ratio(P.success, P.row)).toBeGreaterThanOrEqual(AA);
    const list = read('components', 'QuestionSetsPanel.css');
    expect(norm(P.publicInk)).toEqual(norm(token(list, '.qsets {', '--qsets-success-text', opts)));
  });

  test('the flagged chip takes --danger-text, not the deep red under a white label', () => {
    // --danger-deep (Classic #B03A34) is the FILL a --text label sits on; as ink on
    // the row it is 2.4:1. rejects: carrying the paper choice across unexamined.
    expect(ratio(P.dangerDeep, P.row)).toBeLessThan(AA);
    const rule = GLOBAL_CSS.match(/\.qs-version-chip--flagged[^{]*\{([^}]*)\}/);
    expect(rule).not.toBeNull();
    expect(rule[1]).toMatch(/color:\s*var\(--danger-text\)/);
  });

  test('--secondary would also be text-safe on the row', () => {
    // --secondary (Classic #7CA7E6) IS text-safe on the row (5.9:1), so the
    // waiting chip's token is scoped for consistency with its sibling rather
    // than out of need.
    expect(ratio(P.secondary, P.row)).toBeGreaterThanOrEqual(AA);
  });
});

test('the waiting chip declares its own scoped token rather than reusing --secondary', () => {
  // The token being its own is what lets the pair move together the next time
  // the surface does. Classic stays pinned at the value it always had.
  expect(norm(token(EDITOR_CSS, SCOPE, '--qs-chip-waiting-ink'))).toEqual(norm('#7CA7E6'));
  expect(EDITOR_CSS.slice(EDITOR_CSS.indexOf(SCOPE))).toMatch(/--qs-chip-waiting-ink\s*:/);
});

test('Classic stays pinned: the public chip ink and the ok tint resolve to their old literals', () => {
  expect(norm(token(EDITOR_CSS, SCOPE, '--qs-chip-public-ink'))).toEqual(norm('#6FD0A4'));
  expect(norm(token(EDITOR_CSS, SCOPE, '--qs-tint-ok'))).toEqual(norm('rgba(79, 178, 134, .10)'));
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
