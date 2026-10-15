// src/src/__tests__/hostConsolePalette.test.js
import fs from 'fs';
import path from 'path';
const css = fs.readFileSync(path.join(__dirname, '..', 'components', 'console', 'HostConsole.css'), 'utf8');

// The root is .hc itself; every other class is .hc-*. \b accepts both, never .hcx.
test('every selector is scoped hc-', () => {
  const selectors = css.replace(/\/\*[\s\S]*?\*\//g, '').match(/(^|})\s*([^{@}]+)\{/g) || [];
  for (const s of selectors) {
    const sel = s.replace(/^}?\s*/, '').replace(/\{$/, '').trim();
    for (const part of sel.split(',')) expect([part.trim(), /\.hc\b/.test(part)]).toEqual([part.trim(), true]);
  }
});
test('the laptop ladder only: 12 / 13 / 15 / 19 / 24px', () => {
  const ladder = [12, 13, 15, 19, 24];
  for (const m of css.matchAll(/font-size:\s*(\d+)px/g)) expect(ladder).toContain(Number(m[1]));
  expect(css).not.toMatch(/font-size:\s*[\d.]+(rem|em)/);
  expect(css).not.toMatch(/var\(--(L|t)-/);
});
test('the main area scrolls; the footer is outside it (Review Focus 5)', () => {
  expect(css).toMatch(/\.hc-main\s*\{[^}]*overflow:\s*auto/);
  expect(css).toMatch(/grid-template-areas:\s*"top top"\s*"loop loop"\s*"rail main"\s*"foot foot"/);
});
test('no colour literal', () => {
  expect(css.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(\s*\d/);
});
test('the reused action bar is pinned to the ladder inside the console', () => {
  for (const cls of ['__hint', '__armed', '__primary', '__secondary', '__tertiary', '__kbd', '__keyhint']) {
    expect(css).toMatch(new RegExp(`\\.hc-acts \\.host-action-bar${cls}[^{]*\\{[^}]*font-size:\\s*\\d+px`));
  }
});
test('keyboard focus is visible on the console\'s own controls', () => {
  for (const sel of ['.hc-sec summary', '.hc-link', '.hc-code', '.hc-btn', '.hc-winstat']) {
    expect(css).toMatch(new RegExp(`${sel.replace(/\./g, '\\.')}:focus-visible`));
  }
});
