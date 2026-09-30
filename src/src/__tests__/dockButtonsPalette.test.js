/**
 * THE STAGE DOCK'S BUTTONS — which one leads, and a disabled one looks it.
 *
 * QA drive 2026-09-29, finding #6: with no answers in, the dock drew "Skip
 * Question" / "Skip Round" as the emphasised button (a white fill, amber
 * outline, amber type) while the DISABLED "Show Results" / "Start Voting" was
 * a solid blue that read as live; on What We Heard, "Skip to Next Round"
 * competed with "Next Page". Neither colour was a decision — both leaked in
 * from bare `.btn-primary` / `.btn-secondary` rules elsewhere in the bundle.
 * styles/stage.css now paints every dock state itself; this file pins that.
 *
 * NAMED "Palette", not "Tokens": `.gitignore` carries an unanchored `*token*`,
 * so a file named for tokens is invisible to git. Do not rename it.
 *
 * jsdom loads no stylesheet and has no layout engine, so every assertion here
 * reads the CSS as text and does arithmetic on it. Measured twice, like every
 * stage palette test: on the dusk field and on the projector-lifted #2A3550
 * (host spec 2026-08-08, "roughly 1.6x of every ratio" lost in a lit room).
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..');
const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const STAGE = strip(fs.readFileSync(path.join(SRC, 'styles', 'stage.css'), 'utf8'));
const GLOBAL_CSS = strip(fs.readFileSync(path.join(SRC, 'styles.css'), 'utf8'));

/* ------------------------------------------------------------------ colour */
const lin = (c) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
const lum = (rgb) => 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
const ratio = (a, b) => { const la = lum(a); const lb = lum(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); };
const parseHex = (h) => [1, 3, 5].map((i) => parseInt(h.substr(i, 2), 16));
const over = (fg, bg, a) => fg.map((c, i) => c * a + bg[i] * (1 - a));
const parseRgba = (s) => { const m = s.match(/[\d.]+/g).map(Number); return { rgb: m.slice(0, 3), a: m.length > 3 ? m[3] : 1 }; };

function tokenIn(css, blockHead, name) {
  let start = css.indexOf(blockHead);
  if (start < 0) throw new Error(`no ${blockHead} block`);
  while (start >= 0) {
    const body = css.slice(start, css.indexOf('}', start));
    const m = body.match(new RegExp(`${name}\\s*:\\s*(#[0-9A-Fa-f]{6})`));
    if (m) return m[1];
    start = css.indexOf(blockHead, start + 1);
  }
  throw new Error(`${name} not declared in any ${blockHead} block`);
}

/* The stage re-enters dusk on `.stage{…}`, so its --text/--muted are the
   values the dock paints with, not :root's. */
const T = {
  bg: parseHex(tokenIn(STAGE, '.stage{', '--bg')),
  text: parseHex(tokenIn(STAGE, '.stage{', '--text')),
  muted: parseHex(tokenIn(STAGE, '.stage{', '--muted')),
  primary: parseHex(tokenIn(GLOBAL_CSS, ':root {', '--primary')),
};
const FIELDS = [['the dusk field', T.bg], ['the projector-lifted field', parseHex('#2A3550')]];
const AA = 4.5;

/* --------------------------------------------------------------- the rules */
const norm = (s) => s.replace(/\s+/g, ' ').trim();
function rulesOf(css) {
  const out = [];
  // Top-level and one-level @media bodies alike: flatten by splitting on '}'.
  for (const chunk of css.split('}')) {
    const i = chunk.lastIndexOf('{');
    if (i < 0) continue;
    const head = norm(chunk.slice(0, i).replace(/^[\s\S]*\{/, ''));
    if (!head || head.startsWith('@')) continue;
    out.push({ selectors: head.split(',').map(norm), body: chunk.slice(i + 1) });
  }
  return out;
}
const STAGE_RULES = rulesOf(STAGE);
const decl = (body, prop) => {
  const m = body.match(new RegExp(`(?:^|;|\\s|\\{)${prop}\\s*:\\s*([^;]+)`));
  return m ? m[1].trim() : null;
};
/** Every declaration of `prop` for `selector`, merged in source order. */
function valueFor(selector, prop) {
  let v = null;
  for (const r of STAGE_RULES) {
    if (r.selectors.includes(selector)) {
      const d = decl(r.body, prop);
      if (d !== null) v = d;
    }
  }
  return v;
}
const hasRule = (selector) => STAGE_RULES.some((r) => r.selectors.includes(selector));
const tokenColour = (value) => {
  const m = String(value).match(/^var\(--(text|muted|primary)\)$/);
  if (m) return T[m[1]];
  if (/^#[0-9A-Fa-f]{6}$/.test(value)) return parseHex(value);
  throw new Error(`colour "${value}" is not one this test knows`);
};

const P = '.dock .host-action-bar__primary';
const P_HOVER = `${P}:hover:not(:disabled)`;
const P_OFF = `${P}:disabled`;
const QUIET = ['.dock .host-action-bar__secondary', '.dock .host-action-bar__tertiary'];

describe('every dock button state is declared by the dock itself', () => {
  test.each([P, P_HOVER, P_OFF, ...QUIET, ...QUIET.map((q) => `${q}:hover`)])('%s', (sel) => {
    expect(hasRule(sel)).toBe(true);
  });
});

describe('the primary is the one filled, amber button', () => {
  test('amber fill, dark ink, and the ink clears AA on it', () => {
    expect(valueFor(P, 'background')).toBe('var(--primary)');
    const ink = tokenColour(valueFor(P, 'color'));
    expect(ratio(ink, T.primary)).toBeGreaterThanOrEqual(AA);
  });

  test('hovering keeps it amber (the leaked hover was Bootstrap blue)', () => {
    expect(valueFor(P_HOVER, 'background')).toBe('var(--primary)');
  });
});

describe('a disabled primary reads as disabled', () => {
  test('no solid fill: a faint grey wash, never --primary', () => {
    const bg = valueFor(P_OFF, 'background');
    expect(bg).toMatch(/^rgba\(/);
    expect(parseRgba(bg).a).toBeLessThanOrEqual(0.25);
  });

  test('muted type, a not-allowed cursor, and no opacity trick', () => {
    expect(valueFor(P_OFF, 'color')).toBe('var(--muted)');
    expect(valueFor(P_OFF, 'cursor')).toBe('not-allowed');
    // styles.css's `.btn-primary:disabled{opacity:.6}` would dim the label
    // under the measured ratio below; the dock pins it back to 1.
    expect(valueFor(P_OFF, 'opacity')).toBe('1');
    expect(valueFor(P_OFF, 'transform')).toBe('none');
  });

  // WCAG exempts disabled controls from 1.4.3, but the hint beside it and the
  // label itself still tell a host WHY nothing happens — so it is held to AA
  // anyway, composited through the wash onto the field.
  test.each(FIELDS)('its label still clears AA on %s', (_label, field) => {
    const wash = parseRgba(valueFor(P_OFF, 'background'));
    const ground = over(wash.rgb, field, wash.a);
    expect(ratio(tokenColour(valueFor(P_OFF, 'color')), ground)).toBeGreaterThanOrEqual(AA);
  });

  test('it is clearly quieter than the live primary', () => {
    const wash = parseRgba(valueFor(P_OFF, 'background'));
    const ground = over(wash.rgb, T.bg, wash.a);
    // The live fill stands off the field by far more than the wash does.
    expect(ratio(T.primary, T.bg)).toBeGreaterThan(ratio(ground, T.bg) * 3);
  });
});

describe('a secondary (Skip, Back, End survey) is never louder than the primary', () => {
  test.each(QUIET)('%s is a ghost: no fill, no amber, in any state', (sel) => {
    for (const s of [sel, `${sel}:hover`]) {
      expect(valueFor(s, 'background')).toBe('transparent');
      for (const prop of ['color', 'border', 'border-color', 'background']) {
        const v = valueFor(s, prop);
        if (v) expect(v).not.toMatch(/--primary|#F6A94C|white|#fff/i);
      }
    }
  });

  test.each(QUIET)('%s matches the dock\'s other quiet buttons (.dock-more)', (sel) => {
    expect(valueFor(sel, 'color')).toBe(valueFor('.dock-more', 'color'));
    expect(valueFor(sel, 'border')).toBe(valueFor('.dock-more', 'border'));
  });

  test.each(FIELDS)('but it is still clearly legible (AA) on %s', (_label, field) => {
    for (const sel of QUIET) {
      expect(ratio(tokenColour(valueFor(sel, 'color')), field)).toBeGreaterThanOrEqual(AA);
      expect(ratio(tokenColour(valueFor(`${sel}:hover`, 'color')), field)).toBeGreaterThanOrEqual(AA);
    }
  });
});

/* ------------------------------------------------ the leaks cannot win back */
function specificity(selector) {
  const s = selector.replace(/:not\(([^)]*)\)/g, ' $1');
  const ids = (s.match(/#[\w-]+/g) || []).length;
  const classes = (s.match(/\.[\w-]+|\[[^\]]*\]|:(?!:)[\w-]+/g) || []).length;
  const elements = (s.replace(/[.#:[][^\s>+~]*/g, ' ').match(/\b[a-z][\w-]*\b/gi) || []).length;
  return ids * 10000 + classes * 100 + elements;
}

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.name === 'node_modules' || e.name.startsWith('.')) return [];
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return walk(p);
    return e.name.endsWith('.css') ? [p] : [];
  });
}

/** Every BARE `.btn-primary…` / `.btn-secondary…` selector in the bundle. */
const LEAKS = walk(SRC).flatMap((file) => rulesOf(strip(fs.readFileSync(file, 'utf8')))
  .flatMap((r) => r.selectors
    .filter((sel) => /^\.btn-(primary|secondary)(:[\w-]+(\([^)]*\))?)*$/.test(sel))
    .map((sel) => ({ file: path.relative(SRC, file), sel, body: r.body }))));

const PAINT = ['background', 'background-color', 'color', 'border', 'opacity', 'transform', 'box-shadow'];
const dockSelectorFor = (leak) => {
  const primary = leak.sel.startsWith('.btn-primary');
  const state = /:hover/.test(leak.sel) ? 'hover' : /:disabled/.test(leak.sel.replace(/:not\([^)]*\)/g, '')) ? 'disabled' : 'base';
  if (primary) return { base: [P], hover: [P_HOVER, P_OFF], disabled: [P_OFF] }[state];
  return { base: QUIET, hover: QUIET.map((q) => `${q}:hover`), disabled: QUIET }[state];
};

describe('the bare .btn-primary / .btn-secondary rules in the bundle cannot repaint the dock', () => {
  test('there are leaks to guard against (so the loop below means something)', () => {
    expect(LEAKS.some((l) => l.file === 'styles.css')).toBe(true);
    expect(LEAKS.some((l) => /IssueReportForm/.test(l.file))).toBe(true);
  });

  test('every dock rule out-ranks, and repaints, every leak for its state', () => {
    const problems = [];
    for (const leak of LEAKS) {
      const leakPaint = PAINT.filter((p) => decl(leak.body, p) !== null)
        .map((p) => (p === 'background-color' ? 'background' : p));
      if (!leakPaint.length) continue;
      // A hover leak on the primary reaches a disabled button too unless it
      // says :not(:disabled); the disabled rule must beat it then.
      const targets = dockSelectorFor(leak).filter((t) => !(t === P_OFF && /:not\(:disabled\)/.test(leak.sel)));
      for (const t of targets) {
        if (specificity(t) <= specificity(leak.sel)) {
          problems.push(`${t} does not out-rank ${leak.sel} (${leak.file})`);
          continue;
        }
        for (const p of leakPaint) {
          // The dock's base rule sets these for every state; a state rule may
          // rely on it only where the base out-ranks the leak too.
          const own = valueFor(t, p) ?? (p === 'border' ? valueFor(t, 'border-color') : null);
          const base = QUIET.includes(t.replace(/:hover$/, '')) ? t.replace(/:hover$/, '') : P;
          const inherited = specificity(base) > specificity(leak.sel) ? valueFor(base, p) : null;
          if (own === null && inherited === null) problems.push(`${t} leaves ${p} to ${leak.sel} (${leak.file})`);
        }
      }
    }
    expect(problems).toEqual([]);
  });
});
