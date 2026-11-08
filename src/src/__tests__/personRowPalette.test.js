/**
 * THE PERSON ROW'S STYLESHEET, AS TEXT (components/people/PersonRow.css;
 * experience plan §3.2b, step 2e).
 *
 * jsdom loads no stylesheet, so the contract is read from the file: scoped,
 * token-only, on the laptop ladder, 36px rows, five slots in a fixed order
 * with the name the only flexible one, the name a single truncating text
 * node, and the measured pairs it states in its header.
 */
const fs = require('fs');
const path = require('path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const raw = read('components', 'people', 'PersonRow.css');
const css = raw.replace(/\/\*[\s\S]*?\*\//g, '');
const block = (sel) => {
  const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = css.match(new RegExp(`(?:^|})\\s*${esc}\\s*\\{([^}]*)\\}`));
  return m ? m[1] : '';
};

test('every selector is rooted at .prow, and styles.css declares nothing in that scope', () => {
  const selectors = css.match(/[^{}]+(?=\{)/g) || [];
  // At-rules (@media) are not selectors.
  selectors.flatMap((s) => s.split(',')).map((s) => s.trim()).filter(Boolean)
    .filter((s) => !s.startsWith('@'))
    .forEach((s) => expect([s, s.startsWith('.prow')]).toEqual([s, true]));
  expect(read('styles.css')).not.toMatch(/\.prow\b/);
});

/* THE RAIL'S ⋯ (owner, 5 Nov 2026, cut 6): shown on hover and focus-within
   where a pointer can hover, always on touch, and never removed from the tab
   order (opacity, never display:none or visibility:hidden). */
test('the rail\'s ⋯ shows on hover and focus-within, always on touch, and stays keyboard-reachable', () => {
  const hover = (css.match(/@media \(hover: hover\)\s*\{([\s\S]*?)\n\}/) || [])[1] || '';
  expect(hover).toMatch(/\.prow\.prow--rail \.prow-more-toggle \{[^}]*opacity:\s*0/);
  expect(hover).toMatch(/\.prow\.prow--rail:hover \.prow-more-toggle/);
  expect(hover).toMatch(/\.prow\.prow--rail:focus-within \.prow-more-toggle/);
  expect(hover).toMatch(/\.prow-more-toggle\[aria-expanded="true"\] \{ opacity: 1; \}/);
  const touch = (css.match(/@media \(hover: none\)\s*\{([\s\S]*?)\n\}/) || [])[1] || '';
  expect(touch).toMatch(/\.prow\.prow--rail \.prow-more-toggle \{ opacity: 1; \}/);
  expect(css).not.toMatch(/prow-more-toggle[^{]*\{[^}]*(display:\s*none|visibility:\s*hidden)/);
  // Only the rail's rows: the Session menu's and the Remote's keep ⋯ drawn.
  expect(hover).not.toMatch(/(^|[\s,])\.prow \.prow-more-toggle/);
});

test('no colour literal, no --primary, never text in --danger', () => {
  expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(\s*\d/);
  expect(css).not.toMatch(/var\(--primary/);
  expect(css).not.toMatch(/(^|[^-])color:\s*var\(--danger\)/);
});

test('every token it uses is declared (its own locals, or the roles sheet)', () => {
  const roles = read('styles', 'roles.css') + read('styles.css');
  const used = [...new Set([...css.matchAll(/var\(--([a-z0-9-]+)/g)].map((m) => m[1]))];
  used.forEach((t) => {
    const declared = new RegExp(`--${t}\\s*:`).test(css) || new RegExp(`--${t}\\s*:`).test(roles);
    expect([t, declared]).toEqual([t, true]);
  });
});

test('the laptop ladder, nothing under 12px; rows are 36px', () => {
  const px = [...css.matchAll(/--prow-t-[a-z]+:\s*(\d+)px/g)].map((m) => Number(m[1]));
  expect(px.sort((a, b) => a - b)).toEqual([12, 13, 15]);
  expect(css).toMatch(/--prow-row-h:\s*36px/);
  [...css.matchAll(/font-size:\s*(\d+)px/g)].forEach((m) => expect(Number(m[1])).toBeGreaterThanOrEqual(12));
});

test('five slots in a fixed order, fixed widths, the name the only flexible one', () => {
  const cols = block('.prow').match(/grid-template-columns:\s*([^;]+);/)[1].trim().split(/\s+(?![^(]*\))/);
  expect(cols).toHaveLength(5);
  expect(cols.filter((c) => /fr/.test(c))).toEqual(['minmax(0, 1fr)']);
  expect(cols[1]).toBe('minmax(0, 1fr)');
});

test('the name truncates as one text node (hard rule 8)', () => {
  const name = block('.prow .prow-name');
  ['min-width: 0', 'overflow: hidden', 'text-overflow: ellipsis', 'white-space: nowrap'].forEach((d) => expect(name).toMatch(d));
});

test('the header states the measured pairs, and they clear AA', () => {
  const lum = (hex) => {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
  // Dusk: --text #F4EDE4, --muted #9BA8BE, --danger-text #EF8C86 on --surface #1B2942 / --surface-2 #25375A.
  expect(ratio('#F4EDE4', '#1B2942')).toBeGreaterThanOrEqual(4.5);
  expect(ratio('#9BA8BE', '#1B2942')).toBeGreaterThanOrEqual(4.5);
  expect(ratio('#9BA8BE', '#25375A')).toBeGreaterThanOrEqual(4.5);
  expect(ratio('#EF8C86', '#25375A')).toBeGreaterThanOrEqual(4.5);
  expect(raw).toMatch('--danger-text on --surface-2   4.94:1');
});
