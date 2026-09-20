/**
 * THE COLOUR THE BROWSE PAINTS — the `.qsets-browse*` block of
 * components/QuestionSetsPanel.css, drawn by components/SetShelfBrowse.jsx.
 *
 * Named "Palette", never "Token": `.gitignore:35` is an unanchored `*token*`,
 * so a file named for tokens is invisible to git — it passes locally and never
 * reaches CI. questionSetsPalette.test.js carries the same warning.
 *
 * WHY A SECOND FILE BESIDE THAT ONE. It measures the stacks the TABLE paints:
 * the work field (`--bg`), and `--surface` for the creation panel and the
 * delete dialog. The browse adds a THIRD depth — a tinted pill inside a
 * `--surface` card on the work field — and a tint is invisible in a token
 * table. `bgOf` exists because reading only the element's own background,
 * which for a tinted pill is a transparent rgba, is how dark-on-dark passes an
 * audit.
 *
 * THE CHECKS ARE LIFTED, NOT REWRITTEN — `rgb`, `lin`, `lum`, `ratio`,
 * `alphaOver` and `bgOf` are the functions from the `<script>` block in
 * docs/design/admin-redesign/audit.html, the same copies questionSetsPalette
 * uses. Nothing here is eyeballed and nothing is hardcoded twice: change a
 * token or a tint and these numbers move.
 */
const fs = require('fs');
const path = require('path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const GLOBAL_CSS = read('styles.css');
const QS_CSS = read('components', 'QuestionSetsPanel.css');

/* ---- colour: lifted verbatim from docs/design/admin-redesign/audit.html ---- */
function lin(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function lum(c) { return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]); }
function ratio(a, b) {
  const la = lum(a); const lb = lum(b);
  const h = Math.max(la, lb); const l = Math.min(la, lb);
  return (h + 0.05) / (l + 0.05);
}
function alphaOver(fg, bg, a) { return fg.map((c, i) => c * a + bg[i] * (1 - a)); }
/* Walk up for the first non-transparent background, compositing alpha as we go. */
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
  text: token(GLOBAL_CSS, DUSK, '--text'),
  muted: token(GLOBAL_CSS, DUSK, '--muted'),
  primary: token(GLOBAL_CSS, ROOT, '--primary'),
};

/** An rgba() layer declared in QuestionSetsPanel.css, read rather than retyped. */
function tint(name) {
  const m = QS_CSS.match(new RegExp(`${name}\\s*:\\s*(rgba\\([^)]*\\))`));
  if (!m) throw new Error(`${name} not declared in QuestionSetsPanel.css`);
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
/** The real nesting: AdminShell's work body (contentTheme dark), then the
 *  browse card, which is --surface like the creation panel. */
const CARD = [T.bg, T.surface];

/* -------------------------------------------------------- the declarations -- */

const stripped = QS_CSS.replace(/\/\*[\s\S]*?\*\//g, '');

/** Every rule this component declares, `{ head, body }`. */
const browseRules = stripped
  .split('}')
  .map((block) => ({ head: (block.split('{')[0] || '').trim(), body: block.split('{')[1] || '' }))
  .filter((rule) => rule.head.includes('qsets-browse'));

const rule = (selector) => {
  const found = browseRules.find((r) => r.head.split(',').some((s) => s.trim() === selector));
  if (!found) throw new Error(`no rule for ${selector}`);
  return found.body;
};

describe('the browse is really declared, so nothing below is vacuous', () => {
  test('its stylesheet block exists', () => {
    // rejects: this whole file passing against a component with no CSS at all,
    // which is the shape every assertion here would otherwise take.
    expect(browseRules.length).toBeGreaterThan(8);
    expect(() => rule('.qsets-browse-pill')).not.toThrow();
    expect(() => rule('.qsets-browse-pill--on')).not.toThrow();
  });
});

describe('every ink the browse paints, on the ground it really sits on', () => {
  const pairs = [
    ['the lede and the section heads (--muted on the card)', T.muted, CARD],
    ['a pill label at rest (--text on the card)', T.text, CARD],
    ['the Show-all link (--primary on the card)', T.primary, CARD],
    ['a hovered pill', T.text, [...CARD, tint('--qsets-row-hover')]],
    ['the count inside a hovered pill', T.muted, [...CARD, tint('--qsets-row-hover')]],
    ['the shelf in force, which is amber on an amber tint', T.primary, [...CARD, tint('--qsets-tint-warn')]],
    ['the find box, which is --bg inside the --surface card', T.text, [...CARD, T.bg]],
  ];

  test.each(pairs)('%s clears AA', (_label, fg, layers) => {
    expect(on(fg, layers)).toBeGreaterThanOrEqual(AA);
  });

  test('the pill tint is measured three layers deep, not two', () => {
    // The table's own tinted tiers sit straight on the work field; these sit
    // inside a --surface card. Same tint, different composite — rejects:
    // assuming questionSetsPalette's two-layer numbers cover this one.
    expect(composited([...CARD, tint('--qsets-tint-warn')]))
      .not.toEqual(composited([T.bg, tint('--qsets-tint-warn')]));
  });
});

describe('the browse brings no colour of its own', () => {
  test('every colour it paints is a token or a tint this screen already declares', () => {
    // rejects: a hex literal, or an rgba mixed by hand for one pill, which is
    // how a screen ends up with four greys nobody can name.
    const values = browseRules
      .flatMap((r) => r.body.split(';'))
      .filter((line) => /(^|[^-])\b(color|background|background-color|border-color|border)\s*:/.test(line))
      .map((line) => line.split(':').slice(1).join(':').trim());
    const offenders = values.filter((value) => /#[0-9A-Fa-f]{3,8}|rgba?\(/.test(value));
    expect(offenders).toEqual([]);
  });

  test('every custom property it reaches for is declared', () => {
    // An undefined custom property invalidates the WHOLE declaration, not just
    // the value. rejects: --success-text or --font-mono, which exist only on
    // stylesheets that happen to be in the bundle today.
    const declared = new Set();
    for (const css of [GLOBAL_CSS, QS_CSS, read('components', 'AdminShell.css')]) {
      for (const m of css.matchAll(/(--[a-z0-9-]+)\s*:/gi)) declared.add(m[1]);
    }
    const used = browseRules.flatMap((r) => [...r.body.matchAll(/var\((--[a-z0-9-]+)/gi)].map((m) => m[1]));
    expect([...new Set(used)].filter((name) => !declared.has(name))).toEqual([]);
  });

  test('nothing is set below the 12px floor', () => {
    // RATIONALE §3: 12 is the floor for a laptop surface, and a pill is the
    // exact control somebody is tempted to shrink to fit one more on a row.
    const sizes = browseRules.flatMap((r) => [...r.body.matchAll(/font-size:\s*(\d+)px/g)].map((m) => Number(m[1])));
    expect(sizes.filter((px) => px < 12)).toEqual([]);
  });
});

describe('the shelf in force is not signalled by colour alone', () => {
  test('the pressed pill changes its border as well as its ground', () => {
    // Colour-only state is invisible to the people who most need the cue, and
    // `aria-pressed` alone is invisible to everyone who can see. rejects:
    // dropping the border change the next time the tint is adjusted.
    const on1 = rule('.qsets-browse-pill--on');
    expect(on1).toMatch(/background:/);
    expect(on1).toMatch(/border-color:/);
  });
});
