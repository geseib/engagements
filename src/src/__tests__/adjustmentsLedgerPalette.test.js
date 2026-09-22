/**
 * The three step-3 stylesheets — AdjustmentsLedger.css (.adjl),
 * OrgBillingDrawer.css (.obill), DiscountCodes.css (.dcode): contrast
 * composited from the real stack, the 12px floor, one scope class each, the
 * scrim rule, and no stray hex outside the token block.
 */
const fs = require('fs');
const path = require('path');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'components', f), 'utf8');
const SHEETS = [['AdjustmentsLedger.css', 'adjl'], ['OrgBillingDrawer.css', 'obill'], ['DiscountCodes.css', 'dcode'], ['InvoicePanel.css', 'inv']];

function lin(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function lum([r, g, b]) { return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b); }
function ratio(a, b) { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); }
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const over = (fg, a, bg) => fg.map((c, i) => Math.round(c * a + bg[i] * (1 - a)));
const BG = hex('#0F1A2E'); const SURFACE = hex('#1B2942');
const TEXT = hex('#F4EDE4'); const MUTED = hex('#9BA8BE'); const PRIMARY = hex('#F6A94C'); const DANGER_TEXT = hex('#EF8C86'); const SUCCESS_TEXT = hex('#6FD0A4');

describe.each(SHEETS)('%s', (file, scope) => {
  const css = read(file);
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');

  test('copy, labels, negatives and danger clear AA on both grounds', () => {
    for (const g of [BG, SURFACE]) {
      [TEXT, MUTED, DANGER_TEXT, SUCCESS_TEXT].forEach((ink) => expect(ratio(ink, g)).toBeGreaterThanOrEqual(4.5));
    }
    expect(ratio(hex('#1B2942'), PRIMARY)).toBeGreaterThanOrEqual(4.5);
  });
  test('every tint keeps --text and --muted above AA', () => {
    for (const m of stripped.matchAll(/--[a-z]+-tint-[a-z]+:\s*rgba\((\d+),\s*(\d+),\s*(\d+),\s*(\.\d+|\d\.\d+)\)/g)) {
      const t = [+m[1], +m[2], +m[3]]; const a = +m[4];
      for (const g of [BG, SURFACE]) {
        expect(ratio(TEXT, over(t, a, g))).toBeGreaterThanOrEqual(4.5);
        expect(ratio(MUTED, over(t, a, g))).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
  test('nothing below 12px; every selector is rooted at the scope; no stray hex; never color: var(--danger)', () => {
    [...stripped.matchAll(/font-size:\s*(\d+)px/g)].forEach((m) => expect(+m[1]).toBeGreaterThanOrEqual(12));
    const selectors = stripped.match(/^[^\s@}][^{]*(?=\{)/gm) || [];
    selectors.forEach((sel) => sel.split(',').forEach((s) => expect(s.trim()).toMatch(new RegExp(`^\\.${scope}(\\b|-)`))));
    const first = stripped.indexOf(`.${scope}`);
    const tokenBlock = stripped.slice(first, stripped.indexOf('}', first));
    expect(stripped.replace(tokenBlock, '')).not.toMatch(/#[0-9a-f]{3,6}\b/i);
    expect(stripped).not.toMatch(/color:\s*var\(--danger\)/);
  });
  test('a scrim, if any, scrolls and centres the card with margin auto', () => {
    const i = stripped.indexOf(`.${scope}-scrim {`);
    if (i < 0) return;
    const scrim = stripped.slice(i, stripped.indexOf('}', i));
    expect(scrim).toMatch(/align-items:\s*flex-start/);
    expect(scrim).toMatch(/overflow-y:\s*auto/);
    const j = stripped.indexOf(`.${scope}-modal {`);
    expect(stripped.slice(j, stripped.indexOf('}', j))).toMatch(/margin:\s*auto/);
  });
});
