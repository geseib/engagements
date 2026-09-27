/**
 * components/event/HostEventAgenda.css — the CSS contract of the host's agenda
 * page (27 Sep 2026: a host builds an agenda without the console). Read as
 * text: jsdom resolves no custom property and has no layout engine.
 *
 * rejects: a head or button below AA on the dusk field; a raw colour outside
 * the scope's token block; `--danger` carrying text; a selector outside `.hea`
 * or a `.hea` that styles.css also declares; anything under the 12px floor; a
 * ground for the builder that is not the console's work field; the theme left
 * to inherit from <html data-theme="light">.
 */
const fs = require('fs');
const path = require('path');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const CSS = read('components/event/HostEventAgenda.css');
const JSX = read('components/event/HostEventAgenda.jsx');
const STYLES = read('styles.css');
const stripped = CSS.replace(/\/\*[\s\S]*?\*\//g, '');

function lin(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function lum([r, g, b]) { return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b); }
function ratio(a, b) { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); }
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const token = (name) => {
  const m = new RegExp(`${name}:\\s*(#[0-9A-Fa-f]{6})`).exec(STYLES);
  if (!m) throw new Error(`${name} is not declared in styles.css`);
  return hex(m[1]);
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

const BG = token('--bg');
const TEXT = token('--text');
const MUTED = token('--muted');
const PRIMARY = token('--primary');

describe('contrast on the dusk field', () => {
  test('the title, the kicker and the ghost buttons clear AA on --bg', () => {
    expect(ratio(TEXT, BG)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(MUTED, BG)).toBeGreaterThanOrEqual(4.5);
  });
  test('the filled button\'s ink is a declared local and clears AA on --primary', () => {
    expect(ratio(local('--hea-on-accent'), PRIMARY)).toBeGreaterThanOrEqual(4.5);
    expect(block('.hea .hea-btn--primary')).toMatch(/color:\s*var\(--hea-on-accent\)/);
  });
  test('--danger never carries text', () => {
    expect(stripped).not.toMatch(/(^|[^-])color:\s*var\(--danger\)/m);
  });
});

describe('the scope', () => {
  test('every selector is rooted at .hea, and styles.css declares nothing in it', () => {
    const selectors = [...stripped.matchAll(/([^{}]+)\{/g)].map((m) => m[1].trim()).filter(Boolean);
    for (const group of selectors) {
      for (const sel of group.split(',').map((x) => x.trim()).filter(Boolean)) {
        expect(sel.startsWith('.hea')).toBe(true);
      }
    }
    expect(STYLES).not.toMatch(/\.hea[\s.{:-]/);
  });
  test('no raw colour outside the scope\'s token block', () => {
    const root = block('.hea');
    const rest = stripped.replace(root, '');
    expect(rest).not.toMatch(/#[0-9A-Fa-f]{3,6}\b/);
    expect(rest).not.toMatch(/rgba?\(/);
  });
  test('nothing under the 12px floor', () => {
    for (const m of stripped.matchAll(/--hea-t-[a-z]+:\s*(\d+)px/g)) expect(Number(m[1])).toBeGreaterThanOrEqual(12);
  });
  test('the page declares dusk on its root rather than inheriting paper', () => {
    expect(JSX).toMatch(/className="hea" data-theme="dark"/);
  });
  test('the builder stands on the console\'s own work field: --bg, 14px 20px 40px', () => {
    expect(block('.hea')).toMatch(/background:\s*var\(--bg\)/);
    expect(block('.hea .hea-body')).toMatch(/padding:\s*14px 20px 40px/);
  });
});
