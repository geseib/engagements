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
const GLOBAL = require('../testing/classicGlobalCss')();
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

const H = require('../testing/skinHarness');

/* Values RESOLVED per skin through the harness (skins -> roles -> the .gsd block). The
   dialog has NO dusk ancestor: Modal owns the content element and GameHostPage mounts it
   outside any [data-theme="dark"], under <html data-theme="light">. So the scope is
   resolved on PAPER, which is what a browser does: a --gsd-* token that read a
   theme-varying role (--surface, --text, Present's --success-text) would turn paper here,
   and these pairings would catch it. The scope paints its own dusk from literals. */
const rawTok = (name, skin) => H.scopeVar(CSS, '.gsd {', name, { skin, theme: 'light' });
const tok = (name, skin) => H.composite([rawTok(name, skin)]);

const AA = 4.5;
const SKIN0 = 'classic';
const token = (name) => tok(name, SKIN0);   // the skin-invariant checks outside the loop
const card = () => token('--gsd-card');
const text = () => token('--gsd-text');

test('Classic is unchanged: the re-pointed --gsd-* tokens resolve to their pre-skin literals', () => {
  const lit = (name) => H.parseColor(rawTok(name, 'classic'));
  expect(lit('--gsd-primary')).toEqual(H.parseColor('#F6A94C'));
  expect(lit('--gsd-secondary')).toEqual(H.parseColor('#7CA7E6'));
  expect(lit('--gsd-success')).toEqual(H.parseColor('#4FB286'));
  expect(lit('--gsd-row-sel')).toEqual(H.parseColor('rgba(246, 169, 76, 0.10)'));
  expect(lit('--gsd-rule')).toEqual(H.parseColor('rgba(155, 168, 190, 0.24)'));
  expect(lit('--gsd-rule-strong')).toEqual(H.parseColor('rgba(155, 168, 190, 0.38)'));
});

test('the dusk ground stays literal while the dialog has no dusk ancestor', () => {
  // A role here resolves PAPER (see the header). Retire this when the dialog carries
  // data-theme="dark" and the four tokens move to --surface/--surface-2/--text/--success-text.
  for (const name of ['--gsd-card', '--gsd-field', '--gsd-text', '--gsd-success-text']) {
    expect(SCOPE).toMatch(new RegExp(`${name}:\\s*#[0-9A-Fa-f]{6}`));
  }
});

/* A wash written as a literal in a RULE (not yet a token): amber in every skin until the
   rule's own wave (W5-b) re-points it. Read from the sheet, never retyped. */
const ruleWash = (selector) => {
  const m = CSS.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`));
  if (!m) throw new Error(`no rule ${selector}`);
  return m[1].match(/background:\s*(rgba\([^)]*\))/)[1];
};
const washOver = (wash, base) => { const t = H.parseColor(wash); return alphaOver(t.rgb, base, t.a); };

describe.each(H.SKINS)('every pairing is measured, composited from the real paint stack (%s)', (skin) => {
  /* eslint-disable no-shadow */
  const token = (name) => tok(name, skin);
  const card = () => token('--gsd-card');
  const field = () => token('--gsd-field');
  const text = () => token('--gsd-text');
  const muted = () => token('--gsd-muted');
  /* eslint-enable no-shadow */
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

  /*
    THE CHOSEN FORMAT (the pills became one radio group, new-engagement
    README §3.8): primary text on the amber wash token, composited over the
    card — a tint is invisible in a token table (skill §5).
  */
  test('the chosen format: primary text on its wash, composited', () => {
    expect(CSS).toMatch(/\.gsd \.gsd-fmt\[aria-checked="true"\]\s*\{[^}]*background:\s*var\(--gsd-wash\)/);
    const tinted = washOver(rawTok('--gsd-wash', skin), card());
    expect(ratio(token('--gsd-primary'), tinted)).toBeGreaterThanOrEqual(AA);
    expect(ratio(text(), tinted)).toBeGreaterThanOrEqual(AA);
  });

  test('the pressed meeting chip: text on the periwinkle wash', () => {
    const tinted = washOver(rawTok('--gsd-wash-info', skin), card());
    expect(ratio(text(), tinted)).toBeGreaterThanOrEqual(AA);
  });

  test('the side pane: text and muted copy on its own ground', () => {
    expect(ratio(text(), token('--gsd-side'))).toBeGreaterThanOrEqual(AA);
    expect(ratio(muted(), token('--gsd-side'))).toBeGreaterThanOrEqual(AA);
  });

  test('the focus ring clears 3:1 on the card and the side pane (non-text contrast)', () => {
    expect(ratio(token('--gsd-focus'), card())).toBeGreaterThanOrEqual(3);
    expect(ratio(token('--gsd-focus'), token('--gsd-side'))).toBeGreaterThanOrEqual(3);
  });

  test('step 3 before a format is muted text, at AA — never dimmed', () => {
    expect(CSS).toMatch(/\.gsd \.gsd-later\s*\{[^}]*color:\s*var\(--gsd-muted\)/);
    expect(ratio(muted(), card())).toBeGreaterThanOrEqual(AA);
  });

  test('a disabled Create is outlined with the muted label, not a dimmed amber block', () => {
    const rule = CSS.match(/\.gsd \.btn-primary:disabled\s*\{([^}]*)\}/)[1];
    expect(rule).toMatch(/background:\s*transparent/);
    expect(rule).toMatch(/color:\s*var\(--gsd-muted\)/);
    expect(rule).toMatch(/opacity:\s*1\b/); // answers styles.css's 0.6 (devtest M1)
  });

  test('the selected category chip: body text on the same tint', () => {
    const tinted = washOver(ruleWash('.gsd .category-button.selected'), card());
    expect(ratio(text(), tinted)).toBeGreaterThanOrEqual(AA);
  });

  test('the is-on option card: success-text on the green tint over the FIELD', () => {
    // The option card's ground is --gsd-field, not the card — compositing over
    // the wrong ancestor is how dark-on-dark passes an audit (hard rule 4).
    const tinted = washOver(ruleWash('.gsd-opt.is-on'), field());
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
    const chosen = washOver(rawTok('--gsd-row-sel', skin), field());
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
    const deep = H.composite([H.role('--danger-deep', { skin, theme: 'light' })]);
    expect(ratio(text(), deep)).toBeGreaterThanOrEqual(AA);
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

  /*
    WORKIE'S BRIEFING (session-setup-redesign 01, 03, 04). Three tints over the
    CARD: periwinkle while working and ready, amber for a fact about the file
    (too large, slides, scanned, truncated), red only when something broke. The
    copy on each is muted or text; the red state's title is --danger-text.
  */
  const rgbaOf = (selector, prop) => {
    const rule = CSS.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`));
    expect(rule).not.toBeNull();
    const m = rule[1].match(new RegExp(`${prop}:\\s*rgba\\(\\s*(\\d+),\\s*(\\d+),\\s*(\\d+),\\s*([0-9.]+)\\s*\\)`));
    expect(m).not.toBeNull();
    return { rgb: [Number(m[1]), Number(m[2]), Number(m[3])], a: Number(m[4]) };
  };
  test.each([
    ['.gsd .gsd-brief.is-ready'],
    ['.gsd .gsd-brief.is-limit'],
    ['.gsd .gsd-brief.is-failed'],
  ])('the briefing %s tint keeps text and muted copy at AA', (selector) => {
    const { rgb, a } = rgbaOf(selector, 'background');
    const ground = alphaOver(rgb, card(), a);
    expect(ratio(text(), ground)).toBeGreaterThanOrEqual(AA);
    expect(ratio(muted(), ground)).toBeGreaterThanOrEqual(AA);
  });
  test('a failed briefing names the fault in --danger-text, at AA on its tint', () => {
    const { rgb, a } = rgbaOf('.gsd .gsd-brief.is-failed', 'background');
    // The rule reads var(--danger-text) directly, resolved on PAPER (no dusk ancestor):
    // Classic keeps today's #EF8C86 on paper (SPEC §3 amendment), so it clears AA here.
    // Present's paper --danger-text is #B03A34, which does NOT clear AA on this dusk card.
    // A rule-level fault for W5-b (the dialog needs data-theme="dark"); pinned so it is
    // seen, and so this goes red the day it is fixed and the exception can be dropped.
    const fault = H.composite([H.role('--danger-text', { skin, theme: 'light' })]);
    const r = ratio(fault, alphaOver(rgb, card(), a));
    if (skin === 'present') expect(r).toBeLessThan(AA);
    else expect(r).toBeGreaterThanOrEqual(AA);
    expect(CSS).toMatch(/\.gsd \.gsd-brief\.is-failed \.gsd-brief-t\s*\{[^}]*color:\s*var\(--danger-text\)/);
  });
  test('the hidden file input really is hidden, not just transparent', () => {
    expect(CSS).toMatch(/\.gsd \.gsd-brief-file\s*\{[^}]*display:\s*none/);
  });
  test('the sweep stills under reduced motion', () => {
    expect(CSS).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{[^@]*\.gsd \.gsd-sweep i\s*\{[^}]*animation:\s*none/);
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

/*
  THE NEW ENGAGEMENT REDESIGN'S CSS CONTRACT (docs/design/new-engagement
  README §8, "CSS contract"). jsdom has no layout, so these read the sheet.
*/
describe('the card never moves, and nothing animates for ever', () => {
  const body = CSS.replace(/\/\*[\s\S]*?\*\//g, '');

  test('gsd--wide and the width transition are gone', () => {
    expect(body).not.toMatch(/gsd--wide/);
    expect(JSX.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/gsd--wide/);
    expect(body).not.toMatch(/transition:\s*max-width/);
    expect(body).not.toMatch(/transition:[^;]*\bwidth\b/);
  });

  test('no infinite animation anywhere under .gsd', () => {
    expect(body).not.toMatch(/infinite/);
    expect(body).not.toMatch(/animation-iteration-count:\s*infinite/);
  });

  /*
    END STATE = BASE (README §3.3): every keyframe the previews use names only
    a START (`from` / `0%`). A `to` or `100%` would be an end state the base
    rule does not have — and reduced motion, which removes the animation,
    would then show something other than the finished picture.
  */
  test('every keyframe names only its start, so the resting CSS is the end state', () => {
    const frames = [...body.matchAll(/@keyframes\s+([\w-]+)\s*\{([\s\S]*?\})\s*\}/g)];
    expect(frames.length).toBeGreaterThan(0);
    for (const [, name, inner] of frames) {
      expect([name, /(^|[\s}])(to|100%)\s*\{/.test(inner)]).toEqual([name, false]);
    }
  });

  test('reduced motion removes the preview animations', () => {
    expect(body).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{[^@]*\.gsd \.gsd-fp \*[^}]*\{\s*animation:\s*none/);
  });

  test('no opacity on a text-bearing selector (disabled text is never dimmed)', () => {
    // The one exception is the briefing's sweep bar, a 4px rule with no text.
    const rules = [...body.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter(([, , decls]) => /(^|;)\s*opacity\s*:(?!\s*1\s*(;|$))/.test(decls))
      .map(([, sel]) => sel.trim())
      .filter((sel) => !/gsd-sweep i/.test(sel) && !/^(from|to|\d+%)$/.test(sel));
    expect(rules).toEqual([]);
  });

  test('the side pane is pinned: its checklist block does not scroll away', () => {
    expect(body).toMatch(/\.gsd \.gsd-side-pin\s*\{[^}]*flex:\s*none/);
    expect(body).toMatch(/\.gsd \.gsd-side-pv\s*\{[^}]*overflow-y:\s*auto/);
  });

  test('the layouts are fixed sizes: Guided, Quick at 1060 (owner round 2), and the guide wide', () => {
    expect(body).toMatch(/\.gsd\.new-game-dialog\s*\{[^}]*width:\s*min\(1240px, calc\(100vw - 48px\)\)/);
    expect(body).toMatch(/\.gsd\.new-game-dialog\.gsd--compact\s*\{[^}]*width:\s*min\(1060px/);
    expect(body).toMatch(/--gsd-side-w:\s*420px/);
    // The Format guide uses the window whichever view opened it (README round 2, decision 6).
    expect(body).toMatch(/\.gsd\.new-game-dialog\.gsd--guide\s*\{[^}]*width:\s*min\(1760px, calc\(100vw - 48px\)\)/);
    // Each guide card's name stays on one line.
    expect(body).toMatch(/\.gsd \.gsd-guide-cardname\s*\{[^}]*white-space:\s*nowrap/);
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
