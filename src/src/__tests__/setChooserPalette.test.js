/**
 * THE SET CHOOSER'S PALETTE — components/SetChooser.css read as text and its
 * --schs-* locals resolved on the roles, in every skin, on dusk (where both
 * callers show it: the New engagement card passes theme="dark"; the agenda
 * dialog sits in the dusk console). Named *Palette*, never *Token* (skill §5).
 */
const fs = require('fs');
const path = require('path');
const H = require('../testing/skinHarness');

const CSS = fs.readFileSync(path.join(__dirname, '..', 'components', 'SetChooser.css'), 'utf8');
const v = (name, skin) => H.scopeVar(CSS, '.schs {', name, { skin, theme: 'dark' });

describe.each(H.SKINS)('%s, dusk', (skin) => {
  const card = () => H.composite([v('--schs-card', skin)]);
  const field = () => H.composite([v('--schs-card', skin), v('--schs-field', skin)]);
  const sel = () => H.composite([v('--schs-card', skin), v('--schs-sel', skin)]);
  const grp = () => H.composite([v('--schs-card', skin), v('--schs-grp', skin)]);

  test.each([
    ['text on the card', '--schs-text', card],
    ['muted on the card', '--schs-muted', card],
    ['text on a field', '--schs-text', field],
    ['muted on a field (placeholders, counts)', '--schs-muted', field],
    ['text on the picked wash', '--schs-text', sel],
    ['the accent on the picked wash (owner chip, the chosen owner)', '--schs-primary', sel],
    ['the accent on the card', '--schs-primary', card],
    ['a link on the card', '--schs-link', card],
    ['muted on a group heading row', '--schs-muted', grp],
  ])('%s clears AA', (_, fg, bg) => {
    expect(H.ratio(v(fg, skin), bg())).toBeGreaterThanOrEqual(H.AA);
  });
});

test('no colour literal in the sheet, and nothing below the 12px floor', () => {
  const body = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  expect(body).not.toMatch(/#[0-9A-Fa-f]{3,8}\b/);
  expect(body).not.toMatch(/rgba?\(\s*\d/);
  for (const m of body.matchAll(/font-size:\s*(\d+)px/g)) expect(Number(m[1])).toBeGreaterThanOrEqual(12);
});

test('every selector is rooted at the .schs scope', () => {
  const body = CSS.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@media[^{]*\{/g, '');
  for (const m of body.matchAll(/(^|\})\s*([^{}@]+)\{/g)) {
    for (const sel of m[2].split(',')) expect(sel.trim()).toMatch(/^\.schs\b/);
  }
});

test('the New engagement dialog marks the chooser dusk (its card paints dusk under a paper page)', () => {
  const jsx = fs.readFileSync(path.join(__dirname, '..', 'components', 'GameSetupDialog.jsx'), 'utf8');
  expect(jsx).toMatch(/<SetChooser[\s\S]*?theme="dark"/);
});
