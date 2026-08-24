/**
 * THE AUTHORIZER'S IDENTITY SOURCE, AND THE TRAP IN IT.
 *
 * A user may belong to several organisations with a different role in each, and
 * the console's switcher sends the chosen one as `X-Engage-Org`. That header is
 * genuinely part of the identity of a request — two calls with the same token
 * and different orgs are not the same call — so adding it to the authorizer's
 * `Identity.Headers` looks obviously correct.
 *
 * IT IS NOT CORRECT YET, AND GETTING IT WRONG TAKES THE WHOLE PRODUCT DOWN.
 * An HTTP API returns 401 *without invoking the authorizer* when a configured
 * identity source is missing from a request. Every client that has not been
 * taught to send the header — today, all of them — would stop being able to
 * reach any authenticated route at all. Not a tenancy bug: a total sign-in
 * outage, produced by a one-line change that reads as a correctness fix.
 *
 * The authorizer does not need the entry to READ the header. It takes it
 * straight off `event.headers['x-engage-org']`. An identitySource entry affects
 * exactly one thing: the cache key.
 *
 * WHICH IS WHY IT BECOMES MANDATORY THE DAY CACHING IS TURNED ON. With
 * `AuthorizerResultTtlInSeconds` set and this header absent from the key, API
 * Gateway serves one organisation's authorisation decision to a request for
 * another — a cross-tenant leak introduced by a latency optimisation that looks
 * unrelated to tenancy, and one that would be invisible in every test that runs
 * a single request at a time.
 *
 * So this file pins the PAIR, not either half:
 *   caching off  -> the header must NOT be an identity source (no outage)
 *   caching on   -> the header MUST be an identity source (no leak)
 *
 * rejects: adding X-Engage-Org to identitySource while caching is off; enabling
 * authorizer caching without adding it; the authorizer no longer reading the
 * header from event.headers at all.
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');
const template = fs.readFileSync(path.join(REPO, 'template-clean.yaml'), 'utf8');
const authorizer = fs.readFileSync(path.join(REPO, 'lambda-functions/auth/authorizer.js'), 'utf8');

let pass = 0, fail = 0;
function check(label, fn) {
  try { fn(); console.log(`  ok - ${label}`); pass++; }
  catch (e) { console.log(`  FAIL - ${label}\n    ${e.message}`); fail++; }
}

/**
 * The CognitoAuthorizer block, sliced out as text.
 *
 * Read as text and not as YAML on purpose: the template is full of
 * CloudFormation short tags that no loader in this repo's dependency set
 * accepts, and tests/helpers/template-routes.js already established the
 * precedent. The slice is bounded so a `Headers:` list somewhere else in a
 * 3,700-line file cannot be mistaken for this one.
 */
function authorizerBlock() {
  const start = template.indexOf('CognitoAuthorizer:');
  assert.notStrictEqual(start, -1, 'the authorizer block is gone from the template');
  const end = template.indexOf('\n      Tags:', start);
  assert.notStrictEqual(end, -1, 'could not find the end of the authorizer block');
  return template.slice(start, end);
}

const block = authorizerBlock();

// Comments quote the header in order to explain the decision, so they must come
// out before anything is concluded from its presence. Same reason
// __tests__/undeclaredSetters.test.js strips them.
const code = block.replace(/^\s*#.*$/gm, '');

console.log('\n1. the slice actually found the right block');
check('it names the authorizer', () => assert.ok(/CognitoAuthorizer:/.test(block)));
check('it contains an Identity.Headers list', () => assert.ok(/Identity:/.test(code)));
check('and Authorization is in it (guards the scanner itself)', () =>
  assert.ok(/-\s*Authorization\b/.test(code),
    'the scanner found no identity source at all, so every check below is vacuous'));

console.log('\n2. caching state and identity source agree');
const cachingOn = /AuthorizerResultTtlInSeconds:\s*[1-9]/.test(code);
const headerIsIdentitySource = /-\s*X-Engage-Org\b/i.test(code);

check(`caching is ${cachingOn ? 'ON' : 'off'} and the header is ${headerIsIdentitySource ? '' : 'not '}an identity source`, () => {
  if (cachingOn) {
    assert.ok(headerIsIdentitySource,
      'AUTHORIZER CACHING IS ON AND X-Engage-Org IS NOT IN THE CACHE KEY. API Gateway '
      + 'will serve one organisation\'s authorisation decision to a request for another. '
      + 'Add `- X-Engage-Org` under Identity.Headers.');
  } else {
    assert.ok(!headerIsIdentitySource,
      'X-Engage-Org IS AN IDENTITY SOURCE BUT CACHING IS OFF. An HTTP API 401s without '
      + 'invoking the authorizer when a configured identity source is absent, so every '
      + 'client that does not send this header — today, all of them — loses access to '
      + 'every authenticated route. Remove it until caching is enabled.');
  }
});

console.log('\n3. the authorizer reads the header regardless');
// This is what makes the identitySource entry unnecessary while caching is off.
// If it ever stops being true, the safe design silently stops working and the
// switcher does nothing.
check('authorizer.js reads x-engage-org off the request headers', () =>
  assert.ok(/headers.*\[?['"]x-engage-org['"]/i.test(authorizer),
    'the authorizer no longer reads the header directly, so with caching off the '
    + 'active organisation can never be resolved at all'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
