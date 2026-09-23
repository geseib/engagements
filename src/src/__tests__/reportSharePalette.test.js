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

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const GLOBAL_CSS = read('styles.css');
const MY_CSS = read('components', 'ReportShare.css');
const stripped = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const CSS = stripped(MY_CSS);

/* ---- colour: the same arithmetic as docs/design/admin-redesign/audit.html ---- */
function lin(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function lum(c) { return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]); }
function ratio(a, b) {
  const la = lum(a); const lb = lum(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
const parseHex = (h) => [1, 3, 5].map((i) => parseInt(h.substr(i, 2), 16));
function alphaOver(fg, bg, a) { return fg.map((c, i) => c * a + bg[i] * (1 - a)); }
function parseRgba(s) {
  const m = s.match(/rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)/);
  return { rgb: [Number(m[1]), Number(m[2]), Number(m[3])], a: Number(m[4]) };
}

function token(css, block, name) {
  const start = css.indexOf(block);
  if (start < 0) throw new Error(`no ${block} block`);
  const body = css.slice(start, css.indexOf('}', start));
  const m = body.match(new RegExp(`${name}\\s*:\\s*(#[0-9A-Fa-f]{6}|rgba\\([^)]*\\))`));
  if (!m) throw new Error(`${name} not declared in ${block}`);
  return m[1];
}

const PAPER = '[data-theme="light"] {';
const ROOT = ':root {';
const MINE = '.rshare {';

const P = {
  bg: token(GLOBAL_CSS, PAPER, '--bg'),
  surface: token(GLOBAL_CSS, PAPER, '--surface'),
  surface2: token(GLOBAL_CSS, PAPER, '--surface-2'),
  text: token(GLOBAL_CSS, PAPER, '--text'),
  muted: token(GLOBAL_CSS, PAPER, '--muted'),
  primary: token(GLOBAL_CSS, ROOT, '--primary'),
  dangerDeep: token(GLOBAL_CSS, ROOT, '--danger-deep'),
  onPrimary: token(MY_CSS, MINE, '--rshare-on-primary'),
  accent: token(MY_CSS, MINE, '--rshare-accent'),
  success: token(MY_CSS, MINE, '--rshare-success'),
  fieldRule: token(MY_CSS, MINE, '--rshare-field-rule'),
};

const AA = 4.5;
const NON_TEXT = 3;

describe('every words-on-paper pairing clears AA', () => {
  // rejects: a quieter grey, a dusk tint, or amber ink on white.
  test.each([
    ['body text on the card and dialog', P.text, P.surface],
    ['body text on the page field', P.text, P.bg],
    ['the kicker, dates, facts and placeholder', P.muted, P.surface],
    ['a refusal ("does not open this report")', P.dangerDeep, P.surface],
    ['"Downloaded"', P.success, P.surface],
    ['the Done / Download report button', P.onPrimary, P.primary],
    ['a secondary button on hover', P.text, P.surface2],
  ])('%s', (_label, fg, bg) => {
    expect(ratio(parseHex(fg), parseHex(bg))).toBeGreaterThanOrEqual(AA);
  });
});

describe('what is not text still has to be found (WCAG 1.4.11, 3:1)', () => {
  // rejects: a focus ring in --primary, which is 1.96:1 on white.
  test('the focus ring', () => {
    expect(ratio(parseHex(P.accent), parseHex(P.surface))).toBeGreaterThanOrEqual(NON_TEXT);
    expect(CSS).toMatch(/\.rshare :focus-visible\s*\{[^}]*outline:\s*3px solid var\(--rshare-accent\)/);
  });

  // rejects: an input edge that fades until the field cannot be seen.
  test('the input and button edge, composited on white', () => {
    const { rgb, a } = parseRgba(P.fieldRule);
    const edge = alphaOver(rgb, parseHex(P.surface), a);
    expect(ratio(edge, parseHex(P.surface))).toBeGreaterThanOrEqual(NON_TEXT);
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
