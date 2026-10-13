/**
 * THE BUTTON'S PALETTE — components/ui/Button.css (unit L3, SPEC §6, PLAN Phase 1).
 *
 * Named *Palette*, never *Token* (.gitignore:35). jsdom loads no stylesheet, so this
 * reads the sheet as text and resolves every role it paints with the skin harness, for
 * EVERY skin x theme (H.CASES), composited where a layer is translucent. It proves:
 *   - roles only: no literal colour or font (the gate at 0), no --primary/--secondary,
 *     no --sk-* value, and every var() it reads resolves in every case;
 *   - `action` reads --action/--on-action, and under [data-surface="wall"] Present
 *     resolves blue while Classic keeps the stage orange — hover included;
 *   - danger fills with --danger-deep;
 *   - a focus ring exists and clears 3:1 against the grounds a button sits on;
 *   - every ink clears AA on its fill (and the quiet ink on every ground);
 *   - every selector is rooted at .ui-btn, styles.css declares nothing there, and the
 *     sizes set no font-size of their own (the caller's ladder sets type).
 */
const H = require('../testing/skinHarness');
const S = require('../testing/skinScan');

const CSS = H.css('components/ui/Button.css');
const BODY = CSS.replace(/\/\*[\s\S]*?\*\//g, ' ');

/** Top-level rules of the sheet: [{ selectors[], decls: { prop: value } }]. */
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
    out.push({ selectors: m[1].split(',').map((s) => s.trim().replace(/\s+/g, ' ')), decls });
  }
  return out;
}
const RULES = rulesOf(BODY);
function decl(selector, prop) {
  const r = RULES.filter((x) => x.selectors.includes(selector) && prop in x.decls).pop();
  if (!r) throw new Error(`no ${prop} under ${selector}`);
  return r.decls[prop];
}
const HOVER = ':hover:not(:disabled):not([aria-disabled="true"])';

/** Resolve a value written in roles: var(--x) and rgb(var(--x-rgb) / a). */
function resolve(value, opts) {
  return value
    .replace(/rgb\(var\((--[\w-]+)\)\s*\/\s*([\d.]+)\)/g, (_, n, a) => `rgb(${H.channel(n, opts).join(' ')} / ${a})`)
    .replace(/rgb\(var\((--[\w-]+)\)\)/g, (_, n) => `rgb(${H.channel(n, opts).join(' ')})`)
    .replace(/var\((--[\w-]+)\)/g, (_, n) => H.role(n, opts));
}
const paint = (selector, prop, opts) => resolve(decl(selector, prop), opts);

describe('Button.css reads roles only', () => {
  test('the gate: no colour or font literal, no --primary read, pragma at 0', () => {
    const { counts } = S.scanCss(CSS);
    expect(S.gateCounts(counts)).toEqual({ colour: 0, font: 0, primary: 0 });
    expect(S.filePragma(CSS)).toEqual({ colour: 0, font: 0, primary: 0 });
  });

  test('no --primary, --secondary or --sk-* value is read', () => {
    expect(BODY).not.toMatch(/var\(--(primary|secondary|sk-)/);
  });

  test('every var() it reads resolves in every skin x theme (or carries a fallback)', () => {
    const names = [...new Set([...BODY.matchAll(/var\((--[\w-]+)\s*(,)?/g)].filter((m) => !m[2]).map((m) => m[1]))];
    expect(names.length).toBeGreaterThan(8);
    H.eachSkinTheme((skin, theme) => {
      for (const n of names) expect(() => H.role(n, { skin, theme })).not.toThrow();
    });
  });

  test('every selector is rooted at .ui-btn (the wall hover names the wall, then .ui-btn)', () => {
    for (const r of RULES) {
      for (const s of r.selectors) expect(s).toMatch(/^(\[data-surface="wall"\] )?\.ui-btn\b/);
    }
  });

  test('styles.css declares nothing under .ui-btn', () => {
    expect(H.css('styles.css')).not.toMatch(/\.ui-btn\b/);
  });

  test('sizes change padding and height only, never the type', () => {
    expect(decl('.ui-btn', 'font-size')).toBe('var(--ui-size, 1em)');
    for (const s of ['.ui-btn--sm', '.ui-btn--lg']) {
      const r = RULES.find((x) => x.selectors.includes(s));
      expect(Object.keys(r.decls).sort()).toEqual(['min-height', 'padding']);
    }
    const sized = RULES.filter((r) => 'font-size' in r.decls || 'font' in r.decls);
    expect(sized.map((r) => r.selectors.join(','))).toEqual(['.ui-btn']);
  });
});

describe('the variants read the roles SPEC §6 names', () => {
  test('action: --action fill, --on-action ink, --action-hover off the wall', () => {
    expect(decl('.ui-btn--action', 'background')).toBe('var(--action)');
    expect(decl('.ui-btn--action', 'color')).toBe('var(--on-action)');
    expect(decl(`.ui-btn--action${HOVER}`, 'background')).toBe('var(--action-hover)');
  });
  test('accent: --accent fill, --on-accent ink', () => {
    expect(decl('.ui-btn--accent', 'background')).toBe('var(--accent)');
    expect(decl('.ui-btn--accent', 'color')).toBe('var(--on-accent)');
  });
  test('quiet: --rule-strong outline, --text ink', () => {
    expect(decl('.ui-btn--quiet', 'border-color')).toBe('var(--rule-strong)');
    expect(decl('.ui-btn--quiet', 'color')).toBe('var(--text)');
  });
  test('danger: --danger-deep fill, never --danger', () => {
    expect(decl('.ui-btn--danger', 'background')).toBe('var(--danger-deep)');
    expect(BODY).not.toMatch(/var\(--danger\)/);
  });
  test('radius from --radius-sm', () => {
    expect(decl('.ui-btn', 'border-radius')).toBe('var(--radius-sm)');
  });
});

describe('the wall (SPEC §3.4): Present blue, Classic orange', () => {
  const wallHover = `[data-surface="wall"] .ui-btn--action${HOVER}`;
  test.each(H.CASES)('%s / %s: the action on the wall is the skin\'s wall colour, hover too', (skin, theme) => {
    const opts = { skin, theme, surface: 'wall' };
    const want = H.role('--sk-wall-action', opts);
    expect(paint('.ui-btn--action', 'background', opts)).toBe(want);
    expect(paint(wallHover, 'background', opts)).toBe(want);
    expect(H.on(paint('.ui-btn--action', 'color', opts), [want])).toBeGreaterThanOrEqual(H.AA);
  });
  test('Present wall is blue (the accent), Classic wall is the stage orange', () => {
    const present = H.CASES.some(([s]) => s === 'present');
    if (present) {
      expect(H.role('--action', { skin: 'present', theme: 'dark', surface: 'wall' })).toBe(H.role('--accent', { skin: 'present' }));
    }
    expect(H.role('--action', { skin: 'classic', theme: 'dark', surface: 'wall' })).toBe('#F6A94C');
  });
});

describe.each(H.CASES)('%s / %s: contrast, composited', (skin, theme) => {
  const opts = { skin, theme };
  const bg = H.role('--bg', opts);
  const surface = H.role('--surface', opts);
  const surface2 = H.role('--surface-2', opts);
  const GROUNDS = [['bg', [bg]], ['surface', [surface]], ['surface-2', [surface2]]];

  test('action: ink on fill and on hover', () => {
    const ink = paint('.ui-btn--action', 'color', opts);
    expect(H.on(ink, [paint('.ui-btn--action', 'background', opts)])).toBeGreaterThanOrEqual(H.AA);
    expect(H.on(ink, [paint(`.ui-btn--action${HOVER}`, 'background', opts)])).toBeGreaterThanOrEqual(H.AA);
  });

  test('accent: ink on fill and on hover', () => {
    const ink = paint('.ui-btn--accent', 'color', opts);
    expect(H.on(ink, [paint('.ui-btn--accent', 'background', opts)])).toBeGreaterThanOrEqual(H.AA);
    expect(H.on(ink, [paint(`.ui-btn--accent${HOVER}`, 'background', opts)])).toBeGreaterThanOrEqual(H.AA);
  });

  test.each(GROUNDS)('quiet: ink on %s, resting and hovered', (_, ground) => {
    const ink = paint('.ui-btn--quiet', 'color', opts);
    expect(H.on(ink, ground)).toBeGreaterThanOrEqual(H.AA);
    expect(H.on(ink, [...ground, paint(`.ui-btn--quiet${HOVER}`, 'background', opts)])).toBeGreaterThanOrEqual(H.AA);
  });

  test('danger: light ink on --danger-deep, and on the darkened hover', () => {
    const ink = paint('.ui-btn--danger', 'color', opts);
    const fill = paint('.ui-btn--danger', 'background', opts);
    expect(H.on(ink, [fill])).toBeGreaterThanOrEqual(H.AA);
    const shade = paint(`.ui-btn--danger${HOVER}`, 'box-shadow', opts).match(/rgb\([^)]*\)/)[0];
    expect(H.on(ink, [fill, shade])).toBeGreaterThanOrEqual(H.on(ink, [fill]));
  });

  test.each(GROUNDS)('the focus ring clears 3:1 on %s', (_, ground) => {
    const ring = paint('.ui-btn:focus-visible', 'outline', opts).replace(/^2px solid /, '');
    expect(H.on(ring, ground)).toBeGreaterThanOrEqual(3);
  });
});
