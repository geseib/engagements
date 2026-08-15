# How to test a surface's design

jest maps CSS to `identity-obj-proxy` and loads no stylesheet; jsdom has no layout engine
and does not resolve custom properties across files. So the only honest way to pin a
design contract in this repo is to **read the stylesheet as text and do arithmetic on it**.

Three shipped exemplars — copy the nearest:

| Exemplar | Pins |
|---|---|
| `src/src/__tests__/questionSetsPalette.test.js` | the full pattern: composited contrast, tints, the theme/markup pairing, no stray hex, namespace both ways, the ladder |
| `src/src/__tests__/adminShellPalette.test.js` | pure token arithmetic, no DOM at all |
| `src/src/__tests__/welcomeScreen.test.jsx` | rendered behaviour + CSS declarations read by exact selector |
| `src/src/__tests__/modalReachability.test.js`, `rowActionsReachable.test.js` | geometry contracts that jsdom cannot see |

---

## 0. Name the file `*Palette.test.js` — never `*Token*`

`.gitignore:35` is an unanchored `*token*`. A file named `adminShellTokens.test.js` is
invisible to git: it runs locally, passes, and **never reaches CI**. Every palette test in
this repo carries a header saying so. Do not rename them back.

---

## 1. The harness

Copy this block verbatim. `bgOf` is lifted from `docs/design/admin-redesign/audit.html`'s
`<script>` — the file is `audit.html`, not `audit.js`.

```js
const fs = require('fs');
const path = require('path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const GLOBAL_CSS = read('styles.css');
const MY_CSS = read('components', 'MyPanel.css');

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

/* ---- tokens, READ rather than retyped: change a token and these numbers move ---- */
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
  if (!m) throw new Error(`${name} not declared in MyPanel.css`);
  return m[1];
}

const ROOT = ':root {';
const DUSK = '[data-theme="dark"] {';
const T = {
  bg:         token(GLOBAL_CSS, DUSK, '--bg'),
  surface:    token(GLOBAL_CSS, DUSK, '--surface'),
  surface2:   token(GLOBAL_CSS, DUSK, '--surface-2'),
  text:       token(GLOBAL_CSS, DUSK, '--text'),
  muted:      token(GLOBAL_CSS, DUSK, '--muted'),
  primary:    token(GLOBAL_CSS, ROOT, '--primary'),
  danger:     token(GLOBAL_CSS, ROOT, '--danger'),
  dangerText: token(GLOBAL_CSS, ROOT, '--danger-text'),
  dangerDeep: token(GLOBAL_CSS, ROOT, '--danger-deep'),
  successText: token(MY_CSS, '.mine {', '--mine-success-text'),
};

/** Build the REAL paint stack in the DOM and hand it to the audit's own bgOf.
 *  First entry is the outermost layer; last is what the text sits on. */
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
const FIELD = [T.bg];              // what AdminShell paints under a dark section
const PANEL = [T.bg, T.surface];   // a --surface panel on that field
```

---

## 2. The seven assertions a new screen owes

### 2.1 Every flat pairing clears AA

```js
describe('the flat pairings this screen paints', () => {
  const pairs = [
    ['--text on the work field (names, row values)', T.text, FIELD],
    ['--muted on the work field (descriptions, dates, column heads)', T.muted, FIELD],
    ['--text on --surface (panel and dialog copy)', T.text, PANEL],
    ['--primary on the work field (counts, chips, links)', T.primary, FIELD],
    ['--danger-text on the work field (Delete)', T.dangerText, FIELD],
    ['--bg on --primary (the filled primary)', T.bg, [T.primary]],
    ['--text on --danger-deep (the filled destructive)', T.text, [T.dangerDeep]],
  ];
  test.each(pairs)('%s clears AA', (_l, fg, layers) => {
    expect(on(fg, layers)).toBeGreaterThanOrEqual(AA);
  });
});
```

Name the *thing on screen* in each label, not the token. When it fails you want to know
which control went unreadable.

### 2.2 Every **tinted** composite clears AA

The half a token table cannot show. Each stack is the real nesting.

```js
test('the blocking tier of the report', () => {
  expect(on(T.dangerText, [T.bg, tint('--mine-tint-danger')])).toBeGreaterThanOrEqual(AA);
  expect(on(T.text,       [T.bg, tint('--mine-tint-danger')])).toBeGreaterThanOrEqual(AA);
  expect(on(T.muted,      [T.bg, tint('--mine-tint-danger')])).toBeGreaterThanOrEqual(AA);
});
test('a hovered row, and a hovered row inside the panel', () => {
  expect(on(T.text,  [T.bg, tint('--mine-row-hover')])).toBeGreaterThanOrEqual(AA);
  expect(on(T.muted, [T.bg, tint('--mine-row-hover')])).toBeGreaterThanOrEqual(AA);
});
```

Watch for a tier that declares `background: var(--bg)` inside a `--surface` panel — the
compositing walk stops at the **first opaque layer**, so the stack is `[bg, surface, bg]`,
not `[bg, surface]` (`questionSetsPalette.test.js:188-194`).

### 2.3 The theme and the markup converted together

```js
test('AdminPage passes contentTheme dark for this section', () => {
  const page = read('AdminPage.jsx');
  const section = page.slice(page.indexOf("id: 'mine'"), page.indexOf("id: 'next'"));
  expect(section).toMatch(/contentTheme:\s*'dark'/);
});
```

Until the markup is converted, assert the **opposite** — that is what
`promptEditorPalette.test.js:150-161` does, so the day somebody drops a dusk token in
without moving the section, it goes red.

### 2.4 No paper-theme literal survives

**Strip comments first.** A previous test in this repo passed on prose in a header comment;
`podium.test.jsx` carries a `stripComments()` helper for exactly this.

```js
test('no hex literal survives outside the token block', () => {
  const declarations = MY_CSS
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\.mine[^{]*--onlight[^{]*\{[^}]*\}/g, '');   // exclude token DEFINITIONS only
  const literals = [...declarations.matchAll(/(?:^|[\s:])(#[0-9A-Fa-f]{3,8})\b/g)].map((m) => m[1]);
  expect(literals.filter((h) => !['#FFBB66', '#6FD0A4'].includes(h.toUpperCase()))).toEqual([]);
});
```

Allow deliberate literals **by name**, with a comment saying why each one is there.

### 2.5 `--danger` never carries text

```js
test('--danger never carries text here', () => {
  expect(ratio(parseHex(T.danger), parseHex(T.surface))).toBeLessThan(AA);   // the premise
  const offenders = MY_CSS.split('\n')
    .filter((l) => /(^|[^-])\bcolor\s*:\s*var\(--danger\)/.test(l));
  expect(offenders).toEqual([]);
});
```

The `[^-]` guard matters: `color: var(--danger-text)` must not match.

### 2.6 Every custom property used is declared somewhere

An undefined custom property invalidates the **whole** declaration.

```js
test('every custom property the stylesheet uses is declared somewhere', () => {
  const declared = new Set();
  for (const css of [GLOBAL_CSS, MY_CSS, read('components', 'AdminShell.css')]) {
    for (const m of css.matchAll(/(--[a-z0-9-]+)\s*:/gi)) declared.add(m[1]);
  }
  const used = [...MY_CSS.matchAll(/var\((--[a-z0-9-]+)/gi)].map((m) => m[1]);
  expect([...new Set(used)].filter((n) => !declared.has(n))).toEqual([]);
});
```

### 2.7 The namespace, both ways

```js
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

test('every selector is rooted at the scope class', () => {
  expect(roots().filter((n) => !n.startsWith('mine'))).toEqual([]);
});

test('styles.css declares nothing in this scope', () => {
  const global = [...stripped(GLOBAL_CSS).matchAll(/\.(mine[\w-]*)/g)].map((m) => m[1]);
  expect([...new Set(global)]).toEqual([]);
});
```

### 2.8 The ladder

```js
const LADDER = { floor: '12px', label: '13px', body: '15px', head: '19px' };
test.each(Object.entries(LADDER))('--mine-t-%s is %s', (step, value) => {
  expect(MY_CSS).toMatch(new RegExp(`--mine-t-${step}:\\s*${value}`));
});
test('nothing is declared below the 12px floor', () => {
  const px = [...MY_CSS.matchAll(/font-size:\s*(\d+)px/g)].map((m) => Number(m[1]));
  expect(px.filter((n) => n < 12)).toEqual([]);
});
test('rows are 36px, because cards were rejected', () => {
  expect(MY_CSS).toMatch(/--mine-row-h:\s*36px/);
});
```

---

## 3. Geometry contracts

Read the declaration block by exact selector and assert what it says:

```js
function block(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`(^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`, 'm'));
  if (!match) throw new Error(`No rule for "${selector}" — renamed?`);
  return match[2];
}

const scrim = () => block(MY_CSS, '.mine-scrim');
test('the scrim scrolls and does not centre with the flex container', () => {
  expect(scrim()).toMatch(/overflow-y:\s*auto/);
  expect(scrim()).not.toMatch(/align-items:\s*center/);
  expect(scrim()).toMatch(/align-items:\s*flex-start/);
  expect(scrim()).toMatch(/padding:\s*\S+/);
});
test('the card still centres itself while it fits', () => {
  expect(MY_CSS).toMatch(/\.mine-scrim\s*>\s*\*\s*\{[^}]*margin:\s*auto/);
});
```

**Check every scrim wherever it is declared.** `modalReachability.test.js` originally read
only `styles.css`, which is precisely how `.prompt-editor-overlay` — the tallest form in
the product — carried the identical fault through three previous fixes.

---

## 4. Behaviour, rendered

For "the control exists, is wired, and is reachable", render the real component and drive
the real controls (`welcomeScreen.test.jsx`). Two constraints:

- **Never assert a position or a size.** For "after the last panel", use
  `compareDocumentPosition`, which jsdom models. For "the button is visible", assert it is
  in the document and has an accessible name.
- **Extract the surface into a component you can mount.** `AdminPage.jsx` and
  `GameHostPage.jsx` cannot be mounted in jsdom at all — they die on
  `useAuth must be used within an AuthProvider`. That is why `AdminShell`, `WelcomeScreen`,
  `GameSetupDialog`, `SessionSetupPanel`, `Podium`, `QuestionSetsPanel` and
  `PromptLibraryPanel` are separate, pure components. A screen that cannot be mounted
  cannot be tested; make it mountable first.

---

## 5. Write the limit into the header

Every one of these files says what green means. Do the same:

> This pins the CSS contract that makes the dialog reachable. It cannot prove the dialog
> IS reachable in a browser — only a real device can. Treat a green run here as "the fix
> has not been reverted", not as "this works on an iPad".
