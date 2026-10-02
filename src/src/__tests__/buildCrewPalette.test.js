/**
 * THE CREW BOARD'S DESIGN CONTRACT — buildroom/BuildCrew.css (`.brc`, dusk,
 * always mounted inside the Build Room root `.brm`).
 *
 * Named *Palette*, never *Token*: .gitignore carries an unanchored `*token*`.
 *
 * jsdom loads no stylesheet, so this reads the sheet as text and does the
 * arithmetic: every pairing the crew surfaces paint is composited up its real
 * ancestor stack and must clear AA 4.5:1, tints included. Then the house
 * rules: no hex outside the token block, --danger never carries text, every
 * var() is declared, every selector is rooted at `.brc` and styles.css
 * declares nothing there, the ladder and the 12px floor.
 */
const fs = require('fs');
const path = require('path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const GLOBAL_CSS = read('styles.css');
const ROOM_CSS = read('buildroom', 'BuildRoom.css');
const CREW_CSS = read('buildroom', 'BuildCrew.css');

function lin(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function lum(c) { return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]); }
function ratio(a, b) {
  const la = lum(a); const lb = lum(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
const parseHex = (h) => [1, 3, 5].map((i) => parseInt(h.substr(i, 2), 16));
function parseColor(c) {
  if (c.startsWith('#')) return [parseHex(c), 1];
  const m = c.match(/[\d.]+/g).map(Number);
  return [m.slice(0, 3), m.length > 3 ? m[3] : 1];
}
/** Paint the layers bottom-up, alpha over alpha, as a browser composites them. */
function composite(layers) {
  let out = null;
  for (const l of layers) {
    const [rgb, a] = parseColor(l);
    out = out ? rgb.map((c, i) => c * a + out[i] * (1 - a)) : rgb;
  }
  return out;
}
const on = (fg, layers) => ratio(parseHex(fg), composite(layers));
const AA = 4.5;

function token(css, block, name) {
  const start = css.indexOf(block);
  if (start < 0) throw new Error(`no ${block} block`);
  const body = css.slice(start, css.indexOf('}', start));
  const m = body.match(new RegExp(`${name}\\s*:\\s*(#[0-9A-Fa-f]{6}|rgba\\([^)]*\\))`));
  if (!m) throw new Error(`${name} not declared in ${block}`);
  return m[1];
}
const ROOT = ':root {';
const DUSK = '[data-theme="dark"] {';
const CREW = '.brc {';

const D = {
  bg: token(GLOBAL_CSS, DUSK, '--bg'),
  surface: token(GLOBAL_CSS, DUSK, '--surface'),
  surface2: token(GLOBAL_CSS, DUSK, '--surface-2'),
  text: token(GLOBAL_CSS, DUSK, '--text'),
  muted: token(GLOBAL_CSS, DUSK, '--muted'),
  primary: token(GLOBAL_CSS, ROOT, '--primary'),
  secondary: token(GLOBAL_CSS, ROOT, '--secondary'),
  success: token(GLOBAL_CSS, ROOT, '--success'),
  danger: token(GLOBAL_CSS, ROOT, '--danger'),
  dangerText: token(GLOBAL_CSS, ROOT, '--danger-text'),
  successText: token(CREW_CSS, CREW, '--brc-success-text'),
};
const T = {
  amber: token(CREW_CSS, CREW, '--brc-tint-amber'),
  blue: token(CREW_CSS, CREW, '--brc-tint-blue'),
  green: token(CREW_CSS, CREW, '--brc-tint-green'),
  red: token(CREW_CSS, CREW, '--brc-tint-red'),
};
const FIELD = [D.bg];
const LANE = [D.bg, D.surface];          // lanes, help, base notice, an Incoming card, the header bar, a dialog
const RAISED = [D.bg, D.surface2];       // comments, notes, version tabs

describe('crew (dusk): flat pairings', () => {
  const pairs = [
    ['names, tasks and summaries on a lane', D.text, LANE],
    ['checkpoints and hints on a lane', D.muted, LANE],
    ['a branch on a lane', D.secondary, LANE],
    ['the repo line icon in the dialog', D.secondary, LANE],
    ['a stale checkpoint on a lane', D.dangerText, LANE],
    ['the pipeline label and an empty count', D.muted, LANE],
    ['a pipeline count with work in it', D.primary, LANE],
    ['a merged count', D.successText, LANE],
    ['+ lines in a dialog', D.successText, LANE],
    ['− lines in a dialog', D.dangerText, LANE],
    ['+ lines on the wall stage', D.successText, FIELD],
    ['− lines on the wall stage', D.dangerText, FIELD],
    ['a review card (text)', D.text, FIELD],
    ['a review card (labels)', D.muted, FIELD],
    ['an off stage tab on the field', D.muted, FIELD],
    ['comment text on --surface-2', D.text, RAISED],
    ['a Question label on --surface-2', D.secondary, RAISED],
    ['a Concern label on --surface-2', D.primary, RAISED],
    ['an avatar letter on amber', D.bg, [D.primary]],
    ['an avatar letter on blue', D.bg, [D.secondary]],
    ['an avatar letter on green', D.bg, [D.success]],
    ['an avatar letter on grey', D.bg, [D.muted]],
  ];
  test.each(pairs)('%s clears AA', (_l, fg, layers) => {
    expect(on(fg, layers)).toBeGreaterThanOrEqual(AA);
  });
});

describe('crew (dusk): tinted composites', () => {
  const cases = [
    ['amber chip on a lane', D.primary, [...LANE, T.amber]],
    ['blue chip on a lane', D.secondary, [...LANE, T.blue]],
    ['green chip on a lane', D.successText, [...LANE, T.green]],
    ['red chip (Needs a rebase) on a lane', D.dangerText, [...LANE, T.red]],
    ['Run crew code: On in the header bar', D.primary, [...LANE, T.amber]],
    ['the "N new" badge on the crew tab', D.primary, [...FIELD, T.amber]],
    ['a reaction on the wall stage (amber)', D.primary, [...FIELD, T.amber]],
    ['a reaction on the wall stage (blue)', D.secondary, [...FIELD, T.blue]],
    ['a reaction on the wall stage (green)', D.successText, [...FIELD, T.green]],
    ['a suggestion number in a review', D.secondary, [...FIELD, T.blue]],
    ['tests run, the icon line', D.successText, [...FIELD, T.green]],
    ['tests run, the words', D.text, [...FIELD, T.green]],
    ['the base-moved icon', D.successText, [...LANE, T.green]],
  ];
  test.each(cases)('%s clears AA', (_l, fg, layers) => {
    expect(on(fg, layers)).toBeGreaterThanOrEqual(AA);
  });
});

const stripped = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

describe('BuildCrew.css house rules', () => {
  test('no hex literal survives outside the token block', () => {
    const start = CREW_CSS.indexOf(CREW);
    const rest = stripped(CREW_CSS.slice(0, start) + CREW_CSS.slice(CREW_CSS.indexOf('}', start) + 1));
    expect([...rest.matchAll(/(?:^|[\s:,(])(#[0-9A-Fa-f]{3,8})\b/g)].map((m) => m[1])).toEqual([]);
  });

  test('--danger never carries text', () => {
    expect(ratio(parseHex(D.danger), parseHex(D.surface))).toBeLessThan(AA);
    expect(CREW_CSS.split('\n').filter((l) => /(^|[^-])\bcolor\s*:\s*var\(--danger\)/.test(l))).toEqual([]);
  });

  test('every custom property used is declared (styles.css, the room it lives in, or here)', () => {
    const declared = new Set();
    for (const css of [GLOBAL_CSS, ROOM_CSS, CREW_CSS]) {
      for (const m of css.matchAll(/(--[a-z0-9-]+)\s*:/gi)) declared.add(m[1]);
    }
    const used = [...CREW_CSS.matchAll(/var\((--[a-z0-9-]+)/gi)].map((m) => m[1]);
    expect([...new Set(used)].filter((n) => !declared.has(n))).toEqual([]);
  });

  test('the only tokens borrowed from the room are its wall ladder', () => {
    const borrowed = [...new Set([...CREW_CSS.matchAll(/var\((--brm-[a-z0-9-]+)/gi)].map((m) => m[1]))];
    expect(borrowed.filter((n) => !n.startsWith('--brm-st-'))).toEqual([]);
  });

  test('every selector is rooted at .brc', () => {
    const out = new Set();
    for (const blk of stripped(CREW_CSS).split('}')) {
      const head = blk.split('{')[0];
      if (!head || head.includes('@')) continue;
      for (const sel of head.split(',')) {
        const s = sel.trim();
        if (!s) continue;
        const m = s.match(/^\.([\w-]+)/);
        out.add(m ? m[1] : s);
      }
    }
    expect([...out].filter((n) => n !== 'brc')).toEqual([]);
  });

  test('styles.css and BuildRoom.css declare nothing in this scope', () => {
    for (const css of [GLOBAL_CSS, ROOM_CSS]) {
      expect([...new Set([...stripped(css).matchAll(/\.(brc[\w-]*)/g)].map((m) => m[1]))]).toEqual([]);
    }
  });

  test.each([['floor', '12px'], ['label', '13px'], ['body', '15px'], ['head', '19px'], ['title', '24px'], ['num', '30px']])(
    'the ladder: --brc-t-%s is %s',
    (step, value) => {
      expect(CREW_CSS).toMatch(new RegExp(`--brc-t-${step}:\\s*${value}`));
    },
  );

  test('nothing is declared below the 12px floor', () => {
    const px = [...CREW_CSS.matchAll(/font(?:-size)?:[^;]*?(\d+)px/g)].map((m) => Number(m[1]));
    expect(px.filter((n) => n < 12)).toEqual([]);
  });

  test('rows are 36px', () => {
    expect(CREW_CSS).toMatch(/--brc-row-h:\s*36px/);
  });

  test('chip tones are three classes deep, so they beat `.brm .brm-chip` in either load order', () => {
    const tones = [...stripped(CREW_CSS).matchAll(/([^{}]*\.brc-tone-[a-z]+[^{}]*)\{/g)].map((m) => m[1]);
    expect(tones.length).toBeGreaterThan(0);
    for (const head of tones) {
      for (const sel of head.split(',')) expect((sel.match(/\./g) || []).length).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('the crew lives inside the dusk room', () => {
  const page = read('buildroom', 'BuildCrew.jsx');
  test('no crew surface declares a theme of its own (it inherits the room\'s dark root)', () => {
    expect(page).not.toMatch(/data-theme=/);
  });
  test('every crew dialog carries the scope class', () => {
    const contents = [...page.matchAll(/contentClassName="([^"]+)"/g)].map((m) => m[1]);
    expect(contents.length).toBeGreaterThanOrEqual(4);
    contents.forEach((c) => expect(c.split(' ')).toContain('brc'));
  });
});
