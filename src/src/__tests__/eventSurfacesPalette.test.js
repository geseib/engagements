/**
 * THE EVENT'S NEW SURFACES, MEASURED — components/event/EventAttendeePage.css
 * (the attendee's agenda, beat, talk, break and paused screens) and
 * components/event/EventStage.css (the wall between items, and the host's
 * agenda panel over it). Events M2–M4.
 *
 * jsdom loads no stylesheet, so the design is read as text and the contrast
 * is composited up the real paint stack (the engage-design skill's pattern,
 * eventBuilderPalette.test.js's harness).
 *
 * rejects: a pairing under 4.5:1, a tinted row included; a selector outside
 * its scope (`.evp` inside the player's `.plr`, `ag-` on the stage); a raw
 * colour outside a token block; `--danger` carrying text; a custom property
 * nobody declares; a laptop size under 12px on the host's panel; a px font
 * size on the attendee's page, which must ride the player's three ladders.
 */
const fs = require('fs');
const path = require('path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const GLOBAL_CSS = require('../testing/classicGlobalCss')();
const STAGE_CSS = read('styles', 'stage.css');
const PLAYER_CSS = read('components', 'PlayerSurface.css');
const EVP_CSS = read('components', 'event', 'EventAttendeePage.css');
const AG_CSS = read('components', 'event', 'EventStage.css');
const stripped = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

const H = require('../testing/skinHarness');

const ratio = (a, b) => H.ratio(a, b);
const rgb = (c) => H.composite([c]);
const over = (tintValue, base) => { const t = H.parseColor(tintValue); return t.rgb.map((c, i) => c * t.a + base[i] * (1 - t.a)); };
const AA = H.AA;

/* Values RESOLVED per skin through the harness (skins -> roles -> the scope block), never
   retyped. Both surfaces are dusk in every skin: the attendee's page draws inside
   `.plr data-theme="dark"` (PlayerShell), the wall and board inside
   `.ag-stage-root data-theme="dark"` (EventStage.jsx). */
function palette(skin) {
  const r = (name) => rgb(H.role(name, { skin, theme: 'dark' }));
  const plr = (name) => H.scopeVar(PLAYER_CSS, '.plr {', name, { skin, theme: 'dark' });
  return {
    bg: r('--bg'), surface: r('--surface'), text: r('--text'), muted: r('--muted'),
    primary: r('--primary'), dangerText: r('--danger-text'),
    plrMuted: rgb(plr('--plr-muted')), plrGood: rgb(plr('--plr-success-text')),
    stageGood: r('--success-text'),
    plrAmber: plr('--plr-amber-tint'),
    nowTint: H.scopeVar(AG_CSS, '.ag-stage-root {', '--ag-now-tint', { skin, theme: 'dark' }),
  };
}

describe.each(H.SKINS)('the attendee\'s page (%s)', (skin) => {
  const T = palette(skin);
  const nowRow = over(T.plrAmber, T.bg);
  test.each([
    ['titles on the page', T.text, T.bg],
    ['times, type lines and kickers', T.plrMuted, T.bg],
    ['"Done"', T.plrGood, T.bg],
    ['"Next", "Paused" and the beat\'s kicker in amber', T.primary, T.bg],
    ['the "Now" badge\'s ink on amber', T.bg, T.primary],
    ['a title on the live row\'s tint', T.text, nowRow],
    ['a type line on the live row\'s tint', T.plrMuted, nowRow],
  ])('%s clears AA', (_label, fg, bg) => {
    expect(ratio(fg, bg)).toBeGreaterThanOrEqual(AA);
  });
});

describe.each(H.SKINS)('the wall and the host\'s panel (%s)', (skin) => {
  const T = palette(skin);
  const surfaceOnBg = T.surface;
  const live = over(T.nowTint, T.bg);
  test.each([
    ['wall titles on the stage', T.text, T.bg],
    ['wall times and type lines', T.muted, T.bg],
    ['wall "Done"', T.stageGood, T.bg],
    ['wall "Now", "First", the kicker', T.primary, T.bg],
    ['the wall\'s live row: its title', T.text, live],
    ['the wall\'s live row: its word', T.primary, live],
    ['board titles on the stage', T.text, T.bg],
    ['board times and kind lines', T.muted, T.bg],
    ['board "Live" and "Paused"', T.primary, T.bg],
    ['END EVENT in the dock', T.dangerText, T.bg],
    ['a Go live button\'s ink on amber', T.bg, T.primary],
    ['a live board row\'s title on its tint', T.text, live],
    ['a live board row\'s kind line on its tint', T.muted, live],
    ['the confirm\'s copy on its dialog', T.text, surfaceOnBg],
    ['"End the event" on its dialog', T.dangerText, surfaceOnBg],
  ])('%s clears AA', (_label, fg, bg) => {
    expect(ratio(fg, bg)).toBeGreaterThanOrEqual(AA);
  });
});

test('Classic is unchanged: the live-row tints resolve to their pre-skin literals', () => {
  const T = palette('classic');
  expect(H.parseColor(T.plrAmber)).toEqual(H.parseColor('rgba(246, 169, 76, .11)'));
  expect(H.parseColor(T.nowTint)).toEqual(H.parseColor('rgba(246, 169, 76, .10)'));
});

describe('the contract', () => {
  const selectors = (css) => (stripped(css).match(/^[^\s@}][^{]*(?=\{)/gm) || [])
    .flatMap((sel) => sel.split(',').map((s) => s.trim()))
    .filter(Boolean);

  test('the attendee\'s sheet is rooted at .evp, and nothing else declares .evp', () => {
    const sels = selectors(EVP_CSS);
    expect(sels.length).toBeGreaterThan(20);
    sels.forEach((s) => expect(s).toMatch(/^\.evp(\b|-|\.|\s|:)/));
    for (const other of [GLOBAL_CSS, STAGE_CSS, PLAYER_CSS]) expect(stripped(other)).not.toMatch(/\.evp\b/);
  });

  test('the stage\'s sheet is rooted at ag- (or the stage\'s own wipe and chip, re-tinted)', () => {
    const sels = selectors(AG_CSS);
    expect(sels.length).toBeGreaterThan(30);
    sels.forEach((s) => expect(s).toMatch(/^(\.ag-[a-z]|\.wipe\.ag-go\b|\.chip\.ag-preview\b)/));
    for (const other of [GLOBAL_CSS, STAGE_CSS]) expect(stripped(other)).not.toMatch(/\.ag-[a-z]/);
  });

  test('no raw colour outside a token block, and --danger never carries text', () => {
    const evp = stripped(EVP_CSS);
    expect(evp).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(evp).not.toMatch(/rgba?\(/i);
    const ag = stripped(AG_CSS);
    const start = ag.indexOf('.ag-stage-root {');
    const outside = ag.slice(0, start) + ag.slice(ag.indexOf('}', start));
    expect(outside).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(outside).not.toMatch(/rgba?\(/i);
    for (const css of [evp, ag]) {
      expect(css.split('\n').filter((l) => /(^|[^-])\bcolor\s*:\s*var\(--danger\)/.test(l))).toEqual([]);
    }
  });

  test('every custom property used is declared somewhere the surface can see', () => {
    const declared = new Set();
    for (const css of [GLOBAL_CSS, STAGE_CSS, PLAYER_CSS, EVP_CSS, AG_CSS]) {
      for (const m of css.matchAll(/(--[a-z0-9-]+)\s*:/gi)) declared.add(m[1]);
    }
    // Set inline by EventStage.jsx's useBoardFit, each with a default here.
    for (const inline of ['--ag-cols', '--ag-rows']) {
      expect(AG_CSS).toMatch(new RegExp(`var\\(${inline},\\s*1\\)`));
      declared.add(inline);
    }
    for (const css of [EVP_CSS, AG_CSS]) {
      const used = [...css.matchAll(/var\((--[a-z0-9-]+)/gi)].map((m) => m[1]);
      expect([...new Set(used)].filter((n) => !declared.has(n))).toEqual([]);
    }
  });

  test('the attendee\'s page rides the player\'s ladders: no px font size at all', () => {
    expect(stripped(EVP_CSS)).not.toMatch(/font-size:\s*[\d.]+px/);
  });

  test('the board rides the stage\'s ladder, one-line rows, 44px targets, and it clips rather than scrolls', () => {
    const css = stripped(AG_CSS);
    const rule = (sel) => (css.match(new RegExp(`(^|\\n)${sel.replace(/[.[\]]/g, (c) => `\\${c}`)}\\s*\\{[^}]*\\}`)) || [''])[0];
    // Sizes on the board are the profile ladder's, never a pixel literal.
    for (const sel of ['.ag-r-tt', '.ag-r-sub', '.ag-r-at', '.ag-r-st', '.ag-b', '.ag-live', '.ag-when']) {
      expect(rule(sel)).toMatch(/font-size:\s*var\(--t-(body|meta)\)/);
    }
    // One line each: the title and the kind truncate, as single text nodes.
    for (const sel of ['.ag-r-tt', '.ag-r-sub']) {
      expect(rule(sel)).toMatch(/white-space:\s*nowrap/);
      expect(rule(sel)).toMatch(/text-overflow:\s*ellipsis/);
      expect(rule(sel)).toMatch(/min-width:\s*0/);
    }
    expect(rule('.ag-b')).toMatch(/min-height:\s*44px/);
    expect(rule('.ag-r')).toMatch(/min-height:\s*48px/);
    // The columns are measured (useBoardFit), and the grid never scrolls.
    expect(rule('.ag-grid')).toMatch(/grid-template-columns:\s*repeat\(var\(--ag-cols/);
    expect(rule('.ag-grid')).toMatch(/grid-auto-flow:\s*column/);
    expect(rule('.ag-grid')).toMatch(/overflow:\s*hidden/);
    expect(css).not.toMatch(/\.ag-(grid|board)\s*\{[^}]*overflow(-y)?:\s*(auto|scroll)/);
    // The dialogs (a laptop surface): nothing under 12px.
    const sizes = [...css.matchAll(/font-size:\s*(\d+)px/g)].map((m) => Number(m[1]));
    sizes.forEach((n) => expect(n).toBeGreaterThanOrEqual(12));
  });

  test('the scrim scrolls and the card centres by margin (the recurring reachability rule)', () => {
    const scrim = stripped(AG_CSS).match(/\.ag-scrim\s*\{[^}]*\}/)[0];
    expect(scrim).toMatch(/align-items:\s*flex-start/);
    expect(scrim).toMatch(/overflow-y:\s*auto/);
    expect(stripped(AG_CSS)).toMatch(/\.ag-scrim\s*>\s*\*\s*\{[^}]*margin:\s*auto/);
  });

  test('the bar\'s Agenda door is declared in the player\'s sheet, with a 44px target', () => {
    expect(stripped(PLAYER_CSS)).toMatch(/\.plr-agenda\s*\{[^}]*min-height:\s*var\(--plr-tap\)/);
  });
});
