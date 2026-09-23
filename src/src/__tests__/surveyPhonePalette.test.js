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

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const GLOBAL_CSS = read('styles.css');
const PLR_CSS = read('components', 'PlayerSurface.css');
const stripped = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const CSS = stripped(PLR_CSS);

/* ---- colour: lifted verbatim from docs/design/admin-redesign/audit.html ---- */
function lin(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function lum(c) { return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]); }
function ratio(a, b) {
  const la = lum(a); const lb = lum(b);
  const h = Math.max(la, lb); const l = Math.min(la, lb);
  return (h + 0.05) / (l + 0.05);
}
function alphaOver(fg, bg, a) { return fg.map((c, i) => c * a + bg[i] * (1 - a)); }
/* Walk UP compositing every alpha layer. Reading only the element's own
   background is how dark-on-dark passes an audit. */
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
  if (!stack.length) return [15, 26, 46];          // the dusk field
  let out = stack[stack.length - 1][0];
  for (let i = stack.length - 2; i >= 0; i -= 1) out = alphaOver(stack[i][0], out, stack[i][1]);
  return out;
}

const parseHex = (h) => [1, 3, 5].map((i) => parseInt(h.substr(i, 2), 16));
function token(css, block, name) {
  const start = css.indexOf(block);
  if (start < 0) throw new Error(`no ${block} block`);
  const body = css.slice(start, css.indexOf('}', start));
  const m = body.match(new RegExp(`${name}\\s*:\\s*(#[0-9A-Fa-f]{6})`));
  if (!m) throw new Error(`${name} not declared in ${block}`);
  return m[1];
}
function tint(name) {
  const m = PLR_CSS.match(new RegExp(`${name}\\s*:\\s*(rgba\\([^)]*\\))`));
  if (!m) throw new Error(`${name} not declared in PlayerSurface.css`);
  return m[1];
}

/* Dusk under a paper document: read from styles.css's EXPLICIT dusk block, the
   one `.plr[data-theme="dark"]` resolves against, not from :root. */
const ROOT = ':root {';
const DUSK = '[data-theme="dark"] {';
const T = {
  bg: token(GLOBAL_CSS, DUSK, '--bg'),
  surface: token(GLOBAL_CSS, DUSK, '--surface'),
  text: token(GLOBAL_CSS, DUSK, '--text'),
  primary: token(GLOBAL_CSS, ROOT, '--primary'),
  success: token(GLOBAL_CSS, ROOT, '--success'),
  muted: token(PLR_CSS, '.plr {', '--plr-muted'),
};

function composited(layers) {
  document.body.innerHTML = '';
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
const FIELD = [T.bg];
const CARD = [T.bg, T.surface];

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

describe('the pairings a survey paints', () => {
  // The headline figure the plan quotes: a chosen step, yes or no.
  test('#0F1A2E on #F6A94C — a chosen step, yes or no, a placed rank — is 8.86:1', () => {
    expect(T.bg.toUpperCase()).toBe('#0F1A2E');
    expect(T.primary.toUpperCase()).toBe('#F6A94C');
    expect(ratio(parseHex(T.bg), parseHex(T.primary))).toBeCloseTo(8.86, 1);
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
