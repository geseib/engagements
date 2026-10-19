/**
 * THE BUILD ROOM CONSOLE'S STYLESHEET (parity PLAN B8; engage-design §5).
 * jsdom loads no stylesheet, so the contract is read as text: every selector
 * under the console's own scope, the laptop ladder only, no colour literal,
 * every token it uses declared by the app, and nothing in it below the floor.
 * NO GEOMETRIC ASSERTIONS.
 */
const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(path.join(__dirname, '../buildroom/BuildConsole.css'), 'utf8');
const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
const declared = ['../styles.css', '../styles/roles.css', '../components/console/HostConsole.css', '../buildroom/BuildRoom.css']
  .map((f) => path.join(__dirname, f)).filter((f) => fs.existsSync(f)).map((f) => fs.readFileSync(f, 'utf8')).join('\n');

const selectors = () => {
  const out = [];
  const flat = bare.replace(/@media[^{]*\{([\s\S]*?\})\s*\}/g, '$1');
  for (const m of flat.matchAll(/([^{}]+)\{[^}]*\}/g)) out.push(...m[1].split(',').map((x) => x.trim()).filter(Boolean));
  return out;
};

test('every selector is under the console\'s scope, .hc--build', () => {
  const sels = selectors();
  expect(sels.length).toBeGreaterThan(20);
  sels.forEach((sel) => expect([sel, sel.startsWith('.hc--build')]).toEqual([sel, true]));
});

test('the laptop ladder only: 12 / 13 / 15 / 19 / 24px, nothing below the floor', () => {
  const ladder = [12, 13, 15, 19, 24];
  for (const m of bare.matchAll(/font-size:\s*(\d+)px/g)) expect(ladder).toContain(Number(m[1]));
  expect(bare).not.toMatch(/font-size:\s*[\d.]+(rem|em)\b/);
});

test('no colour literal; never --danger on text', () => {
  expect(bare).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(\s*\d/);
  expect(bare).not.toMatch(/(^|[^-])color:\s*var\(--danger\)/);
});

test('every token it uses is declared by the app', () => {
  const used = [...new Set([...bare.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]))];
  const missing = used.filter((t) => !new RegExp(`${t}\\s*:`).test(declared));
  expect(missing).toEqual([]);
});

test('the top line holds one row: nothing in it wraps, the name gives way', () => {
  expect(bare).toMatch(/\.hc--build \.hc-top > \.hc-name \{[^}]*min-width:\s*0/);
  expect(bare).toMatch(/\.hc--build \.hc-top \.rws-line \{[^}]*flex-wrap:\s*nowrap/);
});
