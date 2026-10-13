/**
 * THE TOP LINE'S CSS CONTRACT (components/ui/TopLine.css, PLAN §3 unit L7).
 *
 * Must prove: --hair is honoured (Call = 2px). The sheet reads --hair and never
 * declares it, and the display profiles in styles/stage.css resolve it to 2px
 * under :root.d-call and 1px under every other profile — resolved here by
 * specificity and order, the way a browser picks the winner, not by grepping
 * one line.
 *
 * Also: the line is --muted, its emphasis --text, the rule --rule; both inks
 * clear AA on every dusk ground in every skin (--bg, --surface, every stop of
 * --field and of --wall-canvas), and on the paper grounds as well, so a paper
 * mount is not a surprise. Values come through the harness, never retyped.
 *
 * Named *Palette.test.js, never *token*: .gitignore:35 is an unanchored
 * `*token*`. jsdom loads no stylesheet, so the contract is read as text.
 */
const fs = require('fs');
const path = require('path');
const H = require('../testing/skinHarness');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const CSS = read('components', 'ui', 'TopLine.css');
const STAGE = read('styles', 'stage.css');
const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const stripped = strip(CSS);
/* parseRules keeps custom properties only; prefix ordinary properties so it keeps them too. */
const asProps = (css) => strip(css).replace(/(\s|;|\{)([a-z-]+)\s*:/g, '$1--p-$2:');
const RULES = H.parseRules(asProps(CSS));

function decls(sel) {
  const rule = RULES.find((r) => r.selectors.join(', ') === sel);
  if (!rule) throw new Error(`no rule "${sel}" in TopLine.css`);
  return Object.fromEntries(rule.decls.map((d) => [d.prop.replace(/^--p-/, ''), d.value]));
}
const hexes = (v) => (v.match(/#[0-9a-f]{3,8}\b/gi) || []);

/**
 * --hair on <html class=PROFILE>: every stage.css rule whose selector is a single
 * :root compound (optionally with classes) and that declares --hair; the matching
 * one with the highest specificity, then the latest, wins.
 */
const later = (a, b) => { const i = a.findIndex((v, k) => v !== b[k]); return i < 0 || a[i] > b[i]; };
function hairOnRoot(profile) {
  let best = null;
  H.parseRules(strip(STAGE)).forEach((r, ri) => {
    const d = r.decls.find((x) => x.prop === '--hair');
    if (!d) return;
    for (const sel of r.selectors) {
      const p = H.parseSelector(sel);
      if (p.compounds.length !== 1) continue;
      const c = p.compounds[0];
      if (!c.root || c.unsupported || c.attrs.length || c.tag) continue;
      if (!c.classes.every((k) => k === profile)) continue;
      const key = [...p.spec, ri];
      if (!best || later(key, best.key)) best = { key, value: d.value };
    }
  });
  return best && best.value;
}

describe('--hair is honoured (Call = 2px)', () => {
  test('the rule beneath is var(--hair) solid var(--rule)', () => {
    expect(decls('.ui-top-line')['border-bottom']).toBe('var(--hair, 1px) solid var(--rule)');
  });

  test('the sheet never declares --hair (that would cut the profile off)', () => {
    expect(stripped).not.toMatch(/--hair\s*:/);
  });

  test.each([
    ['d-call', '2px'],
    ['d-room', '1px'],
    ['d-tv', '1px'],
    ['d-table', '1px'],
  ])('under :root.%s the profile gives --hair %s', (profile, px) => {
    expect(hairOnRoot(profile)).toBe(px);
  });

  test('the wall sets its own: 2px on the Call canvas', () => {
    expect(strip(read('present', 'present.css'))).toMatch(/\.present\[data-profile="call"\] \.present-canvas\s*\{\s*--hair:\s*2px;\s*\}/);
  });
});

describe('the treatment', () => {
  test('a muted line on the UI face; <b> is --text', () => {
    const d = decls('.ui-top-line');
    expect(d.color).toBe('var(--muted)');
    expect(d['font-family']).toBe('var(--font-ui)');
    expect(decls('.ui-top-line b').color).toBe('var(--text)');
  });

  test('size and spacing are the caller\'s hooks, never a px', () => {
    const d = decls('.ui-top-line');
    expect(d['font-size']).toBe('var(--ui-top-line-size, 1em)');
    expect(d.gap).toBe('var(--ui-top-line-gap, 1.5em)');
    expect(d['padding-bottom']).toBe('var(--ui-top-line-pad, .95em)');
    // the one px is --hair's own fallback (the profile's default, 1px)
    expect(stripped.replace('var(--hair, 1px)', '')).not.toMatch(/\dpx/);
  });

  test('the right side is pushed with margin-left:auto, never flex-end (hard rule 9)', () => {
    expect(decls('.ui-top-line .ui-top-line-right')['margin-left']).toBe('auto');
    expect(stripped).not.toMatch(/flex-end/);
  });
});

describe.each(H.CASES)('%s / %s: both inks clear AA on every ground', (skin, theme) => {
  const o = { skin, theme };
  const R = (n) => H.role(n, o);
  test('--muted and --text', () => {
    const grounds = [['--bg', [R('--bg')]], ['--surface', [R('--bg'), R('--surface')]]];
    for (const stop of hexes(R('--field'))) grounds.push([`--field ${stop}`, [stop]]);
    if (theme === 'dark') for (const stop of hexes(R('--wall-canvas'))) grounds.push([`--wall-canvas ${stop}`, [stop]]);
    const failures = [];
    for (const fg of ['--muted', '--text']) {
      for (const [name, stack] of grounds) {
        const r = H.on(R(fg), stack);
        if (r < H.AA) failures.push(`${fg} on ${name}: ${r.toFixed(2)}`);
      }
    }
    expect(failures).toEqual([]);
  });
});

describe('the sheet reads roles only', () => {
  test('no literal colour, no font name, no --primary/--secondary, no --sk-*, no pragma needed', () => {
    expect(stripped.match(/#[0-9a-f]{3,8}\b/gi)).toBeNull();
    expect(stripped.match(/\b(rgba?|hsla?)\((?!var\()/g)).toBeNull();
    expect(stripped).not.toMatch(/\b(white|black)\b/);
    expect(stripped).not.toMatch(/var\(--(primary|secondary)/);
    expect(stripped).not.toMatch(/--sk-/);
    expect(CSS).not.toMatch(/skin-allowance/);
  });

  test('every custom property it reads is a role, the profile\'s --hair, or a caller hook', () => {
    const allowed = new Set(['--hair', '--ui-top-line-size', '--ui-top-line-gap', '--ui-top-line-pad']);
    const used = [...new Set([...stripped.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]))];
    const missing = used.filter((n) => !allowed.has(n) && (() => {
      try { H.role(n, { skin: 'classic', theme: 'dark' }); return false; } catch (_) { return true; }
    })());
    expect(missing).toEqual([]);
  });

  test('every selector is rooted at .ui-top-line, and styles.css declares nothing there', () => {
    const sels = RULES.flatMap((r) => r.selectors);
    expect(sels.length).toBeGreaterThan(0);
    for (const s of sels) expect(s).toMatch(/^\.ui-top-line\b/);
    expect(read('styles.css')).not.toMatch(/\.ui-top-line\b/);
  });
});
