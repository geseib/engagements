/**
 * THE PLATFORM ORGANISATION LIST'S CSS CONTRACT — components/PlatformOrgsPanel.css.
 *
 * jest maps CSS to identity-obj-proxy and jsdom resolves no custom property
 * across files, so the only honest way to pin a design contract here is to read
 * the stylesheet AS TEXT and do the arithmetic on it. The compositing walk
 * below is lifted verbatim from docs/design/admin-redesign/audit.html, which is
 * where every other *Palette test in this repo got it.
 *
 * THE FILE IS NAMED `*Palette` AND NOT `*Token*` ON PURPOSE. `.gitignore:35` is
 * an unanchored `*token*`: a file named platformOrgsTokens.test.js runs locally,
 * passes, and never reaches CI. Do not rename it back.
 *
 * WHAT GREEN MEANS HERE: the contrast arithmetic holds and the geometry rules
 * that jsdom cannot see have not been reverted. It cannot prove the screen is
 * readable on a real panel — only a real panel can.
 */
const fs = require('fs');
const path = require('path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const GLOBAL_CSS = read('styles.css');
const MY_CSS = read('components', 'PlatformOrgsPanel.css');
const MY_JSX = read('components', 'PlatformOrgsPanel.jsx');

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
  if (!m) throw new Error(`${name} not declared in PlatformOrgsPanel.css`);
  return m[1];
}

const ROOT = ':root {';
const DUSK = '[data-theme="dark"] {';
const T = {
  bg: token(GLOBAL_CSS, DUSK, '--bg'),
  surface: token(GLOBAL_CSS, DUSK, '--surface'),
  surface2: token(GLOBAL_CSS, DUSK, '--surface-2'),
  text: token(GLOBAL_CSS, DUSK, '--text'),
  muted: token(GLOBAL_CSS, DUSK, '--muted'),
  primary: token(GLOBAL_CSS, ROOT, '--primary'),
  danger: token(GLOBAL_CSS, ROOT, '--danger'),
  dangerText: token(GLOBAL_CSS, ROOT, '--danger-text'),
  dangerDeep: token(GLOBAL_CSS, ROOT, '--danger-deep'),
  successText: token(MY_CSS, '.porgs {', '--porgs-success-text'),
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
const PANEL = [T.bg, T.surface];   // the invitations panel, and the dialogs

function block(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`(^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`, 'm'));
  if (!match) throw new Error(`No rule for "${selector}" — renamed?`);
  return match[2];
}

const stripped = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/* ========================================================================== */

describe('the flat pairings this screen paints', () => {
  // rejects: any token swap that makes a control unreadable on the surface it
  // is actually painted on — the Question sets tab shipped at 1.4:1 this way.
  const pairs = [
    ['organisation names and row values on the work field', T.text, FIELD],
    ['dates, column heads and the Personal mark on the work field', T.muted, FIELD],
    ['the Pending status on the work field', T.primary, FIELD],
    ['Suspend and the Suspended status on the work field', T.dangerText, FIELD],
    ['the standing note, which is painted on --surface', T.muted, PANEL],
    ['the emphasised first line of that note', T.text, PANEL],
  ];
  test.each(pairs)('%s clears AA', (_label, fg, layers) => {
    expect(on(fg, layers)).toBeGreaterThanOrEqual(AA);
  });

  // The Active status is the one colour on this screen that is not a
  // styles.css token — every screen declares its own success text, because an
  // undefined custom property invalidates the whole declaration.
  test('the Active status clears AA on the work field', () => {
    expect(on(T.successText, FIELD)).toBeGreaterThanOrEqual(AA);
  });
});

describe('the tinted composites — the half a token table cannot show', () => {
  // rejects: deepening a tint until the text on it drops under AA. Every stack
  // below is the real nesting the markup produces.
  test('the Pending status chip, tinted amber on the work field', () => {
    expect(on(T.primary, [T.bg, tint('--porgs-tint-warn')])).toBeGreaterThanOrEqual(AA);
  });
  test('the Suspended status chip and the error alert', () => {
    expect(on(T.dangerText, [T.bg, tint('--porgs-tint-danger')])).toBeGreaterThanOrEqual(AA);
  });
  test('the success alert', () => {
    expect(on(T.successText, [T.bg, tint('--porgs-tint-ok')])).toBeGreaterThanOrEqual(AA);
  });
  test('a hovered row, including the status chips sitting on it', () => {
    expect(on(T.text, [T.bg, tint('--porgs-row-hover')])).toBeGreaterThanOrEqual(AA);
    expect(on(T.muted, [T.bg, tint('--porgs-row-hover')])).toBeGreaterThanOrEqual(AA);
    // A chip's own tint composites ON TOP of the hover tint — the stack the
    // markup really produces when the pointer is over a suspended row.
    expect(on(T.dangerText, [T.bg, tint('--porgs-row-hover'), tint('--porgs-tint-danger')]))
      .toBeGreaterThanOrEqual(AA);
    expect(on(T.primary, [T.bg, tint('--porgs-row-hover'), tint('--porgs-tint-warn')]))
      .toBeGreaterThanOrEqual(AA);
  });
});

describe('the rules that are about what must NOT be there', () => {
  // rejects: `color: var(--danger)` creeping in. It is 4.38:1 on --surface —
  // under AA — which is the whole reason --danger-text exists.
  test('--danger never carries text here', () => {
    expect(ratio(parseHex(T.danger), parseHex(T.surface))).toBeLessThan(AA);   // the premise
    const offenders = MY_CSS.split('\n')
      .filter((line) => /(^|[^-])\bcolor\s*:\s*var\(--danger\)/.test(line));
    expect(offenders).toEqual([]);
  });

  // rejects: a paper-theme literal pasted in from the mockup. Comments are
  // stripped first — a previous test in this repo passed on prose in a header.
  test('no hex literal survives outside the token block', () => {
    const declarations = stripped(MY_CSS);
    const literals = [...declarations.matchAll(/(?:^|[\s:])(#[0-9A-Fa-f]{3,8})\b/g)].map((m) => m[1]);
    // #6FD0A4 is this scope's own --success-text (styles.css declares none) and
    // #FFBB66 is the hover lift of --primary. Both are named, both have a
    // comment in the stylesheet saying why they are literals.
    const allowed = ['#6FD0A4', '#FFBB66'];
    expect(literals.filter((h) => !allowed.includes(h.toUpperCase()))).toEqual([]);
  });

  // rejects: a var() typo, or borrowing a token from a stylesheet that merely
  // happens to be in the bundle. An undefined custom property invalidates the
  // WHOLE declaration, so the failure is silent and total.
  test('every custom property the stylesheet uses is declared somewhere', () => {
    const declared = new Set();
    for (const css of [GLOBAL_CSS, MY_CSS, read('components', 'AdminShell.css')]) {
      for (const m of css.matchAll(/(--[a-z0-9-]+)\s*:/gi)) declared.add(m[1]);
    }
    const used = [...MY_CSS.matchAll(/var\((--[a-z0-9-]+)/gi)].map((m) => m[1]);
    expect([...new Set(used)].filter((name) => !declared.has(name))).toEqual([]);
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

  // rejects: a bare .btn / .chip / .modal / .form-group declared from a
  // component stylesheet. UserManagement.css used to hand six of those to every
  // screen that imported later.
  test('every selector is rooted at the .porgs scope class', () => {
    expect(roots().filter((name) => !name.startsWith('porgs'))).toEqual([]);
  });

  // rejects: the `.qs` collision one polarity over — styles.css already owning
  // a prefix this screen assumes is its own.
  test('styles.css declares nothing in this scope', () => {
    const global = [...stripped(GLOBAL_CSS).matchAll(/\.(team[\w-]*)/g)].map((m) => m[1]);
    expect([...new Set(global)]).toEqual([]);
  });
});

describe('the ladder', () => {
  const LADDER = { floor: '12px', label: '13px', body: '15px', head: '19px' };
  // rejects: a ladder step quietly moved off the one derived for a laptop at
  // 24in. The stage's four ladders must not be imported here.
  test.each(Object.entries(LADDER))('--porgs-t-%s is %s', (step, value) => {
    expect(MY_CSS).toMatch(new RegExp(`--porgs-t-${step}:\\s*${value}`));
  });

  // rejects: anything under the 12px floor.
  test('nothing is declared below the 12px floor', () => {
    const px = [...MY_CSS.matchAll(/font-size:\s*(\d+)px/g)].map((m) => Number(m[1]));
    expect(px.filter((n) => n < 12)).toEqual([]);
  });

  // rejects: cards. 41 of them is a wall; rows are 36px.
  test('rows are 36px, because cards were rejected', () => {
    expect(MY_CSS).toMatch(/--porgs-row-h:\s*36px/);
  });

  // No input-size assertion: this screen has no text field. Members' does,
  // which is why that rule lives there.
});

describe('the geometry contracts jsdom cannot see', () => {
  /*
    jsdom has NO LAYOUT ENGINE, so none of this measures anything — each one
    reads the declaration back out of the stylesheet. That is worth stating
    because a geometric assertion here that LOOKED like it measured would be
    trusted, and would be lying.
  */
  // rejects: a fluid table. The columns carry short values that must line up
  // down the page for scanning, and the name column must be the one that
  // truncates.
  test('the table is fixed-layout and the value columns are pinned', () => {
    expect(block(MY_CSS, '.porgs-tbl')).toMatch(/table-layout:\s*fixed/);
    for (const col of ['num', 'plan', 'status', 'acts']) {
      expect(block(MY_CSS, `.porgs-col-${col}`)).toMatch(/width:\s*\d+px/);
    }
  });

  // rejects: a table that forces the whole page to scroll sideways on a narrow
  // window. The page body must never scroll horizontally; the table does,
  // inside its own container.
  test('the table scrolls inside its own wrapper', () => {
    expect(block(MY_CSS, '.porgs-tablewrap')).toMatch(/overflow-x:\s*auto/);
    expect(block(MY_CSS, '.porgs-tbl')).toMatch(/min-width:\s*\d+px/);
  });

  // rejects: row actions drifting left as the column's content changes width.
  test('row actions are right-aligned', () => {
    expect(block(MY_CSS, '.porgs-acts')).toMatch(/justify-content:\s*flex-end/);
  });

  // rejects: a name cell that wraps to two lines and breaks the 36px row.
  test('cells truncate rather than wrap', () => {
    const td = block(MY_CSS, '.porgs-tbl td');
    expect(td).toMatch(/white-space:\s*nowrap/);
    expect(td).toMatch(/text-overflow:\s*ellipsis/);
    expect(td).toMatch(/overflow:\s*hidden/);
  });
});

describe('the theme travels with the markup', () => {
  // rejects: relying on an ancestor's contentTheme. public/index.html puts
  // data-theme="light" on <html>, so a dusk surface that inherits its theme
  // renders paper tokens under dusk copy — 1.4:1, the exact defect the Question
  // sets tab shipped with.
  test('the root element declares data-theme="dark" itself', () => {
    expect(MY_JSX).toMatch(/className="porgs"\s+data-theme="dark"/);
  });

  // No dialog assertion: this screen opens none. The break-glass request
  // dialog the mockup draws is not built — see the component header for why a
  // button leading to a safeguard that does not exist is worse than no button.
});
