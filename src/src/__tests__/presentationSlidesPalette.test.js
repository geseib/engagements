/**
 * A TALK'S SLIDES, MEASURED — the stage's deck screen (components/event/
 * EventStage.css, `.ag-deck*`), the item dialog's slides field (components/
 * EventBuilder.css, `.evb-deck*`) and the phone's (components/event/
 * EventAttendeePage.css, `.evp-deck*`); and the build that ships pdf.js
 * (webpack.config.js, utils/pdfDeck.js).
 *
 * jsdom loads no stylesheet and lays nothing out, so the design is read as
 * text: the engage-design skill's pattern. What green means: the CSS still
 * says the slide is letterboxed into a box that cannot scroll or grow, that
 * the portrait stage re-stacks, that every size is a ladder's, and that the
 * words clear AA on what they sit on. It cannot prove the slide fits a real
 * 1280×720 screen — that was measured in Chromium (see the commit).
 *
 * rejects: a slide box that scrolls, or that its canvas can grow (the stage
 * never scrolls); a canvas that is stretched rather than letterboxed; a
 * portrait screen given the landscape side column; a px font size on the
 * stage or the phone; a slide control under 48px; a pairing under 4.5:1; a
 * colour outside a token block; the row actions pushed with flex-end (hard
 * rule 9); a file name that truncates as anything but one text node (hard
 * rule 8); pdf.js in the main bundle, from a CDN, with eval on, or with its
 * worker served under a name S3 would not type as JavaScript.
 */
const fs = require('fs');
const path = require('path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const GLOBAL_CSS = read('styles.css');
const STAGE_CSS = read('styles', 'stage.css');
const PLAYER_CSS = read('components', 'PlayerSurface.css');
const AG_CSS = read('components', 'event', 'EventStage.css');
const EVB_CSS = read('components', 'EventBuilder.css');
const EVP_CSS = read('components', 'event', 'EventAttendeePage.css');
const WEBPACK = fs.readFileSync(path.join(__dirname, '..', '..', 'webpack.config.js'), 'utf8');
const PKG = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8'));
const PDF_DECK = read('utils', 'pdfDeck.js');
const stripped = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

function lin(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function lum(c) { return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]); }
function ratio(a, b) {
  const la = lum(a); const lb = lum(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
const parseHex = (h) => [1, 3, 5].map((i) => parseInt(h.substr(i, 2), 16));
function hexToken(css, block, name) {
  const start = css.indexOf(block);
  if (start < 0) throw new Error(`no ${block} block`);
  const body = css.slice(start, css.indexOf('}', start));
  const m = body.match(new RegExp(`${name}\\s*:\\s*(#[0-9A-Fa-f]{6})`));
  if (!m) throw new Error(`${name} not declared in ${block}`);
  return parseHex(m[1]);
}
const T = {
  bg: hexToken(GLOBAL_CSS, '[data-theme="dark"] {', '--bg'),
  text: hexToken(GLOBAL_CSS, '[data-theme="dark"] {', '--text'),
  muted: hexToken(GLOBAL_CSS, '[data-theme="dark"] {', '--muted'),
  primary: hexToken(GLOBAL_CSS, ':root {', '--primary'),
  plrMuted: hexToken(PLAYER_CSS, '.plr {', '--plr-muted'),
};
const AA = 4.5;

/** The declarations of one rule, by its exact selector, outside any @media. */
function rule(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = stripped(css).match(new RegExp(`(^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`));
  if (!m) throw new Error(`No rule for "${selector}" — renamed?`);
  return m[2];
}
/** The body of the first `@media (…)` block matching `query`. */
function media(css, query) {
  const text = stripped(css);
  const start = text.indexOf(`@media ${query}`);
  if (start < 0) throw new Error(`no @media ${query}`);
  let depth = 0;
  for (let i = text.indexOf('{', start); i < text.length; i += 1) {
    if (text[i] === '{') depth += 1;
    if (text[i] === '}') { depth -= 1; if (depth === 0) return text.slice(start, i + 1); }
  }
  throw new Error('unbalanced @media');
}
const deckRules = (css, prefix) => (stripped(css).match(new RegExp(`[^{}]*\\.${prefix}[^{}]*\\{[^}]*\\}`, 'g')) || []);

describe('the stage: the slide as large as the stage allows, and never a scroll', () => {
  test('the deck fills the main area on a grid whose tracks may shrink to nothing', () => {
    const deck = rule(AG_CSS, '.ag-deck');
    expect(deck).toMatch(/height:\s*100%/);
    expect(deck).toMatch(/min-height:\s*0/);
    expect(deck).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)\s+clamp\(/);
    expect(deck).toMatch(/grid-template-rows:\s*minmax\(0,\s*1fr\)/);
  });

  test('the frame clips and cannot be grown by what it holds; the canvas is placed, letterboxed, not stretched', () => {
    const frame = rule(AG_CSS, '.ag-deck-frame');
    expect(frame).toMatch(/overflow:\s*hidden/);
    expect(frame).toMatch(/min-height:\s*0/);
    expect(frame).toMatch(/position:\s*relative/);
    const box = rule(AG_CSS, '.ag-deck-slide');
    expect(box).toMatch(/position:\s*absolute/);
    expect(box).toMatch(/inset:\s*0/);
    const canvas = rule(AG_CSS, '.ag-deck-slide canvas');
    expect(canvas).toMatch(/position:\s*absolute/);
    expect(canvas).toMatch(/margin:\s*auto/);
    expect(canvas).toMatch(/max-width:\s*100%/);
    expect(canvas).toMatch(/max-height:\s*100%/);
    // Sized by SlideCanvas to the page's own shape; a CSS 100% would stretch it.
    expect(canvas).not.toMatch(/object-fit|(^|[\s;])(width|height):\s*100%/);
  });

  test('nothing on the deck screen scrolls', () => {
    const all = deckRules(AG_CSS, 'ag-deck').join('\n');
    expect(all.length).toBeGreaterThan(200);
    expect(all).not.toMatch(/overflow(-[xy])?:\s*(auto|scroll)/);
  });

  test('a portrait screen puts the talk and the controls under the slide, full width', () => {
    const portrait = media(AG_CSS, '(orientation: portrait)');
    expect(portrait).toMatch(/\.ag-deck\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);/);
    expect(portrait).toMatch(/\.ag-deck\s*\{[^}]*grid-template-rows:\s*minmax\(0,\s*1fr\)\s+auto/);
    expect(portrait).toMatch(/\.ag-deck-side\s*\{[^}]*flex-direction:\s*row/);
  });

  test('every size is the profile ladder\'s, and the slide controls are targets a clicker hand can hit', () => {
    const sizes = deckRules(AG_CSS, 'ag-deck').join('\n').match(/font-size:\s*[^;]+/g) || [];
    expect(sizes.length).toBeGreaterThanOrEqual(5);
    sizes.forEach((s) => expect(s).toMatch(/font-size:\s*var\(--t-(meta|body|secondary)\)/));
    const turn = rule(AG_CSS, '.ag-deck-turn');
    expect(Number((turn.match(/min-width:\s*(\d+)px/) || [])[1])).toBeGreaterThanOrEqual(48);
    expect(Number((turn.match(/min-height:\s*(\d+)px/) || [])[1])).toBeGreaterThanOrEqual(48);
  });

  test('a long title is clamped, and says itself in full (the heading carries title=)', () => {
    expect(rule(AG_CSS, '.ag-deck-title')).toMatch(/-webkit-line-clamp:\s*3/);
    expect(read('components', 'event', 'EventStage.jsx')).toMatch(/className="ag-deck-title" title=\{deckItem\.title\}/);
  });

  test.each([
    ['"Slide 3 of 12" and the title, --text on the field', 'text'],
    ['the kicker, --primary on the field', 'primary'],
    ['"← → to turn", --muted on the field', 'muted'],
  ])('%s clears AA', (_label, token) => {
    expect(ratio(T[token], T.bg)).toBeGreaterThanOrEqual(AA);
  });

  test('the deck screen names only tokens, and only ones something declares', () => {
    const all = deckRules(AG_CSS, 'ag-deck').join('\n');
    expect(all).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
    const declared = new Set();
    for (const css of [GLOBAL_CSS, STAGE_CSS, AG_CSS]) {
      for (const m of css.matchAll(/(--[a-z0-9-]+)\s*:/gi)) declared.add(m[1]);
    }
    const used = [...all.matchAll(/var\((--[a-z0-9-]+)/gi)].map((m) => m[1]);
    expect([...new Set(used)].filter((n) => !declared.has(n))).toEqual([]);
  });
});

describe('the item dialog\'s slides field', () => {
  test('one 36px well on --bg, its file name one truncating text node, its actions pushed by margin, never flex-end', () => {
    const well = rule(EVB_CSS, '.evb-deck');
    expect(well).toMatch(/min-height:\s*36px/);
    expect(well).toMatch(/background:\s*var\(--bg\)/);
    expect(well).toMatch(/flex-wrap:\s*wrap/);
    const name = rule(EVB_CSS, '.evb-deck-name');
    for (const d of [/min-width:\s*0/, /overflow:\s*hidden/, /white-space:\s*nowrap/, /text-overflow:\s*ellipsis/]) expect(name).toMatch(d);
    expect(rule(EVB_CSS, '.evb-deck-acts')).toMatch(/margin-left:\s*auto/);
    expect(deckRules(EVB_CSS, 'evb-deck').join('\n')).not.toMatch(/justify-content:\s*flex-end/);
    expect(read('components', 'EventItemDialog.jsx')).toMatch(/className="evb-deck-name" title=\{deckShown\.name\}/);
  });

  test('its sizes are the console ladder\'s, nothing under 12px', () => {
    const sizes = (deckRules(EVB_CSS, 'evb-deck').join('\n').match(/font-size:\s*[^;]+/g) || []);
    sizes.forEach((s) => expect(s).toMatch(/var\(--evb-t-(floor|label|body)\)/));
    expect(EVB_CSS).toMatch(/--evb-t-label:\s*13px/);
  });

  test.each([
    ['the file name, --text on the well', 'text'],
    ['pages and size, --muted on the well', 'muted'],
    ['the PDF glyph, --primary on the well', 'primary'],
  ])('%s clears AA', (_label, token) => {
    expect(ratio(T[token], T.bg)).toBeGreaterThanOrEqual(AA);
  });
});

describe('the phone\'s talk screen', () => {
  test('"Slide 3 of 12" in the kicker\'s amber rides the player\'s ladder and clears AA', () => {
    const at = rule(EVP_CSS, '.evp .evp-deck-at');
    expect(at).toMatch(/color:\s*var\(--primary\)/);
    expect(at).toMatch(/font-size:\s*var\(--plr-t-body\)/);
    expect(ratio(T.primary, T.bg)).toBeGreaterThanOrEqual(AA);
    expect(ratio(T.plrMuted, T.bg)).toBeGreaterThanOrEqual(AA);
    expect(stripped(EVP_CSS)).not.toMatch(/font-size:\s*[\d.]+px/);
  });

  test('the slide is letterboxed into a fixed-shape box that clips', () => {
    const frame = rule(EVP_CSS, '.evp .evp-deck-frame');
    expect(frame).toMatch(/aspect-ratio:\s*16\s*\/\s*10/);
    expect(frame).toMatch(/overflow:\s*hidden/);
    const canvas = rule(EVP_CSS, '.evp .evp-deck-slide canvas');
    expect(canvas).toMatch(/max-width:\s*100%/);
    expect(canvas).toMatch(/max-height:\s*100%/);
    expect(canvas).toMatch(/margin:\s*auto/);
  });
});

describe('the build: pdf.js bundled with the site, its worker beside it', () => {
  test('pdf.js is pinned, and loaded only when a deck is opened — never in the main bundle', () => {
    expect(PKG.dependencies['pdfjs-dist']).toMatch(/^\d+\.\d+\.\d+$/);
    expect(PDF_DECK).toMatch(/import\(\/\* webpackChunkName: "pdfjs" \*\/ 'pdfjs-dist\/legacy\/build\/pdf\.mjs'\)/);
    const code = PDF_DECK.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/^import .* from 'pdfjs-dist/m);
    expect(code).not.toMatch(/https?:\/\//);
    expect(code).toMatch(/isEvalSupported:\s*false/);
    expect(code).toMatch(/GlobalWorkerOptions\.workerSrc = WORKER_SRC/);
    expect(code).toMatch(/process\.env\.PDF_WORKER_SRC/);
  });

  test('webpack copies the legacy worker into dist under a versioned .js name, and tells the app where', () => {
    expect(WEBPACK).toMatch(/'pdfjs-dist',\s*'legacy',\s*'build',\s*'pdf\.worker\.min\.mjs'/);
    expect(WEBPACK).toMatch(/const PDF_WORKER = `pdf\.worker\.\$\{PDFJS_VERSION\}\.min\.js`/);
    expect(WEBPACK).toMatch(/to:\s*PDF_WORKER/);
    expect(WEBPACK).toMatch(/PDF_WORKER_SRC:\s*`\/\$\{PDF_WORKER\}`/);
  });
});
