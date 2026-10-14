/**
 * The skin harness (src/src/testing/skinHarness.js) — the one door palette tests use to read
 * colour values once the skins exist (docs/design/themes/TOOLING-BRIEF.md §2).
 *
 * Named *Palette.test.js, never *token*: .gitignore:35 is an unanchored `*token*`.
 *
 * What green means: the harness reads TODAY'S values exactly as the old hand-rolled
 * `token(GLOBAL_CSS, ':root {', …)` reads did, and its arithmetic agrees with the audit's
 * DOM bgOf. That is what lets scripts/skins/retarget-tests.js move ~40 palette tests onto it
 * mechanically in Phase 0a without moving a single number. The SPEC §4 skin tables are
 * checked by `node scripts/skins/harness.js --selftest` against a fixture, because the real
 * skin files do not exist until Phase 0a.
 */
const fs = require('fs');
const path = require('path');
const H = require('../testing/skinHarness');

const GLOBAL_CSS = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');

/* the old way, verbatim from references/testing-a-surface.md §1 */
function token(css, block, name) {
  const start = css.indexOf(block);
  if (start < 0) throw new Error(`no ${block} block`);
  const body = css.slice(start, css.indexOf('}', start));
  const m = body.match(new RegExp(`${name}\\s*:\\s*(#[0-9A-Fa-f]{6})`));
  if (!m) throw new Error(`${name} not declared in ${block}`);
  return m[1];
}
const ROOT = ':root {';
const DUSK = '[data-theme="dark"] {';
const PAPER = '[data-theme="light"] {';

const PRE_0A = !fs.existsSync(path.join(__dirname, '..', 'styles', 'skins'));

describe('Classic resolves to the values the old token() reads gave', () => {
  const theme = [
    ['--bg', DUSK, 'dark'], ['--surface', DUSK, 'dark'], ['--surface-2', DUSK, 'dark'],
    ['--text', DUSK, 'dark'], ['--muted', DUSK, 'dark'],
    ['--bg', PAPER, 'light'], ['--surface', PAPER, 'light'], ['--surface-2', PAPER, 'light'],
    ['--text', PAPER, 'light'], ['--muted', PAPER, 'light'],
  ];
  (PRE_0A ? test.each(theme) : test.skip.each(theme))('%s in %s (%s)', (name, block, t) => {
    expect(H.role(name, { skin: 'classic', theme: t }).toUpperCase()).toBe(token(GLOBAL_CSS, block, name).toUpperCase());
  });

  const invariant = ['--primary', '--primary-deep', '--secondary', '--success', '--danger', '--danger-text', '--danger-deep'];
  (PRE_0A ? test.each(invariant) : test.skip.each(invariant))('%s is theme-invariant and equals the :root value', (name) => {
    const want = token(GLOBAL_CSS, ROOT, name).toUpperCase();
    for (const t of H.THEMES) expect(H.role(name, { skin: 'classic', theme: t }).toUpperCase()).toBe(want);
  });
});

describe('the registry and the cases', () => {
  test('Classic is always a skin, and every case has values to resolve', () => {
    expect(H.SKINS).toContain('classic');
    expect(H.CASES.length).toBeGreaterThanOrEqual(2);
    H.eachSkinTheme((skin, theme) => {
      expect(H.role('--bg', { skin, theme })).toMatch(/^#[0-9A-Fa-f]{6}$/);
    });
  });
  test('a skin with no values file throws rather than quietly answering Classic', () => {
    expect(() => H.role('--bg', { skin: 'no-such-skin' })).toThrow(/registry|no styles\/skins/);
  });
  test('an undeclared property throws, naming the skin and theme', () => {
    expect(() => H.role('--never-declared-anywhere', { theme: 'light' })).toThrow(/classic theme=light/);
  });
});

describe('the arithmetic is the audit\'s', () => {
  /* the audit's bgOf over real nodes (testing-a-surface.md §1) */
  function composited(layers) {
    document.body.innerHTML = '';
    let host = document.body;
    for (const background of layers) {
      const el = document.createElement('div');
      el.style.backgroundColor = background;
      host.appendChild(el);
      host = el;
    }
    return H.bgOf(host, window);
  }
  const stacks = [
    ['#0F1A2E'],
    ['#0F1A2E', 'rgba(124, 167, 230, 0.16)'],
    ['#1B2942', 'rgba(246, 169, 76, 0.12)', 'rgba(155, 168, 190, 0.055)'],
    ['rgba(229, 100, 94, 0.14)'],
    ['#FBF7F1', '#FFFFFF', 'rgba(27, 41, 66, 0.14)'],
  ];
  test.each(stacks.map((s) => [s.join(' > '), s]))('composite(%s) equals bgOf on real nodes', (_l, layers) => {
    const dom = composited(layers);
    H.composite(layers).forEach((c, i) => expect(Math.abs(c - dom[i])).toBeLessThan(0.51));
  });
  test('--text on --bg (dusk) is the documented 14.97', () => {
    expect(H.ratio(H.role('--text'), H.role('--bg')).toFixed(2)).toBe('14.97');
  });
  test('on() composites a tint stack before measuring', () => {
    const r = H.on(H.role('--text'), [H.role('--bg'), 'rgba(124,167,230,.16)']);
    expect(r).toBeGreaterThan(H.AA);
    expect(r).toBeLessThan(H.ratio(H.role('--text'), H.role('--bg')));
  });
  test('parseColor reads every spelling the repo writes', () => {
    expect(H.parseColor('#fff').rgb).toEqual([255, 255, 255]);
    expect(H.parseColor('rgba(155,168,190,.20)')).toEqual({ rgb: [155, 168, 190], a: 0.2 });
    expect(H.parseColor('rgb(155 168 190 / .28)')).toEqual({ rgb: [155, 168, 190], a: 0.28 });
  });
});

describe('scope-local values resolve through var() and channel forms', () => {
  test('.qsets --qsets-rule is the modal .20 slate rule', () => {
    const v = H.scopeVar(H.css('components/QuestionSetsPanel.css'), '.qsets {', '--qsets-rule', { skin: 'classic', theme: 'dark' });
    expect(H.parseColor(v)).toEqual({ rgb: [155, 168, 190], a: 0.2 });
  });
  test('rgb(var(--x-rgb) / a) and a local var() chain both resolve', () => {
    const css = '.fx { --fx-rgb: 155 168 190; --fx-rule: rgb(var(--fx-rgb) / .28); --fx-ink: var(--text); }';
    expect(H.parseColor(H.scopeVar(css, '.fx {', '--fx-rule'))).toEqual({ rgb: [155, 168, 190], a: 0.28 });
    expect(H.scopeVar(css, '.fx {', '--fx-ink', { theme: 'light' })).toBe(H.role('--text', { theme: 'light' }));
  });
});
