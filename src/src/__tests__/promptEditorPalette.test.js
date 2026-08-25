/**
 * THE PROMPT ADMIN SURFACE'S COLOURS, NOW THAT IT IS DUSK.
 *
 * Named "Palette" for the same reason as questionSetsPalette.test.js and
 * adminShellPalette.test.js: `.gitignore:35` is an unanchored `*token*`, so a
 * file named for tokens is invisible to git and would pass locally and never
 * reach CI. Do not rename it back.
 *
 * WHAT THIS FILE USED TO SAY, AND WHY IT SAYS THE OPPOSITE NOW.
 * It asserted that `AdminPage.jsx`'s prompts section carried NO `contentTheme`,
 * i.e. that this surface was still paper, and its comment named its own exit:
 * "If this test goes red because the section gained contentTheme:'dark', THAT
 * is the signal to convert these blocks, in the same change." That is the change
 * (AUDIT §6.2 items 11-15), so the assertion is inverted rather than deleted —
 * the pairing it protects is real in both directions. Dusk markup on the light
 * field is 1.2:1; the light `--pc-ink #1a1a1a` on the dusk field is 1.3:1.
 * Neither half may land alone, so both halves are asserted here.
 *
 * THE TOKENS ARE ALIASES NOW, WHICH CHANGED HOW THEY ARE READ.
 * `--pc-ink: var(--text)`, not a hex. So `token()` resolves one hop into
 * `styles.css`'s DUSK `:root` block — which also means this file fails if
 * somebody re-points a `--pc-*` at a token that does not exist, or at a paper
 * value.
 *
 * THE CHECKS ARE LIFTED, NOT REWRITTEN. `lin`, `lum`, `ratio`, `alphaOver` and
 * `bgOf` are copied out of the `<script>` block in
 * docs/design/admin-redesign/audit.html (it is `audit.html`, not `audit.js` —
 * there is no such file). `bgOf` is the one that matters: it walks UP from the
 * text node compositing every alpha layer it passes, because reading only the
 * element's own background is how a tinted panel passes an audit it should
 * fail. Every bed below except `--bg` and `--pc-card` is a tint.
 */
const fs = require('fs');
const path = require('path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const CSS = read('components', 'AIPromptManager.css');
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

/**
 * `styles.css`'s DUSK values, read out of `:root` — NOT out of
 * `[data-theme="light"]`, which declares the same five names as paper. The
 * slice is what makes the difference legible: matching `--text:` against the
 * whole file finds whichever copy comes first and would silently measure the
 * wrong theme.
 */
const DUSK_ROOT = (() => {
  // The opening brace is part of both needles on purpose: styles.css's HEADER
  // COMMENT names `:root` and `[data-theme="light"]` in prose four lines above
  // the rules, so matching the bare names finds the comment, ends the slice
  // before it starts, and every token below reads as "not declared".
  const start = GLOBAL_CSS.indexOf(':root {');
  const end = GLOBAL_CSS.indexOf('[data-theme="light"] {');
  if (start < 0 || end <= start) throw new Error('styles.css no longer opens with :root then the paper theme');
  return GLOBAL_CSS.slice(start, end);
})();
function globalToken(name) {
  const m = DUSK_ROOT.match(new RegExp(`${name}:\\s*(#[0-9A-Fa-f]{6})`));
  if (!m) throw new Error(`${name} is not declared in styles.css's dusk :root`);
  return m[1];
}

/** The `.padm, .pmgr, .pgen, .plib` rule — the ONE place `--pc-*` is declared. */
function tokenRuleBody() {
  const stripped = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [...stripped.matchAll(/(^|\})\s*([^{}@]+?)\s*\{([^}]*--pc-ink\s*:[^}]*)\}/gm)];
  expect(rules).toHaveLength(1);
  return rules[0][3];
}
const TOKEN_BLOCK = tokenRuleBody();

/**
 * Read a `--pc-*` out of the stylesheet and resolve it. A hex is taken as-is;
 * `var(--x)` is followed one hop into styles.css's dusk root. One hop is all
 * the mapping uses, and refusing a second is deliberate: a chain is a place for
 * a paper value to hide.
 */
function token(name) {
  const m = TOKEN_BLOCK.match(new RegExp(`${name}\\s*:\\s*([^;]+);`));
  if (!m) throw new Error(`${name} is not declared in AIPromptManager.css's token block`);
  const value = m[1].trim();
  if (/^#[0-9A-Fa-f]{6}$/.test(value)) return value;
  const alias = value.match(/^var\((--[a-z0-9-]+)\)$/i);
  if (!alias) throw new Error(`${name} is neither a hex nor a single var(): ${value}`);
  return globalToken(alias[1]);
}
function tint(name) {
  const m = TOKEN_BLOCK.match(new RegExp(`${name}\\s*:\\s*(rgba\\([^)]*\\))`));
  if (!m) throw new Error(`${name} is not declared in AIPromptManager.css's token block`);
  return m[1];
}

const T = {
  ink: token('--pc-ink'),
  muted: token('--pc-muted'),
  stop: token('--pc-stop'),
  silent: token('--pc-silent'),
  link: token('--pc-link'),
  go: token('--pc-go'),
  card: token('--pc-card'),
  field: token('--pc-field'),
};
const BG = globalToken('--bg');

/** Build the real paint stack and hand it to the audit's own bgOf. */
function composited(layers) {
  document.body.innerHTML = '';
  document.body.style.backgroundColor = BG;
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
/** The work field. `AdminShell.css:394` paints `.adm-work-body` `var(--bg)`. */
const FIELD = [];
/** A dialog, and the blocks inside one that used to be `background: white`. */
const CARD = [T.card];
/** A recessed panel: the variable rail, the wells, the empty states, hover. */
const PAPER_ON_FIELD = [tint('--pc-paper')];
const PAPER_ON_CARD = [T.card, tint('--pc-paper')];

describe('the token block maps onto the shipped dusk palette, not a private one', () => {
  test('every --pc-* colour is an alias of a styles.css token, or the one named exception', () => {
    /*
      rejects: AUDIT item 12 being done by eye — re-typing #F4EDE4 into this
      file instead of pointing at `--text`. A copied hex does not follow the
      palette when the palette moves, and there is no test anywhere that
      compares two stylesheets' literals.

      `--pc-go` is the exception and it is allowed BY NAME: styles.css has never
      declared a success TEXT token (RATIONALE §5 lists one that does not
      exist), so every dusk screen declares its own. A second exception has to
      be argued here.
    */
    const colours = [...TOKEN_BLOCK.matchAll(/(--pc-[a-z0-9-]+):\s*(#[0-9A-Fa-f]{3,8})/g)];
    expect(colours.map((m) => m[1])).toEqual(['--pc-go']);
  });

  test('and --pc-go is the exact green the sets screen already uses', () => {
    // rejects: a second green for one meaning. `.qsets-success-text` is the
    // token this surface's Active chip has to agree with, because the two
    // screens sit one nav item apart.
    const qsets = read('components', 'QuestionSetsPanel.css');
    const theirs = qsets.match(/--qsets-success-text:\s*(#[0-9A-Fa-f]{6})/)[1];
    expect(T.go.toLowerCase()).toBe(theirs.toLowerCase());
  });

  test('the aliases resolve to the DUSK values, not the paper ones', () => {
    /*
      rejects: the whole conversion being a no-op. `--text` is #1B2942 under
      `[data-theme="light"]` and #F4EDE4 under `:root`; if this test were
      reading the wrong block every ratio below would still pass, measured
      against the wrong theme entirely.
    */
    expect(T.ink.toLowerCase()).toBe('#f4ede4');
    expect(T.card.toLowerCase()).toBe('#1b2942');
    expect(BG.toLowerCase()).toBe('#0f1a2e');
  });
});

describe('the flat pairings this surface paints', () => {
  const pairs = [
    ['--pc-ink on the work field (the library, row values)', T.ink, FIELD],
    ['--pc-muted on the work field (counts, ledes, descriptions)', T.muted, FIELD],
    ['--pc-link on the work field (variable tokens, links)', T.link, FIELD],
    ['--pc-stop on the work field (Retire, the blocking tier)', T.stop, FIELD],
    ['--pc-silent on the work field (the silent tier, Default)', T.silent, FIELD],
    ['--pc-go on the work field (Active)', T.go, FIELD],

    ['--pc-ink in a dialog (findings, samples, preview text)', T.ink, CARD],
    ['--pc-muted in a dialog (notes, labels, ledes)', T.muted, CARD],
    ['--pc-link in a dialog (variable tokens, the room control)', T.link, CARD],
    ['--pc-stop in a dialog (the blocked-save note)', T.stop, CARD],
    ['--pc-silent in a dialog (the silent tier, the duplication figure)', T.silent, CARD],

    ['--pc-muted on the recessed rail, over the field', T.muted, PAPER_ON_FIELD],
    ['--pc-muted on the recessed rail, over a dialog', T.muted, PAPER_ON_CARD],
    ['--pc-ink on the recessed rail, over a dialog', T.ink, PAPER_ON_CARD],
    ['--pc-silent on the recessed rail, over a dialog (the unsafe count)', T.silent, PAPER_ON_CARD],
    ['--pc-link on the recessed rail, over a dialog', T.link, PAPER_ON_CARD],
  ];

  test.each(pairs)('%s clears AA', (_label, fg, layers) => {
    expect(on(fg, layers)).toBeGreaterThanOrEqual(AA);
  });

  test('a form control is legible in its own hole', () => {
    // rejects: `--pc-field` drifting off `--bg`. An input is one step DOWN from
    // its card here, and the text in it is --pc-ink; a field lightened towards
    // the card would take the placeholder (--pc-muted) with it.
    expect(on(T.ink, [T.card, T.field])).toBeGreaterThanOrEqual(AA);
    expect(on(T.muted, [T.card, T.field])).toBeGreaterThanOrEqual(AA);
  });
});

describe('the tinted composites, where a pairing quietly drops under AA', () => {
  /*
    A tint is invisible in a token table. Each stack below is the real nesting:
    the bed, then the tier's tint, then the text.
  */
  test('the blocking tier, in a dialog and on the field', () => {
    // rejects: deepening --pc-tint-stop until the red on it falls under AA —
    // the tier a person must read carefully is exactly the wrong one to tint
    // by eye.
    for (const bed of [CARD, FIELD]) {
      expect(on(T.stop, [...bed, tint('--pc-tint-stop')])).toBeGreaterThanOrEqual(AA);
      expect(on(T.ink, [...bed, tint('--pc-tint-stop')])).toBeGreaterThanOrEqual(AA);
      expect(on(T.muted, [...bed, tint('--pc-tint-stop')])).toBeGreaterThanOrEqual(AA);
    }
  });

  test('the silent tier, which is the loud one and therefore the most tinted', () => {
    for (const bed of [CARD, FIELD]) {
      expect(on(T.silent, [...bed, tint('--pc-tint-silent')])).toBeGreaterThanOrEqual(AA);
      expect(on(T.ink, [...bed, tint('--pc-tint-silent')])).toBeGreaterThanOrEqual(AA);
      expect(on(T.muted, [...bed, tint('--pc-tint-silent')])).toBeGreaterThanOrEqual(AA);
    }
  });

  test('an unsafe variable row, which is the silent tint on the recessed rail', () => {
    // rejects: measuring the tint against the field when it sits on the rail,
    // which sits on a dialog. Three composites of one tint, and only one of
    // them is on screen here.
    expect(on(T.silent, [...PAPER_ON_CARD, tint('--pc-tint-silent')])).toBeGreaterThanOrEqual(AA);
    expect(on(T.ink, [...PAPER_ON_CARD, tint('--pc-tint-silent')])).toBeGreaterThanOrEqual(AA);
    expect(on(T.muted, [...PAPER_ON_CARD, tint('--pc-tint-silent')])).toBeGreaterThanOrEqual(AA);
  });

  test('the Active chip and the type chip, which are two tints on two beds', () => {
    // rejects: the green tint being deepened until the green on it stops
    // clearing AA. Read as tokens because these two tints appear on both beds.
    expect(on(T.go, [...FIELD, tint('--pc-tint-go')])).toBeGreaterThanOrEqual(AA);
    expect(on(T.go, [...CARD, tint('--pc-tint-go')])).toBeGreaterThanOrEqual(AA);
    expect(on(T.link, [...CARD, tint('--pc-tint-link')])).toBeGreaterThanOrEqual(AA);
  });

  test('Active is the success hue, and the TYPE chip is not the same colour', () => {
    /*
      rejects: `.plib-chip--on` going back to `--pc-link`, which is what it
      shipped as — the same blue as `.plib-chip--type`, two cells to its left in
      every row. Two facts of different kinds painted identically is what the
      sets screen fixed by making Active the ONE green thing on the row
      (`.qsets-chip--on`).

      Read out of the SELECTORS, not the tokens: the ratios above pass whichever
      token the chip points at, so a hue swap is invisible to a contrast test.
    */
    const rule = (sel) => {
      const escaped = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const m = CSS.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
      if (!m) throw new Error(`no rule for ${sel} — renamed?`);
      return m[1];
    };
    expect(rule('.plib-chip--on')).toMatch(/color:\s*var\(--pc-go\)/);
    expect(rule('.plib-chip--on')).not.toMatch(/color:\s*var\(--pc-link\)/);
    expect(rule('.plib-chip--type')).not.toMatch(/var\(--pc-go\)/);
    // Archived is muted-on-muted, so it needs a second signal or it reads as a
    // chip that failed to load — the sets screen dashes its border for this.
    expect(rule('.plib-chip--off')).toMatch(/border-style:\s*dashed/);
  });

  test('a hovered row still carries every colour a resting one does', () => {
    // rejects: --pc-hover being deepened to make the hover more obvious. The
    // row's chips and its Retire action are the two things most likely to be
    // read WHILE the pointer is on the row.
    for (const fg of [T.ink, T.muted, T.stop, T.silent, T.go]) {
      expect(on(fg, [...FIELD, tint('--pc-hover')])).toBeGreaterThanOrEqual(AA);
    }
  });
});

describe('the surface is dusk, and the markup and the theme moved together', () => {
  test('AdminPage paints the prompts section dark', () => {
    /*
      rejects: this stylesheet converting while AdminPage leaves the section on
      the paper theme — #F4EDE4 body copy on #f5f7fa is 1.2:1, the same failure
      as #333 on #0F1A2E in the other direction. This is the inverse of the
      assertion this file used to make; see the header.
    */
    const page = read('AdminPage.jsx');
    const section = page.slice(page.indexOf("id: 'prompts'"), page.indexOf("id: 'archive'"));
    expect(section).toMatch(/contentTheme:\s*'dark'/);
  });

  test('and the light-theme card wrappers are gone from the prompts branch', () => {
    /*
      rejects: the flip landing while `.admin-section` (a white card) and
      `.tab-content` (a 500px min-height and a paper fade-in) still wrap the
      section — which is what the owner was actually looking at when they asked
      "why are these the only things that are on a light background". AUDIT
      §6.2 item 14. The slice is the prompts branch only: both classes are
      still legitimately used by the tabs that have not converted.
    */
    const page = read('AdminPage.jsx');
    /* `resolvedTab`, not `activeTab`: every section gate moved to the resolved
       value after the two were found wired to different renderers, which mounted
       two screens at once (see __tests__/adminOneSection.test.jsx). The slice
       markers had to move with them or this reads an empty string and passes
       for the wrong reason — it failed loudly instead, which is the better of
       the two outcomes. */
    const branch = page.slice(
      page.indexOf("resolvedTab === 'prompts'"),
      page.indexOf("resolvedTab === 'questionsets'")
    );
    expect(branch.length).toBeGreaterThan(200); // the slice really found the branch
    expect(branch).not.toMatch(/className="admin-section"/);
    expect(branch).not.toMatch(/className="tab-content"/);
  });

  test('the whole stylesheet reaches for no colour it cannot resolve', () => {
    /*
      rejects: borrowing a token that is declared nowhere. An undefined custom
      property invalidates the WHOLE declaration, not just the value, so a
      panel loses its border and nothing errors.

      Two sources are legal now and that is the point of item 12: this file's
      own `--pc-*` and `--pc-t-*`, and the GLOBAL tokens in styles.css, which
      the aliases exist to point at. Anything else — a `--qsets-*` borrowed
      because it happens to be in the bundle — fails.
    */
    const declaredHere = new Set([...CSS.matchAll(/(--[a-z0-9-]+)\s*:/gi)].map((m) => m[1]));
    const declaredGlobally = new Set([...GLOBAL_CSS.matchAll(/(--[a-z0-9-]+)\s*:/gi)].map((m) => m[1]));
    const used = [...new Set([...CSS.matchAll(/var\((--[a-z0-9-]+)/gi)].map((m) => m[1]))];
    expect(used.filter((n) => !declaredHere.has(n) && !declaredGlobally.has(n))).toEqual([]);
    // The premise: the aliases really do reach outside this file.
    expect(used.some((n) => !declaredHere.has(n))).toBe(true);
  });

  test('no hex survives outside the token block and the one transitional global', () => {
    /*
      rejects: the repaint being 95% done. A single `#e0e0e0` left on a border
      is the brightest thing on the field and there is no ratio to fail.

      TWO EXEMPTIONS, both named. `--pc-go` is the success text token styles.css
      does not supply. `.form-group input/textarea/select` is the ONE global
      this file still declares — it paints eighteen components on PAPER
      surfaces, so its `#ddd` and `#2196f3` cannot move; the dusk override for
      it is scoped under `.pmgr`/`.pgen` a few lines below.
    */
    const stripped = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
    const withoutTokens = stripped.replace(TOKEN_BLOCK, '');
    const transitional = withoutTokens.slice(
      withoutTokens.indexOf('.form-group input[type="text"]'),
      withoutTokens.indexOf('.form-group textarea {')
    );
    expect(transitional).toMatch(/#ddd/); // the premise: the exemption is real
    const hexes = [...withoutTokens.replace(transitional, '').matchAll(/#[0-9a-fA-F]{3,8}\b/g)]
      .map((m) => m[0]);
    expect(hexes).toEqual([]);
  });

  test('`color: var(--danger)` appears nowhere', () => {
    // rejects: destructive COPY painted with the border token. --danger is
    // 4.38:1 on --surface and 3.56:1 on --surface-2, both under AA; that is
    // what --danger-text exists for, and --pc-stop is its alias.
    expect(CSS).not.toMatch(/color:\s*var\(--danger\)/);
  });

  test('nothing in the WHOLE stylesheet is declared below a 12px floor', () => {
    /*
      rejects: an 11px chip added later to make a dense row fit — RATIONALE §3
      derives 12px as the hard floor for one person at 24in, and it is the same
      rule the question sets screen is held to.

      IT USED TO READ ONLY THE BLOCK AFTER `BEFORE YOU SAVE`, and that is
      exactly how the 11px it was written to prevent survived in this file:
      `.variable-btn[title]:hover::after` — the variable tooltip, which carries
      the longest sentences on the screen and is READ rather than glanced — sat
      six hundred lines above the slice and was never looked at. A floor that
      only applies to the newest third of a stylesheet is not a floor.
    */
    const sizes = [...CSS.matchAll(/font-size:\s*(\d+)px/g)].map((m) => Number(m[1]));
    expect(sizes.length).toBeGreaterThan(0);
    expect(sizes.filter((px) => px < 12)).toEqual([]);

    /*
      AND THE LADDER ITSELF, which the sweep above cannot see. Since the sheet
      declares `--pc-t-*` and reads them through `var()`, an 11px step added to
      the token block would put 11px type on the screen while every literal
      `font-size:` in the file still measured 12 or more. A floor that only
      applies to the values written in full is not a floor either.
    */
    const steps = [...TOKEN_BLOCK.matchAll(/--pc-t-[a-z]+:\s*(\d+)px/g)].map((m) => Number(m[1]));
    expect(steps.length).toBeGreaterThan(0);
    expect(steps.filter((px) => px < 12)).toEqual([]);
  });

  test('the ladder is the six steps the console uses, and the row is 36px', () => {
    /*
      rejects: the ladder tokens being declared and then ignored. Every literal
      px font-size left in the sheet is either the 12/13/15/19/24/30 ladder or
      the transitional global's 14px, which belongs to the paper components.
    */
    for (const [name, px] of [['floor', 12], ['label', 13], ['body', 15],
      ['head', 19], ['title', 24], ['numeral', 30]]) {
      expect(TOKEN_BLOCK).toMatch(new RegExp(`--pc-t-${name}:\\s*${px}px`));
    }
    expect(TOKEN_BLOCK).toMatch(/--pc-row-h:\s*36px/);

    /*
      And no literal off the ladder survives. 12/13/15 are still written out in
      the older `.pvi`/`.ppf`/`.pap` blocks, which is fine — they ARE ladder
      steps. 14 is the one exception and it is the transitional global's, which
      paints paper components; every 14px and 16px in the console's own blocks
      was folded onto a step in this change, and 17/32 with them.
    */
    const LADDER = [12, 13, 15, 19, 24, 30];
    const literal = [...new Set([...CSS.matchAll(/font-size:\s*(\d+)px/g)].map((m) => Number(m[1])))];
    expect(literal.filter((px) => !LADDER.includes(px))).toEqual([14]);

    const transitional = CSS.slice(
      CSS.indexOf('.form-group input[type="text"]'),
      CSS.indexOf('.form-group textarea {')
    );
    expect((transitional.match(/font-size:\s*14px/g) || []).length).toBe(1);
    expect((CSS.match(/font-size:\s*14px/g) || []).length).toBe(1);
  });

  test('the floor covers the tooltip specifically, not just the sheet in aggregate', () => {
    // rejects: raising the tooltip and later reverting that one rule while the
    // aggregate assertion above stays green because some other 12px arrived.
    const tooltip = CSS.match(/\.pvi\s+\.variable-btn\[title\]:hover::after\s*\{([^}]*)\}/);
    expect(tooltip).not.toBeNull();
    expect(Number(tooltip[1].match(/font-size:\s*(\d+)px/)[1])).toBeGreaterThanOrEqual(12);
  });
});
