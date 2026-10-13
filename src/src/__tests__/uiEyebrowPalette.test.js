/**
 * THE EYEBROW'S CSS CONTRACT (components/ui/Eyebrow.css, PLAN §3 unit L1).
 *
 * Must prove: uppercase; tracking, weight and colour from the --eyebrow-*
 * roles; AA in every skin x theme. The values are read through the harness
 * (styles/skins/*.css + styles/roles.css), never retyped, so a change to a
 * skin value moves these numbers.
 *
 * Grounds an eyebrow sits on: --bg, --surface, --surface-2, and every colour
 * stop of the theme's --field (Present's glow stop is the lightest dusk ground
 * there is). Every tone is checked on every ground.
 *
 * Named *Palette.test.js, never *token*: .gitignore:35 is an unanchored
 * `*token*`. jsdom loads no stylesheet, so the contract is read as text.
 */
const fs = require('fs');
const path = require('path');
const H = require('../testing/skinHarness');

const CSS = fs.readFileSync(path.join(__dirname, '..', 'components', 'ui', 'Eyebrow.css'), 'utf8');
const stripped = CSS.replace(/\/\*[\s\S]*?\*\//g, '');

/** Declarations of the rule whose selector list is exactly `sel`. */
function decls(sel) {
  const rule = H.parseRules(CSS.replace(/(\s|;|\{)([a-z-]+)\s*:/g, '$1--p-$2:'))
    .find((r) => r.selectors.join(', ') === sel);
  if (!rule) throw new Error(`no rule "${sel}" in Eyebrow.css`);
  return Object.fromEntries(rule.decls.map((d) => [d.prop.replace(/^--p-/, ''), d.value]));
}

const hexes = (v) => (v.match(/#[0-9a-f]{3,8}\b/gi) || []);

const TONES = [
  ['auto', '.ui-eyebrow', '--eyebrow-color'],
  ['muted', '.ui-eyebrow.ui-eyebrow--muted', '--muted'],
  ['accent', '.ui-eyebrow.ui-eyebrow--accent', '--accent-text'],
];

test('every skin with a values file is checked, in both themes', () => {
  const skins = new Set(H.CASES.map(([s]) => s));
  expect(skins.has('classic')).toBe(true);
  for (const s of H.SKINS) {
    if (fs.existsSync(path.join(H.SRC, 'styles', 'skins', `${s}.css`))) expect(skins.has(s)).toBe(true);
  }
  expect(new Set(H.CASES.map(([, t]) => t))).toEqual(new Set(['dark', 'light']));
});

describe('the treatment comes from the --eyebrow-* roles', () => {
  test('uppercase, on the UI face, weight / tracking / colour from the roles', () => {
    const d = decls('.ui-eyebrow');
    expect(d['text-transform']).toBe('uppercase');
    expect(d['font-family']).toBe('var(--font-ui)');
    expect(d['font-weight']).toBe('var(--eyebrow-weight)');
    expect(d['letter-spacing']).toBe('var(--eyebrow-tracking)');
    expect(d.color).toBe('var(--eyebrow-color)');
  });

  test.each(TONES)('tone %s paints %s with %s', (_t, sel, fg) => {
    expect(decls(sel).color).toBe(`var(${fg})`);
  });

  test('the size is the caller\'s ladder (--ui-eyebrow-size), never a px', () => {
    expect(decls('.ui-eyebrow')['font-size']).toBe('var(--ui-eyebrow-size, 1em)');
    expect(stripped).not.toMatch(/font-size\s*:[^;]*\dpx/);
  });

  test('Classic: muted capitals, 700, .15em (the stage .kicker)', () => {
    for (const theme of H.THEMES) {
      const o = { skin: 'classic', theme };
      expect(H.role('--eyebrow-color', o)).toBe(H.role('--muted', o));
      expect(H.role('--eyebrow-weight', o)).toBe('700');
      expect(H.role('--eyebrow-tracking', o)).toBe('.15em');
    }
  });

  const present = H.CASES.some(([s]) => s === 'present');
  (present ? test : test.skip)('Present: accent capitals, 600, .12em (the Presentation eyebrow)', () => {
    for (const theme of H.THEMES) {
      const o = { skin: 'present', theme };
      expect(H.role('--eyebrow-color', o)).toBe(H.role('--accent-text', o));
      expect(H.role('--eyebrow-weight', o)).toBe('600');
      expect(H.role('--eyebrow-tracking', o)).toBe('.12em');
    }
  });
});

describe.each(H.CASES)('%s / %s: every tone clears AA on every ground', (skin, theme) => {
  const o = { skin, theme };
  const R = (n) => H.role(n, o);
  const grounds = () => {
    const out = [['--bg', [R('--bg')]], ['--surface', [R('--bg'), R('--surface')]], ['--surface-2', [R('--bg'), R('--surface-2')]]];
    for (const stop of hexes(R('--field'))) out.push([`--field stop ${stop}`, [stop]]);
    return out;
  };

  test.each(TONES)('tone %s', (_t, _sel, fg) => {
    const failures = grounds()
      .map(([name, stack]) => [name, H.on(R(fg), stack)])
      .filter(([, r]) => r < H.AA)
      .map(([name, r]) => `${fg} on ${name}: ${r.toFixed(2)}`);
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

  test('every custom property it reads is a role, or the caller\'s size hook', () => {
    const used = [...new Set([...stripped.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]))];
    const missing = used.filter((n) => n !== '--ui-eyebrow-size' && (() => {
      try { H.role(n, { skin: 'classic', theme: 'dark' }); return false; } catch (_) { return true; }
    })());
    expect(missing).toEqual([]);
  });

  test('every selector is rooted at .ui-eyebrow, and styles.css declares nothing there', () => {
    const sels = H.parseRules(stripped.replace(/(\s|;|\{)([a-z-]+)\s*:/g, '$1--p-$2:')).flatMap((r) => r.selectors);
    expect(sels.length).toBeGreaterThan(0);
    for (const s of sels) expect(s).toMatch(/^\.ui-eyebrow\b/);
    const global = fs.readFileSync(path.join(H.SRC, 'styles.css'), 'utf8');
    expect(global).not.toMatch(/\.ui-eyebrow\b/);
  });
});
