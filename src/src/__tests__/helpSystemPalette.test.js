/**
 * THE HELP MODAL'S PALETTE — components/HelpSystem.css and
 * components/documentation/documentation.css (help refresh Phase 0).
 *
 * Named *Palette*, never *Token* (.gitignore:35). jsdom loads no stylesheet,
 * so this reads both sheets as text and resolves every role with the skin
 * harness, for every skin. What it holds:
 *   - roles only: the skins gate at 0 in both files, no --primary,
 *     --secondary or --sk-*, no --danger on copy;
 *   - every role either sheet reads resolves in every skin and theme;
 *   - the modal is dusk wherever it opens: HelpSystem gives Modal theme="dark";
 *   - every ink clears AA on the ground it sits on, in every skin, on dusk —
 *     including the words over the three note tints;
 *   - every selector is rooted in the help's own classes, and nothing is
 *     drawn under the 12px floor.
 */
const fs = require('fs');
const path = require('path');
const H = require('../testing/skinHarness');
const S = require('../testing/skinScan');

const FILES = ['components/HelpSystem.css', 'components/documentation/documentation.css'];
const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, ' ');
const SHEETS = FILES.map((f) => [f, H.css(f)]);
const JSX = fs.readFileSync(path.join(__dirname, '..', 'components', 'HelpSystem.jsx'), 'utf8');

describe.each(SHEETS)('%s reads roles only', (file, css) => {
  const body = strip(css);

  test('the gate: no colour or font literal, no --primary read, pragma at 0', () => {
    expect(S.gateCounts(S.scanCss(css).counts)).toEqual({ colour: 0, font: 0, primary: 0 });
    expect(S.filePragma(css)).toEqual({ colour: 0, font: 0, primary: 0 });
  });

  test('no --primary, --secondary or --sk-*, and --danger never carries text', () => {
    expect(body).not.toMatch(/var\(--(primary|secondary|sk-)/);
    expect(body).not.toMatch(/(^|[;{\s])color:\s*var\(--danger\)/);
  });

  test('every role it reads resolves in every skin x theme', () => {
    const names = [...new Set([...body.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]))];
    expect(names.length).toBeGreaterThan(5);
    H.eachSkinTheme((skin, theme) => {
      names.forEach((n) => expect(() => H.role(n, { skin, theme })).not.toThrow());
    });
  });

  test('every selector is rooted in the help\'s own classes', () => {
    const OWN = /\.(help-|phase-flow)/;
    const selectors = [...body.matchAll(/([^{}]+)\{/g)]
      .map((m) => m[1].trim())
      .filter((s) => s && !s.startsWith('@'))
      .flatMap((s) => s.split(',').map((x) => x.trim()));
    expect(selectors.filter((s) => !OWN.test(s))).toEqual([]);
  });

  test('nothing is drawn under the 12px floor', () => {
    const px = [...body.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)].map((m) => Number(m[1]));
    expect(px.filter((n) => n < 12)).toEqual([]);
  });
});

test('the modal declares dusk: HelpSystem passes theme="dark" to Modal', () => {
  expect(JSX).toMatch(/<Modal[\s\S]*?theme="dark"/);
});

test('styles.css paints nothing in the help modal\'s scope', () => {
  // rejects: a global rule re-inking the dialog behind this sheet's back. The
  // one `.help-role-icon > .ws-icon` sizing rule is geometry, not paint.
  const global = strip(H.css('styles.css'));
  const rules = [...global.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((m) => /\.help-(system-modal|modal|doc|content|role|section|quick|search|footer|back|home|close)/.test(m[1]));
  rules.forEach((m) => expect(m[2]).not.toMatch(/(^|;)\s*(color|background(-color)?)\s*:/));
});

/*
  THE PAIRINGS, measured on dusk in every skin. Each is an ink and the ground
  it is drawn on in the two sheets (the ground first, any tint after).
*/
const PAIRS = [
  ['--text', ['--surface']], ['--muted', ['--surface']],
  ['--text', ['--surface-2']], ['--muted', ['--surface-2']],
  ['--text', ['--bg']], ['--muted', ['--bg']],
  ['--on-action', ['--action']],
  ['--accent-text', ['--surface']], ['--accent-text', ['--surface-2']],
];
const TINTS = ['--info-rgb', '--warn-rgb', '--success-rgb'];

describe.each(H.SKINS)('%s, dusk: every ink clears AA', (skin) => {
  const opts = { skin, theme: 'dark' };
  test.each(PAIRS)('%s on %j', (ink, ground) => {
    const r = H.on(H.role(ink, opts), ground.map((g) => H.role(g, opts)));
    if (r < H.AA) throw new Error(`${ink} on ${ground.join(' + ')} is ${r.toFixed(2)}:1`);
  });

  test.each(TINTS)('--text over the %s note tint (.08) on --surface', (tint) => {
    const [r, g, b] = H.channel(tint, opts);
    const layers = [H.role('--surface', opts), `rgba(${r},${g},${b},0.08)`];
    const ratio = H.on(H.role('--text', opts), layers);
    if (ratio < H.AA) throw new Error(`--text over ${tint} is ${ratio.toFixed(2)}:1`);
  });
});
