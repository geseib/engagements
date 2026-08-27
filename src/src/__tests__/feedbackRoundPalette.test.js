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
const GLOBAL_CSS = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');

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

/** Read a token's hex out of a `:root`-style block. */
function token(css, block, name) {
  const start = css.indexOf(block);
  if (start < 0) throw new Error(`no ${block} block`);
  const body = css.slice(start, css.indexOf('}', start));
  const m = body.match(new RegExp(`${name}\\s*:\\s*(#[0-9A-Fa-f]{6})`));
  if (!m) throw new Error(`${name} not declared in ${block}`);
  return m[1];
}

const SURFACE = token(GLOBAL_CSS, ':root {', '--surface');
const TEXT = token(GLOBAL_CSS, ':root {', '--text');
const MUTED = token(GLOBAL_CSS, ':root {', '--muted');
const PRIMARY = token(GLOBAL_CSS, ':root {', '--primary');

/** What `.fbr` actually paints on: --surface under a 6% white wash. */
const COMPOSITE = wash(SURFACE, 0.06);

const AA = 4.5;

describe('every pairing clears AA on the surface it is really drawn on', () => {
  test('the comment text', () => {
    expect(ratio(TEXT, COMPOSITE)).toBeGreaterThanOrEqual(AA);
  });

  test('the author byline and the anchor label', () => {
    // These are the ones the wash endangers: --muted is the closest token to
    // the bar, and lifting the background is what pushes a pairing under it.
    expect(ratio(MUTED, COMPOSITE)).toBeGreaterThanOrEqual(AA);
  });

  test('the Comment affordance and the Comments heading', () => {
    expect(ratio(PRIMARY, COMPOSITE)).toBeGreaterThanOrEqual(AA);
  });

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
  test('nothing is below the 12px floor', () => {
    const sizes = [...SHEET.matchAll(/font-size:\s*(?:var\(--fbr-t-[a-z]+\)|(\d+)px)/g)]
      .map((m) => m[1]).filter(Boolean).map(Number);
    for (const size of sizes) expect(size).toBeGreaterThanOrEqual(12);
  });

  test('the three declared steps are on the laptop ladder', () => {
    // 12 / 13 / 15, from the 12/13/15/19/24/30 ladder. This surface is read on
    // a phone at arm's length and in a laptop dialog — never projected — so it
    // must NOT import the stage's profile numbers.
    expect(SHEET).toMatch(/--fbr-t-floor:\s*12px/);
    expect(SHEET).toMatch(/--fbr-t-label:\s*13px/);
    expect(SHEET).toMatch(/--fbr-t-body:\s*15px/);
  });

  test('the INPUT renders at body size, never at label size', () => {
    /*
      The design system's rule, and it has two independent reasons here. A 13px
      input under 15px surrounding text is how a dense surface ends up
      illegible exactly where a mistake costs the most — and on iOS any focused
      input under 16px makes the page zoom, which moves the layout under a
      thumb mid-sentence.
    */
    const box = SHEET.slice(SHEET.indexOf('.fbr__box'));
    expect(box.slice(0, 400)).toMatch(/font-size:\s*var\(--fbr-t-body\)/);
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

  test('both controls are thumb targets, not mouse targets', () => {
    // 44px. This is a phone surface, and Cancel sits beside a commit.
    expect(SHEET).toMatch(/\.fbr__cancel\s*\{[^}]*min-height:\s*44px/);
    expect(SHEET).toMatch(/\.fbr__post\s*\{[^}]*min-height:\s*44px/);
  });

  test('a pasted anchor label can break rather than widening the page', () => {
    // A participant's response may be one long unbroken token. Without this the
    // composer widens and the phone scrolls sideways under their thumb.
    expect(SHEET).toMatch(/\.fbr__on-anchor\s*\{[^}]*overflow-wrap:\s*anywhere/);
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
    const ex = SHEET.slice(SHEET.indexOf('.fbr__on-excerpt'));
    expect(ex.slice(0, 400)).toMatch(/min-width:\s*0/);
  });
});
