/**
 * A CLOSED ROUTE IS NEVER REACHED WITH BARE `fetch`.
 *
 * ── THE BUG ────────────────────────────────────────────────────────────────
 *
 * `GameHostPage.jsx` advanced the round with
 *
 *     requestNextQuestion({ fetchFn: fetch, … })
 *
 * `POST /games/{id}/next-question` was closed in Phase 0 — before that, anyone
 * holding a four-digit code could drive somebody else's live session — and nine
 * call sites were moved to `authFetch` at the time. This one was missed because
 * the fetch is not CALLED here, it is PASSED AS A VALUE to a helper. Grepping
 * the call site for `fetch(` finds `requestNextQuestion(`.
 *
 * Reported from dev: starting a quickstart and pressing next gave
 * "Unauthorized · 401" — the main control on the host page, dead.
 *
 * This repo has recorded the mirror of this trap once already: `authFetch` has
 * a capital F, so `/fetch\(/` does not match it and a scanner written the
 * obvious way silently checks nothing. Same family, other direction.
 *
 * ── WHAT THIS CHECKS ───────────────────────────────────────────────────────
 *
 * Both shapes, over the whole frontend: a bare `fetch(` whose URL names a
 * closed route, and a bare `fetch` handed to something as a value. The second
 * is the one that got through.
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..');

function sourceFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
      sourceFiles(full, out);
    } else if (/\.jsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/** Comments stripped: this repo's doc-blocks discuss these routes constantly. */
const code = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');

const FILES = sourceFiles(SRC).map((f) => [path.relative(SRC, f), code(fs.readFileSync(f, 'utf8'))]);

describe('the closed routes are never called with bare fetch', () => {
  /*
    `(?<![\w.])fetch\s*\(` — a bare call, so `authFetch(` and `window.fetch(`
    and `global.fetch(` are all excluded. The URL has to appear in the same
    call, which is how every one of these is written.
  */
  const CLOSED = [
    'next-question', 'start-question', 'start-vote', 'toggle-category',
    'question-sets', 'close-round',
  ];

  // rejects: a closed route called through the bare global, which is a 401 in
  // the host's face mid-session.
  test.each(FILES)('%s', (_rel, src) => {
    const offenders = [];
    for (const m of src.matchAll(/(?<![\w.])fetch\s*\(\s*[`'"][^`'"]*[`'"]/g)) {
      const hit = CLOSED.find((route) => m[0].includes(route));
      if (hit) offenders.push(`${hit}: ${m[0].slice(0, 80)}`);
    }
    expect(offenders).toEqual([]);
  });
});

describe('and bare fetch is never handed to a helper as a value', () => {
  /*
    THE SHAPE THAT ACTUALLY SHIPPED. `fetchFn: fetch` reads as ordinary code and
    hides an unauthenticated transport one function call away from the route it
    will be used on.
  */
  // rejects: `fetchFn: fetch`, `fetcher: fetch`, `transport: fetch` — the bug
  // as written, and its obvious siblings.
  test.each(FILES)('%s', (_rel, src) => {
    const offenders = [...src.matchAll(
      /(?<![\w.])(\w*[Ff]etch\w*|transport|http)\s*:\s*fetch\s*(?=[,}\s])/g,
    )].map((m) => m[0].trim());
    expect(offenders).toEqual([]);
  });
});

describe('the scan can actually fail', () => {
  /* The two suites above prove they find nothing today. They cannot prove they
     would find something — a broken regex produces the same green. */
  const bareCall = (src) => [...code(src).matchAll(/(?<![\w.])fetch\s*\(\s*[`'"][^`'"]*[`'"]/g)]
    .filter((m) => m[0].includes('next-question'));
  const asValue = (src) => [...code(src).matchAll(
    /(?<![\w.])(\w*[Ff]etch\w*|transport|http)\s*:\s*fetch\s*(?=[,}\s])/g,
  )];

  // rejects: a matcher that stopped matching the call form.
  test('it catches a bare call to a closed route', () => {
    expect(bareCall('await fetch(`${API_BASE}games/${id}/next-question`, {})')).toHaveLength(1);
  });

  // rejects: a matcher that stopped matching THE shape that shipped.
  test('it catches bare fetch passed as a value', () => {
    expect(asValue('requestNextQuestion({ fetchFn: fetch, apiBase })')).toHaveLength(1);
  });

  // rejects: flagging the correct code, which is how a scanner gets deleted.
  test('it does not flag authFetch, in either form', () => {
    expect(bareCall('await authFetch(`${API_BASE}games/${id}/next-question`, {})')).toHaveLength(0);
    expect(asValue('requestNextQuestion({ fetchFn: authFetch, apiBase })')).toHaveLength(0);
  });

  // rejects: flagging a test double or an explicit global, both deliberate.
  test('it does not flag window.fetch or global.fetch', () => {
    expect(bareCall('await window.fetch(`${API_BASE}games/1/next-question`)')).toHaveLength(0);
    expect(asValue('({ fetchFn: global.fetch })')).toHaveLength(0);
  });
});
