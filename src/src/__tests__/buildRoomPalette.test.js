/**
 * THE BUILD ROOM'S DESIGN CONTRACT — buildroom/BuildRoom.css (`.brm`, dusk)
 * and buildroom/BuildReport.css (`.brr`, paper).
 *
 * Named *Palette*, never *Token*: .gitignore carries an unanchored `*token*`,
 * and a file named for tokens would pass here and never reach CI.
 *
 * jsdom loads no stylesheet and resolves no custom property, so this reads
 * both sheets as text and does the arithmetic: every pairing either surface
 * paints is composited up its real ancestor stack (the audit's own bgOf) and
 * must clear AA 4.5:1, tints included. Then the house rules: no hex outside
 * the token block, --danger never carries text, every var() is declared,
 * every selector is rooted in its scope and styles.css declares nothing
 * there, the ladder, the 12px floor, 36px rows, and the dialog scrim that
 * scrolls instead of centring.
 *
 * Green here means "the contract has not been reverted", not "this reads well
 * on a projector": only a real room can say that.
 */
const fs = require('fs');
const path = require('path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const GLOBAL_CSS = read('styles.css');
// The stage's ladders (--t-*), loaded app-wide by index.jsx: the Build Room's
// Stage screen sizes its ask from them, as the regular stage does.
const STAGE_CSS = read('styles', 'stage.css');
const ROOM_CSS = read('buildroom', 'BuildRoom.css');
const REPORT_CSS = read('buildroom', 'BuildReport.css');

/* ---- colour: lifted from docs/design/admin-redesign/audit.html ---- */
function lin(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function lum(c) { return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]); }
function ratio(a, b) {
  const la = lum(a); const lb = lum(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
function alphaOver(fg, bg, a) { return fg.map((c, i) => c * a + bg[i] * (1 - a)); }
function bgOf(el, win) {
  let node = el; const stack = [];
  while (node && node.nodeType === 1) {
    const c = win.getComputedStyle(node).backgroundColor;
    const m = String(c).match(/[\d.]+/g);
    if (m) {
      const a = m.length > 3 ? parseFloat(m[3]) : 1;
      if (a > 0) { stack.push([m.slice(0, 3).map(Number), a]); if (a >= 0.999) break; }
    }
    node = node.parentElement;
  }
  if (!stack.length) return [15, 26, 46];
  let out = stack[stack.length - 1][0];
  for (let i = stack.length - 2; i >= 0; i -= 1) out = alphaOver(stack[i][0], out, stack[i][1]);
  return out;
}

const parseHex = (h) => [1, 3, 5].map((i) => parseInt(h.substr(i, 2), 16));
function token(css, block, name) {
  const start = css.indexOf(block);
  if (start < 0) throw new Error(`no ${block} block`);
  const body = css.slice(start, css.indexOf('}', start));
  const m = body.match(new RegExp(`${name}\\s*:\\s*(#[0-9A-Fa-f]{6})`));
  if (!m) throw new Error(`${name} not declared in ${block}`);
  return m[1];
}
function tint(css, name) {
  const m = css.match(new RegExp(`${name}\\s*:\\s*(rgba\\([^)]*\\))`));
  if (!m) throw new Error(`${name} not declared`);
  return m[1];
}
function composited(layers) {
  document.body.innerHTML = '';
  let host = document.body;
  for (const background of layers) {
    const el = document.createElement('div');
    el.style.backgroundColor = background;
    host.appendChild(el);
    host = el;
  }
  return bgOf(host, window);
}
const on = (fgHex, layers) => ratio(parseHex(fgHex), composited(layers));
const AA = 4.5;

const ROOT = ':root {';
const DUSK = '[data-theme="dark"] {';
const PAPER = '[data-theme="light"] {';
const ROOM = '.brm {';
const REPORT = '.brr {';

const D = {
  bg: token(GLOBAL_CSS, DUSK, '--bg'),
  surface: token(GLOBAL_CSS, DUSK, '--surface'),
  surface2: token(GLOBAL_CSS, DUSK, '--surface-2'),
  text: token(GLOBAL_CSS, DUSK, '--text'),
  muted: token(GLOBAL_CSS, DUSK, '--muted'),
  primary: token(GLOBAL_CSS, ROOT, '--primary'),
  secondary: token(GLOBAL_CSS, ROOT, '--secondary'),
  success: token(GLOBAL_CSS, ROOT, '--success'),
  danger: token(GLOBAL_CSS, ROOT, '--danger'),
  dangerText: token(GLOBAL_CSS, ROOT, '--danger-text'),
  dangerDeep: token(GLOBAL_CSS, ROOT, '--danger-deep'),
  successText: token(ROOM_CSS, ROOM, '--brm-success-text'),
  term: token(ROOM_CSS, ROOM, '--brm-term'),
  termText: token(ROOM_CSS, ROOM, '--brm-term-text'),
};
const P = {
  bg: token(GLOBAL_CSS, PAPER, '--bg'),
  surface: token(GLOBAL_CSS, PAPER, '--surface'),
  surface2: token(GLOBAL_CSS, PAPER, '--surface-2'),
  text: token(GLOBAL_CSS, PAPER, '--text'),
  muted: token(GLOBAL_CSS, PAPER, '--muted'),
  amber: token(REPORT_CSS, REPORT, '--brr-amber'),
  link: token(REPORT_CSS, REPORT, '--brr-link'),
  desk: token(REPORT_CSS, REPORT, '--brr-desk'),
};
const rt = (name) => tint(ROOM_CSS, name);

describe('the room (dusk): flat pairings', () => {
  const FIELD = [D.bg];
  const PANEL = [D.bg, D.surface];
  const pairs = [
    ['--text on the field (the question, the ticker)', D.text, FIELD],
    ['--text on a panel (rows, timeline, dialogs)', D.text, PANEL],
    ['--text on --surface-2 (buttons, notices, step numbers)', D.text, [D.bg, D.surface2]],
    ['--muted on the field (hints, eyebrow, counts)', D.muted, FIELD],
    ['--muted on a panel (labels, times, names)', D.muted, PANEL],
    ['--primary on the field (join code, big letter A)', D.primary, FIELD],
    ['--primary on a panel (choice A, kind, code in the bar)', D.primary, PANEL],
    ['--secondary on a panel (choice B, Claude on the timeline, links)', D.secondary, PANEL],
    ['--secondary on the field (ticker kind, links)', D.secondary, FIELD],
    ['success text on a panel (choice C, "Room said")', D.successText, PANEL],
    ['--danger-text on a panel (Discard, Delete)', D.dangerText, PANEL],
    ['--danger-text on the field (the inbox Dismiss)', D.dangerText, FIELD],
    ['--bg on --primary (the filled button, letter A)', D.bg, [D.primary]],
    ['--bg on --secondary (letter B)', D.bg, [D.secondary]],
    ['--bg on --success (letter C, a done step)', D.bg, [D.success]],
    ['--text on --danger-deep (End session)', D.text, [D.dangerDeep]],
    ['terminal text on the command block', D.termText, [D.term]],
  ];
  test.each(pairs)('%s clears AA', (_l, fg, layers) => {
    expect(on(fg, layers)).toBeGreaterThanOrEqual(AA);
  });
});

describe('the room (dusk): tinted composites', () => {
  const cases = [
    ['amber chip on a panel', D.primary, [D.bg, D.surface, rt('--brm-tint-amber')]],
    ['amber chip in the asks table', D.primary, [D.bg, D.surface, rt('--brm-tint-amber')]],
    ['live chip (green) on a panel', D.successText, [D.bg, D.surface, rt('--brm-tint-green')]],
    ['connected chip (blue) in the header bar', D.secondary, [D.bg, D.surface, rt('--brm-tint-blue')]],
    ['a folded chip (blue) in the decide panel', D.secondary, [D.bg, D.surface, rt('--brm-tint-blue')]],
    ['error text on the field', D.dangerText, [D.bg, rt('--brm-tint-red')]],
    ['error text inside a dialog', D.dangerText, [D.bg, D.surface, rt('--brm-tint-red')]],
    ['latest decision text on the field', D.text, [D.bg, rt('--brm-tint-amber-soft')]],
    ['latest decision kind on the field', D.primary, [D.bg, rt('--brm-tint-amber-soft')]],
    ['the current row in the asks table', D.text, [D.bg, D.surface, rt('--brm-tint-amber-soft')]],
    ['the current row number', D.muted, [D.bg, D.surface, rt('--brm-tint-amber-soft')]],
    ['the key warning in the Connect dialog', D.text, [D.bg, D.surface, rt('--brm-tint-amber-soft')]],
    ['the key warning lead', D.primary, [D.bg, D.surface, rt('--brm-tint-amber-soft')]],
    ['the selected kind in Ask the room', D.primary, [D.bg, D.surface, rt('--brm-tint-amber')]],
  ];
  test.each(cases)('%s clears AA', (_l, fg, layers) => {
    expect(on(fg, layers)).toBeGreaterThanOrEqual(AA);
  });
});

describe('the report (paper)', () => {
  const SHEET = [P.surface];
  const pairs = [
    ['--text on the sheet', P.text, SHEET],
    ['--muted on the sheet (meta, times, counts)', P.muted, SHEET],
    ['the people chips: --text on --surface-2', P.text, [P.surface2]],
    ['--muted on --surface-2 (counts beside a bar)', P.muted, [P.surface2]],
    ['amber on the sheet (the Goal label)', P.amber, SHEET],
    ['amber on --surface-2 (the Direction label)', P.amber, [P.surface2]],
    ['--text on --surface-2 (the direction)', P.text, [P.surface2]],
    ['a link on the sheet', P.link, SHEET],
    ['the filled Print button', P.surface, [P.text]],
    ['the ghost Back button on the desk', P.text, [P.desk]],
  ];
  test.each(pairs)('%s clears AA', (_l, fg, layers) => {
    expect(on(fg, layers)).toBeGreaterThanOrEqual(AA);
  });

  test('--primary cannot carry text on paper, which is why the report has its own amber', () => {
    expect(ratio(parseHex(D.primary), parseHex(P.surface))).toBeLessThan(AA);
    expect(REPORT_CSS.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/var\(--primary\)/);
  });
});

const stripped = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

describe.each([
  ['BuildRoom.css', ROOM_CSS, 'brm', ROOM],
  ['BuildReport.css', REPORT_CSS, 'brr', REPORT],
])('%s house rules', (_file, CSS, scope, block) => {
  test('no hex literal survives outside the token block', () => {
    const start = CSS.indexOf(block);
    const declarations = stripped(CSS.slice(0, start) + CSS.slice(CSS.indexOf('}', start) + 1));
    const literals = [...declarations.matchAll(/(?:^|[\s:,(])(#[0-9A-Fa-f]{3,8})\b/g)].map((m) => m[1]);
    expect(literals).toEqual([]);
  });

  test('--danger never carries text', () => {
    expect(ratio(parseHex(D.danger), parseHex(D.surface))).toBeLessThan(AA);
    const offenders = CSS.split('\n').filter((l) => /(^|[^-])\bcolor\s*:\s*var\(--danger\)/.test(l));
    expect(offenders).toEqual([]);
  });

  test('every custom property used is declared somewhere', () => {
    const declared = new Set();
    for (const css of [GLOBAL_CSS, STAGE_CSS, CSS]) {
      for (const m of css.matchAll(/(--[a-z0-9-]+)\s*:/gi)) declared.add(m[1]);
    }
    const used = [...CSS.matchAll(/var\((--[a-z0-9-]+)/gi)].map((m) => m[1]);
    expect([...new Set(used)].filter((n) => !declared.has(n))).toEqual([]);
  });

  test('every selector is rooted at the scope class', () => {
    const out = new Set();
    for (const blk of stripped(CSS).split('}')) {
      const head = blk.split('{')[0];
      if (!head || head.includes('@')) continue;
      for (const sel of head.split(',')) {
        const s = sel.trim();
        if (!s || /^\d+%$/.test(s)) continue;
        const m = s.match(/^\.([\w-]+)/);
        out.add(m ? m[1] : s);
      }
    }
    expect([...out].filter((n) => n !== scope && !n.startsWith(`${scope}.`))).toEqual([]);
  });

  test('styles.css declares nothing in this scope', () => {
    const global = [...stripped(GLOBAL_CSS).matchAll(new RegExp(`\\.(${scope}[\\w-]*)`, 'g'))].map((m) => m[1]);
    expect([...new Set(global)]).toEqual([]);
  });

  test.each([['floor', '12px'], ['label', '13px'], ['body', '15px'], ['head', '19px'], ['title', '24px'], ['num', '30px']])(
    'the ladder: --%s-t-%s',
    (step, value) => {
      expect(CSS).toMatch(new RegExp(`--${scope}-t-${step}:\\s*${value}`));
    },
  );

  test('nothing is declared below the 12px floor', () => {
    const px = [...CSS.matchAll(/font(?:-size)?:[^;]*?(\d+)px/g)].map((m) => Number(m[1]));
    expect(px.filter((n) => n < 12)).toEqual([]);
  });
});

describe('BuildRoom.css geometry contracts', () => {
  function block(css, selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = css.match(new RegExp(`(^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`, 'm'));
    if (!match) throw new Error(`No rule for "${selector}"`);
    return match[2];
  }

  test('rows are 36px', () => {
    expect(ROOM_CSS).toMatch(/--brm-row-h:\s*36px/);
  });

  test('inputs render at body size, never at label size', () => {
    expect(block(ROOM_CSS, '.brm .brm-input')).toMatch(/var\(--brm-t-body\)/);
  });

  test('the dialog scrim scrolls and does not centre with the flex container', () => {
    const scrim = block(ROOM_CSS, '.brm .brm-scrim');
    expect(scrim).toMatch(/overflow-y:\s*auto/);
    expect(scrim).toMatch(/align-items:\s*flex-start/);
    expect(scrim).not.toMatch(/align-items:\s*center/);
    expect(scrim).toMatch(/padding:\s*\S+/);
    expect(ROOM_CSS).toMatch(/\.brm \.brm-scrim\s*>\s*\*\s*\{[^}]*margin:\s*auto/);
  });

  test('tables are table-layout: fixed', () => {
    expect(block(ROOM_CSS, '.brm .brm-tbl')).toMatch(/table-layout:\s*fixed/);
    expect(block(REPORT_CSS, '.brr .brr-tbl')).toMatch(/table-layout:\s*fixed/);
  });

  test('a phone gets one column', () => {
    expect(ROOM_CSS).toMatch(/@media \(max-width: 900px\)[\s\S]*?\.brm \.brm-grid[^{]*\{\s*grid-template-columns:\s*minmax\(0, 1fr\)/);
  });

  test('the report hides its toolbar when printed', () => {
    expect(REPORT_CSS).toMatch(/@media print[\s\S]*?\.brr \.brr-printbar\s*\{\s*display:\s*none/);
  });
});

describe('the themes are declared on the roots', () => {
  const page = read('buildroom', 'BuildRoomPage.jsx');
  const report = read('buildroom', 'BuildReport.jsx');
  test('every .brm root is dusk', () => {
    const roots = [...page.matchAll(/className=\{?[`"]brm brm[^"`]*[`"]\}?\s+data-theme="(\w+)"/g)].map((m) => m[1]);
    expect(roots.length).toBeGreaterThanOrEqual(3);
    expect(new Set(roots)).toEqual(new Set(['dark']));
  });
  test('the report root is paper', () => {
    expect(report).toMatch(/className="brr" data-theme="light"/);
  });
});
