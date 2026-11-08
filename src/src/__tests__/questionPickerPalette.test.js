/**
 * THE QUESTION PICKER'S CSS CONTRACT (docs/design/question-picker, reviews
 * A6), in the questionSetsPalette.test.js pattern: the stylesheets are read
 * as text and the paint stack is composited by arithmetic, because jsdom
 * loads no stylesheet and resolves no custom property.
 *
 * Named "Palette", never "Token": `.gitignore` carries an unanchored
 * `*token*`, so a file named for tokens is invisible to git.
 *
 * The values come from the classic skin's dusk block (styles/skins/
 * classic.css) and the scope's own tints (QuestionPicker.css, PickLine.css):
 * change a token or a tint and these numbers move.
 */
const fs = require('fs');
const path = require('path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const QPK = strip(read('components', 'stage', 'QuestionPicker.css'));
const PKL = strip(read('components', 'stage', 'PickLine.css'));
const SKIN = read('styles', 'skins', 'classic.css');
const ROLES = read('styles', 'roles.css');
const GLOBAL = read('styles.css');

/* ---- colour arithmetic, as in questionSetsPalette.test.js ---- */
function lin(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }
function lum(c) { return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]); }
function ratio(a, b) { const x = lum(a); const y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
function over(fg, bg, a) { return fg.map((c, i) => c * a + bg[i] * (1 - a)); }
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.substr(i, 2), 16));
const sk = (name) => {
  const m = SKIN.match(new RegExp(`--sk-${name}:\\s*(#[0-9A-Fa-f]{6}|[\\d ]+);`));
  if (!m) throw new Error(`--sk-${name} not found`);
  return m[1].startsWith('#') ? hex(m[1]) : m[1].trim().split(/\s+/).map(Number);
};
const alphaOf = (css, prop) => {
  const m = css.match(new RegExp(`${prop}:\\s*rgb\\(var\\(--[a-z-]+\\)\\s*/\\s*([.\\d]+)\\)`));
  if (!m) throw new Error(`${prop} not found`);
  return Number(m[1]);
};

const BG = sk('dark-bg');
const SURFACE = sk('dark-surface');
const TEXT = sk('dark-text');
const MUTED = sk('dark-muted');
const INFO = sk('info-rgb');
const WARN = sk('warn-rgb');
const SUCCESS = sk('success-rgb');

const SEL = over(INFO, SURFACE, alphaOf(QPK, '--qpk-sel'));
const AMBER = over(WARN, SURFACE, alphaOf(QPK, '--qpk-amber'));
const NOTICE = over(SUCCESS, SURFACE, alphaOf(PKL, '--pkl-wash'));

describe('every pairing clears AA (4.5:1), composited up to --bg', () => {
  test.each([
    ['--text on --surface', TEXT, SURFACE],
    ['--muted on --surface', MUTED, SURFACE],
    ['--info links on --surface', INFO, SURFACE],
    ['--text on the selected row', TEXT, SEL],
    ['--muted on the selected row (the tightest)', MUTED, SEL],
    ['--text on the one-screen amber line', TEXT, AMBER],
    ['--text on the Next: notice', TEXT, NOTICE],
    ['--info Undo on the Next: notice', INFO, NOTICE],
    ['--muted on --bg (the search field)', MUTED, BG],
  ])('%s', (_, fg, bg) => {
    expect(ratio(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });

  test('the selected wash is no stronger than .14 (review A6: the muted line has little margin)', () => {
    expect(alphaOf(QPK, '--qpk-sel')).toBeLessThanOrEqual(0.14);
  });
});

describe('the stylesheets keep the house rules', () => {
  test.each([['QuestionPicker.css', QPK, '.qpk'], ['PickLine.css', PKL, '.pkl']])('%s: every selector is rooted at its scope', (_, css, scope) => {
    const preludes = css.split('}').map((chunk) => chunk.split('{')[0].trim()).filter((p) => p && !p.startsWith('@'));
    for (const prelude of preludes) {
      for (const sel of prelude.split(',')) {
        expect([sel.trim(), sel.trim().startsWith(scope)]).toEqual([sel.trim(), true]);
      }
    }
  });

  test('styles.css declares nothing in either scope', () => {
    expect(GLOBAL).not.toMatch(/\.qpk\b/);
    expect(GLOBAL).not.toMatch(/\.pkl\b/);
  });

  test.each([['QuestionPicker.css', QPK], ['PickLine.css', PKL]])('%s: colour is tokens only, and --danger never carries text', (_, css) => {
    expect(css).not.toMatch(/#[0-9A-Fa-f]{3,8}\b/);
    expect(css).not.toMatch(/color:\s*var\(--danger\)/);
  });

  test.each([['QuestionPicker.css', QPK], ['PickLine.css', PKL]])('%s: every var() it reads is declared', (_, css) => {
    const declared = new Set([...`${ROLES}\n${GLOBAL}\n${css}`.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
    const used = [...css.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]);
    for (const name of used) expect([name, declared.has(name)]).toEqual([name, true]);
  });

  test.each([['QuestionPicker.css', QPK], ['PickLine.css', PKL]])('%s: nothing below the 12px floor', (_, css) => {
    const sizes = [...css.matchAll(/(?:font-size|--qpk-t-[a-z]+):\s*(\d+)px/g)].map((m) => Number(m[1]));
    expect(sizes.length).toBeGreaterThan(0);
    for (const n of sizes) expect(n).toBeGreaterThanOrEqual(12);
  });

  test('the ladder is 12 / 13 / 15 / 19 and a row is 48px', () => {
    expect(QPK).toMatch(/--qpk-t-floor:\s*12px/);
    expect(QPK).toMatch(/--qpk-t-label:\s*13px/);
    expect(QPK).toMatch(/--qpk-t-body:\s*15px/);
    expect(QPK).toMatch(/--qpk-t-head:\s*19px/);
    expect(QPK).toMatch(/--qpk-row:\s*48px/);
  });

  test('the picker declares its own theme on its root', () => {
    const jsx = read('components', 'stage', 'QuestionPicker.jsx');
    expect(jsx).toMatch(/className="qpk"\s+data-theme="dark"/);
  });

  test('the row\'s action group is pushed with margin-left: auto, never flex-end (hard rule 9)', () => {
    const acts = QPK.match(/\.qpk \.qpk-acts \{[^}]*\}/)[0];
    expect(acts).toMatch(/margin-left:\s*auto/);
    expect(acts).not.toMatch(/justify-content:\s*flex-end/);
  });
});
