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
const STYLES = require('../testing/classicGlobalCss')();
const stripped = CSS.replace(/\/\*[\s\S]*?\*\//g, '');

const H = require('../testing/skinHarness');

const block = (sel) => {
  const i = stripped.indexOf(`${sel} {`);
  if (i === -1) throw new Error(`${sel} not found`);
  return stripped.slice(i, stripped.indexOf('}', i));
};

/* Resolved per skin through the harness (skins -> roles -> the .hea block). The page
   declares dusk on its own root (asserted below), so every case is the dark theme. */
describe.each(H.SKINS)('contrast on the dusk field (%s)', (skin) => {
  const r = (name) => H.role(name, { skin, theme: 'dark' });
  const local = (name) => H.scopeVar(CSS, '.hea {', name, { skin, theme: 'dark' });
  test('the title, the kicker and the ghost buttons clear AA on --bg', () => {
    expect(H.ratio(r('--text'), r('--bg'))).toBeGreaterThanOrEqual(H.AA);
    expect(H.ratio(r('--muted'), r('--bg'))).toBeGreaterThanOrEqual(H.AA);
  });
  test('the filled button\'s ink is a declared local and clears AA on --primary', () => {
    expect(H.ratio(local('--hea-on-accent'), r('--primary'))).toBeGreaterThanOrEqual(H.AA);
    expect(block('.hea .hea-btn--primary')).toMatch(/color:\s*var\(--hea-on-accent\)/);
  });
  test('--danger never carries text', () => {
    expect(stripped).not.toMatch(/(^|[^-])color:\s*var\(--danger\)/m);
  });
});

test('Classic is unchanged: the re-pointed --hea-* tokens resolve to their pre-skin literals', () => {
  const lit = (name) => H.parseColor(H.scopeVar(CSS, '.hea {', name, { skin: 'classic', theme: 'dark' }));
  expect(lit('--hea-on-accent')).toEqual(H.parseColor('#0F1A2E'));
  expect(lit('--hea-rule')).toEqual(H.parseColor('rgba(155, 168, 190, .20)'));
  expect(lit('--hea-rule-strong')).toEqual(H.parseColor('rgba(155, 168, 190, .34)'));
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
