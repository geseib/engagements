/**
 * THE GROUND'S CSS CONTRACT (components/ui/Ground.css, PLAN §3 unit L9).
 *
 * Must prove: flat under :root.d-call in both skins. This resolves which
 * `background` declaration of Ground.css wins on a ground element under each
 * display profile — by matching each selector against
 * <html class=PROFILE> > <div class="ui-ground [ui-ground--wall]"> and taking
 * the highest specificity, then the latest — and then resolves that value
 * through the harness for every skin x theme. Under Call it must be exactly
 * --bg (no gradient); under every other profile the page ground is --field
 * and the wall ground --wall-canvas.
 *
 * Also: --text and --muted clear AA on every colour stop of every ground in
 * every skin x theme. Values come through the harness, never retyped.
 *
 * Named *Palette.test.js, never *token*: .gitignore:35 is an unanchored
 * `*token*`. jsdom loads no stylesheet, so the contract is read as text.
 */
const fs = require('fs');
const path = require('path');
const H = require('../testing/skinHarness');

const CSS = fs.readFileSync(path.join(__dirname, '..', 'components', 'ui', 'Ground.css'), 'utf8');
const stripped = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
/* parseRules keeps custom properties only; prefix ordinary properties so it keeps them too. */
const RULES = H.parseRules(stripped.replace(/(\s|;|\{)([a-z-]+)\s*:/g, '$1--p-$2:'));
const hexes = (v) => (v.match(/#[0-9a-f]{3,8}\b/gi) || []);
const PROFILES = ['d-room', 'd-tv', 'd-call', 'd-table'];

function compoundMatches(c, el) {
  if (c.unsupported || c.attrs.length) return false;
  if (c.root !== !!el.root && c.root) return false;
  if (c.tag && c.tag !== el.tag) return false;
  return c.classes.every((k) => el.classes.includes(k));
}

/** The winning `background` on a ground element of `variant` under <html class=profile>. */
function background(variant, profile) {
  const html = { root: true, tag: 'html', classes: [profile] };
  const el = { root: false, tag: 'div', classes: ['ui-ground', ...(variant === 'wall' ? ['ui-ground--wall'] : [])] };
  let best = null;
  RULES.forEach((r, order) => {
    const d = r.decls.find((x) => x.prop === '--p-background');
    if (!d) return;
    for (const sel of r.selectors) {
      const p = H.parseSelector(sel);
      const cs = p.compounds;
      const last = cs[cs.length - 1];
      if (!compoundMatches(last, el)) continue;
      if (cs.length === 2 && !compoundMatches(cs[0], html)) continue;
      if (cs.length > 2) throw new Error(`selector deeper than this test reads: ${sel}`);
      const key = [...p.spec, order];
      const later = !best || (() => { const i = key.findIndex((v, k) => v !== best.key[k]); return i < 0 || key[i] > best.key[i]; })();
      if (later) best = { key, value: d.value, sel };
    }
  });
  if (!best) throw new Error(`no background for ${variant} under ${profile}`);
  return best.value;
}

describe('which background wins, per variant and profile', () => {
  test.each(PROFILES.filter((p) => p !== 'd-call'))('under %s: page = --field, wall = --wall-canvas', (profile) => {
    expect(background('page', profile)).toBe('var(--field)');
    expect(background('wall', profile)).toBe('var(--wall-canvas)');
  });
  test('under d-call: both are flat --bg', () => {
    expect(background('page', 'd-call')).toBe('var(--bg)');
    expect(background('wall', 'd-call')).toBe('var(--bg)');
  });
});

describe.each(H.CASES)('%s / %s: flat under :root.d-call', (skin, theme) => {
  const at = (profile) => ({ skin, theme, profile });
  test('both variants resolve to exactly --bg under Call, with no gradient', () => {
    for (const variant of ['page', 'wall']) {
      const name = background(variant, 'd-call').match(/var\((--[\w-]+)\)/)[1];
      const v = H.role(name, at('d-call'));
      expect(v).toBe(H.role('--bg', at('d-call')));
      expect(v).not.toMatch(/gradient/);
    }
  });
  test('roles.css agrees: --field itself is --bg under Call', () => {
    expect(H.role('--field', at('d-call'))).toBe(H.role('--bg', at('d-call')));
  });
});

test('Present is not flat outside Call (the test would notice a flat skin by accident)', () => {
  if (!H.CASES.some(([s]) => s === 'present')) return;
  expect(H.role('--field', { skin: 'present', theme: 'dark', profile: 'd-room' })).toMatch(/gradient/);
  expect(H.role('--wall-canvas', { skin: 'present', theme: 'dark', profile: 'd-room' })).toMatch(/gradient/);
  expect(H.role('--wall-canvas', { skin: 'classic', theme: 'dark', profile: 'd-room' })).toMatch(/gradient/);
});

describe.each(H.CASES)('%s / %s: the ink clears AA on every stop of the ground', (skin, theme) => {
  const o = { skin, theme };
  const R = (n) => H.role(n, o);
  test('--text and --muted on the page ground (and, dusk, the wall ground)', () => {
    const stops = [...hexes(R('--field')).map((h) => ['--field', h])];
    if (theme === 'dark') stops.push(...hexes(R('--wall-canvas')).map((h) => ['--wall-canvas', h]));
    expect(stops.length).toBeGreaterThan(0);
    const failures = [];
    for (const fg of ['--text', '--muted']) {
      for (const [g, h] of stops) {
        const r = H.ratio(R(fg), h);
        if (r < H.AA) failures.push(`${fg} on ${g} ${h}: ${r.toFixed(2)}`);
      }
    }
    expect(failures).toEqual([]);
  });
});

describe('the sheet reads roles only', () => {
  test('the ink is --text', () => {
    const base = RULES.find((r) => r.selectors.join(', ') === '.ui-ground');
    expect(base.decls.find((d) => d.prop === '--p-color').value).toBe('var(--text)');
  });

  test('no literal colour, no font name, no --primary/--secondary, no --sk-*, no pragma needed', () => {
    expect(stripped.match(/#[0-9a-f]{3,8}\b/gi)).toBeNull();
    expect(stripped.match(/\b(rgba?|hsla?)\((?!var\()/g)).toBeNull();
    expect(stripped).not.toMatch(/\b(white|black)\b/);
    expect(stripped).not.toMatch(/var\(--(primary|secondary)/);
    expect(stripped).not.toMatch(/--sk-/);
    expect(CSS).not.toMatch(/skin-allowance/);
  });

  test('it paints only: no size, padding, margin or position of its own', () => {
    expect(stripped).not.toMatch(/\b(width|height|padding|margin|position|inset|display)\s*:/);
  });

  test('every custom property it reads is a role', () => {
    const used = [...new Set([...stripped.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]))];
    const missing = used.filter((n) => { try { H.role(n, { skin: 'classic', theme: 'dark' }); return false; } catch (_) { return true; } });
    expect(missing).toEqual([]);
  });

  test('every selector ends at .ui-ground, and styles.css declares nothing there', () => {
    const sels = RULES.flatMap((r) => r.selectors);
    expect(sels.length).toBe(3);
    for (const s of sels) expect(s).toMatch(/(^|\s)\.ui-ground(\.ui-ground--wall)?$/);
    expect(fs.readFileSync(path.join(H.SRC, 'styles.css'), 'utf8')).not.toMatch(/\.ui-ground\b/);
  });
});
