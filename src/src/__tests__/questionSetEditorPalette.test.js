/**
 * THE QUESTION SET EDITOR, ON THE PRODUCT'S OWN DARK GROUND — `.qs-editor`.
 *
 * Named "Palette", never "Token": `.gitignore:35` is an unanchored `*token*`, so
 * a file named for tokens is invisible to git — it passes locally and never
 * reaches CI. Do not rename it.
 *
 * WHY THIS FILE EXISTS. The editor was paper BY DECISION: AdminPage rendered it
 * with `contentTheme: 'light'`, `.qs-editor .qs-panel` painted the paper
 * `--surface-2`, and the host shelf re-pointed two more tokens back to paper so
 * the mounted copy matched. The owner, looking at the shipped console: *"the
 * white background really contrasts the rest of the site, as we are entirely
 * dark background throughout, except for question set editors and previews."*
 * So the decision is reversed here rather than weakened: the editor declares
 * `data-theme="dark"` on its own root and is dusk on BOTH mounts.
 *
 * ONE STACK, TWO MOUNTS. The editor's card is an opaque token, so the compositing
 * walk stops there and the console's dusk work body and the host shelf's white
 * dialog produce the identical ground underneath every pairing below. That is
 * what makes one set of measurements cover both places, and it is asserted.
 *
 * THE CHECKS ARE LIFTED, NOT REWRITTEN — `lin`, `lum`, `ratio`, `alphaOver` and
 * `bgOf` are copied out of docs/design/admin-redesign/audit.html's <script>, as
 * questionSetsPalette.test.js and QuestionPreviewPalette.test.js copied them.
 * Nothing is typed twice: every colour is read out of styles.css or
 * QuestionSetEditor.css, and so is every ground, so a later repaint is measured
 * here rather than discovered on a projector.
 *
 * jsdom has no layout engine and loads no stylesheet. Green here means the
 * palette clears AA; it cannot prove how a browser draws it.
 */
const fs = require('fs');
const path = require('path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const GLOBAL_CSS = read('styles.css');
const EDITOR_CSS = read('components', 'QuestionSetEditor.css');
const CAT_CSS = read('components', 'CategoryPicker.css');
const QSETS_CSS = read('components', 'QuestionSetsPanel.css');

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

/* SPECIFICITY, counted the way a browser counts it. Used by two describes
   below: the audit of the paper controls the editor borrows, and the review
   banner's flagged ink, where an override has to out-rank a rule that always
   matches rather than merely come later in the bundle. */
const specificity = (selector) => {
  const s = selector.replace(/::?[a-z-]+\([^)]*\)/g, (m) => (/:not\(/.test(m) ? m.slice(5, -1) : ''));
  return [
    (s.match(/#[\w-]+/g) || []).length,
    (s.match(/\.[\w-]+|\[[^\]]*\]|:[a-z-]+(?!\()/g) || []).length,
    (s.match(/(^|[\s>+~])[a-z][\w-]*/g) || []).length,
  ];
};
const beats = (a, b) => (a[0] !== b[0] ? a[0] > b[0] : a[1] !== b[1] ? a[1] > b[1] : a[2] > b[2]);

const DUSK = blockOf(GLOBAL_CSS, '[data-theme="dark"] {');
const ROOT = blockOf(GLOBAL_CSS, ':root {');
const SCOPE = blockOf(EDITOR_CSS, '.qs-editor {');

const T = {
  bg: hexIn(DUSK, '--bg'),
  surface: hexIn(DUSK, '--surface'),
  surface2: hexIn(DUSK, '--surface-2'),
  text: hexIn(DUSK, '--text'),
  muted: hexIn(DUSK, '--muted'),
  primary: hexIn(ROOT, '--primary'),
  secondary: hexIn(ROOT, '--secondary'),
  success: hexIn(SCOPE, '--success'),
  danger: hexIn(SCOPE, '--danger'),
  dangerText: hexIn(SCOPE, '--danger-text'),
  dangerDeep: hexIn(SCOPE, '--danger-deep'),
  successText: hexIn(SCOPE, '--qs-success-text'),
  chipPublic: hexIn(SCOPE, '--qs-chip-public-ink'),
  chipWaiting: hexIn(SCOPE, '--qs-chip-waiting-ink'),
  tintWarn: rgbaIn(SCOPE, '--qs-tint-warn'),
  tintDanger: rgbaIn(SCOPE, '--qs-tint-danger'),
  tintOk: rgbaIn(SCOPE, '--qs-tint-ok'),
  tintNeutral: rgbaIn(SCOPE, '--qs-tint-neutral'),
  rowHover: rgbaIn(SCOPE, '--qs-row-hover'),
};

/** A token's value in the editor's own scope, falling back to the dusk theme. */
function resolve(name) {
  for (const block of [SCOPE, DUSK, ROOT]) {
    if (new RegExp(`${name}\\s*:\\s*#`).test(block)) return hexIn(block, name);
    if (new RegExp(`${name}\\s*:\\s*rgba`).test(block)) return rgbaIn(block, name);
  }
  throw new Error(`${name} is declared by no block the editor can see`);
}

/**
 * The ground a rule paints, resolved in the dusk theme — or null when it paints
 * none and the layer beneath shows through. READ from the sheet, so a later
 * repaint is measured here rather than assumed away.
 */
function groundOf(css, selector) {
  const bg = ruleBody(css, selector).match(/background(?:-color)?:\s*var\((--[\w-]+)\)/);
  return bg ? resolve(bg[1]) : null;
}

/** The ink a rule draws its text in, resolved the same way. */
function inkOf(css, selector) {
  const fg = ruleBody(css, selector).match(/(?:^|;)\s*color:\s*var\((--[\w-]+)\)/);
  return fg ? resolve(fg[1]) : null;
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

/* The real paint stack, read from the sheets that paint it:
   the console's dusk work body, the editor's card, a panel cut into it, a row
   raised back out of the panel. */
const CARD = [T.bg, groundOf(EDITOR_CSS, '.admin-section.qs-editor')];
const PANEL = [...CARD, groundOf(GLOBAL_CSS, '.qs-editor .qs-panel')];
const ROW = [...PANEL, groundOf(GLOBAL_CSS, '.qs-question-row')];
const DIALOG = [...CARD, groundOf(EDITOR_CSS, '.qs-editor .modal-content')];

describe('the editor is dusk, on both of its mounts', () => {
  test('the editor root declares the dark theme itself rather than inheriting one', () => {
    // rejects: relying on the console's work body, which would leave the host
    // shelf's copy paper — the two mounts have different ancestors and only a
    // declaration on the editor's own root covers both.
    const jsx = strip(read('components', 'QuestionSetEditor.jsx'));
    const root = jsx.match(/<div className="[^"]*qs-editor"[^>]*>/);
    expect(root).not.toBeNull();
    expect(root[0]).toMatch(/data-theme="dark"/);
  });

  test('the console hands the editor the dusk work body', () => {
    // rejects: the markup converting while AdminPage still passes 'light' — the
    // editor would paint dusk tokens onto a #FBF7F1 field. The markup and the
    // theme move in the same change (engage-design, testing-a-surface §2.3).
    const page = strip(read('AdminPage.jsx'));
    const theme = page.match(/contentTheme=\{editingSet \? '(\w+)'/);
    expect(theme).not.toBeNull();
    expect(theme[1]).toBe('dark');
  });

  test('the host shelf no longer re-points the editor back to paper', () => {
    // `.qsets--onlight .qs-editor` was a 0,2,0 declaration ON the editor's own
    // root, so it outranked `[data-theme="dark"]`'s 0,1,0 and the host mount
    // would have stayed paper while the console went dusk.
    expect(strip(QSETS_CSS)).not.toMatch(/\.qsets--onlight\s+\.qs-editor\s*\{/);
  });

  test('the editor restates every token the host shelf re-points and the theme does not restore', () => {
    // Custom properties INHERIT. `.qsets--onlight` re-points global tokens on the
    // overlay the editor is mounted inside; `[data-theme="dark"]` restores only
    // the five surface/ink ones. Anything else it re-points — the host's
    // #9A5B18 amber above all — would reach the editor unchanged and be drawn
    // on dusk. rejects: leaving one of them to leak in.
    const onlight = blockOf(QSETS_CSS, '.qsets.qsets--onlight,');
    const repointed = [...onlight.matchAll(/(--[a-z0-9-]+)\s*:/gi)]
      .map((m) => m[1])
      .filter((name) => !name.startsWith('--qsets-'));
    const restoredByTheme = repointed.filter((name) => new RegExp(`${name}\\s*:`).test(DUSK));
    const mustRestate = repointed.filter((name) => !restoredByTheme.includes(name));
    expect(mustRestate.length).toBeGreaterThan(0);        // the premise
    expect(mustRestate.filter((name) => !new RegExp(`${name}\\s*:`).test(SCOPE))).toEqual([]);
  });

  test('the card is opaque, which is what makes one measurement cover both mounts', () => {
    // rejects: a translucent card. The console field is #0F1A2E and the host
    // dialog is white; a card that let either through would need two sets of
    // numbers and one of them would go unmeasured.
    const card = groundOf(EDITOR_CSS, '.admin-section.qs-editor');
    expect(card).not.toBeNull();
    expect(card).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(composited([T.bg, card])).toEqual(composited(['#FFFFFF', card]));
  });
});

describe('the flat pairings the editor paints', () => {
  test.each([
    ['--text on the card (the editor heading, the Workie group)', T.text, CARD],
    ['--muted on the card (the set line under the heading)', T.muted, CARD],
    ['--text on a panel (panel headings, field labels, values)', T.text, PANEL],
    ['--muted on a panel (panel notes, the empty line, the filter)', T.muted, PANEL],
    ['--primary on a panel (the AI field mark, links)', T.primary, PANEL],
    ['--text on a question row (its title)', T.text, ROW],
    ['--muted on a question row (its meta and detail lines)', T.muted, ROW],
    ['--primary on a question row (the changed badge)', T.primary, ROW],
    ['--danger-text on a question row (the removed badge)', T.dangerText, ROW],
    ['the active-version ink on a version row', T.successText, ROW],
    ['the public chip ink on a version row', T.chipPublic, ROW],
    ['the waiting chip ink on a version row', T.chipWaiting, ROW],
    ['--text in the question dialog', T.text, DIALOG],
    ['--muted in the question dialog', T.muted, DIALOG],
    ['a dialog heading, which styles.css draws in a red', T.dangerText, DIALOG],
    ['--bg on --primary (the filled primary button)', T.bg, [T.primary]],
    ['--text on --danger-deep (the filled destructive)', T.text, [T.dangerDeep]],
  ])('%s clears AA', (_label, fg, layers) => {
    expect(on(fg, layers)).toBeGreaterThanOrEqual(AA);
  });
});

describe('the tinted composites — the half a token table cannot show', () => {
  test.each([
    ['the dirty bar, on the panel it warns about', T.text, [...PANEL, T.tintWarn]],
    ['the dirty bar\'s own muted copy', T.muted, [...PANEL, T.tintWarn]],
    ['a changed question row', T.text, [...ROW, T.tintWarn]],
    ['a changed row\'s meta line', T.muted, [...ROW, T.tintWarn]],
    ['a changed row\'s badge', T.primary, [...ROW, T.tintWarn]],
    ['a tombstoned question row', T.text, [...ROW, T.tintDanger]],
    ['a tombstoned row\'s struck title', T.muted, [...ROW, T.tintDanger]],
    ['a tombstoned row\'s badge', T.dangerText, [...ROW, T.tintDanger]],
    ['the active version row', T.text, [...ROW, T.tintOk]],
    ['the active version badge', T.successText, [...ROW, T.tintOk]],
    ['the AI panel, on the panel it sits in', T.text, [...PANEL, T.tintNeutral]],
    ['the AI panel\'s muted copy', T.muted, [...PANEL, T.tintNeutral]],
    ['a hovered pull-dialog row', T.text, [...DIALOG, T.rowHover]],
    ['a hovered pull-dialog row\'s meta', T.muted, [...DIALOG, T.rowHover]],
  ])('%s clears AA', (_label, fg, layers) => {
    expect(on(fg, layers)).toBeGreaterThanOrEqual(AA);
  });
});

/*
 * THE FOUR CHILDREN THAT CARRY THEIR OWN PALETTE. They are measured here, on
 * this scope's stack, because none of them can measure themselves against it:
 * `RoundKindPicker` is shared with two paper builders and its own test measures
 * it there, and `CategoryPicker`'s values are this scope's tokens. Every ground
 * and every ink below is READ from the rule that draws it.
 */
describe('the components mounted inside the editor', () => {
  const RKP = blockOf(EDITOR_CSS, '.qs-editor .round-kind-picker {');
  const rkp = (name) => {
    const m = RKP.match(new RegExp(`${name}\\s*:\\s*var\\((--[\\w-]+)\\)`));
    if (!m) throw new Error(`${name} is not re-pointed to a token in the editor's scope`);
    return resolve(m[1]);
  };

  test.each([
    // The round-direction cards sit in the Details panel and paint their own
    // ground, so the card is the stack rather than the panel.
    ['a round-direction card\'s title', () => rkp('--rkp-text'), () => [...PANEL, rkp('--rkp-card')]],
    ['its blurb', () => rkp('--rkp-muted'), () => [...PANEL, rkp('--rkp-card')]],
    ['the selected card\'s title', () => rkp('--rkp-text'), () => [...PANEL, rkp('--rkp-card-selected')]],
    ['the selected card\'s blurb', () => rkp('--rkp-muted'), () => [...PANEL, rkp('--rkp-card-selected')]],
    ['the accent on a selected card', () => rkp('--rkp-accent'), () => [...PANEL, rkp('--rkp-card-selected')]],
    ['a hovered card\'s title', () => rkp('--rkp-text'), () => [...PANEL, rkp('--rkp-card'), rkp('--rkp-card-hover')]],
    // The category combobox floats over the question dialog.
    ['a category name in the open list', T.text, () => [...DIALOG, groundOf(CAT_CSS, '.qs-cat-list')]],
    ['an unreachable one, struck through', T.muted, () => [...DIALOG, groundOf(CAT_CSS, '.qs-cat-list')]],
    ['the keyboard-highlighted option', T.text,
      () => [...DIALOG, groundOf(CAT_CSS, '.qs-cat-list'), groundOf(CAT_CSS, '.qs-cat-option.active')]],
    ['"+ New category", and the cap refusal beside it', () => resolve('--primary'),
      () => [...DIALOG, groundOf(CAT_CSS, '.qs-cat-list')]],
    // The review banner is theme-agnostic and paints --surface-2 on the card.
    ['the AI review banner\'s copy', T.muted, () => [...CARD, T.surface2]],
    ['its heading', () => resolve('--primary'), () => [...CARD, T.surface2]],
  ])('%s clears AA', (_label, fg, layers) => {
    expect(on(typeof fg === 'function' ? fg() : fg, layers())).toBeGreaterThanOrEqual(AA);
  });

  test('the round-direction picker is re-pointed to tokens, never to new literals', () => {
    // rejects: a second palette invented inside the editor's scope. Every one
    // of the seven values the component declares has to come back as a token
    // this scope already measures.
    // Colours only — `--rkp-radius` is geometry and the same in both mounts.
    const declared = [...blockOf(read('components', 'RoundKindPicker.css'), '.round-kind-picker {')
      .matchAll(/(--rkp-[\w-]+)\s*:\s*(#[0-9A-Fa-f]{3,8}|rgba?\()/g)].map((m) => m[1]);
    expect(declared.length).toBeGreaterThan(0);                 // the premise
    expect(declared.filter((name) => !new RegExp(`${name}\\s*:\\s*var\\(`).test(RKP))).toEqual([]);
  });
});

/*
 * THE PAPER CONTROLS THE EDITOR BORROWS. `.admin-section`, `.form-input`,
 * `.btn-secondary`, `.status-message`, `.modal-content`, `.help-text` and the
 * rest are styles.css's (and auth.css's, and IssueReportForm.css's) paper
 * controls, shared with a dozen screens that are still paper. The editor reuses
 * them on purpose — *"why recreate everything"* — so they are re-inked INSIDE
 * the scope and never at source.
 *
 * SPECIFICITY, NOT SOURCE ORDER. index.jsx imports App before styles.css, so
 * every component sheet loads FIRST and a same-specificity override would lose.
 * Each rule below is one class deeper than the global it replaces.
 */
describe('the paper controls the editor borrows are re-inked inside the scope', () => {
  /* Every [selector, body] in a sheet. `[^{}]+` cannot cross a brace, so this
     needs no anchor — and an anchored `(^|\})` would be WRONG here: the match
     consumes the closing brace it anchored on, leaving the next rule without
     one, so every second rule is silently skipped. That is not hypothetical;
     it made the specificity audit below pass while four real conflicts stood. */
  const rules = (css) => [...strip(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map(([, head, body]) => [head.trim(), body]);
  const selectors = rules(EDITOR_CSS)
    .flatMap(([head]) => head.split(',').map((s) => s.trim()))
    .filter((s) => s && !s.startsWith('@'));

  test.each([
    ['the editor card itself', '.admin-section.qs-editor'],
    ['its heading', '.admin-section.qs-editor h2'],
    ['the set line under it', '.qs-editor .section-description'],
    ['every field label', '.qs-editor .form-group label'],
    ['every input, select and textarea', '.qs-editor .form-input'],
    ['the help text under a field', '.qs-editor .help-text'],
    ['the secondary button', '.qs-editor .btn-secondary'],
    ['the question dialog card', '.qs-editor .modal-content'],
    ['the status banner', '.qs-editor .status-message'],
  ])('%s is re-inked', (_label, selector) => {
    expect(selectors).toContain(selector);
  });

  test('every override is scoped, so the screens still on paper keep theirs', () => {
    // rejects: a bare `.form-input` or `.btn-secondary` in this sheet, which
    // would repaint the auth forms, the issue reporter and every paper admin
    // panel from a stylesheet none of them know about.
    // The lookahead, not a "followed by . or space", is what lets the scope
    // class carry a qualifier of its own — `.qs-editor[data-theme="dark"]`,
    // which the review banner's ink needs — while still refusing `.qs-editorish`.
    const unscoped = selectors.filter((s) => !/\.qs-editor(?![\w-])/.test(s));
    expect(unscoped).toEqual([]);
  });

  /*
   * SPECIFICITY IS THE WHOLE MECHANISM HERE, so it is measured rather than
   * assumed. index.jsx imports App before styles.css, so every component sheet
   * loads FIRST and source order cannot be relied on — an override only wins by
   * being more specific. This caught a real one: the rule that draws every form
   * control's border in this product is AIPromptManager.css's `.form-group
   * input[type="text"]` (0,2,1), and `.qs-editor .form-input` (0,2,0) loses to
   * it on the element selector, so a #ddd hairline would have survived round
   * every field on a dusk card.
   */
  const FOREIGN = ['styles.css', 'auth/auth.css', 'components/IssueReportForm.css',
    'components/FileUploadPrompt.css', 'components/AIPromptManager.css'];

  /** Which of {background, color, border} a declaration actually paints. */
  const paints = (declaration) => {
    const property = declaration.split(':')[0].trim();
    if (/^background/.test(property)) return 'background';
    if (property === 'color') return 'color';
    if (/^(border|outline)/.test(property)) return 'border';
    // box-shadow is deliberately not audited: it is a shadow rather than an
    // edge, it reads as depth in either polarity, and every one of these is a
    // low-alpha black that simply disappears on dusk.
    return null;
  };
  /** Every [selector, painted-property] pair in a sheet, comments stripped. */
  const painted = (css, shape) => rules(css)
    .flatMap(([head, body]) => head.split(',')
      .map((s) => s.trim())
      .filter((sel) => !sel.startsWith('@') && shape.test(sel))
      .flatMap((sel) => body.split(';')
        .filter((d) => /#[0-9A-Fa-f]{3,8}\b|rgba?\(|\bwhite(?![-\w])|var\(--/.test(d))
        .map((d) => [sel, paints(d)])
        .filter(([, property]) => property)));

  /* One entry per control the editor borrows: the classes it is actually built
     from, matched EXACTLY. A substring match would have pulled in `.au-btn-
     primary`, an auth-screen class the editor never renders, and a conflict
     that cannot happen is noise — noise is how a real one gets waved through. */
  test.each([
    ['the inputs', ['form-input', 'form-textarea', 'form-select', 'form-group']],
    ['the buttons', ['btn-primary', 'btn-secondary', 'btn-danger']],
    ['the file picker', ['file-input-label']],
    ['the dialog card', ['modal-content']],
    ['the status banner', ['status-message', 'success', 'error']],
    ['the labels and the copy around them', ['form-group', 'help-text', 'section-description', 'form-actions']],
  ])('%s: every foreign rule that paints it is out-specified in the scope', (_label, classes) => {
    const shape = new RegExp(`\\.(${classes.join('|')})(?![\\w-])`);
    // A rule can only threaten the editor if it can MATCH inside it, so a
    // selector carrying a class the editor never renders — another surface's
    // scope, `.pmgr`, `.padm`, `.plib`, `.setup-field` — is not a conflict.
    const reachable = (sel) => (sel.match(/\.[\w-]+/g) || [])
      .every((c) => classes.includes(c.slice(1)));
    const foreign = FOREIGN.flatMap((f) => painted(read(...f.split('/')), shape))
      .filter(([sel]) => reachable(sel))
      .filter(([sel]) => !/\.error\b/.test(sel))     // no caller renders that state here
      .filter(([sel]) => !/\.qs-editor\b/.test(sel));
    expect(foreign.length).toBeGreaterThan(0);                  // the premise

    const mine = painted(EDITOR_CSS, shape);
    const unbeaten = foreign
      .filter(([sel, property]) => !mine.some(([own, ownProperty]) => ownProperty === property
        && beats(specificity(own), specificity(sel))))
      .map(([sel, property]) => `${sel} { ${property} }`);
    expect([...new Set(unbeaten)]).toEqual([]);
  });

  test('the globals themselves are untouched, so the paper screens are unchanged', () => {
    // rejects: fixing this at source. These three are the ones with the widest
    // blast radius; each keeps the paper value the rest of the product reads.
    expect(ruleBody(GLOBAL_CSS, '.admin-section')).toMatch(/background:\s*white/);
    expect(ruleBody(GLOBAL_CSS, '.btn-secondary')).toMatch(/background:\s*white/);
    expect(ruleBody(GLOBAL_CSS, '.section-description')).toMatch(/color:\s*#666/);
  });

  test.each([
    ['success', '.qs-editor .status-message.success', '--success'],
    ['error', '.qs-editor .status-message.error', '--danger'],
    ['pending', '.qs-editor .status-message', '--muted'],
  ])('the %s banner carries its copy, and its tone glyph, on its own ground', (_tone, selector, glyph) => {
    // The banner's ground is this sheet's now; the glyph's colour is still
    // utils/statusTone.js's `statusColor()`. Both ends are READ, so a later
    // repaint of either is measured here. rejects: a dusk ground left under the
    // paper #155724 / #721c24 copy.
    const layers = [...CARD, groundOf(EDITOR_CSS, selector)];
    expect(on(inkOf(EDITOR_CSS, selector), layers)).toBeGreaterThanOrEqual(AA);
    // A glyph is a non-text graphic: 3:1. --danger is the reason this is not
    // 4.5 — it is 4.38:1 on --surface and may never carry copy, which is what
    // --danger-text above is for.
    expect(on(resolve(glyph), layers)).toBeGreaterThanOrEqual(3);
    // and the glyph really is drawn in that token — read from statusColor()
    // itself, so a change there is caught rather than silently unmeasured.
    expect(read('utils', 'statusTone.js')).toMatch(new RegExp(`return 'var\\(${glyph}\\)'`));
  });
});

/*
 * THE NEEDS-CHANGES BANNER — components/SetReviewBanner.jsx.
 *
 * Its ONLY mount is this editor (QuestionSetEditor.jsx, inside `showVersions`,
 * which defaults to true, so the console place renders it), so it moved onto
 * dusk with everything else. Its flagged ink did not.
 *
 * SetReviewBanner.css declares `--srev-flag-ink: var(--danger-text)` on `.srev`
 * and then swaps it for a paper red under `[data-theme="light"] .srev`. That is
 * a DESCENDANT selector and public/index.html ships `<html data-theme="light">`,
 * so the swap matches every `.srev` in the product unconditionally and outranks
 * the declaration it is meant to override — 0,2,0 against 0,1,0. The dusk
 * branch has never applied in a browser. While the editor was paper that was
 * harmless: the paper red was the right ink, reached by the wrong route, at
 * 6.8:1. On dusk the same ink lands at 1.7:1 on three things — each flagged
 * question's title, the "high" band word, and the Warning glyph the component
 * passes `var(--srev-flag-ink)` to.
 *
 * RE-POINTED FROM THIS SCOPE rather than by editing SetReviewBanner.css. That
 * sheet is theme-agnostic by design and its always-matching selector is a
 * separate defect on surfaces this change does not touch; a re-tint is not the
 * place to settle it. __tests__/srevPalette.test.js measures the sheet in the
 * abstract — including a dusk branch the DOM cannot produce — so this measures
 * what the editor actually renders.
 */
describe('the needs-changes banner the editor renders', () => {
  const SREV_CSS = read('components', 'SetReviewBanner.css');
  const SREV = blockOf(SREV_CSS, '.srev {');
  const PAPER_INK = hexIn(SREV, '--srev-flag-ink-paper');

  /* The banner's tint, read from the rule that paints it. `.srev` writes the
     danger red by hand as an rgba whose alpha is a token, so both halves are
     read and the rgb is checked against --danger — a red that drifted from the
     token would otherwise go on being measured as the token. */
  const tintRgb = SREV.match(/background:\s*rgba\(([^,]+,[^,]+,[^,]+),/)[1].replace(/\s/g, '');
  const tintAlpha = Number(SREV.match(/--srev-tint-alpha:\s*([\d.]+)/)[1]);
  const TINTED = [...CARD, `rgba(${tintRgb},${tintAlpha})`];

  test('the premise: this editor is the only thing that renders the banner', () => {
    // rejects: measuring one surface's ground for a component drawn on several.
    const mounts = ['components/QuestionSetEditor.jsx', 'components/QuestionsPanel.jsx',
      'components/QuestionSetsPanel.jsx', 'AdminPage.jsx', 'GameHostPage.jsx']
      .filter((f) => /<SetReviewBanner/.test(strip(read(...f.split('/')))));
    expect(mounts).toEqual(['components/QuestionSetEditor.jsx']);
    // and it is drawn by default, not behind an opt-in the console leaves off
    expect(strip(read('components', 'QuestionSetEditor.jsx'))).toMatch(/showVersions\s*=\s*true/);
  });

  test('the premise: the tint is the danger token, over this editor\'s card', () => {
    expect(tintRgb).toBe(parseHex(resolve('--danger')).join(','));
    expect(tintAlpha).toBeGreaterThan(0);
  });

  test('the premise: the paper red the html rule forces is unreadable here', () => {
    // 1.73:1. rejects: the whole fix, if the ink ever stops being a problem.
    expect(on(PAPER_INK, TINTED)).toBeLessThan(AA);
  });

  test('the premise: the paper swap always matches, so only a scope can out-rank it', () => {
    // rejects: "the editor declares data-theme='dark', so the dusk branch
    // applies" — it does not. A descendant combinator does not care that a
    // nearer ancestor says something else, and there is no [data-theme="dark"]
    // .srev rule to win it back.
    expect(strip(read('..', 'public', 'index.html'))).toMatch(/<html[^>]*data-theme="light"/);
    expect(strip(SREV_CSS)).toMatch(/\[data-theme="light"\]\s+\.srev\s*\{[^}]*--srev-flag-ink\s*:/);
    expect(strip(SREV_CSS)).not.toMatch(/\[data-theme="dark"\]\s+\.srev\s*\{/);
    expect(beats(specificity('[data-theme="light"] .srev'), specificity('.srev'))).toBe(true);
  });

  test('the editor re-points the flagged ink with a selector that out-ranks it', () => {
    // rejects: a same-specificity `.qs-editor .srev`, which is 0,2,0 and ties —
    // and a tie is settled by import order between two component sheets, which
    // is not a contract anyone should be relying on.
    const rule = strip(EDITOR_CSS).match(/([^{}]*\.srev[^{}]*)\{([^}]*--srev-flag-ink[^}]*)\}/);
    expect(rule).not.toBeNull();
    expect(beats(specificity(rule[1].trim()), specificity('[data-theme="light"] .srev'))).toBe(true);
    expect(rule[2]).toMatch(/--srev-flag-ink:\s*var\(--danger-text\)/);
  });

  test.each([
    ['a flagged question\'s title, on the tinted banner', () => TINTED],
    ['the "high" band word in the waiting state, where the banner is transparent', () => CARD],
  ])('the flagged ink clears AA for %s', (_label, layers) => {
    // Two grounds because `.srev--waiting` sets `background: transparent` and
    // still renders the measurement block, band word and all.
    expect(on(resolve('--danger-text'), layers())).toBeGreaterThanOrEqual(AA);
  });
});

/*
 * THE GLYPHS, WHICH ARE PAINTED FROM THE MARKUP AND NOT FROM A STYLESHEET.
 * components/Icon.jsx takes `color` as a prop, so a colour handed to a glyph
 * escapes every rule the sheets above are audited by — a hex in JSX follows a
 * theme no better than a hex in CSS, and it is not caught by the stray-literal
 * tests because it is not in a stylesheet at all.
 */
describe('the glyphs these surfaces hand a colour to', () => {
  /* The editor's own markup. SetReviewBanner.jsx is deliberately not here: it
     paints from --srev-flag-ink, a token of its own, measured above. */
  const JSX = ['components/QuestionSetEditor.jsx', 'components/QuestionsPanel.jsx',
    'components/QuestionPullDialog.jsx', 'components/QuestionPreview.jsx'];
  const inks = JSX.flatMap((f) => [...strip(read(...f.split('/')))
    .matchAll(/<Icon[^>]*?\scolor="([^"]*)"/g)].map((m) => [f, m[1]]));

  test('the premise: these surfaces really do paint glyphs from the markup', () => {
    expect(inks.length).toBeGreaterThan(10);
  });

  test('none of them is handed a raw colour', () => {
    // rejects: #8a5300 — the deep paper amber-brown — which three Warning
    // glyphs carried across the conversion untouched: the unsaved bar, the
    // discard-this-edit box and the pull dialog's artwork caveat, at 2.36:1,
    // 1.95:1 and 2.30:1 on the dusk grounds they landed on. The same defect as
    // the review banner's ink and the same cause: an ink that was right on
    // paper, never re-measured when the paper went away.
    expect(inks.filter(([, ink]) => /#[0-9A-Fa-f]{3,8}|^rgba?\(/.test(ink))).toEqual([]);
  });

  test.each([
    ['the card', () => CARD],
    ['a panel', () => PANEL],
    ['a question row', () => ROW],
    ['a dialog', () => DIALOG],
    ['the unsaved bar and the discard box, which tint their ground', () => [...PANEL, T.tintWarn]],
    ['the same two inside a dialog', () => [...DIALOG, T.tintWarn]],
  ])('every token a glyph is handed survives on %s', (_label, layers) => {
    // A glyph is a non-text graphic: 3:1, not 4.5. Every ground the editor
    // paints, because a glyph moves between them and the markup carries no
    // record of which one it is standing on.
    const tokens = [...new Set(inks.map(([, ink]) => ink))]
      .filter((ink) => ink !== 'currentColor')
      .map((ink) => ink.match(/^var\((--[\w-]+)\)$/));
    expect(tokens.filter((m) => m === null)).toEqual([]);     // no bare keyword either
    expect(tokens.length).toBeGreaterThan(0);                 // the premise
    for (const [, name] of tokens) expect(on(resolve(name), layers())).toBeGreaterThanOrEqual(3);
  });
});

describe('the sheets that paint this surface carry no stray literal', () => {
  /* `white` but not `white-space`, which is a wrapping mode and not a colour —
     that false positive is why this pattern is named rather than inlined. */
  const LITERAL = /#[0-9A-Fa-f]{3,8}\b|rgba?\(|\bwhite(?![-\w])|\bblack(?![-\w])/;

  /** Colour literals outside the custom-property declarations of `css`. */
  const strays = (css, ...allowedBlocks) => {
    let body = strip(css);
    for (const head of allowedBlocks) {
      const start = body.indexOf(head);
      if (start < 0) throw new Error(`no "${head}" block to exclude`);
      body = body.slice(0, start) + body.slice(body.indexOf('}', start));
    }
    return body
      .split(/[;\n]/)
      .map((line) => line.trim())
      .filter((line) => LITERAL.test(line));
  };

  test('the editor sheet keeps every raw value in its one token block', () => {
    expect(strays(EDITOR_CSS, '.qs-editor {')).toEqual([]);
  });

  test('the `.qs-*` rules in styles.css are tokens only', () => {
    // Forty-odd paper literals used to live here — #FFFFFF rows, #F1EDE4
    // panels, #5E6167 copy, the #8a5300 amber. A hardcoded hex does not follow
    // a theme, which is why flipping one flag was never going to be enough.
    const text = strip(GLOBAL_CSS);
    const start = text.indexOf('.qs-editor .qs-panel {');
    const end = text.indexOf('.setup-section {', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const block = text.slice(start, end);
    const literals = block
      .split(/[;\n]/)
      .map((line) => line.trim())
      .filter((line) => LITERAL.test(line))
      .filter((line) => !/^--[\w-]+\s*:/.test(line));
    expect(literals).toEqual([]);
  });

  test('the category combobox is tokens only', () => {
    // It is the editor's own control (QuestionsPanel is its only caller) and it
    // shipped with thirty-one paper literals lifted from the `.qs-*` block.
    expect(strays(CAT_CSS)).toEqual([]);
  });

  test('--danger never carries text on this surface', () => {
    expect(ratio(parseHex(T.danger), parseHex(T.surface))).toBeLessThan(AA);   // the premise
    for (const css of [EDITOR_CSS, CAT_CSS]) {
      expect(strip(css).split('\n').filter((l) => /(^|[^-])\bcolor\s*:\s*var\(--danger\)/.test(l))).toEqual([]);
    }
  });

  test('every custom property these sheets use is declared somewhere', () => {
    // An undefined custom property invalidates the WHOLE declaration.
    const declared = new Set();
    for (const css of [GLOBAL_CSS, EDITOR_CSS, CAT_CSS, QSETS_CSS, read('components', 'AdminShell.css')]) {
      for (const m of css.matchAll(/(--[a-z0-9-]+)\s*:/gi)) declared.add(m[1]);
    }
    for (const css of [EDITOR_CSS, CAT_CSS]) {
      const used = [...css.matchAll(/var\((--[a-z0-9-]+)/gi)].map((m) => m[1]);
      expect([...new Set(used)].filter((name) => !declared.has(name))).toEqual([]);
    }
  });
});

describe('the ladder', () => {
  test.each([['floor', 12], ['label', 13], ['body', 15], ['head', 19]])(
    '--qs-t-%s is %spx', (step, px) => {
      expect(EDITOR_CSS).toMatch(new RegExp(`--qs-t-${step}:\\s*${px}px`));
    },
  );

  test('nothing on this surface is declared below the 12px floor', () => {
    const sizes = [];
    for (const css of [EDITOR_CSS, CAT_CSS]) {
      const text = strip(css);
      sizes.push(...[...text.matchAll(/font-size:\s*(\d+)px/g)].map((m) => Number(m[1])));
      sizes.push(...[...text.matchAll(/font:\s*\d+\s+(\d+)px/g)].map((m) => Number(m[1])));
    }
    expect(sizes.filter((px) => px < 12)).toEqual([]);
  });
});
