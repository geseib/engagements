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
 * MEASURED ON DUSK. Mockups 02 and 03 draw the generator on the console's
 * dusk field, and since experience plan 5e it renders there: the builders
 * open in one dusk dialog (components/AIBuilderDialog.jsx, `theme="dark"`, a
 * `ui-dialog` on --surface). The sheet's tokens are roles, resolved per skin
 * in theme 'dark'. The first block holds that premise, so the day the window
 * changes colour this file says every number below it is on the wrong ground.
 */
const fs = require('fs');
const path = require('path');
const H = require('../testing/skinHarness');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const GLOBAL_CSS = read('styles.css');
const ROLES_CSS = read('styles', 'roles.css');
const BUILDER_CSS = read('BuilderPage.css');
const SAB_CSS = read('components', 'SurveyAIBuilder.css');
const GIT_CSS = read('components', 'GeneratedItemsTable.css');

/* ---- colour: the audit's lin/lum/ratio (docs/design/admin-redesign/audit.html) live
        verbatim in testing/skinHarness.js; H.ratio is that ratio. ---- */
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

function block(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = stripComments(css).match(new RegExp(`(^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`, 'm'));
  if (!match) throw new Error(`No rule for "${selector}" — renamed?`);
  return match[2];
}

/** A `.sab`/`.git` token, every var() it reads resolved for one skin x theme. The
 *  builders' window is dusk, so the default is Classic / dark. */
const CLASSIC_DUSK = { skin: 'classic', theme: 'dark' };
function token(css, selector, name, opts = CLASSIC_DUSK) {
  block(css, selector);                       // the rule exists — renamed?
  return H.scopeVar(stripComments(css), `${selector} {`, name, opts);
}

const DIALOG_JSX = read('components', 'AIBuilderDialog.jsx');
const palette = (opts) => ({
  text: token(SAB_CSS, '.sab', '--sab-text', opts),
  muted: token(SAB_CSS, '.sab', '--sab-muted', opts),
  edge: token(SAB_CSS, '.sab', '--sab-edge', opts),
  quiet: token(SAB_CSS, '.sab', '--sab-quiet', opts),
  field: token(SAB_CSS, '.sab', '--sab-field', opts),
  onAccent: token(SAB_CSS, '.sab', '--sab-on-accent', opts),
  chipBg: token(SAB_CSS, '.sab', '--sab-chip-bg', opts),
  chipFg: token(SAB_CSS, '.sab', '--sab-chip-fg', opts),
  primary: H.role('--primary', opts),
  surface: H.role('--surface', opts),
  gitChipBg: token(GIT_CSS, '.git', '--git-chip-bg', opts),
  gitChipFg: token(GIT_CSS, '.git', '--git-chip-fg', opts),
});
const T = palette(CLASSIC_DUSK);
const DUSK_CASES = H.CASES.filter(([, t]) => t === 'dark');

const AA = H.AA;
const on = (fg, bg) => H.ratio(fg, bg);
/** A translucent ground (the hover wash) laid over the dialog's card. */
const over = (P, layer) => H.composite([P.surface, layer]);

describe('the ground this is measured on', () => {
  test('the survey builder opens in the dusk dialog, as every number below assumes', () => {
    expect(DIALOG_JSX).toMatch(/theme="dark"/);
    expect(DIALOG_JSX).toMatch(/ui-dialog ui-dialog--full/);
    expect(BUILDER_CSS).not.toMatch(/\.survey-ai-builder-modal/);
  });

  test('the inputs are filled with the field token, the one surface lighter than the card', () => {
    expect(block(SAB_CSS, '.sab')).toMatch(/--sab-field:\s*var\(--surface-2\)/);
    expect(block(SAB_CSS, '.sab-input')).toMatch(/background:\s*var\(--sab-field\)/);
  });
});

describe('the pressed toggle keeps the role for ink on amber', () => {
  test('--sab-on-accent is --on-accent', () => {
    expect(block(SAB_CSS, '.sab')).toMatch(/--sab-on-accent:\s*var\(--on-accent\)/);
  });
});

describe.each(DUSK_CASES)('every pairing the generator paints clears AA — %s / %s', (skin, theme) => {
  const P = palette({ skin, theme });
  const pairs = [
    ['labels, answers and toggle words on the dialog', () => on(P.text, P.surface)],
    ['help lines, the minutes and "Mix:" on the dialog', () => on(P.muted, P.surface)],
    ['a toggle word on its field', () => on(P.text, P.field)],
    ['a hovered toggle word', () => on(P.text, over(P, P.quiet))],
    ['the details summary, hovered', () => on(P.muted, over(P, P.quiet))],
    ['a pressed toggle — its word on the amber fill', () => on(P.onAccent, P.primary)],
    ['a kind chip in the mix line', () => on(P.chipFg, P.chipBg)],
    ['a kind chip in the review table', () => on(P.gitChipFg, P.gitChipBg)],
  ];
  test.each(pairs)('%s', (_label, measure) => {
    expect(measure()).toBeGreaterThanOrEqual(AA);
  });

  test('a toggle\'s edge clears 3:1 on its field', () => {
    expect(on(P.edge, P.field)).toBeGreaterThanOrEqual(3);
  });
});

describe('every pairing the generator paints clears AA', () => {
  test('amber never carries text', () => {
    // It may FILL a pressed toggle (dark words on it, and a tick); nothing
    // here may use it as a text colour.
    const offenders = stripComments(SAB_CSS).split('\n')
      .filter((l) => /(^|[^-])\bcolor\s*:\s*var\(--primary\)/.test(l));
    expect(offenders).toEqual([]);
  });

  test('a toggle is findable by its edge, not only its words (3:1 for a control boundary)', () => {
    expect(on(T.edge, T.field)).toBeGreaterThanOrEqual(3);
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

  test('every custom property it uses is declared somewhere (styles.css, the roles, or here)', () => {
    const declared = new Set();
    for (const css of [GLOBAL_CSS, ROLES_CSS, SAB_CSS]) {
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
