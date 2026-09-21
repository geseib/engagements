/**
 * NO COMPONENT STYLESHEET MAY STYLE A BARE ELEMENT.
 *
 * Every stylesheet a component imports lands in ONE bundle, so a rule written
 * `code { … }` in one component's sheet is a rule for every `<code>` in the app.
 * `documentation/documentation.css` — the help system's sheet — carried exactly
 * that:
 *
 *     code { background: #f3f4f6; color: var(--danger); padding: 2px 6px; … }
 *
 * and it painted a light grey chip behind inline code on ten other screens. The
 * set editor's Images panel re-pointed the TEXT colour to the dusk `--text`
 * (#F4EDE4) and never knew there was a background to undo, so the path, the file
 * names and the `https://` in its opening sentence were cream on light grey —
 * about 1.1:1, which is to say unreadable. Reported by the owner on 2026-09-20.
 *
 * The fix is at the source (scope the help rule to the help renderer), and this
 * is the guard: the failure was invisible to every per-surface palette suite,
 * because each of those reads its OWN stylesheet and the offending declaration
 * was in somebody else's.
 *
 * WHAT GREEN MEANS. No component stylesheet has a top-level rule — or a rule
 * inside @media/@supports — whose selector list contains a selector made only
 * of element names. It does not inspect `styles.css`, which is the app's one
 * deliberate global sheet, and it cannot see a leak through a class that two
 * components happen to share; `scopedClassesDeclared.test.js` and the per-surface
 * namespace checks own that.
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..');

/** The one sheet that is global on purpose. */
const GLOBAL_ON_PURPOSE = new Set(['styles.css']);

function cssFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '__tests__') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...cssFiles(full));
    else if (entry.name.endsWith('.css')) out.push(full);
  }
  return out;
}

const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * Every rule's selector list, descending into @media / @supports and skipping
 * @keyframes (whose `from` / `to` / `50%` are not selectors) and @font-face.
 */
function selectorLists(css) {
  const out = [];
  const text = stripComments(css);
  let i = 0;
  const walk = (end) => {
    while (i < end) {
      const open = text.indexOf('{', i);
      if (open < 0 || open >= end) { i = end; return; }
      const head = text.slice(i, open).trim();
      // find the matching close brace
      let depth = 1; let j = open + 1;
      while (j < text.length && depth > 0) { if (text[j] === '{') depth += 1; else if (text[j] === '}') depth -= 1; j += 1; }
      const close = j - 1;
      if (/^@(media|supports|layer|container)\b/.test(head)) {
        i = open + 1; walk(close); i = close + 1;
      } else if (head.startsWith('@')) {
        i = close + 1; // @keyframes, @font-face, @page: no selectors inside
      } else {
        out.push(head);
        i = close + 1;
      }
    }
  };
  walk(text.length);
  return out;
}

/** Split a selector list on its TOP-LEVEL commas: `:is(h2, h3) a, .b` is two selectors, not three. */
function splitSelectors(list) {
  const out = []; let depth = 0; let current = '';
  for (const ch of list) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) { out.push(current); current = ''; } else current += ch;
  }
  out.push(current);
  return out.map((x) => x.trim()).filter(Boolean);
}

/** True for `code`, `pre code`, `ul > li`, `a:hover` — no class, id or attribute anywhere. */
const isBareElementSelector = (selector) => {
  const s = selector.trim();
  if (!s || s === ':root' || s.startsWith(':root')) return false;
  if (/[.#[]/.test(s)) return false;          // anchored to a class, id or attribute
  if (/^(html|body|\*)\b/.test(s) && !/\s/.test(s)) return false; // a reset on the document itself
  return /^[a-zA-Z]/.test(s) || s.startsWith('*');
};

describe('the walker this suite rests on', () => {
  test('it finds a bare element inside a media block, and ignores keyframe steps', () => {
    const lists = selectorLists(`
      .ok { color: red; }
      @media (max-width: 700px) { code { color: blue; } .fine code { color: blue; } }
      @keyframes spin { from { opacity: 0; } to { opacity: 1; } }
    `);
    expect(lists).toEqual(['.ok', 'code', '.fine code']);
    expect(lists.filter(isBareElementSelector)).toEqual(['code']);
  });

  test('a selector list is judged selector by selector', () => {
    expect(splitSelectors('.a code, pre, .b').filter(isBareElementSelector)).toEqual(['pre']);
  });

  test('a comma inside :is() or :not() does not split the selector', () => {
    // rejects: a plain split(','), which turned `.stage :is(h2, h3)` into a
    // bare `h3)` and reported a dozen offences that were not there
    expect(splitSelectors('.stage :is(h2, h3, h4) a, .b:not(a, input)')).toEqual(['.stage :is(h2, h3, h4) a', '.b:not(a, input)']);
    expect(splitSelectors('.stage :is(h2, h3)').filter(isBareElementSelector)).toEqual([]);
  });

  test(':where() and :is() scoping counts as anchored', () => {
    expect(isBareElementSelector(':where(.help-doc-section) code')).toBe(false);
  });
});

describe('component stylesheets', () => {
  const files = cssFiles(SRC).filter((f) => !GLOBAL_ON_PURPOSE.has(path.basename(f)));

  test('the scan found the stylesheets it is here for', () => {
    // rejects: a moved directory turning this into a suite that checks nothing
    expect(files.length).toBeGreaterThan(40);
    expect(files.some((f) => f.endsWith(path.join('documentation', 'documentation.css')))).toBe(true);
    expect(files.some((f) => f.endsWith('SetMediaPanel.css'))).toBe(true);
  });

  test('none of them styles a bare element', () => {
    const offenders = [];
    for (const file of files) {
      for (const list of selectorLists(fs.readFileSync(file, 'utf8'))) {
        for (const selector of splitSelectors(list)) {
          if (isBareElementSelector(selector)) {
            offenders.push(`${path.relative(SRC, file)}: ${selector}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('the help sheet keeps its own inline code, and only its own', () => {
  const css = stripComments(fs.readFileSync(path.join(SRC, 'components', 'documentation', 'documentation.css'), 'utf8'));

  test('inline code is still styled inside the help renderer', () => {
    const rule = selectorLists(css).find((s) => /code$/.test(s) && /help-doc/.test(s));
    expect(rule).toBeDefined();
  });

  test('scoping it did not out-rank the code BLOCK reset that comes before it', () => {
    // `.help-code-block code { background: none }` is (0,1,1). A plainly scoped
    // `.help-doc-section code` is (0,1,1) too and comes LATER, so it would win
    // and put the grey chip back inside every code block. :where() keeps the
    // inline rule at (0,0,1), exactly what the bare `code` it replaces was.
    const inline = selectorLists(css).find((s) => /code$/.test(s) && /help-doc/.test(s));
    expect(inline).toMatch(/^:where\(/);
  });
});
