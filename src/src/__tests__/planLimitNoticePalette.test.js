/**
 * components/PlanLimitNotice.css — the CSS contract: measured contrast on both
 * surfaces the notice lands on (composited through its own amber tint), the
 * 12px floor, the `.plim` namespace, and no hex outside the token blocks.
 * The stylesheet is read as text; jsdom resolves no custom property.
 */
const fs = require('fs');
const path = require('path');

const CSS = fs.readFileSync(path.join(__dirname, '..', 'components', 'PlanLimitNotice.css'), 'utf8');
const stripped = CSS.replace(/\/\*[\s\S]*?\*\//g, '');

function lin(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function lum([r, g, b]) { return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b); }
function ratio(a, b) { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); }
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const over = (fg, a, bg) => fg.map((c, i) => Math.round(c * a + bg[i] * (1 - a)));

const H = require('../testing/skinHarness');
const ROLES_CSS = fs.readFileSync(path.join(__dirname, '..', 'styles', 'roles.css'), 'utf8');

/** The --plim-* names a token block declares (the head as written in the CSS). */
function block(selectorStart) {
  const i = stripped.indexOf(selectorStart);
  if (i < 0) throw new Error(`${selectorStart} not found`);
  const body = stripped.slice(stripped.indexOf('{', i) + 1, stripped.indexOf('}', i));
  return new Set([...body.matchAll(/(--plim-[a-z-]+):\s*([^;]+);/g)].map((m) => m[1]));
}
const DUSK_HEAD = '.plim {';
const PAPER_HEAD = '.plim--paper,';
const DUSK_NAMES = block(DUSK_HEAD);
const PAPER_NAMES = block(PAPER_HEAD);

/* Since skins 0b-2 the dusk block points at roles (--plim-accent: var(--warn),
   --plim-tint: rgb(var(--warn-rgb) / .08)), so a value is resolved through the skin harness
   for one skin x theme, never grepped as a literal. The paper block re-declares only some
   names on the same element; the rest fall through to the dusk block, as they do in a
   browser. --plim-text / --plim-muted stay literal on purpose: the notice lands under
   data-theme="light" ancestors, where the --text role would be paper ink. */
function value(name, surface, opts) {
  const head = surface === 'paper' && PAPER_NAMES.has(name) ? PAPER_HEAD : DUSK_HEAD;
  return H.parseColor(H.scopeVar(CSS, head, name, opts));
}
const rgb = (name, surface, opts) => value(name, surface, opts).rgb;
const role = (name, opts) => H.parseColor(H.role(name, opts)).rgb;

/* Dusk is measured under a dusk ancestor; paper (`.plim--paper`, `.qsets--onlight .plim`)
   under a paper one, with the grounds it really lands on read as roles of that theme. */
const SURFACES = [
  ['dusk', 'dark', (o) => [role('--bg', o), role('--surface', o), role('--surface-2', o)]],
  ['paper', 'light', (o) => [role('--surface', o), role('--bg', o), role('--surface-2', o)]],
];
const SKINS = H.CASES.filter(([, t]) => t === 'dark').map(([skin]) => skin);

describe.each(SKINS)('contrast, composited through the notice\'s own tint: %s', (skin) => {
  for (const [name, theme, grounds] of SURFACES) {
    test(`${name}: text, muted copy and link ink clear AA on every ground it lands on`, () => {
      const O = { skin, theme };
      const tint = value('--plim-tint', name, O);
      for (const g of grounds(O)) {
        const painted = over(tint.rgb, tint.a, g);
        // rejects: a muted that passes on a flat card and fails under the tint
        expect(ratio(rgb('--plim-text', name, O), painted)).toBeGreaterThanOrEqual(4.5);
        expect(ratio(rgb('--plim-muted', name, O), painted)).toBeGreaterThanOrEqual(4.5);
        // rejects: --primary amber carrying link text on paper (1.96:1 on white)
        expect(ratio(rgb('--plim-ink', name, O), painted)).toBeGreaterThanOrEqual(4.5);
      }
    });
  }

  test('the filled button carries navy on amber', () => {
    const O = { skin, theme: 'dark' };
    expect(ratio(rgb('--plim-on-accent', 'dusk', O), rgb('--plim-accent', 'dusk', O))).toBeGreaterThanOrEqual(4.5);
  });

  // rejects: a refusal drawn in the fault colour — a plan limit is "not yet", not an error
  test('amber, never the danger colour', () => {
    expect(stripped).not.toMatch(/--danger/);
    expect(stripped).toMatch(/--plim-accent:\s*var\(--warn\)/);
    if (skin === 'classic') {
      const accent = value('--plim-accent', 'dusk', { skin, theme: 'dark' });
      expect({ rgb: accent.rgb, a: accent.a }).toEqual({ rgb: hex('#F6A94C'), a: 1 });
    }
  });
});

describe('the contract', () => {
  test('nothing below the 12px floor', () => {
    expect(CSS).toMatch(/--plim-t-floor:\s*12px/);
    const px = [...stripped.matchAll(/font-size:\s*(\d+)px/g)].map((m) => +m[1]);
    px.forEach((n) => expect(n).toBeGreaterThanOrEqual(12));
  });

  test('every selector is rooted at .plim (or the shelf card that re-tints it)', () => {
    const selectors = stripped.match(/^[^\s@}][^{]*(?=\{)/gm) || [];
    expect(selectors.length).toBeGreaterThan(5);
    selectors.forEach((sel) => sel.split(',').forEach((s) => {
      const one = s.trim();
      // rejects: a bare .btn/.chip leaking into styles.css's namespace
      expect(one).toMatch(/^(\.plim(\b|-)|\.qsets--onlight \.plim\b)/);
    }));
  });

  test('no hex literal outside the token blocks (the button hover aside)', () => {
    const outside = stripped
      .replace(/\.plim \{[^}]*\}/, '')
      .replace(/\.plim--paper,[^}]*\}/, '');
    const hexes = (outside.match(/#[0-9A-Fa-f]{3,8}\b/g) || []).filter((h) => h.toUpperCase() !== '#FFBB66');
    expect(hexes).toEqual([]);
  });

  test('styles.css declares nothing in the .plim scope', () => {
    const site = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
    expect(site).not.toMatch(/\.plim\b/);
  });

  // Its own blocks, or a role styles/roles.css declares (the 0b-2 re-point reads
  // --warn, --warn-rgb, --slate-rgb and --on-accent) — never a global token borrowed
  // from a sheet that merely happens to be in the bundle.
  test('every var() it reads is declared in its own blocks or is a role', () => {
    const roles = new Set([...ROLES_CSS.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
    const used = new Set([...stripped.matchAll(/var\((--[a-z-]+)\)/g)].map((m) => m[1]));
    expect(used.size).toBeGreaterThan(5);
    used.forEach((name) => expect({ name, declared: DUSK_NAMES.has(name) || roles.has(name) })
      .toEqual({ name, declared: true }));
  });
});
