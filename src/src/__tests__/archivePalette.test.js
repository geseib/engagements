/**
 * THE ARCHIVE SCREEN'S DESIGN CONTRACT — components/ArchivePanel.css, read as text.
 *
 * jsdom loads no stylesheet and resolves no custom property, so the only honest way to
 * pin a design contract here is to read the sheet and do arithmetic on it: every pairing
 * the screen paints is composited up the real ancestor stack and asserted ≥ AA, the way
 * questionSetsPalette.test.js does for the screen this one is modelled on.
 *
 * It also pins the two halves of the conversion that must land TOGETHER: the section
 * declares `contentTheme: 'dark'` (or the dusk markup renders on AdminShell's paper patch)
 * and styles.css no longer declares the paper-era `.archive-*` card rules (or two
 * stylesheets fight over one screen). Either half alone is the 1.4:1 defect.
 */
const fs = require('fs');
const path = require('path');
const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const GLOBAL_CSS = read('styles.css');
const CSS = read('components', 'ArchivePanel.css');

/* ---- colour: lifted verbatim from docs/design/admin-redesign/audit.html ---- */
function lin(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function lum(c) { return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]); }
function ratio(a, b) {
  const la = lum(a); const lb = lum(b);
  const h = Math.max(la, lb); const l = Math.min(la, lb);
  return (h + 0.05) / (l + 0.05);
}
const alphaOver = (fg, bg, a) => fg.map((c, i) => c * a + bg[i] * (1 - a));
const parseHex = (h) => [1, 3, 5].map((i) => parseInt(h.substr(i, 2), 16));
const parseRgba = (s) => { const m = String(s).match(/[\d.]+/g).map(Number); return { rgb: m.slice(0, 3), a: m.length > 3 ? m[3] : 1 }; };
function token(css, block, name) {
  const start = css.indexOf(block);
  if (start < 0) throw new Error(`no ${block} block`);
  const body = css.slice(start, css.indexOf('}', start));
  const m = body.match(new RegExp(`${name}\\s*:\\s*(#[0-9A-Fa-f]{6})`));
  if (!m) throw new Error(`${name} not declared in ${block}`);
  return m[1];
}
function tint(name) {
  const m = CSS.match(new RegExp(`${name}\\s*:\\s*(rgba\\([^)]*\\))`));
  if (!m) throw new Error(`${name} not declared in ArchivePanel.css`);
  return m[1];
}
const ROOT = ':root {';
const DUSK = '[data-theme="dark"] {';
const T = {
  bg: parseHex(token(GLOBAL_CSS, DUSK, '--bg')),
  surface: parseHex(token(GLOBAL_CSS, DUSK, '--surface')),
  text: parseHex(token(GLOBAL_CSS, DUSK, '--text')),
  muted: parseHex(token(GLOBAL_CSS, DUSK, '--muted')),
  primary: parseHex(token(GLOBAL_CSS, ROOT, '--primary')),
  secondary: parseHex(token(GLOBAL_CSS, ROOT, '--secondary')),
  dangerText: parseHex(token(GLOBAL_CSS, ROOT, '--danger-text')),
  dangerDeep: parseHex(token(GLOBAL_CSS, ROOT, '--danger-deep')),
  successText: parseHex(token(CSS, '.arch {', '--arch-success-text')),
};
/** Composite a stack of layers (hex or rgba strings) bottom-up onto the dusk field. */
function composited(layers) {
  let out = T.bg;
  for (const layer of layers) {
    const { rgb, a } = layer.startsWith('#') ? { rgb: parseHex(layer), a: 1 } : parseRgba(layer);
    out = alphaOver(rgb, out, a);
  }
  return out;
}
const AA = 4.5;
const FIELD = [];
const PANEL = ['#1B2942'];

describe('the flat pairings this screen paints', () => {
  test.each([
    ['--text on the work field (titles, row values)', T.text, FIELD],
    ['--muted on the work field (sub-lines, dates, column heads)', T.muted, FIELD],
    ['--text on --surface (dialogs, the import panel)', T.text, PANEL],
    ['--muted on --surface', T.muted, PANEL],
    ['--primary on the work field (links, the prod chip)', T.primary, FIELD],
    ['--secondary on the work field (the test chip)', T.secondary, FIELD],
    ['--arch-success-text on the work field (the dev chip)', T.successText, FIELD],
    ['--danger-text on the work field (Delete, the outage heading)', T.dangerText, FIELD],
    ['--danger-text on --surface (the delete dialog)', T.dangerText, PANEL],
    ['--bg on --primary (the filled Import / Restore)', T.bg, ['#F6A94C']],
    ['--text on --danger-deep (the filled Delete the backup)', T.text, ['#B03A34']],
  ])('%s clears AA', (_label, fg, layers) => {
    expect(ratio(fg, composited(layers))).toBeGreaterThanOrEqual(AA);
  });
});

describe('the tinted composites, which a token table cannot see', () => {
  test.each([
    ['--danger-text on the outage tint', T.dangerText, [tint('--arch-tint-danger')]],
    ['--text on the outage tint', T.text, [tint('--arch-tint-danger')]],
    ['--arch-success-text on the success tint (alerts, the restore report)', T.successText, [tint('--arch-tint-ok')]],
    ['--text on the success tint (the restore report lines)', T.text, [tint('--arch-tint-ok')]],
    ['--text on a selected row', T.text, [tint('--arch-tint-warn')]],
    ['--muted on a selected row', T.muted, [tint('--arch-tint-warn')]],
    ['--muted on a hovered row', T.muted, [tint('--arch-row-hover')]],
  ])('%s clears AA', (_label, fg, layers) => {
    expect(ratio(fg, composited(layers))).toBeGreaterThanOrEqual(AA);
  });
});

describe('the sheet keeps the rules', () => {
  const stripped = CSS.replace(/\/\*[\s\S]*?\*\//g, ' ');
  const tokenBlockStart = stripped.indexOf('.arch {');
  const tokenBlock = stripped.slice(tokenBlockStart, stripped.indexOf('}', tokenBlockStart));
  const outside = stripped.replace(tokenBlock, '');

  test('every selector is rooted at .arch', () => {
    const offenders = [];
    for (const m of stripped.matchAll(/(^|\})\s*([^{}@]+)\{/g)) {
      for (const part of m[2].split(',')) {
        const sel = part.trim();
        if (sel && !/^\.arch(\b|-)/.test(sel)) offenders.push(sel);
      }
    }
    expect(offenders).toEqual([]);
  });
  test('no hex literal outside the token block, except the two hover fills and the two filled buttons the sets screen also paints', () => {
    const allowed = new Set(['#FFBB66', '#1B2942', '#F6A94C', '#B03A34']);
    const hexes = (outside.match(/#[0-9A-Fa-f]{6}\b/g) || []).filter((h) => !allowed.has(h.toUpperCase()) && !allowed.has(h));
    expect(hexes).toEqual([]);
  });
  test('--danger never carries text', () => {
    expect(stripped).not.toMatch(/color:\s*var\(--danger\)/);
  });
  test('every custom property the sheet reads is declared, here or in styles.css', () => {
    const declared = new Set([...stripped.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
    const globals = new Set([...GLOBAL_CSS.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
    const used = new Set([...stripped.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]));
    const missing = [...used].filter((v) => !declared.has(v) && !globals.has(v));
    expect(missing).toEqual([]);
  });
  test('nothing sits below the 12px floor, and rows are 36px', () => {
    for (const m of stripped.matchAll(/font-size:\s*(\d+)px/g)) expect(Number(m[1])).toBeGreaterThanOrEqual(12);
    expect(stripped).toMatch(/--arch-t-floor:\s*12px/);
    expect(stripped).toMatch(/--arch-row-h:\s*36px/);
  });
  test('the table is table-layout: fixed', () => {
    expect(stripped).toMatch(/\.arch-tbl\s*\{[^}]*table-layout:\s*fixed/);
  });
  test('the scrim scrolls and does not centre with the flex container', () => {
    const scrim = stripped.slice(stripped.indexOf('.arch-scrim {'), stripped.indexOf('}', stripped.indexOf('.arch-scrim {')));
    expect(scrim).toMatch(/align-items:\s*flex-start/);
    expect(scrim).toMatch(/overflow-y:\s*auto/);
    expect(scrim).not.toMatch(/place-items:\s*center/);
  });
});

describe('the two halves of the conversion landed together', () => {
  test('styles.css declares nothing in the .arch scope', () => {
    expect(GLOBAL_CSS).not.toMatch(/\.arch(\b|-)/);
  });
  test('styles.css no longer carries the paper-era archive card grid', () => {
    expect(GLOBAL_CSS).not.toMatch(/\.archive-(panel|grid|item|header|filters|tabs|report|note)\b/);
  });
  test('the archive section renders dusk', () => {
    const sections = read('config', 'consoleSections.js');
    const start = sections.indexOf('archive: {');
    const block = sections.slice(start, sections.indexOf('},', start));
    expect(block).toMatch(/contentTheme:\s*'dark'/);
  });
  test('AdminPage mounts the archive without the paper .tab-content wrapper', () => {
    const page = read('AdminPage.jsx');
    const at = page.indexOf('<ArchivePanel');
    const before = page.slice(Math.max(0, at - 200), at);
    expect(before).not.toMatch(/className="tab-content"/);
  });
});
