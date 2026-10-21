/**
 * THE TWO NEW DUSK SURFACES — the bell (NotificationsBell.css, `.nbell`) and
 * the AI draft review (DraftReview.css, `.drv`) — held to the design
 * system's contract (engage-design, testing-a-surface.md).
 *
 * Named *Palette.test.js, never *token*: .gitignore:35 is an unanchored
 * `*token*`, and a file with that in its name never reaches CI.
 *
 * jsdom resolves no custom property and lays nothing out, so this reads the
 * stylesheets as text and does the arithmetic on the skins' role values
 * (testing/skinHarness.js), for every dusk skin.
 *
 * // rejects: a selector outside its namespace, a surface that forgets to
 * //          declare dusk, destructive copy painted with --danger, type under
 * //          the 12px floor, and a text pairing under AA on any skin.
 */
const fs = require('fs');
const path = require('path');
const H = require('../testing/skinHarness');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

const SURFACES = [
  { name: 'the bell', css: 'NotificationsBell.css', jsx: 'NotificationsBell.jsx', ns: 'nbell' },
  { name: 'the draft review', css: 'DraftReview.css', jsx: 'DraftReview.jsx', ns: 'drv' },
];

describe.each(SURFACES)('$name', ({ css, jsx, ns }) => {
  const CSS = strip(read('components', css));
  const JSX = read('components', jsx);

  test('every selector is in its own namespace', () => {
    const selectors = CSS.replace(/@media[^{]*\{/g, '').match(/[^{}]+(?=\{)/g) || [];
    const stray = selectors
      .flatMap((s) => s.split(','))
      .map((s) => s.trim())
      .filter((s) => s && !s.startsWith('@') && !/^(from|to|\d+%)$/.test(s))
      .filter((s) => !s.startsWith(`.${ns}`));
    expect(stray).toEqual([]);
  });

  test('…and the component uses no class of somebody else\'s namespace for its own markup', () => {
    const classes = [...JSX.matchAll(/className=["`{][^"`}]*["`}]/g)].map((m) => m[0]);
    const ours = classes.filter((c) => c.includes(`${ns}-`) || c.includes(`"${ns}"`));
    expect(ours.length).toBeGreaterThan(3);
  });

  test('nothing is painted with --danger, which does not carry text', () => {
    expect(CSS).not.toMatch(/(^|[^-])color:\s*var\(--danger\)/);
  });

  test('no type under the 12px floor', () => {
    const px = [...CSS.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)].map((m) => Number(m[1]));
    const tokens = [...CSS.matchAll(/--[a-z]+-t-[a-z]+:\s*(\d+)px/g)].map((m) => Number(m[1]));
    expect([...px, ...tokens].filter((n) => n < 12)).toEqual([]);
  });

  test('no colour literal and no --primary (the skin gate, restated for this surface)', () => {
    expect(CSS).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(CSS).not.toMatch(/var\(--primary/);
  });
});

test('the review declares dusk on its root, wherever it is mounted', () => {
  const JSX = read('components', 'DraftReview.jsx');
  const roots = [...JSX.matchAll(/<section className="drv"[^>]*>/g)].map((m) => m[0]);
  expect(roots.length).toBeGreaterThan(0);
  roots.forEach((r) => expect(r).toContain('data-theme="dark"'));
});

const DUSK = H.CASES.filter(([, t]) => t === 'dark');
describe.each(DUSK)('the text pairings these surfaces paint: %s / %s', (skin, theme) => {
  const role = (n) => H.role(n, { skin, theme });
  const PAIRS = [
    ['bell: notification title on the panel', '--text', '--surface'],
    ['bell: body and meta lines', '--muted', '--surface'],
    ['bell: count on the accent', '--on-accent', '--accent'],
    ['review: questions on the field', '--text', '--bg'],
    ['review: secondary lines', '--muted', '--bg'],
    ['review: failure copy', '--danger-text', '--bg'],
    ['review: the correct answer', '--success-text', '--bg'],
    ['review: primary button', '--on-accent', '--accent'],
    ['review: inputs', '--text', '--surface-2'],
  ];
  test.each(PAIRS)('%s clears AA', (_, fg, bg) => {
    expect(H.ratio(role(fg), role(bg))).toBeGreaterThanOrEqual(4.5);
  });
});
