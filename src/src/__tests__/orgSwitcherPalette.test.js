/**
 * THE ORG SWITCHER'S CSS CONTRACT — components/OrgSwitcher.css
 *
 * NAMED *Palette*, NEVER *Token*. `.gitignore:35` is an unanchored `*token*`,
 * so a file named for tokens is invisible to git: it passes locally and never
 * reaches CI. Do not rename it back.
 *
 * jest maps CSS to identity-obj-proxy and jsdom resolves no custom property
 * across files, so the only honest way to pin this is to read the stylesheet as
 * text and do the arithmetic on it. Green here means "the contract has not been
 * reverted" — it cannot prove the menu is readable on a real panel.
 *
 * NO GEOMETRIC ASSERTIONS. jsdom has no layout engine; every width is 0 and
 * would pass unconditionally.
 */
const fs = require('fs');
const path = require('path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const GLOBAL_CSS = read('styles.css');
const SHELL_CSS = read('components', 'AdminShell.css');
const MY_CSS = read('components', 'OrgSwitcher.css');

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
  if (!m) throw new Error(`${name} not declared in OrgSwitcher.css`);
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
  secondary: token(GLOBAL_CSS, ROOT, '--secondary'),
  danger: token(GLOBAL_CSS, ROOT, '--danger'),
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
/* The real ancestor stack: AdminShell paints --bg, the topbar and the menu both
   paint --surface on top of it. */
const FIELD = [T.bg];
const CHIP = [T.bg, T.surface];

describe('the flat pairings the switcher paints', () => {
  // rejects: repointing --orgsw-* at a token that does not clear AA on --surface
  const pairs = [
    ['the org name on the chip and the menu rows (--text on --surface)', T.text, CHIP],
    ['the role column and the caret (--muted on --surface)', T.muted, CHIP],
    ['the initials in the tile (--primary on --surface-2)', T.primary, [T.bg, T.surface, T.surface2]],
    ['the platform chip lock (--secondary on --surface-2)', T.secondary, [T.bg, T.surface, T.surface2]],
    ['the heading "Your organisations" (--muted on --surface)', T.muted, CHIP],
    ['a chip sitting directly on the work field (--text on --bg)', T.text, FIELD],
  ];
  test.each(pairs)('%s clears AA', (_label, fg, layers) => {
    expect(on(fg, layers)).toBeGreaterThanOrEqual(AA);
  });
});

describe('the tinted composites — the half a token table cannot show', () => {
  // rejects: deepening --orgsw-row-hover far enough to swallow the muted role text
  test('a hovered menu row', () => {
    const stack = [T.bg, T.surface, tint('--orgsw-row-hover')];
    expect(on(T.text, stack)).toBeGreaterThanOrEqual(AA);
    expect(on(T.muted, stack)).toBeGreaterThanOrEqual(AA);
  });
  // rejects: raising --orgsw-row-sel's amber alpha until the current row's role goes under AA
  test('the current organisation row', () => {
    const stack = [T.bg, T.surface, tint('--orgsw-row-sel')];
    expect(on(T.text, stack)).toBeGreaterThanOrEqual(AA);
    expect(on(T.muted, stack)).toBeGreaterThanOrEqual(AA);
    expect(on(T.primary, stack)).toBeGreaterThanOrEqual(AA);
  });
  // rejects: the tile losing its own --surface-2 ground inside a tinted row
  test('the initials tile inside a tinted row', () => {
    expect(on(T.primary, [T.bg, T.surface, tint('--orgsw-row-sel'), T.surface2]))
      .toBeGreaterThanOrEqual(AA);
    expect(on(T.primary, [T.bg, T.surface, tint('--orgsw-row-hover'), T.surface2]))
      .toBeGreaterThanOrEqual(AA);
  });
});

describe('the house rules this stylesheet has to keep', () => {
  // rejects: pasting a mockup hex straight in instead of reaching for a token
  test('no hex literal survives anywhere in the sheet', () => {
    const declarations = MY_CSS.replace(/\/\*[\s\S]*?\*\//g, '');
    const literals = [...declarations.matchAll(/(?:^|[\s:,(])(#[0-9A-Fa-f]{3,8})\b/g)]
      .map((m) => m[1]);
    expect(literals).toEqual([]);
  });

  // rejects: colour: var(--danger) on any label here — 3.56:1 on --surface-2
  test('--danger never carries text here', () => {
    expect(ratio(parseHex(T.danger), parseHex(T.surface))).toBeLessThan(AA);
    const offenders = MY_CSS.split('\n')
      .filter((l) => /(^|[^-])\bcolor\s*:\s*var\(--danger\)/.test(l));
    expect(offenders).toEqual([]);
  });

  // rejects: a typo'd var() name, which invalidates the WHOLE declaration silently
  test('every custom property the stylesheet uses is declared somewhere', () => {
    const declared = new Set();
    for (const css of [GLOBAL_CSS, SHELL_CSS, MY_CSS]) {
      for (const m of css.matchAll(/(--[a-z0-9-]+)\s*:/gi)) declared.add(m[1]);
    }
    const used = [...MY_CSS.matchAll(/var\((--[a-z0-9-]+)/gi)].map((m) => m[1]);
    expect([...new Set(used)].filter((n) => !declared.has(n))).toEqual([]);
  });
});

/* ---- the namespace, both ways ---- */
const stripped = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const roots = () => {
  const out = new Set();
  for (const blk of stripped(MY_CSS).split('}')) {
    const head = blk.split('{')[0];
    if (!head || head.includes('@')) continue;
    for (const sel of head.split(',')) {
      for (const m of sel.trim().matchAll(/\.([\w-]+)/g)) out.add(m[1]);
    }
  }
  return [...out];
};

// rejects: declaring a bare .chip / .btn / .modal, which styles.css owns
test('every class this sheet names is inside the orgsw scope', () => {
  expect(roots().filter((n) => !n.startsWith('orgsw'))).toEqual([]);
});

// rejects: a global rule quietly claiming .orgsw* — the `.qs` collision, again
test('styles.css and AdminShell.css declare nothing in this scope', () => {
  const global = [
    ...stripped(GLOBAL_CSS).matchAll(/\.(orgsw[\w-]*)/g),
    ...stripped(SHELL_CSS).matchAll(/\.(orgsw[\w-]*)/g),
  ].map((m) => m[1]);
  expect([...new Set(global)]).toEqual([]);
});

/* ---- the ladder ---- */
const LADDER = { floor: '12px', label: '13px', body: '15px' };
// rejects: re-cutting the ladder for this one component
test.each(Object.entries(LADDER))('--orgsw-t-%s is %s', (step, value) => {
  expect(MY_CSS).toMatch(new RegExp(`--orgsw-t-${step}:\\s*${value}`));
});

// rejects: the 10px/11px avatar initials that the mockups shipped twice
test('nothing is declared below the 12px floor', () => {
  const sizes = [
    ...MY_CSS.matchAll(/font-size:\s*(\d+)px/g),
    ...MY_CSS.matchAll(/font:\s*[^;]*?\s(\d+)px\//g),
  ].map((m) => Number(m[1]));
  expect(sizes.filter((n) => n < 12)).toEqual([]);
});

// rejects: menu rows drifting off the console's 36px row height
test('menu rows are 36px, because this is the console and cards were rejected', () => {
  expect(MY_CSS).toMatch(/--orgsw-row-h:\s*36px/);
  expect(MY_CSS).toMatch(/\.orgsw-item\s*\{[^}]*min-height:\s*var\(--orgsw-row-h\)/);
});

// rejects: dropping data-theme from the root and inheriting <html>'s paper set
test('the component declares its own theme rather than inheriting one', () => {
  const jsx = read('components', 'OrgSwitcher.jsx');
  const roots_ = [...jsx.matchAll(/className="orgsw"([^>]*)>/g)].map((m) => m[1]);
  expect(roots_.length).toBeGreaterThan(0);
  expect(roots_.every((attrs) => /data-theme="dark"/.test(attrs))).toBe(true);
});

// rejects: re-nesting the menu inside the chip — a <button> may not contain one
test('the menu is a sibling of the chip, never a child of it', () => {
  const jsx = read('components', 'OrgSwitcher.jsx');
  const chip = jsx.indexOf('className="orgsw-chip"');
  const chipEnd = jsx.indexOf('</button>', chip);
  const menu = jsx.indexOf('className="orgsw-menu"');
  expect(chip).toBeGreaterThan(-1);
  expect(menu).toBeGreaterThan(chipEnd);
});

// rejects: justify-content:flex-end on a row, which overflows toward the start
test('the role column is pushed right with margin-left, not flex-end', () => {
  expect(MY_CSS).toMatch(/\.orgsw-role\s*\{[^}]*margin-left:\s*auto/);
  expect(stripped(MY_CSS)).not.toMatch(/justify-content:\s*flex-end/);
});
