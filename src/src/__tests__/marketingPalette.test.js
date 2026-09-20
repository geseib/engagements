/**
 * THE MARKETING SURFACE'S COLOUR, CONTRAST, NAMESPACE AND TYPE-LADDER CONTRACT.
 *
 * Named *Palette*, never *Token*: `.gitignore:35` is an unanchored `*token*`,
 * so a file matching it runs locally, passes, and never reaches CI. Do not
 * rename it back.
 *
 * THE HARNESS BELOW (`lin`, `lum`, `ratio`, `alphaOver`, `bgOf`, `parseHex`,
 * `composited`, `on`, `AA`) is copied verbatim from
 * `.claude/skills/engage-design/references/testing-a-surface.md` §1, which is
 * itself lifted from `docs/design/admin-redesign/audit.html`'s `<script>`
 * block. jest maps CSS to `identity-obj-proxy` and loads no stylesheet, and
 * jsdom has no layout engine and will not resolve `var(--x)` across files it
 * never loaded — so the only honest way to pin this contract is to read every
 * stylesheet as TEXT and do the contrast arithmetic here, building the real
 * paint stack by hand from tokens and tints read out of the files themselves.
 *
 * GREEN HERE MEANS the contrast arithmetic, the namespace and the ladder have
 * not been reverted. It CANNOT PROVE the hero headline is legible over the
 * moving scene in a real browser, that the scene's motion itself is calm, or
 * that a screen reader announces any of this sensibly — those are Task 1
 * Step 5 and Task 8 Step 6's job, and a manual/visual check, not this file's.
 * A green run says "the numbers this suite can compute still clear AA and the
 * scope rules still hold" — nothing about layout, motion or geometry, which
 * jsdom cannot see at all.
 */
const fs = require('fs');
const path = require('path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');

/* ============================================================ §1 the harness
   Copied verbatim from testing-a-surface.md §1. */
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
  if (!stack.length) return [15, 26, 46]; // the dusk field
  let out = stack[stack.length - 1][0];
  for (let i = stack.length - 2; i >= 0; i -= 1) out = alphaOver(stack[i][0], out, stack[i][1]);
  return out;
}
const parseHex = (h) => [1, 3, 5].map((i) => parseInt(h.substr(i, 2), 16));

/** Build the REAL paint stack in the DOM and hand it to the audit's own bgOf.
 *  First entry is the outermost layer; last is what the text sits on. */
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

/* ============================================================ the surface —
   built by READING THE DIRECTORY, not by listing files by hand, so a moved
   or newly-added marketing stylesheet is covered automatically instead of
   silently falling outside every check below. */
const MARKETING_DIR = path.join(__dirname, '..', 'marketing');
const COMPONENTS_SUBDIR = path.join(MARKETING_DIR, 'components');

const topLevelSheets = fs.readdirSync(MARKETING_DIR)
  .filter((f) => f.endsWith('.css'))
  .sort();
const componentSheets = fs.readdirSync(COMPONENTS_SUBDIR)
  .filter((f) => f.endsWith('.css'))
  .sort();

const SHEETS = {};
for (const f of topLevelSheets) SHEETS[f] = read('marketing', f);
for (const f of componentSheets) SHEETS[f] = read('marketing', 'components', f);

const GLOBAL_CSS = read('styles.css');
const JCE = read('components', 'JoinCodeEntry.css');
const ALL = Object.values(SHEETS).join('\n');
const stripped = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/* ==================================================================== §walk
 * A PROPER CSS WALKER, tracking brace depth, so a rule nested inside
 * `@media`/`@supports` is seen, and `@keyframes` is never mistaken for a
 * family of selectors.
 *
 * FIX ROUND 1, FINDING 1: the namespace check below used to split the whole
 * stylesheet on `}` and take each chunk's text up to its first `{` as one
 * "head", skipping any head containing `@`. Because a `@media (...) {` brace
 * and its FIRST nested rule's opening brace land in the same chunk (nothing
 * splits between them), that first nested rule's own selector was silently
 * skipped — every subsequent rule in the block was still seen (each gets its
 * own chunk from then on), but the first was not. A mis-namespaced selector
 * placed first inside a new `@media` block would never have been caught.
 * Reproduced and pinned in the self-test below:
 * `roots(".mk-ok{color:red} @media (max-width:720px){ .oops{color:blue} }")`
 * used to return `['mk-ok']` only.
 *
 * AUDIT OF THE OTHER `.split('}')`/per-rule sites in this file, per the
 * controller's request:
 *   - `classesDeclared()` (class-coverage check, below) matches `/\.\w+/g`
 *     directly against the whole stylesheet text with NO split and no `@`
 *     filtering, so it has no equivalent blind spot — a class named inside a
 *     nested `@media` rule is found exactly the same as one at the top
 *     level. Left as-is.
 *   - the "no hex literal outside a token block" scan strips `.mk-root {...}`
 *     with a plain substring regex, not a per-rule split — the regex matches
 *     the literal text `.mk-root { ... }` wherever it occurs, including
 *     inside the `@media (max-width: 720px)` wrapper, because the match does
 *     not depend on tracking outer nesting at all. No blind spot there
 *     either (confirmed: the narrow-width `.mk-root` override already relies
 *     on this and its declarations were never flagged as stray literals).
 *   - `roots()` (namespace test) was the ONE site with the bug, fixed below.
 *   - the new "amber never carries text on paper" structural check (finding
 *     2) is written directly on top of this same walker, so it does not
 *     re-introduce the bug in a second place.
 */
function walkRules(css, { onRule, onKeyframesName } = {}) {
  const text = stripped(css);
  const n = text.length;

  function findMatchingClose(openBraceIdx) {
    let depth = 0;
    let i = openBraceIdx;
    do {
      if (text[i] === '{') depth += 1;
      else if (text[i] === '}') depth -= 1;
      i += 1;
    } while (depth > 0 && i < n);
    return i - 1; // index of the matching '}', or n - 1 if unbalanced
  }

  let i = 0;
  while (i < n) {
    const braceIdx = text.indexOf('{', i);
    if (braceIdx === -1) break;
    const head = text.slice(i, braceIdx).trim();

    if (/^@(?:-\w+-)?keyframes\b/i.test(head)) {
      // Opaque: `from`/`to`/`NN%` are not selectors, only the animation's own
      // name is checked against the namespace.
      const m = head.match(/^@(?:-\w+-)?keyframes\s+([\w-]+)/i);
      if (m && onKeyframesName) onKeyframesName(m[1]);
      i = findMatchingClose(braceIdx) + 1;
    } else if (/^@(media|supports|document|-moz-document)\b/i.test(head)) {
      // Descend: the content between its braces is walked exactly like a
      // top-level stylesheet, so nested rules — including the FIRST one —
      // are visited by the same code path as everything else.
      const close = findMatchingClose(braceIdx);
      const inner = text.slice(braceIdx + 1, close);
      walkRules(inner, { onRule, onKeyframesName });
      i = close + 1;
    } else if (head.startsWith('@')) {
      // Other at-rules with a block (@font-face, @page, ...): no selectors
      // to collect, and not a keyframes name.
      i = findMatchingClose(braceIdx) + 1;
    } else if (head.length) {
      const close = findMatchingClose(braceIdx);
      const body = text.slice(braceIdx + 1, close);
      if (onRule) onRule(head, body);
      i = close + 1;
    } else {
      i = braceIdx + 1;
    }
  }
}

describe('the selector walker itself (self-test, so a broken walker cannot silently pass everything downstream)', () => {
  test('the reproduction case: a mis-namespaced selector as the FIRST rule inside @media is seen', () => {
    const found = [];
    walkRules('.mk-ok{color:red} @media (max-width:720px){ .oops{color:blue} }', {
      onRule: (head) => found.push(head),
    });
    expect(found).toEqual(['.mk-ok', '.oops']);
  });

  test('a nested rule AFTER the first is also seen', () => {
    const found = [];
    walkRules('@media (x){ .a{color:red} .b{color:blue} }', { onRule: (head) => found.push(head) });
    expect(found).toEqual(['.a', '.b']);
  });

  test('a selector list inside @media yields both selectors', () => {
    const found = [];
    walkRules('@media (x){ .a, .b { color:red } }', { onRule: (head) => found.push(head) });
    expect(found).toEqual(['.a, .b']);
  });

  test('a @keyframes block yields no selectors, only its name', () => {
    const rules = [];
    const names = [];
    walkRules('@keyframes mk-drift { 0% { opacity: 0 } 50% { opacity: .5 } to { opacity: 1 } }', {
      onRule: (head) => rules.push(head),
      onKeyframesName: (name) => names.push(name),
    });
    expect(rules).toEqual([]);
    expect(names).toEqual(['mk-drift']);
  });
});

test('the suite cannot silently check nothing: the marketing sheet list is non-empty and covers the shell', () => {
  // rejects: a rename or a move that quietly drops every sheet out of ALL —
  // a suite iterating an empty list is a suite that passes on anything.
  expect(topLevelSheets.length + componentSheets.length).toBeGreaterThan(0);
  expect(topLevelSheets).toContain('MarketingShell.css');
});

/* ---------------------------------------------------------------- tokens -- */
const mk = (name) => {
  const m = SHEETS['MarketingShell.css'].match(new RegExp(`${name}\\s*:\\s*(#[0-9A-Fa-f]{6})`));
  if (!m) throw new Error(`${name} not declared in MarketingShell.css`);
  return m[1];
};
const mkRgba = (name) => {
  const m = SHEETS['MarketingShell.css'].match(new RegExp(`${name}\\s*:\\s*(rgba\\([^)]*\\))`));
  if (!m) throw new Error(`${name} not declared in MarketingShell.css`);
  return m[1];
};

const T = {
  bg: mk('--mk-bg'), surface: mk('--mk-surface'), surface2: mk('--mk-surface-2'),
  text: mk('--mk-text'), muted: mk('--mk-muted'), amber: mk('--mk-amber'), amberHi: mk('--mk-amber-hi'),
  paper: mk('--mk-paper'), paperSurface: mk('--mk-paper-surface'),
  paperText: mk('--mk-paper-text'), paperMuted: mk('--mk-paper-muted'), amberInk: mk('--mk-amber-ink'),
  ridgeFront: mk('--mk-ridge-front'), ridgeMid: mk('--mk-ridge-mid'), ridgeBack: mk('--mk-ridge-back'),
  skyLow: mk('--mk-sky-low'),
};
const WASH = {
  nav: mkRgba('--mk-wash-nav'), card: mkRgba('--mk-wash-card'),
  a: mkRgba('--mk-wash-a'), b: mkRgba('--mk-wash-b'),
};

describe('the marketing tokens are the Warm Summit tokens, not a second palette', () => {
  const token = (block, name) => {
    const start = GLOBAL_CSS.indexOf(block);
    return GLOBAL_CSS.slice(start, GLOBAL_CSS.indexOf('}', start)).match(new RegExp(`${name}\\s*:\\s*(#[0-9A-Fa-f]{6})`))[1];
  };
  test.each([
    ['--mk-bg', T.bg, '[data-theme="dark"] {', '--bg'],
    ['--mk-surface', T.surface, '[data-theme="dark"] {', '--surface'],
    ['--mk-surface-2', T.surface2, '[data-theme="dark"] {', '--surface-2'],
    ['--mk-text', T.text, '[data-theme="dark"] {', '--text'],
    ['--mk-muted', T.muted, '[data-theme="dark"] {', '--muted'],
    ['--mk-amber', T.amber, ':root {', '--primary'],
  ])('%s matches the global token', (_n, value, block, name) => {
    expect(value.toUpperCase()).toBe(token(block, name).toUpperCase());
  });
});

/* ------------------------------------------------------ the washes, pinned
   Read from the stylesheet rather than hardcoded twice, and pinned here as
   exact numbers so a future edit to any of the four is a deliberate,
   reviewed change rather than a silent drift. */
describe('the four translucent washes are exactly these tokens', () => {
  test.each([
    ['--mk-wash-nav', WASH.nav, [15, 26, 46], 0.86],
    ['--mk-wash-card', WASH.card, [27, 41, 66], 0.82],
    ['--mk-wash-a', WASH.a, [15, 26, 46], 0.9],
    ['--mk-wash-b', WASH.b, [27, 41, 66], 0.92],
  ])('%s is rgba(%s) at the pinned opacity', (name, value, rgb, alpha) => {
    const m = value.match(/rgba\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)/);
    expect(m).not.toBeNull();
    expect([Number(m[1]), Number(m[2]), Number(m[3])]).toEqual(rgb);
    expect(Number(m[4])).toBeCloseTo(alpha, 5);
  });
});

/* ------------------------------------------------------- flat pairings — AA
   Every pairing is named for the THING ON SCREEN, not the token, so a
   failure tells you which control went unreadable. */
describe('every flat pairing these pages paint', () => {
  const FIELD = [T.bg];
  const SURF = [T.bg, T.surface];
  const SURF2 = [T.bg, T.surface2];
  test.each([
    ['headline and body copy on the dusk field', T.text, FIELD],
    ['lead and muted copy on the dusk field', T.muted, FIELD],
    ['kickers and links in amber on the field', T.amber, FIELD],
    ['copy in the --surface cards (problem statements, mode cards, flow steps, tally, exports, cases, callouts, help sidebar)', T.text, SURF],
    ['muted copy in the --surface cards', T.muted, SURF],
    ['amber in the --surface cards (flow numerals, mode tag border)', T.amber, SURF],
    ['copy on --surface-2 (hovered help-guide row, filled help toggle)', T.text, SURF2],
    ['muted copy on --surface-2', T.muted, SURF2],
    ['amber on --surface-2', T.amber, SURF2],
    ['the filled primary button (bg on amber)', T.bg, [T.amber]],
    ['the filled primary button, hovered (bg on amber-hi)', T.bg, [T.amberHi]],
    ['the pin numeral on the sample sheet (.mk-pin: bg on amber)', T.bg, [T.amber]],
    ['the numbered callout badge on /reports (.mk-callout-n: bg on amber)', T.bg, [T.amber]],
    ['the "steps" badge inside a dusk help guide (bg on amber)', T.bg, [T.amber]],
    ['headline copy over the front ridge fill', T.text, [T.ridgeFront]],
    ['headline copy over the mid ridge fill', T.text, [T.ridgeMid]],
    ['headline copy over the back ridge fill', T.text, [T.ridgeBack]],
    ['report body copy on the paper sheet', T.paperText, [T.paperSurface]],
    ['report meta and byline copy on the paper sheet', T.paperMuted, [T.paperSurface]],
    ['report kicker and vote counts in amber ink on the paper sheet', T.amberInk, [T.paperSurface]],
  ])('%s clears AA', (_label, fg, layers) => {
    expect(on(fg, layers)).toBeGreaterThanOrEqual(AA);
  });

  /*
   * FIX ROUND 1, FINDING 2: this used to scan only `SampleReport.css` for
   * `color: var(--mk-amber)`, so `ClipStill.css`'s `.mk-ss--paper` rules —
   * the OTHER paper surface the rule names — were never checked at all.
   * Made structural instead: walk EVERY marketing stylesheet (the walker
   * from above, so a rule nested in `@media` is covered too) and inspect
   * every rule whose selector mentions `.mk-report` or `.mk-ss--paper`
   * ANYWHERE in it (so `.mk-report-title`, `.mk-ss--paper .mk-ss-code`, etc.
   * are all in scope, not only the bare class itself).
   */
  describe('amber never carries text on either paper surface (.mk-report*, .mk-ss--paper)', () => {
    const PAPER_SELECTOR = /\.mk-report\b|\.mk-ss--paper\b/;
    const paperRules = [];
    for (const [file, css] of Object.entries(SHEETS)) {
      walkRules(css, {
        onRule: (head, body) => { if (PAPER_SELECTOR.test(head)) paperRules.push({ file, head, body }); },
      });
    }

    test('the scan found the paper surface’s own rules (cannot silently check nothing)', () => {
      expect(paperRules.length).toBeGreaterThan(10);
      expect(paperRules.some((r) => r.file === 'SampleReport.css')).toBe(true);
      expect(paperRules.some((r) => r.file === 'ClipStill.css')).toBe(true);
    });

    test('--mk-amber (the premise: too dark on paper) is less than AA on --mk-paper-surface', () => {
      expect(ratio(parseHex(T.amber), parseHex(T.paperSurface))).toBeLessThan(AA);
    });

    test('no paper rule sets color: var(--mk-amber)', () => {
      const offenders = paperRules.filter((r) => /(^|[^-])\bcolor\s*:\s*var\(--mk-amber\)/.test(r.body));
      expect(offenders.map((r) => `${r.file}: ${r.head}`)).toEqual([]);
    });

    /* --mk-amber-hi / --mk-amber-deep are not banned outright — if a paper
     * rule ever uses one as `color`, MEASURE it against every paper token
     * rather than assuming failure, and only flag it if it actually fails. */
    test('any use of --mk-amber-hi or --mk-amber-deep as paper text also clears AA on every paper token', () => {
      const PAPER_TOKENS = { paper: T.paper, paperSurface: T.paperSurface };
      const hiOrDeepUsers = paperRules.filter((r) => /(^|[^-])\bcolor\s*:\s*var\(--mk-amber-(hi|deep)\)/.test(r.body));
      const failing = [];
      for (const rule of hiOrDeepUsers) {
        const m = rule.body.match(/(^|[^-])\bcolor\s*:\s*var\(--mk-amber-(hi|deep)\)/);
        const tokenValue = m[2] === 'hi' ? T.amberHi : mk('--mk-amber-deep');
        for (const [tokenName, bg] of Object.entries(PAPER_TOKENS)) {
          if (ratio(parseHex(tokenValue), parseHex(bg)) < AA) failing.push(`${rule.file}: ${rule.head} on ${tokenName}`);
        }
      }
      expect(failing).toEqual([]);
    });
  });
});

/* -------------------------------------------------------- tinted composites
   Half a token table cannot show a tint. Each stack is the real nesting: the
   fixed ridge scene behind, then the translucent wash a section or the nav
   paints over it, then the text. */
describe('the tinted composites over the moving scene', () => {
  const behind = (hex) => `rgb(${parseHex(hex).join(',')})`;

  test('nav copy over the sticky bar, over the back ridge (the tallest opaque thing usually behind it)', () => {
    expect(on(T.muted, [behind(T.ridgeBack), WASH.nav])).toBeGreaterThanOrEqual(AA);
    expect(on(T.text, [behind(T.ridgeBack), WASH.nav])).toBeGreaterThanOrEqual(AA);
  });
  test('the hero join card, over the back ridge', () => {
    expect(on(T.muted, [behind(T.ridgeBack), WASH.card])).toBeGreaterThanOrEqual(AA);
    expect(on(T.text, [behind(T.ridgeBack), WASH.card])).toBeGreaterThanOrEqual(AA);
  });
  test('section washes a/b, over the back ridge', () => {
    expect(on(T.muted, [behind(T.ridgeBack), WASH.a])).toBeGreaterThanOrEqual(AA);
    expect(on(T.muted, [behind(T.ridgeBack), WASH.b])).toBeGreaterThanOrEqual(AA);
  });

  /*
   * THE BRIGHTEST THING THE FIXED SCENE CAN PUT BEHIND A WASH.
   *
   * The scene (RidgeScene.css) is `position: fixed`, so any section's wash
   * can scroll to sit over ANY part of it — not only the ridge fills. Reading
   * the file: `.mk-ridge-glow`'s radial gradient peaks at
   * `rgba(246,169,76,0.82)` (the first, brightest stop), and it paints
   * BEFORE the three ridge-layer <svg>s in DOM order (RidgeScene.jsx), so a
   * ridge fill that overlaps it can occlude it outright. The candidate
   * backdrops for "glow composited over X" are therefore the sky gradient's
   * own brightest stop (`--mk-sky-low`) and each opaque ridge fill.
   *
   * Computed relative luminance (the same formula as `lum` above) of the
   * four candidates: ridge-front 0.017, ridge-mid 0.034, sky-low 0.042,
   * ridge-back 0.054 — `--mk-ridge-back` is the brightest, ahead of the sky's
   * own lowest stop. So the worst case this suite can construct is the glow
   * peak composited over `--mk-ridge-back`, then the wash over THAT, then the
   * text. This is deliberately more conservative than "glow over sky": it is
   * not a claim that the glow visually shows through an opaque ridge-back
   * fill (it does not — ridge-back paints after the glow and is opaque), only
   * that no other reachable backdrop in this fixed scene is brighter, so
   * clearing AA against it clears AA against everything the scene can
   * actually show.
   */
  const GLOW_PEAK = 'rgba(246, 169, 76, 0.82)';
  const brightestBehind = [behind(T.ridgeBack), GLOW_PEAK];

  test.each([
    ['nav copy', T.muted, WASH.nav],
    ['nav headline', T.text, WASH.nav],
    ['hero join card copy', T.muted, WASH.card],
    ['section wash a copy', T.muted, WASH.a],
    ['section wash b copy', T.muted, WASH.b],
  ])('%s over a wash, over the brightest thing the scene can put behind it, clears AA', (_l, fg, wash) => {
    expect(on(fg, [...brightestBehind, wash])).toBeGreaterThanOrEqual(AA);
  });
});

test('--danger never carries text on the marketing surface or the join field', () => {
  const offenders = (ALL + JCE).split('\n').filter((l) => /(^|[^-])\bcolor\s*:\s*var\(--danger\)/.test(l));
  expect(offenders).toEqual([]);
});

/* --------------------------------------------------------- no stray hex --
   Tokens are declared in exactly two `.mk-root { … }` rules in
   MarketingShell.css (the main token block plus the "additional tokens"
   group, and the second rule with font/wash/rule/radius tokens) PLUS a
   `@media (max-width: 720px) { .mk-root { … } }` override. All three must be
   stripped before scanning, or the override block's own token values would
   read as stray literals. */
test('no hex literal survives outside a token-definition block', () => {
  const withoutRootRules = stripped(ALL).replace(/\.mk-root\s*\{[^}]*\}/g, '');
  const literals = [...withoutRootRules.matchAll(/(?:^|[\s:(])(#[0-9A-Fa-f]{3,8})\b/g)].map((m) => m[1]);
  expect(literals).toEqual([]);
});

/* JCE is deliberately OUTSIDE the check above: `.jce*` must render on `/`
   before `.mk-root` (and its tokens) are guaranteed to be in scope, so every
   token it uses carries a literal `var(--x, #fallback)` fallback instead.
   Its own check: every hex literal in the file sits inside such a fallback,
   AND equals the value that token actually holds today — so a token edit
   that forgets to update the matching fallback goes red here. */
describe('JoinCodeEntry.css fallbacks agree with the tokens they fall back from', () => {
  const DANGER_TEXT = (() => {
    const start = GLOBAL_CSS.indexOf(':root {');
    const body = GLOBAL_CSS.slice(start, GLOBAL_CSS.indexOf('}', start));
    return body.match(/--danger-text\s*:\s*(#[0-9A-Fa-f]{6})/)[1];
  })();
  const TOKEN_VALUES = {
    '--mk-text': T.text,
    '--mk-amber': T.amber,
    '--mk-bg': T.bg,
    '--mk-muted': T.muted,
    '--danger-text': DANGER_TEXT,
  };

  const fallbackPairs = [...JCE.matchAll(/var\((--[a-z0-9-]+)\s*,\s*(#[0-9A-Fa-f]{3,8})\)/gi)];

  test('the suite cannot silently check nothing: JCE declares at least one var()-with-hex-fallback', () => {
    expect(fallbackPairs.length).toBeGreaterThan(0);
  });

  test('every hex literal in the file lives inside a var() fallback', () => {
    const allHex = [...JCE.matchAll(/#[0-9A-Fa-f]{3,8}/g)].map((m) => m[0]);
    const inFallback = fallbackPairs.map((m) => m[2]);
    // Every literal hex found anywhere in the file must be accounted for by
    // a fallback pair — a hex outside var(..., #hex) would show up here as
    // an literal present in allHex but absent from inFallback's multiset.
    const remaining = [...allHex];
    for (const hex of inFallback) {
      const i = remaining.indexOf(hex);
      if (i >= 0) remaining.splice(i, 1);
    }
    expect(remaining).toEqual([]);
  });

  test.each(fallbackPairs.map((m) => [m[1], m[2]]))('%s falls back to its own current value (%s)', (name, fallbackHex) => {
    const current = TOKEN_VALUES[name];
    expect(current).toBeDefined();
    expect(fallbackHex.toUpperCase()).toBe(current.toUpperCase());
  });
});

/* --------------------------------------------------- custom properties used
   An undefined custom property invalidates the WHOLE declaration. */
test('every custom property used is declared somewhere', () => {
  const declared = new Set();
  for (const css of [GLOBAL_CSS, ALL, JCE]) for (const m of css.matchAll(/(--[a-z0-9-]+)\s*:/gi)) declared.add(m[1]);
  // Set inline from JSX (RidgeScene.jsx's driftStyle), not from a stylesheet —
  // grep -rn "'--mk-" src/src/marketing --include=*.jsx found exactly this one.
  declared.add('--mk-drift');
  const used = [...(ALL + JCE).matchAll(/var\((--[a-z0-9-]+)/gi)].map((m) => m[1]);
  expect([...new Set(used)].filter((n) => !declared.has(n))).toEqual([]);
});

/* --------------------------------------------------------------- namespace
   Both ways: every selector this surface declares is rooted at its own
   prefix, and styles.css declares nothing in either scope. */
describe('the namespace, both ways', () => {
  /** Every leading class this stylesheet declares a rule for, AND every
   * `@keyframes` name it declares — via the brace-depth walker above, so a
   * rule nested inside `@media`/`@supports` (including the first one in the
   * block) is not silently skipped. */
  const roots = (css) => {
    const out = new Set();
    walkRules(css, {
      onRule: (head) => {
        for (const sel of head.split(',')) { const m = sel.trim().match(/^[a-zA-Z]*\.([\w-]+)/); if (m) out.add(m[1]); }
      },
      onKeyframesName: (name) => out.add(name),
    });
    return [...out];
  };
  test('every marketing selector is rooted at mk-', () => expect(roots(ALL).filter((n) => !n.startsWith('mk-'))).toEqual([]));
  test('every join-entry selector is rooted at jce', () => expect(roots(JCE).filter((n) => !n.startsWith('jce'))).toEqual([]));
  test('styles.css declares nothing in either scope', () => {
    const global = [...stripped(GLOBAL_CSS).matchAll(/\.((?:mk-|jce)[\w-]*)/g)].map((m) => m[1]);
    expect([...new Set(global)]).toEqual([]);
  });
});

/* ------------------------------------------------------------- the ladder */
describe('the type ladder', () => {
  const LADDER = { floor: '12px', label: '13px', body: '17px', lead: '21px', head: '30px', title: '44px', display: '68px' };
  test.each(Object.entries(LADDER))('--mk-t-%s is %s', (step, value) => {
    expect(SHEETS['MarketingShell.css']).toMatch(new RegExp(`--mk-t-${step}:\\s*${value}`));
  });

  const NARROW = { head: '25px', title: '32px', display: '42px' };
  test.each(Object.entries(NARROW))('the ≤720px override sets --mk-t-%s to %s', (step, value) => {
    const media = SHEETS['MarketingShell.css'].match(/@media \(max-width: 720px\) \{\s*\.mk-root \{([^}]*)\}/);
    expect(media).not.toBeNull();
    expect(media[1]).toMatch(new RegExp(`--mk-t-${step}:\\s*${value}`));
  });

  test('no stylesheet sets a font-size in px, or a font shorthand with a px value, outside a token block', () => {
    const withoutRootRules = stripped(ALL).replace(/\.mk-root\s*\{[^}]*\}/g, '');
    const fontSizePx = [...withoutRootRules.matchAll(/font-size:\s*(\d+)px/g)];
    const fontShorthandPx = [...withoutRootRules.matchAll(/(?<!-)\bfont:\s*[^;]*?(\d+)px[^;]*;/g)];
    expect(fontSizePx).toEqual([]);
    expect(fontShorthandPx).toEqual([]);
  });

  test('nothing in the ladder is under 12px, at any width (including the narrow override)', () => {
    const steps = [...SHEETS['MarketingShell.css'].matchAll(/--mk-t-[a-z]+:\s*(\d+)px/g)].map((m) => Number(m[1]));
    expect(steps.filter((n) => n < 12)).toEqual([]);
  });
});

/* ---------------------------------------------------- theme/markup, both --
   converted together. */
test('the paper surface converts theme and markup together (SampleReport)', () => {
  expect(read('marketing', 'components', 'SampleReport.jsx')).toMatch(/className="mk-report"\s+data-theme="light"/);
});

/* ------------------------------------------------------------ reduced motion
   Two independent animations in this surface: the ridge layers' scroll
   drift, and the join field's blinking caret. Both must be stilled in CSS,
   not only wherever JS happens to also gate them. */
test('reduced motion stills the ridge scene in CSS', () => {
  expect(SHEETS['RidgeScene.css']).toMatch(/prefers-reduced-motion:\s*reduce[\s\S]*--mk-drift:\s*0px/);
});
test('reduced motion stops the join field caret in CSS', () => {
  expect(JCE).toMatch(/prefers-reduced-motion:\s*reduce[\s\S]*animation:\s*none/);
});

/* --------------------------------------------------------- class coverage --
 * The repo's own `scopedClassesDeclared.test.js` does not know about
 * `src/src/marketing` (its SURFACES table assumes one jsx + one css per
 * component under `components/`, which the marketing surface — many pages,
 * many stylesheets, one prefix — does not fit). This is the equivalent check
 * for the whole surface at once, reusing that file's approach to extracting
 * class names from `className` attributes (string and template literals).
 */
describe('every class the marketing markup uses is a class some marketing stylesheet declares', () => {
  const MARKETING_JSX_FILES = [
    ...fs.readdirSync(MARKETING_DIR).filter((f) => f.endsWith('.jsx')).map((f) => path.join(MARKETING_DIR, f)),
    ...fs.readdirSync(COMPONENTS_SUBDIR).filter((f) => f.endsWith('.jsx')).map((f) => path.join(COMPONENTS_SUBDIR, f)),
  ];

  /** Class names appearing in className attributes: string literals, template
   * literals, and the array-join pattern (['a', cond ? 'b' : ''].join(' ')). */
  function classesUsedInFile(jsx) {
    const found = new Set();
    const attr = /className\s*=\s*(?:"([^"]*)"|\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\})/g;
    for (const m of jsx.matchAll(attr)) {
      const value = m[1] || m[2] || '';
      // Every bare `mk-word` or `mk-word--word` token appearing anywhere in
      // the attribute value, string-literal or template-literal alike.
      for (const hit of value.matchAll(/\bmk-[a-z0-9-]+\b/g)) found.add(hit[0]);
    }
    return [...found];
  }

  function classesUsedInJce(jsx) {
    const found = new Set();
    const attr = /className\s*=\s*(?:"([^"]*)"|\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\})/g;
    for (const m of jsx.matchAll(attr)) {
      const value = m[1] || m[2] || '';
      for (const hit of value.matchAll(/\bjce[a-z0-9-]*\b/g)) found.add(hit[0]);
    }
    return [...found];
  }

  function classesDeclared(css) {
    return new Set([...stripped(css).matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]));
  }

  const usedFromFiles = new Set();
  for (const file of MARKETING_JSX_FILES) {
    for (const cls of classesUsedInFile(fs.readFileSync(file, 'utf8'))) usedFromFiles.add(cls);
  }

  // DYNAMIC CLASS NAMES built from a variable rather than written literally,
  // enumerated from the source that builds them so a new variant is not
  // silently missed:
  //   - DeviceFrame.jsx: `mk-device mk-device--${kind}`; every `kind` a
  //     caller passes is one of clips.js's `frame` values.
  const clipsJs = fs.readFileSync(path.join(MARKETING_DIR, 'content', 'clips.js'), 'utf8');
  const deviceKinds = new Set([...clipsJs.matchAll(/slot\('([a-z]+)'/g)].map((m) => m[1]));
  expect(deviceKinds.size).toBeGreaterThan(0); // the scan that builds this list still finds slots
  for (const kind of deviceKinds) usedFromFiles.add(`mk-device--${kind}`);
  //   - ClipStill.jsx: `mk-ss${entry.extraClass}` where extraClass is '' or
  //     ' mk-ss--paper' (STILLS table) — both variants:
  usedFromFiles.add('mk-ss');
  usedFromFiles.add('mk-ss--paper');

  const declaredInSomeSheet = new Set();
  for (const css of Object.values(SHEETS)) for (const cls of classesDeclared(css)) declaredInSomeSheet.add(cls);

  test('the suite cannot silently check nothing: it found marketing classes to check', () => {
    expect(usedFromFiles.size).toBeGreaterThan(20);
  });

  test('every mk-* class used in marketing JSX is declared in some marketing stylesheet', () => {
    // FIX ROUND 1, FINDING 3 (controller ruling): no allow-list. The two
    // gaps this test found in the first draft (`mk-home`/`mk-problem`/
    // `mk-modes`/`mk-material`/`mk-react` in HomePage.jsx, dead and now
    // removed there; `mk-help-results` in HelpPage.jsx, live and now
    // declared in HelpPage.css) are both resolved in the shipped code, not
    // excused here.
    const missing = [...usedFromFiles].filter((c) => !declaredInSomeSheet.has(c)).sort();
    expect(missing).toEqual([]);
  });

  test('every jce* class used in JoinCodeEntry.jsx is declared in JoinCodeEntry.css', () => {
    const jceJsx = fs.readFileSync(path.join(__dirname, '..', 'components', 'JoinCodeEntry.jsx'), 'utf8');
    const used = classesUsedInJce(jceJsx);
    expect(used.length).toBeGreaterThan(0);
    const declared = classesDeclared(JCE);
    // FIX ROUND 1, FINDING 3: `jce-filled` (found undeclared by this test's
    // first draft) has been removed from JoinCodeEntry.jsx — RootPage.css's
    // `.entry-cell` family has no `.is-filled` counterpart to port, so there
    // was no real state being described. No allow-list.
    const missing = used.filter((c) => !declared.has(c));
    expect(missing).toEqual([]);
  });

  describe('the scan can actually fail', () => {
    test('it catches a class used and not declared', () => {
      const jsx = '<div className="mk-real mk-ghost" />';
      const used = classesUsedInFile(jsx);
      const declared = classesDeclared('.mk-real { color: red; }');
      expect(used).toEqual(expect.arrayContaining(['mk-real', 'mk-ghost']));
      expect(used.filter((c) => !declared.has(c))).toEqual(['mk-ghost']);
    });
    test('it ignores a class mentioned outside a className attribute', () => {
      const jsx = '/* mk-ghost is documented here */ <div className="mk-real" />';
      expect(classesUsedInFile(jsx)).toEqual(['mk-real']);
    });
  });
});
