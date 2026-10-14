/**
 * THE SURVEY'S CSS CONTRACT ON THE PHONE.
 *
 * NAMED `*Palette*`, NEVER `*Token*`. `.gitignore:35` is an unanchored
 * `*token*`, so a file called `surveyPhoneTokens.test.js` is invisible to git:
 * it runs locally, passes, and never reaches CI. Every palette test in this
 * repo carries this paragraph. Do not rename it.
 *
 * WHAT IT PINS. The survey's rules are a section of `components/
 * PlayerSurface.css` (cut from docs/design/survey-redesign/_src/
 * survey-phone.css, the mockups' own diff against the shipped player), so
 * `playerSurfacePalette.test.js` already holds them to the surface's general
 * rules — no hex outside the token block, no px font sizes, nothing below the
 * 13px floor, no red, nothing animated, every selector under `.plr`. This file
 * adds what is particular to a survey: the contrast of each new pairing,
 * composited up the real ancestor chain; the 15px floor for anything a person
 * types into or taps; the tap floor on the new controls; the progress strip;
 * and that the survey's markup carries only `.plr` classes that exist.
 *
 * WHAT GREEN MEANS. jsdom has no layout engine and loads no stylesheet, so this
 * reads the CSS as TEXT and does arithmetic on it. Green means "the contract
 * has not been reverted" — never "this is legible on a phone at arm's length".
 * Only a device can say that.
 */
const fs = require('fs');
const path = require('path');
const H = require('../testing/skinHarness');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const GLOBAL_CSS = read('styles.css');
const PLR_CSS = read('components', 'PlayerSurface.css');
const stripped = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const CSS = stripped(PLR_CSS);

/* Dusk under a paper document: `.plr` re-declares data-theme="dark" on its own root, so
   every value is resolved for the DARK theme, per skin, through the harness (skins ->
   roles -> the .plr block), never retyped and never read from :root. */
const plrVar = (name, skin) => H.scopeVar(PLR_CSS, '.plr {', name, { skin, theme: 'dark' });
function palette(skin) {
  const r = (name) => H.role(name, { skin, theme: 'dark' });
  return {
    bg: r('--bg'), surface: r('--surface'), text: r('--text'), primary: r('--primary'),
    success: r('--success'), muted: plrVar('--plr-muted', skin),
  };
}
const on = (fg, layers) => H.on(fg, layers);
const ratio = (a, b) => H.ratio(a, b);
const AA = H.AA;

/** The declaration body for one exact selector; throws if it was renamed. */
function block(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = CSS.match(new RegExp(`(^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`, 'm'));
  if (!match) throw new Error(`No rule for "${selector}" — renamed?`);
  return match[2];
}

/* ==========================================================================
   1. MEASURED CONTRAST
   ========================================================================== */

describe.each(H.SKINS)('the pairings a survey paints (%s)', (skin) => {
  const T = palette(skin);
  const FIELD = [T.bg];
  const CARD = [T.bg, T.surface];
  const tint = (name) => plrVar(name, skin);
  // The headline figure the plan quotes: a chosen step, yes or no. --bg and --primary
  // (the filled step reads var(--primary) directly) are the same in every skin today.
  test('#0F1A2E on #F6A94C — a chosen step, yes or no, a placed rank — is 8.86:1', () => {
    expect(T.bg.toUpperCase()).toBe('#0F1A2E');
    expect(T.primary.toUpperCase()).toBe('#F6A94C');
    expect(ratio(T.bg, T.primary)).toBeCloseTo(8.86, 1);
    expect(block('.plr-step[aria-checked="true"]')).toMatch(/background:\s*var\(--primary\)/);
    expect(block('.plr-step[aria-checked="true"]')).toMatch(/color:\s*var\(--bg\)/);
    expect(block('.plr-rank-row--placed .plr-pl')).toMatch(/background:\s*var\(--primary\)/);
    expect(block('.plr-rank-row--placed .plr-pl')).toMatch(/color:\s*var\(--bg\)/);
  });

  const pairs = [
    ['a scale digit and a ranked item on their --surface step', T.text, CARD],
    ['the end labels, "Question 3 · optional" and the rule line on the field', T.muted, FIELD],
    ['an unplaced item on the field (its row is transparent)', T.text, FIELD],
    ['"Skipped — optional" in the review, amber on the field', T.primary, FIELD],
    ['a review answer, and the "Change" link, on the field', T.text, FIELD],
    ['the counter nearing its limit, amber on the field', T.primary, FIELD],
    ['an unavailable option at the pick limit, muted on its --surface row', T.muted, CARD],
    ['an item past a ranking\'s top N, muted on the field (its row is transparent)', T.muted, FIELD],
  ];
  test.each(pairs)('%s clears AA', (_label, fg, layers) => {
    expect(on(fg, layers)).toBeGreaterThanOrEqual(AA);
  });

  test('stars: the unlit glyph on the field, the lit run and the chosen one on their amber tint', () => {
    expect(block('.plr-stars .plr-step')).toMatch(/color:\s*var\(--plr-muted\)/);
    expect(block('.plr-stars .plr-step')).toMatch(/background:\s*transparent/);
    expect(on(T.muted, FIELD)).toBeGreaterThanOrEqual(AA);
    expect(block('.plr-stars .plr-step[aria-checked="true"]')).toMatch(/background:\s*var\(--plr-amber-tint\)/);
    expect(on(T.primary, [T.bg, tint('--plr-amber-tint')])).toBeGreaterThanOrEqual(AA);
  });

  test('the write-in, ticked: its text on the amber-tinted panel', () => {
    expect(block('.plr-other.plr-other--on')).toMatch(/background:\s*var\(--plr-amber-tint\)/);
    expect(on(T.text, [T.bg, tint('--plr-amber-tint')])).toBeGreaterThanOrEqual(AA);
  });

  test('the two-minute warning reuses the amber banner, and its text clears AA on it', () => {
    expect(on(T.text, [T.bg, tint('--plr-amber-banner')])).toBeGreaterThanOrEqual(AA);
  });

  test('"Not saved" is amber, never red — being offline is not destructive', () => {
    expect(block('.plr-saved.plr-saved--bad i')).toMatch(/background:\s*var\(--primary\)/);
    expect(block('.plr-saved i')).toMatch(/background:\s*var\(--success\)/);
    expect(CSS).not.toMatch(/var\(--danger[a-z-]*\)/);
  });
});

/* ==========================================================================
   2. SIZE: INPUTS AT 15px OR MORE, TARGETS AT 44px OR MORE
   ========================================================================== */

const REM = { secondary: 19, body: 16, primary: 24, hero: 34, meta: 13 };
const phoneRung = (name) => {
  const m = block('.plr').match(new RegExp(`--plr-t-${name}:\\s*([\\d.]+)rem`));
  return Number(m[1]) * 16;
};

describe('what a person types into or taps is never small', () => {
  test('the phone rungs the inputs use are 15px or more', () => {
    expect(phoneRung('secondary')).toBe(REM.secondary);
    expect(phoneRung('body')).toBe(REM.body);
    for (const rung of ['secondary', 'body']) expect(phoneRung(rung)).toBeGreaterThanOrEqual(15);
  });

  test('every text field a survey adds inherits .plr-inp, which is --plr-t-secondary', () => {
    expect(block('.plr-inp')).toMatch(/font-size:\s*var\(--plr-t-secondary\)/);
    for (const sel of ['.plr-inp.plr-inp--other', '.plr-inp.plr-inp--note']) {
      expect(block(sel)).not.toMatch(/font-size/);
    }
  });

  test.each([
    ['.plr-step', 'secondary'],
    ['.plr-yn .plr-step', 'primary'],
    ['.plr-stars .plr-step', 'hero'],
    ['.plr-it', 'secondary'],
    ['.plr-mv button', 'secondary'],
  ])('%s renders at --plr-t-%s', (sel, rung) => {
    expect(block(sel)).toMatch(new RegExp(`font-size:\\s*var\\(--plr-t-${rung}\\)`));
    expect(phoneRung(rung)).toBeGreaterThanOrEqual(15);
  });

  // rejects: an item past the top N that looks exactly like one on offer — a
  // tap that does nothing, on a control that says it would.
  test('an item past a ranking\'s top N is visibly not on offer: muted, no pointer', () => {
    const rule = block('.plr-rank-row--unplaced .plr-it[aria-disabled="true"]');
    expect(rule).toMatch(/color:\s*var\(--plr-muted\)/);
    expect(rule).toMatch(/cursor:\s*default/);
  });

  test('the new controls carry the tap floor', () => {
    expect(block('.plr-step')).toMatch(/min-height:\s*56px/);
    expect(block('.plr-yn .plr-step')).toMatch(/min-height:\s*88px/);
    expect(block('.plr-it')).toMatch(/min-height:\s*var\(--plr-tap\)/);
    expect(block('.plr-mv button')).toMatch(/width:\s*var\(--plr-tap\)/);
    expect(block('.plr-mv button')).toMatch(/height:\s*var\(--plr-tap\)/);
    expect(block('.plr-rev-ed')).toMatch(/min-height:\s*var\(--plr-tap\)/);
    expect(block('.plr-rank-row')).toMatch(/min-height:\s*56px/);
  });

  test('ten steps wrap rather than shrinking below the floor', () => {
    expect(block('.plr-scale')).toMatch(/grid-template-columns:\s*repeat\(5,\s*minmax\(0,\s*1fr\)\)/);
    expect(block('.plr-scale.plr-scale--wrap')).toMatch(/grid-template-columns:\s*repeat\(6,\s*minmax\(0,\s*1fr\)\)/);
  });
});

/* ==========================================================================
   3. THE SHAPE p-01 … p-12 DRAW
   ========================================================================== */

describe('the survey section', () => {
  test.each([
    '.plr-scale', '.plr-step', '.plr-ends', '.plr-yn', '.plr-follow', '.plr-rank', '.plr-rank-h',
    '.plr-rev', '.plr-saved', '.plr-pair', '.plr-rule', '.plr-qno', '.plr-req',
  ])('%s has a rule', (sel) => {
    expect(() => block(sel)).not.toThrow();
  });

  test('the progress strip grows in the 4px band already there, with a default', () => {
    const strip = block('.plr-strip.plr-strip--prog');
    expect(strip).toMatch(/--plr-progress:\s*0%/);
    expect(strip).toMatch(/linear-gradient\(90deg,\s*var\(--primary\)\s+0\s+var\(--plr-progress\),\s*var\(--plr-rule\)\s+var\(--plr-progress\)\s+100%\)/);
  });

  test('a closed or ended survey paints the strip in the success colour, as p-09 does', () => {
    expect(block('.plr[data-phase="done"]')).toMatch(/--plr-phase:\s*var\(--success\)/);
  });

  test('Back and Next share the dock as a quiet half and a filled half', () => {
    expect(block('.plr-pair')).toMatch(/grid-template-columns:\s*minmax\(0,\s*\.62fr\)\s+minmax\(0,\s*1fr\)/);
    expect(block('.plr-pair .plr-btn + .plr-btn')).toMatch(/margin-top:\s*0/);
  });

  test('the follow-up opens in place, under a primary rule', () => {
    expect(block('.plr-follow')).toMatch(/border-left:\s*2px solid var\(--primary\)/);
  });
});

/* ==========================================================================
   4. THE MARKUP STAYS IN THE SCOPE, AND EVERY CLASS IT USES EXISTS
   ========================================================================== */

const SURVEY_FILES = [
  ['components', 'PlayerShell.jsx'],
  ['components', 'survey', 'SurveyRunner.jsx'],
  ['components', 'survey', 'RatingInput.jsx'],
  ['components', 'survey', 'ChoiceInput.jsx'],
  ['components', 'survey', 'YesNoInput.jsx'],
  ['components', 'survey', 'RankInput.jsx'],
  ['components', 'survey', 'TextInput.jsx'],
];

/** Every string literal in a snippet of JS, template interpolations included. */
function stringLiterals(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const quote = src[i];
    if (quote !== "'" && quote !== '"' && quote !== '`') { i += 1; continue; }
    i += 1;
    let buffer = '';
    while (i < src.length && src[i] !== quote) {
      if (src[i] === '\\') { i += 2; continue; }
      if (quote === '`' && src[i] === '$' && src[i + 1] === '{') {
        let depth = 0;
        const start = i + 1;
        for (; i < src.length; i += 1) {
          if (src[i] === '{') depth += 1;
          else if (src[i] === '}') { depth -= 1; if (depth === 0) break; }
        }
        out.push(...stringLiterals(src.slice(start + 1, i)));
        i += 1;
        continue;
      }
      buffer += src[i];
      i += 1;
    }
    out.push(buffer);
    i += 1;
  }
  return out;
}

function classNames(jsxSource) {
  const jsx = jsxSource
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
  const names = new Set();
  for (let i = jsx.indexOf('className='); i >= 0; i = jsx.indexOf('className=', i + 1)) {
    let j = i + 'className='.length;
    let expression;
    if (jsx[j] === '{') {
      let depth = 0;
      const start = j;
      for (; j < jsx.length; j += 1) {
        if (jsx[j] === '{') depth += 1;
        else if (jsx[j] === '}') { depth -= 1; if (depth === 0) break; }
      }
      expression = jsx.slice(start, j + 1);
    } else {
      const quote = jsx[j];
      expression = jsx.slice(j, jsx.indexOf(quote, j + 1) + 1);
    }
    for (const lit of stringLiterals(expression)) {
      for (const name of lit.split(/\s+/)) if (name) names.add(name);
    }
  }
  return names;
}

describe('the survey markup', () => {
  const all = new Set();
  for (const file of SURVEY_FILES) for (const n of classNames(read(...file))) all.add(n);

  test('carries only .plr classes — no paper-theme global rides in', () => {
    expect(all.size).toBeGreaterThan(30);            // the extractor still works
    expect([...all].filter((n) => !/^plr(-|$)/.test(n))).toEqual([]);
  });

  test('every class it uses is styled — a typo is an unstyled control', () => {
    // Classes that are pure state hooks for a descendant rule still appear in
    // the stylesheet text; `plr-helpbtn` is dressed in §11 of the same file.
    const missing = [...all].filter((n) => !CSS.includes(`.${n}`));
    expect(missing).toEqual([]);
  });
});
