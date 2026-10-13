/**
 * THE PRESENTATION'S PALETTE — present/present.css (`.present`, dusk).
 *
 * Named *Palette*, never *Token* (.gitignore swallows `*token*`). jsdom loads
 * no stylesheet, so this reads the sheet as text: every pairing the wall
 * paints is composited up its real stack and must clear AA 4.5:1; no orange
 * anywhere (R3: the Presentation has none); no hex outside the scope's own
 * token block; --danger never carries text; every var() is declared; every
 * selector is rooted at `.present` (or the html lock), and styles.css
 * declares nothing there.
 */
const fs = require('fs');
const path = require('path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const GLOBAL_CSS = read('styles.css');
const CSS = read('present', 'present.css');
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const BODY = stripComments(CSS);

function lin(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function lum(c) { return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]); }
function ratio(a, b) { const la = lum(a); const lb = lum(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); }
const parseHex = (h) => [1, 3, 5].map((i) => parseInt(h.substr(i, 2), 16));
function parseColor(c) {
  if (c.startsWith('#')) return [parseHex(c), 1];
  const m = c.match(/[\d.]+/g).map(Number);
  return [m.slice(0, 3), m.length > 3 ? m[3] : 1];
}
function composite(layers) {
  let out = null;
  for (const l of layers) {
    const [rgb, a] = parseColor(l);
    out = out ? rgb.map((c, i) => c * a + out[i] * (1 - a)) : rgb;
  }
  return out;
}
const on = (fg, layers) => ratio(parseHex(fg), composite(layers));
const AA = 4.5;

function token(css, block, name) {
  const start = css.indexOf(block);
  if (start < 0) throw new Error(`no ${block} block`);
  const body = css.slice(start, css.indexOf('}', start));
  const m = body.match(new RegExp(`${name}\\s*:\\s*(#[0-9A-Fa-f]{6}|rgba\\([^)]*\\))`));
  if (!m) throw new Error(`${name} not declared in ${block}`);
  return m[1];
}
const ROOT = ':root {';
const DUSK = '[data-theme="dark"] {';
const SCOPE = '.present {';

const D = {
  bg: token(GLOBAL_CSS, DUSK, '--bg'),
  surface: token(GLOBAL_CSS, DUSK, '--surface'),
  surface2: token(GLOBAL_CSS, DUSK, '--surface-2'),
  text: token(GLOBAL_CSS, DUSK, '--text'),
  muted: token(GLOBAL_CSS, DUSK, '--muted'),
  secondary: token(GLOBAL_CSS, ROOT, '--secondary'),
  quote: token(CSS, SCOPE, '--present-quote'),
  mini: token(CSS, SCOPE, '--present-mini'),
  glow: token(CSS, SCOPE, '--present-glow'),
};

describe('present.css: contrast, composited', () => {
  const FIELD = [D.bg];
  const GLOW = [D.glow];          // the brightest point of the radial field
  const CARD = [D.bg, D.surface];
  const MINI = [D.bg, D.mini];
  it.each([
    ['text on the field', D.text, FIELD],
    ['muted on the field', D.muted, FIELD],
    ['eyebrow (secondary) on the field', D.secondary, FIELD],
    ['muted at the glow', D.muted, GLOW],
    ['secondary at the glow', D.secondary, GLOW],
    ['text on the response card', D.text, CARD],
    ['muted on the response card', D.muted, CARD],
    ['muted on a mini card', D.muted, MINI],
    ['a quote in the read', D.quote, FIELD],
    ['the badge number (bg on secondary)', D.bg, [D.secondary]],
  ])('%s clears AA', (_label, fg, layers) => {
    expect(on(fg, layers)).toBeGreaterThanOrEqual(AA);
  });
});

describe('present.css: house rules', () => {
  it('has no orange: no --primary, --primary-deep or --gold', () => {
    expect(BODY).not.toMatch(/var\(--primary/);
    expect(BODY).not.toMatch(/var\(--gold\)/);
  });
  it('never colours text with --danger', () => {
    expect(BODY).not.toMatch(/(^|[^-])color:\s*var\(--danger\)/m);
  });
  it('keeps hex literals in the scope token block and the html lock only', () => {
    const scopeStart = BODY.indexOf(SCOPE);
    const scopeEnd = BODY.indexOf('}', scopeStart);
    const lockEnd = BODY.indexOf('}', BODY.indexOf('html.present-locked'));
    const outside = BODY.slice(lockEnd + 1, scopeStart) + BODY.slice(scopeEnd + 1);
    expect(outside.match(/#[0-9A-Fa-f]{3,6}\b/g) || []).toEqual([]);
  });
  it('declares every var() it uses', () => {
    const used = new Set((BODY.match(/var\((--[\w-]+)/g) || []).map((v) => v.slice(4)));
    const declared = new Set([...(BODY + GLOBAL_CSS).matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
    // Set inline by PresentStage (the scale) and the track (the marker), each
    // with a fallback in the var() itself.
    const INLINE = ['--present-x', '--present-y', '--present-scale', '--at'];
    INLINE.forEach((v) => expect(BODY).toMatch(new RegExp(`var\\(${v},`)));
    const missing = [...used].filter((v) => !declared.has(v) && !INLINE.includes(v));
    expect(missing).toEqual([]);
  });
  it('roots every selector at .present (or the html lock)', () => {
    const rules = BODY.replace(/@keyframes[\s\S]*?\}\s*\}/g, '').match(/[^{}]+\{/g) || [];
    const selectors = rules
      .map((r) => r.slice(0, -1).trim())
      .filter((s) => s && !s.startsWith('@'))
      .flatMap((s) => s.split(',').map((x) => x.trim()));
    const stray = selectors.filter((s) => !/^(\.present\b|html\.present-locked\b)/.test(s));
    expect(stray).toEqual([]);
  });
  it('styles.css declares nothing in the .present scope', () => {
    expect(stripComments(GLOBAL_CSS)).not.toMatch(/\.present[\s.{:[]/);
  });
});
