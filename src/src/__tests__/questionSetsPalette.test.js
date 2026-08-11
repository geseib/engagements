/**
 * THE COLOUR PAIRINGS THE QUESTION SETS SCREEN INTRODUCES.
 *
 * Beside adminShellPalette.test.js and adminTabsPalette.test.js, and named
 * "Palette" for the same reason: `.gitignore:35` is `*token*`, so a file named
 * for tokens is invisible to git — it would pass locally and never reach CI.
 * Do not rename it back.
 *
 * WHY THIS FILE EXISTS AT ALL. The Question sets tab shipped as
 * `contentTheme: 'light'` — paper markup, `#333` body copy — inside a shell
 * whose work body is `#0F1A2E`. Converting one without the other is 1.4:1.
 * AdminPage.jsx now passes `contentTheme: 'dark'` and the markup is
 * QuestionSetsPanel.css, in the same change.
 *
 * THE CHECKS ARE LIFTED, NOT REWRITTEN. `rgb`, `lin`, `lum`, `ratio`,
 * `alphaOver` and `bgOf` below are copied verbatim out of the `<script>` block
 * in docs/design/admin-redesign/audit.html (the plan and RESUME call it
 * `audit.js`; there is no such file). `bgOf` is the one that matters: it walks
 * UP from the text node compositing every alpha layer it passes, because
 * reading only the element's own background is how dark-on-dark passes an
 * audit. That is exactly the `#333` case above.
 *
 * jsdom will not resolve `var(--text)` across a stylesheet it never loaded, so
 * the stack `bgOf` walks is built here from the token values read out of
 * styles.css and the layer values read out of QuestionSetsPanel.css. Nothing is
 * eyeballed and nothing is hardcoded twice: change a token or a tint and these
 * numbers move.
 */
const fs = require('fs');
const path = require('path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const GLOBAL_CSS = read('styles.css');
const QS_CSS = read('components', 'QuestionSetsPanel.css');

/* ---- colour: lifted verbatim from docs/design/admin-redesign/audit.html ---- */
function rgb(s) { const m = String(s).match(/[\d.]+/g); return m ? m.slice(0, 3).map(Number) : null; }
function lin(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function lum(c) { return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]); }
function ratio(a, b) {
  const la = lum(a); const lb = lum(b);
  const h = Math.max(la, lb); const l = Math.min(la, lb);
  return (h + 0.05) / (l + 0.05);
}
function alphaOver(fg, bg, a) { return fg.map((c, i) => c * a + bg[i] * (1 - a)); }
/* Walk up for the first non-transparent background, compositing alpha as we go.
   Reading only the element's own background is how dark-on-dark passes an audit. */
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

/* ------------------------------------------------------------------ tokens -- */

const parseHex = (h) => [1, 3, 5].map((i) => parseInt(h.substr(i, 2), 16));

function token(css, block, name) {
  const start = css.indexOf(block);
  if (start < 0) throw new Error(`no ${block} block`);
  const body = css.slice(start, css.indexOf('}', start));
  const m = body.match(new RegExp(`${name}\\s*:\\s*(#[0-9A-Fa-f]{6})`));
  if (!m) throw new Error(`${name} not declared in ${block}`);
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
  // Declared locally, `--qsets-` prefixed, exactly as the users and sessions
  // screens declare theirs: styles.css has never had a --success-text.
  successText: token(QS_CSS, '.qsets {', '--qsets-success-text'),
};

/** An rgba() layer declared in QuestionSetsPanel.css, read rather than retyped. */
function tint(name) {
  const m = QS_CSS.match(new RegExp(`${name}\\s*:\\s*(rgba\\([^)]*\\))`));
  if (!m) throw new Error(`${name} not declared in QuestionSetsPanel.css`);
  return m[1];
}

/**
 * Build the real paint stack in the DOM and hand it to the audit's own `bgOf`.
 * Each entry is a CSS background value; the first is the outermost (the work
 * body), the last is the element the text sits on.
 */
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
/** The work body AdminShell paints under this screen: contentTheme="dark". */
const FIELD = [T.bg];
const PANEL = [T.bg, T.surface];

/* -------------------------------------------------------------------------- */

describe('the flat pairings this screen paints', () => {
  const pairs = [
    ['--text on the work field (set names, row values)', T.text, FIELD],
    ['--muted on the work field (descriptions, dates, column heads)', T.muted, FIELD],
    ['--text on --surface (the creation panel and the delete dialog)', T.text, PANEL],
    ['--muted on --surface (field labels, help text)', T.muted, PANEL],
    ['--primary on the work field (counts, quickstart chip, links)', T.primary, FIELD],
    ['--primary on --surface (the same chips inside the panel)', T.primary, PANEL],
    ['--qsets-success-text on the work field (Active)', T.successText, FIELD],
    ['--qsets-success-text on --surface (the deactivate-instead block)', T.successText, PANEL],
    ['--danger-text on the work field (Delete, Not playable, Empty)', T.dangerText, FIELD],
    ['--danger-text on --surface (the delete dialog)', T.dangerText, PANEL],
    ['--bg on --primary (the filled New set / Upload button)', T.bg, [T.primary]],
    ['--text on --danger-deep (the filled Delete the set)', T.text, [T.dangerDeep]],
  ];

  test.each(pairs)('%s clears AA', (_label, fg, layers) => {
    expect(on(fg, layers)).toBeGreaterThanOrEqual(AA);
  });

  test('the filled primary is still legible when hovered', () => {
    // .qsets-btn--primary:hover lightens to #FFBB66 and keeps --bg as its label.
    expect(on(T.bg, ['#FFBB66'])).toBeGreaterThanOrEqual(AA);
  });
});

describe('the tinted composites, where a pairing quietly drops under AA', () => {
  /*
    A tint is invisible in a token table. audit.html's bgOf exists because
    reading only the element's own background — which for a tinted panel is a
    transparent rgba — is how dark-on-dark passes an audit. Each stack below is
    the real nesting: work body, then the tinted tier, then the text.
  */
  test('the blocking tier of the CSV report', () => {
    expect(on(T.dangerText, [T.bg, tint('--qsets-tint-danger')])).toBeGreaterThanOrEqual(AA);
    expect(on(T.text, [T.bg, tint('--qsets-tint-danger')])).toBeGreaterThanOrEqual(AA);
    expect(on(T.muted, [T.bg, tint('--qsets-tint-danger')])).toBeGreaterThanOrEqual(AA);
  });

  test('the would-be-skipped tier, which is amber', () => {
    expect(on(T.primary, [T.bg, tint('--qsets-tint-warn')])).toBeGreaterThanOrEqual(AA);
    expect(on(T.text, [T.bg, tint('--qsets-tint-warn')])).toBeGreaterThanOrEqual(AA);
    expect(on(T.muted, [T.bg, tint('--qsets-tint-warn')])).toBeGreaterThanOrEqual(AA);
  });

  test('the clean-file tier and the deactivate-instead block', () => {
    // The green tier sits on the work field; the deactivate block sits on the
    // dialog's --surface. Two different composites of the same tint.
    expect(on(T.successText, [T.bg, tint('--qsets-tint-ok')])).toBeGreaterThanOrEqual(AA);
    expect(on(T.text, [T.bg, tint('--qsets-tint-ok')])).toBeGreaterThanOrEqual(AA);
    expect(on(T.successText, [T.bg, T.surface, tint('--qsets-tint-ok')])).toBeGreaterThanOrEqual(AA);
    expect(on(T.text, [T.bg, T.surface, tint('--qsets-tint-ok')])).toBeGreaterThanOrEqual(AA);
  });

  test('a hovered row, and a hovered row inside the panel', () => {
    expect(on(T.text, [T.bg, tint('--qsets-row-hover')])).toBeGreaterThanOrEqual(AA);
    expect(on(T.muted, [T.bg, tint('--qsets-row-hover')])).toBeGreaterThanOrEqual(AA);
  });

  test('the preflight tiers sit on --bg inside a --surface panel, and that is the stack measured', () => {
    // .qsets-pf-tier declares `background: var(--bg)` while its parent .qsets-panel is
    // --surface. rejects: measuring against --surface because that is what the
    // panel says — the compositing walk stops at the first opaque layer, which
    // is the tier's own --bg.
    expect(on(T.muted, [T.bg, T.surface, T.bg])).toBeGreaterThanOrEqual(AA);
  });
});

describe('the conversion actually happened, in both halves', () => {
  test('AdminPage passes contentTheme dark for the question sets section', () => {
    // rejects: converting the markup and leaving the section on the paper theme,
    // or the reverse. Either one is the 1.4:1 case this file exists for.
    const page = read('AdminPage.jsx');
    const section = page.slice(page.indexOf("id: 'questionsets'"), page.indexOf("id: 'games'"));
    expect(section).toMatch(/contentTheme:\s*'dark'/);
  });

  test('no paper-theme literal survives in the stylesheet', () => {
    // The shipped tab's markup was BuilderPage.css: #333 body copy, #fff cards.
    // rejects: a hex literal creeping back in beside the tokens — every colour
    // on this screen is a token or an rgba of one.
    // COMMENTS STRIPPED FIRST. The header of that stylesheet quotes #333 and
    // every dusk token by name, and a previous test in this repo passed on a
    // comment — podium.test.jsx carries a stripComments() helper for exactly
    // this. Without the strip this assertion measures prose.
    const declarations = QS_CSS.replace(/\/\*[\s\S]*?\*\//g, '');
    const literals = [...declarations.matchAll(/(?:^|[\s:])(#[0-9A-Fa-f]{3,8})\b/g)].map((m) => m[1]);
    // Two deliberate literals, both measured above: the primary hover, and the
    // locally-declared --qsets-success-text that styles.css does not have.
    expect(literals.filter((hex) => !['#FFBB66', '#6FD0A4'].includes(hex.toUpperCase()))).toEqual([]);
  });

  test('--danger never carries text here', () => {
    // 4.38:1 on --surface, under AA, which is why --danger-text exists. It keeps
    // borders and tints. rejects: `color: var(--danger)` creeping in — and
    // destructive copy is precisely the text a person must read carefully.
    expect(ratio(parseHex(T.danger), parseHex(T.surface))).toBeLessThan(AA);
    const offenders = QS_CSS.split('\n').filter((line) => /(^|[^-])\bcolor\s*:\s*var\(--danger\)/.test(line));
    expect(offenders).toEqual([]);
  });

  test('every custom property the stylesheet uses is declared somewhere', () => {
    // An undefined custom property invalidates the WHOLE declaration, not just
    // the value — styles/stage.css:648-666 documents this dropping every card
    // border on the floor once already. rejects: reaching for --success-text or
    // --font-mono, which exist only on stylesheets that happen to be in the
    // bundle today.
    const declared = new Set();
    for (const css of [GLOBAL_CSS, QS_CSS, read('components', 'AdminShell.css')]) {
      for (const m of css.matchAll(/(--[a-z0-9-]+)\s*:/gi)) declared.add(m[1]);
    }
    const used = [...QS_CSS.matchAll(/var\((--[a-z0-9-]+)/gi)].map((m) => m[1]);
    expect([...new Set(used)].filter((name) => !declared.has(name))).toEqual([]);
  });
});

describe('the namespace, which is the failure a component test cannot see', () => {
  /*
    FOUND BY LOOKING AT THE RENDERED SCREEN, not by a test. The first cut was
    scoped `.qs`, and styles.css already owns `.qs-editor`, `.qs-panel`,
    `.qs-empty` and sixteen more for the set editor — which is still paper
    theme. `.qs-empty { color: #5E6167; font-style: italic }` therefore
    repainted the new dark empty state grey and italic, and `.qs-panel` gave the
    creation panel a paper background.

    No component test can catch that: jest maps CSS to identity-obj-proxy and
    loads no stylesheet, so the collision exists only in the bundle. These two
    assertions are the substitute.
  */
  const stripped = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

  /** The leading class of every selector this stylesheet declares. */
  const roots = () => {
    const out = new Set();
    for (const block of stripped(QS_CSS).split('}')) {
      const head = block.split('{')[0];
      if (!head || head.includes('@')) continue;
      for (const selector of head.split(',')) {
        const m = selector.trim().match(/^[a-zA-Z]*\.([\w-]+)/);
        if (m) out.add(m[1]);
      }
    }
    return [...out];
  };

  test('every selector is rooted at the scope class', () => {
    // rejects: a bare `.chip` or `.modal` leaking out of a component stylesheet
    // the way UserManagement.css's old `.alert` / `.empty-state` did — declared
    // globally, so unrelated screens inherited them by import order.
    expect(roots().filter((name) => !name.startsWith('qsets'))).toEqual([]);
  });

  test('styles.css declares nothing in this scope', () => {
    // The other half. Rooting every selector at `.qsets` is only protection if
    // `.qsets*` belongs to this file alone. rejects: renaming the prefix back to
    // one styles.css already uses — `qs` is the one that bit.
    const global = [...stripped(GLOBAL_CSS).matchAll(/\.(qsets[\w-]*)/g)].map((m) => m[1]);
    expect([...new Set(global)]).toEqual([]);
    // And the premise, so this test cannot quietly become vacuous: the prefix it
    // replaced IS taken.
    expect(stripped(GLOBAL_CSS)).toMatch(/\.qs-empty\s*\{/);
  });
});

describe('the type ladder this screen is built on', () => {
  // RATIONALE §3: 12 floor / 13 label / 15 body / 19 head, derived for one
  // person at 24in — NOT the host stage's 20px angular floors, which are for a
  // projected image read at 25 feet.
  const LADDER = { floor: '12px', label: '13px', body: '15px', head: '19px' };

  test.each(Object.entries(LADDER))('--qsets-t-%s is %s', (step, value) => {
    expect(QS_CSS).toMatch(new RegExp(`--qsets-t-${step}:\\s*${value}`));
  });

  test('nothing is declared below the 12px floor', () => {
    // rejects: a 10px or 11px chip added later to make a row fit — audit A3.
    // 14px is allowed and used deliberately: monospace runs ~1px small at the
    // same optical size, so .qsets-mono is 14px like .sp-mono.
    const literals = [...QS_CSS.matchAll(/font-size:\s*(\d+)px/g)].map((m) => Number(m[1]));
    expect(literals.filter((px) => px < 12)).toEqual([]);
  });

  test('rows are 36px, because cards were rejected', () => {
    // RATIONALE §4: forty-one cards is a wall. This screen was the forty-one.
    expect(QS_CSS).toMatch(/--qsets-row-h:\s*36px/);
  });
});
