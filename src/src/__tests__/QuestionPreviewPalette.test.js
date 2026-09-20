/**
 * THE COLOUR PAIRINGS THE QUESTION PREVIEW INTRODUCES — `.qprev`.
 *
 * Named "Palette", never "Token": `.gitignore:35` is an unanchored `*token*`, so
 * a file named for tokens is invisible to git — it passes locally and never
 * reaches CI. Do not rename it.
 *
 * TWO SURFACES IN ONE COMPONENT, AND THEY USED TO BE OPPOSITE POLARITIES. The
 * list and its controls were paper on the set editor's #F1EDE4 panel, and only
 * the card was dusk. The owner, on the shipped console: *"the white background
 * really contrasts the rest of the site, as we are entirely dark background
 * throughout, except for question set editors and previews."* The editor moved
 * onto the product's ground, so the list moved with it — and the screen did not
 * move at all, because it was always the stage. Each is still measured on its
 * real stack; they are simply the same stack now.
 *
 * THE CHECKS ARE LIFTED, NOT REWRITTEN — `lin`, `lum`, `ratio`, `alphaOver` and
 * `bgOf` are copied out of docs/design/admin-redesign/audit.html's <script>,
 * as questionSetsPalette.test.js copied them. NOTHING IS TYPED TWICE: every
 * colour below is read out of styles.css, stage.css or QuestionPreview.css, and
 * so is every ground the sheet paints under its text (`groundOf`) — a stack
 * that assumed a ground would go on passing after the sheet stopped painting it.
 *
 * jsdom has no layout engine and loads no stylesheet. Green here means the
 * palette clears AA; it cannot prove how a browser draws it.
 */
const fs = require('fs');
const path = require('path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const GLOBAL_CSS = read('styles.css');
const STAGE_CSS = read('styles', 'stage.css');
const QPREV_CSS = read('components', 'QuestionPreview.css');

/* ---- colour: lifted verbatim from docs/design/admin-redesign/audit.html ---- */
function lin(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function lum(c) { return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]); }
function ratio(a, b) {
  const la = lum(a); const lb = lum(b);
  const h = Math.max(la, lb); const l = Math.min(la, lb);
  return (h + 0.05) / (l + 0.05);
}
function alphaOver(fg, bg, a) { return fg.map((c, i) => c * a + bg[i] * (1 - a)); }
/* Walk UP compositing every alpha layer. Reading only the element's own
   background is how dark-on-dark passes an audit. */
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
  if (!stack.length) return [15, 26, 46];
  let out = stack[stack.length - 1][0];
  for (let i = stack.length - 2; i >= 0; i -= 1) out = alphaOver(stack[i][0], out, stack[i][1]);
  return out;
}

/* ---- values, READ rather than retyped ------------------------------------ */
const parseHex = (h) => [1, 3, 5].map((i) => parseInt(h.substr(i, 2), 16));

/** The declaration block that opens with `head` — first match, comments stripped. */
function blockOf(css, head) {
  const text = strip(css);
  const start = text.indexOf(head);
  if (start < 0) throw new Error(`no "${head}" block`);
  return text.slice(start, text.indexOf('}', start));
}
/** The first `head` block that declares `name` — stage.css opens `.stage{` twice. */
function blockDeclaring(css, head, name) {
  const text = strip(css);
  let at = text.indexOf(head);
  while (at >= 0) {
    const body = text.slice(at, text.indexOf('}', at));
    if (new RegExp(`${name}\\s*:`).test(body)) return body;
    at = text.indexOf(head, at + head.length);
  }
  throw new Error(`no "${head}" block declares ${name}`);
}
function hexIn(block, name) {
  const m = block.match(new RegExp(`${name}\\s*:\\s*(#[0-9A-Fa-f]{6})`));
  if (!m) throw new Error(`${name} is not a hex in that block`);
  return m[1].toUpperCase();
}
function rgbaIn(block, name) {
  const m = block.match(new RegExp(`${name}\\s*:\\s*(rgba\\([^)]*\\))`));
  if (!m) throw new Error(`${name} is not an rgba in that block`);
  return m[1];
}
/** The body of the rule whose selector list is exactly `selector`. */
function ruleBody(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = strip(css).match(new RegExp(`(^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`));
  if (!m) throw new Error(`no rule for "${selector}" — renamed?`);
  return m[2];
}

const DUSK = blockOf(GLOBAL_CSS, '[data-theme="dark"] {');
const ROOT = blockOf(GLOBAL_CSS, ':root {');
const STAGE = blockDeclaring(STAGE_CSS, '.stage{', '--muted');
const STAGE_ROOT = blockDeclaring(STAGE_CSS, ':root{', '--success-text');
const SCOPE = blockOf(QPREV_CSS, '.qprev,\n.qprev-switch {');
const SCREEN = blockOf(QPREV_CSS, '.qprev .qprev-screen {');

/* The editor's `.qs-panel` ground, read from the rule that paints it rather
   than named here — the panel moved from --surface-2 to --bg when the editor
   converted, and a retyped token would have gone on passing against a ground
   nothing draws. */
const PANEL_TOKEN = ruleBody(GLOBAL_CSS, '.qs-editor .qs-panel').match(/background:\s*var\((--[\w-]+)\)/)[1];

const P = {
  panel: hexIn(DUSK, PANEL_TOKEN),      // the editor's .qs-panel ground
  surface: hexIn(DUSK, '--surface'),
  text: hexIn(DUSK, '--text'),
  muted: hexIn(DUSK, '--muted'),
  accent: hexIn(SCOPE, '--qprev-accent'),
  rowSel: rgbaIn(SCOPE, '--qprev-row-sel'),
  rowHover: rgbaIn(SCOPE, '--qprev-row-hover'),
};
const S = {
  bg: hexIn(DUSK, '--bg'),
  text: hexIn(DUSK, '--text'),
  muted: hexIn(SCREEN, '--muted'),
  primary: hexIn(SCREEN, '--primary'),
  success: hexIn(SCREEN, '--success'),
  successText: hexIn(STAGE_ROOT, '--success-text'),
};

/** A stage.css rule's `background`, by exact selector. */
function stageLayer(selector) {
  const bg = ruleBody(STAGE_CSS, selector).match(/background:\s*(rgba\([^)]*\))/);
  if (!bg) throw new Error(`"${selector}" paints no rgba background`);
  return bg[1];
}

/**
 * The ground a QuestionPreview.css rule paints under its text: the token its
 * `background` names, resolved in `theme` — or null when it paints none and the
 * layer beneath shows through. The pressed segment is why this is read: the
 * first cut of the sheet left the segmented groups transparent, and on the bare
 * panel the accent over the pressed tint is under AA.
 */
function groundOf(selector, theme) {
  const bg = ruleBody(QPREV_CSS, selector).match(/background:\s*var\((--[\w-]+)\)/);
  return bg ? hexIn(theme, bg[1]) : null;
}

function composited(layers) {
  document.body.innerHTML = '';
  let host = document.body;
  for (const background of layers.filter(Boolean)) {
    const el = document.createElement('div');
    el.style.backgroundColor = background;
    host.appendChild(el);
    host = el;
  }
  return bgOf(host, window);
}
const on = (fgHex, layers) => ratio(parseHex(fgHex), composited(layers));
const AA = 4.5;

const PANEL = [P.panel];
const LIST = [P.panel, groundOf('.qprev-list', DUSK)];
const CONTROL = [P.panel, groundOf('.qprev-seg,\n.qprev-switch', DUSK)];
const SCREEN_GROUND = [P.panel, groundOf('.qprev-screen', DUSK)];
const OPTION = [...SCREEN_GROUND, stageLayer('.opt')];

describe('the list and its controls, on the editor\'s panel', () => {
  test('the premise: the editor panel is the SAME ground on both mounts', () => {
    // rejects: measuring against a ground the editor does not paint. The host
    // shelf used to restate --surface-2 on the editor's own root at 0,2,0,
    // outranking the theme; now it restates nothing there and both mounts read
    // the panel token out of [data-theme="dark"].
    expect(strip(read('components', 'QuestionSetsPanel.css')))
      .not.toMatch(/\.qsets--onlight\s+\.qs-editor\s*\{/);
    expect(P.panel).toBe(hexIn(DUSK, PANEL_TOKEN));
  });

  test.each([
    ['--text on the list (titles, the search box)', P.text, LIST],
    ['--muted on the list (meta line, "Showing N of M", placeholder)', P.muted, LIST],
    ['the accent on the list ("Clear search")', P.accent, LIST],
    ['--text on the selected row', P.text, [...LIST, P.rowSel]],
    ['--muted on the selected row', P.muted, [...LIST, P.rowSel]],
    ['the accent on a pressed chip', P.accent, [...LIST, P.rowSel]],
    ['--text on a hovered row', P.text, [...LIST, P.rowHover]],
    ['--muted on a hovered row', P.muted, [...LIST, P.rowHover]],
    ['--muted on the panel (the position, the note\'s label)', P.muted, PANEL],
    ['--text on the panel (the reveal note)', P.text, PANEL],
    ['--text on a control (ASK, Reveal, Table, Preview, Edit)', P.text, CONTROL],
    // The segmented groups paint their own ground; the pressed segment's tint
    // sits on it. rejects: a transparent group — the tint over the #F1EDE4
    // panel drops the accent under AA, which is what the first cut of this
    // sheet did. CONTROL is read from the sheet, so that cut fails here.
    ['the accent on a pressed segment', P.accent, [...CONTROL, P.rowSel]],
  ])('%s clears AA', (_label, fg, layers) => {
    expect(on(fg, layers)).toBeGreaterThanOrEqual(AA);
  });

  /*
   * THE ROW'S DETAIL LINE. The row grew a third line — title, detail, meta — so
   * that the questions can be read from the list itself, and the detail is the
   * line a reader actually reads in runs rather than glances at. Its ink is READ
   * from the sheet's own rule, not retyped, so a later re-colouring is measured
   * here too; each of the three grounds a row can be drawn on is measured under
   * it, because the selected row and the hovered row both tint what it sits on.
   */
  test.each([
    ['at rest', LIST],
    ['on the selected row', [...LIST, P.rowSel]],
    ['on a hovered row', [...LIST, P.rowHover]],
  ])('the row\'s detail line, in the colour its own rule draws it, clears AA %s', (_label, layers) => {
    const ink = ruleBody(QPREV_CSS, '.qprev-row-detail').match(/(?:^|;)\s*color:\s*var\((--[\w-]+)\)/);
    expect(ink).not.toBeNull();
    expect(on(hexIn(DUSK, ink[1]), layers)).toBeGreaterThanOrEqual(AA);
  });
});

/*
 * THE SPLIT. The owner, after using the preview on dev: *"the preview is great
 * except for the width. the question list could be wider and the preview
 * narrower. so that you can read the questions from the list."* The shipped
 * split CAPPED the list at 300px — minmax(220px, 300px) — and gave the card
 * every remaining pixel, so a question's title was cut in the one pane whose job
 * is listing questions.
 *
 * Arithmetic on the declaration, not on a layout: jsdom lays nothing out, so a
 * measured width here would be zero and would pass unconditionally
 * (engage-design hard rule 13).
 */
describe('the split between the list and the card', () => {
  const QPREV_RULE = ruleBody(QPREV_CSS, '.qprev');
  const columns = (QPREV_RULE.match(/grid-template-columns:\s*([^;]+)/) || [])[1];
  const tracks = String(columns).match(/minmax\([^)]*\)/g) || [];
  const parse = (track) => {
    const m = track.match(/minmax\(\s*([\d.]+)px\s*,\s*([\d.]+)fr\s*\)/);
    if (!m) throw new Error(`"${track}" is not minmax(<px>, <fr>)`);
    return { min: Number(m[1]), share: Number(m[2]) };
  };

  test('the list takes more of the width than the card', () => {
    // rejects: the shipped minmax(220px, 300px) minmax(0, 1fr) — a list with a
    // fixed cap, which is not a share of the width at all.
    expect(tracks).toHaveLength(2);
    const [list, card] = tracks.map(parse);
    expect(list.share).toBeGreaterThan(card.share);
    // and a real change, not a nudge: wider at its NARROWEST than the old cap.
    expect(list.min).toBeGreaterThan(300);
  });

  test('neither pane can be squeezed to nothing, and both minimums fit above the stack', () => {
    // rejects: minimums that do not fit side by side above the width where the
    // panes stack — the row would overflow its container in the band between.
    const [list, card] = tracks.map(parse);
    expect(card.min).toBeGreaterThan(0);
    const stackAt = Number(strip(QPREV_CSS).match(/@media \(max-width:\s*(\d+)px\)/)[1]);
    const gap = Number(QPREV_RULE.match(/gap:\s*(\d+)px/)[1]);
    expect(list.min + card.min + gap).toBeLessThanOrEqual(stackAt);
  });

  test('the narrow breakpoint still stacks to one column', () => {
    // rejects: two tracks with 600px of minimums surviving onto a phone.
    const narrow = strip(QPREV_CSS).match(/@media \(max-width:\s*\d+px\)\s*\{([\s\S]*?)\n\}/);
    expect(narrow).not.toBeNull();
    expect(narrow[1]).toMatch(/\.qprev\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  });
});

/*
 * WHAT THE POSITION, THE NOTE AND THE EMPTY LINE STAND ON. They paint no ground
 * of their own: "3 / 30", the reveal note and its label, and the empty-state
 * line sit on the set editor's panel, and are only as legible as the panel
 * under them. Both mounts paint the same panel, which is pinned above. The
 * console's is dusk only because AdminPage.jsx renders the editor with
 * contentTheme 'dark': on a paper work body this sheet's --muted would stand on
 * #FBF7F1 at about 1.8:1, and nothing here would fail.
 *
 * PINNED, NOT BOXED. The other fix — an opaque ground of their own on each
 * line — would make the lines independent of the parent, but it is not the
 * pattern the engage-design skill sets: the markup and its theme move in the
 * same change and a palette test pins the pairing (testing-a-surface.md §2.3,
 * hard-rules.md §9), and contrast is measured up the real ancestor chain
 * (hard-rules.md §4). A box behind a count and a note would also be a visual
 * change to a surface whose siblings (the qsets idiom) set muted text straight
 * on the panel.
 */
describe('what the position, the note and the empty line stand on', () => {
  test('the console and this sheet agree on which theme the editor is', () => {
    // THE DECISION, REVERSED AND RE-PINNED. This used to read 'light', and the
    // comment under it explained that on the dusk work body the paper --muted
    // would stand on #25375A at about 1.9:1 and nothing here would fail. That
    // is still exactly the failure mode — it is just pointing the other way
    // now, so the assertion has to move with the markup rather than be dropped.
    // rejects: either half converting without the other.
    const page = strip(read('AdminPage.jsx'));
    const theme = page.match(/contentTheme=\{editingSet \? '(\w+)'/);
    expect(theme).not.toBeNull();
    expect(theme[1]).toBe('dark');
    // and the component's own roots say the same. Every element here that
    // declares a theme declares this one — the sheet's token block is on
    // `.qprev, .qprev-switch`, and `.qprev .qprev-screen` re-points three
    // tokens under it, so a root left on the other polarity would take the list
    // with it and leave the card alone.
    const jsx = strip(read('components', 'QuestionPreview.jsx'));
    const themes = [...jsx.matchAll(/data-theme="(\w+)"/g)].map((m) => m[1]);
    expect(themes.length).toBeGreaterThanOrEqual(3);
    expect([...new Set(themes)]).toEqual(['dark']);
  });

  // Each stack is the panel, then whatever ground this sheet paints on the way
  // down to the text — read from the sheet, so a ground added later is measured.
  test.each([
    ['the position', P.muted, ['.qprev', '.qprev-detail', '.qprev-bar', '.qprev-pos']],
    ['the reveal note', P.text, ['.qprev', '.qprev-detail', '.qprev-note']],
    ['the reveal note\'s label', P.muted, ['.qprev', '.qprev-detail', '.qprev-note', '.qprev-note b']],
    ['the empty-state line', P.muted, ['.qprev', '.qprev--empty', '.qprev-empty']],
  ])('%s clears AA on the panel', (_label, fg, chain) => {
    expect(on(fg, [P.panel, ...chain.map((selector) => groundOf(selector, DUSK))])).toBeGreaterThanOrEqual(AA);
  });

  test('a held Edit, in the colour its :disabled rule draws it, clears AA on its own ground', () => {
    // Held while a Save is written and read back, and its title says why — a
    // reason is only a reason if the words it sits on can be read. The ink is
    // read from the sheet's :disabled rule, so a later colour is measured too.
    const ink = ruleBody(QPREV_CSS, '.qprev-btn:disabled').match(/(?:^|;)\s*color:\s*var\((--[\w-]+)\)/);
    expect(ink).not.toBeNull();
    const chain = ['.qprev', '.qprev-detail', '.qprev-bar', '.qprev-btn'];
    expect(on(hexIn(DUSK, ink[1]), [P.panel, ...chain.map((selector) => groundOf(selector, DUSK))]))
      .toBeGreaterThanOrEqual(AA);
  });
});

describe('the screen: the stage\'s own card on the stage\'s own ground', () => {
  test('the screen restates exactly the stage\'s tokens, nothing near them', () => {
    // rejects: a "close enough" dusk. The card must look like the projector.
    expect(S.muted).toBe(hexIn(STAGE, '--muted'));
    expect(S.primary).toBe(hexIn(ROOT, '--primary'));
    expect(S.success).toBe(hexIn(ROOT, '--success'));
    // and data-theme="dark" supplies the stage's ground and text as they are
    expect(S.bg).toBe(hexIn(STAGE, '--bg'));
    expect(S.text).toBe(hexIn(STAGE, '--text'));
    // and the screen paints that ground, not some other dusk surface
    expect(groundOf('.qprev-screen', DUSK)).toBe(hexIn(STAGE, '--bg'));
  });

  test('the screen restates the stage\'s own text wrapping, which the host shelf\'s dialog changes', () => {
    // `.qsets-modal` sets `overflow-wrap: anywhere` (QuestionSetsPanel.css, for
    // a 98-character set title) and the host shelf renders the editor inside
    // it, so the card inherited it: its heading and prompt broke a long word
    // anywhere, which the stage never does. rejects: dropping a restatement.
    const screenRule = ruleBody(QPREV_CSS, '.qprev-screen');
    for (const prop of ['overflow-wrap', 'word-break', 'white-space']) {
      expect(screenRule).toMatch(new RegExp(`(^|;)\\s*${prop}\\s*:\\s*normal\\s*(;|$)`));
    }
    // and `normal` IS the stage's value: nothing between the stage's body and
    // its card (.content > .fitbox, GameHostPage.jsx) declares any of the three.
    const cardAncestors = ['body', '.stage', '.main', '.content', '.fitbox', '.content > .fitbox'];
    const offenders = [...strip(STAGE_CSS).replace(/@media[^{]*\{/g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter(([, head, body]) => head.split(',').some((s) => cardAncestors.includes(s.trim()))
        && /(overflow-wrap|word-break|white-space)\s*:/.test(body))
      .map(([, head]) => head.trim());
    expect(offenders).toEqual([]);
  });

  test('the question and its prompt', () => {
    expect(on(S.text, SCREEN_GROUND)).toBeGreaterThanOrEqual(AA);
    // .qdetail is --text at opacity .82: the colour that reaches the eye is the
    // text composited over its ground.
    const opacity = Number(strip(STAGE_CSS).match(/\.qdetail\{[^}]*opacity:\s*([\d.]+)/)[1]);
    const ground = composited(SCREEN_GROUND);
    expect(ratio(alphaOver(parseHex(S.text), ground, opacity), ground)).toBeGreaterThanOrEqual(AA);
  });

  test('every option state the preview can draw', () => {
    expect(on(S.text, OPTION)).toBeGreaterThanOrEqual(AA);                                // .opt .txt
    expect(on(S.primary, [...OPTION, stageLayer('.opt .ltr')])).toBeGreaterThanOrEqual(AA);
    expect(on(S.successText, [...OPTION, stageLayer('.opt.correct .ltr')])).toBeGreaterThanOrEqual(AA);
    expect(on(S.muted, OPTION)).toBeGreaterThanOrEqual(AA);                               // .opt.dim .txt
    expect(on(S.muted, [...OPTION, stageLayer('.opt.dim .ltr')])).toBeGreaterThanOrEqual(AA);
  });

  test('"Nothing is selected" on the screen', () => {
    expect(on(S.muted, SCREEN_GROUND)).toBeGreaterThanOrEqual(AA);
  });
});

describe('the sheet itself', () => {
  const CSS = strip(QPREV_CSS);
  const outsideTokens = CSS
    .replace(/\.qprev,\s*\.qprev-switch\s*\{[^}]*\}/, '')
    .replace(/\.qprev \.qprev-screen\s*\{[^}]*\}/, '');

  test('no hex and no rgba outside the two token blocks', () => {
    expect(outsideTokens.match(/#[0-9A-Fa-f]{3,8}\b/g) || []).toEqual([]);
    expect(outsideTokens.match(/rgba?\(/g) || []).toEqual([]);
  });

  test('--danger never carries text here', () => {
    expect(CSS.split('\n').filter((l) => /(^|[^-])\bcolor\s*:\s*var\(--danger\)/.test(l))).toEqual([]);
  });

  test('every custom property the sheet uses is declared somewhere', () => {
    // An undefined custom property invalidates the WHOLE declaration.
    const declared = new Set();
    for (const css of [GLOBAL_CSS, STAGE_CSS, QPREV_CSS]) {
      for (const m of css.matchAll(/(--[a-z0-9-]+)\s*:/gi)) declared.add(m[1]);
    }
    const used = [...QPREV_CSS.matchAll(/var\((--[a-z0-9-]+)/gi)].map((m) => m[1]);
    expect([...new Set(used)].filter((name) => !declared.has(name))).toEqual([]);
  });

  test('every selector is rooted at the scope', () => {
    const roots = new Set();
    for (const block of CSS.replace(/@media[^{]*\{/g, '').split('}')) {
      const head = block.split('{')[0];
      if (!head.trim()) continue;
      for (const selector of head.split(',')) {
        const m = selector.trim().match(/^[a-zA-Z]*\.([\w-]+)/);
        if (m) roots.add(m[1]);
      }
    }
    expect([...roots].filter((name) => !name.startsWith('qprev'))).toEqual([]);
  });

  test('styles.css and stage.css declare nothing in this scope', () => {
    for (const css of [GLOBAL_CSS, STAGE_CSS]) {
      expect(strip(css).match(/\.qprev[\w-]*/g) || []).toEqual([]);
    }
  });

  test('the card is never restyled here — it stays exactly the stage', () => {
    // rejects: "fixing" the card for the preview, which forks it from the room.
    const cardClasses = ['q', 'qdetail', 'opts', 'opt', 'ltr', 'txt', 'fill', 'pct', 'stage-art',
      'correct', 'dim', 'stage-ladder-table'];
    const offenders = [...CSS.matchAll(/\.([\w-]+)/g)].map((m) => m[1]).filter((c) => cardClasses.includes(c));
    expect(offenders).toEqual([]);
  });

  test('the ladder is the admin one, and nothing is below the 12px floor', () => {
    for (const [step, px] of [['floor', 12], ['label', 13], ['body', 15], ['head', 19]]) {
      expect(QPREV_CSS).toMatch(new RegExp(`--qprev-t-${step}:\\s*${px}px`));
    }
    const sizes = [
      ...[...CSS.matchAll(/font-size:\s*(\d+)px/g)].map((m) => Number(m[1])),
      ...[...CSS.matchAll(/font:\s*\d+\s+(\d+)px/g)].map((m) => Number(m[1])),
    ];
    expect(sizes.filter((px) => px < 12)).toEqual([]);
  });
});
