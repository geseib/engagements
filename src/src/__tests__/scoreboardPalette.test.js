/**
 * THE SCOREBOARD'S CSS CONTRACT — components/stage/scoreboard/Scoreboard.css,
 * read as text (jsdom loads no stylesheet and resolves no custom property).
 *
 * Named *Palette*, never *Token*: `.gitignore` carries an unanchored `*token*`,
 * so a file named for tokens would pass locally and never reach CI.
 *
 *   1. CONTRAST on the projector. The stage is designed against a projector
 *      in a lit room raising black toward #2A3550 (host-redesign/audit.js A9;
 *      the mockups' own headers measure both). Every text pairing the three
 *      looks draw clears 4.5:1 flat AND lifted — including the two fixes the
 *      spec names: NEW in #A7C3EF, and the third medal block lightened so its
 *      dark numeral clears 4.5:1 once the projector lifts the ink (it was
 *      3.35:1 on --bronze). §1b (Fix round 1, 2026-09-26) extends the same
 *      measurement to the RAIL — chip, title, context line, page range and
 *      the close button — against `.sb-field`'s own background, which the
 *      rail had been reusing tokens against without anyone measuring it.
 *   2. SCOPE. Every selector is rooted at `.sb`; nothing in styles.css or
 *      stage.css declares an `sb-` class, so nothing leaks in either way.
 *   3. TOKENS. Every var() used is declared somewhere the board can see it;
 *      --danger never carries text; no px font-size (the type is the profile
 *      ladders, so nothing drops below the floor).
 */
const fs = require('fs');
const path = require('path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const SB = strip(read('components', 'stage', 'scoreboard', 'Scoreboard.css'));
const STAGE = strip(read('styles', 'stage.css'));
const GLOBAL = strip(read('styles.css'));

/* ---- colour: the audit's arithmetic ---- */
function lin(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function lum(c) { return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]); }
function ratio(a, b) {
  const la = lum(a); const lb = lum(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.substr(i, 2), 16));
/* host-redesign/audit.js A9: black lifts from #0F1A2E toward #2A3550. The
   projector lifts whichever of the pair is the dark one — the field under
   light text, the ink on a light medal block. */
const BASE = [15, 26, 46];
const LIFT = [42, 53, 80];
const lift = (c) => c.map((v, i) => Math.min(255, v + (LIFT[i] - BASE[i])));
function lifted(fg, bg) {
  return lum(fg) < lum(bg) ? ratio(lift(fg), bg) : ratio(fg, lift(bg));
}

/* ---- tokens, READ rather than retyped ---- */
/** Every block whose selector is exactly `selector`, in order. */
function blocks(css, selector) {
  const re = new RegExp(`(^|\\})\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{`, 'gm');
  const out = [];
  let m;
  while ((m = re.exec(css))) {
    const start = m.index + m[0].length;
    out.push(css.slice(start, css.indexOf('}', start)));
  }
  if (!out.length) throw new Error(`no ${selector} block`);
  return out;
}
const block = (css, selector) => blocks(css, selector)[0];
function token(css, selector, name) {
  for (const body of blocks(css, selector)) {
    const m = body.match(new RegExp(`${name}\\s*:\\s*(#[0-9A-Fa-f]{6})`));
    if (m) return hex(m[1]);
  }
  throw new Error(`${name} not declared in ${selector}`);
}
const T = {
  bg: token(STAGE, '.stage', '--bg'),
  surface: token(STAGE, '.stage', '--surface'),
  text: token(STAGE, '.stage', '--text'),
  muted: token(STAGE, '.stage', '--muted'),
  successText: token(STAGE, ':root', '--success-text'),
  primary: token(GLOBAL, ':root', '--primary'),
  gold: token(GLOBAL, ':root', '--gold'),
  silver: token(GLOBAL, ':root', '--silver'),
  bronze: token(GLOBAL, ':root', '--bronze'),
  sbNew: token(SB, '.sb', '--sb-new'),
  sbBronze: token(SB, '.sb', '--sb-bronze'),
  toteRow: token(SB, '.sb', '--sb-tote-row'),
};

const AA = 4.5;
const pair = (name, fg, bg) => [name, fg, bg];

describe('1. contrast, flat and on the projector', () => {
  const PAIRS = [
    // A · the flaps' top half is --surface (the lower half is darker and scores higher)
    pair('A name/points on a flap', T.text, T.surface),
    pair('A place on a flap', T.primary, T.surface),
    pair('A ▲ on a flap', T.successText, T.surface),
    pair('A ▼ / – on a flap', T.muted, T.surface),
    pair('A NEW on a flap', T.sbNew, T.surface),
    // B · rank ink on the medal blocks
    pair('B 1st: ink on gold', T.bg, T.gold),
    pair('B 2nd: ink on silver', T.bg, T.silver),
    pair('B 3rd: ink on the board\'s bronze', T.bg, T.sbBronze),
    // C · the tote's rows
    pair('C names on a row', T.text, T.toteRow),
    pair('C points lamps on a row', T.primary, T.toteRow),
    pair('C NEW on a row', T.sbNew, T.toteRow),
  ];

  test.each(PAIRS)('%s clears 4.5:1 flat', (_n, fg, bg) => {
    expect(ratio(fg, bg)).toBeGreaterThanOrEqual(AA);
  });

  test.each(PAIRS)('%s clears 4.5:1 after the black-lift', (_n, fg, bg) => {
    expect(lifted(fg, bg)).toBeGreaterThanOrEqual(AA);
  });

  test('the fix the spec names: --bronze itself fails lifted, which is why the board has its own', () => {
    // Re-asserts the premise so the bronze fix cannot quietly become vacuous.
    expect(lifted(T.bg, T.bronze)).toBeLessThan(AA);
    expect(block(SB, '.sb .sb-rk.sb-m3')).toMatch(/background:\s*var\(--sb-bronze\)/);
  });

  test('NEW is the lighter periwinkle, not --secondary', () => {
    expect(block(SB, '.sb .sb-k-new')).toMatch(/color:\s*var\(--sb-new\)/);
    expect(SB).not.toMatch(/color:\s*var\(--secondary\)/);
  });
});

/* Fix round 1 (task review, 2026-09-26): the RAIL was reusing tokens
   ("it reads at the same weight as what already ships") without anyone
   MEASURING that weight. Rule 4 of the design skill: "Contrast is measured,
   never eyeballed... composited up the ancestor chain." This section points
   the exact ratio()/lifted() machinery §1 uses at every text/icon element in
   the rail — the chip, the title, the context line, the page range, and the
   close button added in Task 1 — against `.sb-field`'s own background, in
   each of the three looks and every display profile where that background
   differs. */
describe('1b. the rail itself (chip, title, context, page, close)', () => {
  /* THE RAIL'S BACKGROUND, read — not retyped — from `.sb .sb-field`'s own
     rule. The rail is `.sb`'s first grid row (`grid-template-rows:auto
     minmax(0,1fr)`, above), and `.sb-field` is `position:absolute;inset:0`,
     so the rail sits at y=0 of the field: the linear-gradient's own 0% stop. */
  const fieldTopHex = block(SB, '.sb .sb-field').match(/linear-gradient\(180deg,\s*(#[0-9A-Fa-f]{6})/)[1];
  const FIELD_TOP = hex(fieldTopHex); // Room / TV / Table
  const FIELD_CALL = T.bg; // Call: flat, no gradient — see the premises test

  test('the premises: the rail sits on the gradient\'s darkest stop, the radial highlight never reaches y=0, and Call is flat', () => {
    expect(fieldTopHex.toUpperCase()).toBe('#0C1526');
    // radial-gradient(120% 78% at 50% 112%, ...): centred 112% down the
    // container with a 78% vertical radius. At y=0, dy/ry = 112/78 ≈ 1.44,
    // so (dy/ry)² ≈ 2.06 — outside the ellipse (>1) regardless of x, i.e.
    // it contributes nothing at the rail.
    expect(block(SB, '.sb .sb-field')).toMatch(/radial-gradient\(120% 78% at 50% 112%/);
    expect((112 / 78) ** 2).toBeGreaterThan(1);
    // Call drops the gradient and the radial highlight entirely.
    expect(block(SB, ':root.d-call .sb .sb-field')).toMatch(/background:\s*var\(--bg\)/);
    expect(block(SB, ':root.d-call .sb .sb-field::after')).toMatch(/display:\s*none/);
  });

  test('every one of the three looks shares this exact rail — none overrides chip/title/ctx/page/close', () => {
    // If this ever failed, the cases below would need a per-look background
    // too; today one measurement covers all three because nothing shadows it.
    for (const look of ['departure', 'olympic', 'tote']) {
      const shadowed = new RegExp(`\\.sb--${look}[^{]*\\.(sb-chip|sb-title|sb-ctx|sb-page|sb-close|sb-tail)\\b`);
      expect(SB).not.toMatch(shadowed);
    }
  });

  // Every rail element that carries colour, and the token it carries. Room/TV/
  // Table and Call are the only two distinct backgrounds (every other token
  // here is profile-invariant), per the premises test above.
  const ELEMENTS = [
    ['the "Standings" chip', T.primary],
    ['the session title', T.text],
    ['the context line ("After round N")', T.muted],
    ['the context line, emphasised (the round number)', T.text],
    ['the page range ("1–10 of 14")', T.muted],
    ['the page range, emphasised (the numbers)', T.text],
    ['the close button, resting', T.muted],
    ['the close button, hover/focus', T.text],
  ];
  const PROFILES = [['Room', FIELD_TOP], ['TV', FIELD_TOP], ['Table', FIELD_TOP], ['Call', FIELD_CALL]];

  const CASES = [];
  for (const [profileName, bg] of PROFILES) {
    for (const [elName, fg] of ELEMENTS) CASES.push([`${elName} — ${profileName}, every look`, fg, bg]);
  }

  test.each(CASES)('%s clears 4.5:1 flat', (_n, fg, bg) => {
    expect(ratio(fg, bg)).toBeGreaterThanOrEqual(AA);
  });

  test.each(CASES)('%s clears 4.5:1 after the black-lift', (_n, fg, bg) => {
    expect(lifted(fg, bg)).toBeGreaterThanOrEqual(AA);
  });
});

describe('2. scope', () => {
  const selectors = [];
  (function collect(text) {
    let i = 0;
    while (i < text.length) {
      const b = text.indexOf('{', i);
      if (b === -1) break;
      const head = text.slice(i, b).trim();
      let depth = 0; let c = b;
      for (; c < text.length; c += 1) {
        if (text[c] === '{') depth += 1;
        if (text[c] === '}') { depth -= 1; if (depth === 0) break; }
      }
      if (/^@media/.test(head)) collect(text.slice(b + 1, c));
      else if (!head.startsWith('@')) head.split(',').forEach((s) => selectors.push(s.trim()));
      i = c + 1;
    }
  }(SB));

  test('every selector is rooted at .sb', () => {
    expect(selectors.length).toBeGreaterThan(50);
    const stray = selectors.filter((s) => !/^(:root\.d-\w+ )?\.sb([ .:[]|$)/.test(s));
    expect(stray).toEqual([]);
  });

  test('styles.css and stage.css declare nothing in the sb- scope', () => {
    for (const css of [GLOBAL, STAGE]) expect(css).not.toMatch(/\.sb[-\s.{,:]/);
  });
});

describe('3. tokens and type', () => {
  test('every var() the sheet uses is declared where the board can see it', () => {
    const used = new Set([...SB.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]));
    const declared = new Set([...`${SB}\n${STAGE}\n${GLOBAL}`.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
    // Set by the engines on their containers at run time.
    ['--cw', '--ch', '--cgap', '--colgap', '--lgap', '--fs', '--st', '--d', '--dy', '--dur', '--rd', '--md', '--ld', '--lamp-pos-n', '--lamp-pts-n']
      .forEach((v) => declared.add(v));
    expect([...used].filter((v) => !declared.has(v))).toEqual([]);
  });

  test('--danger never carries text', () => {
    expect(SB).not.toMatch(/(^|[^-])color:\s*var\(--danger\)/);
  });

  test('no px font-size: every size is a profile ladder rung or the floor', () => {
    const sizes = [...SB.matchAll(/font-size:\s*([^;}]+)/g)].map((m) => m[1].trim());
    expect(sizes.length).toBeGreaterThan(10);
    for (const size of sizes) expect(size).toMatch(/var\(--(L-|floor|fs|rk-fs|nm-fs|pt-fs|mv-fs|tg-fs)/);
  });

  test('the display face is the app\'s token, not a family named here', () => {
    expect(SB).not.toMatch(/font-family:\s*["']/);
    expect(SB).toMatch(/font-family:\s*var\(--font-display\)/);
  });
});

/* Task 1 (2026-09-26): the click-to-close button, on the rail. It carries no
   new colour — it reuses exactly the tokens the rail already ships (--muted
   for the chip/context line, --text for emphasis, --primary for the chip's
   own dot and border). §1b above measures every one of those tokens against
   the field's real background (Fix round 1, 2026-09-26: this reuse was
   asserted here but never actually measured, which is what that section
   fixes) and confirms they clear AA with a wide margin in every look and
   every display profile — the reuse was the right call, and now it is
   measured rather than merely asserted. */
describe('4. the click-to-close button', () => {
  test('.sb-close is declared once, rooted at .sb, with a visible hover/focus state', () => {
    expect(blocks(SB, '.sb .sb-close')).toHaveLength(1);
    expect(SB).toMatch(/\.sb \.sb-close:hover,\s*\.sb \.sb-close:focus-visible\{/);
  });

  test('no bare hex on the new rule — tokens only, and only ones already live on the rail', () => {
    const rule = block(SB, '.sb .sb-close');
    expect(rule).not.toMatch(/#[0-9A-Fa-f]{3,8}/);
    expect(rule).toMatch(/color:\s*var\(--muted\)/);
  });

  test('focus is visible: an outline in --primary, the same colour the chip already carries', () => {
    expect(SB).toMatch(/\.sb \.sb-close:focus-visible\{outline:2px solid var\(--primary\)/);
    expect(block(SB, '.sb .sb-chip')).toMatch(/color:var\(--primary\)/);
  });

  test('the accessible name is JSX, not CSS — no content: "×" trick that would hide it from a screen reader', () => {
    // (^|[^-]) so "justify-content:" (already in the rule) does not false-positive.
    expect(block(SB, '.sb .sb-close')).not.toMatch(/(^|[^-])content:/);
  });
});
