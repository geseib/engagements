/**
 * THE SHELL'S TYPE LADDER AND ITS COLOUR PAIRINGS.
 *
 * NAMED "Palette", not "Tokens": `.gitignore:35` is `*token*`, so this file was
 * invisible to git under its obvious name — it ran locally, passed, and would
 * never have reached CI. Do not rename it back.
 *
 * jsdom has no layout engine and does not resolve custom properties across
 * stylesheets, so nothing here asks the DOM anything. Both halves read the CSS
 * text and do arithmetic on it — which is the only honest way to assert either
 * one in this environment.
 *
 * The contrast maths is the same function docs/design/admin-redesign/audit.html
 * uses for its A4 assertion, which found `--danger` at 4.38:1 on `--surface`
 * and is why `--danger-text` exists at all.
 */
const fs = require('fs');
const path = require('path');

const SHELL_CSS = fs.readFileSync(
  path.join(__dirname, '..', 'components', 'AdminShell.css'),
  'utf8'
);
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
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
};

/** Read a token's hex out of a `:root`-style block in a stylesheet. */
function token(css, block, name) {
  const start = css.indexOf(block);
  if (start < 0) throw new Error(`no ${block} block`);
  const body = css.slice(start, css.indexOf('}', start));
  const m = body.match(new RegExp(`${name}\\s*:\\s*(#[0-9A-Fa-f]{6})`));
  if (!m) throw new Error(`${name} not declared in ${block}`);
  return m[1];
}

const DUSK = {
  bg: token(GLOBAL_CSS, '[data-theme="dark"]', '--bg'),
  surface: token(GLOBAL_CSS, '[data-theme="dark"]', '--surface'),
  surface2: token(GLOBAL_CSS, '[data-theme="dark"]', '--surface-2'),
  text: token(GLOBAL_CSS, '[data-theme="dark"]', '--text'),
  muted: token(GLOBAL_CSS, '[data-theme="dark"]', '--muted'),
};

describe('the type ladder, derived rather than inherited', () => {
  // RATIONALE §3: at ~120 CSS ppi read at 24in, 1px of cap height is 0.86
  // arcminutes. The six tiers are 12/13/15/19/24/30 px.
  //
  // rejects: importing the host stage's ladder, whose 20px floor is derived for
  // a projected image read at 25 feet by an audience and is nearly double what
  // this surface needs — it would cost this dense console a third of its rows.
  const LADDER = {
    '--adm-t-floor': 12,
    '--adm-t-label': 13,
    '--adm-t-body': 15,
    '--adm-t-head': 19,
    '--adm-t-title': 24,
    '--adm-t-numeral': 30,
  };

  test.each(Object.entries(LADDER))('%s is %ipx', (name, px) => {
    const m = SHELL_CSS.match(new RegExp(`${name}\\s*:\\s*(\\d+)px`));
    expect(m).not.toBeNull();
    expect(Number(m[1])).toBe(px);
  });

  test('no literal font-size in the shell is below the 12px floor', () => {
    // rejects: type creep. The commonest way a dense console gets illegible is
    // a 10px count or an 11px chip added later to make a row fit — which is
    // exactly what audit assertion A3 was written to catch on the mockups.
    const literals = [...SHELL_CSS.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)].map((m) =>
      Number(m[1])
    );
    const shorthand = [...SHELL_CSS.matchAll(/font:\s*[^;]*?\b(\d+(?:\.\d+)?)px\//g)].map((m) =>
      Number(m[1])
    );
    expect([...literals, ...shorthand].filter((px) => px < 12)).toEqual([]);
  });

  test('inputs are never dropped to the label tier', () => {
    // rejects: a 13px input producing 15px table text — RATIONALE §3.2, the
    // commonest way a dense console ends up illegible exactly where a mistake
    // costs the most.
    expect(SHELL_CSS).not.toMatch(/input[^{]*\{[^}]*font-size:\s*var\(--adm-t-label\)/);
  });
});

describe('the two colour tokens the designers added, and why', () => {
  test('--danger on --surface is under AA, which is the finding', () => {
    // This is not a test of our code; it is the measurement that justifies the
    // two tokens below, asserted so that a future edit to --danger cannot
    // quietly invalidate the reason they exist.
    const danger = token(GLOBAL_CSS, ':root', '--danger');
    expect(ratio(danger, DUSK.surface)).toBeLessThan(4.5);
  });

  test('--danger-text clears AA on all three dusk surfaces', () => {
    // rejects: painting destructive copy with --danger, which is 4.38:1 on
    // --surface and 3.56:1 on --surface-2. Destructive copy is precisely the
    // text a person must read carefully, and modals sit on --surface.
    const dangerText = token(GLOBAL_CSS, ':root', '--danger-text');
    expect(ratio(dangerText, DUSK.bg)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(dangerText, DUSK.surface)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(dangerText, DUSK.surface2)).toBeGreaterThanOrEqual(4.5);
  });

  test('--danger-deep carries --text on a filled destructive button', () => {
    // rejects: a filled --danger button, which carries white at 3.32:1.
    const dangerDeep = token(GLOBAL_CSS, ':root', '--danger-deep');
    expect(ratio(DUSK.text, dangerDeep)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('every pairing the shell chrome actually paints', () => {
  // Each row is a real selector in AdminShell.css. AA is 4.5:1 for normal text.
  // rejects: swapping any of these for a token that looks right and measures
  // wrong — which is how the unknown-environment chip would have shipped at
  // 4.38:1 if it had used --danger like every other red thing in the product.
  const PAIRS = [
    ['brand word / nav current label', DUSK.text, DUSK.surface, 4.5],
    ['nav item label, crumbs, who', DUSK.muted, DUSK.surface, 4.5],
    ['avatar initials on --surface-2', DUSK.text, DUSK.surface2, 4.5],
    ['screen title on the work field', DUSK.text, DUSK.bg, 4.5],
    ['subtitle on the work field', DUSK.muted, DUSK.bg, 4.5],
  ];

  test.each(PAIRS)('%s clears AA', (_label, fg, bg, min) => {
    expect(ratio(fg, bg)).toBeGreaterThanOrEqual(min);
  });

  test('the three environment chips clear AA on the top bar', () => {
    // The chip sits on --surface. dev=--secondary, prod=--primary,
    // unknown=--danger-text. rejects: any of the three being tinted down for
    // looks — the chip whose whole job is telling an operator they are on
    // production must not be the one that is hard to read.
    const secondary = token(GLOBAL_CSS, ':root', '--secondary');
    const primary = token(GLOBAL_CSS, ':root', '--primary');
    const dangerText = token(GLOBAL_CSS, ':root', '--danger-text');
    expect(ratio(secondary, DUSK.surface)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(primary, DUSK.surface)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(dangerText, DUSK.surface)).toBeGreaterThanOrEqual(4.5);
  });

  test('the pending-user badge label reads on its amber fill', () => {
    // rejects: white on --primary, which is 2.11:1. The badge is filled amber
    // and carries the dusk background colour as its label.
    const primary = token(GLOBAL_CSS, ':root', '--primary');
    expect(ratio('#0F1A2E', primary)).toBeGreaterThanOrEqual(4.5);
    expect(SHELL_CSS).toMatch(/\.adm-nav-badge\s*\{[^}]*color:\s*#0F1A2E/i);
  });
});
