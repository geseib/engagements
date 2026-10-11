/**
 * TWO CODES — the CSS contract (docs/design/build-room-two-qr, option C; owner
 * 2026-10-11). Read as text: jsdom has no layout engine, so every width it
 * reports is zero and a geometric assertion would pass unconditionally.
 *
 * Pinned: the 160px code floor (Settings tiles, the No demo yet slot, the
 * Stage card), the container the two rules measure, the stack rule that keeps
 * two codes from ever sharing less than 2 x 160px, the 232px laptop size by
 * arithmetic on the declared numbers, and the measured contrast of every word
 * the tiles draw, including the placeholder's label over its dot field.
 *
 * Named *Palette*, never *Token* (.gitignore carries an unanchored `*token*`).
 */
const fs = require('fs');
const path = require('path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const CSS = read('buildroom', 'BuildRoom.css').replace(/\/\*[\s\S]*?\*\//g, '');
const GLOBAL = read('styles.css');

const FLOOR = 160;

/** The declarations of one rule, by its exact selector, outside any at-rule unless `inside` is given. */
function rule(selector, inside = CSS) {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = inside.match(new RegExp(`(^|[}{])\\s*${esc}\\s*\\{([^}]*)\\}`, 'm'));
  if (!m) throw new Error(`No rule for "${selector}"`);
  return m[2];
}
/** The body of an at-rule block, braces balanced. */
function atBlock(head) {
  const at = CSS.indexOf(head);
  if (at < 0) throw new Error(`No ${head}`);
  let i = CSS.indexOf('{', at) + 1;
  let depth = 1;
  const start = i;
  while (depth && i < CSS.length) { if (CSS[i] === '{') depth += 1; else if (CSS[i] === '}') depth -= 1; i += 1; }
  return CSS.slice(start, i - 1);
}
const px = (decl, prop) => {
  const m = decl.match(new RegExp(`(?:^|;|\\s)${prop}\\s*:\\s*([^;]+)`));
  return m ? m[1].trim() : null;
};

describe('the 160px floor', () => {
  test('a Settings code never renders under 160px', () => {
    expect(px(rule('.brm .brm-codes-qr'), 'min-width')).toBe(`${FLOOR}px`);
    expect(px(rule('.brm .brm-codes-qr'), 'aspect-ratio')).toBe('1');
  });

  test('the demo slot (and the No demo yet placeholder) holds the same square, so nothing jumps when the code arrives', () => {
    const slot = rule('.brm .brm-codes-slot');
    expect(px(slot, 'min-width')).toBe(`${FLOOR}px`);
    expect(px(slot, 'aspect-ratio')).toBe('1');
    expect(px(slot, 'width')).toBe(px(rule('.brm .brm-codes-qr'), 'width'));
  });

  test('a Stage code is between 160px and 430px, alone or in two', () => {
    const two = rule('.brm .brm-wallcodes .brm-codes-qr');
    expect(px(two, 'min-width')).toBe(`${FLOOR}px`);
    expect(px(two, 'width')).toMatch(new RegExp(`^clamp\\(${FLOOR}px, .+, 430px\\)$`));
    expect(px(rule('.brm .brm-wallcodes.is-one .brm-codes-qr'), 'width')).toMatch(new RegExp(`^clamp\\(${FLOOR}px, .+, 430px\\)$`));
  });

  test('the Session body is the container both rules measure', () => {
    expect(px(rule('.brm .brm-sp-body'), 'container-type')).toBe('inline-size');
  });

  test('under 330px of panel the codes stack rather than shrink, each capped at 260px', () => {
    const narrow = atBlock('@container (max-width: 420px)');
    const gap = parseFloat(px(rule('.brm .brm-codes', narrow), 'gap'));
    // The stack rule fires below 2 x floor + the narrow gap: two codes side by side always clear 160px.
    const stack = Number(CSS.match(/@container \(max-width: (\d+)px\)\s*\{[^@]*?grid-template-columns:\s*minmax\(0, 1fr\)/)[1]);
    expect(stack + 1).toBeGreaterThanOrEqual(2 * FLOOR + gap);
    const stacked = atBlock(`@container (max-width: ${stack}px)`);
    expect(px(rule('.brm .brm-codes', stacked), 'grid-template-columns')).toBe('minmax(0, 1fr)');
    expect(stacked).toMatch(/\.brm \.brm-codes-qr, \.brm \.brm-codes-slot\s*\{\s*max-width:\s*260px/);
  });

  test('under 420px the tiles drop their frame so the code keeps its width', () => {
    const narrow = atBlock('@container (max-width: 420px)');
    const tile = rule('.brm .brm-codes-tile', narrow);
    expect(px(tile, 'padding')).toBe('0');
    expect(px(tile, 'border')).toBe('0');
  });

  test('at laptop width each code is 232px: the 560px panel, its padding, the gap, the tile frame', () => {
    const panel = Number(px(rule('.brm .brm-sp'), 'width').match(/min\((\d+)px/)[1]);
    const bodyPad = Number(px(rule('.brm .brm-sp-body'), 'padding').split(/\s+/)[1].replace('px', ''));
    const gap = parseFloat(px(rule('.brm .brm-codes'), 'gap'));
    const tilePad = parseFloat(px(rule('.brm .brm-codes-tile'), 'padding'));
    const border = parseFloat(px(rule('.brm .brm-codes-tile'), 'border'));
    // The panel's 2px left rule sits inside its width (box-sizing: border-box).
    const container = panel - 2 - 2 * bodyPad;
    const code = (container - gap) / 2 - 2 * tilePad - 2 * border;
    expect(Math.round(code)).toBeGreaterThanOrEqual(230);
    expect(Math.round(code)).toBeLessThanOrEqual(234);
    // And a 375px phone: full width, 14px padding, frameless, the narrow gap.
    const narrowGap = parseFloat(px(rule('.brm .brm-codes', atBlock('@container (max-width: 420px)')), 'gap'));
    const phone = (375 - 2 * 14 - narrowGap) / 2;
    expect(phone).toBeGreaterThanOrEqual(FLOOR);
  });
});

/* ---- contrast, measured ---- */
function lin(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }
function lum(c) { return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]); }
function ratio(a, b) { const x = lum(a); const y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.substr(i, 2), 16));
const over = (fg, bg, a) => fg.map((c, i) => c * a + bg[i] * (1 - a));
function rootToken(name) {
  const root = GLOBAL.slice(GLOBAL.indexOf(':root'), GLOBAL.indexOf('}', GLOBAL.indexOf(':root')));
  return hex(root.match(new RegExp(`${name}:\\s*(#[0-9A-Fa-f]{6})`))[1]);
}
function brmToken(name) {
  const m = CSS.match(new RegExp(`${name}:\\s*(#[0-9A-Fa-f]{6}|rgba\\([^)]*\\))`));
  if (m[1].startsWith('#')) return { rgb: hex(m[1]), a: 1 };
  const n = m[1].match(/[\d.]+/g).map(Number);
  return { rgb: n.slice(0, 3), a: n[3] };
}
const AA = 4.5;

describe('the words on the codes clear AA, composited', () => {
  const text = rootToken('--text');
  const muted = rootToken('--muted');
  const surface = rootToken('--surface');
  const bg = rootToken('--bg');
  const success = brmToken('--brm-success-text').rgb;
  const danger = rootToken('--danger-text');

  test('a framed tile (--surface): heading, address, line, count, the failed heading', () => {
    expect(ratio(text, surface)).toBeGreaterThanOrEqual(AA);
    expect(ratio(muted, surface)).toBeGreaterThanOrEqual(AA);
    expect(ratio(success, surface)).toBeGreaterThanOrEqual(AA);
    expect(ratio(danger, surface)).toBeGreaterThanOrEqual(AA);
  });

  test('a frameless tile on a phone sits on the panel (--bg)', () => {
    expect(ratio(text, bg)).toBeGreaterThanOrEqual(AA);
    expect(ratio(muted, bg)).toBeGreaterThanOrEqual(AA);
    expect(ratio(success, bg)).toBeGreaterThanOrEqual(AA);
  });

  test('No demo yet: the label sits on a solid --surface backing, never on the dot field', () => {
    expect(px(rule('.brm .brm-codes-slot--tbd .brm-codes-slot-t'), 'background')).toBe('var(--surface)');
    expect(ratio(text, surface)).toBeGreaterThanOrEqual(AA);
    expect(ratio(muted, surface)).toBeGreaterThanOrEqual(AA);
    // The worst a dot or a corner mark could do to the field around the label, were text ever drawn there.
    const ink = brmToken('--brm-tbd-ink');
    const field = over(ink.rgb, bg, ink.a);
    expect(ratio(text, field)).toBeGreaterThanOrEqual(AA);
    // The marks are decoration, soft by design (about 1.8:1): nobody mistakes them for a code to scan.
    expect(ratio(field, bg)).toBeLessThan(2);
    // No tbd token ever colours text.
    expect(CSS).not.toMatch(/(^|[^-])color:\s*var\(--brm-tbd/);
  });

  test('the Stage card: the eyebrow, heading and lines on the stage (--bg)', () => {
    expect(px(rule('.brm .brm-wallcodes-eb'), 'color')).toBe('var(--muted)');
    expect(px(rule('.brm .brm-wallcodes-eb.is-live'), 'color')).toBe('var(--brm-success-text)');
    expect(ratio(success, bg)).toBeGreaterThanOrEqual(AA);
    expect(ratio(muted, bg)).toBeGreaterThanOrEqual(AA);
  });
});
