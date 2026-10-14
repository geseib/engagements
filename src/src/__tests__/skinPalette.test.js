/**
 * THE SKIN VALUES AND THE ROLES (docs/design/themes/SPEC.md §2-§4, §7).
 *
 *   styles/skins/<id>.css   layer 1: flat --sk-* values on ONE root block
 *   styles/roles.css        layer 2: theme x values -> the roles stylesheets read
 *   styles.css              keeps only the migration aliases (SPEC §4.4)
 *
 * What green means: every skin file has the same keys and nothing but values; a skin
 * value reads only other skin values (decision 2 of Phase 0a: a role read there resolves
 * on <html>, which is paper); every role resolves for every skin x theme; the values are
 * SPEC §4's, except the three Classic amendments 0a made to keep Classic pixel-identical;
 * and every pairing SPEC §4 measures clears AA in every skin x theme, except the two
 * Classic paper inks that fail today and are kept as they are.
 *
 * jsdom loads no stylesheet, so all of this is text and arithmetic (testing/skinHarness.js).
 * Named *Palette.test.js, never *token*: .gitignore:35 is an unanchored `*token*`.
 */
const fs = require('fs');
const path = require('path');
const H = require('../testing/skinHarness');

const SRC = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(SRC, ...p), 'utf8');
const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, ' ');
const SKIN_IDS = fs.readdirSync(path.join(SRC, 'styles', 'skins'))
  .filter((f) => /^[a-z][a-z0-9-]*\.css$/.test(f)).map((f) => f.replace(/\.css$/, '')).sort();
const SKIN_CSS = Object.fromEntries(SKIN_IDS.map((id) => [id, read('styles', 'skins', `${id}.css`)]));
const ROLES_CSS = read('styles', 'roles.css');
const GLOBAL_CSS = read('styles.css');
const SPEC_ROWS = JSON.parse(fs.readFileSync(path.join(SRC, '..', '..', 'scripts', 'skins', 'fixtures', 'spec-skins', 'expected.json'), 'utf8'));

const decls = (css) => H.parseRules(css).flatMap((r) => r.decls);
const keysOf = (id) => decls(SKIN_CSS[id]).map((d) => d.prop).sort();
const varsIn = (value) => [...value.matchAll(/var\(\s*(--[\w-]+)/g)].map((m) => m[1]);

describe('the skin files are values and nothing else', () => {
  test('Classic and Present both exist, and the harness measures both', () => {
    expect(SKIN_IDS).toEqual(expect.arrayContaining(['classic', 'present']));
    expect(H.CASES).toEqual(expect.arrayContaining([['classic', 'dark'], ['classic', 'light'], ['present', 'dark'], ['present', 'light']]));
  });

  test.each(SKIN_IDS)('%s.css is one root block, with the selector its skin needs', (id) => {
    // Classic also answers to a bare :root, so it is what renders with no data-skin at
    // all (first paint, jest, a corrupt stored value). Every other skin must out-rank it.
    const css = strip(SKIN_CSS[id]);
    expect(css).not.toMatch(/@/);
    const rules = H.parseRules(SKIN_CSS[id]);
    expect(rules).toHaveLength(1);
    expect((css.match(/\{/g) || []).length).toBe(1);
    const want = id === 'classic' ? [':root', ':root[data-skin="classic"]'] : [`:root[data-skin="${id}"]`];
    expect(rules[0].selectors).toEqual(want);
  });

  test.each(SKIN_IDS)('%s.css declares only --sk-* values, each once, none empty', (id) => {
    const all = decls(SKIN_CSS[id]);
    expect(all.length).toBeGreaterThan(60);
    for (const d of all) {
      expect(d.prop).toMatch(/^--sk-[a-z0-9-]+$/);
      expect(d.value).not.toBe('');
      expect(d.important).toBe(false);
    }
    expect(new Set(all.map((d) => d.prop)).size).toBe(all.length);
  });

  test.each(SKIN_IDS.filter((id) => id !== 'classic'))('%s.css has exactly Classic\'s keys', (id) => {
    expect(keysOf(id)).toEqual(keysOf('classic'));
  });

  test.each(SKIN_IDS)('%s.css reads only --sk-* values it declares itself, never a role', (id) => {
    // rejects: `--sk-dark-eyebrow-color: var(--muted)`. The block is resolved on <html>,
    // whose data-theme is "light" (public/index.html:2), so dusk would get paper's muted.
    const own = new Set(keysOf(id));
    const bad = decls(SKIN_CSS[id]).flatMap((d) => varsIn(d.value).filter((n) => !own.has(n)).map((n) => `${d.prop}: ${n}`));
    expect(bad).toEqual([]);
  });

  test('a skin may not set the profile ladders (SPEC §8)', () => {
    for (const id of SKIN_IDS) {
      expect(SKIN_CSS[id]).not.toMatch(/--(?:sk-)?(?:L-[\w-]+|floor|hair|[\w-]+-t-[\w-]+)\s*:/);
    }
  });

  test('the role reference the trap would produce is really wrong, so the rule above is not vacuous', () => {
    // A skin value written as var(--muted) resolves against <html data-theme="light">.
    expect(H.role('--muted', { skin: 'classic', theme: 'light' })).not.toBe(H.role('--muted', { skin: 'classic', theme: 'dark' }));
  });
});

describe('roles.css maps theme x values to roles', () => {
  const ROLE_RULES = H.parseRules(ROLES_CSS);
  const SHIM = '.report-paper .tpr';
  const ALLOWED = [':root', '[data-theme="dark"]', '[data-theme="light"]', ':root.d-call', ':root.d-call [data-theme]', '[data-surface="wall"]', SHIM];

  test('it declares on :root, the themes, the Call profile and the wall only (plus one named shim)', () => {
    const selectors = [...new Set(ROLE_RULES.flatMap((r) => r.selectors))];
    expect(selectors.filter((s) => !ALLOWED.includes(s))).toEqual([]);
  });

  test('every --sk-* it reads is declared by every skin', () => {
    const read = [...new Set(decls(ROLES_CSS).flatMap((d) => varsIn(d.value)).filter((n) => n.startsWith('--sk-')))];
    expect(read.length).toBeGreaterThan(50);
    for (const id of SKIN_IDS) expect(read.filter((n) => !keysOf(id).includes(n))).toEqual([]);
  });

  test('it declares no --sk-* and writes no colour of its own', () => {
    expect(decls(ROLES_CSS).filter((d) => d.prop.startsWith('--sk-'))).toEqual([]);
    expect(strip(ROLES_CSS)).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\b(rgba?|hsla?)\(|\b(white|black)\b/);
  });

  test('every skin value is read by roles.css (no orphan values)', () => {
    const read = new Set(decls(ROLES_CSS).flatMap((d) => varsIn(d.value)));
    for (const k of keysOf('classic')) {
      const readByASibling = decls(SKIN_CSS.classic).some((d) => varsIn(d.value).includes(k));
      if (!read.has(k) && !readByASibling) throw new Error(`${k} is declared by the skins and read by nothing`);
    }
  });

  test('the migration shim keeps the Build Room report link in --text, as it was', () => {
    // TalkingPointsReport.css reads var(--info, var(--text)); --info did not exist before
    // Phase 0a. Delete the shim (and this test) when that sheet is migrated.
    const shim = ROLE_RULES.find((r) => r.selectors.includes(SHIM));
    expect(shim.decls).toEqual([{ prop: '--info', value: 'var(--text)', important: false }]);
    expect(read('components', 'TalkingPointsReport.css')).toMatch(/var\(--info, var\(--text\)\)/);
  });

  test('no stylesheet outside the skins and roles reads a --sk-* value', () => {
    const walk = (dir, out = []) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { if (!['node_modules', '__tests__', 'testing', 'skins'].includes(e.name)) walk(p, out); } else if (/\.(css|jsx?)$/.test(e.name)) out.push(p);
      }
      return out;
    };
    const offenders = walk(SRC)
      .filter((p) => !p.endsWith(path.join('styles', 'roles.css')))
      .filter((p) => /var\(\s*--sk-/.test(strip(fs.readFileSync(p, 'utf8'))))
      .map((p) => path.relative(SRC, p));
    expect(offenders).toEqual([]);
  });
});

describe('the order the browser cascades them in', () => {
  test('index.jsx imports App, then the skins, then roles.css, then styles.css', () => {
    // After App, so the [data-theme] role blocks sit after every component sheet App
    // imports — exactly where styles.css's own token blocks were before Phase 0a. A
    // component's `.scope { --text: … }` on an element that also carries data-theme kept
    // losing to the theme block then, and must keep losing to it now.
    const jsx = read('index.jsx');
    const at = (s) => jsx.indexOf(`import ${s}`);
    const order = ["App from './App'", "'./styles/skins/classic.css'", "'./styles/skins/present.css'", "'./styles/roles.css'", "'./styles.css'"].map(at);
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  test('styles.css no longer declares a role, so nothing below roles.css overrides one', () => {
    const roleNames = new Set(decls(ROLES_CSS).map((d) => d.prop));
    const sc00 = GLOBAL_CSS.slice(0, GLOBAL_CSS.indexOf('/* skin-allowance SC-01'));
    const declared = decls(sc00).map((d) => d.prop);
    expect(declared.filter((n) => roleNames.has(n))).toEqual([]);
    expect(declared.sort()).toEqual(['--hairline', '--primary', '--primary-deep', '--ridge-front', '--secondary', '--space']);
  });

  test('the aliases are the same colour in every skin (a read of --primary keeps today\'s orange)', () => {
    H.eachSkinTheme((skin, theme) => {
      expect(H.role('--primary', { skin, theme }).toUpperCase()).toBe('#F6A94C');
      expect(H.role('--secondary', { skin, theme }).toUpperCase()).toBe('#7CA7E6');
      expect(H.role('--primary-deep', { skin, theme }).toUpperCase()).toBe('#C77B4A');
    });
  });
});

/* The three role names that rendered, theme-invariant, before 0a and are read by sheets 0a
   does not own. Classic keeps that value in both themes (styles/skins/classic.css,
   "CLASSIC AMENDMENTS"); SPEC §4's Classic column had a per-theme value. */
const AMENDED = {
  '--rule|classic|dark': 'rgba(155,168,190,.22)',
  '--rule|classic|light': 'rgba(155,168,190,.22)',
  '--success-text|classic|light': '#6FD0A4',
  '--danger-text|classic|light': '#EF8C86',
};
const same = (a, b) => {
  try {
    const x = H.parseColor(a); const y = H.parseColor(b);
    return x.rgb.every((v, i) => Math.abs(v - y.rgb[i]) < 0.5) && Math.abs(x.a - y.a) < 0.001;
  } catch (_) {
    return String(a).replace(/\s+/g, ' ').toLowerCase() === String(b).replace(/\s+/g, ' ').toLowerCase();
  }
};

describe('the values are SPEC §4\'s', () => {
  const rows = SPEC_ROWS.rows.map(([name, skin, theme, want, opts = {}]) => [name, skin, theme, want, opts]);
  test.each(rows)('%s (%s, %s) is %s', (name, skin, theme, want, opts) => {
    const got = H.role(name, { skin, theme, ...opts });
    const amended = AMENDED[`${name}|${skin}|${theme}`];
    expect(same(got, amended && !opts.surface && !opts.profile ? amended : want)).toBe(true);
  });

  test.each(Object.entries(AMENDED))('Classic amendment %s holds today\'s value %s', (key, want) => {
    const [name, skin, theme] = key.split('|');
    expect(same(H.role(name, { skin, theme }), want)).toBe(true);
  });

  test('the two channel roles added in 0a resolve, with Classic\'s pixels, in every skin x theme', () => {
    H.eachSkinTheme((skin, theme) => {
      expect(H.channel('--shade-rgb', { skin, theme })).toEqual([15, 26, 46]);
      expect(H.channel('--glow-rgb', { skin, theme })).toEqual([244, 237, 228]);
    });
  });

  test('the skin really switches: Present\'s accent is blue where Classic\'s is orange', () => {
    for (const theme of H.THEMES) {
      expect(H.role('--accent', { skin: 'classic', theme }).toUpperCase()).toBe('#F6A94C');
      expect(H.role('--accent', { skin: 'present', theme }).toUpperCase()).toBe('#7CA7E6');
    }
  });

  test('on the wall, Present\'s action is its accent and Classic\'s is the stage orange', () => {
    for (const theme of H.THEMES) {
      expect(H.role('--action', { skin: 'present', theme, surface: 'wall' })).toBe(H.role('--accent', { skin: 'present', theme }));
      expect(H.role('--action', { skin: 'classic', theme, surface: 'wall' })).toBe(H.role('--action', { skin: 'classic', theme }));
    }
  });

  test('under Call the field is flat in every skin', () => {
    H.eachSkinTheme((skin, theme) => {
      expect(H.role('--field', { skin, theme, profile: 'd-call' })).toBe(H.role('--bg', { skin, theme }));
    });
  });
});

/* Inks that are under AA on paper in Classic TODAY and stay that way (pixel identity
   outranks the role); paper copy that needs AA uses --danger-deep in Classic. */
const CLASSIC_PAPER_EXCEPTIONS = ['--success-text', '--danger-text'];

describe.each(H.CASES)('every pairing SPEC §4 measures clears AA — %s / %s', (skin, theme) => {
  const r = (n, o = {}) => H.role(n, { skin, theme, ...o });
  const grounds = ['--bg', '--surface', '--surface-2'];
  const inks = ['--text', '--muted', '--accent-text', '--eyebrow-color', '--success-text', '--danger-text'];
  const pairs = inks.flatMap((ink) => grounds.map((g) => [ink, g]));

  test.each(pairs)('%s on %s', (ink, ground) => {
    const ratio = H.ratio(r(ink), r(ground));
    if (skin === 'classic' && theme === 'light' && CLASSIC_PAPER_EXCEPTIONS.includes(ink)) {
      expect(ratio).toBeLessThan(H.AA);   // the known exception: if this starts passing, retire it
      return;
    }
    expect(ratio).toBeGreaterThanOrEqual(H.AA);
  });

  test('ink on the filled action, the filled accent and the wall\'s action', () => {
    expect(H.ratio(r('--on-action'), r('--action'))).toBeGreaterThanOrEqual(H.AA);
    expect(H.ratio(r('--on-accent'), r('--accent'))).toBeGreaterThanOrEqual(H.AA);
    expect(H.ratio(r('--on-action', { surface: 'wall' }), r('--action', { surface: 'wall' }))).toBeGreaterThanOrEqual(H.AA);
  });

  test('text, muted and accent copy on the lightest stop of the field', () => {
    const field = r('--field');
    const stop = (field.match(/#[0-9A-Fa-f]{6}/) || [field])[0];
    for (const ink of ['--text', '--muted', '--accent-text']) expect(H.ratio(r(ink), stop)).toBeGreaterThanOrEqual(H.AA);
  });

  (theme === 'dark' ? test : test.skip)('accent copy on a selected row, composited over surface and surface-2', () => {
    // SPEC §4.2: the reason Present's dusk accent-text is the lifted #9CBEF0.
    for (const g of ['--surface', '--surface-2']) {
      expect(H.on(r('--accent-text'), [r(g), r('--row-selected')])).toBeGreaterThanOrEqual(H.AA);
      expect(H.on(r('--text'), [r(g), r('--row-hover')])).toBeGreaterThanOrEqual(H.AA);
    }
  });
});
