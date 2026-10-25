/**
 * THE SCENARIO BUILDER'S NEW PIECES — components/AIScenarioBuilder.css
 * ("What the AI is asked", the detail help line, the status line).
 *
 * Named *Palette, never *Token*: `.gitignore` carries an unanchored `*token*`.
 *
 * jsdom loads no stylesheet, so the honest check is to read the sheet as text
 * and do the arithmetic (the skin's surveyAIBuilderPalette.test.js pattern).
 * DERIVED ON WHITE: the builder modal is the global `.modal-content`, white,
 * and the first test holds that premise.
 */
const fs = require('fs');
const path = require('path');
const H = require('../testing/skinHarness');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const GLOBAL_CSS = read('styles.css');
const ROLES_CSS = read('styles', 'roles.css');
const BUILDER_CSS = read('BuilderPage.css');
const ASB_CSS = read('components', 'AIScenarioBuilder.css');

const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
function block(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = stripComments(css).match(new RegExp(`(^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`, 'm'));
  if (!match) throw new Error(`No rule for "${selector}" — renamed?`);
  return match[2];
}
const tok = (name) => {
  const m = block(ASB_CSS, '.asb').match(new RegExp(`${name}:\\s*([^;]+);`));
  if (!m) throw new Error(`${name} is not declared in .asb`);
  return m[1].trim();
};

const WHITE = '#FFFFFF';
const on = (fg, bg) => H.ratio(fg, bg);
const AA = H.AA;

describe('the ground this is measured on', () => {
  test('the builder modal is white, as every number below assumes', () => {
    expect(block(GLOBAL_CSS, '.modal-content')).toMatch(/background:\s*white/);
    expect(block(BUILDER_CSS, '.ai-scenario-builder-modal .modal-content')).not.toMatch(/background/);
  });
});

describe('every pairing clears AA', () => {
  const T = {
    text: tok('--asb-text'), muted: tok('--asb-muted'), quiet: tok('--asb-quiet'),
    tunedFg: tok('--asb-tuned-fg'), tunedBg: tok('--asb-tuned-bg'), link: tok('--asb-link'),
    ok: tok('--asb-ok'), run: tok('--asb-run'),
  };
  test.each([
    ['the base prompt and the run line, on the quiet panel', () => on(T.text, T.quiet), AA],
    ['the help lines and the card name, on the quiet panel', () => on(T.muted, T.quiet), AA],
    ['the detail help line, on the white modal', () => on(T.muted, WHITE), AA],
    ['the "Built in" chip, on the quiet panel', () => on(T.muted, T.quiet), AA],
    ['the "Tuned in your library" chip, on its wash', () => on(T.tunedFg, T.tunedBg), AA],
    ['"Change card", on the quiet panel', () => on(T.link, T.quiet), AA],
    ['the done dot is visible (a mark, 3:1)', () => on(T.ok, T.quiet), 3],
    ['the running dot is visible (a mark, 3:1)', () => on(T.run, T.quiet), 3],
  ])('%s', (_label, measure, floor) => {
    expect(measure()).toBeGreaterThanOrEqual(floor);
  });

  test('amber carries no text here', () => {
    expect(stripComments(ASB_CSS)).not.toMatch(/var\(--primary/);
    expect(stripComments(ASB_CSS)).not.toMatch(/color\s*:\s*var\(--danger\)/);
  });
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

test('the measured numbers in the header comment', () => {
  // Printed so the comment can be kept honest; not asserted beyond AA above.
  const r = (a, b) => Math.round(on(a, b) * 100) / 100;
  const measured = {
    textQuiet: r(tok('--asb-text'), tok('--asb-quiet')),
    mutedWhite: r(tok('--asb-muted'), WHITE),
    mutedQuiet: r(tok('--asb-muted'), tok('--asb-quiet')),
    tuned: r(tok('--asb-tuned-fg'), tok('--asb-tuned-bg')),
    link: r(tok('--asb-link'), tok('--asb-quiet')),
  };
  expect(measured.textQuiet).toBeGreaterThan(AA);
  if (process.env.SHOW_RATIOS) process.stdout.write(`${JSON.stringify(measured)}\n`);
});
