/**
 * THE SESSION OPTIONS' COLOURS — the rules components/SessionOptions.jsx adds
 * to components/GameSetupDialog.css (events M1b), composited the way
 * gameSetupPalette.test.js composites the rest of that sheet (which is not
 * edited).
 *
 * Named *Palette*, never *Token* — .gitignore's unanchored `*token*` would hide
 * it from git.
 *
 * rejects: a goal the set cannot meet said in a colour that fails AA on the
 * card; the goal's rules leaving the `.gsd` scope; a raw colour in them.
 */
const fs = require('fs');
const path = require('path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const CSS = read('components', 'GameSetupDialog.css');
const GLOBAL = read('styles.css');

function lin(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function lum(c) { return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]); }
function ratio(a, b) {
  const la = lum(a); const lb = lum(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
const parseHex = (h) => [1, 3, 5].map((i) => parseInt(h.substr(i, 2), 16));
function tokenIn(css, block, name) {
  const start = css.indexOf(block);
  const body = css.slice(start, css.indexOf('}', start));
  const m = body.match(new RegExp(`${name}\\s*:\\s*(#[0-9A-Fa-f]{6})`));
  if (!m) throw new Error(`${name} is not declared in ${block}`);
  return parseHex(m[1]);
}
const AA = 4.5;
const card = () => tokenIn(CSS, '.gsd {', '--gsd-card');

describe('the goal', () => {
  test('a goal the set cannot meet is said in --danger-text, at AA on the card', () => {
    expect(CSS).toMatch(/\.gsd \.dialog-help-text\.gsd-goal-problem\s*\{[^}]*color:\s*var\(--danger-text\)/);
    expect(ratio(tokenIn(GLOBAL, ':root {', '--danger-text'), card())).toBeGreaterThanOrEqual(AA);
  });

  test('the unit beside the number is muted copy, at AA on the card', () => {
    expect(CSS).toMatch(/\.gsd \.gsd-goal-unit\s*\{[^}]*color:\s*var\(--gsd-muted\)/);
    expect(ratio(tokenIn(CSS, '.gsd {', '--gsd-muted'), card())).toBeGreaterThanOrEqual(AA);
  });

  test('its rules are scoped, sized from the ladder, and carry no raw colour', () => {
    const rules = [...CSS.matchAll(/^(\.gsd[^{]*gsd-goal[^{]*)\{([^}]*)\}/gm)];
    expect(rules.length).toBe(4);
    for (const [, , body] of rules) {
      expect(body).not.toMatch(/#[0-9A-Fa-f]{3,8}\b|rgba?\(/);
      expect(body).not.toMatch(/font-size:\s*\d/);
    }
  });
});

/*
  THE ITEM DIALOG WEARS THE SAME GROUND (events M1b, Task 11). The shared
  options are styled by this sheet's `.gsd` tokens wherever they are drawn; in
  the event item dialog they sit on EventBuilder.css's modal, whose surface is
  the dusk `--surface`. Every pairing gameSetupPalette.test.js measures on
  --gsd-card and --gsd-field therefore holds there only while those two ARE the
  dusk surface and surface-2 — so that is what this pins.
*/
describe('the options inside the event item dialog', () => {
  const dusk = (name) => {
    const block = GLOBAL.slice(GLOBAL.indexOf('[data-theme="dark"] {'));
    const m = block.slice(0, block.indexOf('}')).match(new RegExp(`${name}\\s*:\\s*(#[0-9A-Fa-f]{6})`));
    if (!m) throw new Error(`${name} is not declared for dusk`);
    return m[1].toUpperCase();
  };
  const gsd = (name) => {
    const body = CSS.slice(CSS.indexOf('.gsd {'), CSS.indexOf('}', CSS.indexOf('.gsd {')));
    return body.match(new RegExp(`${name}\\s*:\\s*(#[0-9A-Fa-f]{6})`))[1].toUpperCase();
  };

  test('the card and the field are the item dialog\'s own dusk surface and surface-2', () => {
    expect(gsd('--gsd-card')).toBe(dusk('--surface'));
    expect(gsd('--gsd-field')).toBe(dusk('--surface-2'));
  });

  test('the item dialog places the block with no colour of its own', () => {
    const EVB = read('components', 'EventBuilder.css').replace(/\/\*[\s\S]*?\*\//g, '');
    const rule = EVB.match(/\.evb-sopts\s*\{([^}]*)\}/);
    expect(rule).not.toBeNull();
    expect(rule[1]).not.toMatch(/color|background|#|rgba/);
  });
});
