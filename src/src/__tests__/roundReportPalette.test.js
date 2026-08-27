/**
 * THE COMMENT BLOCK'S COLOUR AND TYPE CONTRACT.
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
 * `.rr-c` puts a 6% white wash over its container's `--surface`. That tint is
 * invisible in a token table, and reading contrast off `--surface` alone would
 * be reading the wrong background — the classic way dark-on-dark passes an
 * audit. So the composite is computed here and every pairing is measured
 * against it.
 */
const fs = require('fs');
const path = require('path');

const RAW_SHEET = fs.readFileSync(
  path.join(__dirname, '..', 'components', 'RoundReport.css'), 'utf8',
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

/** What `.rr-c` actually paints on: --surface under a 6% white wash. */
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
    const declared = /--rr-c-wash:\s*rgba\(255,\s*255,\s*255,\s*([0-9.]+)\)/.exec(SHEET);
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
  test('every selector is rooted at .rr-c or reaches into the artifact it augments', () => {
    /*
      `styles.css` owns the bare `.btn`, `.chip`, `.modal` and `.form-group`
      names, and a stylesheet that declares one of them restyles the whole app.
      The single permitted exception here is `.past-round__answers .rr-c__add` —
      a `.rr-c` class placed inside markup this sheet does not own, which is
      still scoped by its own class.
    */
    const selectors = [...SHEET.matchAll(/^([^@\s][^{]*)\{/gm)]
      .map((m) => m[1].trim())
      .filter((sel) => !sel.startsWith(':root'));
    for (const group of selectors) {
      for (const sel of group.split(',').map((x) => x.trim()).filter(Boolean)) {
        expect(sel.includes('.rr-c')).toBe(true);
      }
    }
  });

  test('styles.css declares nothing in this scope', () => {
    // Both halves matter: `.qs` collided once already because only one was
    // checked.
    expect(GLOBAL_CSS).not.toMatch(/\.rr-c/);
  });
});

describe('the type ladder', () => {
  test('nothing is below the 12px floor', () => {
    const sizes = [...SHEET.matchAll(/font-size:\s*(?:var\(--rr-c-t-[a-z]+\)|(\d+)px)/g)]
      .map((m) => m[1]).filter(Boolean).map(Number);
    for (const size of sizes) expect(size).toBeGreaterThanOrEqual(12);
  });

  test('the three declared steps are on the laptop ladder', () => {
    // 12 / 13 / 15, from the 12/13/15/19/24/30 ladder. This surface is read on
    // a phone at arm's length and in a laptop dialog — never projected — so it
    // must NOT import the stage's profile numbers.
    expect(SHEET).toMatch(/--rr-c-t-floor:\s*12px/);
    expect(SHEET).toMatch(/--rr-c-t-label:\s*13px/);
    expect(SHEET).toMatch(/--rr-c-t-body:\s*15px/);
  });

  test('prose renders at body size, not at label size', () => {
    // A comment is read in runs. 13px prose under 15px surrounding text is how
    // a dense surface ends up illegible exactly where it matters most.
    const item = SHEET.slice(SHEET.indexOf('.rr-c__text'));
    expect(item.slice(0, 200)).toMatch(/font-size:\s*var\(--rr-c-t-body\)/);
  });
});

describe('reachability', () => {
  test('the affordance is pushed over with margin-left, never flex-end', () => {
    /*
      `justify-content: flex-end` inside an `overflow: hidden` cell overflows
      toward the START, where a hidden overflow is unreachable — the rule
      `rowActionsReachable.test.js` exists for.
    */
    const head = SHEET.slice(SHEET.indexOf('.rr-c__section-head'));
    expect(head.slice(0, 300)).not.toMatch(/justify-content:\s*flex-end/);
    expect(SHEET).toMatch(/\.rr-c__add\s*\{[^}]*margin-left:\s*auto/);
  });

  test('the heading row wraps rather than pushing the button off a phone', () => {
    const head = SHEET.slice(SHEET.indexOf('.rr-c__section-head'));
    expect(head.slice(0, 300)).toMatch(/flex-wrap:\s*wrap/);
  });

  test('pasted prose can break rather than widening the page', () => {
    // A participant pastes a URL; without this the phone scrolls sideways.
    expect(SHEET).toMatch(/\.rr-c__text\s*\{[^}]*overflow-wrap:\s*anywhere/);
  });
});
