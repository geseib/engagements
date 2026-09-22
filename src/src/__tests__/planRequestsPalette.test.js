/**
 * components/PlanRequests.css — the CSS contract: measured contrast on the
 * dusk work field, the 12px floor, the `.preq` namespace, and the scrim rule.
 * The stylesheet is read as text; jsdom resolves no custom property.
 */
const fs = require('fs');
const path = require('path');

const CSS = fs.readFileSync(path.join(__dirname, '..', 'components', 'PlanRequests.css'), 'utf8');
const stripped = CSS.replace(/\/\*[\s\S]*?\*\//g, '');

function lin(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function lum([r, g, b]) { return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b); }
function ratio(a, b) { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); }
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const over = (fg, a, bg) => fg.map((c, i) => Math.round(c * a + bg[i] * (1 - a)));

const BG = hex('#0F1A2E'); const SURFACE = hex('#1B2942');
const TEXT = hex('#F4EDE4'); const MUTED = hex('#9BA8BE'); const PRIMARY = hex('#F6A94C'); const DANGER_TEXT = hex('#EF8C86');
const tint = (name) => {
  const m = new RegExp(`${name}:\\s*rgba\\((\\d+),\\s*(\\d+),\\s*(\\d+),\\s*(\\.\\d+|\\d\\.\\d+)\\)`).exec(CSS);
  if (!m) throw new Error(`${name} not declared`);
  return { rgb: [+m[1], +m[2], +m[3]], a: +m[4] };
};

describe('contrast, composited from the real paint stack', () => {
  test('copy and labels clear AA on the field and on the dialog surface', () => {
    for (const ground of [BG, SURFACE]) {
      expect(ratio(TEXT, ground)).toBeGreaterThanOrEqual(4.5);
      expect(ratio(MUTED, ground)).toBeGreaterThanOrEqual(4.5);
      expect(ratio(DANGER_TEXT, ground)).toBeGreaterThanOrEqual(4.5);
    }
  });
  test('every tint keeps --text and --muted above AA', () => {
    for (const name of ['--preq-tint-note', '--preq-tint-ok', '--preq-tint-bad']) {
      const t = tint(name);
      for (const ground of [BG, SURFACE]) {
        const painted = over(t.rgb, t.a, ground);
        expect(ratio(TEXT, painted)).toBeGreaterThanOrEqual(4.5);
        expect(ratio(MUTED, painted)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
  test('ink on the filled button is the invariant dusk navy, not var(--bg)', () => {
    expect(CSS).toMatch(/--preq-on-accent:\s*#1B2942/);
    expect(ratio(hex('#1B2942'), PRIMARY)).toBeGreaterThanOrEqual(4.5);
    expect(stripped).not.toMatch(/\.preq-btn--primary\s*\{[^}]*color:\s*var\(--bg\)/);
  });
});

describe('the contract', () => {
  test('nothing below the 12px floor; rows are 36px', () => {
    expect(CSS).toMatch(/--preq-t-floor:\s*12px/);
    expect(CSS).toMatch(/--preq-row-h:\s*36px/);
    const px = [...stripped.matchAll(/font-size:\s*(\d+)px/g)].map((m) => +m[1]);
    px.forEach((n) => expect(n).toBeGreaterThanOrEqual(12));
  });
  test('every selector is rooted at .preq, and no hex literal survives outside the token block', () => {
    const selectors = stripped.match(/^[^\s@}][^{]*(?=\{)/gm) || [];
    selectors.forEach((sel) => sel.split(',').forEach((s) => expect(s.trim()).toMatch(/^\.preq(\b|-)/)));
    const tokenBlock = stripped.slice(stripped.indexOf('.preq {'), stripped.indexOf('}', stripped.indexOf('.preq {')));
    const outside = stripped.replace(tokenBlock, '');
    expect(outside).not.toMatch(/#[0-9a-f]{3,6}\b/i);
    expect(stripped).not.toMatch(/color:\s*var\(--danger\)/);
  });
  test('the scrim scrolls and the card centres with margin auto (hard rule 10)', () => {
    const scrim = stripped.slice(stripped.indexOf('.preq-scrim {'), stripped.indexOf('}', stripped.indexOf('.preq-scrim {')));
    expect(scrim).toMatch(/align-items:\s*flex-start/);
    expect(scrim).toMatch(/overflow-y:\s*auto/);
    const modal = stripped.slice(stripped.indexOf('.preq-modal {'), stripped.indexOf('}', stripped.indexOf('.preq-modal {')));
    expect(modal).toMatch(/margin:\s*auto/);
  });
  test('row actions use margin-left auto, never flex-end (hard rule 9)', () => {
    const act = stripped.slice(stripped.indexOf('.preq-rowact {'), stripped.indexOf('}', stripped.indexOf('.preq-rowact {')));
    expect(act).not.toMatch(/justify-content:\s*flex-end/);
    expect(stripped).toMatch(/\.preq-rowact > :first-child \{ margin-left: auto; \}/);
  });
});
