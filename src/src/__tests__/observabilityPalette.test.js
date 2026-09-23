/**
 * THE OBSERVABILITY PAGE'S CSS CONTRACT — components/ObservabilityPanel.css.
 *
 * jest maps CSS to identity-obj-proxy and jsdom resolves no custom property
 * across files, so the only honest way to pin a design contract here is to read
 * the stylesheet AS TEXT and do the arithmetic on it. The compositing walk
 * below is lifted verbatim from docs/design/admin-redesign/audit.html, which is
 * where every other *Palette test in this repo got it.
 *
 * THE FILE IS NAMED `*Palette` AND NOT `*Token*` ON PURPOSE. `.gitignore:35` is
 * an unanchored `*token*`: a file named observabilityTokens.test.js runs
 * locally, passes, and never reaches CI. Do not rename it.
 *
 * WHAT GREEN MEANS HERE: the contrast arithmetic holds and the geometry rules
 * that jsdom cannot see have not been reverted. It cannot prove the screen is
 * readable on a real panel — only a real panel can.
 */
const fs = require('fs');
const path = require('path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const GLOBAL_CSS = read('styles.css');
const MY_CSS = read('components', 'ObservabilityPanel.css');
const MY_JSX = read('components', 'ObservabilityPanel.jsx');
const SECTIONS = read('config', 'consoleSections.js');

/* ---- colour: lifted verbatim from docs/design/admin-redesign/audit.html ---- */
function lin(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function lum(c) { return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]); }
function ratio(a, b) {
  const la = lum(a); const lb = lum(b);
  const h = Math.max(la, lb); const l = Math.min(la, lb);
  return (h + 0.05) / (l + 0.05);
}
function alphaOver(fg, bg, a) { return fg.map((c, i) => c * a + bg[i] * (1 - a)); }
/* Walk UP compositing every alpha layer. Reading only the element's own
   background is how dark-on-dark passes an audit. */
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
  if (!stack.length) return [15, 26, 46];          // the dusk field
  let out = stack[stack.length - 1][0];
  for (let i = stack.length - 2; i >= 0; i -= 1) out = alphaOver(stack[i][0], out, stack[i][1]);
  return out;
}

/* ---- tokens, READ rather than retyped: change a token and these numbers move */
const parseHex = (h) => [1, 3, 5].map((i) => parseInt(h.substr(i, 2), 16));

function token(css, block, name) {
  const start = css.indexOf(block);
  if (start < 0) throw new Error(`no ${block} block`);
  const body = css.slice(start, css.indexOf('}', start));
  const m = body.match(new RegExp(`${name}\\s*:\\s*(#[0-9A-Fa-f]{6})`));
  if (!m) throw new Error(`${name} not declared in ${block}`);
  return m[1];
}
function tint(name) {                       // an rgba() layer from MY_CSS
  const m = MY_CSS.match(new RegExp(`${name}\\s*:\\s*(rgba\\([^)]*\\))`));
  if (!m) throw new Error(`${name} not declared in ObservabilityPanel.css`);
  return m[1];
}

const ROOT = ':root {';
const DUSK = '[data-theme="dark"] {';
const T = {
  bg: token(GLOBAL_CSS, DUSK, '--bg'),
  surface: token(GLOBAL_CSS, DUSK, '--surface'),
  text: token(GLOBAL_CSS, DUSK, '--text'),
  muted: token(GLOBAL_CSS, DUSK, '--muted'),
  primary: token(GLOBAL_CSS, ROOT, '--primary'),
  danger: token(GLOBAL_CSS, ROOT, '--danger'),
  dangerText: token(GLOBAL_CSS, ROOT, '--danger-text'),
};

/** Build the REAL paint stack in the DOM and hand it to the audit's own bgOf. */
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
const FIELD = [T.bg];              // AdminShell's work body under a dark section
const TILE = [T.bg, T.surface];    // a tile, and the definitions panel

function block(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`(^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`, 'm'));
  if (!match) throw new Error(`No rule for "${selector}" — renamed?`);
  return match[2];
}

const stripped = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/* ========================================================================== */

describe('the flat pairings this screen paints', () => {
  // rejects: any token swap that makes a number unreadable on the surface it
  // is actually painted on — the Question sets tab shipped at 1.4:1 this way.
  const pairs = [
    ['months, category names and counts on the work field', T.text, FIELD],
    ['column heads, captions, dashes and the teams’ row on the work field', T.muted, FIELD],
    ['a tile’s numeral, painted on --surface', T.text, TILE],
    ['a tile’s label and breakdown line', T.muted, TILE],
    ['the definitions’ terms and heading', T.text, TILE],
    ['the definitions themselves', T.muted, TILE],
  ];
  test.each(pairs)('%s clears AA', (_label, fg, layers) => {
    expect(on(fg, layers)).toBeGreaterThanOrEqual(AA);
  });
});

describe('the tinted composites — the half a token table cannot show', () => {
  // rejects: deepening a tint until the text on it drops under AA.
  test('the “could not be read” line, amber on its warn tint', () => {
    expect(on(T.primary, [T.bg, tint('--pobs-tint-warn')])).toBeGreaterThanOrEqual(AA);
  });
  test('a refused load, danger text on its tint', () => {
    expect(on(T.dangerText, [T.bg, tint('--pobs-tint-danger')])).toBeGreaterThanOrEqual(AA);
  });
  test('a hovered row, the quiet teams’ row included', () => {
    expect(on(T.text, [T.bg, tint('--pobs-row-hover')])).toBeGreaterThanOrEqual(AA);
    expect(on(T.muted, [T.bg, tint('--pobs-row-hover')])).toBeGreaterThanOrEqual(AA);
  });
});

describe('the rules that are about what must NOT be there', () => {
  test('--danger never carries text here', () => {
    expect(ratio(parseHex(T.danger), parseHex(T.surface))).toBeLessThan(AA);   // the premise
    const offenders = MY_CSS.split('\n')
      .filter((line) => /(^|[^-])\bcolor\s*:\s*var\(--danger\)/.test(line));
    expect(offenders).toEqual([]);
  });

  // rejects: a literal pasted in from the mockup. Comments are stripped first.
  test('no hex literal anywhere in the stylesheet', () => {
    const literals = [...stripped(MY_CSS).matchAll(/(?:^|[\s:])(#[0-9A-Fa-f]{3,8})\b/g)].map((m) => m[1]);
    expect(literals).toEqual([]);
  });

  test('every custom property the stylesheet uses is declared somewhere', () => {
    const declared = new Set();
    for (const css of [GLOBAL_CSS, MY_CSS, read('components', 'AdminShell.css')]) {
      for (const m of css.matchAll(/(--[a-z0-9-]+)\s*:/gi)) declared.add(m[1]);
    }
    const used = [...MY_CSS.matchAll(/var\((--[a-z0-9-]+)/gi)].map((m) => m[1]);
    expect([...new Set(used)].filter((name) => !declared.has(name))).toEqual([]);
  });

  // rejects: a series colour carrying a number. Values, labels and legends
  // wear text tokens; this page has no series at all yet.
  test('no count is coloured by anything but a text token', () => {
    for (const sel of ['.pobs-tile-value', '.pobs-tbl td', '.pobs-name']) {
      const decl = block(MY_CSS, sel);
      const colour = /(^|[^-])color\s*:\s*([^;]+)/.exec(decl);
      if (colour) expect(colour[2].trim()).toMatch(/^var\(--(text|muted)\)$/);
    }
  });
});

describe('the namespace, both ways', () => {
  const roots = () => {
    const out = new Set();
    for (const blk of stripped(MY_CSS).split('}')) {
      const head = blk.split('{')[0];
      if (!head || head.includes('@')) continue;
      for (const sel of head.split(',')) {
        const m = sel.trim().match(/^[a-zA-Z]*\.([\w-]+)/);
        if (m) out.add(m[1]);
      }
    }
    return [...out];
  };

  test('every selector is rooted at the .pobs scope class', () => {
    expect(roots().length).toBeGreaterThan(10);
    expect(roots().filter((name) => !name.startsWith('pobs'))).toEqual([]);
  });

  test('styles.css declares nothing in this scope', () => {
    const global = [...stripped(GLOBAL_CSS).matchAll(/\.(pobs[\w-]*)/g)].map((m) => m[1]);
    expect([...new Set(global)]).toEqual([]);
  });
});

describe('the ladder', () => {
  const LADDER = { floor: '12px', label: '13px', body: '15px', head: '19px', numeral: '30px' };
  test.each(Object.entries(LADDER))('--pobs-t-%s is %s', (step, value) => {
    expect(MY_CSS).toMatch(new RegExp(`--pobs-t-${step}:\\s*${value}`));
  });

  test('nothing is declared below the 12px floor, and no size bypasses the ladder', () => {
    const px = [...stripped(MY_CSS).matchAll(/font(?:-size)?:[^;]*?(\d+)px/g)].map((m) => Number(m[1]));
    expect(px.filter((n) => n < 12)).toEqual([]);
    expect(px).toEqual([]);   // every size is a var(--pobs-t-*)
  });

  test('rows are 36px, because cards were rejected', () => {
    expect(MY_CSS).toMatch(/--pobs-row-h:\s*36px/);
    expect(block(MY_CSS, '.pobs-tbl td')).toMatch(/height:\s*var\(--pobs-row-h\)/);
  });
});

describe('the geometry contracts jsdom cannot see', () => {
  test('the tables are fixed-layout and the number columns are pinned', () => {
    expect(block(MY_CSS, '.pobs-tbl')).toMatch(/table-layout:\s*fixed/);
    expect(block(MY_CSS, '.pobs-col-num')).toMatch(/width:\s*\d+px/);
    expect(block(MY_CSS, '.pobs-col-lib')).toMatch(/width:\s*\d+px/);
  });

  test('a table scrolls inside its own wrapper, never the page', () => {
    expect(block(MY_CSS, '.pobs-tablewrap')).toMatch(/overflow-x:\s*auto/);
    expect(block(MY_CSS, '.pobs-tbl')).toMatch(/min-width:\s*\d+px/);
  });

  test('cells truncate rather than wrap', () => {
    const td = block(MY_CSS, '.pobs-tbl td');
    expect(td).toMatch(/white-space:\s*nowrap/);
    expect(td).toMatch(/text-overflow:\s*ellipsis/);
    expect(td).toMatch(/overflow:\s*hidden/);
  });

  // rejects: the text-overflow trap — a flex container with span children,
  // where the cut is silent. The breakdown line is one text node with title=.
  test('a tile’s breakdown line can truncate, and carries its whole text in title', () => {
    const sub = block(MY_CSS, '.pobs-tile-sub');
    expect(sub).toMatch(/min-width:\s*0/);
    expect(sub).toMatch(/text-overflow:\s*ellipsis/);
    expect(sub).not.toMatch(/display:\s*flex/);
    expect(MY_JSX).toMatch(/className="pobs-tile-sub" title=\{sub\}/);
  });

  // rejects: justify-content:flex-end on the Refresh row.
  test('Refresh is pushed right by its own margin, not by flex-end', () => {
    expect(block(MY_CSS, '.pobs-btn')).toMatch(/margin-left:\s*auto/);
    expect(block(MY_CSS, '.pobs-bar')).not.toMatch(/justify-content:\s*flex-end/);
  });

  test('numbers are right-aligned in tabular figures', () => {
    expect(block(MY_CSS, '.pobs-tbl .pobs-num')).toMatch(/text-align:\s*right/);
    expect(block(MY_CSS, '.pobs')).toMatch(/font-variant-numeric:\s*tabular-nums/);
  });
});

describe('the theme travels with the markup', () => {
  test('the root element declares data-theme="dark" itself', () => {
    expect(MY_JSX).toMatch(/className="pobs"\s+data-theme="dark"/);
  });

  // rejects: the section mounting on AdminShell's paper work body while the
  // markup is dusk — 1.4:1, the exact defect the Question sets tab shipped with.
  test('the console section asks AdminShell for a dark work body', () => {
    const section = SECTIONS.slice(SECTIONS.indexOf("id: 'observability'"));
    expect(section.slice(0, section.indexOf('}'))).toMatch(/contentTheme:\s*'dark'/);
  });
});
