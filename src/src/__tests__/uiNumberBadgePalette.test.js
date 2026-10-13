/**
 * NUMBER BADGE'S CSS CONTRACT (components/ui/NumberBadge.css, skins unit L4).
 *
 * Born on roles (docs/design/themes/SPEC.md §3, §6): every colour comes from
 * the skin values through styles/roles.css, read here through the harness
 * (src/src/testing/skinHarness.js) rather than retyped, so a changed skin
 * value moves these numbers.
 *
 * EVERY SKIN x BOTH THEMES. A library component can be mounted under dusk or
 * paper, so H.CASES (every skin with a values file x dark, light) is the set.
 * PLAN Phase 1 asks L4 to prove "ink on accent >= 4.5 in both skins"; the muted
 * tone's ink is proved on every ground a badge sits on (bg, surface, surface-2).
 *
 * Named *Palette.test.js, never *token* (.gitignore:35).
 */
const fs = require('fs');
const path = require('path');
const H = require('../testing/skinHarness');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const CSS = read('components', 'ui', 'NumberBadge.css');
const stripped = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** The declarations of one rule, by exact selector. */
function rule(selector) {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = stripped(CSS).match(new RegExp(`(^|\\n)${esc}\\s*\\{([^}]*)\\}`));
  if (!m) throw new Error(`no rule ${selector}`);
  return m[2];
}

test('both skins and both themes are checked', () => {
  const skins = new Set(H.CASES.map(([s]) => s));
  expect(skins.has('classic')).toBe(true);
  expect(skins.has('present')).toBe(true);
  expect(new Set(H.CASES.map(([, t]) => t))).toEqual(new Set(['dark', 'light']));
});

describe.each(H.CASES)('%s skin, %s', (skin, theme) => {
  const R = (name) => H.role(name, { skin, theme });

  test('accent tone: --on-accent ink on the --accent fill clears AA', () => {
    expect(H.ratio(R('--on-accent'), R('--accent'))).toBeGreaterThanOrEqual(H.AA);
  });

  test.each(['--bg', '--surface', '--surface-2'])('muted tone: --muted ink on %s clears AA', (ground) => {
    expect(H.on(R('--muted'), [R(ground)])).toBeGreaterThanOrEqual(H.AA);
  });

  test('on the wall the badge keeps the accent (only --action changes there)', () => {
    const wall = H.role('--accent', { skin, theme, surface: 'wall' });
    expect(wall).toBe(R('--accent'));
  });
});

describe('the rules paint what the palette proves', () => {
  test('accent: --accent ground, --on-accent ink', () => {
    expect(rule('.ui-badge.ui-badge--accent')).toMatch(/background:\s*var\(--accent\);/);
    expect(rule('.ui-badge.ui-badge--accent')).toMatch(/color:\s*var\(--on-accent\);/);
  });

  test('muted: no fill, a --rule-strong ring, --muted ink', () => {
    const r = rule('.ui-badge.ui-badge--muted');
    expect(r).toMatch(/background:\s*transparent;/);
    expect(r).toMatch(/box-shadow:\s*inset 0 0 0 var\(--hair, 1px\) var\(--rule-strong\);/);
    expect(r).toMatch(/color:\s*var\(--muted\);/);
  });

  test('the face, shape and figures are roles: display face, badge radius, tabular figures', () => {
    const r = rule('.ui-badge');
    expect(r).toMatch(/font-family:\s*var\(--font-display\);/);
    expect(r).toMatch(/border-radius:\s*var\(--badge-radius\);/);
    expect(r).toMatch(/font-variant-numeric:\s*tabular-nums;/);
  });

  test('the size is the caller\'s: --ui-size, everything else in em (the .present-badge geometry)', () => {
    const r = rule('.ui-badge');
    expect(r).toMatch(/font-size:\s*var\(--ui-size, 1em\);/);
    expect(r).toMatch(/min-width:\s*1\.7em;/);
    expect(r).toMatch(/height:\s*1\.7em;/);
    // the only px is the hairline's fallback (Call sets --hair: 2px)
    expect(stripped(CSS).replace(/var\(--hair, 1px\)/g, '')).not.toMatch(/\d+px/);
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

  test('every custom property read without a fallback resolves as a role in every case', () => {
    const used = [...new Set([...stripped(CSS).matchAll(/var\((--[\w-]+)\)/g)].map((m) => m[1]))];
    for (const [skin, theme] of H.CASES) {
      for (const n of used) expect(() => H.role(n, { skin, theme })).not.toThrow();
    }
  });

  test('every selector is in the .ui-badge scope, and styles.css declares none of it', () => {
    const heads = stripped(CSS).split('}').map((b) => b.split('{')[0].trim()).filter(Boolean);
    for (const h of heads) for (const sel of h.split(',')) expect(sel.trim()).toMatch(/^\.ui-badge(\.ui-badge--[a-z]+)?$/);
    expect(stripped(read('styles.css'))).not.toMatch(/\.ui-badge/);
  });
});
