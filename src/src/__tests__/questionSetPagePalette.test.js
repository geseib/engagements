/**
 * A QUESTION SET'S PAGE — components/QuestionSetPage.css, `.qsp` (experience
 * plan 5e). Named *Palette, never *Token* (`.gitignore`'s unanchored `*token*`).
 *
 * The page is dusk, declared on its own root (QuestionSetPage.jsx
 * `data-theme="dark"`), on --bg; its notice is a --surface card. Read as text
 * and measured through the skin harness for every skin's dusk theme.
 */
const fs = require('fs');
const path = require('path');
const H = require('../testing/skinHarness');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const CSS = read('components', 'QuestionSetPage.css');
const JSX = read('components', 'QuestionSetPage.jsx');
const GLOBAL_CSS = read('styles.css');
const ROLES_CSS = read('styles', 'roles.css');
const block = (selector) => {
  const at = stripComments(CSS).indexOf(`${selector} {`);
  if (at < 0) throw new Error(`no rule for ${selector}`);
  const css = stripComments(CSS);
  return css.slice(at, css.indexOf('}', at));
};

const DUSK_SKINS = [...new Set(H.CASES.filter(([, t]) => t === 'dark').map(([skin]) => skin))];

test('the page declares dusk on its own root', () => {
  expect(JSX).toMatch(/className="qsp" data-theme="dark"/);
  expect(block('.qsp')).toMatch(/background:\s*var\(--bg\)/);
  expect(block('.qsp-scrim')).toMatch(/background:\s*var\(--bg\)/);
});

test('roles only: no literal colour, every var declared, nothing under 12px', () => {
  const css = stripComments(CSS);
  expect(css).not.toMatch(/#[0-9A-Fa-f]{3,8}\b|rgba?\(\s*\d/);
  const declared = new Set();
  for (const sheet of [GLOBAL_CSS, ROLES_CSS, CSS]) for (const m of sheet.matchAll(/(--[a-z0-9-]+)\s*:/gi)) declared.add(m[1]);
  const used = [...css.matchAll(/var\((--[a-z0-9-]+)/gi)].map((m) => m[1]);
  expect([...new Set(used)].filter((n) => !declared.has(n))).toEqual([]);
  expect(block('.qsp')).toMatch(/--qsp-t-floor:\s*12px/);
  expect(block('.qsp')).toMatch(/--qsp-t-title:\s*24px/);
  expect([...css.matchAll(/font-size:\s*(\d+)px/g)].map((m) => Number(m[1])).filter((n) => n < 12)).toEqual([]);
  expect(css.split('\n').filter((l) => /(^|[^-])\bcolor\s*:\s*var\(--danger\)/.test(l))).toEqual([]);
});

test('every selector is rooted in the page\'s scope, and styles.css declares none of it', () => {
  const roots = new Set();
  for (const blk of stripComments(CSS).split('}')) {
    const head = blk.split('{')[0];
    if (!head.trim() || head.includes('@')) continue;
    for (const sel of head.split(',')) {
      const m = sel.trim().match(/^\.([\w-]+)/);
      roots.add(m ? m[1] : sel.trim());
    }
  }
  expect([...roots].filter((n) => !/^qsp(-|$)/.test(n))).toEqual([]);
  expect([...stripComments(GLOBAL_CSS).matchAll(/\.(qsp(?:-[\w-]*)?)\b/g)]).toHaveLength(0);
});

test('the title truncates as one text node and carries its full name', () => {
  expect(block('.qsp-title')).toMatch(/min-width:\s*0/);
  expect(block('.qsp-title')).toMatch(/text-overflow:\s*ellipsis/);
  expect(JSX).toMatch(/className="qsp-title" title=\{name\}>\{name\}</);
});

describe.each(DUSK_SKINS)('%s: every pairing clears AA', (skin) => {
  const dusk = { skin, theme: 'dark' };
  const r = (n) => H.role(n, dusk);
  test.each([
    ['the title and body on the page', () => H.ratio(r('--text'), r('--bg'))],
    ['the eyebrow on the page', () => H.ratio(r('--muted'), r('--bg'))],
    ['the notice on its card', () => H.ratio(r('--text'), r('--surface'))],
  ])('%s', (_l, m) => expect(m()).toBeGreaterThanOrEqual(H.AA));
});
