/**
 * ANYONE WHO KNOWS A FOUR-DIGIT CODE CAN DRIVE SOMEBODY ELSE'S LIVE SESSION.
 *
 * Eight routes carry no authorizer in template-clean.yaml:
 *
 *   POST /games                              create a session
 *   POST /games/{gameId}/start               open it for joining
 *   POST /games/{gameId}/start-question      -- no frontend caller
 *   POST /games/{gameId}/start-vote          move the room to voting
 *   POST /games/{gameId}/next-question       advance the round
 *   POST /games/{gameId}/toggle-category     change what gets asked
 *   PUT  /games/{gameId}/persona             change the AI's voice
 *   POST /games/{gameId}/report              READ the whole session out
 *
 * The last one is not like the other seven and was added later. It does not
 * drive anything — it ASSEMBLES the session and hands it back: every
 * participant's name against every participant's answer, the ranked responses,
 * the AI summaries and each round's comments. `create-report.js` calls
 * `decryptItems`, so what comes out is plaintext, and it calls `isHidden`, so
 * the redaction promise made to participants is decided inside a route that
 * was asking nobody who they were. Unauthenticated, one of 9,000 four-digit
 * ids was the entire boundary on all of it.
 *
 * IT WAS DELIBERATELY LEFT OUT OF THE FIRST PASS (e930c022), and the reason is
 * worth keeping: `callerMayDriveSession` returns true for a caller holding no
 * groups, because the participant journey must never be gated. On a route with
 * no authorizer that is EVERY caller, so adding the org guard alone would have
 * left the route reading as scoped while changing nothing. The authorizer and
 * the guard only work as a pair; `tests/session-org-ownership.js` §3 pins the
 * second half, and this file pins the first.
 *
 * A four-digit code is not a secret — it is printed on a projector and typed by
 * everyone in the room. Unauthenticated, every participant, and everyone they
 * forward the code to, can advance the round out from under the host, push the
 * room into voting before people have answered, or silently change the question
 * categories. `GET /games` used to publish the full list of live codes; that was
 * closed (tests/games-list-authorization.js), which left guessing as the only
 * route in — but the people in the room never had to guess.
 *
 * `POST /games` is the other kind of problem: session creation is the billable
 * event in the SaaS plan, and an unauthenticated creator has no org to bill and
 * no owner to attribute. It is also the reason a session carries no owner
 * attribute today — there was never a caller identity to record.
 *
 * ── WHY THE CLIENT HAD TO MOVE FIRST ───────────────────────────────────────
 *
 * Every one of these is called by a host surface with a signed-in user in hand,
 * but they were called with PLAIN `fetch`, which sends no Authorization header.
 * Attaching the authorizer before switching those call sites to `authFetch`
 * would 401 the host's own advance button — the room freezes mid-round with no
 * way forward. Section 4 pins the client half so the two cannot separate.
 *
 * The subtle one is HostRemote: it does not name these paths. It posts to
 * `${apiBase()}${request.path}` where `request.path` is built by
 * config/hostRemote.js (`askNextRequest`, `primaryAction`), so a grep for
 * 'next-question' in that file finds nothing. Both dispatch sites are checked.
 *
 * ── AND WHAT MUST NOT MOVE ─────────────────────────────────────────────────
 *
 * The participant journey carries no token at all. `POST /games/{id}/players`
 * (join), `POST /games/{id}/votes`, `POST /games/get-results` and every
 * participant GET must stay public, and `GET /games/{gameId}` is what RootPage
 * checks a typed code against before anyone has signed in. Section 5 fails the
 * moment one of them acquires an authorizer.
 *
 * rejects: closing a route without moving its callers; moving callers without
 * closing the route; closing anything on the participant journey.
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');
const {
  routesFromTemplate, findRoute, assertScannerWorks,
} = require('./helpers/template-routes');

let pass = 0, fail = 0;
function check(label, fn) {
  try { fn(); console.log(`  ok - ${label}`); pass++; }
  catch (e) { console.log(`  FAIL - ${label}\n    ${e.message}`); fail++; }
}

const MUST_BE_CLOSED = [
  ['POST', '/games'],
  ['POST', '/games/{gameId}/start'],
  ['POST', '/games/{gameId}/start-question'],
  ['POST', '/games/{gameId}/start-vote'],
  ['POST', '/games/{gameId}/next-question'],
  ['POST', '/games/{gameId}/toggle-category'],
  ['PUT', '/games/{gameId}/persona'],
  ['POST', '/games/{gameId}/report'],
];

// The participant journey. None of these carries a token, ever.
const MUST_STAY_OPEN = [
  ['GET', '/games/{gameId}'],
  ['GET', '/games/{gameId}/question'],
  ['GET', '/games/{gameId}/state'],
  ['GET', '/games/{gameId}/state/{playerId}'],
  ['GET', '/games/{gameId}/players'],
  ['POST', '/games/{gameId}/players'],
  ['GET', '/games/{gameId}/answers'],
  ['GET', '/games/{gameId}/votes'],
  ['POST', '/games/{gameId}/votes'],
  ['POST', '/games/get-results'],
  ['GET', '/games/{gameId}/report'],
  ['GET', '/games/{gameId}/ai-summary'],
  ['POST', '/games/{gameId}/players/{playerName}/handover-request'],
];

const routes = routesFromTemplate();

// ---------- 1. The scanner ----------
console.log('\n1. the template scanner actually parses routes');
check('scanner finds routes, sees Auth, and is not matching everything', () =>
  assertScannerWorks(routes));

// ---------- 2. Half one: the template ----------
console.log('\n2. template-clean.yaml attaches the authorizer');
for (const [method, p] of MUST_BE_CLOSED) {
  check(`${method} ${p} carries CognitoAuthorizer`, () => {
    const hit = findRoute(routes, method, p);
    assert.ok(hit, `route ${method} ${p} is not in the template at all`);
    assert.strictEqual(hit.authorizer, 'CognitoAuthorizer',
      `authorizer was ${JSON.stringify(hit.authorizer)} — anyone with the join code can call it`);
  });
}

// ---------- 3. Half two: the authorizer requires a group ----------
console.log('\n3. requiredGroupsForRoute demands hosts or admins');
const { requiredGroupsForRoute, hasPermission } =
  require(path.join(REPO, 'lambda-functions/auth/authorizer.js'));
for (const [method, p] of MUST_BE_CLOSED) {
  const bare = p.replace(/^\//, '');
  check(`${method} ${bare} requires hosts or admins`, () =>
    assert.deepStrictEqual(requiredGroupsForRoute(method, bare), ['hosts', 'admins'],
      `got ${JSON.stringify(requiredGroupsForRoute(method, bare))}`));
  check(`${method} ${bare} refuses a pending account`, () =>
    assert.strictEqual(hasPermission(['pending'], requiredGroupsForRoute(method, bare)), false,
      'an unapproved signup could drive live sessions'));
}

// The rawPath hazard, in the shape it takes here. `requiredGroupsForRoute`
// normally receives the route TEMPLATE, but the handler falls back to
// `event.rawPath` when `routeKey` is absent — and the generic public rule is
// `path.includes('join') || path.includes('answer') || path.includes('vote')`.
// A concrete path for these routes carries a real gameId, which is four digits,
// so it cannot contain those words — but `start-vote` contains 'vote' in the
// ROUTE ITSELF, and that is not hypothetical.
console.log('\n   and start-vote is not handed to the public rule by its own name');
for (const bare of [
  'games/1234/start-vote', 'games/1234/next-question', 'games/1234/toggle-category',
  'games/1234/report',
]) {
  check(`POST ${bare} is not public`, () =>
    assert.notDeepStrictEqual(requiredGroupsForRoute('POST', bare), [],
      'the concrete path fell through to the public rule'));
}

// ---------- 4. The client half ----------
console.log('\n4. every caller sends a token');
const CALLERS = [
  'src/src/GameHostPage.jsx',
  'src/src/HostRemote.jsx',
  'src/src/components/QuickstartMenu.jsx',
];
const ROUTE_WORDS = ['start-vote', 'next-question', 'toggle-category', '/persona', '/start`'];

for (const rel of CALLERS) {
  const src = fs.readFileSync(path.join(REPO, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
  for (const word of ROUTE_WORDS) {
    const bad = src.split('\n').filter((l) =>
      l.includes(word) && /\bfetch\(/.test(l) && !/authFetch\(/.test(l));
    check(`${rel}: ${word} uses authFetch`, () =>
      assert.deepStrictEqual(bad, [],
        'a plain fetch sends no Authorization header — this call now 401s'));
  }
}

// The dynamic dispatch sites. config/hostRemote.js builds `request.path`, so
// the route names never appear in HostRemote.jsx and the check above cannot
// see them.
console.log('\n   including the two dispatch sites that build their path elsewhere');
{
  const src = fs.readFileSync(path.join(REPO, 'src/src/HostRemote.jsx'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
  // `/\bfetch\(/` alone does NOT match `authFetch(` — there is no word boundary
  // between 'h' and 'f' — so counting with it would silently miss the
  // authenticated site and report 1 of 2. Count with both spellings, then
  // filter for the plain one.
  const dispatch = src.split('\n').filter((l) => l.includes('request.path') && /(auth)?[Ff]etch\(/.test(l));
  check('both request.path dispatches exist (guards this check)', () =>
    assert.strictEqual(dispatch.length, 2, `found ${dispatch.length}, expected 2`));
  check('both use authFetch', () =>
    assert.deepStrictEqual(dispatch.filter((l) => !/authFetch\(/.test(l)), [],
      'askSpecific posts next-question with a plain fetch — the phone remote 401s'));
}

// THE SESSION REPORT, whose callers are spread over two files and one of them
// is not on the CALLERS list above — `components/RemoteSessionPanel.jsx` is the
// Session tab on the host's phone, rendered only by HostRemote. A per-file loop
// would have passed vacuously for every file that does not call this route, so
// this collects the sites instead and counts them.
//
// THREE OF THE FOUR WERE PLAIN `fetch`, and the one in `loadRounds` is the
// sharp one: it runs from a `useEffect` the moment the host opens the Setup
// panel. Attaching the authorizer without moving it would 401 the host's own
// Rounds tab — the list would empty itself and the empty copy would say "no
// rounds yet" about a session with six of them, which is the failure mode that
// looks like data loss rather than like a permission error.
console.log('\n   and the session report, whose four call sites live in two files');
{
  const REPORT_CALLERS = [
    'src/src/GameHostPage.jsx',
    'src/src/components/RemoteSessionPanel.jsx',
  ];
  const sites = [];
  for (const rel of REPORT_CALLERS) {
    const src = fs.readFileSync(path.join(REPO, rel), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
    // `(auth)?[Ff]etch\(` for the reason the HostRemote count above gives:
    // `\bfetch\(` does not match `authFetch(`, so counting with it alone would
    // silently miss the authenticated site and under-report the guard.
    for (const line of src.split('\n')) {
      if (/\/report`/.test(line) && /(auth)?[Ff]etch\(/.test(line)) sites.push([rel, line]);
    }
  }
  check('all four report call sites are found (guards this check)', () =>
    assert.strictEqual(sites.length, 4,
      `found ${sites.length} — expected loadRounds, requestFeedbackRound and `
      + 'generateReportForGame on the host page, plus the phone\'s Session tab'));
  check('every one sends a token', () =>
    assert.deepStrictEqual(sites.filter(([, l]) => !/authFetch\(/.test(l)).map(([rel]) => rel), [],
      'a plain fetch sends no Authorization header — this call now 401s'));
}

// The create call names no route word, so the per-route check above cannot see
// it. `${API_BASE}games` matches TWO sites — POST (create) and GET (the games
// list, closed earlier by tests/games-list-authorization.js) — so assert the
// property that matters for both rather than pinning a count of one.
console.log('\n   and session creation itself');
{
  const src = fs.readFileSync(path.join(REPO, 'src/src/GameHostPage.jsx'), 'utf8');
  const bare = src.split('\n').filter((l) => /\$\{API_BASE\}games`/.test(l));
  check('the bare /games sites are found (guards this check)', () =>
    assert.strictEqual(bare.length, 2,
      `found ${bare.length} — expected POST (create) and GET (list)`));
  check('both send a token', () =>
    assert.deepStrictEqual(bare.filter((l) => !/authFetch\(/.test(l)), [],
      'creating a session with no token leaves it with no owner and no org to bill'));
}

// ---------- 5. The participant journey did not move ----------
console.log('\n5. no participant route acquired an authorizer');
for (const [method, p] of MUST_STAY_OPEN) {
  check(`${method} ${p} is still public`, () => {
    const hit = findRoute(routes, method, p);
    assert.ok(hit, `route ${method} ${p} is not in the template at all`);
    assert.strictEqual(hit.authorizer, null,
      `it acquired ${hit.authorizer} — participants carry no token and would all 401`);
  });
}

// RootPage checks a typed code before anyone signs in. If GET /games/{gameId}
// ever closes, the front door stops working for every participant.
check('RootPage still checks a code with a plain fetch, and that still works', () => {
  const src = fs.readFileSync(path.join(REPO, 'src/src/components/RootPage.jsx'), 'utf8');
  assert.ok(/fetch\(`\$\{window\.API_BASE\}games\/\$\{code\}`\)/.test(src),
    'RootPage no longer does the unauthenticated code check this asserts about');
  assert.strictEqual(findRoute(routes, 'GET', '/games/{gameId}').authorizer, null,
    'the route it calls is now closed — nobody can check a code before signing in');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
