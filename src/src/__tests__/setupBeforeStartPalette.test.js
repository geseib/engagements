/**
 * SETUP BEFORE START'S STYLESHEET, AS TEXT (components/SetupBeforeStart.css;
 * experience plan 4c; engage-design §5). jsdom loads no stylesheet, so the
 * contract is read from the file and the contrast is measured from the skins'
 * own dusk values. NO GEOMETRIC ASSERTIONS.
 */
const fs = require('fs');
const path = require('path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const css = read('components', 'SetupBeforeStart.css').replace(/\/\*[\s\S]*?\*\//g, '');
const rule = (sel) => {
  const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = css.match(new RegExp(`(?:^|})\\s*${esc}\\s*\\{([^}]*)\\}`));
  return m ? m[1] : '';
};

test('every selector is rooted at .sbs, and styles.css declares nothing there', () => {
  const selectors = (css.match(/[^{}]+(?=\{)/g) || []).map((s) => s.trim()).filter((s) => !s.startsWith('@'));
  expect(selectors.length).toBeGreaterThan(10);
  selectors.flatMap((s) => s.split(',')).map((s) => s.trim()).filter(Boolean)
    .forEach((s) => expect([s, s.startsWith('.sbs')]).toEqual([s, true]));
  expect(read('styles.css')).not.toMatch(/\.sbs\b/);
});

test('roles only: no colour literal, no --primary, never text in --danger', () => {
  expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(\s*\d/);
  expect(css).not.toMatch(/var\(--primary/);
  expect(css).not.toMatch(/(^|[^-])color:\s*var\(--danger\)/);
  expect(rule('.sbs .sbs-notice')).toMatch(/color:\s*var\(--danger-text\)/);
});

test('every token it uses is declared (its own scale, or the app\'s roles)', () => {
  const declared = [css, read('styles.css'), read('styles', 'roles.css')].join('\n');
  const used = [...new Set([...css.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]))];
  expect(used.filter((t) => !new RegExp(`${t}\\s*:`).test(declared))).toEqual([]);
});

test('the laptop ladder, nothing under the floor', () => {
  const scale = [...css.matchAll(/--sbs-t-[a-z]+:\s*(\d+)px/g)].map((m) => Number(m[1]));
  expect(scale.sort((a, b) => a - b)).toEqual([12, 13, 15, 19, 24]);
  expect(css).not.toMatch(/font-size:\s*\d+px/);
});

test('the dusk is declared on the root, and the title truncates as one text node with title=', () => {
  const jsx = read('components', 'SetupBeforeStart.jsx');
  expect(jsx).toMatch(/className="sbs" data-theme="dark"/);
  const t = rule('.sbs .sbs-title');
  expect(/text-overflow:\s*ellipsis/.test(t) && /min-width:\s*0/.test(t) && /white-space:\s*nowrap/.test(t)).toBe(true);
  expect(jsx).toMatch(/className="sbs-title" title=\{name\}/);
  // Hard rule 9: the action group wraps and is pushed with margin-left auto.
  expect(rule('.sbs .sbs-acts')).toMatch(/margin-left:\s*auto/);
  expect(rule('.sbs .sbs-acts')).not.toMatch(/justify-content:\s*flex-end/);
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
  test('text and muted on the page and on the status card, and a refusal on its card, clear AA', () => {
    for (const ground of ['bg', 'surface']) {
      for (const ink of ['text', 'muted']) {
        expect([ground, ink, ratio(v(ink), v(ground)) >= 4.5]).toEqual([ground, ink, true]);
      }
    }
    expect(v('danger-text')).toBeTruthy();
    expect(ratio(v('danger-text'), v('surface'))).toBeGreaterThanOrEqual(4.5);
  });
});
