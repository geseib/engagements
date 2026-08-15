/**
 * THE CSS CONTRACT FOR THE PLAYER'S OWN DEVICE.
 *
 * NAMED `*Palette*`, NEVER `*Token*`. `.gitignore:35` is an unanchored
 * `*token*`, so a file called `playerSurfaceTokens.test.js` is invisible to
 * git: it runs locally, passes, and never reaches CI. Every palette test in
 * this repo carries this paragraph. Do not rename it back.
 *
 * WHAT GREEN HERE MEANS, AND WHAT IT DOES NOT.
 *
 * jest maps CSS to `identity-obj-proxy` and loads no stylesheet; jsdom has no
 * layout engine, resolves no custom property across files, and returns zeroes
 * from every getBoundingClientRect. So this file reads
 * `components/PlayerSurface.css` AS TEXT and does arithmetic on it. Green means
 * "the contract has not been reverted". It does NOT mean the surface works on a
 * phone or on a laptop.
 *
 * Four of the design's own ten audit checks are geometric and CANNOT be
 * asserted anywhere in this repo — A1 (nothing scrolls sideways), A2 (the page
 * itself never scrolls), A3 (the dock is fully on screen at rest) and A4 (every
 * target is 44x44). What is pinned instead is the CSS that makes each of them
 * possible, read by exact selector, plus the structural facts jsdom does model
 * (roles, accessible names, document order) which live in
 * `playerSurface.test.jsx`.
 *
 * PHONE AND LAPTOP ARE BOTH PRIMARY. Both ladders are asserted, rung by rung,
 * against the numbers RATIONALE §3.3 derived. Neither is allowed to become the
 * other's scaled copy.
 */
const fs = require('fs');
const path = require('path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const GLOBAL_CSS = read('styles.css');
const PLR_CSS = read('components', 'PlayerSurface.css');
const PLR_JSX = read('PlayerPage.jsx');

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

/* ---- tokens, READ rather than retyped: change a token and these numbers move ---- */
const parseHex = (h) => [1, 3, 5].map((i) => parseInt(h.substr(i, 2), 16));

function token(css, block, name) {
  const start = css.indexOf(block);
  if (start < 0) throw new Error(`no ${block} block`);
  const body = css.slice(start, css.indexOf('}', start));
  const m = body.match(new RegExp(`${name}\\s*:\\s*(#[0-9A-Fa-f]{6})`));
  if (!m) throw new Error(`${name} not declared in ${block}`);
  return m[1];
}
function tint(name) {                       // an rgba() layer from PLR_CSS
  const m = PLR_CSS.match(new RegExp(`${name}\\s*:\\s*(rgba\\([^)]*\\))`));
  if (!m) throw new Error(`${name} not declared in PlayerSurface.css`);
  return m[1];
}

const ROOT = ':root {';
/* THE PLAYER SURFACE PAINTS DUSK UNDER A PAPER DOCUMENT. public/index.html puts
   data-theme="light" on <html>, so these are read from styles.css's EXPLICIT
   dusk block — the same one AdminShell, WelcomeScreen and AuthChrome rely on —
   rather than from :root, because :root is not what applies here. */
const DUSK = '[data-theme="dark"] {';
const T = {
  bg: token(GLOBAL_CSS, DUSK, '--bg'),
  surface: token(GLOBAL_CSS, DUSK, '--surface'),
  surface2: token(GLOBAL_CSS, DUSK, '--surface-2'),
  text: token(GLOBAL_CSS, DUSK, '--text'),
  shippedMuted: token(GLOBAL_CSS, DUSK, '--muted'),
  primary: token(GLOBAL_CSS, ROOT, '--primary'),
  secondary: token(GLOBAL_CSS, ROOT, '--secondary'),
  success: token(GLOBAL_CSS, ROOT, '--success'),
  danger: token(GLOBAL_CSS, ROOT, '--danger'),
  muted: token(PLR_CSS, '.plr {', '--plr-muted'),
  successText: token(PLR_CSS, '.plr {', '--plr-success-text'),
};

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
const FIELD = [T.bg];                 // the shell's own background
const CARD = [T.bg, T.surface];       // a --surface card on that field
const NESTED = [T.bg, T.surface2];    // .plr-row--mine, a pressed mode button

/* strip comments before ANY textual assertion — a previous test in this repo
   passed on prose in a header comment. */
const stripped = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const CSS = stripped(PLR_CSS);

/** The declaration body for one exact selector. Throws if it was renamed,
 *  which is the point: a silently-missing rule is a silently-missing fix. */
function block(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`(^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`, 'm'));
  if (!match) throw new Error(`No rule for "${selector}" — renamed?`);
  return match[2];
}

/* ==========================================================================
   1. EVERY FLAT PAIRING THIS SURFACE PAINTS
   ==========================================================================
   Named for the thing on screen, not for the token: when one fails you want to
   know which control went unreadable. No black-lift model — a phone is a
   direct-view emissive panel, so the measured number is the number
   (RATIONALE §4.1). */

describe('the flat pairings the player surface paints', () => {
  const pairs = [
    ['--text on the shell (questions, options, response text)', T.text, FIELD],
    ['--plr-muted on the shell (the bar, labels, help, the look-up cue)', T.muted, FIELD],
    ['--text on a card (the receipt, the session brief)', T.text, CARD],
    ['--plr-muted on a card (card labels, the filled ballot slot)', T.muted, CARD],
    ['--text on a nested row (your own trivia answer)', T.text, NESTED],
    ['--plr-muted on a nested row (its option letter and flag)', T.muted, NESTED],
    ['--primary on the shell (the join error, the Yours flag)', T.primary, FIELD],
    ['--primary on a card (the Yours flag on your ballot row)', T.primary, CARD],
    ['--plr-success-text on the shell (the Submitted label)', T.successText, FIELD],
    ['--plr-success-text on a card (the Correct flag)', T.successText, CARD],
    ['--plr-success-text on a nested row', T.successText, NESTED],
    ['--bg on --primary (the dock button, the pressed rank)', T.bg, [T.primary]],
  ];
  test.each(pairs)('%s clears AA', (_l, fg, layers) => {
    expect(on(fg, layers)).toBeGreaterThanOrEqual(AA);
  });
});

/* ==========================================================================
   2. EVERY TINTED COMPOSITE
   ==========================================================================
   The half a token table cannot show. #F6A94C measured on --bg says nothing
   about #F4EDE4 on --bg + rgba(246,169,76,.11). Each stack below is the REAL
   nesting, and the two amber ones are stacks of TWO rather than three on
   purpose: `.plr-opt[aria-checked="true"]` sets `background` outright, so the
   tint replaces --surface rather than sitting on it. */

describe('the tinted composites', () => {
  test('a selected trivia option — the one amber idea', () => {
    expect(on(T.text, [T.bg, tint('--plr-amber-tint')])).toBeGreaterThanOrEqual(AA);
    expect(on(T.muted, [T.bg, tint('--plr-amber-tint')])).toBeGreaterThanOrEqual(AA);
  });

  /* rejects: --success being used for the "Correct" flag instead of the local
              lighter tint. It clears AA on --surface-2 by 0.04:1, so an
              AA-only assertion cannot tell the two apart — a mutation swapping
              #6FD0A4 for #4FB286 survived the first cut of this file, and the
              CSS header was overclaiming as a result. What is actually being
              bought is MARGIN: RATIONALE §3.4 already buys two or three
              arcminutes of type for glare, an angled screen and a one-handed
              grip at the back of a room, and the one green flag on this surface
              gets the same allowance rather than sitting on the threshold. */
  const MARGIN = 5.5;
  test('the success tint has margin over AA, not just compliance', () => {
    expect(ratio(parseHex(T.success), parseHex(T.surface2))).toBeLessThan(MARGIN);  // the premise
    expect(ratio(parseHex(T.success), parseHex(T.surface2))).toBeGreaterThanOrEqual(AA);
    expect(on(T.successText, NESTED)).toBeGreaterThanOrEqual(MARGIN);
    expect(on(T.successText, CARD)).toBeGreaterThanOrEqual(MARGIN);
    expect(on(T.successText, FIELD)).toBeGreaterThanOrEqual(MARGIN);
  });

  test('the offline banner, which is amber and never red', () => {
    expect(on(T.text, [T.bg, tint('--plr-amber-banner')])).toBeGreaterThanOrEqual(AA);
    expect(on(T.muted, [T.bg, tint('--plr-amber-banner')])).toBeGreaterThanOrEqual(AA);
  });
});

/* ==========================================================================
   3. THE THEME AND THE MARKUP CONVERTED IN THE SAME CHANGE
   ==========================================================================
   Stated in both directions: dusk markup on a paper field is #F4EDE4 body copy
   on white at 1.2:1; paper markup on a dusk field is #333 on #0F1A2E at 1.4:1.
   The Question sets tab shipped as the second one. `public/index.html` puts
   data-theme="light" on <html>, so this surface MUST re-declare dusk on its own
   root or every screen below renders at 1.2:1. */

describe('the surface declares its own theme', () => {
  test('the scope root carries data-theme="dark"', () => {
    expect(PLR_JSX).toMatch(/className="plr"[^>]*data-theme="dark"/);
  });

  test('PlayerPage imports the stylesheet that theme is useless without', () => {
    expect(PLR_JSX).toMatch(/import\s+'\.\/components\/PlayerSurface\.css'/);
  });

  test('nothing on this surface is left to the paper-theme globals', () => {
    // The three container classes the shipped screen resolved against
    // styles.css. Their absence is what proves the conversion happened rather
    // than a stylesheet merely being added alongside the old one.
    expect(PLR_JSX).not.toMatch(/className="player-outer-container-full"/);
    expect(PLR_JSX).not.toMatch(/className="player-container"/);
    expect(PLR_JSX).not.toMatch(/className="join-screen"/);
  });
});

/* ==========================================================================
   4. COLOUR DISCIPLINE
   ========================================================================== */

describe('colour comes from tokens', () => {
  test('no hex literal survives outside the token block', () => {
    const declarations = CSS.replace(/\.plr\s*\{[^}]*\}/, '');   // the token DEFINITIONS only
    const literals = [...declarations.matchAll(/(?:^|[\s:(])(#[0-9A-Fa-f]{3,8})\b/g)].map((m) => m[1]);
    expect(literals).toEqual([]);
  });

  test('the two deliberate literals are the two that are argued for', () => {
    // --plr-muted #B6C2D4 — RATIONALE §4.1 measured styles.css's shipped
    // #9BA8BE, found it passes here too, and kept the lighter tint anyway so the
    // room's surface and the phone's cannot drift onto two body-text greys.
    // --plr-success-text #6FD0A4 — styles.css has never declared a
    // --success-text, and --success is only 4.54:1 on --surface-2.
    const tokenBlock = CSS.match(/\.plr\s*\{[^}]*\}/)[0];
    const literals = [...tokenBlock.matchAll(/(#[0-9A-Fa-f]{6})/g)].map((m) => m[1].toUpperCase());
    expect([...new Set(literals)].sort()).toEqual(['#6FD0A4', '#B6C2D4']);
  });

  test('the shipped --muted would also have passed, which is what makes it a choice', () => {
    // Re-asserted so the comment above cannot quietly become false. If this ever
    // fails, keeping #B6C2D4 stops being a consistency preference and becomes a
    // requirement, and the CSS header needs rewriting to say so.
    expect(on(T.shippedMuted, FIELD)).toBeGreaterThanOrEqual(AA);
    expect(on(T.muted, FIELD)).toBeGreaterThan(on(T.shippedMuted, FIELD));
  });

  test('--danger never carries text here', () => {
    // The premise, re-asserted so it cannot go vacuous: #E5645E is under AA on
    // --surface, which is why --danger-text and --danger-deep exist at all.
    expect(ratio(parseHex(T.danger), parseHex(T.surface))).toBeLessThan(AA);
    const offenders = CSS.split('\n').filter((l) => /(^|[^-])\bcolor\s*:\s*var\(--danger\)/.test(l));
    expect(offenders).toEqual([]);
  });

  test('red is not used at all on this surface', () => {
    // RATIONALE §4.2: red means destructive, only. A wrong trivia answer is not
    // destructive and neither is being offline — both were red on the shipped
    // screen. Nothing here is destructive, so nothing here is red.
    expect(CSS).not.toMatch(/var\(--danger[a-z-]*\)/);
  });

  test('every custom property the stylesheet uses is declared somewhere', () => {
    // An undefined custom property invalidates the WHOLE declaration, not just
    // the value — that is how stage.css dropped every card border on the floor.
    const declared = new Set();
    for (const css of [GLOBAL_CSS, PLR_CSS]) {
      for (const m of css.matchAll(/(--[a-z0-9-]+)\s*:/gi)) declared.add(m[1]);
    }
    const used = [...PLR_CSS.matchAll(/var\((--[a-z0-9-]+)/gi)].map((m) => m[1]);
    expect([...new Set(used)].filter((n) => !declared.has(n))).toEqual([]);
  });
});

/* ==========================================================================
   5. THE NAMESPACE, BOTH WAYS
   ==========================================================================
   The incident: the first cut of the question-sets screen was scoped `.qs`, and
   styles.css already owned `.qs-editor`, `.qs-panel`, `.qs-empty` and sixteen
   more, so the new dark empty state was repainted grey and italic by a rule
   nobody had read. No component test can catch that — jest maps CSS to
   identity-obj-proxy and loads no stylesheet, so the collision exists only in
   the bundle. These two assertions are the substitute and BOTH are required. */

const roots = () => {
  const out = new Set();
  for (const blk of CSS.split('}')) {
    const head = blk.split('{')[0];
    if (!head || head.includes('@')) continue;
    for (const sel of head.split(',')) {
      const m = sel.trim().match(/^[a-zA-Z]*\.([\w-]+)/);
      if (m) out.add(m[1]);
    }
  }
  return [...out];
};

/** Every string literal in a snippet of JS, template interpolations included.
 *  A regex cannot do this: `plr-q${folded ? ' plr-q--fold' : ''}` is one
 *  attribute holding three literals, and pairing quote characters off against
 *  each other reads the ternary's operators as class names. */
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

describe('the .plr namespace', () => {
  test('every selector is rooted at the scope class', () => {
    expect(roots().filter((n) => !n.startsWith('plr'))).toEqual([]);
  });

  /* THE OTHER HALF OF THE NAMESPACE, AND IT IS IN THE MARKUP.
     The two assertions around this one read stylesheets, which catches a rule
     that escapes the scope. Neither catches the reverse — a class from the
     monolith riding INTO the scope on an element — and that is how the surface
     actually decayed: `plr-opt trivia-option active` sat on every trivia option
     after the conversion, and `.btn-primary btn-large` on the join refusal,
     because a stylesheet test has nothing to say about a string in a JSX
     attribute. Both were paper-theme globals on a dusk shell.

     Names arriving through a PROP are out of scope here on purpose:
     `surfaceClassName="plr-spot"` is how the player re-tints the host's
     spotlight, and the spotlight's own class names belong to styles.css. What
     this pins is that no element the player's page renders ITSELF resolves
     against the monolith. */
  test('the markup carries no class from outside the scope either', () => {
    const jsx = PLR_JSX
      .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')   // {/* … */} — prose names classes
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');
    /* Read the whole className expression, brace-balanced, then take every
       string literal inside it. A regex that stops at the first quote gets the
       ternaries wrong — `plr-q${folded ? ' plr-q--fold' : ''}` is one attribute
       with three literals in it, and half a dozen of this page's classes are
       written that way. */
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
    expect(names.size).toBeGreaterThan(20);          // the extractor still works
    expect([...names].filter((n) => !/^plr(-|$)/.test(n))).toEqual([]);
  });

  test('styles.css declares nothing in this scope', () => {
    const global = [...stripped(GLOBAL_CSS).matchAll(/\.(plr[\w-]*)/g)].map((m) => m[1]);
    expect([...new Set(global)]).toEqual([]);
  });

  test('stage.css declares nothing in this scope either', () => {
    const stage = [...stripped(read('styles', 'stage.css')).matchAll(/\.(plr[\w-]*)/g)].map((m) => m[1]);
    expect([...new Set(stage)]).toEqual([]);
  });
});

/* ==========================================================================
   6. THE LADDERS — THREE OF THEM, LITERAL, ONE PER CONTEXT
   ==========================================================================
   NEVER A MULTIPLIER. The host stage shipped `--k` declared on :root and then
   multiplied against :root, which substitutes against that element's own value
   of 1: all four display profiles rendered identically and only the boxes
   shrank. One literal ladder per breakpoint cannot fail that way.

   `rem`, not `px`, is load-bearing: it makes the reader's own browser text-size
   control the real viewing-distance adjustment (WCAG 1.4.4), which RATIONALE
   §3.5 says is the honest answer to width being a poor proxy for distance. */

const REM = (px) => `${px / 16}rem`;

const LADDERS = {
  phone: { at: '.plr {', hero: 34, primary: 24, secondary: 19, body: 16, meta: 13 },
  tablet: { at: '@media (min-width: 768px)', hero: 40, primary: 28, secondary: 22, body: 19, meta: 15 },
  laptop: { at: '@media (min-width: 1200px)', hero: 45, primary: 32, secondary: 26, body: 21, meta: 17 },
};

describe('the type ladders, rung by rung', () => {
  const bodyOf = (at) => {
    const i = CSS.indexOf(at);
    if (i < 0) throw new Error(`no ${at}`);
    return CSS.slice(i, CSS.indexOf('}', CSS.indexOf('{', CSS.indexOf('{', i) + 1)) + 1);
  };

  for (const [context, ladder] of Object.entries(LADDERS)) {
    const rungs = ['hero', 'primary', 'secondary', 'body', 'meta'];
    test.each(rungs)(`${context}: --plr-t-%s is the derived size`, (rung) => {
      const want = REM(ladder[rung]);
      expect(bodyOf(ladder.at)).toMatch(new RegExp(`--plr-t-${rung}:\\s*${want.replace('.', '\\.')}\\b`));
    });
  }

  test('the phone and the laptop are different ladders, not one scaled', () => {
    // 34/24/19/16/13 and 45/32/26/21/17 hold the same five angular sizes at 14in
    // and at 24in. If they ever became a constant ratio apart, somebody has
    // reintroduced the multiplier the stage was burned by.
    const ratios = ['hero', 'primary', 'secondary', 'body', 'meta']
      .map((r) => LADDERS.laptop[r] / LADDERS.phone[r]);
    expect(new Set(ratios.map((r) => r.toFixed(3))).size).toBeGreaterThan(1);
  });

  test('nothing is declared below the 13px phone floor', () => {
    // The floor here is NOT angular (RATIONALE §3.4): run the stage's 8.3' at a
    // phone's distance and density and you get 6.7px, which is nonsense. It is
    // set by iOS's input-zoom threshold, by glare, and by 13px being where a
    // label stops being a rung.
    const rems = [...CSS.matchAll(/font-size:\s*([\d.]+)rem/g)].map((m) => Number(m[1]) * 16);
    expect(rems.filter((n) => n < 13)).toEqual([]);
    const px = [...CSS.matchAll(/font-size:\s*(\d+)px/g)].map((m) => Number(m[1]));
    expect(px).toEqual([]);
  });

  test('every input renders at --plr-t-secondary, which is 19px and never 16 or less', () => {
    // iOS Safari zooms the page when a focused input is under 16px: the layout
    // jumps and the player loses their place mid-sentence. 19px is the ladder's
    // secondary rung and clears it with margin.
    expect(LADDERS.phone.secondary).toBeGreaterThan(16);
    for (const sel of ['.plr-inp', '.plr-select']) {
      expect(block(CSS, sel)).toMatch(/font-size:\s*var\(--plr-t-secondary\)/);
    }
  });

  test('numbers do not jitter', () => {
    expect(block(CSS, '.plr')).toMatch(/font-variant-numeric:\s*tabular-nums/);
  });
});

/* ==========================================================================
   7. GEOMETRY CONTRACTS, READ AS TEXT
   ==========================================================================
   jsdom cannot see any of this. Reading the declaration by exact selector is
   the only honest substitute, and it is worth having: three of the four
   incidents these pin have each recurred in this repo. */

describe('the shell is what makes "scroll to read, never to act" structural', () => {
  test('the shell itself does not scroll', () => {
    const shell = block(CSS, '.plr');
    expect(shell).toMatch(/overflow:\s*hidden/);
    expect(shell).toMatch(/display:\s*flex/);
    expect(shell).toMatch(/flex-direction:\s*column/);
  });

  test('the shell measures itself in dvh, with vh only as the fallback beneath it', () => {
    // On iOS `vh` is the LARGE viewport — measured as if the toolbars were
    // hidden — so a vh-sized shell puts its own dock under the browser chrome.
    const shell = block(CSS, '.plr');
    expect(shell.indexOf('height: 100vh')).toBeGreaterThanOrEqual(0);
    expect(shell.indexOf('height: 100dvh')).toBeGreaterThan(shell.indexOf('height: 100vh'));
  });

  test('the stage is the one scrolling region, and its overflow actually exists', () => {
    const stage = block(CSS, '.plr-stage');
    expect(stage).toMatch(/overflow-y:\s*auto/);
    // Without this a flex item's default min-height:auto resolves to content
    // height, the overflow never exists, and overflow-y has nothing to act on —
    // which is exactly why the setup panel's Switch-game button "did not work".
    expect(stage).toMatch(/min-height:\s*0/);
    expect(stage).toMatch(/flex:\s*1/);
  });

  test('the dock is a flex row outside the scrolling region, never position:fixed', () => {
    // `position: fixed` on iOS Safari interacts badly with the collapsing URL
    // bar and with the soft keyboard, which is how a primary action ends up
    // under the browser chrome at the moment it is needed.
    const dock = block(CSS, '.plr-dock');
    expect(dock).not.toMatch(/position:\s*fixed/);
    expect(dock).toMatch(/flex:\s*none/);
    expect(dock).toMatch(/env\(safe-area-inset-bottom/);
  });

  test('a wide window is absorbed by the gutter, not by the content', () => {
    // A phone layout stretched to 1280px is not a laptop design; it is a phone
    // design nobody stopped. Both wide contexts cap the content and give the
    // rest to the gutter.
    for (const at of ['@media (min-width: 768px)', '@media (min-width: 1200px)']) {
      const i = CSS.indexOf(at);
      const chunk = CSS.slice(i, i + 600);
      expect(chunk).toMatch(/--plr-gut:\s*clamp\([^)]*100% - \d+px/);
    }
  });

  test('the truncating elements are single text nodes with min-width:0', () => {
    // `text-overflow` on a flex container with span children is INERT and the
    // text is silently cut instead. The host stage had to fix this twice.
    const ctx = block(CSS, '.plr-ctx');
    expect(ctx).toMatch(/min-width:\s*0/);
    expect(ctx).toMatch(/text-overflow:\s*ellipsis/);
    expect(ctx).toMatch(/white-space:\s*nowrap/);
  });

  test('a row action group never uses flex-end inside a clipped row', () => {
    // Flex-end overflows toward the START, where a hidden overflow is
    // unreachable by any scroll, drag or resize — that is how the console's
    // Edit and Rename were clipped on their left edge.
    const tail = block(CSS, '.plr-row .plr-tail');
    expect(tail).toMatch(/margin-left:\s*auto/);
    expect(tail).not.toMatch(/justify-content:\s*flex-end/);
  });

  test('every tappable thing carries the 44px minimum', () => {
    // A4 measures this on a device and cannot be measured here. What CAN be
    // pinned is that the declaration exists on each of them, including the two
    // places it is easiest to cheat: the rank buttons and the Show-all control.
    expect(block(CSS, '.plr-btn')).toMatch(/min-height:\s*56px/);
    for (const sel of ['.plr-rk', '.plr-slot', '.plr-mode', '.plr-more', '.plr-chip']) {
      expect(block(CSS, sel)).toMatch(/min-height:\s*var\(--plr-tap\)/);
    }
    expect(block(CSS, '.plr')).toMatch(/--plr-tap:\s*44px/);
    // The rank row is the tightest in the design and carries its 8px gap.
    expect(block(CSS, '.plr-ranks')).toMatch(/gap:\s*8px/);
  });
});

/* ==========================================================================
   7b. THE SPOTLIGHT, RE-TINTED RATHER THAN FORKED
   ==========================================================================
   `Show all ↓` opens `components/AnswerSpotlight.jsx` — the HOST's dialog,
   shared with `PastRound`, painted from the styles.css monolith for the paper
   theme. Mounted beside the shell it rendered a white card with
   #F6A94C-on-#FFFFFF Previous/Next buttons over a dusk ballot.

   Two halves, and both are needed. The premises below read styles.css, so an
   override cannot quietly go vacuous when somebody fixes the global sheet; the
   overrides read PlayerSurface.css, so the fix cannot quietly be reverted. */

describe('the spotlight is dressed by this surface, not by the monolith', () => {
  const SPOT = (() => {
    const i = GLOBAL_CSS.indexOf('.answer-spotlight {');
    if (i < 0) throw new Error('no .answer-spotlight in styles.css — renamed?');
    return GLOBAL_CSS.slice(i, GLOBAL_CSS.indexOf('.cards .card.is-openable', i));
  })();

  test('the premises: styles.css really does hardcode paper into it', () => {
    // If any of these three stops being true, the matching override below is
    // dead weight and should go — but it must be REMOVED deliberately, not
    // left sitting there asserting nothing.
    expect(SPOT).toMatch(/border-top:\s*1px solid rgba\(0,\s*0,\s*0,\s*0?\.1\)/);
    expect(SPOT).toMatch(/background:\s*rgba\(0,\s*0,\s*0,\s*0?\.07\)/);
    // #F6A94C on #FFFFFF is 1.96:1 — the one pairing SKILL §1 rules out
    // outright. This is what the nav buttons inherit.
    const btn = GLOBAL_CSS.slice(GLOBAL_CSS.indexOf('.btn-secondary {'));
    expect(btn.slice(0, btn.indexOf('}'))).toMatch(/background:\s*white/);
    expect(ratio(parseHex(T.primary), [255, 255, 255])).toBeLessThan(AA);
  });

  test('every one of them is restated in a token this surface measures', () => {
    for (const sel of [
      '.plr-spot .answer-spotlight__meta',
      '.plr-spot .answer-spotlight__close:hover',
      '.plr-spot .answer-spotlight__nav .btn-secondary',
    ]) {
      expect(block(CSS, sel)).toMatch(/var\(--(plr-)?[a-z0-9-]+\)/);
    }
    expect(block(CSS, '.plr-spot .answer-spotlight__meta')).toMatch(/border-top:\s*1px solid var\(--plr-rule\)/);
    const nav = block(CSS, '.plr-spot .answer-spotlight__nav .btn-secondary');
    expect(nav).toMatch(/background:\s*transparent/);
    expect(nav).toMatch(/color:\s*var\(--text\)/);
    // A dead end says so. styles.css declares no disabled state at all, so
    // Previous on the first response looked identical to a live control.
    expect(block(CSS, '.plr-spot .answer-spotlight__nav .btn-secondary[disabled]'))
      .toMatch(/color:\s*var\(--plr-muted\)/);
  });

  test('a bare opacity is replaced by a colour, because an opacity cannot be measured', () => {
    // `opacity: .65` and `.7` were tuned against white; on --surface they
    // composite to something no token table shows, which is precisely the
    // failure SKILL §4 names. --plr-muted on a card is measured in §1 above.
    expect(SPOT).toMatch(/opacity:\s*0?\.65/);
    for (const sel of [
      '.plr-spot .answer-spotlight__count',
      '.plr-spot .answer-spotlight__tally small',
    ]) {
      expect(block(CSS, sel)).toMatch(/color:\s*var\(--plr-muted\)/);
      expect(block(CSS, sel)).toMatch(/opacity:\s*1\b/);
    }
  });

  test('the response is read at a rung of this ladder, not at a fourth one', () => {
    // styles.css sizes it `clamp(1.15rem, 2.4vw, 1.75rem)` — a viewport-keyed
    // ladder, on a surface RATIONALE §3.3 gives exactly three literal ones.
    expect(SPOT).toMatch(/font-size:\s*clamp\(/);
    expect(block(CSS, '.plr-spot .answer-spotlight__text'))
      .toMatch(/font-size:\s*var\(--plr-t-secondary\)/);
  });

  /* THE ONE THING NO RENDERED TEST CAN CATCH. The dialog is
     `position: fixed` and lives INSIDE `.plr`, which is `overflow: hidden`. A
     fixed element is clipped by an ancestor's overflow only when that ancestor
     is its containing block — which needs `transform`, `filter`, `perspective`,
     `backdrop-filter`, `contain` or `will-change`. None of those exist on this
     surface today. The day one is added for a "polish" pass, the spotlight
     disappears on a device and every assertion in this repo still passes,
     because jsdom computes no layout at all. */
  test('no ancestor of the dialog may become its containing block', () => {
    for (const sel of ['.plr', '.plr-stage', '.plr-dock']) {
      const rule = block(CSS, sel);
      expect(rule).not.toMatch(/(^|[\s;])transform:/);
      expect(rule).not.toMatch(/(^|[\s;])filter:/);
      expect(rule).not.toMatch(/(^|[\s;])backdrop-filter:/);
      expect(rule).not.toMatch(/(^|[\s;])perspective:/);
      expect(rule).not.toMatch(/(^|[\s;])contain:/);
      expect(rule).not.toMatch(/(^|[\s;])will-change:/);
    }
  });
});

/* ==========================================================================
   8. THE RULES THIS DESIGN SAYS IT MUST NEVER BREAK
   ========================================================================== */

describe('the design rules that outlive this change', () => {
  test('no CSS on this surface can reorder a ballot', () => {
    // RATIONALE §6.2. `Response N` is 1-based, absolute and in array order, and
    // vote indices map to array position. A stylesheet CAN reorder a list
    // visually while leaving the DOM alone, which would break the room's shared
    // reference without touching a line of JavaScript.
    expect(CSS).not.toMatch(/(?:^|[\s;{])order:\s*-?\d/m);   // `border: 0` is not an order
    expect(CSS).not.toMatch(/flex-direction:\s*(column|row)-reverse/);
    expect(CSS).not.toMatch(/direction:\s*rtl/);
  });

  test('nothing animates, because nothing here means "wait"', () => {
    // §9.11. The screen this replaced animated a pulsing dot that meant "do
    // nothing" — motion in the peripheral vision of a room that is supposed to
    // be listening to somebody.
    expect(CSS).not.toMatch(/@keyframes/);
    expect(CSS).not.toMatch(/animation:/);
    expect(CSS).not.toMatch(/transition:/);
  });

  test('the stylesheet loads no external asset', () => {
    // A10. Three cross-origin .webp layers, loading="eager", above the question,
    // on the slowest connection in the building, is what this replaces.
    expect(CSS).not.toMatch(/url\(\s*['"]?https?:/);
    expect(CSS).not.toMatch(/@import/);
  });
});
