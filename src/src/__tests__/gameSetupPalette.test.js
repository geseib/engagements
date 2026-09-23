/**
 * THE CREATE/EDIT DIALOG'S DUSK PALETTE — components/GameSetupDialog.css read
 * as text and composited, the questionSetsPalette technique.
 *
 * Named *Palette*, never *Token* — .gitignore's unanchored `*token*` makes a
 * file named for tokens invisible to git (skill §5): it passes locally and
 * never reaches CI.
 *
 * The conversion this pins: the dialog was HALF-redesigned — new furniture
 * (pills, option cards, preview) retinted onto the original white 500px card
 * with 2px-#e1e1e1 inputs, which is what the owner read as "a bit dated". The
 * whole scope is dusk now and lives in ONE file, because a scope split across
 * two files is exactly how half of it stayed paper for a year.
 */
const fs = require('fs');
const path = require('path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const CSS = read('components', 'GameSetupDialog.css');
const GLOBAL = read('styles.css');
const JSX = read('components', 'GameSetupDialog.jsx');

/* ---- colour math: lifted verbatim from hostQuestionSetsPalette.test.js ---- */
function lin(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function lum(c) { return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]); }
function ratio(a, b) {
  const la = lum(a); const lb = lum(b);
  const h = Math.max(la, lb); const l = Math.min(la, lb);
  return (h + 0.05) / (l + 0.05);
}
function alphaOver(fg, bg, a) { return fg.map((c, i) => c * a + bg[i] * (1 - a)); }
const parseHex = (h) => [1, 3, 5].map((i) => parseInt(h.substr(i, 2), 16));

const SCOPE = (() => {
  const start = CSS.indexOf('.gsd {');
  return CSS.slice(start, CSS.indexOf('}', start));
})();

function token(name) {
  const m = SCOPE.match(new RegExp(`${name}\\s*:\\s*(#[0-9A-Fa-f]{6})`));
  if (!m) throw new Error(`${name} is not declared on the scope`);
  return parseHex(m[1]);
}

const AA = 4.5;
const card = () => token('--gsd-card');
const field = () => token('--gsd-field');
const text = () => token('--gsd-text');
const muted = () => token('--gsd-muted');

describe('every pairing is measured, composited from the real paint stack', () => {
  test('body copy clears AA on the card', () => {
    expect(ratio(text(), card())).toBeGreaterThanOrEqual(AA);
  });

  test('muted copy clears AA on the card AND on the field surface', () => {
    // Labels sit on the card; help text sits under inputs; option-card copy
    // sits on --gsd-field. Muted must survive both grounds or a caption is
    // legible in one place and not another.
    expect(ratio(muted(), card())).toBeGreaterThanOrEqual(AA);
    expect(ratio(muted(), field())).toBeGreaterThanOrEqual(AA);
  });

  test('input text clears AA on the field surface', () => {
    expect(ratio(text(), field())).toBeGreaterThanOrEqual(AA);
  });

  test('the active pill: primary text on its own tint, composited', () => {
    // A tint is invisible in a token table (skill §5) — composite the 12%
    // amber wash over the card before measuring the amber text on it.
    const tinted = alphaOver(token('--gsd-primary'), card(), 0.12);
    expect(ratio(token('--gsd-primary'), tinted)).toBeGreaterThanOrEqual(AA);
  });

  test('the selected category chip: body text on the same tint', () => {
    const tinted = alphaOver(token('--gsd-primary'), card(), 0.12);
    expect(ratio(text(), tinted)).toBeGreaterThanOrEqual(AA);
  });

  test('the is-on option card: success-text on the green tint over the FIELD', () => {
    // The option card's ground is --gsd-field, not the card — compositing over
    // the wrong ancestor is how dark-on-dark passes an audit (hard rule 4).
    const tinted = alphaOver(token('--gsd-success'), field(), 0.10);
    expect(ratio(token('--gsd-success-text'), tinted)).toBeGreaterThanOrEqual(AA);
    expect(ratio(text(), tinted)).toBeGreaterThanOrEqual(AA);
    expect(ratio(muted(), tinted)).toBeGreaterThanOrEqual(AA);
  });

  /*
    A SURVEY'S NAMES CARD (07-start-survey). The card is the option-card
    field; each of the three choices is a --gsd-card button on it, and the
    CHOSEN one swaps its background for an amber wash — so the wash sits on the
    FIELD, not the card, and that is the stack measured. The hostLine under
    each label is muted, the pairing the wash endangers.
  */
  test('the Names card: the chosen option\'s words on its amber wash over the field', () => {
    const m = SCOPE.match(/--gsd-row-sel:\s*rgba\(\s*246,\s*169,\s*76,\s*([0-9.]+)\s*\)/);
    expect(m).not.toBeNull();
    const chosen = alphaOver(token('--gsd-primary'), field(), Number(m[1]));
    expect(ratio(text(), chosen)).toBeGreaterThanOrEqual(AA);
    expect(ratio(muted(), chosen)).toBeGreaterThanOrEqual(AA);
    // The unchosen options sit on the card.
    expect(ratio(muted(), card())).toBeGreaterThanOrEqual(AA);
    // …and the selector that paints the wash is the checked radio.
    expect(CSS).toMatch(/\.gsd-three-opt\[aria-checked="true"\]\s*\{[^}]*background:\s*var\(--gsd-row-sel\)/);
  });

  /*
    THE ADVANCED LINE (session-setup-redesign 01/02). A changed value is named
    in amber on the card — the one place amber carries running words here.
  */
  test('the Advanced line: the changed words are amber on the card, the rest muted', () => {
    expect(CSS).toMatch(/\.gsd \.gsd-adv-s b\s*\{[^}]*color:\s*var\(--gsd-primary\)/);
    expect(ratio(token('--gsd-primary'), card())).toBeGreaterThanOrEqual(AA);
    expect(CSS).toMatch(/\.gsd \.gsd-adv-s\s*\{[^}]*color:\s*var\(--gsd-muted\)/);
  });

  /*
    THE DISCARD QUESTION, inline in the foot. Its own dark ground, declared as
    a scope token; the Discard button is the filled deep danger, carrying the
    dialog's text colour (--danger never carries text — skill §1).
  */
  test('the confirm foot: text on its ground, and Discard\'s words on deep danger', () => {
    expect(ratio(text(), token('--gsd-confirm'))).toBeGreaterThanOrEqual(AA);
    expect(ratio(muted(), token('--gsd-confirm'))).toBeGreaterThanOrEqual(AA);
    const deep = GLOBAL.match(/--danger-deep:\s*(#[0-9A-Fa-f]{6})/);
    expect(deep).not.toBeNull();
    expect(ratio(text(), parseHex(deep[1]))).toBeGreaterThanOrEqual(AA);
    expect(CSS).toMatch(/\.gsd \.dialog-actions\.is-confirm\s*\{[^}]*background:\s*var\(--gsd-confirm\)/);
    expect(CSS).toMatch(/\.gsd \.gsd-discard\s*\{[^}]*background:\s*var\(--danger-deep\)[^}]*color:\s*var\(--gsd-text\)/s);
    expect(CSS).not.toMatch(/color:\s*var\(--danger\)/);
  });

  /*
    FOUND BY RENDERING THE TWO SHEETS TOGETHER (session-setup-redesign
    RATIONALE §a): styles.css colours `.category-name` #333 directly, which
    beats the colour the chip hands down, so an UNSELECTED name read 1.15:1 on
    the card. The selected one is white by another styles.css rule, which is
    why a test of the selected chip passed.
  */
  test('an unselected category name takes the chip\'s text colour, not styles.css\'s #333', () => {
    expect(GLOBAL).toMatch(/\.category-name\s*\{[^}]*color:\s*#333/);
    expect(CSS).toMatch(/\.gsd \.category-button \.category-name\s*\{[^}]*color:\s*inherit/);
    const chip = CSS.match(/\.gsd \.category-button\s*\{[^}]*color:\s*var\((--gsd-[a-z-]+)\)/);
    expect(chip[1]).toBe('--gsd-text');
    expect(ratio(text(), card())).toBeGreaterThanOrEqual(AA);
  });

  test('the filled primary button carries DARK text, never white', () => {
    // #F6A94C under white is 1.9:1 in either theme. The dark navy clears 7:1.
    const m = CSS.match(/\.gsd \.btn-primary \{[^}]*color:\s*(#[0-9A-Fa-f]{6})/);
    expect(m).not.toBeNull();
    expect(ratio(parseHex(m[1]), token('--gsd-primary'))).toBeGreaterThanOrEqual(AA);
  });
});

/*
  BOTH EXITS STAY ON SCREEN (hard rule 2 is about exits you can SEE). The card
  is the scroll container (styles.css .new-game-dialog: max-height 90vh,
  overflow-y auto), so an absolute X scrolled away with the title and Cancel
  sat below the last field. The head and foot stick, on an OPAQUE ground — a
  transparent sticky bar lets the fields scroll visibly through it.
*/
describe('the head and foot stick', () => {
  test('the head sticks to the top on the card colour', () => {
    expect(CSS).toMatch(/\.gsd \.gsd-head\s*\{[^}]*position:\s*sticky[^}]*top:\s*0[^}]*background:\s*var\(--gsd-card\)/s);
    expect(JSX).toMatch(/<div className="gsd-head">[\s\S]*?className="gsd-close"/);
  });

  test('the foot sticks to the bottom on the card colour', () => {
    expect(CSS).toMatch(/\.gsd \.dialog-actions\s*\{[^}]*position:\s*sticky[^}]*bottom:\s*0[^}]*background:\s*var\(--gsd-card\)/s);
  });

  test('the Advanced summary drops the browser marker and keeps a visible focus ring', () => {
    expect(CSS).toMatch(/\.gsd \.gsd-adv > summary::-webkit-details-marker\s*\{[^}]*display:\s*none/);
    expect(CSS).toMatch(/\.gsd \.gsd-adv > summary\s*\{[^}]*list-style:\s*none/);
    expect(CSS).toMatch(/\.gsd \.gsd-adv > summary:focus-visible\s*\{[^}]*outline:/);
  });
});

describe('the scope is whole, and it is the only scope', () => {
  test('styles.css declares nothing in .gsd — both halves of the rule', () => {
    // The failure mode this file exists to end: half the dialog styled in one
    // file, half in another, and the halves aging at different rates.
    const declarations = GLOBAL.match(/^\s*\.gsd[^{]*\{/gm) || [];
    expect(declarations).toEqual([]);
  });

  test('every selector in the sheet is rooted at the scope', () => {
    const selectors = [...CSS.matchAll(/^\s*(\.[^{}\n]+?)\s*\{/gm)]
      .map((m) => m[1].trim())
      .filter((sel) => !sel.startsWith('@'));
    for (const sel of selectors) {
      expect(sel.startsWith('.gsd')).toBe(true);
    }
  });

  test('no raw hex outside the token block', () => {
    // One deliberate exception: the filled button's dark text, which is a
    // colour ABOUT the amber fill, not about the theme — documented inline.
    // Comments are stripped first: the header quotes the old #e1e1e1 inputs
    // it is retiring, and prose is not paint.
    const body = CSS.slice(CSS.indexOf('}', CSS.indexOf('.gsd {')) + 1)
      .replace(/\/\*[\s\S]*?\*\//g, '');
    const hexes = body.match(/#[0-9A-Fa-f]{6}\b/g) || [];
    expect(hexes).toEqual(['#1B2942']);
  });

  test('every var() the sheet uses is declared on the scope', () => {
    const used = new Set([...CSS.matchAll(/var\((--gsd-[a-z-]+)/g)].map((m) => m[1]));
    for (const name of used) {
      expect(SCOPE.includes(`${name}:`)).toBe(true);
    }
  });

  test('the component actually imports the sheet', () => {
    // A stylesheet nobody imports styles nothing, and the dialog would render
    // as the bare white card the whole change exists to retire.
    expect(JSX).toMatch(/import '\.\/GameSetupDialog\.css'/);
  });
});

describe('the ladder', () => {
  test('the scope declares the laptop ladder, and fields render at body', () => {
    expect(SCOPE).toMatch(/--gsd-t-floor:\s*12px/);
    expect(SCOPE).toMatch(/--gsd-t-body:\s*15px/);
    // Inputs at body, never label — the RATIONALE §3.2 failure is a 13px input
    // producing 15px table text where a mistake is most expensive.
    const fieldRule = CSS.match(/\.gsd \.dialog-input,[^{]*\{[^}]*/s);
    expect(fieldRule[0]).toMatch(/font-size:\s*var\(--gsd-t-body\)/);
  });

  test('nothing below the floor — the old glance-only dispensations are retired', () => {
    /*
      Three captions used to sit under it (.gsd-opt-state at 11px, .gsd-pv h6
      at 10.5px, .gsd-pv-who at 11px) on a dispensation inherited from the
      paper design. The survey start dialog raised its own to the floor, and
      session-setup-redesign raises these: one dialog family, one floor.
    */
    const sizes = [...CSS.matchAll(/font-size:\s*([\d.]+)px/g)].map((m) => Number(m[1]));
    expect(sizes.filter((px) => px < 12)).toEqual([]);
  });
});
