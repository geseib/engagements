/**
 * THE TABLE LADDER REACHES THE PREVIEW'S CARD — and nothing else does.
 *
 * The set editor's preview draws the stage's own card at the Table profile, and
 * it must do that without touching :root, which carries the live stage's
 * profile class (components/stage/Stage.jsx). So styles/stage.css declares the
 * Table ladder on a scope class as well — `:root.d-table, .stage-ladder-table`
 * — and the card inherits it (spec 2026-09-19 §3.2).
 *
 * THE TRAP THIS FILE EXISTS FOR. A custom property declared ABOVE the wrapper
 * whose value is itself var() — `--t-primary: var(--L-primary)` on `body` — is
 * resolved once, up there, against :root's Room ladder, and the wrapper
 * inherits that resolved Room value. Redeclaring --L-* on the wrapper changes
 * nothing for it. That is how the retired --k scalar rendered four profiles
 * identically. So every custom property the card's rules read is followed
 * through its var() chain, and each one must either be re-derived on the scope
 * or be a literal that no profile varies.
 *
 * Read as text, because jsdom loads no stylesheet and resolves no custom
 * property. Green means the scope is wired, not that a browser draws it well.
 */
const fs = require('fs');
const path = require('path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** Every rule as { selectors, body }; @media bodies flattened, @keyframes skipped. */
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
    if (/^@(media|supports)/.test(head)) out.push(...rulesOf(body));
    else if (!head.startsWith('@')) {
      out.push({ selectors: head.split(',').map((s) => s.trim().replace(/\s+/g, ' ')), body });
    }
    i = j;
  }
  return out;
}

const declarations = (body) => [...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+)/g)]
  .map((m) => ({ name: m[1], value: m[2].trim() }));
const has = (rule, selector) => rule.selectors.includes(selector);

const STAGE_RULES = rulesOf(strip(read('styles', 'stage.css')));
const ALL_RULES = [...rulesOf(strip(read('styles.css'))), ...STAGE_RULES];

/* The card's DOM: h1.q, img.stage-art, p.qdetail, div.opts > div.opt >
   span.ltr/.txt/.fill/.pct, with .correct / .dim — components/QuestionCard.jsx.
   A rule is the card's when one of its selectors uses only these classes. */
const CARD_CLASSES = new Set(['q', 'qdetail', 'opts', 'list', 'opt', 'ltr', 'txt', 'fill', 'pct',
  'correct', 'dim', 'hero-row', 'stage-art', 'stage-ladder-table']);
const ELEMENT_CLASSES = new Set(['q', 'qdetail', 'opts', 'opt', 'ltr', 'txt', 'fill', 'pct', 'stage-art']);
const classesOf = (selector) => [...selector.matchAll(/\.([\w-]+)/g)].map((m) => m[1]);
const isCardSelector = (selector) => {
  if (/:root|(^|\s)(body|html)\b/.test(selector)) return false;
  const classes = classesOf(selector);
  return classes.length > 0
    && classes.every((c) => CARD_CLASSES.has(c))
    && classes.some((c) => ELEMENT_CLASSES.has(c));
};

const CARD_RULES = STAGE_RULES.filter((r) => r.selectors.some(isCardSelector));
const declsOf = (name) => ALL_RULES.flatMap((r) => declarations(r.body)
  .filter((d) => d.name === name).map((d) => ({ ...d, rule: r })));

/** Every custom property the card reads, followed through its var() chains. */
const READ = (() => {
  const seen = new Set(CARD_RULES.flatMap((r) => [...r.body.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1])));
  const queue = [...seen];
  while (queue.length) {
    const name = queue.pop();
    for (const d of declsOf(name)) {
      for (const m of d.value.matchAll(/var\((--[\w-]+)/g)) {
        if (!seen.has(m[1])) { seen.add(m[1]); queue.push(m[1]); }
      }
    }
  }
  return seen;
})();

/** Declared on something the wrapper inherits from: the root, html, body, a theme. */
const isAboveTheWrapper = (rule) => rule.selectors.some(
  (s) => /^:root\b/.test(s) || s === 'body' || s === 'html' || /^\[data-theme=/.test(s),
);
const TABLE = STAGE_RULES.find((r) => has(r, ':root.d-table'));
const OTHER_PROFILES = STAGE_RULES.filter((r) => [':root.d-room', ':root.d-tv', ':root.d-call'].some((p) => has(r, p)));

describe('the Table ladder, on the root and on the preview\'s scope', () => {
  test('one declaration, two selectors', () => {
    // rejects: a second copy of the Table ladder under a new class — two
    // declarations of the same ten values, one of which will drift.
    expect(TABLE).toBeDefined();
    expect(TABLE.selectors).toEqual([':root.d-table', '.stage-ladder-table']);
  });

  test('the premise: the card reads the ladder, so the checks below are not vacuous', () => {
    for (const name of ['--t-primary', '--t-secondary', '--t-body', '--measure', '--floor',
      '--hair', '--L-primary', '--L-secondary', '--L-body', '--measure-base']) {
      expect(READ.has(name)).toBe(true);
    }
  });

  test('every derived property the card reads is re-derived on the scope', () => {
    // rejects: widening only the ladder. --t-* and --measure are declared on
    // body as var(--L-*) and would reach the card at Room size.
    const stale = [...READ].filter((name) => {
      const decls = declsOf(name);
      const derivedAbove = decls.some((d) => isAboveTheWrapper(d.rule) && d.value.includes('var('));
      const onScope = decls.some((d) => has(d.rule, '.stage-ladder-table'));
      return derivedAbove && !onScope;
    });
    expect(stale).toEqual([]);
  });

  test('nothing a profile varies can leak into the scope from the root', () => {
    // rejects: leaving --hair out. `:root.d-call` sets it to 2px, and a Call
    // root would hand the preview's card Call's borders.
    const pinned = new Set(declarations(TABLE.body).map((d) => d.name));
    const leaks = [...READ].filter((name) => OTHER_PROFILES
      .some((r) => declarations(r.body).some((d) => d.name === name)) && !pinned.has(name));
    expect(leaks).toEqual([]);
  });

  test('the stage keeps its own derivation on body, beside the scope', () => {
    const derivation = STAGE_RULES.find((r) => has(r, 'body') && has(r, '.stage-ladder-table'));
    expect(derivation).toBeDefined();
    expect(declarations(derivation.body).map((d) => d.name).sort())
      .toEqual(['--measure', '--t-body', '--t-hero', '--t-meta', '--t-primary', '--t-secondary']);
  });

  test('the artwork rule reaches the card outside .content as well as inside it', () => {
    // `.content .stage-art` caps the picture at 44vh; the preview has no
    // .content and would draw a raster at its natural size.
    expect(STAGE_RULES.some((r) => has(r, '.content .stage-art') && has(r, '.stage-ladder-table .stage-art')))
      .toBe(true);
  });
});
