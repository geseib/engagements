/**
 * THE ROUND TIMER'S STYLESHEETS, AS TEXT (components/console/TimeChip.css,
 * components/RoomTimeLine.css, and the timer rules added to ConsolePulse.css;
 * experience plan 2f; engage-design §5). jsdom loads no stylesheet, so the
 * contract is read from the files and the contrast measured from the skins'
 * dusk values. NO GEOMETRIC ASSERTIONS.
 */
const fs = require('fs');
const path = require('path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const chip = strip(read('components', 'console', 'TimeChip.css'));
const line = strip(read('components', 'RoomTimeLine.css'));
const pulse = strip(read('components', 'console', 'ConsolePulse.css'));
const declared = [read('styles.css'), read('styles', 'roles.css'), chip, line].join('\n');
const selectorsOf = (css) => (css.replace(/@media[^{]+\{/g, '').match(/[^{}]+(?=\{)/g) || [])
  .flatMap((s) => s.split(',')).map((s) => s.trim()).filter(Boolean);

describe.each([
  ['TimeChip.css', chip, '.tchip'],
  ['RoomTimeLine.css', line, '.rtime'],
])('%s', (name, css, scope) => {
  test(`every selector is rooted at ${scope}, and styles.css declares nothing there`, () => {
    const sel = selectorsOf(css);
    expect(sel.length).toBeGreaterThan(3);
    sel.forEach((s) => expect([s, s.startsWith(scope)]).toEqual([s, true]));
    expect(read('styles.css')).not.toMatch(new RegExp(`\\${scope}\\b`));
  });
  test('roles only: no colour literal, no --primary, never text in --danger, never red', () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(\s*\d|:\s*(white|black)\b/);
    expect(css).not.toMatch(/var\(--primary/);
    expect(css).not.toMatch(/var\(--danger/);
  });
  test('every token it uses is declared', () => {
    const used = [...new Set([...css.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]))];
    expect(used.filter((t) => !new RegExp(`${t}\\s*:`).test(declared))).toEqual([]);
  });
});

test('the chip keeps the laptop ladder: 12 / 13 / 15, every size through it, nothing under 12px; rows 36px', () => {
  const scale = [...chip.matchAll(/--tchip-t-[a-z]+:\s*(\d+)px/g)].map((m) => Number(m[1]));
  expect(scale.sort((a, b) => a - b)).toEqual([12, 13, 15]);
  expect(chip).not.toMatch(/font-size:\s*\d+px/);
  expect(chip).toMatch(/\.tchip \.tchip-toggle \{[^}]*min-height:\s*36px/);
});

test('the time line takes the size of where it sits (the wall\'s ladder, the phone\'s), never its own', () => {
  expect(line).not.toMatch(/font-size:\s*[\d.]+(px|rem)/);
  expect(line).toMatch(/\.rtime \.rtime-bar i \{[^}]*background:\s*var\(--info\)/);
});

test('the Time tile: info blue while it runs, amber (--warn) only at time\'s up, never red', () => {
  const warnRules = [...pulse.matchAll(/([^{}]+)\{[^}]*var\(--warn/g)].map((m) => m[1].trim());
  expect(warnRules.length).toBeGreaterThan(0);
  warnRules.forEach((sel) => expect([sel, /\.is-up\b/.test(sel)]).toEqual([sel, true]));
  expect(pulse).toMatch(/\.cpulse \.cpulse-ring \.tring-fill \{[^}]*stroke:\s*var\(--info\)/);
});

/* MEASURED, from the skins' dusk values (classic.css and present.css). */
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
const lum = (rgb) => {
  const [r, g, b] = rgb.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [hi, lo] = [lum(hex(a)), lum(hex(b))].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
describe.each(['classic', 'present'])('%s dusk', (skin) => {
  const sk = read('styles', 'skins', `${skin}.css`);
  const v = (name) => (sk.match(new RegExp(`--sk-dark-${name}:\\s*(#[0-9A-Fa-f]{6})`)) || [])[1];
  const warn = (sk.match(/--sk-warn:\s*(#[0-9A-Fa-f]{6})/) || [])[1];
  test('the chip\'s popover text clears AA on --surface-2', () => {
    for (const ink of ['text', 'muted']) expect([ink, ratio(v(ink), v('surface-2')) >= 4.5]).toEqual([ink, true]);
  });
  test('"Time\'s up" in amber clears AA on the tile\'s --surface', () => {
    expect(warn).toBeTruthy();
    expect(ratio(warn, v('surface'))).toBeGreaterThanOrEqual(4.5);
  });
  test('the time line\'s words clear AA on --bg', () => {
    expect(ratio(v('text'), v('bg'))).toBeGreaterThanOrEqual(4.5);
  });
});
