/**
 * THE CREATE/EDIT DIALOG'S DUSK PALETTE — components/GameSetupDialog.css read
 * as text and composited, the questionSetsPalette technique.
 *
 * Named *Palette*, never *Token* — .gitignore's unanchored `*token*` makes a
 * file named for tokens invisible to git (skill §5): it passes locally and
 * never reaches CI.
 *
 * The conversion this pins: the dialog was HALF-redesigned — new furniture
 * (pills, option cards, preview) retinted onto the original white 500px card
 * with 2px-#e1e1e1 inputs, which is what the owner read as "a bit dated". The
 * whole scope is dusk now and lives in ONE file, because a scope split across
 * two files is exactly how half of it stayed paper for a year.
 */
const fs = require('fs');
const path = require('path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const CSS = read('components', 'GameSetupDialog.css');
const GLOBAL = read('styles.css');
const JSX = read('components', 'GameSetupDialog.jsx');

/* ---- colour math: lifted verbatim from hostQuestionSetsPalette.test.js ---- */
function lin(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function lum(c) { return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]); }
function ratio(a, b) {
  const la = lum(a); const lb = lum(b);
  const h = Math.max(la, lb); const l = Math.min(la, lb);
  return (h + 0.05) / (l + 0.05);
}
function alphaOver(fg, bg, a) { return fg.map((c, i) => c * a + bg[i] * (1 - a)); }
const parseHex = (h) => [1, 3, 5].map((i) => parseInt(h.substr(i, 2), 16));

const SCOPE = (() => {
  const start = CSS.indexOf('.gsd {');
  return CSS.slice(start, CSS.indexOf('}', start));
})();

function token(name) {
  const m = SCOPE.match(new RegExp(`${name}\\s*:\\s*(#[0-9A-Fa-f]{6})`));
  if (!m) throw new Error(`${name} is not declared on the scope`);
  return parseHex(m[1]);
}

const AA = 4.5;
const card = () => token('--gsd-card');
const field = () => token('--gsd-field');
const text = () => token('--gsd-text');
const muted = () => token('--gsd-muted');

describe('every pairing is measured, composited from the real paint stack', () => {
  test('body copy clears AA on the card', () => {
    expect(ratio(text(), card())).toBeGreaterThanOrEqual(AA);
  });

  test('muted copy clears AA on the card AND on the field surface', () => {
    // Labels sit on the card; help text sits under inputs; option-card copy
    // sits on --gsd-field. Muted must survive both grounds or a caption is
    // legible in one place and not another.
    expect(ratio(muted(), card())).toBeGreaterThanOrEqual(AA);
    expect(ratio(muted(), field())).toBeGreaterThanOrEqual(AA);
  });

  test('input text clears AA on the field surface', () => {
    expect(ratio(text(), field())).toBeGreaterThanOrEqual(AA);
  });

  test('the active pill: primary text on its own tint, composited', () => {
    // A tint is invisible in a token table (skill §5) — composite the 12%
    // amber wash over the card before measuring the amber text on it.
    const tinted = alphaOver(token('--gsd-primary'), card(), 0.12);
    expect(ratio(token('--gsd-primary'), tinted)).toBeGreaterThanOrEqual(AA);
  });

  test('the selected category chip: body text on the same tint', () => {
    const tinted = alphaOver(token('--gsd-primary'), card(), 0.12);
    expect(ratio(text(), tinted)).toBeGreaterThanOrEqual(AA);
  });

  test('the is-on option card: success-text on the green tint over the FIELD', () => {
    // The option card's ground is --gsd-field, not the card — compositing over
    // the wrong ancestor is how dark-on-dark passes an audit (hard rule 4).
    const tinted = alphaOver(token('--gsd-success'), field(), 0.10);
    expect(ratio(token('--gsd-success-text'), tinted)).toBeGreaterThanOrEqual(AA);
    expect(ratio(text(), tinted)).toBeGreaterThanOrEqual(AA);
    expect(ratio(muted(), tinted)).toBeGreaterThanOrEqual(AA);
  });

  test('the filled primary button carries DARK text, never white', () => {
    // #F6A94C under white is 1.9:1 in either theme. The dark navy clears 7:1.
    const m = CSS.match(/\.gsd \.btn-primary \{[^}]*color:\s*(#[0-9A-Fa-f]{6})/);
    expect(m).not.toBeNull();
    expect(ratio(parseHex(m[1]), token('--gsd-primary'))).toBeGreaterThanOrEqual(AA);
  });
});

describe('the scope is whole, and it is the only scope', () => {
  test('styles.css declares nothing in .gsd — both halves of the rule', () => {
    // The failure mode this file exists to end: half the dialog styled in one
    // file, half in another, and the halves aging at different rates.
    const declarations = GLOBAL.match(/^\s*\.gsd[^{]*\{/gm) || [];
    expect(declarations).toEqual([]);
  });

  test('every selector in the sheet is rooted at the scope', () => {
    const selectors = [...CSS.matchAll(/^\s*(\.[^{}\n]+?)\s*\{/gm)]
      .map((m) => m[1].trim())
      .filter((sel) => !sel.startsWith('@'));
    for (const sel of selectors) {
      expect(sel.startsWith('.gsd')).toBe(true);
    }
  });

  test('no raw hex outside the token block', () => {
    // One deliberate exception: the filled button's dark text, which is a
    // colour ABOUT the amber fill, not about the theme — documented inline.
    // Comments are stripped first: the header quotes the old #e1e1e1 inputs
    // it is retiring, and prose is not paint.
    const body = CSS.slice(CSS.indexOf('}', CSS.indexOf('.gsd {')) + 1)
      .replace(/\/\*[\s\S]*?\*\//g, '');
    const hexes = body.match(/#[0-9A-Fa-f]{6}\b/g) || [];
    expect(hexes).toEqual(['#1B2942']);
  });

  test('every var() the sheet uses is declared on the scope', () => {
    const used = new Set([...CSS.matchAll(/var\((--gsd-[a-z-]+)/g)].map((m) => m[1]));
    for (const name of used) {
      expect(SCOPE.includes(`${name}:`)).toBe(true);
    }
  });

  test('the component actually imports the sheet', () => {
    // A stylesheet nobody imports styles nothing, and the dialog would render
    // as the bare white card the whole change exists to retire.
    expect(JSX).toMatch(/import '\.\/GameSetupDialog\.css'/);
  });
});

describe('the ladder', () => {
  test('the scope declares the laptop ladder, and fields render at body', () => {
    expect(SCOPE).toMatch(/--gsd-t-floor:\s*12px/);
    expect(SCOPE).toMatch(/--gsd-t-body:\s*15px/);
    // Inputs at body, never label — the RATIONALE §3.2 failure is a 13px input
    // producing 15px table text where a mistake is most expensive.
    const fieldRule = CSS.match(/\.gsd \.dialog-input,[^{]*\{[^}]*/s);
    expect(fieldRule[0]).toMatch(/font-size:\s*var\(--gsd-t-body\)/);
  });

  test('nothing below the floor except the two documented glance-only echoes', () => {
    /*
      The floor protects copy read in runs. Two survivors sit under it, both
      inherited from the shipped paper design with the same dispensation:
      .gsd-opt-state (ON/OFF beside an 18px checkbox that already carries the
      fact) and the preview card captions/attribution (.gsd-pv h6, .gsd-pv-who).
      Anything else under 12px is a regression.
    */
    const sizes = [...CSS.matchAll(/font-size:\s*([\d.]+)px/g)].map((m) => Number(m[1]));
    const below = sizes.filter((px) => px < 12);
    expect(below.sort((a, b) => a - b)).toEqual([10.5, 11, 11]);
  });
});
