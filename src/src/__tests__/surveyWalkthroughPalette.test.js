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
