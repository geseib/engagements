/**
 * THE MARKETING NAV'S ROW FITS ON ONE LINE AT EVERY WIDTH THAT SHOWS IT.
 *
 * Between the burger breakpoint and 1035px the signed-out row wrapped:
 * "How it works", "Use cases", "Sign in" and "Create a host account" each broke
 * onto two lines, and 1024px (iPad landscape, a small laptop window) sat inside
 * the band. The approved mockup has the same fault. Its full row needs 978px in
 * the system fonts mk.css falls back to (it loads no web font), and 1036px
 * with Archivo loaded, so its 860px collapse never fitted the row it collapses.
 *
 * The fix is the mockup's own move, made at the width where the room actually
 * runs out. mk.css:697 drops "Create a host account" and keeps "Sign in" when
 * the row gets tight (RATIONALE: "nobody fills in a registration form standing
 * in a corridor and the hero's first button is that same action anyway"). It
 * made that move at the same width as the link collapse. Here the two are
 * separate steps: the register door leaves the row first, and the links
 * collapse later.
 *
 * jsdom has no layout engine, so no width can be measured here. The widths
 * below were MEASURED in a browser and are recorded as constants. This file
 * reads the media queries out of MarketingShell.css as text, works out which
 * row is on screen at each width, and checks the measured width against it.
 * The last describe block pins every declaration the measurement depended on,
 * so changing a label, a padding or the display face fails here with
 * "re-measure" instead of quietly going stale.
 *
 * Named *NavFit*, never *Token*: `.gitignore` has an unanchored `*token*`.
 */
const fs = require('fs');
const path = require('path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const stripped = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

const CSS = stripped(read('marketing', 'MarketingShell.css'));
const JSX = read('marketing', 'MarketingShell.jsx');
const INDEX_HTML = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'index.html'), 'utf8');

/* ======================================================= the measurement
 * Measured 2026-09-25 in Chromium (the desktop app's browser pane) on macOS,
 * against the dev server, with Archivo (wdth 125, 800) and Inter (600, 700)
 * confirmed loaded by document.fonts.check(). Method: binary search on the
 * width of `.mk-nav-in` (a `.mk-shell`, which is border-box and 100% of the
 * viewport, so its width IS the viewport width with overlay scrollbars) for
 * the narrowest width at which no nav item's text spans two lines and the
 * row does not overflow. Each number is the first width that FITS. */
const MEASURED = {
  signedOutFull: 1035, // brand, four links, Sign in, Create a host account
  signedOutWithoutRegister: 805, // the same row without Create a host account
  signedIn: 860, // brand, four links, Open the app
};

/* The measurement had overlay scrollbars. A classic scrollbar (Windows, or a
 * Mac with a mouse attached; every marketing page scrolls) takes up to 17px
 * of layout width that a media query still counts as viewport. Text shaping
 * in Safari, Firefox and on Windows was not measured; 16px covers that. */
const CLASSIC_SCROLLBAR = 17;
const UNMEASURED_ENGINES = 16;

/* ===================================================== reading the sheet */
function matchingClose(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === '{') depth += 1;
    else if (text[i] === '}') { depth -= 1; if (depth === 0) return i; }
  }
  throw new Error('unbalanced braces in MarketingShell.css');
}

/** Flat `selector { body }` rules in a block that has no nesting. */
function flatRules(text) {
  return [...text.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    selectors: m[1].split(',').map((s) => s.trim().replace(/\s+/g, ' ')),
    body: m[2],
  }));
}

/** Every `@media` block, with its width bounds and the rules inside it. */
function mediaBlocks(css) {
  const out = [];
  for (const m of css.matchAll(/@media([^{]*)\{/g)) {
    const open = m.index + m[0].length - 1;
    const cond = m[1];
    const max = cond.match(/max-width:\s*(\d+)px/);
    const min = cond.match(/min-width:\s*(\d+)px/);
    out.push({
      cond: cond.trim(),
      max: max ? Number(max[1]) : Infinity,
      min: min ? Number(min[1]) : 0,
      rules: flatRules(css.slice(open + 1, matchingClose(css, open))),
    });
  }
  return out;
}

const decl = (body, prop) => {
  const m = body.match(new RegExp(`(?:^|;|\\s)${prop}\\s*:\\s*([^;]+)`));
  return m ? m[1].trim() : undefined;
};

const MEDIA = mediaBlocks(CSS);

/** The media blocks with a rule that gives `selector` `display: none`. */
const blocksHiding = (test) => MEDIA.filter((b) => b.rules.some(
  (r) => r.selectors.some(test) && decl(r.body, 'display') === 'none',
));

/* The links collapse behind the burger at and below this width. */
const collapse = (() => {
  const blocks = blocksHiding((s) => s === '.mk-nav-links');
  if (blocks.length !== 1) throw new Error(`expected one @media hiding .mk-nav-links, found ${blocks.length}`);
  return blocks[0].max;
})();

/* The register door leaves the row at and below this width (-Infinity when
   nothing ever hides it). Only a hide that does not name the open menu counts:
   the open menu is the one place the door has to stay. */
const registerHiding = blocksHiding((s) => /\.mk-nav-register$/.test(s) && !/mk-nav--open/.test(s));
const registerHiddenUpTo = registerHiding.length ? Math.max(...registerHiding.map((b) => b.max)) : -Infinity;

const shellMax = Number(read('marketing', 'MarketingShell.css').match(/--mk-shell:\s*(\d+)px/)[1]);

/** Room for the row at viewport width `w`, the worst case: classic scrollbar. */
const room = (w) => Math.min(w - CLASSIC_SCROLLBAR, shellMax);

/** Collapse a sorted list of integers into readable "a–b" ranges. */
function ranges(ws) {
  const out = [];
  for (const w of ws) {
    const last = out[out.length - 1];
    if (last && last[1] === w - 1) last[1] = w; else out.push([w, w]);
  }
  return out.map(([a, b]) => (a === b ? `${a}px` : `${a}–${b}px`));
}

/** Every viewport width from the first one that shows the links up to 1600px
    at which the row on screen does not fit, as ranges. */
function widthsThatWrap(rowAt) {
  const bad = [];
  for (let w = collapse + 1; w <= 1600; w += 1) {
    if (MEASURED[rowAt(w)] + UNMEASURED_ENGINES > room(w)) bad.push(w);
  }
  return ranges(bad);
}

/* ================================================================ tests */
describe('the nav row fits on one line at every width that shows it', () => {
  test('signed out: no width between the burger and 1600px wraps the row', () => {
    const rowAt = (w) => (w > registerHiddenUpTo ? 'signedOutFull' : 'signedOutWithoutRegister');
    expect(widthsThatWrap(rowAt)).toEqual([]);
  });

  test('signed in: no width between the burger and 1600px wraps the row', () => {
    expect(widthsThatWrap(() => 'signedIn')).toEqual([]);
  });
});

describe('what goes first when the row gets tight is the mockup\'s choice', () => {
  test('the register door leaves the row before the links collapse', () => {
    expect(registerHiddenUpTo).toBeGreaterThan(collapse);
  });

  test('at 1024px (iPad landscape) the four page links and Sign in are still on screen', () => {
    // rejects: fixing the wrap by raising the collapse past 1024, which puts
    // every page link and Sign in behind a burger on a laptop-sized screen
    expect(collapse).toBeLessThan(1024);
    for (const b of MEDIA) {
      for (const r of b.rules) {
        if (decl(r.body, 'display') !== 'none' || b.max < 1024 || b.min > 1024) continue;
        for (const s of r.selectors) {
          expect(s).not.toMatch(/\.mk-nav-link\b|\.mk-btn-quiet|\.mk-btn-primary/);
        }
      }
    }
  });

  test('only the register door is hidden, never the signed-in "Open the app"', () => {
    // Both doors are .mk-btn-primary; hiding by that class would take the
    // signed-in host's one way back into the app with it.
    for (const b of registerHiding) {
      for (const r of b.rules) {
        if (decl(r.body, 'display') !== 'none') continue;
        for (const s of r.selectors) expect(s).not.toMatch(/mk-btn-primary/);
      }
    }
    expect(JSX).toMatch(/className="mk-btn mk-btn-primary mk-nav-register"[\s\S]{0,200}Create a host account/);
    expect(JSX).toMatch(/className="mk-btn mk-btn-primary" href="\/">Open the app/);
  });

  test('the open burger menu still offers the register door', () => {
    // Below the collapse the menu is the only place in the nav the door
    // lives; the hide above must not reach into it.
    const collapseBlock = MEDIA.find((b) => b.max === collapse && b.rules.some((r) => r.selectors.includes('.mk-nav-links')));
    const reshow = collapseBlock.rules.find((r) => r.selectors.some((s) => /\.mk-nav--open\b.*\.mk-nav-register$/.test(s)));
    expect(reshow).toBeDefined();
    expect(decl(reshow.body, 'display')).not.toBe('none');
    // It must out-rank the hide: more classes in its selector.
    const classes = (s) => (s.match(/\./g) || []).length;
    const hideSelectors = registerHiding.flatMap((b) => b.rules.flatMap((r) => r.selectors)).filter((s) => /\.mk-nav-register$/.test(s));
    for (const h of hideSelectors) {
      expect(classes(reshow.selectors.find((s) => /mk-nav-register$/.test(s)))).toBeGreaterThan(classes(h));
    }
  });
});

describe('the measurement is only as good as its inputs', () => {
  // Each of these fed a width in MEASURED. Change one and the numbers above
  // are stale: re-measure (method in the header) and update both together.
  const rule = (selector) => {
    // flatRules only ever matches innermost `sel { body }` pairs, so the
    // first match is the top-level rule, which precedes every @media block.
    const found = flatRules(CSS).find((r) => r.selectors.includes(selector));
    if (!found) throw new Error(`${selector} not found in MarketingShell.css`);
    return found.body;
  };

  test.each([
    ['.mk-nav-in', 'gap', '18px'],
    ['.mk-nav-links', 'gap', '4px'],
    ['.mk-nav-link', 'padding', '0 12px'],
    ['.mk-nav-link', 'font-weight', '600'],
    ['.mk-nav-link', 'font-size', 'var(--mk-t-body)'],
    ['.mk-btn', 'padding', '12px 20px'],
    ['.mk-btn', 'border', '2px solid transparent'],
    ['.mk-btn', 'font', '700 var(--mk-t-body)/1.2 var(--mk-font-ui)'],
    ['.mk-brand', 'gap', '10px'],
    ['.mk-brand', 'font-weight', '800'],
    ['.mk-brand', 'font-size', 'var(--mk-t-lead)'],
    ['.mk-brand', 'letter-spacing', '-0.01em'],
    ['.mk-brand-mark', 'width', '26px'],
  ])('%s %s is %s', (selector, prop, value) => {
    expect(decl(rule(selector), prop)).toBe(value);
  });

  test('the type steps, gutter and faces the row was measured in', () => {
    expect(CSS).toMatch(/--mk-t-body:\s*17px/);
    expect(CSS).toMatch(/--mk-t-lead:\s*21px/);
    expect(CSS).toMatch(/--mk-gutter:\s*24px/);
    expect(CSS).toMatch(/--mk-font-display:\s*"Archivo"/);
    expect(CSS).toMatch(/--mk-font-ui:\s*"Inter"/);
    expect(INDEX_HTML).toMatch(/family=Archivo:wdth,wght@125,700;125,800/);
    expect(INDEX_HTML).toMatch(/family=Inter:wght@400;500;600;700/);
  });

  test('the words the row was measured with', () => {
    for (const label of ['How it works', 'Use cases', 'Reports', 'Help']) {
      expect(JSX).toContain(`label: '${label}'`);
    }
    expect((JSX.match(/label: '/g) || []).length).toBe(4);
    expect(JSX).toMatch(/\n\s*Engagements\n\s*<\/a>/);
    expect(JSX).toMatch(/>\s*Sign in\s*</);
    expect(JSX).toMatch(/>\s*Create a host account\s*</);
    expect(JSX).toMatch(/>Open the app</);
  });
});
