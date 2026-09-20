/**
 * THE COLOUR PAIRINGS THE PHONE'S QUESTION PREVIEW INTRODUCES — `.hrqp-*`.
 *
 * Named "Palette", never "Token": `.gitignore:35` is an unanchored `*token*`, so
 * a file named for tokens is invisible to git — it passes locally and never
 * reaches CI. Do not rename it.
 *
 * ONE SURFACE, TWO GROUNDS, AND BOTH ARE DUSK. Unlike the set editor's preview
 * (which is paper around a dusk screen — QuestionPreviewPalette.test.js), the
 * remote is already dusk: `.hr` carries data-theme="dark" and paints `var(--bg)`,
 * which is also the stage's own ground. So the card stands on exactly what the
 * projector stands on, and the only token the screen has to restate is `--muted`,
 * which the stage LIFTS against its field.
 *
 * THE CHECKS ARE LIFTED, NOT REWRITTEN — `lin`, `lum`, `ratio`, `alphaOver` and
 * `bgOf` are copied out of docs/design/admin-redesign/audit.html's <script>, as
 * questionSetsPalette.test.js and QuestionPreviewPalette.test.js copied them.
 * NOTHING IS TYPED TWICE: every colour below is read out of styles.css,
 * styles/stage.css, HostRemote.css or RemoteQuestionBrowser.css, and so is every
 * ground a sheet paints under its text — a stack that assumed a ground would go
 * on passing after the sheet stopped painting it.
 *
 * SCOPE: the PREVIEW's pairings. This sheet also carries the list, which shipped
 * before it, and one of the list's rules draws copy in `var(--danger)` —
 * `.hrq-unresolved`, which is 4.38:1 on `--surface` and under AA. That is a real
 * pre-existing defect and `--danger-text` is what it wants (styles.css:22-35);
 * it is named here rather than quietly folded into this change, and the guard
 * below holds the preview's own rules to the rule so it cannot spread.
 *
 * jsdom has no layout engine and loads no stylesheet. Green here means the
 * palette clears AA on dusk; it cannot prove how a phone draws it.
 */
const fs = require('fs');
const path = require('path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '').trim();
const GLOBAL_CSS = read('styles.css');
const STAGE_CSS = read('styles', 'stage.css');
const HOST_CSS = read('HostRemote.css');
const HRQ_CSS = read('components', 'RemoteQuestionBrowser.css');

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
/** The ground a rule paints, resolved in `theme` — or null when it paints none. */
function groundOf(css, selector, theme) {
  const bg = ruleBody(css, selector).match(/background:\s*var\((--[\w-]+)\)/);
  return bg ? hexIn(theme, bg[1]) : null;
}

const ROOT = blockOf(GLOBAL_CSS, ':root {');
const DUSK = blockOf(GLOBAL_CSS, '[data-theme="dark"] {');
const STAGE = blockDeclaring(STAGE_CSS, '.stage{', '--muted');
const STAGE_ROOT = blockDeclaring(STAGE_CSS, ':root{', '--success-text');
const SCREEN = blockOf(HRQ_CSS, '.hrqp-screen {');
const PREVIEW = blockOf(HRQ_CSS, '.hrq--preview {');

const S = {
  bg: hexIn(DUSK, '--bg'),
  surface: hexIn(DUSK, '--surface'),
  text: hexIn(DUSK, '--text'),
  chromeMuted: hexIn(DUSK, '--muted'),   // the remote's own muted, off the screen
  screenMuted: hexIn(SCREEN, '--muted'), // the stage's lifted muted, on it
  primary: hexIn(ROOT, '--primary'),
  successText: hexIn(STAGE_ROOT, '--success-text'),
  pressed: rgbaIn(PREVIEW, '--hrq-pressed'),
};

/** A stage.css rule's `background`, by exact selector. */
function stageLayer(selector) {
  const bg = ruleBody(STAGE_CSS, selector).match(/background:\s*(rgba\([^)]*\))/);
  if (!bg) throw new Error(`"${selector}" paints no rgba background`);
  return bg[1];
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

/* The remote's own field, READ: `.hr` is the only thing between the document and
   this pane that paints anything (`.hr-body` and `.hrq` paint nothing). */
const REMOTE = [groundOf(HOST_CSS, '.hr', DUSK)];
const CONTROL = [...REMOTE, groundOf(HRQ_CSS, '.hrqp-seg', DUSK)];
const BACK = [...REMOTE, groundOf(HRQ_CSS, '.hrqp-back', DUSK)];
const SCREEN_GROUND = [...REMOTE, groundOf(HRQ_CSS, '.hrqp-screen', DUSK)];
const OPTION = [...SCREEN_GROUND, stageLayer('.opt')];

describe('the premise: the phone paints dusk, and the screen paints the stage\'s own ground', () => {
  test('the remote really is on --bg, so everything below is measured on it', () => {
    // rejects: measuring against a ground the remote does not paint — and a
    // remote that stops opting back into dusk, which is the defect
    // docs/design/AUDIT.md citation 5 records on this very surface.
    expect(REMOTE[0]).toBe(S.bg);
    expect(read('HostRemote.jsx')).toMatch(/className="hr" data-theme="dark"/);
  });

  test('the screen restates exactly the stage\'s tokens, nothing near them', () => {
    // rejects: a "close enough" dusk. The card must look like the projector.
    expect(S.screenMuted).toBe(hexIn(STAGE, '--muted'));
    expect(groundOf(HRQ_CSS, '.hrqp-screen', DUSK)).toBe(hexIn(STAGE, '--bg'));
    expect(S.text).toBe(hexIn(STAGE, '--text'));
    // --primary and --success are theme-invariant, so the remote already hands
    // the card the stage's own: nothing to restate, and nothing to drift.
    expect(GLOBAL_CSS).toMatch(/--primary:\s*#F6A94C/i);
    expect(strip(HRQ_CSS)).not.toMatch(/--primary\s*:/);
  });

  test('the screen restates the stage\'s own text wrapping and typography', () => {
    // The remote is not the stage's body: stage.css's `body` gives the card
    // Inter, antialiasing and tabular figures; styles.css's `body` a 1.6 line
    // height. rejects: dropping a restatement, which is how the host shelf's
    // dialog once broke the card's long words anywhere.
    const rule = ruleBody(HRQ_CSS, '.hrqp-screen');
    for (const prop of ['overflow-wrap', 'word-break', 'white-space']) {
      expect(rule).toMatch(new RegExp(`(^|;)\\s*${prop}\\s*:\\s*normal\\s*(;|$)`));
    }
    expect(rule).toMatch(/font-variant-numeric:\s*tabular-nums/);
    expect(rule).toMatch(/font:\s*400\s+16px\/1\.6\s+var\(--font-ui\)/);
  });
});

describe('the card, on the stage\'s ground', () => {
  test('the question and its prompt', () => {
    expect(on(S.text, SCREEN_GROUND)).toBeGreaterThanOrEqual(AA);
    // .qdetail is --text at opacity .82: the colour that reaches the eye is the
    // text composited over its ground.
    const opacity = Number(strip(STAGE_CSS).match(/\.qdetail\{[^}]*opacity:\s*([\d.]+)/)[1]);
    const ground = composited(SCREEN_GROUND);
    expect(ratio(alphaOver(parseHex(S.text), ground, opacity), ground)).toBeGreaterThanOrEqual(AA);
  });

  test('every option state the preview can draw', () => {
    expect(on(S.text, OPTION)).toBeGreaterThanOrEqual(AA);                                 // .opt .txt
    expect(on(S.primary, [...OPTION, stageLayer('.opt .ltr')])).toBeGreaterThanOrEqual(AA);
    expect(on(S.successText, [...OPTION, stageLayer('.opt.correct .ltr')])).toBeGreaterThanOrEqual(AA);
    expect(on(S.screenMuted, OPTION)).toBeGreaterThanOrEqual(AA);                          // .opt.dim .txt
    expect(on(S.screenMuted, [...OPTION, stageLayer('.opt.dim .ltr')])).toBeGreaterThanOrEqual(AA);
  });
});

describe('the chrome around the card', () => {
  test.each([
    ['the way back ("All questions")', () => on(S.text, BACK)],
    ['the position ("3 / 30"), straight on the remote\'s field', () => on(S.chromeMuted, REMOTE)],
    ['a segment at rest (ASK, Reveal)', () => on(S.text, CONTROL)],
    // rejects: a transparent group. The pressed tint over the remote's #0F1A2E
    // field is a different composite from the tint over the group's #1B2942, and
    // CONTROL is read from the sheet, so dropping the group's ground is measured.
    ['the accent on the pressed segment', () => on(S.primary, [...CONTROL, S.pressed])],
    ['the reveal note', () => on(S.text, REMOTE)],
    ['the reveal note\'s label', () => on(S.chromeMuted, REMOTE)],
  ])('%s clears AA', (_label, measure) => {
    expect(measure()).toBeGreaterThanOrEqual(AA);
  });

  test('the pressed segment still reads as pressed AND as text', () => {
    // Both halves matter: the accent must be legible on the tint (above) and the
    // tint must be visibly different from the group it sits in, or aria-pressed
    // is the only thing saying which one is on.
    expect(ratio(composited([...CONTROL, S.pressed]), composited(CONTROL)))
      .toBeGreaterThan(1.03);
  });
});

/* The preview's own rules, isolated: every rule whose whole selector list lives
   under `.hrqp-*` or `.hrq--preview`. The list above them shipped first and is
   not this change's to re-measure. */
const PREVIEW_RULES = strip(HRQ_CSS)
  .replace(/@media[^{]*\{/g, '')
  .split('}')
  .map((block) => {
    const [head, body] = block.split('{');
    return { head: (head || '').trim(), body: body || '' };
  })
  .filter(({ head, body }) => head && body
    && head.split(',').every((s) => /^\.(hrqp-|hrq--preview)/.test(s.trim())));

describe('the sheet itself', () => {
  test('the premise: the preview\'s rules were actually found', () => {
    expect(PREVIEW_RULES.length).toBeGreaterThanOrEqual(8);
  });

  test('the card is never restyled here — it stays exactly the stage', () => {
    // rejects: "fixing" the card for the phone, which forks it from the room.
    const cardClasses = ['q', 'qdetail', 'opts', 'opt', 'ltr', 'txt', 'fill', 'pct', 'stage-art',
      'correct', 'dim', 'stage-ladder-table'];
    const offenders = [...strip(HRQ_CSS).matchAll(/\.([\w-]+)/g)]
      .map((m) => m[1]).filter((c) => cardClasses.includes(c));
    expect(offenders).toEqual([]);
  });

  test('the preview draws no copy in --danger', () => {
    // styles.css:22-35: --danger is 4.38:1 on --surface and keeps borders, rules
    // and bar fills; --danger-text is what copy wants. (`.hrq-unresolved` in the
    // LIST breaks this and predates the preview — see the header.)
    const offenders = PREVIEW_RULES
      .filter(({ body }) => /(^|[^-])\bcolor\s*:\s*var\(--danger\)/.test(body))
      .map(({ head }) => head);
    expect(offenders).toEqual([]);
  });

  test('no raw colour in the preview outside its two token blocks', () => {
    const tokens = new Set(['.hrq--preview', '.hrqp-screen']);
    const offenders = PREVIEW_RULES
      .filter(({ head }) => !tokens.has(head))
      .filter(({ body }) => /#[0-9A-Fa-f]{3,8}\b/.test(body) || /rgba?\(/.test(body))
      .map(({ head }) => head);
    expect(offenders).toEqual([]);
  });

  test('every custom property the sheet uses is declared somewhere', () => {
    // An undefined custom property invalidates the WHOLE declaration — which is
    // how `border: var(--hair) solid var(--rule)` once drew no border at all.
    const declared = new Set();
    for (const css of [GLOBAL_CSS, STAGE_CSS, HOST_CSS, HRQ_CSS]) {
      for (const m of css.matchAll(/(--[a-z0-9-]+)\s*:/gi)) declared.add(m[1]);
    }
    const used = [...HRQ_CSS.matchAll(/var\((--[a-z0-9-]+)/gi)].map((m) => m[1]);
    expect([...new Set(used)].filter((name) => !declared.has(name))).toEqual([]);
  });

  test('every selector is rooted at this component\'s scope', () => {
    const roots = new Set();
    for (const block of strip(HRQ_CSS).replace(/@media[^{]*\{/g, '').split('}')) {
      const head = block.split('{')[0];
      if (!head || !head.trim()) continue;
      for (const selector of head.split(',')) {
        const m = selector.trim().match(/^[a-zA-Z]*\.([\w-]+)/);
        if (m) roots.add(m[1]);
      }
    }
    expect([...roots].filter((name) => !name.startsWith('hrq'))).toEqual([]);
  });

  test('styles.css and stage.css declare nothing in this scope', () => {
    for (const css of [GLOBAL_CSS, STAGE_CSS]) {
      expect(strip(css).match(/\.hrq[\w-]*/g) || []).toEqual([]);
    }
  });

  /* GEOMETRY READ AS TEXT, which is the only honest way here: jsdom gives every
     rect zero, so a rendered assertion about a tap target passes against a
     deleted stylesheet. This pins that the contract has not been reverted, not
     that the surface works in a hand — only a phone can say that. */
  test('every control the preview adds is at least the 44px one-handed floor', () => {
    for (const selector of ['.hrqp-back', '.hrqp-seg-btn']) {
      expect(ruleBody(HRQ_CSS, selector)).toMatch(/min-height:\s*44px/);
    }
    // Previous / Next / Ask are `.hr-btn`, which sets its own 48px floor.
    expect(ruleBody(HOST_CSS, '.hr-btn')).toMatch(/min-height:\s*48px/);
  });

  test('nothing the preview adds is below the 12px floor', () => {
    const px = [];
    for (const { body } of PREVIEW_RULES) {
      for (const m of body.matchAll(/font-size:\s*([\d.]+)(px|rem)/g)) {
        px.push(m[2] === 'rem' ? Number(m[1]) * 16 : Number(m[1]));
      }
      for (const m of body.matchAll(/font:\s*[\w\s]*?([\d.]+)(px|rem)\//g)) {
        px.push(m[2] === 'rem' ? Number(m[1]) * 16 : Number(m[1]));
      }
    }
    expect(px.length).toBeGreaterThan(0);
    expect(px.filter((size) => size < 12)).toEqual([]);
  });

  test('no track holding a pair of controls can widen a 390px phone', () => {
    // `1fr` is sized to its content and refuses to shrink below the widest
    // label, so "Ask this next" beside "Preview", or Previous and Next either
    // side of "12 / 30", would push the card sideways.
    expect(ruleBody(HRQ_CSS, '.hrq-actions'))
      .toMatch(/grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
    expect(ruleBody(HRQ_CSS, '.hrqp-step'))
      .toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)\s*auto\s*minmax\(0,\s*1fr\)/);
  });

});
