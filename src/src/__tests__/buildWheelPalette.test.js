/**
 * THE WHEEL'S DESIGN CONTRACT — buildroom/BuildWheel.css (`.bwh`).
 *
 * Named *Palette*, never *Token* (.gitignore swallows `*token*`). jsdom loads
 * no stylesheet, so this reads the sheet as text: every ink on every slice
 * tone clears AA, the sheet stays inside its scope and uses tokens only, and
 * the geometry the wall, the host and the phones share is pinned.
 */
import { sliceCenter, restingAngle, nextAngle, sliceTone } from '../buildroom/BuildWheel';

const fs = require('fs');
const path = require('path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const CSS = read('buildroom', 'BuildWheel.css');
const H = require('../testing/skinHarness');

/* Resolved per skin through the harness; the wheel draws inside the Build Room's dusk
   root (`.brm data-theme="dark"`). */
describe.each(H.SKINS)('every ink on every slice clears AA (%s)', (skin) => {
  const r = (name) => H.role(name, { skin, theme: 'dark' });
  const T = {
    bg: r('--bg'), text: r('--text'), surface2: r('--surface-2'),
    primary: r('--primary'), secondary: r('--secondary'), success: r('--success'),
  };
  test.each([
    ['a letter on the amber slice', T.bg, T.primary],
    ['a letter on the blue slice', T.bg, T.secondary],
    ['a letter on the green slice', T.bg, T.success],
    ['a letter on the dusk slice', T.text, T.surface2],
    ['the hub letter', T.primary, T.bg],
    ['the caption', T.text, T.bg],
    ['the Spin button', T.bg, T.primary],
  ])('%s', (_l, fg, bg) => expect(H.ratio(fg, bg)).toBeGreaterThanOrEqual(H.AA));
});

describe('the sheet', () => {
  const stripped = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  test('every selector is rooted at .bwh', () => {
    const out = [];
    for (const blk of stripped.split('}')) {
      const head = blk.split('{')[0];
      if (!head.trim() || head.includes('@')) continue;
      head.split(',').map((x) => x.trim()).filter(Boolean).forEach((sel) => { if (!/^\.bwh\b/.test(sel)) out.push(sel); });
    }
    expect(out).toEqual([]);
  });
  test('no hex literal; colour is tokens', () => {
    expect(stripped.match(/#[0-9a-f]{3,8}\b/gi)).toBeNull();
  });
  test('reduced motion stops the spin', () => {
    expect(CSS).toMatch(/prefers-reduced-motion: reduce\)\s*{\s*\.bwh \.bwh-rot { transition: none; }/);
  });
});

describe('the geometry every screen shares', () => {
  test('slice centres, and the resting angle that puts a slice under the pointer', () => {
    expect(sliceCenter(0, 4)).toBe(45);
    expect(restingAngle(0, 4)).toBe(315);
    expect(restingAngle(3, 4)).toBe(45);
  });
  test('a spin always goes forward, at least the given turns, and ends on its slice', () => {
    const to = nextAngle(315, 2, 4, 5);
    expect(to - 315).toBeGreaterThanOrEqual(5 * 360);
    expect(((to % 360) + 360) % 360).toBe(restingAngle(2, 4));
  });
  test('neighbouring slices never share a tone, round the circle too', () => {
    for (let n = 2; n <= 12; n += 1) {
      const tones = Array.from({ length: n }, (_, i) => sliceTone(i, n));
      for (let i = 0; i < n; i += 1) expect(tones[i]).not.toBe(tones[(i + 1) % n]);
    }
  });
});
