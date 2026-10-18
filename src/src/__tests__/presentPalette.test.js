/**
 * THE PRESENTATION'S PALETTE — present/present.css (`.present`, dusk), every skin.
 *
 * Named *Palette*, never *Token* (.gitignore swallows `*token*`). jsdom loads
 * no stylesheet, so this reads the sheet as text and resolves every colour
 * through the skin harness (styles/skins/*.css -> styles/roles.css -> the
 * .present scope), for every skin whose values file exists, on dusk under
 * data-surface="wall" (the root carries both; presentWallPalette asserts it).
 *
 * Every pairing the wall paints is composited up its real stack and must
 * clear AA 4.5:1. SPEC §4.5's rule replaces the old "no orange": the sheet
 * reads no --primary, --secondary or unnamed literal, and under the Present
 * skin --action and --accent on the wall resolve blue (the orange the Classic
 * wall shows is the skin's, never the sheet's). Also: --danger never carries
 * text; every var() is declared; every selector is rooted at `.present` (or
 * the html lock), and styles.css declares nothing there.
 */
const fs = require('fs');
const path = require('path');
const H = require('../testing/skinHarness');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const GLOBAL_CSS = require('../testing/classicGlobalCss')();
const CSS = read('present', 'present.css');
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const BODY = stripComments(CSS);
const SCOPE = '.present {';
const SKINS = [...new Set(H.CASES.map(([skin]) => skin))];

/** --present-mini is the surface at 60% (color-mix): composite it as that tint. */
function miniTint(o) {
  const decl = BODY.match(/--present-mini:\s*([^;]+);/)[1].trim();
  expect(decl).toBe('color-mix(in srgb, var(--surface) 60%, transparent)');
  const hex = H.role('--surface', o).replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.substr(i, 2), 16));
  return `rgba(${r}, ${g}, ${b}, 0.6)`;
}

describe.each(SKINS)('present.css under the %s skin: contrast, composited', (skin) => {
  const o = { skin, theme: 'dark', surface: 'wall' };
  const r = (n) => H.role(n, o);
  const FIELD = [r('--bg')];
  const STOPS = r('--wall-canvas').match(/#[0-9A-Fa-f]{6}/g).map((hex) => [hex]);
  const CARD = [r('--bg'), r('--surface')];
  it.each([
    ['text on the field', () => r('--text'), FIELD],
    ['muted on the field', () => r('--muted'), FIELD],
    ['the eyebrow on the field', () => r('--eyebrow-color'), FIELD],
    ...STOPS.flatMap((stop) => [
      [`muted on the canvas at ${stop[0]}`, () => r('--muted'), stop],
      [`the eyebrow on the canvas at ${stop[0]}`, () => r('--eyebrow-color'), stop],
    ]),
    ['text on the response card', () => r('--text'), CARD],
    ['muted on the response card', () => r('--muted'), CARD],
    ['muted on a mini card', () => r('--muted'), [r('--bg'), miniTint(o)]],
    ['a quote in the read (--wall-quote)', () => H.scopeVar(CSS, SCOPE, '--present-quote', o), FIELD],
    ['the badge number (--on-accent on --accent, NumberBadge)', () => r('--on-accent'), [r('--accent')]],
  ])('%s clears AA', (_label, fg, layers) => {
    expect(H.on(fg(), layers)).toBeGreaterThanOrEqual(H.AA);
  });
});

describe('present.css: house rules (SPEC §4.5)', () => {
  it('reads no --primary, --primary-deep or --secondary', () => {
    expect(BODY).not.toMatch(/var\(--(primary|secondary)/);
  });
  // THE ROOM'S PICK (owner, 18 Oct 2026, docs/design/room-content-v2 frames 5
  // and 12: "--sk-gold for the pick"). Gold is rank 1's status colour (SPEC
  // §3), not the skin's accent, so it is read exactly once, as the scope's
  // --present-pick, and only the pick's card, eyebrow and rung use that.
  it('reads --gold once, as --present-pick, and only the pick uses it', () => {
    expect(BODY.match(/var\(--gold\)/g)).toEqual(['var(--gold)']);
    expect(BODY).toMatch(/--present-pick:\s*var\(--gold\);/);
    const users = [...BODY.matchAll(/([^{}]+)\{[^}]*var\(--present-pick\)[^}]*\}/g)]
      .map((m) => m[1].trim()).filter((sel) => sel !== '.present');
    expect(users.length).toBeGreaterThan(0);
    users.forEach((sel) => expect(sel).toMatch(/is-pick|present-pick-ey|is-top/));
  });
  it('under the Present skin the wall carries no orange: --action and --accent resolve blue', () => {
    if (!SKINS.includes('present')) return;
    const o = { skin: 'present', theme: 'dark', surface: 'wall' };
    for (const n of ['--action', '--accent', '--phase-ask', '--phase-vote']) {
      expect(`${n} ${H.role(n, o).toUpperCase()}`).toBe(`${n} #7CA7E6`);
    }
  });
  it('under Classic the wall takes the stage\'s orange from the skin (§4.5)', () => {
    const o = { skin: 'classic', theme: 'dark', surface: 'wall' };
    for (const n of ['--action', '--accent', '--phase-ask']) {
      expect(`${n} ${H.role(n, o).toUpperCase()}`).toBe(`${n} #F6A94C`);
    }
    expect(H.role('--phase-vote', o).toUpperCase()).toBe('#7CA7E6');
  });
  it('never colours text with --danger', () => {
    expect(BODY).not.toMatch(/(^|[^-])color:\s*var\(--danger\)/m);
  });
  it('keeps colour literals in the scope token block and the html lock only', () => {
    const scopeStart = BODY.indexOf(SCOPE);
    const scopeEnd = BODY.indexOf('}', scopeStart);
    const lockEnd = BODY.indexOf('}', BODY.indexOf('html.present-locked'));
    const outside = BODY.slice(lockEnd + 1, scopeStart) + BODY.slice(scopeEnd + 1);
    expect(outside.match(/#[0-9A-Fa-f]{3,8}\b|rgba?\((?!var\()/g) || []).toEqual([]);
  });
  it('declares every var() it uses', () => {
    const used = new Set((BODY.match(/var\((--[\w-]+)/g) || []).map((v) => v.slice(4)));
    const declared = new Set([...(BODY + GLOBAL_CSS + read('styles', 'roles.css')).matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
    // Set inline by PresentStage (the scale), each with a fallback in the var() itself.
    const INLINE = ['--present-x', '--present-y', '--present-scale'];
    INLINE.forEach((v) => expect(BODY).toMatch(new RegExp(`var\\(${v},`)));
    // --fit is set inline by the fitter, and declared on the canvas as its start.
    const missing = [...used].filter((v) => !declared.has(v) && !INLINE.includes(v));
    expect(missing).toEqual([]);
  });
  it('roots every selector at .present (or the html lock, or the Call profile above it)', () => {
    const rules = BODY.replace(/@keyframes[\s\S]*?\}\s*\}/g, '').match(/[^{}]+\{/g) || [];
    const selectors = rules
      .map((x) => x.slice(0, -1).trim())
      .filter((s) => s && !s.startsWith('@'))
      .flatMap((s) => s.split(',').map((x) => x.trim()));
    const stray = selectors.filter((s) => !/^(\.present\b|html\.present-locked\b|:root\.d-call \.present\b)/.test(s));
    expect(stray).toEqual([]);
  });
  it('styles.css declares nothing in the .present scope', () => {
    expect(stripComments(GLOBAL_CSS)).not.toMatch(/\.present[\s.{:[]/);
  });
});
