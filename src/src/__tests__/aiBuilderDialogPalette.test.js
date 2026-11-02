/**
 * THE AI BUILDERS' WINDOW, ON DUSK — components/AIBuilderDialog.css and the
 * sheets of the pieces drawn inside it (experience plan 5e).
 *
 * Named *Palette, never *Token*: `.gitignore` carries an unanchored `*token*`.
 *
 * jsdom loads no stylesheet and resolves no custom property, so the only honest
 * check is to read the sheets as text and do the arithmetic, through the skin
 * harness so every skin is measured on its dusk theme. The window is a
 * `ui-dialog` on --surface (components/ui/Dialog.css) declared
 * `data-theme="dark"` by AIBuilderDialog.jsx; a well inside it is --bg; a
 * field or a card to choose is --surface-2.
 *
 * rejects: a paper literal coming back into any of these sheets (each was white
 * paper until 5e and painted #2c3e50 headings, #3498db buttons, #f8f9fa wells);
 * a pairing under AA in any skin; `--danger` carrying words; a borrowed token
 * nobody declares; anything under the 12px floor.
 */
const fs = require('fs');
const path = require('path');
const H = require('../testing/skinHarness');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const GLOBAL_CSS = read('styles.css');
const ROLES_CSS = read('styles', 'roles.css');
const DIALOG_CSS = read('components', 'ui', 'Dialog.css');

const SHEETS = {
  aib: read('components', 'AIBuilderDialog.css'),
  git: read('components', 'GeneratedItemsTable.css'),
  gjp: read('components', 'GenerationJobPanel.css'),
  asb: read('components', 'AIScenarioBuilder.css'),
  pab: read('components', 'PollAIBuilder.css'),
  sab: read('components', 'SurveyAIBuilder.css'),
  append: read('components', 'AppendModeSwitch.css'),
  bgf: read('components', 'BatchGuidanceField.css'),
};
const QE_CSS = read('components', 'QuestionSetEditor.css');

const DUSK_SKINS = [...new Set(H.CASES.filter(([, t]) => t === 'dark').map(([skin]) => skin))];
const AA = H.AA;

describe('the window is dusk, declared on itself', () => {
  const jsx = read('components', 'AIBuilderDialog.jsx');
  test('Modal + the shared dialog look, theme declared, .qs-editor for the borrowed controls', () => {
    expect(jsx).toMatch(/import Modal from '\.\/Modal'/);
    expect(jsx).toMatch(/import \{ DialogHead, DialogFoot \} from '\.\/ui\/DialogParts'/);
    expect(jsx).toMatch(/theme="dark"/);
    expect(jsx).toMatch(/ui-dialog ui-dialog--full qs-editor aib/);
    expect(jsx).toMatch(/import '\.\/QuestionSetEditor\.css'/);
  });
  test('the scrim rides the shared .ui-scrim, which is fixed', () => {
    expect(DIALOG_CSS).toMatch(/\.ui-scrim \{[^}]*position: fixed/);
    expect(stripComments(SHEETS.aib)).toMatch(/\.aib-scrim \{ --ui-scrim-z: 10010; \}/);
  });
});

describe('no paper literal survives in any of the window\'s sheets', () => {
  // The pragma counts, and they are zero where 5e left them (literals the gate counts).
  test.each(Object.entries(SHEETS))('%s carries no hex colour outside a comment', (name, css) => {
    const hex = [...stripComments(css).matchAll(/(?:^|[\s:,(])(#[0-9A-Fa-f]{3,8})\b/g)].map((m) => m[1]);
    expect(hex).toEqual([]);
  });

  test('AIBuilderDialog.css reads roles only — not even an rgba() literal', () => {
    expect(stripComments(SHEETS.aib)).not.toMatch(/rgba?\(\s*\d/);
  });

  test.each(Object.entries(SHEETS))('%s: --danger never carries words', (name, css) => {
    const lines = stripComments(css).split('\n').filter((l) => /(^|[^-])\bcolor\s*:\s*var\(--danger\)/.test(l));
    expect(lines).toEqual([]);
  });

  test.each(Object.entries(SHEETS))('%s: every custom property it reads is declared somewhere', (name, css) => {
    const declared = new Set();
    for (const sheet of [GLOBAL_CSS, ROLES_CSS, DIALOG_CSS, QE_CSS, css]) {
      for (const m of sheet.matchAll(/(--[a-z0-9-]+)\s*:/gi)) declared.add(m[1]);
    }
    const used = [...stripComments(css).matchAll(/var\((--[a-z0-9-]+)/gi)].map((m) => m[1]);
    expect([...new Set(used)].filter((n) => !declared.has(n))).toEqual([]);
  });

  test('AIBuilderDialog.css: every selector is rooted in its scope, and nothing below the 12px floor', () => {
    const roots = new Set();
    for (const blk of stripComments(SHEETS.aib).split('}')) {
      const head = blk.split('{')[0];
      if (!head.trim() || head.includes('@')) continue;
      for (const sel of head.split(',')) {
        const m = sel.trim().match(/^\.([\w-]+)/);
        roots.add(m ? m[1] : sel.trim());
      }
    }
    expect([...roots].filter((n) => !/^aib(-|$)/.test(n))).toEqual([]);
    const px = [...SHEETS.aib.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)].map((m) => Number(m[1]));
    expect(px.filter((n) => n < 12)).toEqual([]);
    for (const n of ['git', 'gjp']) {
      const sub = [...SHEETS[n].matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)].map((m) => Number(m[1]));
      expect(sub.filter((x) => x < 12)).toEqual([]);
    }
  });

  test('styles.css declares nothing in .aib', () => {
    expect([...stripComments(GLOBAL_CSS).matchAll(/\.(aib(?:-[\w-]*)?)\b/g)]).toHaveLength(0);
  });
});

describe.each(DUSK_SKINS)('%s: every pairing in the window clears AA on dusk', (skin) => {
  const dusk = { skin, theme: 'dark' };
  const role = (n) => H.role(n, dusk);
  const scoped = (sheet, sel, n) => H.scopeVar(SHEETS[sheet], `${sel} {`, n, dusk);
  const surface = role('--surface');
  const well = role('--bg');
  const field = role('--surface-2');
  const okTint = H.composite([well, scoped('aib', '.aib', '--aib-ok-tint')]);

  test.each([
    ['text on the window', () => H.ratio(role('--text'), surface)],
    ['muted on the window (labels, hints, card blurbs)', () => H.ratio(role('--muted'), surface)],
    ['text in a well (the one-at-a-time nav, the preview)', () => H.ratio(role('--text'), well)],
    ['muted in a well (the counter)', () => H.ratio(role('--muted'), well)],
    ['text on a field and a template card', () => H.ratio(role('--text'), field)],
    ['muted on a template card', () => H.ratio(role('--muted'), field)],
    ['a correct option\'s words on its success tint', () => H.ratio(role('--text'), okTint)],
    ['the "Correct" word on the success tint', () => H.ratio(role('--success-text'), okTint)],
    ['the review table\'s words', () => H.ratio(scoped('git', '.git', '--git-text'), surface)],
    ['the review table\'s muted line', () => H.ratio(scoped('git', '.git', '--git-muted'), surface)],
    ['the review table\'s flag', () => H.ratio(scoped('git', '.git', '--git-danger'), surface)],
    ['the review table\'s chip', () => H.ratio(scoped('git', '.git', '--git-chip-fg'), scoped('git', '.git', '--git-chip-bg'))],
    ['the job panel\'s words in its well', () => H.ratio(scoped('gjp', '.gjp', '--gjp-text'), scoped('gjp', '.gjp', '--gjp-quiet'))],
    ['the job panel\'s muted line in its well', () => H.ratio(scoped('gjp', '.gjp', '--gjp-muted'), scoped('gjp', '.gjp', '--gjp-quiet'))],
    ['the job panel\'s error on its tint', () => H.ratio(scoped('gjp', '.gjp', '--gjp-danger'), H.composite([surface, scoped('gjp', '.gjp', '--gjp-danger-bg')]))],
    ['the batch guidance hint', () => H.ratio(H.scopeVar(SHEETS.bgf, '.bgf {', '--bgf-muted', dusk), surface)],
  ])('%s', (_label, measure) => {
    expect(measure()).toBeGreaterThanOrEqual(AA);
  });
});
