/**
 * THE ORG AND INVITE ROUTES, AND THE FAIL-OPEN THEY WALKED INTO.
 *
 * `/orgs/*` and `/invites/*` do not begin with `admin`, so `requiredGroupsForRoute`
 * had no clause for them and they fell through to the trailing default. That
 * default is `['hosts','admins']` — the right answer — so every spot check
 * passed and the routes looked correctly gated.
 *
 * TWO RULES SIT BETWEEN THOSE ROUTES AND THAT DEFAULT:
 *
 *     if (path.includes('join') || path.includes('answer')
 *         || path.includes('vote') || ...) return [];
 *
 * `includes`, on the whole path string. And an invitation token is 32 base58
 * characters that travels IN THE PATH:
 *
 *     /invites/org_9xK.4Fq7joinPz2mNbVc8dQwLxRt3/accept
 *                          ^^^^
 *
 * base58 contains j, o, i, n, v, t, e, a, s and w. A token that happens to spell
 * `join`, `vote` or `answer` anywhere in those 32 characters made its OWN accept
 * route return `[]`, and `hasPermission([])` means "no groups required" — so
 * every account in the pool passed, including one still sitting in `pending`,
 * unapproved, that signed up ninety seconds earlier.
 *
 * It is rare per token and certain across enough of them, it fails in the OPEN
 * direction, and it is undetectable by any test using a fixed fixture token.
 * This is the third time this family of `includes()` rules has produced a
 * fail-open: see the question-set block in authorizer.js for a set slugged
 * `lessonsandanswers`, and tests/games-list-authorization.js for the original.
 *
 * rejects: removing the explicit org/invite clause; matching it by prefix so a
 * future public sub-route is swept up; the generic rules being reordered above it.
 */
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');
const { requiredGroupsForRoute, hasPermission } =
  require(path.join(REPO, 'lambda-functions/auth/authorizer.js'));

let pass = 0, fail = 0;
function check(label, fn) {
  try { fn(); console.log(`  ok - ${label}`); pass++; }
  catch (e) { console.log(`  FAIL - ${label}\n    ${e.message}`); fail++; }
}

// The route templates, exactly as template-clean.yaml declares them.
const ROUTES = [
  ['POST', 'orgs'],
  ['GET', 'orgs'],
  ['GET', 'orgs/{orgId}'],
  ['GET', 'orgs/{orgId}/members'],
  ['GET', 'orgs/{orgId}/usage'],
  ['POST', 'orgs/{orgId}/invites'],
  ['DELETE', 'orgs/{orgId}/invites/{token}'],
  ['PUT', 'orgs/{orgId}/members/{sub}/role'],
  ['DELETE', 'orgs/{orgId}/members/{sub}'],
  ['POST', 'invites/{token}/accept'],
];

console.log('\n1. every org and invite route requires a real, approved account');
for (const [method, p] of ROUTES) {
  check(`${method} /${p}`, () =>
    assert.deepStrictEqual(requiredGroupsForRoute(method, p), ['hosts', 'admins'],
      `got ${JSON.stringify(requiredGroupsForRoute(method, p))}`));
  check(`${method} /${p} refuses a pending account`, () =>
    assert.strictEqual(hasPermission(['pending'], requiredGroupsForRoute(method, p)), false,
      'an unapproved signup could act on organisations'));
}

// ---------- 2. The concrete paths, which is where it actually broke ----------
// `requiredGroupsForRoute` normally receives the route TEMPLATE, but the handler
// falls back to `event.rawPath`, which carries the real token and the real
// orgId. These are the strings that used to come back public.
console.log('\n2. a real token containing join / vote / answer is still refused');
const POISON_TOKENS = [
  'org_9xK.4Fq7joinPz2mNbVc8dQwLxRt3',   // contains "join"
  'org_9xK.7hvoteKm2QwLxRt3PzNbVc8d',    // contains "vote"
  'org_9xK.answerKm2QwLxRt3PzNbVc8',     // contains "answer"
  'org_joinXYZ.4Fq7Pz2mNbVc8dQwLxRt3',   // the word is in the ORG half
];
for (const token of POISON_TOKENS) {
  const p = `invites/${token}/accept`;
  check(`POST /${p.slice(0, 44)}…`, () => {
    const groups = requiredGroupsForRoute('POST', p);
    assert.notDeepStrictEqual(groups, [],
      'this token made its own accept route public — every pool account, '
      + 'including an unapproved one, could accept an invitation with it');
    assert.strictEqual(hasPermission(['pending'], groups), false);
  });
}

console.log('\n   and the same for an orgId that spells one of them');
for (const orgId of ['org_joinAbc', 'org_voteXyz', 'org_answerQ']) {
  for (const p of [`orgs/${orgId}/members`, `orgs/${orgId}/invites`, `orgs/${orgId}/usage`]) {
    check(`GET /${p}`, () =>
      assert.notDeepStrictEqual(requiredGroupsForRoute('GET', p), [],
        'an organisation whose id spells join/vote/answer opened its own routes'));
  }
}

// ---------- 3. Named explicitly, not inherited from the default ----------
// The assertion in section 1 also passes when the clause is deleted, because
// the trailing default returns the same array. That is exactly the trap this
// repo has fallen into before, so the source is checked directly.
console.log('\n3. the clause exists rather than relying on the trailing default');
{
  const fs = require('fs');
  const src = fs.readFileSync(path.join(REPO, 'lambda-functions/auth/authorizer.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
  check('authorizer.js matches org routes explicitly', () =>
    assert.ok(/ORG_ROUTE\s*=/.test(src) && /ORG_ROUTE\.test\(path\)/.test(src),
      'the explicit org clause is gone; the routes are back on the trailing '
      + 'default with the includes() rules in front of them'));
  check('authorizer.js matches the invite route explicitly', () =>
    assert.ok(/INVITE_ROUTE\s*=/.test(src) && /INVITE_ROUTE\.test\(path\)/.test(src),
      'the explicit invite clause is gone'));
  check('and it anchors, so a future public sub-route is not swept up', () =>
    assert.ok(!/(startsWith|includes)\(\s*['"]orgs/.test(src),
      'a prefix match would silently close routes nobody has written yet'));
}

console.log('\n4. the platform console, and the copy route');
{
  /*
    THE STAFF ROUTES ARE `admins` ALONE — never ['hosts','admins'].

    This is the one place in the API where the two groups must NOT be
    interchangeable. Every other admin-ish route lets hosts through because
    hosts manage their own content; these list and suspend OTHER PEOPLE'S
    organisations, and a host reaching them would be a tenant administering
    tenants.
  */
  check('GET /platform/orgs is Engage staff only', () =>
    assert.deepStrictEqual(requiredGroupsForRoute('GET', 'platform/orgs'), ['admins']));
  check('the status route is Engage staff only', () =>
    assert.deepStrictEqual(
      requiredGroupsForRoute('POST', 'platform/orgs/{orgId}/status'), ['admins']));
  check('and so is the concrete form the rawPath fallback produces', () =>
    assert.deepStrictEqual(
      requiredGroupsForRoute('POST', 'platform/orgs/org_9xK4Fq7Pz2mNbVc8dQwLxR/status'),
      ['admins']));

  // rejects: a host being refused the copy route. Copying is how an ordinary
  // member adapts something from the shared library; refusing it to hosts would
  // leave that library read-only for exactly the people it exists for.
  check('copying a shared set is open to hosts as well as admins', () => {
    assert.deepStrictEqual(
      requiredGroupsForRoute('POST', 'question-sets/{setId}/copy'), ['hosts', 'admins']);
    assert.deepStrictEqual(
      requiredGroupsForRoute('POST', 'question-sets/80strivia/copy'), ['hosts', 'admins']);
  });

  /*
    THE SET-ID TRAP, AGAIN, ON A NEW ROUTE.

    `requiredGroupsForRoute` has a generic clause reading
    `path.includes('answer') || path.includes('vote') || path.includes('join')`,
    and a setId is a slug of its title (upload-questions.js:298). A set called
    "Lessons and Answers" slugs to `lessonsandanswers`. Any new route carrying a
    set id has to be decided BEFORE that clause or it is public by accident —
    which is exactly how question-sets/{setId}/questions was once public.
  */
  check('a set whose title contains "answers" does not make its copy route public', () =>
    assert.deepStrictEqual(
      requiredGroupsForRoute('POST', 'question-sets/lessonsandanswers/copy'),
      ['hosts', 'admins']));

  const fs2 = require('fs');
  const src2 = fs2.readFileSync(path.join(REPO, 'lambda-functions/auth/authorizer.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
  check('the platform clause is anchored, not a prefix', () =>
    assert.ok(!/(startsWith|includes)\(\s*['"]platform/.test(src2),
      'a prefix would swallow every future platform/... route, including a public one'));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
