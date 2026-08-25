/**
 * THE CSS CONTRACT FOR THE DATA & PRIVACY SCREEN — components/PrivacyPanel.css.
 *
 * jest maps CSS to identity-obj-proxy and jsdom resolves no custom property
 * across files, so the only honest way to pin a design contract here is to read
 * the stylesheet as TEXT and do the arithmetic on it. The compositing functions
 * below are lifted verbatim from docs/design/admin-redesign/audit.html.
 *
 * NAMED `*Palette*` AND NEVER `*Token*`: .gitignore:35 is an unanchored
 * `*token*`, so a file named for tokens runs locally, passes, and never reaches
 * CI. Do not rename it back.
 *
 * WHAT GREEN MEANS. It means the palette still clears AA on paper and the
 * geometry rules that make the screen readable have not been reverted. It
 * cannot prove the screen looks right in a browser — only a browser can.
 */
const fs = require('fs');
const path = require('path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const GLOBAL_CSS = read('styles.css');
const MY_CSS = read('components', 'PrivacyPanel.css');
const SHELL_CSS = read('components', 'AdminShell.css');

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
  if (!stack.length) return [15, 26, 46];
  let out = stack[stack.length - 1][0];
  for (let i = stack.length - 2; i >= 0; i -= 1) out = alphaOver(stack[i][0], out, stack[i][1]);
  return out;
}

/* ---- tokens, READ rather than retyped ---- */
const parseHex = (h) => [1, 3, 5].map((i) => parseInt(h.substr(i, 2), 16));

function token(css, block, name) {
  const start = css.indexOf(block);
  if (start < 0) throw new Error(`no ${block} block`);
  const body = css.slice(start, css.indexOf('}', start));
  const m = body.match(new RegExp(`${name}\\s*:\\s*(#[0-9A-Fa-f]{6})`));
  if (!m) throw new Error(`${name} not declared in ${block}`);
  return m[1];
}
function tint(name) {
  const m = MY_CSS.match(new RegExp(`${name}\\s*:\\s*(rgba\\([^)]*\\))`));
  if (!m) throw new Error(`${name} not declared in PrivacyPanel.css`);
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
  dangerDeep: token(GLOBAL_CSS, ROOT, '--danger-deep'),
  successText: token(MY_CSS, '.priv {', '--priv-success-text'),
};

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
const FIELD = [T.bg];                 // the work body AdminShell paints
const PANEL = [T.bg, T.surface];      // a --surface panel on that field

describe('the flat pairings this screen paints', () => {
  // rejects: any token pairing on this screen dropping under AA — the failure
  //          mode that shipped #333 body copy onto #0F1A2E at 1.4:1 elsewhere.
  const pairs = [
    ['--text on the work field (log values)', T.text, FIELD],
    ['--muted on the work field (column heads, dates, affiliations)', T.muted, FIELD],
    ['--text on --surface (panel and dialog copy)', T.text, PANEL],
    ['--muted on --surface (the two Leaving notes)', T.muted, PANEL],
    ['--danger-text on --surface (Delete, and the consequence copy)', T.dangerText, PANEL],
    ['--bg on --primary (the filled Export everything)', T.bg, [T.primary]],
    ['--text on --danger-deep (the filled Delete for ever)', T.text, [T.dangerDeep]],
  ];
  test.each(pairs)('%s clears AA', (_l, fg, layers) => {
    expect(on(fg, layers)).toBeGreaterThanOrEqual(AA);
  });
});

describe('the tinted composites, which a token table cannot show', () => {
  // rejects: the honest-limit paragraph going unreadable. It is the single most
  //          important sentence on the page and it sits on a tint inside a panel.
  test('the note-box carrying "we cannot do it quietly"', () => {
    expect(on(T.muted, [T.bg, T.surface, tint('--priv-tint-note')])).toBeGreaterThanOrEqual(AA);
    expect(on(T.text, [T.bg, T.surface, tint('--priv-tint-note')])).toBeGreaterThanOrEqual(AA);
  });

  // rejects: the EMPTY log — a good state — being painted illegibly. Nobody
  //          would notice, because nobody looks at a screen with nothing on it.
  test('the empty-log poster, on the field', () => {
    expect(on(T.successText, [T.bg, tint('--priv-tint-ok')])).toBeGreaterThanOrEqual(AA);
    expect(on(T.muted, [T.bg, tint('--priv-tint-ok')])).toBeGreaterThanOrEqual(AA);
  });

  // rejects: the load-failure poster going unreadable, which would leave the
  //          reader unable to tell it apart from the empty state.
  test('the load-failure poster, on the field', () => {
    expect(on(T.dangerText, [T.bg, tint('--priv-tint-danger')])).toBeGreaterThanOrEqual(AA);
    expect(on(T.muted, [T.bg, tint('--priv-tint-danger')])).toBeGreaterThanOrEqual(AA);
  });

  // rejects: the reversible neighbour inside the delete dialog fading out. It
  //          is nested one deeper — field, surface, tint — not two.
  test('the export-first box inside the delete dialog', () => {
    expect(on(T.muted, [T.bg, T.surface, tint('--priv-tint-ok')])).toBeGreaterThanOrEqual(AA);
    expect(on(T.successText, [T.bg, T.surface, tint('--priv-tint-ok')])).toBeGreaterThanOrEqual(AA);
  });

  // rejects: a hovered log row swallowing its own text.
  test('a hovered log row', () => {
    expect(on(T.text, [T.bg, tint('--priv-row-hover')])).toBeGreaterThanOrEqual(AA);
    expect(on(T.muted, [T.bg, tint('--priv-row-hover')])).toBeGreaterThanOrEqual(AA);
  });
});

describe('the rules the palette depends on', () => {
  // rejects: `color: var(--danger)` creeping in. The premise is asserted too,
  //          so the day --danger is lightened this test tells you why it can go.
  test('--danger never carries text here', () => {
    expect(ratio(parseHex(T.danger), parseHex(T.surface))).toBeLessThan(AA);
    const offenders = MY_CSS.split('\n')
      .filter((l) => /(^|[^-])\bcolor\s*:\s*var\(--danger\)/.test(l));
    expect(offenders).toEqual([]);
  });

  // rejects: a paper-theme literal being pasted in from the mockup, which is
  //          how a dusk surface acquires #333 body copy.
  test('no hex literal survives outside the token block', () => {
    const declarations = MY_CSS
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\.priv\s*\{[^}]*\}/, '');
    const literals = [...declarations.matchAll(/(?:^|[\s:])(#[0-9A-Fa-f]{3,8})\b/g)].map((m) => m[1]);
    expect(literals).toEqual([]);
  });

  // rejects: reaching for a custom property nobody declares. An undefined one
  //          invalidates the WHOLE declaration, silently.
  test('every custom property the stylesheet uses is declared somewhere', () => {
    const declared = new Set();
    for (const css of [GLOBAL_CSS, MY_CSS, SHELL_CSS]) {
      for (const m of css.matchAll(/(--[a-z0-9-]+)\s*:/gi)) declared.add(m[1]);
    }
    const used = [...MY_CSS.matchAll(/var\((--[a-z0-9-]+)/gi)].map((m) => m[1]);
    expect([...new Set(used)].filter((n) => !declared.has(n))).toEqual([]);
  });
});

const stripped = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
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

describe('the namespace, both ways', () => {
  // rejects: a bare .btn / .modal / .panel escaping into the bundle, where it
  //          would restyle every other screen by import order.
  test('every selector is rooted at .priv', () => {
    expect(roots().filter((n) => !n.startsWith('priv'))).toEqual([]);
  });

  // rejects: the .qs collision repeating — styles.css already owning a name
  //          this sheet thinks it invented.
  test('styles.css declares nothing in the .priv scope', () => {
    const global = [...stripped(GLOBAL_CSS).matchAll(/\.(priv[\w-]*)/g)].map((m) => m[1]);
    expect([...new Set(global)]).toEqual([]);
  });
});

describe('the ladder and the density', () => {
  const LADDER = { floor: '12px', label: '13px', body: '15px', head: '19px' };
  // rejects: the ladder drifting off the derived 12/13/15/19 steps.
  test.each(Object.entries(LADDER))('--priv-t-%s is %s', (step, value) => {
    expect(MY_CSS).toMatch(new RegExp(`--priv-t-${step}:\\s*${value}`));
  });

  // rejects: anything below the 12px floor. At 24in, 12px is 10.3 arcmin and
  //          that is the bottom of the derivation, not a preference.
  test('nothing is declared below the 12px floor', () => {
    const px = [...MY_CSS.matchAll(/font-size:\s*(\d+)px/g)].map((m) => Number(m[1]));
    expect(px.filter((n) => n < 12)).toEqual([]);
  });

  // rejects: 56px rows, or cards. This surface is dense on purpose.
  test('rows are 36px', () => {
    expect(MY_CSS).toMatch(/--priv-row-h:\s*36px/);
  });
});

/* --------------------------------------------------------------- geometry -- */

function block(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`(^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`, 'm'));
  if (!match) throw new Error(`No rule for "${selector}" — renamed?`);
  return match[2];
}

describe('the geometry contracts jsdom cannot see', () => {
  // rejects: auto table layout, under which the declared widths are hints and a
  //          nowrap date grows the table until the work area scrolls sideways.
  test('the log table is fixed-layout', () => {
    expect(block(MY_CSS, '.priv-tbl')).toMatch(/table-layout:\s*fixed/);
  });

  // rejects: THE defect this screen exists to avoid. `.priv-tbl td` truncates
  //          by default, which is right for a scan list and wrong for a reason
  //          somebody gave for reading a customer's data. The two modifiers are
  //          the recovery, and a reduction with no recovery is a deletion.
  test('the log cells wrap rather than truncate', () => {
    expect(block(MY_CSS, '.priv-tbl td')).toMatch(/text-overflow:\s*ellipsis/);
    // AND THEY MUST OUT-SPECIFY IT. `.priv-tbl td` is (0,1,1); a bare
    // `.priv-wrap` at (0,1,0) loses, so the modifier applies, the tests pass and
    // the cell truncates anyway. It shipped that way for one render and ate
    // "12 Aug, expired after 4…".
    const wrap = block(MY_CSS, '.priv-tbl td.priv-wrap');
    expect(wrap).toMatch(/white-space:\s*normal/);
    expect(wrap).toMatch(/text-overflow:\s*clip/);
    expect(block(MY_CSS, '.priv-tbl td.priv-tight')).toMatch(/height:\s*auto/);
    expect(MY_CSS).not.toMatch(/(^|\})\s*\.priv-wrap\s*\{/m);
  });

  // rejects: the column widths drifting off 100%, which under fixed layout is
  //          how a column silently gets a share nobody chose.
  test('the four columns sum to 100%', () => {
    const widths = ['who', 'what', 'touched', 'when']
      .map((c) => Number(block(MY_CSS, `.priv-col-${c}`).match(/width:\s*(\d+)%/)[1]));
    expect(widths.reduce((a, b) => a + b, 0)).toBe(100);
  });

  // rejects: the recurring scrim bug — a centred child of a scrolling container
  //          overflows in BOTH directions and only one of them is reachable.
  test('the scrim scrolls and does not centre with the flex container', () => {
    const scrim = block(MY_CSS, '.priv-scrim');
    expect(scrim).toMatch(/overflow-y:\s*auto/);
    expect(scrim).not.toMatch(/align-items:\s*center/);
    expect(scrim).toMatch(/align-items:\s*flex-start/);
    expect(scrim).toMatch(/padding:\s*\S+/);
  });

  // rejects: dropping the margin half of that pair, which jams every short
  //          dialog against the top edge.
  test('the dialog still centres itself while it fits', () => {
    expect(MY_CSS).toMatch(/\.priv-scrim\s*>\s*\*\s*\{[^}]*margin:\s*auto/);
  });

  // rejects: a 13px input under 15px prose — the commonest way a dense console
  //          gets illegible exactly where a mistake is most expensive. The
  //          type-to-confirm field is that input.
  test('the confirm input renders at the reading tier', () => {
    expect(block(MY_CSS, '.priv-input')).toMatch(/var\(--priv-t-body\)/);
  });
});
