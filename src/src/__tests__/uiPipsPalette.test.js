/**
 * PIPS' CSS CONTRACT (components/ui/Pips.css, skins unit L6).
 *
 * Born on roles (docs/design/themes/SPEC.md §3, §6), read through the harness
 * (src/src/testing/skinHarness.js) for every skin, DUSK ONLY: units.json gives
 * L6 the dark theme, because pips are drawn only on the wall and the stage.
 * The theme pin below fails if that changes, and then paper cases are owed.
 *
 * Pills carry no text, so WCAG 1.4.11 applies: "on" (--accent), "all done"
 * (--success) and the bar's marker must clear 3:1 against an empty pill
 * (--surface-2) and against every ground they sit on — --bg, --surface, and
 * each colour stop of the wall canvas (the Classic field gradient, the Present
 * glow). "Seen" is the Presentation's deliberately quiet past-page tint; it is
 * pinned to sit between an empty pill and an "on" pill, not to 3:1.
 *
 * Named *Palette.test.js, never *token* (.gitignore:35).
 */
const fs = require('fs');
const path = require('path');
const H = require('../testing/skinHarness');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const CSS = read('components', 'ui', 'Pips.css');
const stripped = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const units = JSON.parse(read('..', '..', 'docs', 'design', 'themes', 'units.json'));

function rule(selector) {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = stripped(CSS).match(new RegExp(`(^|\\n)${esc}\\s*\\{([^}]*)\\}`));
  if (!m) throw new Error(`no rule ${selector}`);
  return m[2];
}

const DUSK = H.CASES.filter(([, t]) => t === 'dark').map(([s]) => s);
const NON_TEXT = 3;

test('dusk only, every skin with a values file', () => {
  const list = Array.isArray(units) ? units : (units.units || Object.values(units));
  expect(list.find((u) => u.id === 'L6').themes).toEqual(['dark']);
  expect(DUSK).toEqual(expect.arrayContaining(['classic', 'present']));
});

describe.each(DUSK)('%s skin, dusk', (skin) => {
  const o = { skin, theme: 'dark' };
  const R = (name) => H.role(name, o);
  const wallStops = () => (R('--wall-canvas').match(/#[0-9a-f]{3,8}\b/gi) || []);
  const grounds = () => [R('--bg'), R('--surface'), ...wallStops()];
  const seen = (ground) => H.composite([ground, H.scopeVar(CSS, '.ui-pips {', '--ui-pips-seen', o)]);

  test('the wall canvas has colour stops to check', () => {
    expect(wallStops().length).toBeGreaterThan(1);
  });

  test.each(['--accent', '--success'])('%s (on / all) clears 3:1 against an empty pill', (fill) => {
    expect(H.ratio(R(fill), R('--surface-2'))).toBeGreaterThanOrEqual(NON_TEXT);
  });

  test.each(['--accent', '--success'])('%s (on / all, the marker) clears 3:1 on every ground', (fill) => {
    for (const g of grounds()) expect(H.ratio(R(fill), g)).toBeGreaterThanOrEqual(NON_TEXT);
  });

  test('seen sits between an empty pill and an on pill, on every ground', () => {
    const L = (c) => H.lum(H.parseColor(c).rgb);
    for (const g of grounds()) {
      const s = H.lum(seen(g));
      expect(s).toBeGreaterThan(L(R('--surface-2')));
      expect(s).toBeLessThan(L(R('--accent')));
    }
  });

  test('seen is the accent channel at .45 (the Presentation\'s --present-seen)', () => {
    const v = H.scopeVar(CSS, '.ui-pips {', '--ui-pips-seen', o);
    const { rgb, a } = H.parseColor(v);
    expect(rgb).toEqual(H.channel('--accent-rgb', o));
    expect(a).toBeCloseTo(0.45, 5);
  });
});

describe('the rules paint what the palette proves', () => {
  test.each([
    ['.ui-pips > i', 'var(--surface-2)'],
    ['.ui-pips > i.is-on', 'var(--accent)'],
    ['.ui-pips > i.is-all', 'var(--success)'],
    ['.ui-pips > i.is-seen', 'var(--ui-pips-seen)'],
    ['.ui-pips.is-bar', 'var(--surface-2)'],
    ['.ui-pips.is-bar .ui-pips-mark', 'var(--accent)'],
  ])('%s paints %s', (sel, value) => {
    expect(rule(sel)).toMatch(new RegExp(`background:\\s*${value.replace(/[()]/g, '\\$&')};`));
  });

  test('the default sizes are the Presentation\'s, so it can adopt the pips unchanged', () => {
    expect(rule('.ui-pips.ui-pips--meter > i')).toMatch(/width:\s*var\(--ui-meter-w, 44px\);[\s\S]*height:\s*var\(--ui-meter-h, 12px\);/);
    expect(rule('.ui-pips.ui-pips--meter')).toMatch(/gap:\s*var\(--ui-meter-gap, 8px\);/);
    expect(rule('.ui-pips.ui-pips--pages > i')).toMatch(/width:\s*var\(--ui-pages-w, 48px\);[\s\S]*height:\s*var\(--ui-pages-h, 10px\);/);
    expect(rule('.ui-pips.ui-pips--pages')).toMatch(/gap:\s*var\(--ui-pages-gap, 10px\);/);
    expect(rule('.ui-pips.ui-pips--track > i')).toMatch(/width:\s*var\(--ui-track-w, 30px\);/);
    expect(rule('.ui-pips.ui-pips--track > i.is-on')).toMatch(/width:\s*var\(--ui-track-on-w, 56px\);/);
    expect(rule('.ui-pips.ui-pips--track')).toMatch(/gap:\s*var\(--ui-track-gap, 6px\);/);
    expect(rule('.ui-pips.is-bar')).toMatch(/width:\s*var\(--ui-bar-w, 640px\);/);
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

  test('every custom property read without a fallback is a role or the scope\'s own --ui-pips-seen', () => {
    const used = [...new Set([...stripped(CSS).matchAll(/var\((--[\w-]+)\)/g)].map((m) => m[1]))].filter((n) => n !== '--ui-pips-seen');
    expect(used.length).toBeGreaterThan(0);
    for (const skin of DUSK) for (const n of used) expect(() => H.role(n, { skin, theme: 'dark' })).not.toThrow();
  });

  test('every selector is in the .ui-pips scope, and styles.css declares none of it', () => {
    const heads = stripped(CSS).split('}').map((b) => b.split('{')[0].trim()).filter(Boolean);
    for (const h of heads) for (const sel of h.split(',')) expect(sel.trim()).toMatch(/^\.ui-pips($|[\s.])/);
    expect(stripped(read('styles.css'))).not.toMatch(/\.ui-pips/);
  });
});
