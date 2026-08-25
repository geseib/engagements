/**
 * THE QUESTION-SET ROUTES WERE PUBLIC, AND CLOSING THEM TAKES TWO CHANGES.
 *
 * `GET /question-sets`, `GET /question-sets/{setId}/questions` and
 * `GET /question-sets/{setId}/categories` carried no authorizer at all. They
 * serve the product's content — every question, every answer explanation,
 * every category and instruction — so unauthenticated, any caller could read
 * the entire library of every host in the environment.
 *
 * The participant surface was the proof rather than the exception:
 * `PlayerPage.jsx` fetched the WHOLE of `GET /question-sets` on every round in
 * order to read two strings about its own set, so every anonymous player in
 * every session was handed the catalogue. A previous pass memoised those
 * downloads — making the leak quieter, not smaller.
 *
 * ── WHY THE PLAYER FIX HAD TO SHIP FIRST ───────────────────────────────────
 *
 * Attaching the authorizer while a participant still called the route would
 * have 401'd every player mid-round. `game/get-question.js` now projects
 * `setCustomInstruction` and `setRoundNoun` onto `GET /games/{gameId}/question`
 * — from the SETS row `resolveSetPartition` was already reading, so it costs
 * nothing — and `PlayerPage` reads them off that payload. Only then can these
 * three close. Section 4 pins that ordering so it cannot be undone halfway.
 *
 * ── AND WHY BOTH HALVES, ALWAYS TOGETHER ───────────────────────────────────
 *
 * This is the lesson `tests/games-list-authorization.js` already records, in
 * both directions:
 *
 *   1. `template-clean.yaml` attaches `CognitoAuthorizer` to the route.
 *   2. `authorizer.js`'s `requiredGroupsForRoute` names the route explicitly.
 *
 * WITHOUT (2), (1) IS A FALSE FIX THAT LOOKS REAL. The trailing rule in that
 * function is `return ['hosts','admins']`, which happens to be right here — but
 * relying on a fallthrough means any future reordering silently changes who may
 * read every question set in the system. Section 3 drives the REAL exported
 * function so the answer is the one the deployed authorizer would give.
 *
 * AND THE OPPOSITE MISTAKE TAKES THE PRODUCT DOWN. A prefix
 * (`path.startsWith('question-sets')`) or an over-eager template edit reaches
 * the participant journey, and every one of those routes carries no token.
 * Section 5 fails loudly the moment that happens.
 *
 * rejects: removing either half; closing a participant route; matching these
 * paths by prefix.
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

/**
 * The three routes, and the participant routes that must NOT move.
 * `/games/{gameId}/players` POST is the join itself; `/games/get-results` is
 * the public read half of the handler whose other route is authorized.
 */
const MUST_BE_CLOSED = [
  ['GET', '/question-sets'],
  ['GET', '/question-sets/{setId}/questions'],
  ['GET', '/question-sets/{setId}/categories'],
];
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
];

const routes = routesFromTemplate();

// ---------- 1. The scanner works at all ----------
// A scanner that finds nothing passes every assertion below unconditionally.
console.log('\n1. the template scanner actually parses routes');
check('scanner finds routes, sees Auth, and is not matching everything', () =>
  assertScannerWorks(routes));

// ---------- 2. Half one: the template ----------
console.log('\n2. template-clean.yaml attaches the authorizer to all three');
for (const [method, p] of MUST_BE_CLOSED) {
  check(`${method} ${p} carries CognitoAuthorizer`, () => {
    const hit = findRoute(routes, method, p);
    assert.ok(hit, `route ${method} ${p} is not in the template at all`);
    assert.strictEqual(hit.authorizer, 'CognitoAuthorizer',
      `authorizer was ${JSON.stringify(hit.authorizer)}`);
  });
}

// ---------- 3. Half two: the authorizer names them ----------
console.log('\n3. requiredGroupsForRoute names them explicitly');
const { requiredGroupsForRoute } = require(path.join(REPO, 'lambda-functions/auth/authorizer.js'));
for (const [method, p] of MUST_BE_CLOSED) {
  const bare = p.replace(/^\//, '');
  check(`${method} ${bare} requires hosts or admins`, () => {
    const groups = requiredGroupsForRoute(method, bare);
    assert.deepStrictEqual(groups, ['hosts', 'admins'],
      `got ${JSON.stringify(groups)} — a pending, unapproved account would pass`);
  });
}

// THE ASSERTION ABOVE IS NOT ENOUGH ON ITS OWN, AND THIS TEST LEARNED THAT THE
// WAY EVERYTHING ELSE IN THIS REPO DOES — by being broken and staying green.
//
// Deleting the explicit clause and re-running left all three cases passing,
// because the LAST line of requiredGroupsForRoute is `return ['hosts','admins']`
// and these paths fall through to it. The answer is the same, so the product is
// not vulnerable today — but a test that cannot tell "named explicitly" from
// "happened to land on the default" is not pinning the half it claims to.
//
// It matters because the default is a catch-all that future work will reorder.
// The generic rule two lines above it is
//
//     if (path.includes('join') || path.includes('answer') || path.includes('vote')
//         || (method === 'GET' && path.includes('games'))) return [];
//
// — `includes`, on a bare string. `requiredGroupsForRoute` is normally handed
// the route TEMPLATE (`question-sets/{setId}/questions`), which contains none
// of those words. But the handler falls back to `event.rawPath` when
// `routeKey` is absent, and a rawPath carries the REAL set id. Set ids are
// slugs of titles (upload-questions.js:298), so a set called "Lessons and
// Answers" becomes `lessonsandanswers` — and that path matches
// `includes('answer')` and returns PUBLIC. The exact match below is what stands
// in front of that, and it only stands there while it is actually present.
console.log('\n   the clause is present and matched EXACTLY, not by fallthrough');
{
  const src = fs.readFileSync(path.join(REPO, 'lambda-functions/auth/authorizer.js'), 'utf8');
  for (const [, p] of MUST_BE_CLOSED) {
    const bare = p.replace(/^\//, '');
    check(`authorizer.js names '${bare}' literally`, () =>
      assert.ok(src.includes(`'${bare}'`),
        'the route is no longer named; it is relying on the trailing default, '
        + 'which the generic includes() rules above can overtake'));
  }
  check('and it compares by equality or an anchored regex, never a prefix', () => {
    // Comments stripped first: authorizer.js DISCUSSES `startsWith('question-sets')`
    // at length in order to explain why it does not use it. Scanning raw text
    // fails on the explanation of the decision — the same trap
    // __tests__/undeclaredSetters.test.js documents.
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
    assert.ok(/path === 'question-sets'/.test(code), 'the exact-match block is gone');
    assert.ok(!/(startsWith|includes)\(\s*'question-sets/.test(code),
      'a prefix match here would also close any future public sub-route');
  });
}

// The hazard named above, pinned as behaviour rather than left as prose.
console.log('\n   a rawPath carrying a word from the public rule is still refused');
for (const bare of [
  'question-sets/lessonsandanswers/questions',
  'question-sets/teamvotes/questions',
  'question-sets/joinerset/categories',
]) {
  const groups = requiredGroupsForRoute('GET', bare);
  check(`GET ${bare} is not public`, () =>
    assert.notDeepStrictEqual(groups, [],
      'a set whose id contains join/answer/vote fell through to the public rule — '
      + 'this is reachable whenever routeKey is absent and rawPath is used'));
}

// A signed-in but unapproved account must not get in. This is the failure
// require-admin.js:19-24 records: authentication doing the work of
// authorisation.
console.log('\n   and a `pending` account is refused by those groups');
const hasPermission = require(path.join(REPO, 'lambda-functions/auth/authorizer.js')).hasPermission;
for (const [method, p] of MUST_BE_CLOSED) {
  const bare = p.replace(/^\//, '');
  check(`${method} ${bare} refuses groups=['pending']`, () =>
    assert.strictEqual(hasPermission(['pending'], requiredGroupsForRoute(method, bare)), false,
      'an unapproved account would read every question set in the environment'));
}

// ---------- 4. The player no longer needs the route ----------
console.log('\n4. the participant gets the set fields from the question instead');
const getQuestion = fs.readFileSync(path.join(REPO, 'lambda-functions/game/get-question.js'), 'utf8');
check('get-question.js projects setCustomInstruction', () =>
  assert.ok(/setCustomInstruction:\s*resolved\.metadata/.test(getQuestion),
    'the player payload no longer carries the set instruction — closing the route strands them'));
check('get-question.js projects setRoundNoun', () =>
  assert.ok(/setRoundNoun:\s*resolved\.metadata/.test(getQuestion),
    'the player payload no longer carries the round noun'));

const playerPage = fs.readFileSync(path.join(REPO, 'src/src/PlayerPage.jsx'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
check('PlayerPage.jsx makes no request to question-sets', () =>
  assert.ok(!/(auth)?[Ff]etch\(\s*`[^`]*question-sets/.test(playerPage),
    'the participant still calls a route that is now closed — every player would 401'));

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

// ---------- 6. Matched exactly, never by prefix ----------
console.log('\n6. the match is exact, so a future public sub-route is not closed by accident');
check('a hypothetical question-sets sub-route is not swept up', () =>
  assert.deepStrictEqual(
    requiredGroupsForRoute('GET', 'question-sets/{setId}/public-preview'),
    ['hosts', 'admins'],
    'this currently falls through to the default, which is fine — but if it ever '
    + 'needs to be public, the exact match above is what makes that possible'));
check('the deliberately-public issue route is untouched', () => {
  const hit = findRoute(routes, 'POST', '/admin/create-github-issue');
  assert.ok(hit, 'route missing');
  assert.strictEqual(hit.authorizer, null,
    'the player IssueFab posts here with no token, on purpose');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
