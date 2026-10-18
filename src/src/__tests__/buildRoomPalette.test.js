/**
 * THE BUILD ROOM'S DESIGN CONTRACT — buildroom/BuildRoom.css (`.brm`, dusk)
 * and buildroom/BuildReport.css (`.brr`, paper).
 *
 * Named *Palette*, never *Token*: .gitignore carries an unanchored `*token*`,
 * and a file named for tokens would pass here and never reach CI.
 *
 * jsdom loads no stylesheet and resolves no custom property, so this reads
 * both sheets as text and does the arithmetic: every pairing either surface
 * paints is composited up its real ancestor stack (the audit's own bgOf) and
 * must clear AA 4.5:1, tints included. Then the house rules: no hex outside
 * the token block, --danger never carries text, every var() is declared,
 * every selector is rooted in its scope and styles.css declares nothing
 * there, the ladder, the 12px floor, 36px rows, and the dialog scrim that
 * scrolls instead of centring.
 *
 * Green here means "the contract has not been reverted", not "this reads well
 * on a projector": only a real room can say that.
 */
const fs = require('fs');
const path = require('path');
const H = require('../testing/skinHarness');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const GLOBAL_CSS = require('../testing/classicGlobalCss')();
// The stage's ladders (--t-*), loaded app-wide by index.jsx: the Build Room's
// Stage screen sizes its ask from them, as the regular stage does.
const STAGE_CSS = read('styles', 'stage.css');
const ROOM_CSS = read('buildroom', 'BuildRoom.css');
const REPORT_CSS = read('buildroom', 'BuildReport.css');

/* Composite with the harness (the audit's bgOf as arithmetic; it reads rgb(var() / a)
   channel forms, which jsdom's style parser does not). */
const on = (fg, layers) => H.on(fg, layers);
const AA = H.AA;

const ROOM = '.brm {';
const REPORT = '.brr {';

/* Values RESOLVED per skin through the harness (skins -> roles -> the scope block), never
   retyped. The room renders dusk (every .brm root is data-theme="dark", asserted below) and
   the report paper (data-theme="light"), in every skin. */
function dusk(skin) {
  const r = (name) => H.role(name, { skin, theme: 'dark' });
  const v = (name) => H.scopeVar(ROOM_CSS, ROOM, name, { skin, theme: 'dark' });
  return {
    bg: r('--bg'), surface: r('--surface'), surface2: r('--surface-2'), text: r('--text'),
    muted: r('--muted'), primary: r('--primary'), secondary: r('--secondary'), success: r('--success'),
    danger: r('--danger'), dangerText: r('--danger-text'), dangerDeep: r('--danger-deep'),
    successText: v('--brm-success-text'), term: v('--brm-term'), termText: v('--brm-term-text'),
  };
}
function paper(skin) {
  const r = (name) => H.role(name, { skin, theme: 'light' });
  const v = (name) => H.scopeVar(REPORT_CSS, REPORT, name, { skin, theme: 'light' });
  return {
    bg: r('--bg'), surface: r('--surface'), surface2: r('--surface-2'), text: r('--text'),
    muted: r('--muted'), amber: v('--brr-amber'), link: v('--brr-link'), desk: v('--brr-desk'),
  };
}
const D = dusk('classic');   // skin-invariant premises in the house rules below

test('Classic is unchanged: the room and report tokens resolve to their pre-skin literals', () => {
  const room = (n) => H.parseColor(H.scopeVar(ROOM_CSS, ROOM, n, { skin: 'classic', theme: 'dark' }));
  expect(room('--brm-tint-amber')).toEqual(H.parseColor('rgba(246, 169, 76, 0.13)'));
  expect(room('--brm-tint-amber-soft')).toEqual(H.parseColor('rgba(246, 169, 76, 0.08)'));
  expect(room('--brm-tint-blue')).toEqual(H.parseColor('rgba(124, 167, 230, 0.14)'));
  expect(room('--brm-line-amber')).toEqual(H.parseColor('rgba(246, 169, 76, 0.45)'));
  expect(room('--brm-line-blue')).toEqual(H.parseColor('rgba(124, 167, 230, 0.55)'));
  expect(room('--brm-rule')).toEqual(H.parseColor('rgba(155, 168, 190, 0.22)'));
  expect(room('--brm-success-text')).toEqual(H.parseColor('#6FD0A4'));
  expect(room('--brm-qr-scrim')).toEqual(H.parseColor('rgba(15, 26, 46, 0.94)'));
  expect(H.parseColor(paper('classic').amber)).toEqual(H.parseColor('#9A5B18'));
});

describe.each(H.SKINS)('the room (dusk, %s): flat pairings', (skin) => {
  const D = dusk(skin);   // eslint-disable-line no-shadow
  const FIELD = [D.bg];
  const PANEL = [D.bg, D.surface];
  const pairs = [
    ['--text on the field (the question, the ticker)', D.text, FIELD],
    ['--text on a panel (rows, timeline, dialogs)', D.text, PANEL],
    ['--text on --surface-2 (buttons, notices, step numbers)', D.text, [D.bg, D.surface2]],
    ['--muted on the field (hints, eyebrow, counts)', D.muted, FIELD],
    ['--muted on a panel (labels, times, names)', D.muted, PANEL],
    ['--primary on the field (join code, big letter A)', D.primary, FIELD],
    ['--primary on a panel (choice A, kind, code in the bar)', D.primary, PANEL],
    ['--secondary on a panel (choice B, Claude on the timeline, links)', D.secondary, PANEL],
    ['--secondary on the field (ticker kind, links)', D.secondary, FIELD],
    ['success text on a panel (choice C, "Room said")', D.successText, PANEL],
    ['--danger-text on a panel (Discard, Delete)', D.dangerText, PANEL],
    ['--danger-text on the field (the inbox Dismiss)', D.dangerText, FIELD],
    ['--bg on --primary (the filled button, letter A)', D.bg, [D.primary]],
    ['--bg on --secondary (letter B)', D.bg, [D.secondary]],
    ['--bg on --success (letter C, a done step)', D.bg, [D.success]],
    ['--text on --danger-deep (End session)', D.text, [D.dangerDeep]],
    ['terminal text on the command block', D.termText, [D.term]],
  ];
  test.each(pairs)('%s clears AA', (_l, fg, layers) => {
    expect(on(fg, layers)).toBeGreaterThanOrEqual(AA);
  });
});

describe.each(H.SKINS)('the room (dusk, %s): tinted composites', (skin) => {
  const D = dusk(skin);   // eslint-disable-line no-shadow
  const rt = (name) => H.scopeVar(ROOM_CSS, ROOM, name, { skin, theme: 'dark' });
  const cases = [
    ['amber chip on a panel', D.primary, [D.bg, D.surface, rt('--brm-tint-amber')]],
    ['amber chip in the asks table', D.primary, [D.bg, D.surface, rt('--brm-tint-amber')]],
    ['live chip (green) on a panel', D.successText, [D.bg, D.surface, rt('--brm-tint-green')]],
    ['connected chip (blue) in the header bar', D.secondary, [D.bg, D.surface, rt('--brm-tint-blue')]],
    ['a folded chip (blue) in the decide panel', D.secondary, [D.bg, D.surface, rt('--brm-tint-blue')]],
    ['error text on the field', D.dangerText, [D.bg, rt('--brm-tint-red')]],
    ['error text inside a dialog', D.dangerText, [D.bg, D.surface, rt('--brm-tint-red')]],
    ['latest decision text on the field', D.text, [D.bg, rt('--brm-tint-amber-soft')]],
    ['latest decision kind on the field', D.primary, [D.bg, rt('--brm-tint-amber-soft')]],
    ['the current row in the asks table', D.text, [D.bg, D.surface, rt('--brm-tint-amber-soft')]],
    ['the current row number', D.muted, [D.bg, D.surface, rt('--brm-tint-amber-soft')]],
    ['the key warning in the Connect dialog', D.text, [D.bg, D.surface, rt('--brm-tint-amber-soft')]],
    ['the key warning lead', D.primary, [D.bg, D.surface, rt('--brm-tint-amber-soft')]],
    ['the selected kind in Ask the room', D.primary, [D.bg, D.surface, rt('--brm-tint-amber')]],
    ['the sent line in the Now column', D.text, [D.bg, rt('--brm-tint-green')]],
  ];
  test.each(cases)('%s clears AA', (_l, fg, layers) => {
    expect(on(fg, layers)).toBeGreaterThanOrEqual(AA);
  });
});

/* THE ROOM'S RESULT (docs/design/room-content-v2 frame 8): the votes rise inside
   each option card as a fill, so every word on a card is composited over the
   fill at its full height (a 100% option); the pick's card, badge, count and
   quote take the gold role; the "Sent to Claude" band sits on a panel. */
describe.each(H.SKINS)("the room's result (dusk, %s)", (skin) => {
  const D = dusk(skin);   // eslint-disable-line no-shadow
  const rt = (name) => H.scopeVar(ROOM_CSS, ROOM, name, { skin, theme: 'dark' });
  const gold = H.role('--gold', { skin, theme: 'dark' });
  const accentText = H.role('--accent-text', { skin, theme: 'dark' });
  const FILL = [D.bg, D.surface, rt('--brm-fill')];
  const PICK = [D.bg, D.surface, rt('--brm-fill-pick')];
  const cases = [
    ['an option title over the fill', D.text, FILL],
    ['an option detail over the fill', D.muted, FILL],
    ['the count and its words over the fill', D.muted, FILL],
    ['the pick\'s title over its fill', D.text, PICK],
    ['the pick\'s detail over its fill', D.muted, PICK],
    ['the pick\'s count in gold over its fill', gold, PICK],
    ['the pick\'s quoted reason over its fill', D.text, PICK],
    ['an option\'s detail before the fill reaches it', D.muted, [D.bg, D.surface]],
    ['the badge: --bg on --gold', D.bg, [gold]],
    ['the Sent to Claude label on the band', accentText, [D.bg, D.surface]],
    ['the direction on the band', D.text, [D.bg, D.surface]],
    ['the pickup line on the band', D.muted, [D.bg, D.surface]],
    ['the cue on the field', D.muted, [D.bg]],
    ['a rating step while the room rates', D.text, [D.bg, D.surface]],
  ];
  test.each(cases)('%s clears AA', (_l, fg, layers) => {
    expect(on(fg, layers)).toBeGreaterThanOrEqual(AA);
  });
});

describe.each(H.SKINS)('the report (paper, %s)', (skin) => {
  const P = paper(skin);
  const SHEET = [P.surface];
  const pairs = [
    ['--text on the sheet', P.text, SHEET],
    ['--muted on the sheet (meta, times, counts)', P.muted, SHEET],
    ['the people chips: --text on --surface-2', P.text, [P.surface2]],
    ['--muted on --surface-2 (counts beside a bar)', P.muted, [P.surface2]],
    ['amber on the sheet (the Goal label)', P.amber, SHEET],
    ['amber on --surface-2 (the Direction label)', P.amber, [P.surface2]],
    ['--text on --surface-2 (the direction)', P.text, [P.surface2]],
    ['a link on the sheet', P.link, SHEET],
    ['the filled Print button', P.surface, [P.text]],
    ['the ghost Back button on the desk', P.text, [P.desk]],
  ];
  test.each(pairs)('%s clears AA', (_l, fg, layers) => {
    expect(on(fg, layers)).toBeGreaterThanOrEqual(AA);
  });

  test('--primary cannot carry text on paper, which is why the report has its own amber', () => {
    expect(H.ratio(D.primary, P.surface)).toBeLessThan(AA);
    expect(REPORT_CSS.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/var\(--primary\)/);
  });
});

const stripped = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

describe.each([
  ['BuildRoom.css', ROOM_CSS, 'brm', ROOM],
  ['BuildReport.css', REPORT_CSS, 'brr', REPORT],
])('%s house rules', (_file, CSS, scope, block) => {
  test('no hex literal survives outside the token block', () => {
    const start = CSS.indexOf(block);
    const declarations = stripped(CSS.slice(0, start) + CSS.slice(CSS.indexOf('}', start) + 1));
    const literals = [...declarations.matchAll(/(?:^|[\s:,(])(#[0-9A-Fa-f]{3,8})\b/g)].map((m) => m[1]);
    expect(literals).toEqual([]);
  });

  test('--danger never carries text', () => {
    expect(H.ratio(D.danger, D.surface)).toBeLessThan(AA);
    const offenders = CSS.split('\n').filter((l) => /(^|[^-])\bcolor\s*:\s*var\(--danger\)/.test(l));
    expect(offenders).toEqual([]);
  });

  test('every custom property used is declared somewhere', () => {
    const declared = new Set();
    for (const css of [GLOBAL_CSS, STAGE_CSS, CSS]) {
      for (const m of css.matchAll(/(--[a-z0-9-]+)\s*:/gi)) declared.add(m[1]);
    }
    const used = [...CSS.matchAll(/var\((--[a-z0-9-]+)/gi)].map((m) => m[1]);
    expect([...new Set(used)].filter((n) => !declared.has(n))).toEqual([]);
  });

  test('every selector is rooted at the scope class', () => {
    const out = new Set();
    for (const blk of stripped(CSS).split('}')) {
      const head = blk.split('{')[0];
      if (!head || head.includes('@')) continue;
      for (const sel of head.split(',')) {
        const s = sel.trim();
        if (!s || /^\d+%$/.test(s)) continue;
        const m = s.match(/^\.([\w-]+)/);
        out.add(m ? m[1] : s);
      }
    }
    expect([...out].filter((n) => n !== scope && !n.startsWith(`${scope}.`))).toEqual([]);
  });

  test('styles.css declares nothing in this scope', () => {
    const global = [...stripped(GLOBAL_CSS).matchAll(new RegExp(`\\.(${scope}[\\w-]*)`, 'g'))].map((m) => m[1]);
    expect([...new Set(global)]).toEqual([]);
  });

  test.each([['floor', '12px'], ['label', '13px'], ['body', '15px'], ['head', '19px'], ['title', '24px'], ['num', '30px']])(
    'the ladder: --%s-t-%s',
    (step, value) => {
      expect(CSS).toMatch(new RegExp(`--${scope}-t-${step}:\\s*${value}`));
    },
  );

  test('nothing is declared below the 12px floor', () => {
    const px = [...CSS.matchAll(/font(?:-size)?:[^;]*?(\d+)px/g)].map((m) => Number(m[1]));
    expect(px.filter((n) => n < 12)).toEqual([]);
  });
});

describe('BuildRoom.css geometry contracts', () => {
  function block(css, selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = css.match(new RegExp(`(^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`, 'm'));
    if (!match) throw new Error(`No rule for "${selector}"`);
    return match[2];
  }

  test('rows are 36px', () => {
    expect(ROOM_CSS).toMatch(/--brm-row-h:\s*36px/);
  });

  test('inputs render at body size, never at label size', () => {
    expect(block(ROOM_CSS, '.brm .brm-input')).toMatch(/var\(--brm-t-body\)/);
  });

  test('the dialog scrim scrolls and does not centre with the flex container', () => {
    const scrim = block(ROOM_CSS, '.brm .brm-scrim');
    expect(scrim).toMatch(/overflow-y:\s*auto/);
    expect(scrim).toMatch(/align-items:\s*flex-start/);
    expect(scrim).not.toMatch(/align-items:\s*center/);
    expect(scrim).toMatch(/padding:\s*\S+/);
    expect(ROOM_CSS).toMatch(/\.brm \.brm-scrim\s*>\s*\*\s*\{[^}]*margin:\s*auto/);
  });

  test('tables are table-layout: fixed', () => {
    expect(block(ROOM_CSS, '.brm .brm-tbl')).toMatch(/table-layout:\s*fixed/);
    expect(block(REPORT_CSS, '.brr .brr-tbl')).toMatch(/table-layout:\s*fixed/);
  });

  test('a phone gets one column', () => {
    expect(ROOM_CSS).toMatch(/@media \(max-width: 900px\)[\s\S]*?\.brm \.brm-grid[^{]*\{\s*grid-template-columns:\s*minmax\(0, 1fr\)/);
  });

  test('the report hides its toolbar when printed', () => {
    expect(REPORT_CSS).toMatch(/@media print[\s\S]*?\.brr \.brr-printbar\s*\{\s*display:\s*none/);
  });
});

describe('the themes are declared on the roots', () => {
  const page = read('buildroom', 'BuildRoomPage.jsx');
  const report = read('buildroom', 'BuildReport.jsx');
  test('every .brm root is dusk', () => {
    const roots = [...page.matchAll(/className=\{?[`"]brm brm[^"`]*[`"]\}?\s+data-theme="(\w+)"/g)].map((m) => m[1]);
    expect(roots.length).toBeGreaterThanOrEqual(3);
    expect(new Set(roots)).toEqual(new Set(['dark']));
  });
  test('the report root is paper', () => {
    expect(report).toMatch(/className="brr" data-theme="light"/);
  });
});
