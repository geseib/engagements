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
test('the laptop ladder only: no size below 12px, none above 24px', () => {
  for (const m of css.matchAll(/font-size:\s*(\d+)px/g)) {
    const n = Number(m[1]);
    expect(n >= 12 && n <= 24).toBe(true);
  }
  expect(css).not.toMatch(/var\(--(L|t)-/);
});
test('the main area scrolls; the footer is outside it (Review Focus 5)', () => {
  expect(css).toMatch(/\.hc-main\s*\{[^}]*overflow:\s*auto/);
  expect(css).toMatch(/grid-template-areas:\s*"top top"\s*"loop loop"\s*"rail main"\s*"foot foot"/);
});
test('no colour literal', () => {
  expect(css.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(\s*\d/);
});
