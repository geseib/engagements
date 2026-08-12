/**
 * THE LIGHT SCOPE — `.qsets--onlight`, the host's question-set dialog.
 *
 * Beside questionSetsPalette.test.js, and named "Palette" for the same reason it
 * gives: `.gitignore:35` is `*token*`, so a file named for tokens is invisible
 * to git — it would pass locally and never reach CI. Do not rename it back.
 *
 * WHY A SECOND PALETTE FILE. The admin console's Question Sets tab is measured
 * against `--bg` #0F1A2E. The host reaches the same components from the
 * create-engagement screen, which is `.new-game-dialog` — `background: white`
 * (styles.css). Those are opposite polarities, and questionSetsPalette's own
 * header records what happens when one is rendered inside the other: the tab
 * shipped as paper markup inside a dusk shell at 1.4:1. `.qsets--onlight`
 * re-points the tokens so the shared components come out readable on the card;
 * this file is the measurement that stops that block being decorative.
 *
 * THE CHECKS ARE LIFTED, NOT REWRITTEN — `rgb`, `lin`, `lum`, `ratio` and
 * `alphaOver` are copied out of the `<script>` block in
 * docs/design/admin-redesign/audit.html (there is no `audit.js`), which is where
 * questionSetsPalette took them from too.
 *
 * NOTHING IS TYPED TWICE. Every value below is READ out of
 * QuestionSetsPanel.css, so changing a token moves these numbers rather than
 * leaving a stale assertion passing.
 */
const fs = require('fs');
const path = require('path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const QS_CSS = read('components', 'QuestionSetsPanel.css');
const GLOBAL_CSS = read('styles.css');

/* ---- colour: lifted verbatim from docs/design/admin-redesign/audit.html ---- */
function lin(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function lum(c) { return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]); }
function ratio(a, b) {
  const la = lum(a); const lb = lum(b);
  const h = Math.max(la, lb); const l = Math.min(la, lb);
  return (h + 0.05) / (l + 0.05);
}
function alphaOver(fg, bg, a) { return fg.map((c, i) => c * a + bg[i] * (1 - a)); }

const parseHex = (h) => [1, 3, 5].map((i) => parseInt(h.substr(i, 2), 16));

/** The light scope's declaration block, read out of the stylesheet. */
const SCOPE = (() => {
  const start = QS_CSS.indexOf('.qsets.qsets--onlight,');
  if (start < 0) throw new Error('.qsets--onlight block not found — the host dialog has no theme');
  return QS_CSS.slice(start, QS_CSS.indexOf('}', start));
})();

function token(name) {
  const m = SCOPE.match(new RegExp(`${name}\\s*:\\s*(#[0-9A-Fa-f]{6})`));
  if (!m) throw new Error(`${name} is not declared in the light scope`);
  return parseHex(m[1]);
}
function tint(name) {
  const m = SCOPE.match(new RegExp(`${name}\\s*:\\s*rgba\\(\\s*([\\d.]+)[,\\s]+([\\d.]+)[,\\s]+([\\d.]+)[,\\s/]+([\\d.]+)\\s*\\)`));
  if (!m) throw new Error(`${name} is not declared as an rgba in the light scope`);
  return { rgb: [Number(m[1]), Number(m[2]), Number(m[3])], a: Number(m[4]) };
}

const L = {
  bg: token('--bg'),
  surface: token('--surface'),
  surface2: token('--surface-2'),
  text: token('--text'),
  muted: token('--muted'),
  primary: token('--primary'),
  dangerText: token('--danger-text'),
  dangerDeep: token('--danger-deep'),
  successText: token('--qsets-success-text'),
};

const AA = 4.5;
/** Text on a tint that sits on the card. */
const onTint = (fg, layer) => ratio(fg, alphaOver(layer.rgb, L.surface, layer.a));

describe('the host dialog is readable on the white create-engagement card', () => {
  test('the card really is a light surface, not the dusk one copied over', () => {
    // rejects: pasting the dusk block under a new class name and changing
    // nothing, which would leave every pairing below measured against #0F1A2E
    // while the DOM paints white.
    expect(lum(L.surface)).toBeGreaterThan(0.7);
    // The screen this sits on. rejects: the create dialog ceasing to be white
    // without this scope following it — the pairings below would all be wrong
    // and every one of them would still pass.
    expect(GLOBAL_CSS).toMatch(/\.new-game-dialog\s*\{[^}]*background:\s*white/);
  });

  test('body copy clears AA on the card', () => {
    // rejects: leaving --text as the dusk #F4EDE4, which is 1.1:1 on white —
    // the exact failure, polarity flipped, that questionSetsPalette exists for.
    expect(ratio(L.text, L.surface)).toBeGreaterThanOrEqual(AA);
  });

  test('metadata and secondary copy clear AA', () => {
    // Set descriptions, counts, the "N other sets" sentence, every help line.
    // rejects: --muted kept at the dusk #9BA8BE (1.9:1 on white).
    expect(ratio(L.muted, L.surface)).toBeGreaterThanOrEqual(AA);
    expect(ratio(L.muted, L.surface2)).toBeGreaterThanOrEqual(AA);
  });

  test('--primary carries text BOTH ways round', () => {
    // It is a text colour at three places in this stylesheet (--btn--link, the
    // warn chip, the skipped-tier heading) AND the filled button's background,
    // with `color: var(--bg)` on the label. One token, two jobs, so both are
    // measured. rejects: copying #F6A94C into the light scope, which is 1.9:1
    // as text on white and would make "New question set" unreadable.
    expect(ratio(L.primary, L.surface)).toBeGreaterThanOrEqual(AA);
    expect(ratio(L.bg, L.primary)).toBeGreaterThanOrEqual(AA);
  });

  test('destructive copy clears AA, including on its own tint', () => {
    // Delete is the control that most needs reading carefully, and it renders
    // on --qsets-tint-danger inside the confirm dialog.
    // rejects: keeping the dusk --danger-text #EF8C86 (2.4:1 on white).
    expect(ratio(L.dangerText, L.surface)).toBeGreaterThanOrEqual(AA);
    expect(onTint(L.dangerText, tint('--qsets-tint-danger'))).toBeGreaterThanOrEqual(AA);
  });

  test('the filled destructive button carries its label', () => {
    // `.qsets-btn--dangersolid` is `background: var(--danger-deep); color: var(--text)`
    // in the dusk palette — but --text is now near-black, so the light scope's
    // label is the CARD colour. rejects: a filled red button whose label
    // disappears into it.
    expect(ratio(L.bg, L.dangerDeep)).toBeGreaterThanOrEqual(AA);
  });

  test('the success text clears AA on the card and on its tint', () => {
    // rejects: the dusk #6FD0A4 surviving into the light scope (1.9:1 on white).
    expect(ratio(L.successText, L.surface)).toBeGreaterThanOrEqual(AA);
    expect(onTint(L.successText, tint('--qsets-tint-ok'))).toBeGreaterThanOrEqual(AA);
  });

  test('the warn chip clears AA on its tint', () => {
    expect(onTint(L.primary, tint('--qsets-tint-warn'))).toBeGreaterThanOrEqual(AA);
  });

  test('the rules are visible against the card without being borders of ink', () => {
    // A hairline that is invisible turns the table into a wall of text; one that
    // is black turns a dialog into a spreadsheet. rejects: reusing the dusk
    // rgba(155,168,190,.20), which on white is a 1.06:1 nothing.
    const rule = QS_CSS.slice(SCOPE.indexOf('--qsets-rule'));
    const m = SCOPE.match(/--qsets-rule\s*:\s*(#[0-9A-Fa-f]{6})/);
    expect(m).not.toBeNull();
    expect(rule).toBeTruthy();
    const r = ratio(parseHex(m[1]), L.surface);
    expect(r).toBeGreaterThan(1.1);
    expect(r).toBeLessThan(4.5);
  });
});

describe('the scope reaches the components nested inside it', () => {
  test('descendant `.qsets` roots are re-tinted too', () => {
    // QuestionSetUploadPanel and QuestionSetDeleteDialog each render their OWN
    // `.qsets` root inside the host dialog, and `.qsets` re-declares the
    // --qsets-* locals on itself. rejects: scoping the theme to the outer
    // element only, which leaves the dusk rules and tints under light text one
    // level down — the same failure, one component in.
    expect(QS_CSS).toMatch(/\.qsets--onlight\s+\.qsets\s*\{/);
  });

  test('the dialog sits ABOVE the screen that opens it', () => {
    // `.new-game-overlay` is z-index 10000 (styles.css) and `.qsets-scrim` is
    // 60, so without the lift the dialog renders BEHIND the create screen —
    // present in the DOM, invisible, every control unreachable. rejects:
    // dropping the modifier, or the create overlay's z-index moving past it.
    const overlay = GLOBAL_CSS.match(/\.new-game-overlay\s*\{[^}]*z-index:\s*(\d+)/);
    const over = QS_CSS.match(/\.qsets-scrim--over\s*\{[^}]*z-index:\s*(\d+)/);
    expect(overlay).not.toBeNull();
    expect(over).not.toBeNull();
    expect(Number(over[1])).toBeGreaterThan(Number(overlay[1]));
  });
});
