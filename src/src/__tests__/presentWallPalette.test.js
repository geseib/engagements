/**
 * THE PRESENTATION ON ROLES — present/present.css under every skin (skins unit 0c).
 *
 * Named *Palette*, never *Token* (.gitignore swallows `*token*`). jsdom loads no
 * stylesheet, so this reads the sheet as text and resolves every colour through
 * the skin harness (styles/skins/*.css -> styles/roles.css -> the .present
 * scope), for every skin whose values file exists.
 *
 * The sheet renders in ONE theme: the root carries data-theme="dark" (asserted
 * below), which re-resolves every role to dusk whatever the page around it is.
 * So each skin is checked on dusk; a paper case would test a page nobody sees.
 *
 * Green means the declarations still clear AA 4.5:1 on their real stacks and
 * the sheet reads roles only. It cannot prove the wall looks right on a
 * projector — shoot.js and the owner's eyes do that.
 */
const fs = require('fs');
const path = require('path');
const H = require('../testing/skinHarness');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const CSS = read('present', 'present.css');
const STAGE = read('present', 'PresentStage.jsx');
const BODY = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
const SCOPE = '.present {';

const SKINS = [...new Set(H.CASES.map(([skin]) => skin))];

describe.each(SKINS)('present.css under the %s skin (dusk, on the wall)', (skin) => {
  const o = { skin, theme: 'dark', surface: 'wall' };
  const r = (name) => H.role(name, o);
  const v = (name) => H.scopeVar(CSS, SCOPE, name, o);
  const FIELD = [r('--bg')];
  // Every stop of the canvas ground (--wall-canvas): Classic's stage gradient
  // reaches #2A3A57 at the bottom, Present's glow peaks at #1E3050.
  const STOPS = r('--wall-canvas').match(/#[0-9A-Fa-f]{6}/g).map((hex) => [hex]);
  const CARD = [r('--bg'), r('--surface')];
  const MINI = [r('--bg'), v('--present-mini')];
  const LETTERBOX = [v('--present-canvas')];
  const PLATE = [r('--bg'), v('--present-plate')];  // the phase wipe over the canvas
  const STRIP = [...LETTERBOX, v('--present-plate')];
  const PRESSED = [...STRIP, v('--present-seen')];

  it.each([
    ['text on the field', () => r('--text'), FIELD],
    ['muted on the field (top line, foot, rank)', () => r('--muted'), FIELD],
    ['the eyebrow on the field', () => r('--eyebrow-color'), FIELD],
    ...STOPS.flatMap((stop) => [
      [`text on the canvas at ${stop[0]}`, () => r('--text'), stop],
      [`muted on the canvas at ${stop[0]}`, () => r('--muted'), stop],
      [`the eyebrow on the canvas at ${stop[0]}`, () => r('--eyebrow-color'), stop],
      [`the accent as copy on the canvas at ${stop[0]}`, () => r('--accent-text'), stop],
    ]),
    ['text on the response card', () => r('--text'), CARD],
    ['muted on the response card', () => r('--muted'), CARD],
    ['the part line on the response card', () => r('--accent-text'), CARD],
    ['muted on a mini card', () => r('--muted'), MINI],
    ['a quote in the read', () => v('--present-quote'), FIELD],
    ['the badge number (bg on the badge)', () => r('--bg'), [r('--accent')]],
    ['the wipe word on the plate', () => r('--phase-vote'), PLATE],
    ['the wipe line on the plate', () => r('--text'), PLATE],
    ['the results wipe word on the plate', () => v('--present-success-text'), PLATE],
    ['the strip status on the plate', () => r('--muted'), STRIP],
    ['a strip button on the plate', () => r('--text'), STRIP],
    ['a pressed strip button', () => r('--text'), PRESSED],
    ['the go button (its ink on --action, on the wall)', () => r('--on-action'), [r('--action')]],
    ['the safety-ask eyebrow on its card', () => r('--eyebrow-color'), CARD],
    ['the safety-ask note on its card', () => r('--muted'), CARD],
  ])('%s clears AA', (_label, fg, layers) => {
    expect(H.on(fg(), layers)).toBeGreaterThanOrEqual(H.AA);
  });

  it('every var() the sheet reads resolves in this skin (or is set inline by PresentStage)', () => {
    const INLINE = ['--present-x', '--present-y', '--present-scale', '--at', '--fit', '--hair',
      '--L-hero', '--L-primary', '--L-secondary', '--L-body', '--L-meta', '--fit-min', '--floor'];
    const local = new Set([...BODY.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
    const used = [...new Set([...BODY.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]))];
    const missing = used.filter((n) => !INLINE.includes(n) && !local.has(n)).filter((n) => {
      try { r(n); return false; } catch (e) { return true; }
    });
    expect(missing).toEqual([]);
  });
});

describe('present.css reads roles', () => {
  it('reads no migration alias (--primary, --primary-deep, --secondary)', () => {
    expect(BODY).not.toMatch(/var\(--(primary|primary-deep|secondary)\)/);
  });

  it('keeps only the named literals, each a keep: in records/0c.md', () => {
    const literals = [...BODY.matchAll(/#[0-9A-Fa-f]{3,8}\b|rgba?\((?!var\()[^)]*\)/g)].map((m) => m[0]);
    expect(literals).toEqual([
      '#0A1324',                 // html lock: the letterbox before .present mounts
      '#0A1324',                 // --present-canvas: the letterbox ground
      '#1E3050',                 // --present-glow: read only by presentPalette.test.js now
      'rgba(27, 41, 66, 0.6)',   // --present-mini: the flank mini-card fill
      '#D9E5F7',                 // --present-quote: the quote ink
      'rgba(11, 18, 32, 0.93)',  // --present-plate: the strip and wipe plate
    ]);
  });

  it('under Present the wall carries no orange: --action and --accent resolve blue', () => {
    if (!SKINS.includes('present')) return;
    const o = { skin: 'present', theme: 'dark', surface: 'wall' };
    expect(H.role('--action', o).toUpperCase()).toBe('#7CA7E6');
    expect(H.role('--accent', o).toUpperCase()).toBe('#7CA7E6');
  });

  it('the stage root is dusk and marked as the wall', () => {
    const root = STAGE.slice(STAGE.indexOf('className={`present'), STAGE.indexOf('aria-live'));
    expect(root).toMatch(/data-theme="dark"/);
    expect(root).toMatch(/data-surface="wall"/);
  });
});
