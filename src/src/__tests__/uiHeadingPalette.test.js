/**
 * THE HEADING'S CSS CONTRACT (components/ui/Heading.css, PLAN §3 unit L2).
 *
 * Must prove: it reads the caller's ladder var, never a px. Also: the face,
 * weight and tracking are the display roles; the ink is --text and clears AA
 * on every ground in every skin x theme (--bg, --surface, --surface-2, every
 * stop of --field, and on dusk every stop of --wall-canvas, because a heading
 * is what the wall shows largest). Values come through the harness, never
 * retyped.
 *
 * Named *Palette.test.js, never *token*: .gitignore:35 is an unanchored
 * `*token*`. jsdom loads no stylesheet, so the contract is read as text.
 */
const fs = require('fs');
const path = require('path');
const H = require('../testing/skinHarness');

const CSS = fs.readFileSync(path.join(__dirname, '..', 'components', 'ui', 'Heading.css'), 'utf8');
const stripped = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
const RULES = H.parseRules(stripped.replace(/(\s|;|\{)([a-z-]+)\s*:/g, '$1--p-$2:'));

function decls(sel) {
  const rule = RULES.find((r) => r.selectors.join(', ') === sel);
  if (!rule) throw new Error(`no rule "${sel}" in Heading.css`);
  return Object.fromEntries(rule.decls.map((d) => [d.prop.replace(/^--p-/, ''), d.value]));
}
const hexes = (v) => (v.match(/#[0-9a-f]{3,8}\b/gi) || []);
const SIZES = ['hero', 'primary', 'secondary', 'title', 'head'];

test('every skin with a values file is checked, in both themes', () => {
  const skins = new Set(H.CASES.map(([s]) => s));
  expect(skins.has('classic')).toBe(true);
  for (const s of H.SKINS) {
    if (fs.existsSync(path.join(H.SRC, 'styles', 'skins', `${s}.css`))) expect(skins.has(s)).toBe(true);
  }
  expect(new Set(H.CASES.map(([, t]) => t))).toEqual(new Set(['dark', 'light']));
});

describe('the size is the caller\'s ladder, never a px', () => {
  test.each(SIZES)('size %s reads --ui-t-%s (falling back to the surrounding size)', (size) => {
    expect(decls(`.ui-heading.ui-heading--${size}`)['font-size']).toBe(`var(--ui-t-${size}, 1em)`);
  });

  test('no font-size anywhere in the sheet names a px, rem or vw', () => {
    const sizes = [...stripped.matchAll(/font-size\s*:([^;}]*)/g)].map((m) => m[1].trim());
    expect(sizes.length).toBe(SIZES.length);
    for (const v of sizes) expect(v).not.toMatch(/\d(px|rem|vw|vh|pt)\b/);
  });

  test('the base rule sets no size of its own (a size class always decides)', () => {
    expect(decls('.ui-heading')['font-size']).toBeUndefined();
  });
});

describe('the treatment comes from the display roles', () => {
  test('display face, weight and tracking; ink is --text; margin zero', () => {
    const d = decls('.ui-heading');
    expect(d['font-family']).toBe('var(--font-display)');
    expect(d['font-weight']).toBe('var(--display-weight)');
    expect(d['letter-spacing']).toBe('var(--display-tracking)');
    expect(d.color).toBe('var(--text)');
    expect(d.margin).toBe('0');
  });

  test('balance is text-wrap: balance', () => {
    expect(decls('.ui-heading.ui-heading--balance')['text-wrap']).toBe('balance');
  });

  test.each(H.CASES)('%s / %s: the display roles resolve to a face, a weight and a tracking', (skin, theme) => {
    const o = { skin, theme };
    expect(H.role('--font-display', o)).toMatch(/^"Archivo"/);
    expect(H.role('--display-weight', o)).toMatch(/^\d{3}$/);
    expect(H.role('--display-tracking', o)).toMatch(/em$/);
  });
});

describe.each(H.CASES)('%s / %s: the ink clears AA on every ground', (skin, theme) => {
  const o = { skin, theme };
  const R = (n) => H.role(n, o);
  test('--text on bg, surface, surface-2, the field and (dusk) the wall canvas', () => {
    const grounds = [['--bg', [R('--bg')]], ['--surface', [R('--bg'), R('--surface')]], ['--surface-2', [R('--bg'), R('--surface-2')]]];
    for (const stop of hexes(R('--field'))) grounds.push([`--field ${stop}`, [stop]]);
    if (theme === 'dark') for (const stop of hexes(R('--wall-canvas'))) grounds.push([`--wall-canvas ${stop}`, [stop]]);
    const failures = grounds
      .map(([name, stack]) => [name, H.on(R('--text'), stack)])
      .filter(([, r]) => r < H.AA)
      .map(([name, r]) => `--text on ${name}: ${r.toFixed(2)}`);
    expect(failures).toEqual([]);
  });
});

describe('the sheet reads roles only', () => {
  test('no literal colour, no font name, no --primary/--secondary, no --sk-*, no pragma needed', () => {
    expect(stripped.match(/#[0-9a-f]{3,8}\b/gi)).toBeNull();
    expect(stripped.match(/\b(rgba?|hsla?)\((?!var\()/g)).toBeNull();
    expect(stripped).not.toMatch(/\b(white|black)\b/);
    expect(stripped).not.toMatch(/var\(--(primary|secondary)/);
    expect(stripped).not.toMatch(/--sk-/);
    expect(CSS).not.toMatch(/skin-allowance/);
  });

  test('every custom property it reads is a role, or one of the caller\'s hooks', () => {
    const hooks = new Set([...SIZES.map((s) => `--ui-t-${s}`), '--ui-heading-leading']);
    const used = [...new Set([...stripped.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]))];
    const missing = used.filter((n) => !hooks.has(n) && (() => {
      try { H.role(n, { skin: 'classic', theme: 'dark' }); return false; } catch (_) { return true; }
    })());
    expect(missing).toEqual([]);
  });

  test('every selector is rooted at .ui-heading, and styles.css declares nothing there', () => {
    const sels = RULES.flatMap((r) => r.selectors);
    expect(sels.length).toBeGreaterThan(0);
    for (const s of sels) expect(s).toMatch(/^\.ui-heading\b/);
    expect(fs.readFileSync(path.join(H.SRC, 'styles.css'), 'utf8')).not.toMatch(/\.ui-heading\b/);
  });
});
