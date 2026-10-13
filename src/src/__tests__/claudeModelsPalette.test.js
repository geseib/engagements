/**
 * ClaudeModelsPanel.css: the design contract, read as text (jsdom resolves no
 * stylesheet). Every pairing the header claims is recomputed from the tokens,
 * composited up the real stack (--bg, then --surface, then a tint).
 */
const fs = require('fs');
const path = require('path');
const H = require('../testing/skinHarness');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const GLOBAL_CSS = require('../testing/classicGlobalCss')();
const CSS = read('components', 'ClaudeModelsPanel.css');
const JSX = read('components', 'ClaudeModelsPanel.jsx');
const BODY = CSS.replace(/\/\*[\s\S]*?\*\//g, '');

function lin(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function lum(c) { return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]); }
function ratio(a, b) { const x = lum(a); const y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
const over = (fg, bg, a) => fg.map((c, i) => c * a + bg[i] * (1 - a));
const hex = (c) => H.parseColor(c).rgb;          // any colour a role resolves to
const CLASSIC = { skin: 'classic', theme: 'dark' };
/** A scope-local custom property, every var() it reads resolved for one skin x theme. */
function token(css, block, name, opts = CLASSIC) {
  return hex(H.scopeVar(css, block, name, opts));
}
function rgba(name, opts = CLASSIC) {               // a translucent layer from the .cms block
  const { rgb, a } = H.parseColor(H.scopeVar(CSS, '.cms {', name, opts));
  return { c: rgb, a };
}
/* The panel renders dusk: every dusk case of every skin. */
const DUSK = H.CASES.filter(([, t]) => t === 'dark');
const tokensFor = (opts) => ({
  bg: hex(H.role('--bg', opts)),
  surface: hex(H.role('--surface', opts)),
  text: hex(H.role('--text', opts)),
  muted: hex(H.role('--muted', opts)),
  dangerText: hex(H.role('--danger-text', opts)),
  success: token(CSS, '.cms {', '--cms-success', opts),
});

describe.each(DUSK)('contrast, composited on the real stack — %s / %s', (skin, theme) => {
  const T = tokensFor({ skin, theme });
  const tinted = (name, base) => { const t = rgba(name, { skin, theme }); return over(t.c, base, t.a); };
  const pairs = [
    ['text on surface', T.text, T.surface],
    ['muted on surface', T.muted, T.surface],
    ['muted on bg', T.muted, T.bg],
    ['saved on green tint', T.success, tinted('--cms-tint-green', T.surface)],
    ['note text on blue tint', T.text, tinted('--cms-tint-blue', T.surface)],
    ['danger-text on red tint', T.dangerText, tinted('--cms-tint-red', T.bg)],
  ];
  it.each(pairs)('%s clears AA', (_, fg, bg) => {
    expect(ratio(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('the sheet', () => {
  it('roots every selector at .cms, and styles.css declares nothing there', () => {
    const selectors = BODY.replace(/@media[^{]*\{/g, '').split('}').map((r) => r.split('{')[0].trim()).filter(Boolean);
    for (const s of selectors) for (const part of s.split(',')) expect(part.trim().startsWith('.cms')).toBe(true);
    expect(/\.cms[\s.{,:-]/.test(GLOBAL_CSS)).toBe(false);
  });
  it('keeps hex literals inside its own token block, and never uses --danger as text', () => {
    const tokenBlock = BODY.slice(BODY.indexOf('.cms {'), BODY.indexOf('}', BODY.indexOf('.cms {')));
    const outside = BODY.replace(tokenBlock, '');
    expect(outside.match(/#[0-9A-Fa-f]{3,6}\b/g)).toBeNull();
    expect(/color:\s*var\(--danger\)/.test(BODY)).toBe(false);
  });
  it('declares every var it uses', () => {
    const used = [...new Set([...BODY.matchAll(/var\((--[\w-]+)\)/g)].map((m) => m[1]))];
    for (const v of used) expect(BODY.includes(`${v}:`) || GLOBAL_CSS.includes(`${v}:`)).toBe(true);
  });
  it('nothing under 12px; rows are 36px', () => {
    for (const m of BODY.matchAll(/--cms-t-[a-z]+:\s*(\d+)px/g)) expect(Number(m[1])).toBeGreaterThanOrEqual(12);
    expect(BODY).toMatch(/--cms-row-h:\s*36px/);
  });
  it('the root declares its own theme', () => {
    expect(JSX).toMatch(/className="cms" data-theme="dark"/);
  });
});
