const fs = require('fs');
const path = require('path');
const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const GLOBAL_CSS = read('styles.css');
const CSS = read('components', 'ScoreCard.css');
function lin(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function lum(c) { return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]); }
function ratio(a, b) { const la = lum(a); const lb = lum(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); }
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.substr(i, 2), 16));
function token(css, block, name) { const s = css.indexOf(block); const body = css.slice(s, css.indexOf('}', s)); const m = body.match(new RegExp(`${name}\\s*:\\s*(#[0-9A-Fa-f]{6})`)); if (!m) throw new Error(`${name} not in ${block}`); return m[1]; }
const DUSK = '[data-theme="dark"] {'; const ROOT = ':root {';
const T = { bg: token(GLOBAL_CSS, DUSK, '--bg'), surface: token(GLOBAL_CSS, DUSK, '--surface'), text: token(GLOBAL_CSS, DUSK, '--text'), muted: token(GLOBAL_CSS, DUSK, '--muted'), primary: token(GLOBAL_CSS, ROOT, '--primary'), secondary: token(GLOBAL_CSS, ROOT, '--secondary'), dangerText: token(GLOBAL_CSS, ROOT, '--danger-text') };
const AA = 4.5;
/*
  RULING R22 — THE 12px FLOOR CHECK BELOW IS VACUOUS ON ITS OWN.

  It looks for a `px` literal with `font-size` within the preceding 40
  characters. Every font-size in this sheet is `var(--scard-t-…)`, so the
  literals only ever appear in the token block, where nothing says `font-size`
  — the loop runs, matches nothing, and passes no matter what the tokens say.
  The floor lives in the TOKENS, so that is what has to be read. Setting
  `--scard-t-floor` to 10px in a scratch copy fails `floorTokens` and did not
  fail the loop.
*/
const floorTokens = (css, scope) => [...css.matchAll(new RegExp(`--${scope}-t-[a-z]+:\\s*(\\d+)px`, 'g'))].map((m) => Number(m[1]));
describe('ScoreCard palette', () => {
  test.each([
    ['--text on --bg', T.text, T.bg], ['--muted on --bg', T.muted, T.bg], ['--primary on --bg', T.primary, T.bg], ['--danger-text on --bg', T.dangerText, T.bg],
    ['--text on --surface', T.text, T.surface], ['--muted on --surface', T.muted, T.surface],
    ['--secondary on --bg (the low band chip, the back link)', T.secondary, T.bg], ['--secondary on --surface', T.secondary, T.surface],
  ])('%s clears AA', (_l, fg, bg) => expect(ratio(hex(fg), hex(bg))).toBeGreaterThanOrEqual(AA));
  test('scoped, token-only, no --danger text, 12px floor', () => {
    const stripped = CSS.replace(/\/\*[\s\S]*?\*\//g, ' ');
    const tokenBlock = stripped.slice(stripped.indexOf('.scard {'), stripped.indexOf('}', stripped.indexOf('.scard {')));
    expect((stripped.replace(tokenBlock, '').match(/#[0-9A-Fa-f]{3,6}\b/g) || [])).toEqual([]);
    expect(stripped).not.toMatch(/color:\s*var\(--danger\)/);
    for (const m of stripped.matchAll(/(\d+(?:\.\d+)?)px/g)) { if (/font-size/.test(stripped.slice(Math.max(0, m.index - 40), m.index))) expect(Number(m[1])).toBeGreaterThanOrEqual(12); }
    const sizes = floorTokens(stripped, 'scard');
    expect(sizes.length).toBeGreaterThan(3);
    for (const size of sizes) expect(size).toBeGreaterThanOrEqual(12);
    for (const sel of stripped.matchAll(/(^|\})\s*([^{@}]+)\{/g)) for (const part of sel[2].split(',')) expect(part.trim()).toMatch(/^\.scard(\b|-)/);
    expect(GLOBAL_CSS).not.toMatch(/\.scard(\b|-)/);
  });
  /*
    R15 removed `--modq-success-text` from the moderation sheet for being a
    token nothing used; this one was the same token, one sheet over, and the
    assertion above it was the only thing keeping it alive — a colour measured
    and pinned for a surface that never paints. Nothing in ScoreCard.jsx is
    green, and Stage 3's reports are not this sheet's to pre-declare.
  */
  test('no token is declared that nothing paints with', () => {
    const declared = [...CSS.matchAll(/(--scard-[a-z-]+):/g)].map((m) => m[1]);
    const unused = declared.filter((name) => !new RegExp(`var\\(${name}\\)`).test(CSS));
    expect(unused).toEqual([]);
  });
});

/*
  2026-09-19 — THE CARD MEASURES NOW. The owner: it "doesn't reveal much".
  Every band the check saw gets a chip, and a band is a CONFIDENCE, not a
  verdict: most rows on a public card were seen and let through. HIGH and
  MEDIUM had chips; LOW fell through to the base chip, because until the check
  asked for everything a LOW never reached the card. Each band now has its own
  colour, and each colour is read out of the sheet and measured, rather than
  trusted — against the work field the card sits on AND the dialog surface, so
  a chip moved into the takedown dialog cannot quietly lose AA.
*/
const STRIPPED = CSS.replace(/\/\*[\s\S]*?\*\//g, ' ');
/** A rule's declaration block, read by exact selector (rowActionsReachable.test.js's `block`). */
function rule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = STRIPPED.match(new RegExp(`(^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`, 'm'));
  if (!m) throw new Error(`No rule for "${selector}" — renamed?`);
  return m[2];
}
const colourOf = (selector) => {
  const m = rule(selector).match(/(?:^|[;\s])color:\s*var\((--[a-z-]+)\)/);
  if (!m) throw new Error(`"${selector}" paints no colour token`);
  return m[1];
};
/** A colour token's hex: the dusk block first (theme tokens), then :root (the invariant ones). */
const hexOf = (name) => {
  for (const block of [DUSK, ROOT]) {
    try { return token(GLOBAL_CSS, block, name); } catch (e) { /* not in this block */ }
  }
  throw new Error(`${name} is declared nowhere in styles.css`);
};
const widthIn = (selector) => {
  const m = rule(selector).match(/width:\s*([\d.]+)%/);
  if (!m) throw new Error(`No percentage width on "${selector}"`);
  return parseFloat(m[1]);
};

describe('every band the card measures has its own chip', () => {
  test.each([['high'], ['medium'], ['low']])('the %s chip clears AA on the work field and on a dialog', (band) => {
    const fg = hex(hexOf(colourOf(`.scard-chip--${band}`)));
    expect(ratio(fg, hex(T.bg))).toBeGreaterThanOrEqual(AA);
    expect(ratio(fg, hex(T.surface))).toBeGreaterThanOrEqual(AA);
  });
  // rejects: LOW left on the base chip's muted grey, which reads as "no band"
  // beside a row that plainly has one.
  test('three bands, three colours — and LOW is its own, not the base chip it used to fall through to', () => {
    const colours = ['high', 'medium', 'low'].map((b) => colourOf(`.scard-chip--${b}`));
    expect(new Set(colours).size).toBe(3);
    expect(colourOf('.scard-chip--low')).not.toBe(colourOf('.scard-chip'));
  });
  // rejects: any class this sheet adds that paints its text in a token nobody
  // measured. Generic on purpose: the next chip or cell is covered on arrival.
  test('every colour the sheet paints text with clears AA on the work field and on a dialog', () => {
    const names = [...new Set([...STRIPPED.matchAll(/(?:^|[;{\s])color:\s*var\((--[a-z-]+)\)/g)].map((m) => m[1]))];
    expect(names).toEqual(expect.arrayContaining(['--text', '--muted', '--secondary']));
    const under = names.filter((n) => ratio(hex(hexOf(n)), hex(T.bg)) < AA || ratio(hex(hexOf(n)), hex(T.surface)) < AA);
    expect(under).toEqual([]);
  });
});

describe('the tally is laid out as tables, and a truncated question keeps its text', () => {
  // rejects: hard rule 11 — under auto layout the declared widths are hints and
  // a nowrap chip grows the table. Both of the card's tables are `.scard-tbl`.
  test('the category block is fixed-layout and its three columns add to 100', () => {
    expect(rule('.scard-tbl')).toMatch(/table-layout:\s*fixed/);
    expect(['.scard-col-cat', '.scard-col-worst', '.scard-col-count'].reduce((a, s) => a + widthIn(s), 0)).toBe(100);
  });
  // rejects: a question named by thirty characters of itself — one line of a
  // 30% column — which is barely better than the id it replaced; and hard
  // rule 8's trap, a flex box that cuts silently instead of showing the clip.
  // The rows already run two lines for the Why column, so the name gets two.
  // The full string rides on title=, and what clamps is one text node
  // (both asserted rendered, in scoreCard.test.jsx).
  test('a question\'s text clamps at two lines and says so with an ellipsis', () => {
    const q = rule('.scard-q');
    expect(q).toMatch(/display:\s*-webkit-box/);
    expect(q).toMatch(/-webkit-box-orient:\s*vertical/);
    expect(q).toMatch(/-webkit-line-clamp:\s*2/);
    expect(q).toMatch(/overflow:\s*hidden/);
    expect(q).not.toMatch(/display:\s*(inline-)?flex/);
  });
});

/*
  2026-09-19 — RUNNING THE CHECK AGAIN. The platform card gained a control
  beside the latest check and a confirmation that says what a re-check will and
  will not do. Two of its classes carry text colour, so both are measured here
  against the work field AND the dialog surface (the confirmation is a dialog);
  the generic sweep above catches any third on arrival, and these name the two
  so a rename cannot quietly drop them.
*/
describe('the re-check control and its confirmation', () => {
  test.each([['.scard-promises dt'], ['.scard-promises dd']])('%s clears AA on the work field and on a dialog', (selector) => {
    const fg = hex(hexOf(colourOf(selector)));
    expect(ratio(fg, hex(T.bg))).toBeGreaterThanOrEqual(AA);
    expect(ratio(fg, hex(T.surface))).toBeGreaterThanOrEqual(AA);
  });
  // rejects: a small button that shrinks its label below the 12px floor, or
  // repaints it in a colour of its own rather than the card's text.
  test('the small button changes its size only, and stays on the ladder', () => {
    const sm = rule('.scard-btn--sm');
    expect(sm).not.toMatch(/(?:^|[;\s])color:/);
    const size = sm.match(/font-size:\s*var\((--scard-t-[a-z]+)\)/);
    expect(size).not.toBeNull();
    const declared = STRIPPED.match(new RegExp(`${size[1]}:\\s*(\\d+)px`));
    expect(Number(declared[1])).toBeGreaterThanOrEqual(12);
  });
  // rejects: hard rule 9 — flex-end in a row that can wrap pushes the overflow
  // toward the start, where it is unreachable. The heading takes the slack.
  test('the control sits beside the heading on a row that wraps, never flex-end', () => {
    const row = rule('.scard-hrow');
    expect(row).toMatch(/display:\s*flex/);
    expect(row).toMatch(/flex-wrap:\s*wrap/);
    expect(row).not.toMatch(/justify-content:\s*flex-end/);
    expect(rule('.scard-hrow .scard-h')).toMatch(/margin-right:\s*auto/);
  });
});
