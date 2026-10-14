/**
 * THE NOTICE'S PALETTE — components/ui/Notice.css (unit L12, SPEC §6, PLAN Phase 1).
 *
 * Named *Palette*, never *Token* (.gitignore:35). Reads the sheet as text and resolves
 * every layer with the skin harness for EVERY skin x theme (H.CASES). PLAN's proof for
 * L12: the tints, composited, keep the words at AA. Here: each tone's ink over its own
 * tint over --bg, --surface and --surface-2. Also:
 *   - roles only (the gate at 0; no --primary/--secondary/--sk-*; tints are channel forms);
 *   - the per-theme ink blocks sit where roles.css puts the roles (dusk, then paper),
 *     declare only --ui-notice-*-ink, and cover every tone in both;
 *   - every other selector is rooted at .ui-notice, and styles.css declares nothing there;
 *   - danger copy never reads --danger; the font size is the caller's.
 */
const H = require('../testing/skinHarness');
const S = require('../testing/skinScan');

const CSS = H.css('components/ui/Notice.css');
const BODY = CSS.replace(/\/\*[\s\S]*?\*\//g, ' ');
const DUSK = ':root, [data-theme="dark"]';
const PAPER = '[data-theme="light"]';
const TONES = ['ok', 'warn', 'danger', 'note'];

function rulesOf(text) {
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(text))) {
    const decls = {};
    for (const d of m[2].split(';')) {
      const i = d.indexOf(':');
      if (i > 0) decls[d.slice(0, i).trim()] = d.slice(i + 1).trim();
    }
    out.push({ selector: m[1].trim().replace(/\s+/g, ' '), decls });
  }
  return out;
}
const RULES = rulesOf(BODY);
const rule = (sel) => {
  const r = RULES.find((x) => x.selector === sel);
  if (!r) throw new Error(`no rule ${sel}`);
  return r.decls;
};

/** Resolve a value written in roles (var(--x), rgb(var(--x-rgb) / a)) for skin x theme. */
function resolve(value, opts) {
  const ink = value.match(/^var\((--ui-notice-[\w-]+-ink)\)$/);
  if (ink) return H.scopeVar(CSS, `${opts.theme === 'dark' ? DUSK : PAPER} {`, ink[1], opts);
  return value
    .replace(/rgb\(var\((--[\w-]+)\)\s*\/\s*([\d.]+)\)/g, (_, n, a) => `rgb(${H.channel(n, opts).join(' ')} / ${a})`)
    .replace(/var\((--[\w-]+)\)/g, (_, n) => H.role(n, opts));
}
const layer = (tone, name, opts) => resolve(rule(`.ui-notice--${tone}`)[`--ui-notice-${name}`], opts);

describe('Notice.css reads roles only', () => {
  test('the gate: no colour or font literal, no --primary read, pragma at 0', () => {
    expect(S.gateCounts(S.scanCss(CSS).counts)).toEqual({ colour: 0, font: 0, primary: 0 });
    expect(S.filePragma(CSS)).toEqual({ colour: 0, font: 0, primary: 0 });
  });

  test('no --primary, --secondary or --sk-* value; no --danger on copy', () => {
    expect(BODY).not.toMatch(/var\(--(primary|secondary|sk-)/);
    for (const r of RULES) {
      for (const [p, v] of Object.entries(r.decls)) {
        if (p === 'color' || /-ink$/.test(p)) expect(v).not.toBe('var(--danger)');
      }
    }
  });

  test('every role it reads resolves in every skin x theme', () => {
    const names = [...new Set([...BODY.matchAll(/var\((--[\w-]+)\s*(,)?/g)].filter((m) => !m[2]).map((m) => m[1]))]
      .filter((n) => !n.startsWith('--ui-notice-'));
    expect(names.length).toBeGreaterThan(10);
    H.eachSkinTheme((skin, theme) => {
      for (const n of names) expect(() => H.role(n, { skin, theme })).not.toThrow();
    });
  });

  test('the ink blocks: dusk then paper, the same names, only --ui-notice-<tone>-ink', () => {
    expect(BODY.indexOf(`${PAPER} {`)).toBeGreaterThan(BODY.indexOf(`${DUSK} {`));
    expect(BODY.indexOf(`${DUSK} {`)).toBeGreaterThanOrEqual(0);
    const want = TONES.map((t) => `--ui-notice-${t}-ink`).sort();
    expect(Object.keys(rule(DUSK)).sort()).toEqual(want);
    expect(Object.keys(rule(PAPER)).sort()).toEqual(want);
  });

  test('every other selector is rooted at .ui-notice; styles.css declares nothing there', () => {
    for (const r of RULES) {
      if (r.selector === DUSK || r.selector === PAPER) continue;
      expect(r.selector).toMatch(/^\.ui-notice\b/);
    }
    expect(H.css('styles.css')).not.toMatch(/\.ui-notice\b/);
  });

  test('every tone sets tint, edge, hue and ink; tints are channel forms', () => {
    for (const t of TONES) {
      const d = rule(`.ui-notice--${t}`);
      for (const k of ['tint', 'edge', 'hue', 'ink']) expect(d).toHaveProperty(`--ui-notice-${k}`);
      expect(d['--ui-notice-tint']).toMatch(/^rgb\(var\(--[\w-]+-rgb\) \/ \.\d+\)$/);
    }
    expect(rule('.ui-notice')['font-size']).toBe('var(--ui-size, 1em)');
    expect(rule('.ui-notice')['border-radius']).toBe('var(--radius-sm)');
  });

  test('the note tone is info, not the accent (Present keeps it blue, Classic keeps it blue)', () => {
    expect(rule('.ui-notice--note')['--ui-notice-hue']).toBe('var(--info)');
  });
});

describe.each(H.CASES)('%s / %s: the words clear AA over their tint', (skin, theme) => {
  const opts = { skin, theme };
  const grounds = ['--bg', '--surface', '--surface-2'].map((g) => [g, H.role(g, opts)]);
  test.each(TONES)('%s on --bg, --surface and --surface-2', (tone) => {
    const ink = layer(tone, 'ink', opts);
    const tint = layer(tone, 'tint', opts);
    for (const [g, bg] of grounds) {
      const r = H.on(ink, [bg, tint]);
      if (r < H.AA) throw new Error(`${tone} ink ${ink} over ${tint} on ${g} ${bg} is ${r.toFixed(2)}:1`);
    }
  });
});
