/**
 * TALLY ROW'S CSS CONTRACT (components/ui/TallyRow.css, skins unit L10).
 *
 * Born on roles (docs/design/themes/SPEC.md §3, §6), read through the harness
 * (src/src/testing/skinHarness.js) for every skin, DUSK ONLY: units.json gives
 * L10 the dark theme (a tally is drawn on the wall and the stage). The theme
 * pin below fails if that changes, and then paper cases are owed.
 *
 * Every ink (--text, --muted) is held to AA on every ground a row sits on:
 * --bg, --surface, and each colour stop of the wall canvas (Classic's field
 * gradient, Present's glow). The bar is not text: 3:1 (WCAG 1.4.11).
 *
 * Named *Palette.test.js, never *token* (.gitignore:35).
 */
const fs = require('fs');
const path = require('path');
const H = require('../testing/skinHarness');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const CSS = read('components', 'ui', 'TallyRow.css');
const stripped = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const units = JSON.parse(read('..', '..', 'docs', 'design', 'themes', 'units.json'));

function rule(selector) {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = stripped(CSS).match(new RegExp(`(^|\\n)${esc}\\s*\\{([^}]*)\\}`));
  if (!m) throw new Error(`no rule ${selector}`);
  return m[2];
}

const DUSK = H.CASES.filter(([, t]) => t === 'dark').map(([s]) => s);

test('dusk only, every skin with a values file', () => {
  const list = Array.isArray(units) ? units : (units.units || Object.values(units));
  expect(list.find((u) => u.id === 'L10').themes).toEqual(['dark']);
  expect(DUSK).toEqual(expect.arrayContaining(['classic', 'present']));
});

describe.each(DUSK)('%s skin, dusk', (skin) => {
  const o = { skin, theme: 'dark' };
  const R = (name) => H.role(name, o);
  const wallStops = () => (R('--wall-canvas').match(/#[0-9a-f]{3,8}\b/gi) || []);
  const grounds = () => [['--bg', R('--bg')], ['--surface', R('--surface')], ...wallStops().map((h) => [`wall stop ${h}`, h])];

  test('the wall canvas has colour stops to check', () => {
    expect(wallStops().length).toBeGreaterThan(1);
  });

  test.each([
    ['label and points', '--text'],
    ['rank, first words and unit', '--muted'],
  ])('%s (%s) clear AA on every ground', (_l, fg) => {
    for (const [name, g] of grounds()) {
      const r = H.on(R(fg), [g]);
      if (r < H.AA) throw new Error(`${fg} on ${name} is ${r.toFixed(2)}:1`);
    }
  });

  test('the bar (--accent) clears 3:1 on every ground', () => {
    for (const [, g] of grounds()) expect(H.ratio(R('--accent'), g)).toBeGreaterThanOrEqual(3);
  });
});

describe('the rules paint what the palette proves', () => {
  test.each([
    ['.ui-trow', 'color', 'var(--text)'],
    ['.ui-trow .ui-trow-rank', 'color', 'var(--muted)'],
    ['.ui-trow .ui-trow-sub', 'color', 'var(--muted)'],
    ['.ui-trow .ui-trow-unit', 'color', 'var(--muted)'],
    ['.ui-trow .ui-trow-bar', 'background', 'var(--accent)'],
    ['.ui-trow .ui-trow-rank', 'font-family', 'var(--font-display)'],
  ])('%s %s is %s', (sel, prop, value) => {
    expect(rule(sel)).toMatch(new RegExp(`(^|[\\s;])${prop}:\\s*${value.replace(/[()]/g, '\\$&')};`));
  });

  test('tabular figures on the rank and the points', () => {
    expect(rule('.ui-trow .ui-trow-rank')).toMatch(/font-variant-numeric:\s*tabular-nums;/);
    expect(rule('.ui-trow .ui-trow-points')).toMatch(/font-variant-numeric:\s*tabular-nums;/);
  });

  test('the Presentation\'s grid: a 1.4em rank column, the label, the points', () => {
    expect(rule('.ui-trow')).toMatch(/grid-template-columns:\s*1\.4em minmax\(0, 1fr\) auto;/);
    expect(rule('.ui-trow')).toMatch(/font-size:\s*var\(--ui-size, 1em\);/);
  });

  test('the first-words line truncates the safe way (one text node, min-width on its cell)', () => {
    const sub = rule('.ui-trow .ui-trow-sub');
    expect(sub).toMatch(/display:\s*block;/);
    expect(sub).toMatch(/text-overflow:\s*ellipsis;/);
    expect(sub).toMatch(/white-space:\s*nowrap;/);
    expect(rule('.ui-trow .ui-trow-who')).toMatch(/min-width:\s*0;/);
  });
});

describe('the sheet reads roles only', () => {
  test('its allowance is zero on all three counts', () => {
    expect(CSS).toMatch(/^\/\* skin-allowance: colour=0 font=0 primary=0 \*\//);
  });

  test('no literal colour, no font name, no --primary/--secondary, no --sk-*', () => {
    const body = stripped(CSS);
    expect(body.match(/#[0-9a-f]{3,8}\b/gi)).toBeNull();
    expect(body.match(/\b(rgba?|hsla?)\((?!var\()/g)).toBeNull();
    expect(body).not.toMatch(/:\s*(white|black)\b/);
    expect(body).not.toMatch(/var\(--(primary|secondary)/);
    expect(body).not.toMatch(/--sk-/);
    expect(body).not.toMatch(/font-family:(?!\s*var\()/);
  });

  test('every custom property read without a fallback resolves as a role', () => {
    const used = [...new Set([...stripped(CSS).matchAll(/var\((--[\w-]+)\)/g)].map((m) => m[1]))];
    expect(used.length).toBeGreaterThan(0);
    for (const skin of DUSK) for (const n of used) expect(() => H.role(n, { skin, theme: 'dark' })).not.toThrow();
  });

  test('every selector is in the .ui-trow scope, and styles.css declares none of it', () => {
    const heads = stripped(CSS).split('}').map((b) => b.split('{')[0].trim()).filter(Boolean);
    for (const h of heads) for (const sel of h.split(',')) expect(sel.trim()).toMatch(/^\.ui-trow($|[\s.])/);
    expect(stripped(read('styles.css'))).not.toMatch(/\.ui-trow/);
  });
});
