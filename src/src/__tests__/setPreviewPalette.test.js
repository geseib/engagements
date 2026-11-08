/**
 * THE SET PREVIEW'S PALETTE — components/SetPreview.css read as text and its
 * --setpv-* locals resolved on the roles, in every skin, on dusk (the panel
 * declares theme="dark" on its overlay). Named *Palette*, never *Token*.
 */
const fs = require('fs');
const path = require('path');
const H = require('../testing/skinHarness');

const CSS = fs.readFileSync(path.join(__dirname, '..', 'components', 'SetPreview.css'), 'utf8');
const v = (name, skin) => H.scopeVar(CSS, '.setpv {', name, { skin, theme: 'dark' });

describe.each(H.SKINS)('%s, dusk', (skin) => {
  const card = () => H.composite([v('--setpv-card', skin)]);
  const field = () => H.composite([v('--setpv-card', skin), v('--setpv-field', skin)]);
  const right = () => H.composite([v('--setpv-card', skin), v('--setpv-right-wash', skin)]);

  test.each([
    ['text on the card', '--setpv-text', card],
    ['muted on the card', '--setpv-muted', card],
    ['text on a field (the refusal, the error)', '--setpv-text', field],
    ['text on the correct option', '--setpv-text', right],
    ['the Correct mark on the correct option', '--setpv-right', right],
  ])('%s clears AA', (_, fg, bg) => {
    expect(H.ratio(v(fg, skin), bg())).toBeGreaterThanOrEqual(H.AA);
  });
});

test('no colour literal in the sheet, and nothing below the 12px floor', () => {
  const body = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  expect(body).not.toMatch(/#[0-9A-Fa-f]{3,8}\b/);
  expect(body).not.toMatch(/rgba?\(\s*\d/);
  expect(body).not.toMatch(/color:\s*var\(--danger\)/);
  for (const m of body.matchAll(/font-size:\s*(\d+)px/g)) expect(Number(m[1])).toBeGreaterThanOrEqual(12);
});

test('every selector is rooted at the .setpv scope', () => {
  const body = CSS.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@media[^{]*\{/g, '');
  for (const m of body.matchAll(/(^|\})\s*([^{}@]+)\{/g)) {
    for (const sel of m[2].split(',')) expect(sel.trim()).toMatch(/^\.setpv\b/);
  }
});

test('the panel declares dusk and sits in the create dialog\'s sibling layer, not inside the card', () => {
  const jsx = fs.readFileSync(path.join(__dirname, '..', 'components', 'SetPreview.jsx'), 'utf8');
  expect(jsx).toMatch(/theme="dark"/);
  const host = fs.readFileSync(path.join(__dirname, '..', 'components', 'GameSetupDialog.jsx'), 'utf8');
  expect(host).toMatch(/afterContent=\{[\s\S]*?<SetPreview/);
});
