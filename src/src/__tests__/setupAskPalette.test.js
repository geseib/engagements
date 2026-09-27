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
 * NOTHING IS TYPED TWICE: every colour and every ground is read out of
 * styles.css. The contrast functions are docs/design/admin-redesign/audit.html's,
 * as the other *Palette tests copy them. jsdom loads no stylesheet, so green
 * here means the palette clears AA, not that a browser draws it.
 */
const fs = require('fs');
const path = require('path');

const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const CSS = strip(fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8'));

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
/** `var(--token, #fallback)` → the token's :root value. */
function tokenColour(body, prop = 'color') {
  const m = body.match(new RegExp(`(^|;)\\s*${prop}\\s*:\\s*var\\((--[\\w-]+)`));
  if (!m) throw new Error(`no ${prop} token`);
  return { name: m[2], hex: hexIn(ROOT, m[2]) };
}
function rgbaOf(body) {
  const m = body.match(/background:\s*rgba\(\s*(\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\s*\)/);
  if (!m) throw new Error('no rgba background');
  return { rgb: [Number(m[1]), Number(m[2]), Number(m[3])], a: Number(m[4]) };
}

const ROOT = CSS.slice(CSS.indexOf(':root {'), CSS.indexOf('}', CSS.indexOf(':root {')));
const DUSK_AT = CSS.indexOf('[data-theme="dark"] {');
const DUSK = CSS.slice(DUSK_AT, CSS.indexOf('}', DUSK_AT));

const PANEL = parseHex(hexIn(block('.setup-panel'), 'background'));
const TINT = rgbaOf(block('.setup-q'));
const REMOTE = parseHex(hexIn(DUSK, '--bg'));

const GROUNDS = {
  'the panel\'s browser rows': PANEL,
  'the running order in the panel': alphaOver(TINT.rgb, PANEL, TINT.a),
  'the running order on the phone': alphaOver(TINT.rgb, REMOTE, TINT.a),
};
const AA = 4.5;

describe('the premise', () => {
  test('the grounds are the sheet\'s own, not assumed', () => {
    expect(PANEL).toEqual(parseHex('#111D33'));
    expect(TINT.a).toBeGreaterThan(0);
    expect(TINT.a).toBeLessThan(0.2);
  });
});

describe.each(Object.entries(GROUNDS))('on %s', (_label, ground) => {
  test('Ask next (--primary) clears AA', () => {
    const { name, hex } = tokenColour(block('.setup-ask--next'));
    expect(name).toBe('--primary');
    expect(ratio(parseHex(hex), ground)).toBeGreaterThanOrEqual(AA);
  });

  test('Ask now (--danger-text, never --danger) clears AA', () => {
    const { name, hex } = tokenColour(block('.setup-ask--now'));
    expect(name).toBe('--danger-text');
    expect(ratio(parseHex(hex), ground)).toBeGreaterThanOrEqual(AA);
  });
});

describe('armed, on the phone', () => {
  test('the words on the --danger-deep fill clear AA', () => {
    const body = block('.setup-ask--now.is-armed');
    const fill = tokenColour(body, 'background');
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
