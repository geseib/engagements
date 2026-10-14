/**
 * THE SHARE SURFACES' CSS CONTRACT — components/ReportShare.css.
 *
 * The host's "Report saved" dialog and the recipient's /shared-report page.
 * jsdom loads no stylesheet and resolves no custom property, so this reads the
 * stylesheet AS TEXT and does the arithmetic, like every other *Palette test
 * here. Named `*Palette`, never `*Token*`: `.gitignore` has an unanchored
 * `*token*` and such a file would never reach CI.
 *
 * Both surfaces are PAPER (they declare data-theme="light"), so every pairing
 * is measured on the paper set — which is where the traps are: --primary is
 * 1.96:1 on white and --danger-text is a dusk tint.
 */
const fs = require('fs');
const path = require('path');
const H = require('../testing/skinHarness');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const GLOBAL_CSS = require('../testing/classicGlobalCss')();
const MY_CSS = read('components', 'ReportShare.css');
const stripped = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const CSS = stripped(MY_CSS);

const MINE = '.rshare {';
const SCRIM = '.rshare-scrim {';
const NON_TEXT = 3;

/*
 * EVERY SKIN, PAPER ONLY. Both surfaces declare data-theme="light" themselves
 * (asserted at the foot of this file), so the dusk column of H.CASES is not a
 * surface this sheet ever paints and is left out on purpose.
 */
const PAPER_CASES = H.CASES.filter(([, theme]) => theme === 'light');

const palette = (skin, theme) => {
  const opts = { skin, theme };
  const mine = (name) => H.scopeVar(MY_CSS, MINE, name, opts);
  return {
    bg: H.role('--bg', opts),
    surface: H.role('--surface', opts),
    surface2: H.role('--surface-2', opts),
    text: H.role('--text', opts),
    muted: H.role('--muted', opts),
    primary: H.role('--primary', opts),
    dangerDeep: H.role('--danger-deep', opts),
    onPrimary: mine('--rshare-on-primary'),
    accent: mine('--rshare-accent'),
    success: mine('--rshare-success'),
    fieldRule: mine('--rshare-field-rule'),
    shadow: mine('--rshare-shadow'),
    scrim: H.scopeVar(MY_CSS, SCRIM, '--rshare-scrim', opts),
  };
};

describe.each(PAPER_CASES)('%s / %s: every words-on-paper pairing clears AA', (skin, theme) => {
  const P = palette(skin, theme);
  // rejects: a quieter grey, a dusk tint, or amber ink on white.
  test.each([
    ['body text on the card and dialog', 'text', 'surface'],
    ['body text on the page field', 'text', 'bg'],
    ['the kicker, dates, facts and placeholder', 'muted', 'surface'],
    ['a refusal ("does not open this report")', 'dangerDeep', 'surface'],
    ['"Downloaded"', 'success', 'surface'],
    ['the Done / Download report button', 'onPrimary', 'primary'],
    ['a secondary button on hover', 'text', 'surface2'],
  ])('%s', (_label, fg, bg) => {
    expect(H.ratio(P[fg], P[bg])).toBeGreaterThanOrEqual(H.AA);
  });
});

describe.each(PAPER_CASES)('%s / %s: what is not text still has to be found (WCAG 1.4.11, 3:1)', (skin, theme) => {
  const P = palette(skin, theme);
  // rejects: a focus ring in --primary, which is 1.96:1 on white.
  test('the focus ring', () => {
    expect(H.ratio(P.accent, P.surface)).toBeGreaterThanOrEqual(NON_TEXT);
    expect(CSS).toMatch(/\.rshare :focus-visible\s*\{[^}]*outline:\s*3px solid var\(--rshare-accent\)/);
  });

  // rejects: an input edge that fades until the field cannot be seen.
  test('the input and button edge, composited on white', () => {
    const edge = H.composite([P.surface, P.fieldRule]);
    expect(H.ratio(edge, P.surface)).toBeGreaterThanOrEqual(NON_TEXT);
  });
});

describe.each(H.CASES)('%s / %s: the shade channel keeps Classic\'s navy', (skin, theme) => {
  // 0b-4 moved the shadow and the scrim onto --shade-rgb; the alphas did not move.
  test('shadow .28 and scrim .55, both in 15 26 46', () => {
    const P = palette(skin, theme);
    const shadow = H.parseColor(P.shadow);
    const scrim = H.parseColor(P.scrim);
    expect(shadow.rgb).toEqual(H.channel('--shade-rgb', { skin, theme }));
    expect(scrim.rgb).toEqual(H.channel('--shade-rgb', { skin, theme }));
    if (skin === 'classic') expect(shadow.rgb).toEqual([15, 26, 46]);
    expect(shadow.a).toBeCloseTo(0.28, 3);
    expect(scrim.a).toBeCloseTo(0.55, 3);
  });
});

describe('the stylesheet keeps to its own scope and to tokens', () => {
  const selectors = [...CSS.matchAll(/(^|\})\s*([^{}@]+?)\s*\{/g)].map((m) => m[2].trim());

  test('it has rules to check (guards the scan)', () => {
    expect(selectors.length).toBeGreaterThan(20);
  });

  // rejects: a bare .btn or .modal that would fight styles.css.
  test('every selector starts with .rshare', () => {
    const stray = selectors.flatMap((s) => s.split(',')).map((s) => s.trim())
      .filter((s) => !s.startsWith('.rshare'));
    expect(stray).toEqual([]);
  });

  // rejects: the one scope another stylesheet could already own.
  test('styles.css declares nothing under .rshare', () => {
    expect(stripped(GLOBAL_CSS)).not.toMatch(/\.rshare/);
  });

  // rejects: a raw colour dropped into a rule instead of a token.
  test('every colour literal is a token declaration', () => {
    const offenders = CSS.split('\n')
      .filter((l) => /#[0-9A-Fa-f]{3,6}\b|rgba?\(/.test(l))
      .filter((l) => !/^\s*--rshare-[\w-]+\s*:/.test(l));
    expect(offenders).toEqual([]);
  });

  // rejects: --danger carrying words (4.38:1 at best), or the dusk tint on paper.
  test('no copy in --danger or --danger-text', () => {
    expect(CSS).not.toMatch(/color:\s*var\(--danger\)/);
    expect(CSS).not.toMatch(/var\(--danger-text\)/);
  });

  test('every var() it reads is declared somewhere', () => {
    const declared = new Set([...`${GLOBAL_CSS}\n${MY_CSS}`.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
    const used = [...CSS.matchAll(/var\((--[\w-]+)\)/g)].map((m) => m[1]);
    expect(used.filter((v) => !declared.has(v))).toEqual([]);
  });

  // rejects: shrinking a label under the floor, or an input under 16px (iOS zooms).
  test('the ladder: nothing below 13px, and inputs at 16px', () => {
    const sizes = [...CSS.matchAll(/--rshare-t-[\w-]+:\s*(\d+)px/g)].map((m) => Number(m[1]));
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(13);
    expect(MY_CSS).toMatch(/--rshare-t-body:\s*16px/);
    expect(CSS).toMatch(/\.rshare-input\s*\{[^}]*font:\s*400 var\(--rshare-t-body\)/);
  });
});

describe('the dialog\'s scrim stays reachable', () => {
  // rejects: centring a scrolling scrim, which overflows both ways with only
  // one reachable (the recurring bug the design rules name).
  test('the scrim scrolls from the top and the card centres by its margin', () => {
    const scrim = CSS.match(/\.rshare-scrim\s*\{([^}]*)\}/)[1];
    expect(scrim).toMatch(/align-items:\s*flex-start/);
    expect(scrim).toMatch(/overflow-y:\s*auto/);
    expect(CSS).toMatch(/\.rshare-dialog\s*\{[^}]*margin:\s*auto/);
  });

  // rejects: justify-content: flex-end on a wrapping action row.
  test('the action row pushes with margin-left, not flex-end', () => {
    const actions = CSS.match(/\.rshare-actions\s*\{([^}]*)\}/)[1];
    expect(actions).not.toMatch(/justify-content:\s*flex-end/);
    expect(CSS).toMatch(/\.rshare-actions > :first-child\s*\{\s*margin-left:\s*auto/);
  });
});

describe('both surfaces declare paper themselves', () => {
  test('the page on its root, the dialog through Modal', () => {
    expect(read('components', 'SharedReportPage.jsx')).toMatch(/className="rshare rshare-page" data-theme="light"/);
    expect(read('components', 'ReportSavedDialog.jsx')).toMatch(/theme="light"/);
  });
});
