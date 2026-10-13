/**
 * CARD'S CSS CONTRACT (components/ui/Card.css, skins unit L5).
 *
 * Born on roles (docs/design/themes/SPEC.md §3, §6), read here through the
 * harness (src/src/testing/skinHarness.js), every skin x both themes: a library
 * card can be mounted under dusk or paper.
 *
 * TEXT is held to AA (4.5:1) on every pairing. THE SELECTED BORDER AND MARK are
 * not text, so WCAG 1.4.11 (3:1 against the card) is what they owe; in dusk both
 * skins clear it. In paper they do not — the accent is a skin value
 * (#F6A94C 1.96:1, #7CA7E6 2.46:1 on white), not something this sheet can
 * change — so paper's figure is pinned below as a known shortfall rather than
 * hidden, and records/L5.md hands it to the owner. A paper caller that needs
 * the selection to read must say it in words too (aria-current, a label).
 *
 * Named *Palette.test.js, never *token* (.gitignore:35).
 */
const fs = require('fs');
const path = require('path');
const H = require('../testing/skinHarness');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const CSS = read('components', 'ui', 'Card.css');
const stripped = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

function rule(selector) {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = stripped(CSS).match(new RegExp(`(^|\\n)${esc}\\s*\\{([^}]*)\\}`));
  if (!m) throw new Error(`no rule ${selector}`);
  return m[2];
}

/** The colour inside a box-shadow value, or null for `none`. */
const shadowColour = (v) => (v.trim() === 'none' ? null : v.match(/(#[0-9a-f]{3,8}|rgba?\([^)]*\))\s*$/i)[1]);

test('both skins and both themes are checked', () => {
  expect(new Set(H.CASES.map(([s]) => s))).toEqual(new Set(['classic', 'present']));
  expect(new Set(H.CASES.map(([, t]) => t))).toEqual(new Set(['dark', 'light']));
});

describe.each(H.CASES)('%s skin, %s', (skin, theme) => {
  const R = (name) => H.role(name, { skin, theme });
  const CARD = () => [R('--bg'), R('--surface')];

  test.each(['--text', '--muted', '--accent-text'])('%s on the card clears AA', (fg) => {
    expect(H.on(R(fg), CARD())).toBeGreaterThanOrEqual(H.AA);
  });

  test('the badge in the head: --on-accent on --accent clears AA', () => {
    expect(H.ratio(R('--on-accent'), R('--accent'))).toBeGreaterThanOrEqual(H.AA);
  });

  test('the select mark is the skin\'s: none in Classic, the accent at the left in Present', () => {
    const mark = R('--select-mark');
    if (skin === 'classic') expect(mark).toBe('none');
    else {
      expect(mark).toMatch(/^inset 3px 0 0 /);
      expect(H.parseColor(shadowColour(mark)).rgb).toEqual(H.parseColor(R('--accent')).rgb);
    }
  });

  if (theme === 'dark') {
    test('dusk: the selected border (and the mark) clear 3:1 against the card', () => {
      expect(H.on(R('--accent'), CARD())).toBeGreaterThanOrEqual(3);
    });
  } else {
    test('paper: the selected border is under 3:1 (a skin value; recorded in L5.md)', () => {
      expect(H.on(R('--accent'), CARD())).toBeLessThan(3);
    });
  }
});

describe('the rules paint what the palette proves', () => {
  test('the card: --surface ground, --text ink, --rule border, --radius-lg', () => {
    const r = rule('.ui-card');
    expect(r).toMatch(/background:\s*var\(--surface\);/);
    expect(r).toMatch(/color:\s*var\(--text\);/);
    expect(r).toMatch(/border:\s*var\(--ui-card-border, var\(--hair, 1px\)\) solid var\(--rule\);/);
    expect(r).toMatch(/border-radius:\s*var\(--radius-lg\);/);
  });

  test('selected: --accent border and --select-mark', () => {
    const r = rule('.ui-card.is-selected');
    expect(r).toMatch(/border-color:\s*var\(--accent\);/);
    expect(r).toMatch(/box-shadow:\s*var\(--select-mark\);/);
  });

  test('--select-mark is read in exactly one rule, .ui-card.is-selected', () => {
    const blocks = stripped(CSS).split('}').filter((b) => b.includes('--select-mark'));
    expect(blocks).toHaveLength(1);
    expect(blocks[0].split('{')[0].trim()).toBe('.ui-card.is-selected');
    expect(rule('.ui-card')).not.toMatch(/box-shadow/);
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
    expect(used.length).toBeGreaterThan(0);
    for (const [skin, theme] of H.CASES) {
      for (const n of used) expect(() => H.role(n, { skin, theme })).not.toThrow();
    }
  });

  test('every selector is in the .ui-card scope, and styles.css declares none of it', () => {
    const heads = stripped(CSS).split('}').map((b) => b.split('{')[0].trim()).filter(Boolean);
    for (const h of heads) for (const sel of h.split(',')) expect(sel.trim()).toMatch(/^\.ui-card($|[\s.])/);
    expect(stripped(read('styles.css'))).not.toMatch(/\.ui-card/);
  });
});
