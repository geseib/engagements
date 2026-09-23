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

/** The token block a selector declares, as { name: value }. */
function block(selectorStart) {
  const i = stripped.indexOf(selectorStart);
  if (i < 0) throw new Error(`${selectorStart} not found`);
  const body = stripped.slice(stripped.indexOf('{', i) + 1, stripped.indexOf('}', i));
  const out = {};
  for (const m of body.matchAll(/(--plim-[a-z-]+):\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}
const rgba = (v) => {
  const m = /rgba\((\d+),\s*(\d+),\s*(\d+),\s*(\.\d+|\d(?:\.\d+)?)\)/.exec(v);
  if (!m) throw new Error(`not an rgba: ${v}`);
  return { rgb: [+m[1], +m[2], +m[3]], a: +m[4] };
};

const DUSK = block('.plim {');
const PAPER = { ...DUSK, ...block('.plim--paper,') };
const SURFACES = [
  ['dusk', DUSK, ['#0F1A2E', '#1B2942', '#25375A']],
  ['paper', PAPER, ['#FFFFFF', '#FBF7F1', '#F1EDE4']],
];

describe('contrast, composited through the notice\'s own tint', () => {
  for (const [name, t, grounds] of SURFACES) {
    test(`${name}: text, muted copy and link ink clear AA on every ground it lands on`, () => {
      const tint = rgba(t['--plim-tint']);
      for (const g of grounds) {
        const painted = over(tint.rgb, tint.a, hex(g));
        // rejects: a muted that passes on a flat card and fails under the tint
        expect(ratio(hex(t['--plim-text']), painted)).toBeGreaterThanOrEqual(4.5);
        expect(ratio(hex(t['--plim-muted']), painted)).toBeGreaterThanOrEqual(4.5);
        // rejects: --primary amber carrying link text on paper (1.96:1 on white)
        expect(ratio(hex(t['--plim-ink']), painted)).toBeGreaterThanOrEqual(4.5);
      }
    });
  }

  test('the filled button carries navy on amber', () => {
    expect(ratio(hex(DUSK['--plim-on-accent']), hex(DUSK['--plim-accent']))).toBeGreaterThanOrEqual(4.5);
  });

  // rejects: a refusal drawn in the fault colour — a plan limit is "not yet", not an error
  test('amber, never the danger colour', () => {
    expect(stripped).not.toMatch(/--danger/);
    expect(DUSK['--plim-accent'].toUpperCase()).toBe('#F6A94C');
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

  test('every var() it reads is declared in its own blocks', () => {
    const used = new Set([...stripped.matchAll(/var\((--[a-z-]+)\)/g)].map((m) => m[1]));
    used.forEach((name) => expect(DUSK[name]).toBeDefined());
  });
});
