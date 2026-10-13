/**
 * The three step-3 stylesheets — AdjustmentsLedger.css (.adjl),
 * OrgBillingDrawer.css (.obill), DiscountCodes.css (.dcode): contrast
 * composited from the real stack, the 12px floor, one scope class each, the
 * scrim rule, and no stray hex outside the token block.
 */
const fs = require('fs');
const path = require('path');
const H = require('../testing/skinHarness');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'components', f), 'utf8');
const SHEETS = [['AdjustmentsLedger.css', 'adjl'], ['OrgBillingDrawer.css', 'obill'], ['DiscountCodes.css', 'dcode'], ['InvoicePanel.css', 'inv']];

function lin(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function lum([r, g, b]) { return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b); }
function ratio(a, b) { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); }
const hex = (c) => H.parseColor(c).rgb;          // any colour a role resolves to
const over = (fg, a, bg) => fg.map((c, i) => Math.round(c * a + bg[i] * (1 - a)));
/* The four sheets render dusk: every dusk case of every skin. */
const DUSK = H.CASES.filter(([, t]) => t === 'dark');
const tokensFor = (opts) => ({
  BG: hex(H.role('--bg', opts)),
  SURFACE: hex(H.role('--surface', opts)),
  TEXT: hex(H.role('--text', opts)),
  MUTED: hex(H.role('--muted', opts)),
  PRIMARY: hex(H.role('--primary', opts)),
  DANGER_TEXT: hex(H.role('--danger-text', opts)),
  SUCCESS_TEXT: hex(H.role('--success-text', opts)),
  ON_ACCENT: hex(H.role('--on-accent', opts)),   // #1B2942 in Classic: the ink on the filled primary
});

describe.each(SHEETS)('%s', (file, scope) => {
  const css = read(file);
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');

  /* The token block's head as written (e.g. `.adjl, .adjl-bill, .adjl-empty {`), and
     every --*-tint-* it declares — resolved through the harness, so a tint that reads a
     role (`rgb(var(--danger-rgb) / .10)`) is measured rather than skipped. */
  const first = stripped.indexOf(`.${scope}`);
  const head = stripped.slice(first, stripped.indexOf('{', first) + 1);
  const tokenBody = stripped.slice(first, stripped.indexOf('}', first));
  const tints = [...tokenBody.matchAll(/(--[a-z]+-tint-[a-z]+)\s*:/g)].map((m) => m[1]);

  describe.each(DUSK)('%s / %s', (skin, theme) => {
    const { BG, SURFACE, TEXT, MUTED, PRIMARY, DANGER_TEXT, SUCCESS_TEXT, ON_ACCENT } = tokensFor({ skin, theme });

    test('copy, labels, negatives and danger clear AA on both grounds', () => {
      for (const g of [BG, SURFACE]) {
        [TEXT, MUTED, DANGER_TEXT, SUCCESS_TEXT].forEach((ink) => expect(ratio(ink, g)).toBeGreaterThanOrEqual(4.5));
      }
      expect(ratio(ON_ACCENT, PRIMARY)).toBeGreaterThanOrEqual(4.5);
    });
    test('every tint keeps --text and --muted above AA', () => {
      expect(tints.length).toBeGreaterThan(0);
      for (const name of tints) {
        const { rgb: t, a } = H.parseColor(H.scopeVar(stripped, head, name, { skin, theme }));
        for (const g of [BG, SURFACE]) {
          expect(ratio(TEXT, over(t, a, g))).toBeGreaterThanOrEqual(4.5);
          expect(ratio(MUTED, over(t, a, g))).toBeGreaterThanOrEqual(4.5);
        }
      }
    });
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
