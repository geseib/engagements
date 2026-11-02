/**
 * SETUP'S STYLESHEET, AS TEXT (components/console/panels/SessionSetup.css;
 * session-start D1, experience plan 2b; engage-design §5). jsdom loads no
 * stylesheet, so the contract is read from the file and the contrast is
 * measured from the skins' own dusk values. NO GEOMETRIC ASSERTIONS.
 */
const fs = require('fs');
const path = require('path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const css = read('components', 'console', 'panels', 'SessionSetup.css').replace(/\/\*[\s\S]*?\*\//g, '');
const rule = (sel) => {
  const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = css.match(new RegExp(`(?:^|})\\s*${esc}\\s*\\{([^}]*)\\}`));
  return m ? m[1] : '';
};

test('every selector is rooted at .hsetup, and styles.css declares nothing there', () => {
  const selectors = (css.match(/[^{}]+(?=\{)/g) || []).map((s) => s.trim()).filter((s) => !s.startsWith('@'));
  expect(selectors.length).toBeGreaterThan(20);
  selectors.flatMap((s) => s.split(',')).map((s) => s.trim()).filter(Boolean)
    .forEach((s) => expect([s, s.startsWith('.hsetup')]).toEqual([s, true]));
  expect(read('styles.css')).not.toMatch(/\.hsetup\b/);
});

test('roles only: no colour literal, no --primary, never text in --danger', () => {
  expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(\s*\d/);
  expect(css).not.toMatch(/var\(--primary/);
  expect(css).not.toMatch(/(^|[^-])color:\s*var\(--danger\)/);
});

test('every token it uses is declared (its own scale, or the app\'s roles)', () => {
  const declared = [css, read('styles.css'), read('styles', 'roles.css')].join('\n');
  const used = [...new Set([...css.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]))];
  expect(used.filter((t) => !new RegExp(`${t}\\s*:`).test(declared))).toEqual([]);
});

test('the laptop ladder with its one numeral (the room\'s count), nothing under the floor', () => {
  const scale = [...css.matchAll(/--hsetup-t-[a-z]+:\s*(\d+)px/g)].map((m) => Number(m[1]));
  expect(scale.sort((a, b) => a - b)).toEqual([12, 13, 15, 19, 24, 30]);
  expect(css).not.toMatch(/font-size:\s*\d+px/);
  expect(css).not.toMatch(/font-size:\s*[\d.]+(rem|em)\b/);
  expect(rule('.hsetup .hsetup-numeral')).toMatch(/font-size:\s*var\(--hsetup-t-numeral\)/);
  expect((css.match(/var\(--hsetup-t-numeral\)/g) || []).length).toBe(1);
  // Inputs at body, never at label (engage-design §2).
  expect(rule('.hsetup .hsetup-select')).toMatch(/font-size:\s*var\(--hsetup-t-body\)/);
});

test('names that truncate are one text node with min-width 0 (hard rule 8), the full text in title=', () => {
  for (const sel of ['.hsetup .hsetup-recent', '.hsetup .hsetup-first-t']) {
    const r = rule(sel);
    expect([sel, /text-overflow:\s*ellipsis/.test(r) && /min-width:\s*0/.test(r) && /white-space:\s*nowrap/.test(r)]).toEqual([sel, true]);
  }
  const jsx = read('components', 'console', 'panels', 'SessionSetup.jsx');
  expect(jsx).toMatch(/className="hsetup-recent" title=/);
  expect(jsx).toMatch(/className="hsetup-first-t" title=/);
});

test('no new button family: Setup\'s links are not *-btn classes (the main button is Your part now\'s)', () => {
  expect(css).not.toMatch(/\.[\w-]*(btn|button)s?\b/);
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
  const v = (name) => (sk.match(new RegExp(`--sk-${name === 'info' ? '' : 'dark-'}${name}:\\s*(#[0-9A-Fa-f]{6})`)) || [])[1];
  test('every text pairing on a step card and on the page clears AA (4.5:1)', () => {
    for (const ground of ['surface', 'bg']) {
      const g = v(ground);
      expect(g).toBeTruthy();
      for (const ink of ['text', 'muted', 'success-text', 'info']) {
        expect([ground, ink, ratio(v(ink), g) >= 4.5]).toEqual([ground, ink, true]);
      }
    }
  });
});
