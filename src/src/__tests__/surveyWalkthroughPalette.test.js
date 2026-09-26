/**
 * The CSS contract for `.svw` in styles/stage.css — the survey walk-through's
 * re-skin of components/survey/results/SurveyResults.css (Task 8, 2026-09-26
 * feature sweep). See stage.css's own comment beside the rule for the full
 * argument; this file is the measured half of it.
 *
 * Same harness as surveyStagePalette.test.js and surveyResultsPalette.test.js
 * (per .claude/skills/engage-design/references/testing-a-surface.md): jsdom
 * resolves no custom property, so this reads the stylesheets as TEXT and does
 * the contrast arithmetic itself. Green means the contract has not regressed,
 * not that a browser renders this legibly.
 *
 * WHY THE FIELD CHANGES FROM THE CONSOLE'S OWN TEST. SurveyResults.css's own
 * contract (surveyResultsPalette.test.js) measures `--text` / `--muted`
 * against `--surface` — the console's `.svr-card` chrome. This presenter
 * renders the SAME rules with no card: `.svw` sits directly on the stage's
 * own dusk field. A card's background is LIGHTER than the field it sits on
 * (`--surface` #1B2942 vs `--bg` #0F1A2E), so the console's numbers do not
 * transfer, and every bare pairing below is re-measured against what this
 * presenter actually paints on — both the dusk field and the
 * projector-lifted one a lit room shows, the same two fields
 * surveyStagePalette.test.js measures the survey's OTHER stage rules against.
 * The three OPAQUE pairings (a solid accent fill, a `--surface-2` chip) are
 * unaffected by the field underneath and are the exact numbers
 * surveyResultsPalette.test.js already proved — asserted again here so a
 * change to either token is still caught from this side too.
 */
const fs = require('fs');
const path = require('path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const STAGE_RAW = read('styles', 'stage.css');
const GLOBAL_CSS = read('styles.css');
const SVR_CSS = read('components', 'survey', 'results', 'SurveyResults.css');
const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const STAGE = strip(STAGE_RAW);

/* ------------------------------------------------------------------ colour */
function lin(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }
function lum(c) { return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]); }
function ratio(a, b) {
  const la = lum(a); const lb = lum(b);
  const h = Math.max(la, lb); const l = Math.min(la, lb);
  return (h + 0.05) / (l + 0.05);
}
const parseHex = (h) => [1, 3, 5].map((i) => parseInt(h.substr(i, 2), 16));

/** A token's hex from the first block whose head matches `blockHead` — mirrors
    surveyStagePalette.test.js's own helper (stage.css opens `.stage{` more
    than once). */
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

const T = {
  bg: tokenIn(STAGE, '.stage{', '--bg'),
  surface: tokenIn(STAGE, '.stage{', '--surface'),
  surface2: tokenIn(STAGE, '.stage{', '--surface-2'),
  text: tokenIn(STAGE, '.stage{', '--text'),
  muted: tokenIn(STAGE, '.stage{', '--muted'),
  primary: tokenIn(GLOBAL_CSS, ':root {', '--primary'),
  success: tokenIn(GLOBAL_CSS, ':root {', '--success'),
  dangerDeep: tokenIn(GLOBAL_CSS, ':root {', '--danger-deep'),
};
const LIFTED = parseHex('#2A3550');
const FIELDS = [['the dusk field', parseHex(T.bg)], ['the projector-lifted field', LIFTED]];
const AA = 4.5;

/** The one `.svw{...}` rule. */
function svwRule() {
  const start = STAGE.indexOf('.svw{');
  if (start < 0) throw new Error('.svw is not declared in stage.css');
  const body = STAGE.slice(start, STAGE.indexOf('}', start));
  return body;
}
const decl = (body, prop) => {
  const m = body.match(new RegExp(`(?:^|[{;\\s])${prop}\\s*:\\s*([^;]+)`));
  return m ? m[1].trim() : null;
};

describe('.svw exists exactly once, and carries no card chrome of its own', () => {
  test('declared once in stage.css', () => {
    const count = (STAGE.match(/\.svw\{/g) || []).length;
    expect(count).toBe(1);
  });

  test('no background, no border — a bare re-skin, never a second card', () => {
    const body = svwRule();
    expect(decl(body, 'background')).toBeNull();
    expect(decl(body, 'border')).toBeNull();
  });
});

describe('the ladder: every re-declared property reads a stage token, never a pixel', () => {
  const LADDER = {
    floor: '--t-meta', label: '--t-body', body: '--t-secondary', head: '--t-secondary', numeral: '--t-hero',
  };
  test.each(Object.entries(LADDER))('--svr-t-%s reads var(%s)', (step, tok) => {
    const body = svwRule();
    expect(decl(body, `--svr-t-${step}`)).toBe(`var(${tok})`);
  });

  test('the base font-size a plain answer/option/label inherits is --svr-t-body', () => {
    // SurveyResults.css's own bare text rules (.svr-bar-l, .svr-rank-l, a
    // quote, a write-in) carry NO font-size of their own and inherit this —
    // exactly the role `.svr-card-body` plays on the console.
    expect(decl(svwRule(), 'font-size')).toBe('var(--svr-t-body)');
  });

  test('no literal pixel FONT size anywhere in the rule (gaps/layout are not type)', () => {
    // Same carve-out SurveyResults.css's own header states: "Row/measurement
    // values (gaps, radii, strip heights) are layout, not type, and are not
    // held to the floor." `.svw`'s own `gap` is exactly that.
    expect(svwRule()).not.toMatch(/font-size\s*:\s*\d+px/);
  });
});

describe('--svr-on-accent is the SAME literal SurveyResults.css already measured', () => {
  test('.svw declares the documented literal, not a new one', () => {
    expect(decl(svwRule(), '--svr-on-accent')).toBe('#1B2942');
  });

  test('it is byte-identical to the console\'s own --svr-on-accent', () => {
    const consoleValue = tokenIn(strip(SVR_CSS), '.svr-card {', '--svr-on-accent');
    expect(decl(svwRule(), '--svr-on-accent').toUpperCase()).toBe(consoleValue.toUpperCase());
  });

  test('it is also, not coincidentally, the stage\'s own --surface', () => {
    expect(decl(svwRule(), '--svr-on-accent').toUpperCase()).toBe(T.surface.toUpperCase());
  });

  test('no other hex literal in the rule', () => {
    const literals = [...svwRule().matchAll(/#[0-9A-Fa-f]{3,8}\b/g)].map((m) => m[0]);
    expect(literals.filter((h) => h.toUpperCase() !== '#1B2942')).toEqual([]);
  });
});

describe('bare pairings this presenter paints directly on the stage field', () => {
  test.each(FIELDS)('--text on the field, %s (a bar/rank label, the mean number)', (_l, field) => {
    expect(ratio(parseHex(T.text), field)).toBeGreaterThanOrEqual(AA);
  });
  test.each(FIELDS)('--muted on the field, %s (a foot note, a legend)', (_l, field) => {
    expect(ratio(parseHex(T.muted), field)).toBeGreaterThanOrEqual(AA);
  });
});

describe('opaque pairings — unaffected by the field, same numbers SurveyResults.css proved', () => {
  test('--svr-on-accent on --primary (the "Most picked" tag)', () => {
    expect(ratio(parseHex(T.surface), parseHex(T.primary))).toBeGreaterThanOrEqual(AA);
  });
  test('--svr-on-accent on --success (the yes / promoter segment)', () => {
    expect(ratio(parseHex(T.surface), parseHex(T.success))).toBeGreaterThanOrEqual(AA);
  });
  test('--text on --danger-deep (the no / detractor segment)', () => {
    expect(ratio(parseHex(T.text), parseHex(T.dangerDeep))).toBeGreaterThanOrEqual(AA);
  });
  test('--text on --surface-2 (a quote, an open answer, a write-in chip)', () => {
    expect(ratio(parseHex(T.text), parseHex(T.surface2))).toBeGreaterThanOrEqual(AA);
  });
  test('--muted on --surface-2 (a quote\'s "said No", the not-sure segment)', () => {
    expect(ratio(parseHex(T.muted), parseHex(T.surface2))).toBeGreaterThanOrEqual(AA);
  });
});

describe('reduced motion: nothing new to reduce', () => {
  test('.svw adds no animation or transition of its own', () => {
    const body = svwRule();
    expect(body).not.toMatch(/animation/);
    expect(body).not.toMatch(/transition/);
  });

  // The premise this presenter relies on: it mounts SurveyResults.css's
  // renderers UNCHANGED, so if that stylesheet ever grew motion of its own,
  // "nothing new to reduce" here would quietly stop being true. Pinned so a
  // change over there is caught from this side too.
  test('the premise: SurveyResults.css itself carries no animation either', () => {
    const stripped = strip(SVR_CSS);
    expect(stripped).not.toMatch(/animation/);
    expect(stripped).not.toMatch(/@keyframes/);
    expect(stripped).not.toMatch(/transition/);
  });
});

describe('.svw is a plain flow child of .content/.fitbox', () => {
  test('no position/width/height override fighting the fitter\'s own measurement', () => {
    const body = svwRule();
    expect(decl(body, 'position')).toBeNull();
    expect(decl(body, 'width')).toBeNull();
    expect(decl(body, 'height')).toBeNull();
  });
});

/**
 * FIX ROUND 1, I1. `.svr-bar-l` / `.svr-rank-l` are `white-space:nowrap;
 * text-overflow:ellipsis` in SurveyResults.css (the console's own rule,
 * unchanged) — fine for a laptop card, but stage.css's own rule for exactly
 * this ("NO LINE CLAMPS LIVE HERE... a clamp in base CSS makes the fitter
 * blind: content arrives already cut, scrollHeight equals clientHeight, the
 * fitter concludes it fits and stops") applies just as much to an
 * unconditional ELLIPSIS as to an unconditional clamp: a long choice option
 * or rank item silently clips, never grows `.content`'s scrollHeight, and
 * the scale search never even tries to shrink type to show more of it.
 *
 * The fix mirrors `.opt .txt`'s own existing shape exactly: `.svw` overrides
 * the two selectors to wrap normally (so a long label actually grows the
 * box, which `over()` can see), and a clamp is reintroduced ONLY behind
 * `[data-clamped="on"]` — the fitter's own terminal stage, never the base
 * rule. Both selectors join `useStageFit.js`'s CONTENT list, the same
 * whitelist `.q` / `.opt .txt` / `.card .ans` already sit on.
 */
const USE_STAGE_FIT = read('hooks', 'useStageFit.js');

/** Every top-level rule in `css`, as { head, body } — same parser shape
    stageLadderScope.test.js uses, needed here because the un-clamped and
    clamped rules share selector text with multiple comma branches. */
function rulesOf(css) {
  const out = [];
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf('{', i);
    if (open < 0) break;
    const head = css.slice(i, open).split(';').pop().trim();
    let depth = 1;
    let j = open + 1;
    while (j < css.length && depth > 0) {
      if (css[j] === '{') depth += 1;
      else if (css[j] === '}') depth -= 1;
      j += 1;
    }
    const body = css.slice(open + 1, j - 1);
    if (!head.startsWith('@')) out.push({ head: head.replace(/\s+/g, ' '), body });
    i = j;
  }
  return out;
}
const STAGE_RULES = rulesOf(STAGE);
const hasSelector = (rule, sel) => rule.head.split(',').map((s) => s.trim()).includes(sel);

describe('.svr-bar-l / .svr-rank-l under .svw: wraps instead of silently ellipsing', () => {
  const rule = STAGE_RULES.find((r) => hasSelector(r, '.svw .svr-bar-l') && hasSelector(r, '.svw .svr-rank-l'));

  test('the un-clamped rule exists, scoped to .svw, covering both selectors', () => {
    expect(rule).toBeDefined();
  });

  test('white-space:normal, overflow:visible, text-overflow:clip — no unconditional ellipsis', () => {
    expect(decl(rule.body, 'white-space')).toBe('normal');
    expect(decl(rule.body, 'overflow')).toBe('visible');
    expect(decl(rule.body, 'text-overflow')).toBe('clip');
  });

  test('the console\'s own .svr-bar-l / .svr-rank-l are untouched — still nowrap + ellipsis', () => {
    const svrStripped = strip(SVR_CSS);
    expect(svrStripped).toMatch(/\.svr-bar-l\s*\{[^}]*white-space:\s*nowrap/);
    expect(svrStripped).toMatch(/\.svr-bar-l\s*\{[^}]*text-overflow:\s*ellipsis/);
    expect(svrStripped).toMatch(/\.svr-rank-l\s*\{[^}]*white-space:\s*nowrap/);
    expect(svrStripped).toMatch(/\.svr-rank-l\s*\{[^}]*text-overflow:\s*ellipsis/);
  });
});

describe('the terminal clamp lives ONLY behind [data-clamped="on"], never in the base rule', () => {
  const clampRule = STAGE_RULES.find((r) => hasSelector(r, '.content[data-clamped="on"] .svw .svr-bar-l')
    && hasSelector(r, '.content[data-clamped="on"] .svw .svr-rank-l'));

  test('the clamp rule exists, gated on [data-clamped="on"]', () => {
    expect(clampRule).toBeDefined();
  });

  test('it applies a 2-line clamp, the same shape .opt .txt\'s own terminal rule uses', () => {
    expect(decl(clampRule.body, '-webkit-line-clamp')).toBe('2');
    expect(decl(clampRule.body, 'display')).toBe('-webkit-box');
    expect(decl(clampRule.body, 'overflow')).toBe('hidden');
  });

  test('no OTHER rule for these two selectors carries a clamp outside [data-clamped]', () => {
    const offenders = STAGE_RULES.filter((r) => (hasSelector(r, '.svw .svr-bar-l') || hasSelector(r, '.svw .svr-rank-l'))
      && /webkit-line-clamp/.test(r.body));
    expect(offenders).toEqual([]);
  });
});

describe('the fitter can actually see these two elements (useStageFit.js CONTENT)', () => {
  test('.svw .svr-bar-l and .svw .svr-rank-l are both in the CONTENT whitelist', () => {
    const m = USE_STAGE_FIT.match(/const CONTENT = '([^']+)'/);
    expect(m).not.toBeNull();
    const selectors = m[1].split(',');
    expect(selectors).toContain('.svw .svr-bar-l');
    expect(selectors).toContain('.svw .svr-rank-l');
  });
});

/**
 * FIX ROUND 1, M4: stage-scale track heights for the choice bar and the rank
 * strip, so they read at 25 feet rather than at the console's 14px/10px.
 * Token-derived, per profile — `--bar-h` already varies by profile
 * (room 8px / tv 12px / call 10px / table 5px, stage.css's own four
 * `:root.d-*` blocks) — rather than a second, unrelated literal.
 */
describe('choice bars and the rank strip get stage-scale track heights (M4)', () => {
  const barTrack = STAGE_RULES.find((r) => hasSelector(r, '.svw .svr-bar-t'));
  const rankStrip = STAGE_RULES.find((r) => hasSelector(r, '.svw .svr-rank-strip'));

  test('both rules exist, scoped to .svw', () => {
    expect(barTrack).toBeDefined();
    expect(rankStrip).toBeDefined();
  });

  test('height is derived from --bar-h (a per-profile token), never a raw pixel', () => {
    expect(decl(barTrack.body, 'height')).toMatch(/var\(--bar-h\)/);
    expect(decl(rankStrip.body, 'height')).toMatch(/var\(--bar-h\)/);
    expect(barTrack.body).not.toMatch(/height:\s*\d+px/);
    expect(rankStrip.body).not.toMatch(/height:\s*\d+px/);
  });

  test('--bar-h itself really does vary per profile (the premise)', () => {
    const values = new Set();
    for (const head of [':root.d-room{', ':root.d-tv{', ':root.d-call{', ':root.d-table{']) {
      const start = STAGE.indexOf(head);
      const body = STAGE.slice(start, STAGE.indexOf('}', start));
      const m = body.match(/--bar-h\s*:\s*([^;]+);/);
      if (m) values.add(m[1].trim());
    }
    expect(values.size).toBeGreaterThan(1);
  });
});

/**
 * FIX ROUND 1, I2: the presenter's own "N answered" line (`.rule-note`,
 * s-02/s-04's own class) — found undeclared while reviewing this round:
 * SurveyWalkthrough.jsx renders it, but nothing in stage.css gave it a
 * font-size or a colour, which means it would have rendered as unstyled
 * browser-default text rather than stage-scale type. Ported from the
 * mockups' own rule verbatim (`.rule-note{font-size:var(--t-meta);
 * color:var(--muted);font-weight:700;letter-spacing:.06em}`, s-02-choice.html
 * / s-04-yesno.html), sitting beside `.recap`/`.qdetail` — the OTHER content
 * typography rules a question's slide uses — not inside `.svw`, since it is
 * a sibling of `.svw` in the markup, not a descendant.
 */
describe('.rule-note ("N answered") is styled with stage tokens', () => {
  const rule = STAGE_RULES.find((r) => hasSelector(r, '.rule-note'));

  test('the rule exists', () => {
    expect(rule).toBeDefined();
  });

  test('reads the label tier (--t-meta), never a pixel', () => {
    expect(decl(rule.body, 'font-size')).toBe('var(--t-meta)');
  });

  test('colour is --muted, already measured against the stage field above', () => {
    expect(decl(rule.body, 'color')).toBe('var(--muted)');
  });
});

describe('the track fill clears 3:1 (non-text) against its own track — choice bars and the rank strip', () => {
  // The fill/track COLOURS are unchanged from SurveyResults.css (M4 only
  // changes height); this re-measures them because the walk-through is the
  // first place they are asserted at all — surveyResultsPalette.test.js
  // never covered this specific pairing for the console either.
  const svrStripped = strip(SVR_CSS);
  const svrRule = (selector) => {
    const found = rulesOf(svrStripped).find((r) => hasSelector(r, selector));
    if (!found) throw new Error(`no console rule for "${selector}"`);
    return found.body;
  };
  const TRACK_TOKENS = {
    text: T.text,
    muted: T.muted,
    primary: T.primary,
    'surface-2': T.surface2,
    secondary: tokenIn(GLOBAL_CSS, ':root {', '--secondary'),
    'primary-deep': tokenIn(GLOBAL_CSS, ':root {', '--primary-deep'),
  };
  const tokenColour = (value) => {
    const m = String(value).match(/^var\(--([a-z0-9-]+)\)$/);
    if (!m || !TRACK_TOKENS[m[1]]) throw new Error(`colour "${value}" is not one of the tokens this test knows`);
    return TRACK_TOKENS[m[1]];
  };
  const NON_TEXT = 3;

  test('the choice bar\'s track and its two fills', () => {
    const track = tokenColour(decl(svrRule('.svr-bar-t'), 'background'));
    const fill = tokenColour(decl(svrRule('.svr-bar-t i'), 'background'));
    const topFill = tokenColour(decl(svrRule('.svr-bar.is-top .svr-bar-t i'), 'background'));
    expect(ratio(parseHex(fill), parseHex(track))).toBeGreaterThanOrEqual(NON_TEXT);
    expect(ratio(parseHex(topFill), parseHex(track))).toBeGreaterThanOrEqual(NON_TEXT);
  });

  test('the rank strip\'s track and its lead segment', () => {
    const track = tokenColour(decl(svrRule('.svr-rank-strip'), 'background'));
    const p1 = tokenColour(decl(svrRule('.svr-p1'), 'background'));
    expect(ratio(parseHex(p1), parseHex(track))).toBeGreaterThanOrEqual(NON_TEXT);
  });
});
