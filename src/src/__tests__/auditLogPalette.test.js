/**
 * THE CSS CONTRACT FOR THE AUDIT LOG — components/AuditLog.css.
 *
 * Read as text and measured, as privacyPanelPalette.test.js does (jsdom loads
 * no stylesheet and resolves no custom property). The log is drawn on two
 * grounds — the console's --bg inside Data & privacy, and --surface inside the
 * staff dialog — so every text pairing is measured on both.
 *
 * NAMED `*Palette*`, never `*Token*`: .gitignore's unanchored `*token*` would
 * hide the file from git.
 */
const fs = require('fs');
const path = require('path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const GLOBAL_CSS = read('styles.css');
const MY_CSS = read('components', 'AuditLog.css');
const SHELL_CSS = read('components', 'AdminShell.css');

function lin(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function lum(c) { return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]); }
function ratio(a, b) {
  const la = lum(a); const lb = lum(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
const alphaOver = (fg, bg, a) => fg.map((c, i) => c * a + bg[i] * (1 - a));
const parseHex = (h) => [1, 3, 5].map((i) => parseInt(h.substr(i, 2), 16));
const parseRgba = (s) => { const m = s.match(/[\d.]+/g).map(Number); return { rgb: m.slice(0, 3), a: m[3] }; };

function token(css, blockHead, name) {
  const start = css.indexOf(blockHead);
  if (start < 0) throw new Error(`no ${blockHead} block`);
  const body = css.slice(start, css.indexOf('}', start));
  const m = body.match(new RegExp(`${name}\\s*:\\s*(#[0-9A-Fa-f]{6})`));
  if (!m) throw new Error(`${name} not declared in ${blockHead}`);
  return parseHex(m[1]);
}
function tint(name) {
  const m = MY_CSS.match(new RegExp(`${name}\\s*:\\s*(rgba\\([^)]*\\))`));
  if (!m) throw new Error(`${name} not declared in AuditLog.css`);
  return parseRgba(m[1]);
}

const DUSK = '[data-theme="dark"] {';
const ROOT = ':root {';
const T = {
  bg: token(GLOBAL_CSS, DUSK, '--bg'),
  surface: token(GLOBAL_CSS, DUSK, '--surface'),
  text: token(GLOBAL_CSS, DUSK, '--text'),
  muted: token(GLOBAL_CSS, DUSK, '--muted'),
  danger: token(GLOBAL_CSS, ROOT, '--danger'),
  dangerText: token(GLOBAL_CSS, ROOT, '--danger-text'),
};
const AA = 4.5;
const GROUNDS = [['the console field (--bg)', T.bg], ['the staff dialog (--surface)', T.surface]];

describe('every text pairing, on both grounds it is drawn on', () => {
  const inks = [['--text (names, actions, targets)', T.text], ['--muted (roles, reasons, dates)', T.muted], ['--danger-text ("Did not go through")', T.dangerText]];
  for (const [g, ground] of GROUNDS) {
    test.each(inks)(`%s on ${g} clears AA`, (_l, ink) => {
      expect(ratio(ink, ground)).toBeGreaterThanOrEqual(AA);
    });
    // rejects: a hovered row swallowing its own text — a tint is invisible in
    //          a token table.
    test(`a hovered row on ${g}`, () => {
      const h = tint('--alog-row-hover');
      const painted = alphaOver(h.rgb, ground, h.a);
      expect(ratio(T.text, painted)).toBeGreaterThanOrEqual(AA);
      expect(ratio(T.muted, painted)).toBeGreaterThanOrEqual(AA);
    });
  }
});

const stripped = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

describe('the rules the palette depends on', () => {
  test('--danger never carries text here', () => {
    expect(ratio(T.danger, T.surface)).toBeLessThan(AA);
    expect(stripped(MY_CSS)).not.toMatch(/(^|[^-])\bcolor\s*:\s*var\(--danger\)/m);
  });

  test('no hex literal outside the token block', () => {
    const rest = stripped(MY_CSS).replace(/\.alog\s*\{[^}]*\}/, '');
    expect([...rest.matchAll(/(?:^|[\s:])(#[0-9A-Fa-f]{3,8})\b/g)].map((m) => m[1])).toEqual([]);
  });

  test('every custom property used is declared somewhere', () => {
    const declared = new Set();
    for (const css of [GLOBAL_CSS, MY_CSS, SHELL_CSS]) for (const m of css.matchAll(/(--[a-z0-9-]+)\s*:/gi)) declared.add(m[1]);
    const used = [...new Set([...MY_CSS.matchAll(/var\((--[a-z0-9-]+)/gi)].map((m) => m[1]))];
    expect(used.filter((n) => !declared.has(n))).toEqual([]);
  });
});

describe('the namespace, both ways', () => {
  test('every selector is rooted at .alog', () => {
    const roots = new Set();
    for (const blk of stripped(MY_CSS).split('}')) {
      const head = blk.split('{')[0];
      if (!head || head.includes('@')) continue;
      for (const sel of head.split(',')) {
        const m = sel.trim().match(/^[a-zA-Z]*\.([\w-]+)/);
        if (m) roots.add(m[1]);
      }
    }
    expect([...roots].filter((n) => !n.startsWith('alog'))).toEqual([]);
  });
  test('styles.css declares nothing in the .alog scope', () => {
    expect([...stripped(GLOBAL_CSS).matchAll(/\.(alog[\w-]*)/g)].map((m) => m[1])).toEqual([]);
  });
});

function block(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = stripped(css).match(new RegExp(`(^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`, 'm'));
  if (!match) throw new Error(`No rule for "${selector}"`);
  return match[2];
}

describe('the ladder, the density and the geometry jsdom cannot see', () => {
  test.each([['floor', 12], ['label', 13], ['body', 15], ['head', 19]])('--alog-t-%s is %ipx', (step, px) => {
    expect(MY_CSS).toMatch(new RegExp(`--alog-t-${step}:\\s*${px}px`));
  });
  test('nothing below the 12px floor; rows are 36px', () => {
    const px = [...MY_CSS.matchAll(/font-size:\s*(\d+)px/g)].map((m) => Number(m[1]));
    expect(px.filter((n) => n < 12)).toEqual([]);
    expect(MY_CSS).toMatch(/--alog-row-h:\s*36px/);
  });
  // rejects: auto layout, under which a nowrap date grows the table.
  test('the table is fixed-layout, and its columns sum to 100% with and without Organisation', () => {
    expect(block(MY_CSS, '.alog-tbl')).toMatch(/table-layout:\s*fixed/);
    const w = (sel) => Number(block(MY_CSS, sel).match(/width:\s*(\d+)%/)[1]);
    expect(['who', 'what', 'touched', 'when'].map((c) => w(`.alog-col-${c}`)).reduce((a, b) => a + b)).toBe(100);
    expect(['who', 'what', 'touched', 'org', 'when'].map((c) => w(`.alog-tbl--org .alog-col-${c}`)).reduce((a, b) => a + b)).toBe(100);
  });
  // rejects: a reason truncated to an ellipsis — the reason IS the record.
  test('cells wrap, and the modifier out-specifies the base rule', () => {
    expect(block(MY_CSS, '.alog-tbl td')).not.toMatch(/text-overflow:\s*ellipsis/);
    expect(block(MY_CSS, '.alog-tbl td.alog-wrapcell')).toMatch(/white-space:\s*normal/);
  });
  // rejects: the recurring scrim bug.
  test('the dialog scrim scrolls and the card centres with margin: auto', () => {
    const scrim = block(MY_CSS, '.alog-scrim');
    expect(scrim).toMatch(/overflow-y:\s*auto/);
    expect(scrim).toMatch(/align-items:\s*flex-start/);
    expect(scrim).not.toMatch(/align-items:\s*center/);
    expect(block(MY_CSS, '.alog-modal')).toMatch(/margin:\s*auto/);
  });
});
