/**
 * components/LeavePlanDialog.css — the CSS contract: measured contrast on the
 * dusk card, composited up the real stack (card over scrim over the field);
 * the 12px floor and 36px rows; the `.lvp` namespace, which styles.css must not
 * also declare; the scrim and row-action rules; and the theme the dialog
 * declares on itself. The stylesheet is read as text — jsdom resolves no
 * custom property and has no layout engine, so arithmetic on the text is the
 * only honest check.
 */
const fs = require('fs');
const path = require('path');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const CSS = read('components/LeavePlanDialog.css');
const JSX = read('components/LeavePlanDialog.jsx');
const STYLES = read('styles.css');
const stripped = CSS.replace(/\/\*[\s\S]*?\*\//g, '');

function lin(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function lum([r, g, b]) { return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b); }
function ratio(a, b) { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); }
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const over = (fg, a, bg) => fg.map((c, i) => Math.round(c * a + bg[i] * (1 - a)));

/** A dusk token as styles.css declares it on :root — never a guess. */
const token = (name) => {
  const m = new RegExp(`${name}:\\s*(#[0-9A-Fa-f]{6})`).exec(STYLES);
  if (!m) throw new Error(`${name} is not declared in styles.css`);
  return hex(m[1]);
};
const tint = (name) => {
  const m = new RegExp(`${name}:\\s*rgba\\((\\d+),\\s*(\\d+),\\s*(\\d+),\\s*(\\.\\d+|\\d\\.\\d+)\\)`).exec(CSS);
  if (!m) throw new Error(`${name} not declared`);
  return { rgb: [+m[1], +m[2], +m[3]], a: +m[4] };
};
const local = (name) => {
  const m = new RegExp(`${name}:\\s*(#[0-9A-Fa-f]{6})`).exec(CSS);
  if (!m) throw new Error(`${name} not declared`);
  return hex(m[1]);
};
const block = (sel) => {
  const i = stripped.indexOf(`${sel} {`);
  if (i === -1) throw new Error(`${sel} not found`);
  return stripped.slice(i, stripped.indexOf('}', i));
};

const BG = token('--bg'); const SURFACE = token('--surface');
const TEXT = token('--text'); const MUTED = token('--muted');
const PRIMARY = token('--primary'); const DANGER_TEXT = token('--danger-text'); const DANGER_DEEP = token('--danger-deep');

describe('contrast, composited from the real paint stack', () => {
  test('copy, labels and destructive copy clear AA on the card and on the field', () => {
    for (const ground of [SURFACE, BG]) {
      expect(ratio(TEXT, ground)).toBeGreaterThanOrEqual(4.5);
      expect(ratio(MUTED, ground)).toBeGreaterThanOrEqual(4.5);
      expect(ratio(DANGER_TEXT, ground)).toBeGreaterThanOrEqual(4.5);
    }
  });

  test('every tint keeps --text and --muted above AA where it is painted: on the card', () => {
    for (const name of ['--lvp-tint-note', '--lvp-tint-held', '--lvp-tint-ok', '--lvp-tint-bad', '--lvp-row-hover']) {
      const t = tint(name);
      const painted = over(t.rgb, t.a, SURFACE);
      expect(ratio(TEXT, painted)).toBeGreaterThanOrEqual(4.5);
      expect(ratio(MUTED, painted)).toBeGreaterThanOrEqual(4.5);
      expect(ratio(DANGER_TEXT, painted)).toBeGreaterThanOrEqual(4.5);
    }
  });

  test('the ink on the two filled buttons is a declared local, and clears AA', () => {
    expect(ratio(local('--lvp-on-accent'), PRIMARY)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(local('--lvp-on-danger'), DANGER_DEEP)).toBeGreaterThanOrEqual(4.5);
    expect(block('.lvp-btn--primary')).toMatch(/color:\s*var\(--lvp-on-accent\)/);
    expect(block('.lvp-btn--dangersolid')).toMatch(/background:\s*var\(--danger-deep\)/);
  });

  test('--danger never carries text', () => {
    expect(stripped).not.toMatch(/(^|[^-])color:\s*var\(--danger\)/m);
  });
});

describe('the contract', () => {
  test('nothing below the 12px floor; rows are 36px; the select renders at body size', () => {
    expect(CSS).toMatch(/--lvp-t-floor:\s*12px/);
    expect(CSS).toMatch(/--lvp-row-h:\s*36px/);
    const px = [...stripped.matchAll(/font-size:\s*(\d+)px/g)].map((m) => +m[1]);
    px.forEach((n) => expect(n).toBeGreaterThanOrEqual(12));
    expect(block('.lvp-select')).toMatch(/var\(--lvp-t-body\)/);
    expect(block('.lvp-tbl td')).toMatch(/height:\s*var\(--lvp-row-h\)/);
  });

  test('every selector is rooted at .lvp, styles.css declares nothing there, and no hex survives outside the token block', () => {
    const selectors = stripped.match(/^[^\s@}][^{]*(?=\{)/gm) || [];
    expect(selectors.length).toBeGreaterThan(20);
    selectors.forEach((sel) => sel.split(',').forEach((s) => expect(s.trim()).toMatch(/^\.lvp(\b|-)/)));
    expect(STYLES).not.toMatch(/\.lvp(\b|-)/);
    const tokenBlock = block('.lvp');
    expect(stripped.replace(tokenBlock, '')).not.toMatch(/#[0-9a-f]{3,6}\b/i);
  });

  test('every custom property the sheet reads is declared — here, or on :root in styles.css', () => {
    const used = new Set([...stripped.matchAll(/var\((--[a-z0-9-]+)\)/gi)].map((m) => m[1]));
    for (const name of used) {
      const declared = new RegExp(`${name}\\s*:`).test(CSS) || new RegExp(`${name}\\s*:`).test(STYLES);
      expect({ name, declared }).toEqual({ name, declared: true });
    }
  });

  test('tables are fixed-layout and their column widths add up', () => {
    expect(block('.lvp-tbl')).toMatch(/table-layout:\s*fixed/);
    const widths = [...stripped.matchAll(/\.lvp-col-[a-z]+ \{ width: (\d+)%; \}/g)].map((m) => +m[1]);
    expect(widths.reduce((a, b) => a + b, 0)).toBe(100);
  });

  test('the scrim scrolls and the card centres with margin auto (hard rule 10)', () => {
    expect(block('.lvp-scrim')).toMatch(/align-items:\s*flex-start/);
    expect(block('.lvp-scrim')).toMatch(/overflow-y:\s*auto/);
    expect(block('.lvp-modal')).toMatch(/margin:\s*auto/);
  });

  test('row and footer actions use margin-left auto, never flex-end (hard rule 9)', () => {
    expect(stripped).not.toMatch(/justify-content:\s*flex-end/);
    expect(stripped).toMatch(/\.lvp-rowact > :first-child \{ margin-left: auto; \}/);
    expect(block('.lvp-rowact')).toMatch(/flex-wrap:\s*wrap/);
  });

  test('the truncating name is one text node with min-width 0, and carries its full text in title', () => {
    expect(block('.lvp-nm')).toMatch(/min-width:\s*0/);
    expect(block('.lvp-nm')).toMatch(/text-overflow:\s*ellipsis/);
    expect(JSX).toMatch(/<span className="lvp-nm" title=\{set\.name\}>\{set\.name\}<\/span>/);
  });

  test('the dialog declares its own theme rather than inheriting one', () => {
    expect(JSX).toMatch(/overlayClassName="lvp lvp-scrim"/);
    expect(JSX).toMatch(/theme="dark"/);
  });
});
