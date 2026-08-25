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
const PAPER = '[data-theme="light"] {';

/*
  BOTH THEMES, AND PAPER IS NOT THE HYPOTHETICAL ONE.

  The first revision of this file measured dusk only, because the stylesheet was
  written against the console's dark work field. This field is not a screen
  root — it declares no theme and inherits — and the builders that host it are
  mounted in AdminPage's top-level fragment, OUTSIDE AdminShell and outside the
  work body, so what they inherit is `data-theme="light"` from
  public/index.html.

  Measuring one theme let `color: var(--bg)` ship on the filled preset. On dusk
  that is #0F1A2E on amber, 8.86:1. On paper — where it actually renders — it is
  #FBF7F1 on amber: 1.84:1, on the single element whose entire job is to say
  which value is current. Every pairing below is asserted on both grounds.
*/
const THEMES = {
  dusk: {
    bg: token(GLOBAL_CSS, DUSK, '--bg'),
    surface: token(GLOBAL_CSS, DUSK, '--surface'),
    surface2: token(GLOBAL_CSS, DUSK, '--surface-2'),
    text: token(GLOBAL_CSS, DUSK, '--text'),
    muted: token(GLOBAL_CSS, DUSK, '--muted'),
  },
  paper: {
    bg: token(GLOBAL_CSS, PAPER, '--bg'),
    surface: token(GLOBAL_CSS, PAPER, '--surface'),
    surface2: token(GLOBAL_CSS, PAPER, '--surface-2'),
    text: token(GLOBAL_CSS, PAPER, '--text'),
    muted: token(GLOBAL_CSS, PAPER, '--muted'),
  },
};

const T = {
  ...THEMES.dusk,
  primary: token(GLOBAL_CSS, ROOT, '--primary'),
  primaryDeep: token(GLOBAL_CSS, ROOT, '--primary-deep'),
  danger: token(GLOBAL_CSS, ROOT, '--danger'),
  dangerText: token(GLOBAL_CSS, ROOT, '--danger-text'),
  dangerDeep: token(GLOBAL_CSS, ROOT, '--danger-deep'),
  /* Read from this stylesheet, not retyped: the ink on the theme-invariant
     accent, which has to be invariant for the same reason. */
  onAccent: token(MY_CSS, '.cnt {', '--cnt-on-accent'),
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

describe.each(Object.entries(THEMES))('the field, composited on %s', (_name, theme) => {
  /*
    Every pairing here sits on ONE stack: the surface the field was dropped on,
    plus this field's own hover tint. Nothing else nests inside it — it is a
    label, a row of chips and a row of controls — which is why this file is
    short where the panel palettes are long.
  */
  const STACK = [theme.bg];

  // rejects: dimming --muted until the label, the endpoints or the spread hint
  // stop clearing AA — the change somebody makes to "quieten the secondary row".
  test.each([
    ['the current value and the typed digits', 'text'],
    ['the label, the track endpoints and the hint', 'muted'],
  ])('%s clears AA', (_label, key) => {
    expect(on(theme[key], STACK)).toBeGreaterThanOrEqual(AA);
  });

  /*
    THE ONE THAT WAS WRONG. The filled preset is the only thing on this control
    that says which value is current, and --primary is theme-invariant, so its
    ink must be too. `var(--bg)` is not: it measures 8.86:1 on dusk and 1.84:1
    on paper, and paper is where the builders render.
  */
  // rejects: the ink on the accent going back to a theme-dependent token.
  test('the filled preset clears AA', () => {
    expect(on(T.onAccent, [T.primary])).toBeGreaterThanOrEqual(AA);
  });

  // rejects: an unselected preset or the typed digits fading into the field.
  test('an unselected preset clears AA, hovered and not', () => {
    expect(on(theme.text, [theme.bg])).toBeGreaterThanOrEqual(AA);
    expect(on(theme.text, [theme.bg, tint('--cnt-hover')])).toBeGreaterThanOrEqual(AA);
  });
});

describe('the track, and the state boundaries that are not text', () => {
  /*
    NOT 4.5:1, AND NOT EVERYTHING. None of this is text, so the bar is WCAG
    1.4.11's 3:1 — and 1.4.11 asks it of the visual information needed to
    IDENTIFY a control and its state, not of every pixel in the widget.

    What that means here, said explicitly so the next person does not either
    over-apply it or quietly drop it:

      HELD to 3:1  the filled portion of the rail (it is the state), the
                   selected preset's boundary (it is the state), and the thumb's
                   hairline (it is how you find and aim at the control).

      NOT held     the UNFILLED remainder of the rail. It is the empty half of
                   a progress bar: context, not state. The value it would be
                   carrying is already stated four other ways in this field — the
                   numeral in the head, the typed box, the filled preset, and the
                   thumb's position between two labelled endpoints — so a low
                   luminance there costs a reader nothing. It is deliberately
                   light, and deliberately not asserted.
  */
  const UI = 3.0;

  // rejects: the fill going back to bright --primary, which is 1.84:1 on paper
  // and therefore invisible on the surface these builders actually render on.
  test.each(Object.entries(THEMES))('the filled rail reads against %s', (_name, theme) => {
    expect(on(T.primaryDeep, [theme.bg])).toBeGreaterThanOrEqual(UI);
    expect(on(T.primaryDeep, [theme.bg, theme.surface])).toBeGreaterThanOrEqual(UI);
  });

  /*
    On paper the ink inside a selected chip and the ink inside an unselected one
    are the same #1B2942, so without this border the whole selected state rests
    on a 1.96:1 fill.
  */
  // rejects: the selected chip's boundary collapsing back into the fill colour.
  test.each(Object.entries(THEMES))('the selected preset is bounded against %s', (_name, theme) => {
    expect(on(T.primaryDeep, [theme.bg, theme.surface])).toBeGreaterThanOrEqual(UI);
    expect(block(MY_CSS, '.cnt-preset.is-on')).toMatch(/border-color:\s*var\(--primary-deep\)/);
  });

  // rejects: dropping the thumb's ring or hairline — together they are the only
  // things separating a bright amber disc from the deep amber bar under it.
  test('the thumb keeps a ring and a hairline', () => {
    const thumb = MY_CSS.slice(MY_CSS.indexOf('.cnt-slider::-webkit-slider-thumb'));
    expect(thumb).toMatch(/border:\s*2px solid var\(--bg\)/);
    expect(thumb).toMatch(/box-shadow:\s*0 0 0 1px var\(--muted\)/);
    for (const theme of Object.values(THEMES)) {
      expect(on(theme.muted, [theme.bg, theme.surface])).toBeGreaterThanOrEqual(UI);
    }
  });
});

describe('the rules that are about what must NOT be there', () => {
  /*
    The defect this file failed to catch, named so it cannot come back by
    somebody "simplifying" the token away.
  */
  // rejects: theme-dependent ink on the theme-invariant accent.
  test('the filled preset does not take its ink from a theme token', () => {
    const rule = block(MY_CSS, '.cnt-preset.is-on');
    expect(rule).toMatch(/color:\s*var\(--cnt-on-accent\)/);
    expect(rule).not.toMatch(/color:\s*var\(--bg\)/);
  });

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
