/**
 * THE SCENARIO BUILDER'S NEW PIECES — components/AIScenarioBuilder.css
 * ("What the AI is asked", the detail help line, the status line).
 *
 * Named *Palette, never *Token*: `.gitignore` carries an unanchored `*token*`.
 *
 * jsdom loads no stylesheet, so the honest check is to read the sheet as text
 * and do the arithmetic (the skin's surveyAIBuilderPalette.test.js pattern).
 * MEASURED ON DUSK since experience plan 5e: the builders open in one dusk
 * dialog (components/AIBuilderDialog.jsx, a `ui-dialog` on --surface), and the
 * `.asb` tokens are roles, resolved per skin in theme 'dark'. The first test
 * holds that premise.
 */
const fs = require('fs');
const path = require('path');
const H = require('../testing/skinHarness');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const GLOBAL_CSS = read('styles.css');
const ROLES_CSS = read('styles', 'roles.css');
const BUILDER_CSS = read('BuilderPage.css');
const ASB_CSS = read('components', 'AIScenarioBuilder.css');
const DIALOG_JSX = read('components', 'AIBuilderDialog.jsx');

const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
function block(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = stripComments(css).match(new RegExp(`(^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`, 'm'));
  if (!match) throw new Error(`No rule for "${selector}" — renamed?`);
  return match[2];
}

const on = (fg, bg) => H.ratio(fg, bg);
const AA = H.AA;
const DUSK_SKINS = [...new Set(H.CASES.filter(([, t]) => t === 'dark').map(([skin]) => skin))];

/** Every .asb token, resolved for one skin on dusk; translucent ones laid over their ground. */
function palette(skin) {
  const dusk = { skin, theme: 'dark' };
  const tok = (name) => H.scopeVar(ASB_CSS, '.asb {', name, dusk);
  const surface = H.role('--surface', dusk);
  const quiet = H.composite([surface, tok('--asb-quiet')]);
  return {
    surface, quiet,
    text: tok('--asb-text'), muted: tok('--asb-muted'),
    tunedFg: tok('--asb-tuned-fg'), tunedBg: H.composite([quiet, tok('--asb-tuned-bg')]),
    link: tok('--asb-link'), ok: tok('--asb-ok'), run: tok('--asb-run'),
  };
}
const T = palette('classic');

describe('the ground this is measured on', () => {
  test('the scenario builder opens in the dusk dialog, as every number below assumes', () => {
    expect(DIALOG_JSX).toMatch(/theme="dark"/);
    expect(DIALOG_JSX).toMatch(/ui-dialog ui-dialog--full/);
    expect(BUILDER_CSS).not.toMatch(/\.ai-scenario-builder-modal/);
  });
});

describe.each(DUSK_SKINS)('%s: every pairing clears AA', (skin) => {
  const P = palette(skin);
  test.each([
    ['the base prompt and the run line, on the quiet panel', () => on(P.text, P.quiet), AA],
    ['the help lines and the card name, on the quiet panel', () => on(P.muted, P.quiet), AA],
    ['the detail help line, on the dialog', () => on(P.muted, P.surface), AA],
    ['the "Tuned in your library" chip, on its wash', () => on(P.tunedFg, P.tunedBg), AA],
    ['"Change card", on the quiet panel', () => on(P.link, P.quiet), AA],
    ['the done dot is visible (a mark, 3:1)', () => on(P.ok, P.quiet), 3],
    ['the running dot is visible (a mark, 3:1)', () => on(P.run, P.quiet), 3],
  ])('%s', (_label, measure, floor) => {
    expect(measure()).toBeGreaterThanOrEqual(floor);
  });
});

test('amber carries no text here', () => {
  expect(stripComments(ASB_CSS)).not.toMatch(/var\(--primary/);
  expect(stripComments(ASB_CSS)).not.toMatch(/color\s*:\s*var\(--danger\)/);
});

describe('the stylesheet keeps to its own tokens and its own scope', () => {
  test('no hex literal survives outside the .asb token block', () => {
    const outside = stripComments(ASB_CSS).replace(/(^|\})\s*\.asb\s*\{[^}]*\}/, '');
    expect([...outside.matchAll(/(?:^|[\s:,(])(#[0-9A-Fa-f]{3,8})\b/g)].map((m) => m[1])).toEqual([]);
  });

  test('every custom property it uses is declared (styles.css, the roles, or here)', () => {
    const declared = new Set();
    for (const css of [GLOBAL_CSS, ROLES_CSS, ASB_CSS]) {
      for (const m of css.matchAll(/(--[a-z0-9-]+)\s*:/gi)) declared.add(m[1]);
    }
    const used = [...ASB_CSS.matchAll(/var\((--[a-z0-9-]+)/gi)].map((m) => m[1]);
    expect([...new Set(used)].filter((n) => !declared.has(n))).toEqual([]);
  });

  test('every selector is rooted at .asb, and no other sheet declares in .asb', () => {
    const roots = new Set();
    for (const blk of stripComments(ASB_CSS).split('}')) {
      const head = blk.split('{')[0];
      if (!head.trim() || head.includes('@')) continue;
      for (const sel of head.split(',')) {
        const m = sel.trim().match(/^[a-zA-Z]*\.([\w-]+)/);
        roots.add(m ? m[1] : sel.trim());
      }
    }
    expect([...roots].filter((n) => !/^asb(-|$)/.test(n))).toEqual([]);
    for (const css of [GLOBAL_CSS, BUILDER_CSS]) {
      expect([...stripComments(css).matchAll(/\.(asb(?:-[\w-]*)?)\b/g)].map((m) => m[1])).toEqual([]);
    }
  });

  test('the ladder: 12 / 13 / 15, nothing below the floor', () => {
    expect(block(ASB_CSS, '.asb')).toMatch(/--asb-t-floor:\s*12px/);
    expect(block(ASB_CSS, '.asb')).toMatch(/--asb-t-label:\s*13px/);
    expect(block(ASB_CSS, '.asb')).toMatch(/--asb-t-body:\s*15px/);
    const px = [...ASB_CSS.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)].map((m) => Number(m[1]));
    expect(px.filter((n) => n < 12)).toEqual([]);
  });

  test('the truncating card name is a single text node with min-width 0 (and the JSX carries title=)', () => {
    const rule = block(ASB_CSS, '.asb-asked .asb-asked-card');
    expect(rule).toMatch(/min-width:\s*0/);
    expect(rule).toMatch(/text-overflow:\s*ellipsis/);
    expect(read('components', 'AIScenarioBuilder.jsx')).toMatch(/className="asb-asked-card" title=\{selectedCard\.title\}>\{selectedCard\.title\}</);
  });
});

test('the measured numbers, printed for the header comment', () => {
  // Printed so the comment can be kept honest; not asserted beyond AA above.
  const r = (a, b) => Math.round(on(a, b) * 100) / 100;
  const measured = {
    textQuiet: r(T.text, T.quiet),
    mutedSurface: r(T.muted, T.surface),
    mutedQuiet: r(T.muted, T.quiet),
    tuned: r(T.tunedFg, T.tunedBg),
    link: r(T.link, T.quiet),
  };
  expect(measured.textQuiet).toBeGreaterThan(AA);
  if (process.env.SHOW_RATIOS) process.stdout.write(`${JSON.stringify(measured)}\n`);
});
