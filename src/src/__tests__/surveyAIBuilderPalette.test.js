/**
 * THE SURVEY GENERATOR'S PALETTE — components/SurveyAIBuilder.css, plus the
 * Kind chip it adds to components/GeneratedItemsTable.css.
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
 * DERIVED ON WHITE. Mockups 02 and 03 draw the generator on the console's
 * dusk field; it renders inside the builder modal, which is white
 * (BuilderPage.css), exactly as GenerationJobPanel.css and
 * GeneratedItemsTable.css already record for their own mockups. The first
 * test holds that premise, so the day the modal changes colour this file says
 * every number below it is measured against the wrong ground.
 */
const fs = require('fs');
const path = require('path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const GLOBAL_CSS = read('styles.css');
const BUILDER_CSS = read('BuilderPage.css');
const SAB_CSS = read('components', 'SurveyAIBuilder.css');
const GIT_CSS = read('components', 'GeneratedItemsTable.css');

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

function token(css, selector, name) {
  const body = block(css, selector);
  const m = body.match(new RegExp(`${name}\\s*:\\s*(#[0-9A-Fa-f]{6})`));
  if (!m) throw new Error(`${name} not declared in ${selector}`);
  return m[1];
}

const WHITE = '#FFFFFF';
const T = {
  text: token(SAB_CSS, '.sab', '--sab-text'),
  muted: token(SAB_CSS, '.sab', '--sab-muted'),
  edge: token(SAB_CSS, '.sab', '--sab-edge'),
  quiet: token(SAB_CSS, '.sab', '--sab-quiet'),
  field: token(SAB_CSS, '.sab', '--sab-field'),
  onAccent: token(SAB_CSS, '.sab', '--sab-on-accent'),
  chipBg: token(SAB_CSS, '.sab', '--sab-chip-bg'),
  chipFg: token(SAB_CSS, '.sab', '--sab-chip-fg'),
  primary: token(GLOBAL_CSS, ':root', '--primary'),
  gitChipBg: token(GIT_CSS, '.git', '--git-chip-bg'),
  gitChipFg: token(GIT_CSS, '.git', '--git-chip-fg'),
};

const AA = 4.5;
const on = (fg, bg) => ratio(parseHex(fg), parseHex(bg));

describe('the ground this is measured on', () => {
  test('the survey builder modal is white, as every number below assumes', () => {
    expect(block(BUILDER_CSS, '.survey-ai-builder-modal .modal-content')).toMatch(/background:\s*white/);
  });

  test('the inputs are filled with the field token, and it is white', () => {
    expect(T.field.toUpperCase()).toBe(WHITE);
    expect(block(SAB_CSS, '.sab-input')).toMatch(/background:\s*var\(--sab-field\)/);
  });
});

describe('every pairing the generator paints clears AA', () => {
  const pairs = [
    ['labels, answers and toggle words on the modal', () => on(T.text, WHITE)],
    ['help lines, the minutes and "Mix:" on the modal', () => on(T.muted, WHITE)],
    ['a hovered toggle word', () => on(T.text, T.quiet)],
    ['the details summary, hovered', () => on(T.muted, T.quiet)],
    ['a pressed toggle — its word on the amber fill', () => on(T.onAccent, T.primary)],
    ['a kind chip in the mix line', () => on(T.chipFg, T.chipBg)],
    ['a kind chip in the review table', () => on(T.gitChipFg, T.gitChipBg)],
  ];
  test.each(pairs)('%s', (_label, measure) => {
    expect(measure()).toBeGreaterThanOrEqual(AA);
  });

  test('amber never carries text on the white modal', () => {
    // The premise: #F6A94C on white is under 2:1. So it may FILL a pressed
    // toggle (dark words on it), and nothing here may use it as a text colour.
    expect(on(T.primary, WHITE)).toBeLessThan(AA);
    const offenders = stripComments(SAB_CSS).split('\n')
      .filter((l) => /(^|[^-])\bcolor\s*:\s*var\(--primary\)/.test(l));
    expect(offenders).toEqual([]);
  });

  test('a toggle is findable by its edge, not only its words (3:1 for a control boundary)', () => {
    expect(on(T.edge, WHITE)).toBeGreaterThanOrEqual(3);
    expect(block(SAB_CSS, '.sab-opt')).toMatch(/border:\s*1px solid var\(--sab-edge\)/);
  });

  test('a pressed toggle says so with a tick as well as the fill', () => {
    // Mockup 02's note: never the fill alone.
    expect(block(SAB_CSS, '.sab-tick')).toMatch(/display:\s*none/);
    expect(block(SAB_CSS, '.sab-opt[aria-pressed="true"] .sab-tick')).toMatch(/display:\s*inline/);
  });
});

describe('the stylesheet keeps to its own tokens and its own scope', () => {
  test('no hex literal survives outside the .sab token block', () => {
    const outside = stripComments(SAB_CSS).replace(/(^|\})\s*\.sab\s*\{[^}]*\}/, '');
    const literals = [...outside.matchAll(/(?:^|[\s:,(])(#[0-9A-Fa-f]{3,8})\b/g)].map((m) => m[1]);
    expect(literals).toEqual([]);
  });

  test('--danger never carries text here', () => {
    const offenders = SAB_CSS.split('\n').filter((l) => /(^|[^-])\bcolor\s*:\s*var\(--danger\)/.test(l));
    expect(offenders).toEqual([]);
  });

  test('every custom property it uses is declared somewhere', () => {
    const declared = new Set();
    for (const css of [GLOBAL_CSS, SAB_CSS]) {
      for (const m of css.matchAll(/(--[a-z0-9-]+)\s*:/gi)) declared.add(m[1]);
    }
    const used = [...SAB_CSS.matchAll(/var\((--[a-z0-9-]+)/gi)].map((m) => m[1]);
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

  test('every selector is rooted at .sab', () => {
    expect(roots(SAB_CSS).filter((n) => !/^sab(-|$)/.test(n))).toEqual([]);
  });

  test('neither styles.css nor BuilderPage.css declares anything in .sab', () => {
    for (const css of [GLOBAL_CSS, BUILDER_CSS]) {
      const taken = [...stripComments(css).matchAll(/\.(sab(?:-[\w-]*)?)\b/g)].map((m) => m[1]);
      expect([...new Set(taken)]).toEqual([]);
    }
  });
});

describe('the ladder', () => {
  const LADDER = { floor: '12px', label: '13px', body: '15px', head: '19px' };
  test.each(Object.entries(LADDER))('--sab-t-%s is %s', (step, value) => {
    expect(block(SAB_CSS, '.sab')).toMatch(new RegExp(`--sab-t-${step}:\\s*${value}`));
  });

  test('nothing is declared below the 12px floor, in either sheet\'s new rules', () => {
    const px = [...SAB_CSS.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)].map((m) => Number(m[1]));
    expect(px.filter((n) => n < 12)).toEqual([]);
    const kind = ['.git-kind', '.git-kindsel'].map((s) => block(GIT_CSS, s)).join('\n');
    const kindPx = [...kind.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)].map((m) => Number(m[1]));
    expect(kindPx.filter((n) => n < 12)).toEqual([]);
  });

  test('every input renders at body size, the kind select included', () => {
    // The count is CountField's, measured in countFieldPalette.test.js.
    expect(block(SAB_CSS, '.sab-input')).toMatch(/font-size:\s*var\(--sab-t-body\)/);
    expect(block(GIT_CSS, '.git-kindsel')).toMatch(/font-size:\s*15px/);
  });

  test('a toggle is a 36px row, the console\'s row height', () => {
    expect(block(SAB_CSS, '.sab')).toMatch(/--sab-row-h:\s*36px/);
    expect(block(SAB_CSS, '.sab-opt')).toMatch(/min-height:\s*var\(--sab-row-h\)/);
  });

  test('the review table\'s kind chip uses the table\'s own measured chip colours', () => {
    const chip = block(GIT_CSS, '.git-kind');
    expect(chip).toMatch(/background:\s*var\(--git-chip-bg\)/);
    expect(chip).toMatch(/color:\s*var\(--git-chip-fg\)/);
  });
});
