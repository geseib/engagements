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
const H = require('../testing/skinHarness');

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
const GLOBAL_CSS = require('../testing/classicGlobalCss')();

/*
 * EVERY SKIN, DUSK ONLY. `.rr-c` declares no theme of its own and is drawn only
 * inside dusk containers (PastRound's modal, the player's shell — see the
 * sheet's header), so the paper column of H.CASES is not a surface this block
 * ever paints and is left out on purpose, not by accident.
 */
const DUSK_CASES = H.CASES.filter(([, theme]) => theme === 'dark');

describe.each(DUSK_CASES)('%s / %s: every pairing clears AA on the surface it is really drawn on', (skin, theme) => {
  const opts = { skin, theme };
  /** What `.rr-c` actually paints on: --surface under the sheet's own wash. */
  const layers = () => [H.role('--surface', opts), H.scopeVar(RAW_SHEET, '.rr-c-root {', '--rr-c-wash', opts)];

  test('the comment text', () => {
    const text = H.scopeVar(RAW_SHEET, '.rr-c-root {', '--rr-c-text', opts);
    expect(H.on(text, layers())).toBeGreaterThanOrEqual(H.AA);
  });

  test('the author byline and the anchor label', () => {
    // These are the ones the wash endangers: --muted is the closest token to
    // the bar, and lifting the background is what pushes a pairing under it.
    const muted = H.scopeVar(RAW_SHEET, '.rr-c-root {', '--rr-c-muted', opts);
    expect(H.on(muted, layers())).toBeGreaterThanOrEqual(H.AA);
  });

  test('the Comment affordance and the Comments heading', () => {
    // --rr-c-accent reads the --accent role (0b-4): orange in Classic, blue in
    // Present, and the same value the old --primary read gave in Classic.
    const accent = H.scopeVar(RAW_SHEET, '.rr-c-root {', '--rr-c-accent', opts);
    expect(accent.toUpperCase()).toBe(H.role('--accent', opts).toUpperCase());
    expect(H.on(accent, layers())).toBeGreaterThanOrEqual(H.AA);
  });

  test('the call-out edge is the accent at .28, and Classic keeps today\'s amber', () => {
    const rule = H.parseColor(H.scopeVar(RAW_SHEET, '.rr-c-root {', '--rr-c-rule', opts));
    expect(rule.a).toBeCloseTo(0.28, 3);
    expect(rule.rgb).toEqual(H.channel('--accent-rgb', opts));
    if (skin === 'classic') expect(rule.rgb).toEqual([246, 169, 76]);
  });
});

describe('the wash', () => {
  test('the wash the sheet declares is the one measured above', () => {
    /*
      Guards the arithmetic above against the sheet drifting away from it. If
      somebody deepens the tint, the composite stops being the paint that
      ships and every ratio above becomes a measurement of nothing.
    */
    const declared = /--rr-c-wash:\s*rgba\(255,\s*255,\s*255,\s*([0-9.]+)\)/.exec(SHEET);
    expect(declared).not.toBeNull();
    expect(Number(declared[1])).toBeCloseTo(0.06, 3);
  });

  test('the block reads roles, never the --primary alias', () => {
    expect(SHEET).not.toMatch(/var\(--primary\)/);
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
      // A closing brace on its own line is swept into the next match; drop it,
      // and skip an at-rule's prelude (`@media …`), which is not a selector.
      // The rules INSIDE a media block are indented and checked below.
      .map((m) => m[1].replace(/^[}\s]+/, '').trim())
      .filter((sel) => !sel.startsWith(':root') && !sel.startsWith('@'));
    const nested = [...SHEET.matchAll(/^\s+([.#][^{]*)\{/gm)].map((m) => m[1].trim());
    selectors.push(...nested);
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

/*
 * THE COMMENT BUTTONS CAN SEE THE LOCALS THEY USE.
 *
 * `.rr-c__add` sits in the section heads and in each response row — never
 * inside a `.rr-c` box. With the locals declared on `.rr-c` alone, every
 * `var(--rr-c-…)` on the button was undefined, which invalidates the whole
 * declaration: no border, no accent colour, no 12px size, a plain-text button.
 */
describe('the Comment button inherits its locals', () => {
  const block = (sel) => {
    const at = SHEET.indexOf(`${sel} {`);
    return at < 0 ? '' : SHEET.slice(at, SHEET.indexOf('}', at));
  };
  const LOCALS = ['--rr-c-text', '--rr-c-muted', '--rr-c-accent', '--rr-c-wash', '--rr-c-rule', '--rr-c-t-floor'];

  test('every local is declared on the report root, which wraps the buttons', () => {
    // rejects: the locals scoped to `.rr-c`, a box the buttons are never in.
    for (const name of LOCALS) expect(block('.rr-c-root')).toMatch(new RegExp(`${name}\\s*:`));
    for (const name of LOCALS) expect(block('.rr-c')).not.toMatch(new RegExp(`${name}\\s*:`));
  });

  test('every var the button reads is one the root declares', () => {
    // rejects: a button rule reaching for a local nothing above it defines.
    const used = [...block('.rr-c__add').matchAll(/var\((--rr-c-[a-z0-9-]+)\)/g)].map((m) => m[1]);
    expect(used.length).toBeGreaterThan(0);
    for (const name of used) expect(block('.rr-c-root')).toMatch(new RegExp(`${name}\\s*:`));
  });

  test('the button text resolves to the 12px floor, not an inherited size', () => {
    // rejects: `font-size: var(--rr-c-t-floor)` with the floor undefined at the button.
    expect(block('.rr-c__add')).toMatch(/font-size:\s*var\(--rr-c-t-floor\)/);
    expect(block('.rr-c-root')).toMatch(/--rr-c-t-floor:\s*12px/);
  });

  test('the report root carries the class (RoundReport.jsx)', () => {
    // rejects: a stylesheet scope no element wears.
    const jsx = fs.readFileSync(path.join(__dirname, '..', 'components', 'RoundReport.jsx'), 'utf8');
    expect(jsx).toMatch(/className="past-round__body rr-c-root"/);
  });

  describe.each(DUSK_CASES)('%s / %s: the pill is legible where it is really drawn', (skin, theme) => {
    const opts = { skin, theme };
    const accent = () => H.scopeVar(RAW_SHEET, '.rr-c-root {', '--rr-c-accent', opts);
    // The rows' own tints (styles.css `.past-round__answers li` and `.is-lead`).
    test.each([
      ['a section head, on the surface', []],
      ['a response row', ['rgba(0, 0, 0, 0.04)']],
      ['the leading response row', ['rgba(74, 124, 247, 0.12)']],
    ])('%s', (_where, tints) => {
      // rejects: an accent that clears AA on the comment wash but not on the
      // backgrounds the buttons actually sit on.
      expect(H.on(accent(), [H.role('--surface', opts), ...tints])).toBeGreaterThanOrEqual(H.AA);
    });
  });
});

/*
 * ONE RESPONSE, ONE ROW. `.past-round__answers li` had three grid tracks for
 * four children (number, text, author, Comment), so the Comment button wrapped
 * onto a row of its own, under the next response's number.
 */
describe('the response row keeps its Comment button', () => {
  const STYLES = stripCss(fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8'));
  const rowRule = () => {
    const at = STYLES.indexOf('.past-round__answers li {');
    return STYLES.slice(at, STYLES.indexOf('}', at));
  };

  test('every child of a row is placed on the same row', () => {
    // rejects: `grid-template-columns: 28px 1fr auto` with row flow, which
    // sends a fourth child to a new grid row.
    expect(rowRule()).toMatch(/grid-auto-flow:\s*column/);
    expect(rowRule()).toMatch(/grid-template-columns:\s*28px minmax\(0,\s*1fr\)\s*;/);
  });

  test('on a phone, the author drops under the text and the button keeps the right column', () => {
    // rejects: a 360px row splitting number, text, author and button four ways,
    // which leaves the response a sliver or pushes the button off the row.
    const phone = STYLES.slice(STYLES.indexOf('@media (max-width: 480px) {\n  .past-round__answers li {'));
    expect(phone).toMatch(/grid-template-columns:\s*28px minmax\(0,\s*1fr\)\s*auto/);
    expect(phone).toMatch(/\.past-round__who\s*\{[^}]*grid-row:\s*2/);
    expect(SHEET).toMatch(/@media \(max-width: 480px\)\s*\{\s*\.past-round__answers \.rr-c__add\s*\{[^}]*grid-column:\s*3;[^}]*grid-row:\s*1 \/ span 2/);
  });
});
