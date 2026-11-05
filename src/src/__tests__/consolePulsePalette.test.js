/**
 * THE PULSE'S STYLESHEET, AS TEXT (components/console/ConsolePulse.css;
 * session-start D3, experience plan 2c; engage-design §5). jsdom loads no
 * stylesheet, so the contract is read from the file and the contrast is
 * measured from the skins' own dusk values. NO GEOMETRIC ASSERTIONS.
 */
const fs = require('fs');
const path = require('path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const css = read('components', 'console', 'ConsolePulse.css').replace(/\/\*[\s\S]*?\*\//g, '');
const rule = (sel) => {
  const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = css.match(new RegExp(`(?:^|})\\s*${esc}\\s*\\{([^}]*)\\}`));
  return m ? m[1] : '';
};

test('every selector is rooted at .cpulse, and styles.css declares nothing there', () => {
  const selectors = css.match(/[^{}]+(?=\{)/g) || [];
  expect(selectors.length).toBeGreaterThan(8);
  // At-rules (@media, @keyframes) and keyframe stops are not selectors.
  selectors.flatMap((s) => s.split(',')).map((s) => s.trim()).filter(Boolean)
    .filter((s) => !s.startsWith('@') && !/^(from|to|\d+%)$/.test(s))
    .forEach((s) => expect([s, s.startsWith('.cpulse')]).toEqual([s, true]));
  expect(read('styles.css')).not.toMatch(/\.cpulse\b/);
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

test('the laptop ladder with its one numeral: 12 / 13 / 15 / 19 / 24 / 30, nothing under the floor', () => {
  const scale = [...css.matchAll(/--cpulse-t-[a-z]+:\s*(\d+)px/g)].map((m) => Number(m[1]));
  expect(scale.sort((a, b) => a - b)).toEqual([12, 13, 15, 19, 24, 30]);
  expect(css).not.toMatch(/font-size:\s*\d+px/); // every size through the scale
  expect(css).not.toMatch(/font-size:\s*[\d.]+(rem|em)\b/);
  // One 30px numeral (the live count); the round's record after it at 24.
  expect(rule('.cpulse .cpulse-num')).toMatch(/font-size:\s*var\(--cpulse-t-numeral\)/);
  expect(rule('.cpulse .cpulse-val')).toMatch(/font-size:\s*var\(--cpulse-t-title\)/);
  expect((css.match(/var\(--cpulse-t-numeral\)/g) || []).length).toBe(1);
});

test('ONE tile (cut 5), and names truncate as one text node with min-width 0 (hard rule 8), the full list in title=', () => {
  expect(rule('.cpulse')).toMatch(/grid-template-columns:\s*minmax\(0, 1fr\);/);
  const sub = rule('.cpulse .cpulse-sub');
  expect(sub).toMatch(/text-overflow:\s*ellipsis/);
  expect(sub).toMatch(/min-width:\s*0/);
  expect(sub).toMatch(/white-space:\s*nowrap/);
  const nudge = rule('.cpulse .cpulse-nudge');
  expect(nudge).toMatch(/text-overflow:\s*ellipsis/);
  expect(nudge).toMatch(/min-width:\s*0/);
  // Who is left is said aloud: body size, text colour (cut 5).
  expect(nudge).toMatch(/font-size:\s*var\(--cpulse-t-body\)/);
  expect(nudge).toMatch(/color:\s*var\(--text\)/);
  const jsx = read('components', 'console', 'ConsolePulse.jsx');
  expect(jsx).toMatch(/className="cpulse-nudge"[^>]*title=\{room\.nudgeTitle/);
  expect(jsx).toMatch(/data-testid="pulse-joined" title=\{joined\}/);
});

test('calm: info for progress, green only for Everyone\'s in', () => {
  expect(rule('.cpulse .cpulse-bar i')).toMatch(/background:\s*var\(--info\)/);
  const greens = [...css.matchAll(/([^{}]+)\{[^}]*var\(--success(?:-text)?\)/g)].map((m) => m[1].trim());
  greens.forEach((sel) => expect([sel, /\.is-in\b/.test(sel)]).toEqual([sel, true]));
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
  test('every text pairing on the tile clears AA (4.5:1)', () => {
    const surface = v('surface');
    expect(surface).toBeTruthy();
    for (const ink of ['text', 'muted', 'success-text']) {
      expect([ink, ratio(v(ink), surface) >= 4.5]).toEqual([ink, true]);
    }
  });
});
