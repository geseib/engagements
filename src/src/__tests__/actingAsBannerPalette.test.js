/**
 * THE ACTING-AS STRIP'S CSS CONTRACT — components/ActingAsBanner.css.
 *
 * jest maps CSS to identity-obj-proxy and jsdom resolves no custom property
 * across files, so the only honest way to pin a design contract here is to read
 * the stylesheet AS TEXT and do the arithmetic on it. The compositing walk
 * below is lifted verbatim from docs/design/admin-redesign/audit.html, which is
 * where every other *Palette test in this repo got it.
 *
 * THE FILE IS NAMED `*Palette` AND NOT `*Token*` ON PURPOSE. `.gitignore:35` is
 * an unanchored `*token*`: a file named actingAsBannerTokens.test.js runs locally,
 * passes, and never reaches CI. Do not rename it back.
 *
 * WHAT GREEN MEANS HERE: the contrast arithmetic holds and the geometry rules
 * that jsdom cannot see have not been reverted. It cannot prove the screen is
 * readable on a real panel — only a real panel can.
 */
const fs = require('fs');
const path = require('path');
const H = require('../testing/skinHarness');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const GLOBAL_CSS = read('styles.css');
const MY_CSS = read('components', 'ActingAsBanner.css');
const MY_JSX = read('components', 'ActingAsBanner.jsx');

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

/* ---- tokens, READ rather than retyped: change a token and these numbers move.
   Roles come from skinHarness for one skin x theme; the strip's own tint is its
   scope-local custom property with every var() resolved for the same skin. */
const CLASSIC = { skin: 'classic', theme: 'dark' };
const parseHex = (c) => H.parseColor(c).rgb;

function tint(name, opts = CLASSIC) {       // an rgba() layer from MY_CSS's .pmode block
  return H.scopeVar(MY_CSS, '.pmode {', name, opts);
}

const ROOT = ':root {';
/* The strip renders on dusk: every dusk case of every skin. */
const DUSK = H.CASES.filter(([, t]) => t === 'dark');
const tokensFor = (opts) => ({
  bg: H.role('--bg', opts),
  surface: H.role('--surface', opts),
  surface2: H.role('--surface-2', opts),
  text: H.role('--text', opts),
  muted: H.role('--muted', opts),
  primary: H.role('--primary', opts),
  danger: H.role('--danger', opts),
  dangerText: H.role('--danger-text', opts),
  dangerDeep: H.role('--danger-deep', opts),
  /* No success colour on this strip: it has one state and it is a notice, not
     an outcome. Every other screen here declares its own --*-success-text
     because an undefined custom property invalidates the whole declaration. */
});

/** Build the REAL paint stack in the DOM and hand it to the audit's own bgOf. */
function composited(layers) {
  document.body.innerHTML = '';
  let host = document.body;
  for (const background of layers) {
    const el = document.createElement('div');
    const { rgb, a } = H.parseColor(background);   // jsdom reads only the comma form
    el.style.backgroundColor = `rgba(${rgb.join(', ')}, ${a})`;
    host.appendChild(el);
    host = el;
  }
  return bgOf(host, window);
}
const on = (fgHex, layers) => ratio(parseHex(fgHex), composited(layers));

const AA = 4.5;

function block(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`(^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`, 'm'));
  if (!match) throw new Error(`No rule for "${selector}" — renamed?`);
  return match[2];
}

const stripped = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/* ========================================================================== */

describe.each(DUSK)('the strip, composited on the work field — %s / %s', (skin, theme) => {
  const T = tokensFor({ skin, theme });
  /*
    Every pairing here sits on ONE stack: the work field, plus this strip's own
    amber tint. Nothing else nests inside it — it is three elements on a line —
    which is why this file is short where the panel palettes are long.
  */
  const STACK = [T.bg, tint('--pmode-tint', { skin, theme })];

  // rejects: deepening the tint until the sentence stops clearing AA, which is
  // the change somebody makes to "make the warning stand out more".
  test.each([
    ['the emphasised first clause', T.text],
    ['the explanatory sentence', T.muted],
    ['the lock', T.primary],
  ])('%s clears AA on the tinted field', (_label, fg) => {
    expect(on(fg, STACK)).toBeGreaterThanOrEqual(AA);
  });

  // rejects: the filled exit losing contrast — it is the one control here and
  // the whole point of the strip.
  test('the filled exit clears AA', () => {
    expect(on(T.bg, [T.primary])).toBeGreaterThanOrEqual(AA);
  });
});

describe('the rules that are about what must NOT be there', () => {
  // rejects: a raw hex creeping in outside the token block.
  test('no hex literal survives outside the token block', () => {
    const declarations = stripped(MY_CSS)
      .split('}')
      .filter((blk) => !/^\s*\.pmode\s*\{/.test(blk))
      .join('}');
    expect(declarations.match(/#[0-9a-fA-F]{3,8}\b/g) || []).toEqual([]);
  });

  // rejects: a global class. `.pmode` is the whole namespace.
  test('every selector is rooted at the scope class', () => {
    for (const blk of stripped(MY_CSS).split('}')) {
      const head = blk.split('{')[0];
      if (!head.trim() || head.includes('@')) continue;
      for (const sel of head.split(',')) {
        const trimmed = sel.trim();
        if (!trimmed) continue;
        expect(trimmed.startsWith('.pmode')).toBe(true);
      }
    }
  });

  // rejects: styles.css already owning this prefix, which would mean the two
  // stylesheets fight and the winner is import order.
  test('styles.css declares nothing in this scope', () => {
    expect(GLOBAL_CSS).not.toMatch(/(^|[\s,>+~])\.pmode\b/);
  });
});

describe('the ladder and the theme', () => {
  // rejects: anything under the 12px floor.
  test('nothing is declared below the 12px floor', () => {
    const px = [...MY_CSS.matchAll(/font-size:\s*(\d+)px/g)].map((m) => Number(m[1]));
    expect(px.filter((n) => n < 12)).toEqual([]);
  });

  // rejects: relying on an ancestor's theme. public/index.html puts
  // data-theme="light" on <html>, so a dusk surface that inherits renders paper
  // tokens under dusk copy — 1.4:1.
  test('the root element declares data-theme="dark" itself', () => {
    expect(MY_JSX).toMatch(/className="pmode"\s+data-theme="dark"/);
  });
});
