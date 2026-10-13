/**
 * ASK NEXT / ASK NOW — `.setup-ask` in styles.css, measured on every ground the
 * two buttons stand on.
 *
 * Named "Palette", never "Token": `.gitignore:35` is an unanchored `*token*`,
 * so a file named for tokens is invisible to git.
 *
 * The owner: "'ask next' in most people's mind means put it at the top of the
 * queue, not run it now." The two verbs now sit side by side on three surfaces
 * — the stage panel's browser rows, the running order inside the panel, and the
 * same running order on the phone (QueueList variant="touch") — so each tone is
 * composited on each of those grounds rather than on the token table's.
 *
 * NOTHING IS TYPED TWICE: every ground is read out of styles.css, and every
 * role through testing/skinHarness.js (styles/skins/*.css + styles/roles.css),
 * for every skin. The panel is dusk in every skin (its ground is the sheet's own
 * #111D33), so the roles are resolved in the dark theme. The contrast functions are docs/design/admin-redesign/audit.html's,
 * as the other *Palette tests copy them. jsdom loads no stylesheet, so green
 * here means the palette clears AA, not that a browser draws it.
 */
const fs = require('fs');
const path = require('path');

const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const H = require('../testing/skinHarness');

const CSS = strip(fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8'));
/* The setup panel and the phone's queue are dusk surfaces in every skin. */
const SKINS = H.CASES.filter(([, theme]) => theme === 'dark').map(([skin]) => skin);

function lin(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function lum(c) { return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]); }
function ratio(a, b) {
  const la = lum(a); const lb = lum(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
function alphaOver(fg, bg, a) { return fg.map((c, i) => c * a + bg[i] * (1 - a)); }
const parseHex = (h) => [1, 3, 5].map((i) => parseInt(h.substr(i, 2), 16));

/** The declarations of the FIRST rule whose selector is exactly `selector`. */
function block(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = CSS.match(new RegExp(`(^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`));
  if (!m) throw new Error(`no rule for "${selector}"`);
  return m[2];
}
function hexIn(body, name) {
  const m = body.match(new RegExp(`${name}\\s*:\\s*(#[0-9A-Fa-f]{6})`));
  if (!m) throw new Error(`${name} is not a hex there`);
  return m[1];
}
/** `var(--token, #fallback)` → the token's resolved dusk value in one skin. */
function tokenColour(body, prop = 'color', skin = 'classic') {
  const m = body.match(new RegExp(`(^|;)\\s*${prop}\\s*:\\s*var\\((--[\\w-]+)`));
  if (!m) throw new Error(`no ${prop} token`);
  return { name: m[2], hex: H.role(m[2], { skin, theme: 'dark' }) };
}
function rgbaOf(body) {
  const m = body.match(/background:\s*rgba\(\s*(\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\s*\)/);
  if (!m) throw new Error('no rgba background');
  return { rgb: [Number(m[1]), Number(m[2]), Number(m[3])], a: Number(m[4]) };
}

const PANEL = parseHex(hexIn(block('.setup-panel'), 'background'));
const TINT = rgbaOf(block('.setup-q'));

const GROUNDS = SKINS.flatMap((skin) => {
  const remote = parseHex(H.role('--bg', { skin, theme: 'dark' }));
  return [
    [`${skin}: the panel's browser rows`, skin, PANEL],
    [`${skin}: the running order in the panel`, skin, alphaOver(TINT.rgb, PANEL, TINT.a)],
    [`${skin}: the running order on the phone`, skin, alphaOver(TINT.rgb, remote, TINT.a)],
  ];
});
const AA = H.AA;

describe('the premise', () => {
  test('every skin is measured once Present exists', () => {
    expect(SKINS).toEqual(expect.arrayContaining(['classic', 'present']));
  });
  test('the grounds are the sheet\'s own, not assumed', () => {
    expect(PANEL).toEqual(parseHex('#111D33'));
    expect(TINT.a).toBeGreaterThan(0);
    expect(TINT.a).toBeLessThan(0.2);
  });
});

describe.each(GROUNDS)('on %s', (_label, skin, ground) => {
  test('Ask next (--primary) clears AA', () => {
    const { name, hex } = tokenColour(block('.setup-ask--next'), 'color', skin);
    expect(name).toBe('--primary');
    expect(ratio(parseHex(hex), ground)).toBeGreaterThanOrEqual(AA);
  });

  test('Ask now (--danger-text, never --danger) clears AA', () => {
    const { name, hex } = tokenColour(block('.setup-ask--now'), 'color', skin);
    expect(name).toBe('--danger-text');
    expect(ratio(parseHex(hex), ground)).toBeGreaterThanOrEqual(AA);
  });
});

describe.each(SKINS)('armed, on the phone (%s)', (skin) => {
  test('the words on the --danger-deep fill clear AA', () => {
    const body = block('.setup-ask--now.is-armed');
    const fill = tokenColour(body, 'background', skin);
    expect(fill.name).toBe('--danger-deep');
    expect(ratio(parseHex(hexIn(body, 'color')), parseHex(fill.hex))).toBeGreaterThanOrEqual(AA);
  });
});

describe('the two tones are two tones', () => {
  test('Ask next and Ask now never share a colour', () => {
    // rejects: the stage's old Queue / Ask next pair, which the blanket panel
    // repaint drew as one navy button.
    expect(tokenColour(block('.setup-ask--next')).name)
      .not.toBe(tokenColour(block('.setup-ask--now')).name);
  });
});
