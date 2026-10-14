/**
 * THE POLL GENERATOR'S PALETTE — components/PollAIBuilder.css.
 *
 * Named *Palette, never *Token*: `.gitignore` carries an unanchored `*token*`,
 * so a file named for tokens is invisible to git — it passes here and never
 * reaches CI.
 *
 * jest maps CSS to identity-obj-proxy and loads no stylesheet, and jsdom
 * resolves no custom property across files, so the only honest check is to
 * read the sheets as text and do the arithmetic. Green here means "the
 * measured contract has not been reverted", not "this looks right in a
 * browser" — only a browser can say that.
 *
 * TWO GROUNDS. The kinds picker is on the builder modal, which is white
 * (BuilderPage.css); the edit card is the set editor's dusk question form on
 * its own `--surface`, declared `data-theme="dark"` on its own root. The first
 * block holds both premises, so the day either changes this file says every
 * number below it is measured on the wrong ground.
 */
const fs = require('fs');
const path = require('path');
const H = require('../testing/skinHarness');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const GLOBAL_CSS = require('../testing/classicGlobalCss')();
const BUILDER_CSS = read('BuilderPage.css');
const PAB_CSS = read('components', 'PollAIBuilder.css');
const PAB_JSX = read('components', 'PollAIBuilder.jsx');

/* ---- colour: lifted verbatim from docs/design/admin-redesign/audit.html ---- */
function lin(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function lum(c) { return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]); }
function ratio(a, b) {
  const la = lum(a); const lb = lum(b);
  const h = Math.max(la, lb); const l = Math.min(la, lb);
  return (h + 0.05) / (l + 0.05);
}
const parseHex = (h) => [1, 3, 5].map((i) => parseInt(h.substr(i, 2), 16));

const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

function block(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = stripComments(css).match(new RegExp(`(^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`, 'm'));
  if (!match) throw new Error(`No rule for "${selector}" — renamed?`);
  return match[2];
}

/* The .pab block now writes one role (`--pab-on-accent: var(--on-accent)`) beside its
   literals, so a token is RESOLVED through the skin harness rather than grepped as a hex.
   The .pab block paints the white builder modal (paper), so it resolves in theme 'light';
   the edit card declares data-theme="dark" on its own root, so its inks resolve in 'dark'. */
const SKIN_IDS = [...new Set(H.CASES.map(([skin]) => skin))];
const hexOf = (c) => `#${H.parseColor(c).rgb.map((n) => Math.round(n).toString(16).padStart(2, '0')).join('').toUpperCase()}`;

function token(css, selector, name, opts = { skin: 'classic', theme: 'light' }) {
  return hexOf(H.scopeVar(css, `${selector} {`, name, opts));
}

const WHITE = '#FFFFFF';
function palette(skin) {
  const paper = { skin, theme: 'light' };
  const dusk = { skin, theme: 'dark' };
  return {
    text: token(PAB_CSS, '.pab', '--pab-text', paper),
    muted: token(PAB_CSS, '.pab', '--pab-muted', paper),
    edge: token(PAB_CSS, '.pab', '--pab-edge', paper),
    quiet: token(PAB_CSS, '.pab', '--pab-quiet', paper),
    field: token(PAB_CSS, '.pab', '--pab-field', paper),
    onAccent: token(PAB_CSS, '.pab', '--pab-on-accent', paper),
    primary: hexOf(H.role('--primary', dusk)),
    // The dusk card's inks and ground: `[data-theme="dark"]`, which the card
    // declares on its own root.
    duskSurface: hexOf(H.role('--surface', dusk)),
    duskText: hexOf(H.role('--text', dusk)),
    duskMuted: hexOf(H.role('--muted', dusk)),
  };
}
const T = palette('classic');

const AA = 4.5;
const on = (fg, bg) => ratio(parseHex(fg), parseHex(bg));

describe('the grounds this is measured on', () => {
  test('the poll builder modal is white, as the kinds picker\'s numbers assume', () => {
    expect(block(BUILDER_CSS, '.poll-ai-builder-modal .modal-content')).toMatch(/background:\s*white/);
    expect(T.field.toUpperCase()).toBe(WHITE);
  });

  test('the edit card is dusk on its own root, on --surface, inside the editor\'s scope', () => {
    // rejects: dropping data-theme or .qs-editor from the card. The question
    // form paints only inside `.qs-editor` and was measured on dusk; on the
    // white modal without them its --text would be near-white on white.
    expect(PAB_JSX).toMatch(/className="qs-editor pab pab-edit" data-theme="dark"/);
    expect(PAB_JSX).toMatch(/import '\.\/QuestionSetEditor\.css'/);
    expect(block(PAB_CSS, '.pab-edit')).toMatch(/background:\s*var\(--surface\)/);
    expect(block(PAB_CSS, '.pab-edit')).toMatch(/color:\s*var\(--text\)/);
  });
});

describe.each(SKIN_IDS)('%s skin', (skin) => {
  const P = palette(skin);

  describe('every pairing the builder paints clears AA', () => {
    const pairs = [
      ['the kinds label and toggle words on the modal', () => on(P.text, WHITE)],
      ['the kinds help line on the modal', () => on(P.muted, WHITE)],
      ['a hovered toggle word', () => on(P.text, P.quiet)],
      ['a pressed toggle — its word on the amber fill', () => on(P.onAccent, P.primary)],
      ['a note on the dusk card', () => on(P.duskText, P.duskSurface)],
      ['the tags hint on the dusk card', () => on(P.duskMuted, P.duskSurface)],
    ];
    test.each(pairs)('%s', (_label, measure) => {
      expect(measure()).toBeGreaterThanOrEqual(AA);
    });

    test('amber never carries text, on either ground', () => {
      expect(on(P.primary, WHITE)).toBeLessThan(AA);
      const offenders = stripComments(PAB_CSS).split('\n')
        .filter((l) => /(^|[^-])\bcolor\s*:\s*var\(--primary\)/.test(l));
      expect(offenders).toEqual([]);
    });

    test('a toggle is findable by its edge, not only its words (3:1 for a control boundary)', () => {
      expect(on(P.edge, WHITE)).toBeGreaterThanOrEqual(3);
      expect(block(PAB_CSS, '.pab-opt')).toMatch(/border:\s*1px solid var\(--pab-edge\)/);
    });

    test('a pressed toggle says so with a tick as well as the fill', () => {
      expect(block(PAB_CSS, '.pab-tick')).toMatch(/display:\s*none/);
      expect(block(PAB_CSS, '.pab-opt[aria-pressed="true"] .pab-tick')).toMatch(/display:\s*inline/);
    });

    test('a toggle is a 44px target', () => {
      expect(block(PAB_CSS, '.pab-opt')).toMatch(/min-height:\s*44px/);
    });
  });
});

describe('the stylesheet keeps to its own tokens and its own scope', () => {
  test('no hex literal survives outside the .pab token block', () => {
    const outside = stripComments(PAB_CSS).replace(/(^|\})\s*\.pab\s*\{[^}]*\}/, '');
    const literals = [...outside.matchAll(/(?:^|[\s:,(])(#[0-9A-Fa-f]{3,8})\b/g)].map((m) => m[1]);
    expect(literals).toEqual([]);
  });

  test('--danger never carries text here', () => {
    const offenders = PAB_CSS.split('\n').filter((l) => /(^|[^-])\bcolor\s*:\s*var\(--danger\)/.test(l));
    expect(offenders).toEqual([]);
  });

  test('every custom property it uses is declared somewhere', () => {
    const declared = new Set();
    for (const css of [GLOBAL_CSS, PAB_CSS]) {
      for (const m of css.matchAll(/(--[a-z0-9-]+)\s*:/gi)) declared.add(m[1]);
    }
    const used = [...PAB_CSS.matchAll(/var\((--[a-z0-9-]+)/gi)].map((m) => m[1]);
    expect([...new Set(used)].filter((n) => !declared.has(n))).toEqual([]);
  });

  const roots = (css) => {
    const out = new Set();
    for (const blk of stripComments(css).split('}')) {
      const head = blk.split('{')[0];
      if (!head.trim() || head.includes('@')) continue;
      for (const sel of head.split(',')) {
        const m = sel.trim().match(/^[a-zA-Z]*\.([\w-]+)/);
        out.add(m ? m[1] : sel.trim());
      }
    }
    return [...out];
  };

  test('every selector is rooted at .pab', () => {
    expect(roots(PAB_CSS).filter((n) => !/^pab(-|$)/.test(n))).toEqual([]);
  });

  test('neither styles.css nor BuilderPage.css declares anything in .pab', () => {
    for (const css of [GLOBAL_CSS, BUILDER_CSS]) {
      const taken = [...stripComments(css).matchAll(/\.(pab(?:-[\w-]*)?)\b/g)].map((m) => m[1]);
      expect([...new Set(taken)]).toEqual([]);
    }
  });
});

describe('the ladder', () => {
  test('nothing is declared below the 12px floor', () => {
    const px = [...PAB_CSS.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)].map((m) => Number(m[1]));
    expect(px.filter((n) => n < 12)).toEqual([]);
    expect(block(PAB_CSS, '.pab')).toMatch(/--pab-t-label:\s*13px/);
    expect(block(PAB_CSS, '.pab')).toMatch(/--pab-t-body:\s*15px/);
  });

  test('a toggle\'s word is body size', () => {
    expect(block(PAB_CSS, '.pab-opt')).toMatch(/font-size:\s*var\(--pab-t-body\)/);
  });
});
