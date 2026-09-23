/**
 * THE COLLECTING SURVEY'S RULES IN styles/stage.css — `.sprog`, `.stitle`,
 * `.ssub` — measured, not eyeballed.
 *
 * NAMED "Palette", not "Tokens": `.gitignore` carries an unanchored `*token*`,
 * so a file named for tokens is invisible to git — it runs locally, passes, and
 * never reaches CI. Do not rename it.
 *
 * jsdom has no layout engine and loads no stylesheet, so every assertion here
 * reads the CSS as text and does arithmetic on it. Green means "the contract
 * has not been reverted", not "this reads from the back of the room" — only a
 * projector in a lit room can say that.
 *
 * THE STAGE IS MEASURED TWICE: on its own dusk field, and on the field a
 * projector actually shows. The host spec (docs/superpowers/specs/
 * 2026-08-08-host-screen-redesign-design.md:372) designs against a lit room
 * lifting the black point from #0F1A2E toward #2A3550, "roughly 1.6× of every
 * ratio" — so a pairing that only clears AA on an LCD fails on the wall.
 *
 * `.bar2` IS ABSENT ON PURPOSE. s-01-collecting draws a progress bar under the
 * Finished fraction; the shipped meter cut that bar as a second statement of
 * one fact (stage.css's meter block, RoomMeter.jsx's header). The
 * per-question rows are a different fact — how far through the FORM the room
 * is — so they are kept; the bar is not re-added (plan §5 risk 7).
 */
const fs = require('fs');
const path = require('path');

const STAGE_RAW = fs.readFileSync(path.join(__dirname, '..', 'styles', 'stage.css'), 'utf8');
const GLOBAL_CSS = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const STAGE = strip(STAGE_RAW);

/* ------------------------------------------------------------------ colour */
const lin = (c) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
const lum = (rgb) => 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
const ratio = (a, b) => { const la = lum(a); const lb = lum(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); };
const parseHex = (h) => [1, 3, 5].map((i) => parseInt(h.substr(i, 2), 16));
const over = (fg, bg, a) => fg.map((c, i) => c * a + bg[i] * (1 - a));
const parseRgba = (s) => { const m = s.match(/[\d.]+/g).map(Number); return { rgb: m.slice(0, 3), a: m.length > 3 ? m[3] : 1 }; };

/** A token's hex from the first `blockHead` block that declares it — stage.css
    opens `.stage{` three times (the grid, the reveal clock, the dusk tokens). */
function tokenIn(css, blockHead, name) {
  let start = css.indexOf(blockHead);
  if (start < 0) throw new Error(`no ${blockHead} block`);
  while (start >= 0) {
    const body = css.slice(start, css.indexOf('}', start));
    const m = body.match(new RegExp(`${name}\\s*:\\s*(#[0-9A-Fa-f]{6})`));
    if (m) return m[1];
    start = css.indexOf(blockHead, start + 1);
  }
  throw new Error(`${name} not declared in any ${blockHead} block`);
}

/* The stage re-enters dusk on `.stage{…}` (stage.css), so those are the
   values the rules below paint with, not :root's. */
const T = {
  bg: parseHex(tokenIn(STAGE, '.stage{', '--bg')),
  text: parseHex(tokenIn(STAGE, '.stage{', '--text')),
  muted: parseHex(tokenIn(STAGE, '.stage{', '--muted')),
  primary: parseHex(tokenIn(GLOBAL_CSS, ':root {', '--primary')),
  success: parseHex(tokenIn(GLOBAL_CSS, ':root {', '--success')),
};
const LIFTED = parseHex('#2A3550');
const FIELDS = [['the dusk field', T.bg], ['the projector-lifted field', LIFTED]];
const AA = 4.5;
const NON_TEXT = 3;

/* --------------------------------------------------------------- the rules */
/** Every top-level rule whose selector list names one of the survey classes. */
function surveyRules() {
  const out = [];
  for (const chunk of STAGE.split('}')) {
    const i = chunk.indexOf('{');
    if (i < 0) continue;
    const head = chunk.slice(0, i).trim();
    if (!head || head.includes('@')) continue;
    if (/\.(sprog|stitle|ssub)\b/.test(head)) out.push({ head, body: chunk.slice(i + 1) });
  }
  return out;
}
const rule = (head) => {
  const found = surveyRules().find((r) => r.head.replace(/\s+/g, ' ') === head);
  if (!found) throw new Error(`no rule for "${head}" in stage.css — renamed?`);
  return found.body;
};
const decl = (body, prop) => {
  const m = body.match(new RegExp(`(?:^|;|\\s)${prop}\\s*:\\s*([^;]+)`));
  return m ? m[1].trim() : null;
};
const tokenColour = (value) => {
  const m = String(value).match(/^var\(--(text|muted|primary|success)\)$/);
  if (!m) throw new Error(`colour "${value}" is not one of the stage tokens this test knows`);
  return T[m[1]];
};

describe('the three survey rules exist, and .bar2 does not', () => {
  test('.sprog, .stitle and .ssub are declared', () => {
    const heads = surveyRules().map((r) => r.head);
    expect(heads.some((h) => /^\.sprog\b/.test(h))).toBe(true);
    expect(heads).toContain('.stitle');
    expect(heads).toContain('.ssub');
  });

  test('.bar2 is nowhere in the stage sheet', () => {
    // Comments stripped first: the meter block's own comment names .bar2 as
    // the thing it cut, and that sentence must not satisfy — or fail — this.
    expect(STAGE).not.toMatch(/\.bar2\b/);
    expect(STAGE_RAW).toMatch(/\.bar2/); // the premise: the cut is still written down
  });
});

describe('every survey word clears AA on the wall, lifted field included', () => {
  const texts = () => surveyRules()
    .map((r) => ({ head: r.head, color: decl(r.body, 'color'), opacity: decl(r.body, 'opacity') }))
    .filter((r) => r.color);

  test('there is text to measure (so the loop below means something)', () => {
    expect(texts().length).toBeGreaterThanOrEqual(3);
  });

  test.each(FIELDS)('on %s', (_label, field) => {
    for (const r of texts()) {
      const alpha = r.opacity ? Number(r.opacity) : 1;
      const painted = over(tokenColour(r.color), field, alpha);
      const measured = ratio(painted, field);
      if (measured < AA) throw new Error(`${r.head} measures ${measured.toFixed(2)}:1`);
    }
  });
});

describe('the per-question bars are visible against their own track', () => {
  const track = () => parseRgba(decl(rule('.sprog .r .t'), 'background'));
  const fillOf = (head) => tokenColour(decl(rule(head), 'background'));

  test.each(FIELDS)('the fill and the full fill clear 3:1 (non-text) on %s', (_label, field) => {
    const t = track();
    const ground = over(t.rgb, field, t.a);
    expect(ratio(fillOf('.sprog .r .t i'), ground)).toBeGreaterThanOrEqual(NON_TEXT);
    expect(ratio(fillOf('.sprog .r .t i.full'), ground)).toBeGreaterThanOrEqual(NON_TEXT);
  });

  test('a bar never carries the number alone: each row prints its count', () => {
    // The value column is part of the row grid (Q · bar · n / joined), so the
    // colour is never the only statement of the result (RATIONALE §3).
    expect(decl(rule('.sprog .r'), 'grid-template-columns')).toMatch(/minmax\(0,\s*1fr\)/);
    expect(rule('.sprog .r .v')).toMatch(/text-align:\s*right/);
  });
});

describe('the survey rules read the stage ladder', () => {
  test('every font size is a profile tier, never a pixel', () => {
    for (const r of surveyRules()) {
      const size = decl(r.body, 'font-size');
      if (!size) continue;
      expect(size).toMatch(/^(var\(--t-(hero|primary|secondary|body|meta)\)|max\(var\(--floor\),.+\))$/);
    }
  });

  test('no hex literal: colour is tokens only', () => {
    for (const r of surveyRules()) expect(r.body).not.toMatch(/#[0-9A-Fa-f]{3,8}\b/);
  });

  test('every custom property the survey rules use is declared somewhere', () => {
    const declared = new Set([...`${STAGE}\n${GLOBAL_CSS}`.matchAll(/(--[a-zA-Z0-9-]+)\s*:/g)].map((m) => m[1]));
    for (const r of surveyRules()) {
      for (const m of r.body.matchAll(/var\((--[a-zA-Z0-9-]+)/g)) expect(declared.has(m[1])).toBe(true);
    }
  });
});
