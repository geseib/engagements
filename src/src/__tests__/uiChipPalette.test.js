/**
 * THE CHIP'S PALETTE — components/ui/Chip.css (unit L8, SPEC §6, PLAN Phase 1).
 *
 * Named *Palette*, never *Token* (.gitignore:35). Reads the sheet as text and resolves
 * every ink with the skin harness for EVERY skin x theme (H.CASES). PLAN's proof for L8:
 * every tone clears AA on --bg and --surface (and here on --surface-2 too). Also:
 *   - roles only (the gate at 0, no --primary/--secondary/--sk-*);
 *   - the per-theme ink blocks sit where roles.css puts the roles (`:root,
 *     [data-theme="dark"]` THEN `[data-theme="light"]`, so <html data-theme="light">
 *     resolves paper), declare only --ui-chip-*-ink, and cover every tone in both;
 *   - every other selector is rooted at .ui-chip, and styles.css declares nothing there;
 *   - the phase hues are the --phase-* roles (Classic ask orange, Present ask blue);
 *   - danger ink is never --danger.
 */
const H = require('../testing/skinHarness');
const S = require('../testing/skinScan');

const CSS = H.css('components/ui/Chip.css');
const BODY = CSS.replace(/\/\*[\s\S]*?\*\//g, ' ');
const DUSK_BLOCK = ':root, [data-theme="dark"] {';
const PAPER_BLOCK = '[data-theme="light"] {';
const TONES = ['ask', 'vote', 'results', 'ok', 'warn', 'danger', 'muted'];

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

/** What a tone's word is painted in, for skin x theme, resolved the way the browser does. */
function ink(tone, opts) {
  const v = rule(`.ui-chip--${tone}`)['--ui-chip-ink'];
  const m = v.match(/^var\((--ui-chip-[\w-]+-ink)\)$/);
  if (m) return H.scopeVar(CSS, opts.theme === 'dark' ? DUSK_BLOCK : PAPER_BLOCK, m[1], opts);
  return H.role(v.match(/^var\((--[\w-]+)\)$/)[1], opts);
}
const hue = (tone, opts) => H.role(rule(`.ui-chip--${tone}`)['--ui-chip-hue'].match(/^var\((--[\w-]+)\)$/)[1], opts);

describe('Chip.css reads roles only', () => {
  test('the gate: no colour or font literal, no --primary read, pragma at 0', () => {
    expect(S.gateCounts(S.scanCss(CSS).counts)).toEqual({ colour: 0, font: 0, primary: 0 });
    expect(S.filePragma(CSS)).toEqual({ colour: 0, font: 0, primary: 0 });
  });

  test('no --primary, --secondary or --sk-* value is read; danger copy never --danger', () => {
    expect(BODY).not.toMatch(/var\(--(primary|secondary|sk-)/);
    for (const r of RULES) {
      for (const [p, v] of Object.entries(r.decls)) {
        if (p === 'color' || /-ink$/.test(p)) expect(v).not.toBe('var(--danger)');
      }
    }
  });

  test('every role it reads resolves in every skin x theme', () => {
    const names = [...new Set([...BODY.matchAll(/var\((--[\w-]+)\s*(,)?/g)].filter((m) => !m[2]).map((m) => m[1]))]
      .filter((n) => !n.startsWith('--ui-chip-'));
    expect(names.length).toBeGreaterThan(10);
    H.eachSkinTheme((skin, theme) => {
      for (const n of names) expect(() => H.role(n, { skin, theme })).not.toThrow();
    });
  });

  test('the ink blocks: dusk then paper, the same names, only --ui-chip-*-ink, one per coloured tone', () => {
    const iDusk = BODY.indexOf(DUSK_BLOCK);
    const iPaper = BODY.indexOf(PAPER_BLOCK);
    expect(iDusk).toBeGreaterThanOrEqual(0);
    expect(iPaper).toBeGreaterThan(iDusk);
    const dusk = Object.keys(rule(DUSK_BLOCK.slice(0, -2)));
    const paper = Object.keys(rule(PAPER_BLOCK.slice(0, -2)));
    expect(paper.sort()).toEqual(dusk.sort());
    for (const n of dusk) expect(n).toMatch(/^--ui-chip-[a-z]+-ink$/);
    expect(dusk.sort()).toEqual(TONES.filter((t) => t !== 'muted').map((t) => `--ui-chip-${t}-ink`).sort());
  });

  test('every other selector is rooted at .ui-chip; styles.css declares nothing there', () => {
    for (const r of RULES) {
      if (r.selector === DUSK_BLOCK.slice(0, -2) || r.selector === PAPER_BLOCK.slice(0, -2)) continue;
      expect(r.selector).toMatch(/^\.ui-chip\b/);
    }
    expect(H.css('styles.css')).not.toMatch(/\.ui-chip\b/);
  });

  test('every tone has a rule with a hue and an ink; the font size is the caller\'s', () => {
    for (const t of TONES) {
      expect(rule(`.ui-chip--${t}`)).toHaveProperty('--ui-chip-hue');
      expect(rule(`.ui-chip--${t}`)).toHaveProperty('--ui-chip-ink');
    }
    expect(rule('.ui-chip')['font-size']).toBe('var(--ui-size, .8em)');
    expect(rule('.ui-chip')['border-radius']).toBe('var(--badge-radius)');
  });
});

describe('the phase hues follow the skin', () => {
  test.each(H.CASES)('%s / %s: ask/vote/results are the --phase-* roles', (skin, theme) => {
    const opts = { skin, theme };
    for (const t of ['ask', 'vote', 'results']) expect(hue(t, opts)).toBe(H.role(`--phase-${t}`, opts));
  });
  test('Classic ask is the stage orange; Present ask is blue', () => {
    expect(hue('ask', { skin: 'classic', theme: 'dark' })).toBe('#F6A94C');
    if (H.CASES.some(([s]) => s === 'present')) expect(hue('ask', { skin: 'present', theme: 'dark' })).toBe('#7CA7E6');
  });
  test('on dusk the word is in the phase colour, as the stage chip is', () => {
    H.eachSkinTheme((skin, theme) => {
      if (theme !== 'dark') return;
      for (const t of ['ask', 'vote', 'results']) expect(ink(t, { skin, theme })).toBe(H.role(`--phase-${t}`, { skin, theme }));
    });
  });
});

describe.each(H.CASES)('%s / %s: every tone clears AA', (skin, theme) => {
  const opts = { skin, theme };
  const grounds = ['--bg', '--surface', '--surface-2'].map((g) => [g, H.role(g, opts)]);
  test.each(TONES)('%s on --bg, --surface and --surface-2', (tone) => {
    const fg = ink(tone, opts);
    for (const [g, bg] of grounds) {
      const r = H.ratio(fg, bg);
      if (r < H.AA) throw new Error(`${tone} ink ${fg} on ${g} ${bg} is ${r.toFixed(2)}:1`);
    }
  });
});
