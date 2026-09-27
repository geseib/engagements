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
const GLOBAL_CSS = read('styles.css');
const STAGE_CSS = read('styles', 'stage.css');
const PLAYER_CSS = read('components', 'PlayerSurface.css');
const EVP_CSS = read('components', 'event', 'EventAttendeePage.css');
const AG_CSS = read('components', 'event', 'EventStage.css');
const stripped = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

function lin(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function lum(c) { return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]); }
function ratio(a, b) {
  const la = lum(a); const lb = lum(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
const parseHex = (h) => [1, 3, 5].map((i) => parseInt(h.substr(i, 2), 16));
function parseRgba(s) {
  const m = String(s).match(/rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)/);
  if (!m) throw new Error(`not an rgba: ${s}`);
  return { rgb: [Number(m[1]), Number(m[2]), Number(m[3])], a: Number(m[4]) };
}
const over = (fg, a, bg) => fg.map((c, i) => c * a + bg[i] * (1 - a));

function hexToken(css, block, name) {
  const start = css.indexOf(block);
  if (start < 0) throw new Error(`no ${block} block`);
  const body = css.slice(start, css.indexOf('}', start));
  const m = body.match(new RegExp(`${name}\\s*:\\s*(#[0-9A-Fa-f]{6})`));
  if (!m) throw new Error(`${name} not declared in ${block}`);
  return parseHex(m[1]);
}
function rgbaToken(css, name) {
  const m = css.match(new RegExp(`${name}\\s*:\\s*(rgba\\([^)]*\\))`));
  if (!m) throw new Error(`${name} not declared`);
  return parseRgba(m[1]);
}

const ROOT = ':root {';
const DUSK = '[data-theme="dark"] {';
const T = {
  bg: hexToken(GLOBAL_CSS, DUSK, '--bg'),
  surface: hexToken(GLOBAL_CSS, DUSK, '--surface'),
  text: hexToken(GLOBAL_CSS, DUSK, '--text'),
  muted: hexToken(GLOBAL_CSS, DUSK, '--muted'),
  primary: hexToken(GLOBAL_CSS, ROOT, '--primary'),
  dangerText: hexToken(GLOBAL_CSS, ROOT, '--danger-text'),
  plrMuted: hexToken(PLAYER_CSS, '.plr {', '--plr-muted'),
  plrGood: hexToken(PLAYER_CSS, '.plr {', '--plr-success-text'),
  stageGood: parseHex((STAGE_CSS.match(/--success-text:\s*(#[0-9A-Fa-f]{6})/) || [])[1]),
};
const AA = 4.5;
const surfaceOnBg = T.surface;

describe('the attendee\'s page', () => {
  const amber = rgbaToken(PLAYER_CSS, '--plr-amber-tint');
  const nowRow = over(amber.rgb, amber.a, T.bg);
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

describe('the wall and the host\'s panel', () => {
  const nowTint = rgbaToken(AG_CSS, '--ag-now-tint');
  test.each([
    ['wall titles on the stage', T.text, T.bg],
    ['wall times and type lines', T.muted, T.bg],
    ['wall "Done"', T.stageGood, T.bg],
    ['wall "Now", "First", the kicker', T.primary, T.bg],
    ['the wall\'s live row: its title', T.text, over(nowTint.rgb, nowTint.a, T.bg)],
    ['the wall\'s live row: its word', T.primary, over(nowTint.rgb, nowTint.a, T.bg)],
    ['board titles on the stage', T.text, T.bg],
    ['board times and kind lines', T.muted, T.bg],
    ['board "Live" and "Paused"', T.primary, T.bg],
    ['END EVENT in the dock', T.dangerText, T.bg],
    ['a Go live button\'s ink on amber', T.bg, T.primary],
    ['a live board row\'s title on its tint', T.text, over(nowTint.rgb, nowTint.a, T.bg)],
    ['a live board row\'s kind line on its tint', T.muted, over(nowTint.rgb, nowTint.a, T.bg)],
    ['the confirm\'s copy on its dialog', T.text, surfaceOnBg],
    ['"End the event" on its dialog', T.dangerText, surfaceOnBg],
  ])('%s clears AA', (_label, fg, bg) => {
    expect(ratio(fg, bg)).toBeGreaterThanOrEqual(AA);
  });
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
