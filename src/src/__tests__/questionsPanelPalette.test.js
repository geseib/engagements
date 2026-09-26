/**
 * A HELD CONTROL ON THE QUESTIONS TAB IS DRAWN HELD — `.qs-editor .qs-questions`.
 *
 * Named "Palette", never "Token": `.gitignore:35` is an unanchored `*token*`, so
 * a file named for tokens is invisible to git — it passes locally and never
 * reaches CI. Do not rename it.
 *
 * While a Save — or a replace from a CSV — is written and the set read back,
 * every control on this tab that changes the working copy is disabled, and its
 * title says why (QuestionsPanel.jsx, `workingCopyHeld`). But neither
 * `.btn-secondary` nor `.btn-danger` has a `:disabled` rule, in styles.css or in
 * the editor's dusk re-inking (components/QuestionSetEditor.css), and an author
 * colour outranks the browser's greyed text for a disabled button: a held Remove
 * was drawn exactly like a live one, and a held Edit filled amber under the
 * pointer, because `:hover` still matches a disabled button. A control that
 * does nothing must not look live, so the tab draws its own held state.
 *
 * THE RULE LIVES IN THE EDITOR'S SHEET. The editor is dusk on both of its mounts
 * and declares the theme on its own root (__tests__/questionSetEditorPalette
 * .test.js pins that), and QuestionSetEditor.jsx is the tab's only mount. The
 * held button is TRANSPARENT, as the live dusk secondary is, so its ink is
 * measured on every ground a held control is drawn over, composited.
 *
 * THE CHECKS ARE LIFTED, NOT REWRITTEN — `lin`, `lum` and `ratio` are copied out
 * of docs/design/admin-redesign/audit.html's <script>. NOTHING IS TYPED TWICE:
 * the held ink and every ground are read out of the sheets that paint them.
 *
 * jsdom has no layout engine and loads no stylesheet. Green here means the rule
 * exists, is scoped to this tab, outranks the hover and clears AA on each
 * ground — not how a browser draws it.
 */
const fs = require('fs');
const path = require('path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const GLOBAL_CSS = strip(read('styles.css'));
const EDITOR_CSS = strip(read('components', 'QuestionSetEditor.css'));

/* ---- colour: lifted verbatim from docs/design/admin-redesign/audit.html ---- */
function lin(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function lum(c) { return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]); }
function ratio(a, b) {
  const la = lum(a); const lb = lum(b);
  const h = Math.max(la, lb); const l = Math.min(la, lb);
  return (h + 0.05) / (l + 0.05);
}
const AA = 4.5;

/* ---- values, READ rather than retyped ------------------------------------ */

/** Every declaration of every rule whose selector list names `selector`, in sheet order. */
function declarationsFor(css, selector) {
  const out = [];
  const rule = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = rule.exec(css))) {
    if (!m[1].split(',').map((s) => s.trim()).includes(selector)) continue;
    for (const declaration of m[2].split(';')) {
      const at = declaration.indexOf(':');
      if (at > 0) out.push([declaration.slice(0, at).trim(), declaration.slice(at + 1).trim()]);
    }
  }
  return out;
}
/** What `selector` ends up with for `prop` — the later of two equal selectors wins, as it does in the cascade. */
function valueOf(css, selector, prop) {
  const hits = declarationsFor(css, selector).filter(([p]) => p === prop);
  return hits.length ? hits[hits.length - 1][1] : undefined;
}
/** Classes, attributes and pseudo-classes: all the selectors compared here carry. */
const specificity = (selector) => (selector.match(/\.[\w-]+|:(?!:)[\w-]+|\[[^\]]+\]/g) || []).length;

/** The declaration block that opens with `head`. */
function blockOf(css, head) {
  const start = css.indexOf(head);
  if (start < 0) throw new Error(`no "${head}" block`);
  return css.slice(start, css.indexOf('}', start));
}
/* The editor's own token block first: it restates what the host shelf re-points. */
const THEME = [blockOf(EDITOR_CSS, '.qs-editor {'), blockOf(GLOBAL_CSS, '[data-theme="dark"] {'), blockOf(GLOBAL_CSS, ':root {')];

/** `var(--x)` → [r, g, b, a], from the first block that declares `--x`. */
function resolve(value) {
  const name = (String(value || '').match(/^var\((--[\w-]+)\)$/) || [])[1];
  if (!name) throw new Error(`"${value}" is not a single token`);
  for (const block of THEME) {
    const hex = block.match(new RegExp(`${name}\\s*:\\s*#([0-9A-Fa-f]{6})`));
    if (hex) return [0, 2, 4].map((i) => parseInt(hex[1].substr(i, 2), 16)).concat(1);
    const rgba = block.match(new RegExp(`${name}\\s*:\\s*rgba\\(([^)]+)\\)`));
    if (rgba) return rgba[1].split(',').map(Number);
  }
  throw new Error(`${name} is declared by no block the editor can see`);
}
/** Source-over, bottom layer first. The bottom layer is opaque. */
const composite = (layers) => layers.reduce((under, [r, g, b, a]) =>
  [r, g, b].map((c, i) => c * a + under[i] * (1 - a)));

const ground = (css, selector) => resolve(valueOf(css, selector, 'background'));

/* Every ground a held control is drawn over. The held button paints none of its
   own, so each is the real stack beneath it, read from the rule that paints it.
   A changed or tombstoned row REPLACES the row's ground with its tint, so the
   tint lies over the panel, not over the row. */
const PANEL = [ground(GLOBAL_CSS, '.qs-editor .qs-panel')];
const GROUNDS = {
  'the panel (Add, Pull, the foot\'s Discard)': PANEL,
  'a question row (Edit, Remove, the arrows)': [...PANEL, ground(GLOBAL_CSS, '.qs-question-row')],
  'a changed row': [...PANEL, ground(GLOBAL_CSS, '.qs-question-row.changed')],
  'a tombstoned row (Restore)': [...PANEL, ground(GLOBAL_CSS, '.qs-question-row.removed')],
  'the unsaved bar (Discard changes)': [...PANEL, ground(GLOBAL_CSS, '.qs-dirty-bar')],
  'a dialog the tab opens': [ground(EDITOR_CSS, '.qs-editor .modal-content')],
};

const HELD_SECONDARY = '.qs-editor .qs-questions .btn-secondary:disabled';
const HELD_DANGER = '.qs-editor .qs-questions .btn-danger:disabled';

describe('a held control on the Questions tab is drawn held, not live', () => {
  test('the premise: the editor is the tab\'s only mount, so the editor\'s scope reaches every held control', () => {
    const mounts = fs.readdirSync(path.join(__dirname, '..', 'components'))
      .filter((f) => /\.jsx$/.test(f) && /<QuestionsPanel\b/.test(read('components', f)));
    expect(mounts).toEqual(['QuestionSetEditor.jsx']);
  });

  test.each([HELD_SECONDARY, HELD_DANGER])('%s has a rule of its own: muted ink, and a cursor that says no', (selector) => {
    // rejects: relying on the browser's greyed text, which the buttons' own
    // `color` outranks — the held control looked exactly like the live one.
    expect(valueOf(EDITOR_CSS, selector, 'color')).toBe('var(--muted)');
    expect(valueOf(EDITOR_CSS, selector, 'cursor')).toBe('not-allowed');
  });

  test('one file owns the held look: styles.css declares none', () => {
    // rejects: the paper-era copy left behind in styles.css, which loads AFTER
    // the component sheets and would repaint a held button --surface.
    expect(GLOBAL_CSS).not.toMatch(/\.qs-questions[^{]*:disabled/);
  });

  test.each([
    ['.btn-secondary:hover', GLOBAL_CSS],
    ['.qs-editor .btn-secondary:hover', EDITOR_CSS],
  ])('it outranks %s, which would paint a held Edit live, and restates everything that hover paints', (hover, css) => {
    // :hover still matches a disabled button, and both hovers fill it amber.
    // rejects: a held rule that loses to either — by specificity, not by source
    // order, which index.jsx reverses — or leaves one of its properties standing.
    const painted = declarationsFor(css, hover).map(([prop]) => prop);
    expect(painted.length).toBeGreaterThan(0);
    expect(specificity(HELD_SECONDARY)).toBeGreaterThan(specificity(hover));
    for (const prop of painted) expect(valueOf(EDITOR_CSS, HELD_SECONDARY, prop)).toBeDefined();
  });

  test('a held destructive button gives up its fill and keeps an outline, so it still reads as a button', () => {
    // `.btn-danger` draws no border (`border: none`). Emptied of its red fill
    // with nothing in its place, a held Remove would be grey words on a row.
    expect(specificity(HELD_DANGER)).toBeGreaterThan(specificity('.qs-editor .btn-danger'));
    expect(valueOf(EDITOR_CSS, HELD_DANGER, 'background')).toBe('transparent');
    expect(valueOf(EDITOR_CSS, HELD_DANGER, 'box-shadow')).toMatch(/inset/);
  });

  test.each(Object.entries(GROUNDS))('the held ink clears AA on %s', (_name, layers) => {
    // A held control's reason is on its title; its label still has to say
    // which control is held.
    for (const selector of [HELD_SECONDARY, HELD_DANGER]) {
      expect(valueOf(EDITOR_CSS, selector, 'background')).toBe('transparent');
      const ink = resolve(valueOf(EDITOR_CSS, selector, 'color')).slice(0, 3);
      expect(ratio(ink, composite(layers))).toBeGreaterThanOrEqual(AA);
    }
  });
});
