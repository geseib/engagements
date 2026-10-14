/**
 * The modal look, `.ui-scrim` / `.ui-dialog` (components/ui/Dialog.css, unit L13).
 *
 * Reads the stylesheet as TEXT. Two contracts:
 *   1. reachability (hard rule 10, modalReachability.test.js's shape): the scrim
 *      scrolls and does not centre with the flex container; the card centres
 *      itself with margin: auto; the full-height variant's body can scroll.
 *   2. colour: roles only, and AA for every skin x theme through the harness.
 * jsdom has no layout engine, so green means "the contract has not been
 * reverted", not "it is reachable on an iPad" — only a device proves that.
 *
 * Named *Palette.test.js, never *token* (.gitignore:35).
 */
const fs = require('fs');
const path = require('path');
const React = require('react');
const { render } = require('@testing-library/react');
const H = require('../testing/skinHarness');
const S = require('../testing/skinScan');

const DIALOG_CSS = fs.readFileSync(path.join(__dirname, '..', 'components', 'ui', 'Dialog.css'), 'utf8');
const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, ' ');
const BODY = strip(DIALOG_CSS);

/** A rule's declaration block, by exact selector (modalReachability.test.js's helper). */
function block(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`(^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`, 'm'));
  if (!match) throw new Error(`No rule found for "${selector}" — did the selector get renamed?`);
  return match[2];
}
const selectors = [...BODY.matchAll(/([^{}]+)\{[^{}]*\}/g)].flatMap((m) => m[1].split(',').map((s) => s.trim()).filter(Boolean));
const reads = [...new Set([...BODY.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]))].sort();
const PASSTHROUGHS = ['--ui-dialog-radius', '--ui-dialog-shadow', '--ui-dialog-t-body', '--ui-dialog-t-head', '--ui-dialog-t-label', '--ui-scrim-z'];

describe('the dialog stays reachable (hard rule 10)', () => {
  const scrim = () => block(BODY, '.ui-scrim');

  // rejects: the centred-overflow trap, a fifth time. A flex child centred by the
  //          container overflows in BOTH directions and a scroll reaches one.
  test('the scrim scrolls and does not centre with the flex container', () => {
    expect(scrim()).toMatch(/overflow-y:\s*auto/);
    expect(scrim()).toMatch(/align-items:\s*flex-start/);
    expect(scrim()).not.toMatch(/align-items:\s*center/);
    expect(scrim()).not.toMatch(/place-items/);
    expect(scrim()).not.toMatch(/display:\s*grid/);
  });

  test('the scrim has padding and covers the viewport', () => {
    expect(scrim()).toMatch(/padding:\s*\S+/);
    expect(scrim()).toMatch(/position:\s*fixed/);
    expect(scrim()).toMatch(/inset:\s*0/);
  });

  // rejects: dropping the auto margin along with the centring, which jams every
  //          short dialog against the top edge. The two are one fix.
  test('the card still centres itself while it fits, and never outgrows the screen', () => {
    expect(block(BODY, '.ui-dialog')).toMatch(/margin:\s*auto/);
    for (const sel of ['.ui-dialog', '.ui-dialog--small', '.ui-dialog--wide']) {
      expect(block(BODY, sel)).toMatch(/width:\s*min\(\d+px,\s*100%\)/);
    }
    expect(block(BODY, '.ui-dialog')).toMatch(/overflow-wrap:\s*anywhere/);
  });

  // rejects: the setup-panel bug — a flex body with no min-height: 0 never
  //          overflows, so overflow-y has nothing to scroll; and vh alone on iOS.
  test('--full: the body scrolls between a fixed head and foot, capped in dvh after vh', () => {
    const full = block(BODY, '.ui-dialog--full');
    expect(full).toMatch(/flex-direction:\s*column/);
    const vh = full.search(/max-height:\s*calc\(100vh/);
    const dvh = full.search(/max-height:\s*calc\(100dvh/);
    expect(vh).toBeGreaterThanOrEqual(0);
    expect(dvh).toBeGreaterThan(vh);
    const body = block(BODY, '.ui-dialog--full > .ui-dialog-body');
    expect(body).toMatch(/min-height:\s*0/);
    expect(body).toMatch(/overflow-y:\s*auto/);
    expect(BODY).toMatch(/\.ui-dialog--full > \.ui-dialog-head,\s*\.ui-dialog--full > \.ui-dialog-foot\s*\{\s*flex:\s*none/);
  });

  // rejects: a foot whose buttons overflow toward the start, where nothing scrolls.
  test('the foot right-aligns by margin, wraps, and is not justify-content: flex-end', () => {
    const foot = block(BODY, '.ui-dialog-foot');
    expect(foot).toMatch(/flex-wrap:\s*wrap/);
    expect(BODY).not.toMatch(/justify-content:\s*flex-end/);
    expect(block(BODY, '.ui-dialog-foot > :first-child')).toMatch(/margin-left:\s*auto/);
  });

  test('the X is a real 32px target with a visible focus ring, and no type below the 12px floor', () => {
    expect(block(BODY, '.ui-dialog-x')).toMatch(/width:\s*32px/);
    expect(block(BODY, '.ui-dialog-x')).toMatch(/height:\s*32px/);
    expect(block(BODY, '.ui-dialog-x:focus-visible')).toMatch(/outline:\s*2px solid var\(--text\)/);
    for (const m of BODY.matchAll(/font-size:\s*(?:var\([^,]+,\s*)?(\d+)px/g)) expect(Number(m[1])).toBeGreaterThanOrEqual(12);
  });
});

describe('Dialog.css is skin-clean', () => {
  test('no colour literal, no font family, no --primary/--secondary, and no pragma needed', () => {
    const { counts } = S.scanCss(DIALOG_CSS);
    expect(S.gateCounts(counts)).toEqual({ colour: 0, font: 0, primary: 0 });
    expect(S.filePragma(DIALOG_CSS)).toBeNull();
    expect(BODY).not.toMatch(/--sk-/);
  });

  test('every var() is a role that resolves in every skin x theme, or a passthrough with a fallback', () => {
    const roles = reads.filter((n) => !n.startsWith('--ui-'));
    expect(reads.filter((n) => n.startsWith('--ui-'))).toEqual(PASSTHROUGHS);
    for (const n of PASSTHROUGHS) expect(BODY).toMatch(new RegExp(`var\\(${n},\\s*\\S`));
    H.eachSkinTheme((skin, theme) => {
      for (const n of roles) expect(() => H.role(n, { skin, theme })).not.toThrow();
    });
    // the passthroughs are read, never declared here: the adopting surface sets them
    for (const n of PASSTHROUGHS) expect(BODY).not.toMatch(new RegExp(`${n}\\s*:`));
  });

  test('every selector is rooted in .ui-dialog or .ui-scrim, and no shared sheet declares either', () => {
    for (const s of selectors) expect(s).toMatch(/^\.ui-(dialog|scrim)\b/);
    for (const shared of ['styles.css', 'styles/stage.css', 'styles/roles.css']) {
      const text = strip(fs.readFileSync(path.join(__dirname, '..', shared), 'utf8'));
      expect(text).not.toMatch(/\.ui-(dialog|scrim)\b/);
    }
  });

  test('the scrim reads --scrim, the card --surface and --rule-strong, the foot rule --rule', () => {
    expect(block(BODY, '.ui-scrim')).toMatch(/background:\s*var\(--scrim\)/);
    expect(block(BODY, '.ui-dialog')).toMatch(/background:\s*var\(--surface\)/);
    expect(block(BODY, '.ui-dialog')).toMatch(/border:\s*1px solid var\(--rule-strong\)/);
    expect(block(BODY, '.ui-dialog-foot')).toMatch(/border-top:\s*1px solid var\(--rule\)/);
  });
});

describe.each(H.CASES)('%s / %s: copy in a dialog clears AA', (skin, theme) => {
  const r = (n) => H.role(n, { skin, theme });

  test('title and body (--text), sub and the resting X (--muted), accent copy, on --surface', () => {
    for (const fg of ['--text', '--muted', '--accent-text']) {
      const ratio = H.on(r(fg), [r('--surface')]);
      if (ratio < H.AA) throw new Error(`${fg} on --surface = ${ratio.toFixed(2)} (${skin}/${theme})`);
    }
  });

  test('the hovered X: --text on --surface + --row-hover', () => {
    expect(H.on(r('--text'), [r('--surface'), r('--row-hover')])).toBeGreaterThanOrEqual(H.AA);
  });

  // Destructive and success copy in a dialog body. Classic paper's --success-text
  // and --danger-text are the dusk tints, under AA on white today (records/0a.md,
  // CLASSIC AMENDMENTS 2-3; paper destructive copy maps to --danger-deep there).
  test('status copy on --surface', () => {
    if (skin === 'classic' && theme === 'light') {
      expect(H.on(r('--danger-deep'), [r('--surface')])).toBeGreaterThanOrEqual(H.AA);
      return;
    }
    for (const fg of ['--success-text', '--danger-text']) expect(H.on(r(fg), [r('--surface')])).toBeGreaterThanOrEqual(H.AA);
  });

  test('the scrim darkens: what shows through it is darker than the bare ground', () => {
    const through = H.composite([r('--bg'), r('--scrim')]);
    expect(H.lum(through)).toBeLessThan(H.lum(H.parseColor(r('--bg')).rgb));
  });
});

describe('the gallery fixture', () => {
  test('renders each variant in dusk and paper, every dialog with a title, an X and a bottom exit', () => {
    const Fixture = require('../components/ui/fixtures/Dialog').default;
    const { container } = render(React.createElement(Fixture));
    const dialogs = [...container.querySelectorAll('.ui-scrim > .ui-dialog[role="dialog"]')];
    expect(dialogs.map((d) => `${d.className} ${d.getAttribute('data-theme')}`)).toEqual([
      'ui-dialog dark', 'ui-dialog light', 'ui-dialog ui-dialog--small dark', 'ui-dialog ui-dialog--small light', 'ui-dialog ui-dialog--full dark',
    ]);
    for (const d of dialogs) {
      const title = d.querySelector('.ui-dialog-title');
      expect(d.getAttribute('aria-labelledby')).toBe(title.id);
      expect(d.querySelector('.ui-dialog-x[aria-label="Close"]')).not.toBeNull();
      expect(d.querySelectorAll('.ui-dialog-foot button').length).toBe(2);
    }
    const src = fs.readFileSync(path.join(__dirname, '..', 'components', 'ui', 'fixtures', 'Dialog.jsx'), 'utf8');
    expect(S.scanJsx(src).findings).toEqual([]);
  });
});
