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
