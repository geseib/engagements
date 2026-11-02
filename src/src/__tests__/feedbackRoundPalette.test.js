/**
 * THE PARTICIPANT'S FEEDBACK-ROUND SHELL AND COMPOSER.
 *
 * NAMED "Palette", not "Tokens": `.gitignore:35` is an unanchored `*token*`, so
 * a file named for tokens is invisible to git — it runs locally, passes, and
 * never reaches CI. Do not rename it.
 *
 * jsdom has no layout engine and resolves no custom properties across
 * stylesheets, so nothing here asks the DOM anything and nothing here asserts a
 * width, an offset or a position. Every assertion reads the CSS as text and
 * does arithmetic on it, which is the only honest way to pin either contract in
 * this environment.
 *
 * ── THE TINT IS THE WHOLE POINT ────────────────────────────────────────────
 *
 * `.fbr__composer` puts a 6% white wash over the shell's `--surface`, and the text box a 10% one. That tint is
 * invisible in a token table, and reading contrast off `--surface` alone would
 * be reading the wrong background — the classic way dark-on-dark passes an
 * audit. So the composite is computed here and every pairing is measured
 * against it.
 */
const fs = require('fs');
const path = require('path');
const H = require('../testing/skinHarness');

const RAW_SHEET = fs.readFileSync(
  path.join(__dirname, '..', 'components', 'FeedbackRoundPanel.css'), 'utf8',
);

/**
 * The sheet with its comments removed.
 *
 * Load-bearing, and the reason is the same one `gameSetupCallSite.test.js`
 * records: a scanner run over raw source checks the prose as well as the code.
 * This stylesheet's header documents its measured contrast ratios by writing
 * the hex values out, which is exactly what the "no raw hex" rule is there to
 * encourage — so a scanner that counted them would punish the documentation and
 * reward deleting it.
 */
const stripCss = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const SHEET = stripCss(RAW_SHEET);
const GLOBAL_CSS = require('../testing/classicGlobalCss')();

/* ------------------------------------------------------------------ colour */
const lin = (c) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
};
const parseHex = (h) => [1, 3, 5].map((i) => parseInt(h.substr(i, 2), 16));
const lum = (c) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
const ratio = (a, b) => {
  const la = lum(parseHex(a));
  const lb = lum(parseHex(b));
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};
const hex = (rgb) => `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;

/** Composite `over` (white at `alpha`) onto `base`. The real paint stack. */
const wash = (base, alpha) => hex(parseHex(base).map((c) => c + (255 - c) * alpha));

/* Values RESOLVED per skin through the harness (skins -> roles -> the .fbr block), never
   retyped. The panel draws inside the player shell (`.plr data-theme="dark"`): dusk in
   every skin. */
const fbrVar = (name, skin) => H.scopeVar(RAW_SHEET, '.fbr {', name, { skin, theme: 'dark' });
const AA = 4.5;

test('Classic is unchanged: --fbr-accent and --fbr-lift resolve to their pre-skin values', () => {
  expect(H.parseColor(fbrVar('--fbr-accent', 'classic'))).toEqual(H.parseColor('#F6A94C'));
  expect(H.parseColor(fbrVar('--fbr-lift', 'classic'))).toEqual(H.parseColor('rgba(15, 26, 46, 0.55)'));
});

describe.each(H.SKINS)('every pairing clears AA on the surface it is really drawn on (%s)', (skin) => {
  const r = (name) => H.role(name, { skin, theme: 'dark' });
  const SURFACE = r('--surface');
  const TEXT = fbrVar('--fbr-text', skin);
  const MUTED = fbrVar('--fbr-muted', skin);
  const ACCENT = fbrVar('--fbr-accent', skin);
  const INK = fbrVar('--fbr-ink', skin);
  /** What `.fbr` actually paints on: --surface under a 6% white wash. */
  const COMPOSITE = wash(SURFACE, 0.06);

  test('the comment text', () => {
    expect(ratio(TEXT, COMPOSITE)).toBeGreaterThanOrEqual(AA);
  });

  test('the author byline and the anchor label', () => {
    // These are the ones the wash endangers: --muted is the closest token to
    // the bar, and lifting the background is what pushes a pairing under it.
    expect(ratio(MUTED, COMPOSITE)).toBeGreaterThanOrEqual(AA);
  });

  test('the Comment affordance and the Comments heading (--fbr-accent)', () => {
    expect(ratio(ACCENT, COMPOSITE)).toBeGreaterThanOrEqual(AA);
  });

  test('the Post button: its ink on the filled accent', () => {
    expect(ratio(INK, ACCENT)).toBeGreaterThanOrEqual(AA);
  });

  /* The phone layout's own tints (phone-comments 3b), composited onto the
     card they really sit on. */
  const over = (base, rgbaStr) => H.composite([base, rgbaStr]);
  const CARD = r('--surface');

  test('card text and meta on a plain card', () => {
    expect(ratio(TEXT, CARD)).toBeGreaterThanOrEqual(AA);
    expect(ratio(MUTED, CARD)).toBeGreaterThanOrEqual(AA);
  });

  test('text and meta on the Workie wash', () => {
    const workie = over(CARD, fbrVar('--fbr-workie-wash', skin));
    expect(H.ratio(TEXT, workie)).toBeGreaterThanOrEqual(AA);
    expect(H.ratio(MUTED, workie)).toBeGreaterThanOrEqual(AA);
  });

  test('text on your own comment (the accent wash) and on the sent line (the green wash)', () => {
    const mine = over(CARD, fbrVar('--fbr-mine-wash', skin));
    const ok = over(CARD, fbrVar('--fbr-ok-wash', skin));
    expect(H.ratio(TEXT, mine)).toBeGreaterThanOrEqual(AA);
    expect(H.ratio(MUTED, mine)).toBeGreaterThanOrEqual(AA);
    expect(H.ratio(TEXT, ok)).toBeGreaterThanOrEqual(AA);
  });

  test('an outlined control’s edge clears 3:1 on the card and on the page (WCAG 1.4.11)', () => {
    // rejects: the draft's .34 edge at 2.19:1 (reviews.md 3.2).
    const edge = fbrVar('--fbr-edge', skin);
    expect(H.ratio(over(CARD, edge), CARD)).toBeGreaterThanOrEqual(3);
    expect(H.ratio(over(r('--bg'), edge), r('--bg'))).toBeGreaterThanOrEqual(3);
  });
});

describe('the wash', () => {
  test('and the wash the sheet declares is the one measured here', () => {
    /*
      Guards the arithmetic above against the sheet drifting away from it. If
      somebody deepens the tint, the composite this file computes stops being
      the paint that ships and every ratio above becomes a measurement of
      nothing.
    */
    const declared = /--fbr-wash:\s*rgba\(255,\s*255,\s*255,\s*([0-9.]+)\)/.exec(SHEET);
    expect(declared).not.toBeNull();
    expect(Number(declared[1])).toBeCloseTo(0.06, 3);
  });
});

describe('colour comes from tokens', () => {
  test('no raw hex survives outside the scope block', () => {
    // A hex literal is how a surface stops following the theme. The scope block
    // may hold rgba() for its own tints; a six-digit hex anywhere is a colour
    // that was picked rather than derived.
    const hexes = SHEET.match(/#[0-9A-Fa-f]{6}\b/g) || [];
    expect(hexes).toEqual([]);
  });

  test('`color: var(--danger)` appears nowhere', () => {
    // --danger is 4.38:1 on --surface — under AA. It keeps borders, rules and
    // bar fills; --danger-text exists for copy.
    expect(SHEET).not.toMatch(/color:\s*var\(--danger\)/);
  });

  test('every custom property the sheet uses is declared somewhere', () => {
    const used = new Set([...SHEET.matchAll(/var\((--[a-z0-9-]+)\)/g)].map((m) => m[1]));
    for (const name of used) {
      const declaredLocally = new RegExp(`${name}\\s*:`).test(SHEET);
      const declaredGlobally = new RegExp(`${name}\\s*:`).test(GLOBAL_CSS);
      expect(declaredLocally || declaredGlobally).toBe(true);
    }
  });
});

describe('the scope is the scope', () => {
  test('every selector is rooted at .fbr or reaches into the artifact it augments', () => {
    /*
      `styles.css` owns the bare `.btn`, `.chip`, `.modal` and `.form-group`
      names, and a stylesheet that declares one of them restyles the whole app.
      The single permitted exception here is `.past-round__answers .fbr__add` —
      a `.fbr` class placed inside markup this sheet does not own, which is
      still scoped by its own class.
    */
    const selectors = [...SHEET.matchAll(/^([^@\s][^{]*)\{/gm)]
      .map((m) => m[1].trim())
      .filter((sel) => !sel.startsWith(':root'));
    for (const group of selectors) {
      for (const sel of group.split(',').map((x) => x.trim()).filter(Boolean)) {
        expect(sel.includes('.fbr')).toBe(true);
      }
    }
  });

  test('styles.css declares nothing in this scope', () => {
    // Both halves matter: `.qs` collided once already because only one was
    // checked.
    expect(GLOBAL_CSS).not.toMatch(/\.fbr/);
  });
});

describe('the type ladder', () => {
  test('nothing is below the phone’s 13px floor', () => {
    // phone-comments D10: 13px at the smallest, the phone floor
    // (PlayerSurface.css), above the house 12px.
    const literal = [...SHEET.matchAll(/font-size:\s*(\d+)px/g)].map((m) => Number(m[1]));
    for (const size of literal) expect(size).toBeGreaterThanOrEqual(13);
    const steps = [...SHEET.matchAll(/--fbr-t-[a-z]+:\s*(\d+)px/g)].map((m) => Number(m[1]));
    expect(steps.length).toBeGreaterThan(0);
    for (const size of steps) expect(size).toBeGreaterThanOrEqual(13);
  });

  test('the declared steps are the phone ladder: 13 / 16 / 19 / 24, the box at 19', () => {
    expect(SHEET).toMatch(/--fbr-t-floor:\s*13px/);
    expect(SHEET).toMatch(/--fbr-t-label:\s*13px/);
    expect(SHEET).toMatch(/--fbr-t-body:\s*16px/);
    expect(SHEET).toMatch(/--fbr-t-head:\s*19px/);
    expect(SHEET).toMatch(/--fbr-t-title:\s*24px/);
    expect(SHEET).toMatch(/--fbr-t-input:\s*19px/);
  });

  test('section headings are 19px, never the 12.8px label they were (D1)', () => {
    expect(SHEET).toMatch(/\.fbr-sec__title\s*\{[^}]*font-size:\s*var\(--fbr-t-head\)/);
  });

  test('the INPUT renders at body size, never at label size', () => {
    /*
      The design system's rule, and it has two independent reasons here. A 13px
      input under 15px surrounding text is how a dense surface ends up
      illegible exactly where a mistake costs the most — and on iOS any focused
      input under 16px makes the page zoom, which moves the layout under a
      thumb mid-sentence.
    */
    const box = SHEET.slice(SHEET.indexOf('.fbr__box {'));
    expect(box.slice(0, 400)).toMatch(/font-size:\s*var\(--fbr-t-input\)/);
  });
});

describe('destructive copy', () => {
  test('a failed send uses --danger-text, never --danger', () => {
    /*
      #E5645E is 4.38:1 on --surface — under AA for normal text. This is
      precisely the text somebody has to read carefully: it is standing between
      them and the words they just wrote.
    */
    const err = SHEET.slice(SHEET.indexOf('.fbr__error'));
    expect(err.slice(0, 250)).toMatch(/color:\s*var\(--fbr-error\)/);
    expect(SHEET).toMatch(/--fbr-error:\s*var\(--danger-text\)/);
  });
});

describe('reachability', () => {
  test('Post is pushed over with margin-left, never flex-end', () => {
    /*
      `justify-content: flex-end` overflows toward the START, where the overflow
      is unreachable — the rule `rowActionsReachable.test.js` exists for. On a
      narrow phone that would put Cancel off the left edge with no way back.
    */
    const actions = SHEET.slice(SHEET.indexOf('.fbr__actions'));
    expect(actions.slice(0, 300)).not.toMatch(/justify-content:\s*flex-end/);
    expect(SHEET).toMatch(/\.fbr__post\s*\{[^}]*margin-left:\s*auto/);
  });

  test('the action row wraps rather than clipping a control off a phone', () => {
    const actions = SHEET.slice(SHEET.indexOf('.fbr__actions'));
    expect(actions.slice(0, 300)).toMatch(/flex-wrap:\s*wrap/);
  });

  test('every control is a thumb target, not a mouse target', () => {
    // 44px (phone-comments D10). Cancel sits beside a commit.
    expect(SHEET).toMatch(/\.fbr__discard\s*\{[^}]*min-height:\s*44px/);
    expect(SHEET).toMatch(/\.fbr__post\s*\{[^}]*min-height:\s*44px/);
    expect(SHEET).toMatch(/--fbr-tap:\s*44px/);
    for (const sel of ['.fbr-act', '.fbr-more', '.fbr-thread__toggle', '.fbr-jump__link']) {
      const at = SHEET.indexOf(`${sel} {`);
      expect(at).toBeGreaterThan(-1);
      expect(SHEET.slice(at, at + 400)).toMatch(/min-height:\s*var\(--fbr-tap\)/);
    }
    expect(SHEET).toMatch(/\.fbr__x\s*\{[^}]*height:\s*var\(--fbr-tap\)/);
  });

  test('pasted prose can break rather than widening the page', () => {
    expect(SHEET).toMatch(/\.fbr__quote-head\s*\{[^}]*overflow-wrap:\s*anywhere/);
    expect(SHEET).toMatch(/\.fbr-card__text\s*\{[^}]*overflow-wrap:\s*anywhere/);
    expect(SHEET).toMatch(/\.fbr-thread__text\s*\{[^}]*overflow-wrap:\s*anywhere/);
  });

  test('the sheet docks (sticky), never position: fixed, and the target outline is the accent', () => {
    expect(SHEET).toMatch(/\.fbr__composer\s*\{[^}]*position:\s*sticky/);
    expect(SHEET).not.toMatch(/position:\s*fixed/);
    expect(SHEET).toMatch(/\.fbr-card\.is-target\s*\{[^}]*outline:\s*2px solid var\(--fbr-accent\)/);
  });

  test('the text box resizes vertically only', () => {
    // A horizontal drag handle on a phone widens the page.
    expect(SHEET).toMatch(/\.fbr__box\s*\{[^}]*resize:\s*vertical/);
  });

  test('the truncated excerpt is a single text node with min-width 0', () => {
    /*
      The `text-overflow` trap: a truncating element must be a single text node
      with `min-width: 0`, never a flex container with span children — the
      property is inert there and the text is silently cut.
    */
    const ex = SHEET.slice(SHEET.indexOf('.fbr__quote-text {'));
    expect(ex.slice(0, 400)).toMatch(/min-width:\s*0/);
  });
});
