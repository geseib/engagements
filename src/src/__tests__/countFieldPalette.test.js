/**
 * THE COUNT FIELD'S CSS CONTRACT — components/CountField.css.
 *
 * jest maps CSS to identity-obj-proxy and jsdom resolves no custom property
 * across files, so the only honest way to pin a design contract here is to read
 * the stylesheet AS TEXT and do the arithmetic on it. The compositing walk
 * below is lifted verbatim from docs/design/admin-redesign/audit.html, which is
 * where every other *Palette test in this repo got it.
 *
 * THE FILE IS NAMED `*Palette` AND NOT `*Token*` ON PURPOSE. `.gitignore:35` is
 * an unanchored `*token*`: a file named countFieldTokens.test.js runs locally,
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
const MY_CSS = read('components', 'CountField.css');
const MY_JSX = read('components', 'CountField.jsx');

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
  /* No success colour on this strip: it has one state and it is a notice, not
     an outcome. Every other screen here declares its own --*-success-text
     because an undefined custom property invalidates the whole declaration. */
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

describe('the strip, composited on the work field', () => {
  /*
    Every pairing here sits on ONE stack: the work field, plus this strip's own
    amber tint. Nothing else nests inside it — it is three elements on a line —
    which is why this file is short where the panel palettes are long.
  */
  const STACK = [T.bg];

  // rejects: deepening the tint until the sentence stops clearing AA, which is
  // the change somebody makes to "make the warning stand out more".
  test.each([
    ['the current value', T.text],
    ['the label, the range and the hint', T.muted],
  ])('%s clears AA on the tinted field', (_label, fg) => {
    expect(on(fg, STACK)).toBeGreaterThanOrEqual(AA);
  });

  // rejects: the SELECTED preset losing contrast. It is filled with the accent
  // and carries the ground colour as text, and it is the one thing on this
  // control that says which value is current now that no thumb position does.
  test('the filled preset clears AA', () => {
    expect(on(T.bg, [T.primary])).toBeGreaterThanOrEqual(AA);
  });

  // rejects: an unselected preset or the typed digits fading into the field.
  test('an unselected preset and the typed value clear AA', () => {
    expect(on(T.text, [T.bg])).toBeGreaterThanOrEqual(AA);
    expect(on(T.text, [T.bg, tint('--cnt-hover')])).toBeGreaterThanOrEqual(AA);
  });
});

describe('the rules that are about what must NOT be there', () => {
  // rejects: a raw hex creeping in outside the token block.
  test('no hex literal survives outside the token block', () => {
    const declarations = stripped(MY_CSS)
      .split('}')
      .filter((blk) => !/^\s*\.cnt\s*\{/.test(blk))
      .join('}');
    expect(declarations.match(/#[0-9a-fA-F]{3,8}\b/g) || []).toEqual([]);
  });

  // rejects: a global class. `.cnt` is the whole namespace.
  test('every selector is rooted at the scope class', () => {
    for (const blk of stripped(MY_CSS).split('}')) {
      const head = blk.split('{')[0];
      if (!head.trim() || head.includes('@')) continue;
      for (const sel of head.split(',')) {
        const trimmed = sel.trim();
        if (!trimmed) continue;
        expect(trimmed.startsWith('.cnt')).toBe(true);
      }
    }
  });

  // rejects: styles.css already owning this prefix, which would mean the two
  // stylesheets fight and the winner is import order.
  test('styles.css declares nothing in this scope', () => {
    expect(GLOBAL_CSS).not.toMatch(/(^|[\s,>+~])\.cnt\b/);
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
  /*
    THIS ONE IS INVERTED, and deliberately.

    Every other *Palette test here asserts its subject declares `data-theme`
    itself, because those subjects are SCREEN ROOTS and public/index.html puts
    `light` on <html>. This is not a screen — it is a field dropped into
    somebody else's form, several at a time. A theme declared here would
    override whatever surface it lands on and put dusk tokens on a paper panel,
    which is the same 1.4:1 failure from the other direction.

    It inherits, and takes its colours from tokens so that inheriting works.
  */
  // rejects: a nested field stamping a theme onto its host's surface.
  test('it does NOT declare a theme — it inherits the surface it is dropped into', () => {
    expect(MY_JSX).not.toMatch(/data-theme=/);
  });
});
