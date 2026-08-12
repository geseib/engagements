/**
 * THE COLOUR PAIRINGS THE PROMPT EDITOR'S NEW PANELS INTRODUCE.
 *
 * Named "Palette" for the same reason as questionSetsPalette.test.js and
 * adminShellPalette.test.js: `.gitignore:35` is an unanchored `*token*`, so a
 * file named for tokens is invisible to git and would pass locally and never
 * reach CI. Do not rename it back.
 *
 * THIS SURFACE IS STILL PAPER, AND THAT IS THE FIRST THING ASSERTED.
 * `AdminPage.jsx` gives the prompts section no `contentTheme`, so AdminShell
 * paints it light. Question sets and Users each converted their theme and their
 * markup in one change; this pass cannot, because AdminPage.jsx is owned by
 * another stream. So the rule the question-sets header states in the other
 * direction applies here: dusk markup on a light field is the same failure as
 * `#333` on `#0F1A2E`. Every colour below is measured against white and the
 * #f8f9fa paper, and the test at the end fails the moment somebody drops a dusk
 * token in without moving the section.
 *
 * THE CHECKS ARE LIFTED, NOT REWRITTEN. `rgb`, `lin`, `lum`, `ratio`,
 * `alphaOver` and `bgOf` are copied out of the `<script>` block in
 * docs/design/admin-redesign/audit.html (it is `audit.html`, not `audit.js` —
 * there is no such file). `bgOf` is the one that matters: it walks UP from the
 * text node compositing every alpha layer it passes, because reading only the
 * element's own background is how a tinted panel passes an audit it should
 * fail. Every tier below is a tint.
 */
const fs = require('fs');
const path = require('path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const CSS = read('components', 'AIPromptManager.css');

/* ---- colour: lifted verbatim from docs/design/admin-redesign/audit.html ---- */
function lin(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function lum(c) { return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]); }
function ratio(a, b) {
  const la = lum(a); const lb = lum(b);
  const h = Math.max(la, lb); const l = Math.min(la, lb);
  return (h + 0.05) / (l + 0.05);
}
function alphaOver(fg, bg, a) { return fg.map((c, i) => c * a + bg[i] * (1 - a)); }
function bgOf(el, win) {
  let node = el; const stack = [];
  while (node && node.nodeType === 1) {
    const c = win.getComputedStyle(node).backgroundColor;
    const m = String(c).match(/[\d.]+/g);
    if (m) {
      const a = m.length > 3 ? parseFloat(m[3]) : 1;
      if (a > 0) { stack.push([m.slice(0, 3).map(Number), a]); if (a >= 0.999) break; }
    }
    node = node.parentElement;
  }
  if (!stack.length) return [255, 255, 255];
  let out = stack[stack.length - 1][0];
  for (let i = stack.length - 2; i >= 0; i -= 1) out = alphaOver(stack[i][0], out, stack[i][1]);
  return out;
}

/* ------------------------------------------------------------------ tokens -- */

const parseHex = (h) => [1, 3, 5].map((i) => parseInt(h.substr(i, 2), 16));

/** Read out of the stylesheet, never retyped — change a token and these move. */
function token(name) {
  const m = CSS.match(new RegExp(`${name}\\s*:\\s*(#[0-9A-Fa-f]{6})`));
  if (!m) throw new Error(`${name} is not declared in AIPromptManager.css`);
  return m[1];
}
function tint(name) {
  const m = CSS.match(new RegExp(`${name}\\s*:\\s*(rgba\\([^)]*\\))`));
  if (!m) throw new Error(`${name} is not declared in AIPromptManager.css`);
  return m[1];
}

const T = {
  ink: token('--pc-ink'),
  muted: token('--pc-muted'),
  stop: token('--pc-stop'),
  silent: token('--pc-silent'),
  link: token('--pc-link'),
  paper: token('--pc-paper'),
};

/** Build the real paint stack and hand it to the audit's own bgOf. */
function composited(layers) {
  document.body.innerHTML = '';
  document.body.style.backgroundColor = '#ffffff';
  let host = document.body;
  for (const background of layers) {
    const el = document.createElement('div');
    el.style.backgroundColor = background;
    host.appendChild(el);
    host = el;
  }
  return bgOf(host, window);
}

const on = (fgHex, layers) => ratio(parseHex(fgHex), composited(layers));

const AA = 4.5;
const WHITE = ['#ffffff'];
const PAPER = [T.paper];

describe('the flat pairings these panels paint', () => {
  const pairs = [
    ['--pc-ink on the modal (findings, samples, preview text)', T.ink, WHITE],
    ['--pc-muted on the modal (notes, labels, ledes)', T.muted, WHITE],
    ['--pc-muted on the #f8f9fa rail (the variable inspector)', T.muted, PAPER],
    ['--pc-stop on the modal (the blocking tier, the blocked-save note)', T.stop, WHITE],
    ['--pc-silent on the modal (the silent tier, the duplication figure)', T.silent, WHITE],
    ['--pc-silent on the paper rail (the unsafe count)', T.silent, PAPER],
    ['--pc-link on the modal (variable tokens, the room control)', T.link, WHITE],
    ['--pc-link on the paper rail (the same tokens in the inspector)', T.link, PAPER],
  ];

  test.each(pairs)('%s clears AA', (_label, fg, layers) => {
    expect(on(fg, layers)).toBeGreaterThanOrEqual(AA);
  });
});

describe('the tinted composites, where a pairing quietly drops under AA', () => {
  /*
    A tint is invisible in a token table. Each stack below is the real nesting:
    the modal's white, then the tier's tint, then the text.
  */
  test('the blocking tier', () => {
    // rejects: deepening --pc-tint-stop until the red on it falls under AA —
    // the tier a person must read carefully is exactly the wrong one to tint
    // by eye.
    expect(on(T.stop, ['#ffffff', tint('--pc-tint-stop')])).toBeGreaterThanOrEqual(AA);
    expect(on(T.ink, ['#ffffff', tint('--pc-tint-stop')])).toBeGreaterThanOrEqual(AA);
    expect(on(T.muted, ['#ffffff', tint('--pc-tint-stop')])).toBeGreaterThanOrEqual(AA);
  });

  test('the silent tier, which is the loud one and therefore the most tinted', () => {
    expect(on(T.silent, ['#ffffff', tint('--pc-tint-silent')])).toBeGreaterThanOrEqual(AA);
    expect(on(T.ink, ['#ffffff', tint('--pc-tint-silent')])).toBeGreaterThanOrEqual(AA);
    expect(on(T.muted, ['#ffffff', tint('--pc-tint-silent')])).toBeGreaterThanOrEqual(AA);
  });

  test('an unsafe variable row, which is the silent tint on the paper rail', () => {
    // rejects: measuring the tint against white when it sits on #f8f9fa. Two
    // different composites of one tint, and only one of them is on screen here.
    expect(on(T.silent, [T.paper, tint('--pc-tint-silent')])).toBeGreaterThanOrEqual(AA);
    expect(on(T.ink, [T.paper, tint('--pc-tint-silent')])).toBeGreaterThanOrEqual(AA);
    expect(on(T.muted, [T.paper, tint('--pc-tint-silent')])).toBeGreaterThanOrEqual(AA);
  });
});

describe('the surface is paper, and stays paper until the section moves', () => {
  test('AdminPage still paints the prompts section light', () => {
    // rejects: converting this stylesheet to the dusk palette while
    // AdminPage.jsx leaves the section on the paper theme — #F4EDE4 body copy
    // on white is 1.2:1, the same failure as #333 on #0F1A2E in the other
    // direction. If this test goes red because the section gained
    // contentTheme:'dark', THAT is the signal to convert these blocks, in the
    // same change.
    const page = read('AdminPage.jsx');
    const section = page.slice(page.indexOf("id: 'prompts'"), page.indexOf("id: 'archive'"));
    expect(section).not.toMatch(/contentTheme/);
  });

  test('the new blocks reach for no token they do not declare', () => {
    // rejects: borrowing --muted, --surface or --font-mono from a stylesheet
    // that merely happens to be in the bundle. An undefined custom property
    // invalidates the WHOLE declaration, not just the value, so the day that
    // import moves a panel loses its border and nothing errors.
    const declared = new Set([...CSS.matchAll(/(--[a-z0-9-]+)\s*:/gi)].map((m) => m[1]));
    const block = CSS.slice(CSS.indexOf('BEFORE YOU SAVE'));
    const used = [...block.matchAll(/var\((--[a-z0-9-]+)/gi)].map((m) => m[1]);
    expect([...new Set(used)].filter((n) => !declared.has(n))).toEqual([]);
  });

  test('nothing in the new blocks is declared below a 12px floor', () => {
    // rejects: an 11px chip added later to make a dense row fit — RATIONALE §3
    // derives 12px as the hard floor for one person at 24in, and it is the same
    // rule the question sets screen is held to.
    const block = CSS.slice(CSS.indexOf('BEFORE YOU SAVE'));
    const sizes = [...block.matchAll(/font-size:\s*(\d+)px/g)].map((m) => Number(m[1]));
    expect(sizes.length).toBeGreaterThan(0);
    expect(sizes.filter((px) => px < 12)).toEqual([]);
  });
});
