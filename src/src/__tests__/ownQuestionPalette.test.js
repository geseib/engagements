/**
 * THE "YOURS" MARK, MEASURED — components/YoursMark.css (impromptu ask README
 * §7, reviews A-1).
 *
 * jsdom resolves no custom property, so the stylesheet is read as text and the
 * paint stack composited by hand: the mark's 16% violet wash over each surface
 * a running order is drawn on, the violet ink on the result. README §7 states
 * the targets (6.19:1 on --surface, 5.13:1 on --surface-2, 7.44:1 on --bg;
 * 6.41:1 on paper); every one must clear AA's 4.5:1.
 *
 * Also: the colours live only in the scope's token block, the ink is never
 * colour alone (the word is in the component), nothing is under 12px.
 */
const fs = require('fs');
const path = require('path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const CSS = read('components', 'YoursMark.css');
const BARE = CSS.replace(/\/\*[\s\S]*?\*\//g, '');

function hex(s) { const h = s.replace('#', ''); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); }
function lin(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }
function lum(c) { return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]); }
function ratio(a, b) { const x = lum(a); const y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
function over(fg, bg, a) { return fg.map((c, i) => c * a + bg[i] * (1 - a)); }

/** The value a token is declared with inside a block whose selector matches. */
function token(selectorRe, name) {
  for (const m of BARE.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    if (!selectorRe.test(m[1].trim())) continue;
    const d = m[2].match(new RegExp(`${name}\\s*:\\s*([^;]+);`));
    if (d) return d[1].trim();
  }
  return null;
}

const DUSK = { surface: '#1B2942', surface2: '#25375A', bg: '#0F1A2E' };

describe('dusk: the violet ink on its wash, over every surface', () => {
  const ink = hex(token(/^\.yours-mark$/, '--yours-ink'));
  const wash = token(/^\.yours-mark$/, '--yours-wash');
  const [r, g, b, a] = wash.match(/[\d.]+/g).map(Number);

  test('the wash is the mockup\'s violet #A78BFA at 16%', () => {
    expect([r, g, b]).toEqual(hex('#A78BFA'));
    expect(a).toBeCloseTo(0.16, 5);
  });

  test.each([
    ['--surface', DUSK.surface, 6.19],
    ['--surface-2', DUSK.surface2, 5.13],
    ['--bg', DUSK.bg, 7.44],
  ])('over %s it measures as README §7 says, and clears 4.5:1', (_, surface, expected) => {
    const ground = over([r, g, b], hex(surface), a);
    const got = ratio(ink, ground);
    expect(got).toBeGreaterThanOrEqual(4.5);
    expect(got).toBeCloseTo(expected, 1);
  });
});

describe('paper: the deep violet on its pale wash', () => {
  test('6.41:1, clear of AA', () => {
    const ink = hex(token(/data-theme="light"\]\s*\.yours-mark/, '--yours-ink'));
    const wash = hex(token(/data-theme="light"\]\s*\.yours-mark/, '--yours-wash'));
    const got = ratio(ink, wash);
    expect(got).toBeGreaterThanOrEqual(4.5);
    expect(got).toBeCloseTo(6.41, 1);
  });
});

describe('the stylesheet\'s contract', () => {
  test('colours appear only as the scope\'s own tokens', () => {
    for (const m of BARE.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      for (const decl of m[2].split(';')) {
        if (!/#[0-9a-f]{3,8}\b|rgba?\(/i.test(decl)) continue;
        expect(decl.trim()).toMatch(/^--yours-/);
      }
    }
  });

  test('every selector is in the .yours-mark scope, and nothing is under 12px', () => {
    for (const m of BARE.matchAll(/([^{}]+)\{/g)) expect(m[1]).toMatch(/\.yours-mark/);
    for (const m of BARE.matchAll(/font-size:\s*(\d+)px/g)) expect(Number(m[1])).toBeGreaterThanOrEqual(12);
  });

  test('the mark carries a word and a pen, never colour alone', () => {
    const jsx = read('components', 'YoursMark.jsx');
    expect(jsx).toMatch(/\{OQ\.yours\}/);
    expect(jsx).toMatch(/PencilSimple/);
  });
});
