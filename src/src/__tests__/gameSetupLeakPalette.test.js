/**
 * GLOBAL PAPER RULES MUST NOT LEAK INTO THE DUSK DIALOG (live dev test,
 * 30 Oct 2026: docs/design/new-engagement/reviews/devtest-3-visual-access.md
 * H1, H5, M1).
 *
 * Three faults, one cause. styles.css paints the paper-era components the
 * dialog also mounts — `.status-message` (#f0f0f0), `.category-button:hover`
 * (#f0f4ff), `.btn-primary:disabled` (opacity .6) — and the dialog's sheet
 * overrode only some of their properties. The rest fell through: a "Topics
 * refreshed" note at 1.02:1, a switched-off topic that turned white under the
 * pointer (1.06:1), a disabled Create dimmed to 3.5:1.
 *
 * THE RULE THIS FILE HOLDS: for every rule in styles.css whose selector is
 * built only from the global classes the dialog mounts, GameSetupDialog.css
 * declares the SAME selector under `.gsd ` with EVERY property the global rule
 * sets. Then the global rule can say anything; inside the dialog it is
 * always answered. A new global property on one of these classes fails here
 * until the dialog answers it.
 *
 * Named *Palette* (never *Token*: .gitignore's `*token*`).
 */
const fs = require('fs');
const path = require('path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const GLOBAL = strip(read('styles.css'));
const CSS = strip(read('components', 'GameSetupDialog.css'));

/** Every innermost rule: [selectorPart, Map(prop -> value)], media blocks flattened. */
function rules(css) {
  const out = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const decls = new Map();
    for (const d of m[2].split(';')) {
      const at = d.indexOf(':');
      if (at > 0) decls.set(d.slice(0, at).trim(), d.slice(at + 1).trim());
    }
    for (const sel of m[1].split(',')) {
      const s = sel.trim().replace(/\s+/g, ' ');
      if (s && !s.startsWith('@')) out.push([s, decls]);
    }
  }
  return out;
}

/* The global classes the create dialog renders (GameSetupDialog,
   SessionOptions' SessionCategories, StatusMessage) plus their state words. */
const MOUNTED = new Set([
  'category-button', 'category-button-grid', 'category-name', 'category-count', 'selected',
  'status-message', 'success', 'error', 'pending',
  'btn-primary', 'btn-secondary', 'dialog-actions',
]);
const PSEUDO = /^(:hover|:disabled|:focus)$/;

function onlyMounted(sel) {
  const tokens = sel.split(/[\s>+~]+/).filter(Boolean);
  return tokens.length > 0 && tokens.every((t) => {
    const parts = t.match(/(\.[\w-]+|:[\w-]+)/g) || [];
    if (parts.join('') !== t) return false; // an element or attribute: not ours to answer
    return parts.every((p) => (p.startsWith('.') ? MOUNTED.has(p.slice(1)) : PSEUDO.test(p)));
  });
}

const globalRules = rules(GLOBAL).filter(([sel]) => onlyMounted(sel));
const scoped = rules(CSS);
const scopedProps = (sel) => {
  const props = new Set();
  for (const [s, decls] of scoped) if (s === `.gsd ${sel}`) for (const p of decls.keys()) props.add(p);
  return props;
};

test('the walk finds the three rules that leaked', () => {
  const sels = globalRules.map(([s]) => s);
  expect(sels).toEqual(expect.arrayContaining(['.status-message', '.category-button:hover', '.btn-primary:disabled']));
});

test.each(globalRules.map(([sel, decls]) => [sel, [...decls.keys()]]))(
  'styles.css %s is answered in full under .gsd',
  (sel, props) => {
    const have = scopedProps(sel);
    expect([sel, props.filter((p) => !have.has(p))]).toEqual([sel, []]);
  },
);

/* ── The three measured faults, measured ─────────────────────────────── */
function lin(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function lum(c) { return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]); }
const ratio = (a, b) => { const x = lum(a); const y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const over = (fg, bg, a) => fg.map((c, i) => c * a + bg[i] * (1 - a));
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.substr(i, 2), 16));
const tok = (name) => {
  const block = CSS.slice(CSS.indexOf('.gsd {'), CSS.indexOf('}', CSS.indexOf('.gsd {')));
  return block.match(new RegExp(`${name}:\\s*([^;]+);`))[1].trim();
};
const CARD = hex(tok('--gsd-card'));
const TEXT = hex(tok('--gsd-text'));
const MUTED = hex(tok('--gsd-muted'));
const INFO = hex('#7CA7E6'); // --info in Classic; the wash below is over the card
const decl = (sel, prop) => {
  for (const [s, d] of scoped) if (s === sel && d.has(prop)) return d.get(prop);
  return null;
};

test('H1: the cleared-picks note is dusk text on a periwinkle wash over the card, at AA', () => {
  expect(decl('.gsd .status-message', 'background')).toBe('var(--gsd-wash-info)');
  expect(decl('.gsd .status-message', 'color')).toBe('var(--gsd-text)');
  const a = Number(tok('--gsd-wash-info').match(/\/\s*([0-9.]+)/)[1]);
  expect(ratio(TEXT, over(INFO, CARD, a))).toBeGreaterThanOrEqual(4.5);
});

test('H5: a switched-off topic under the pointer stays dusk', () => {
  const bg = decl('.gsd .category-button:hover', 'background');
  expect(bg).toBe('transparent');
  expect(decl('.gsd .category-button:hover', 'transform')).toBe('none');
  expect(ratio(TEXT, CARD)).toBeGreaterThanOrEqual(4.5);
  expect(ratio(MUTED, CARD)).toBeGreaterThanOrEqual(4.5);
});

/* The rest of the live test's CSS findings, pinned. */
test('M2: reduced motion beats the 0,5,0 `.is-play` rules (it did not, by specificity)', () => {
  expect(CSS).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{[^@]*\.gsd \.gsd-fp \*\s*\{\s*animation:\s*none !important/);
});

test('M3: one focus ring — no `outline: none` on a field, and no amber ring', () => {
  expect(CSS).not.toMatch(/outline:\s*none/);
  expect(CSS).not.toMatch(/outline:\s*2px solid var\(--gsd-primary\)/);
  expect(decl('.gsd .dialog-input:focus', 'outline')).toBe('2px solid var(--gsd-focus)');
});

test('H6: the help "?" is the dialog\'s muted, with the dialog\'s focus ring', () => {
  expect(decl('.gsd .help-button.help-button-quiet', 'color')).toBe('var(--gsd-muted)');
  expect(decl('.gsd .help-button.help-button-quiet:focus-visible', 'outline')).toBe('2px solid var(--gsd-focus)');
});

test('H2: the phone foot rules come LAST, after every equal-weight foot rule', () => {
  const lastFootNote = CSS.lastIndexOf('.gsd .gsd-foot-note {');
  const phoneFoot = CSS.lastIndexOf('.gsd .dialog-actions .gsd-foot-note { flex: 1 0 100%');
  expect(phoneFoot).toBeGreaterThan(lastFootNote);
  expect(CSS.slice(phoneFoot)).toMatch(/\.btn-primary,[\s\S]*?min-height:\s*44px/);
});

test('M1: a disabled Create is never dimmed, and never fades', () => {
  expect(decl('.gsd .btn-primary:disabled', 'opacity')).toBe('1');
  expect(decl('.gsd .btn-primary', 'transition')).toBe('none');
  expect(ratio(MUTED, CARD)).toBeGreaterThanOrEqual(4.5);
});
