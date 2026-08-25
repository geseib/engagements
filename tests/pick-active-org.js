/**
 * WHICH ORG, AND — far more important — WHEN NOTHING.
 *
 * `pickActiveOrg` decides the single organisation a request acts for. The
 * happy paths here are nearly self-evident; the ones worth the file are the
 * refusals, because every one of them is a case where returning SOMETHING
 * would have looked like success and been a tenant swap.
 *
 * The headline case is section 2: a request that names an org the caller is
 * not a member of must resolve to `null`, never to a fallback. If it falls
 * through to "your only membership" or "your default", the request succeeds
 * against a DIFFERENT tenant than the one named — the UI says Acme, the write
 * lands in Northwind, and nothing anywhere errors. The assertions there are
 * built so that deleting the guard produces a wrong ORG ID, not merely a
 * missing null, so the failure names the swap.
 *
 * Pure function, no AWS, no stubs. That is the point of the module existing.
 */
const assert = require('assert');
const path = require('path');

const { pickActiveOrg } = require(
  path.join(__dirname, '..', 'lambda-functions/auth/pick-active-org.js'));

let pass = 0, fail = 0;
function check(label, fn) {
  try { fn(); console.log(`  PASS  ${label}`); pass++; }
  catch (e) { console.log(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

const ACME = { orgId: 'org_acme', role: 'owner' };
const NW = { orgId: 'org_northwind', role: 'member' };
const GLOBEX = { orgId: 'org_globex', role: 'admin' };

// ---------------------------------------------------------------------------
console.log('\n1. the requested org wins when the caller is in it');
// REJECTS: dropping the requested-org clause entirely, or ordering it after
// the single-membership rule. With three memberships and a default pointing at
// a third org, only the requested clause can produce org_northwind.

check('a requested org the caller belongs to is chosen', () =>
  assert.deepStrictEqual(
    pickActiveOrg([ACME, NW, GLOBEX], 'org_northwind', 'org_globex'), NW));

// REJECTS: returning the requested id with a synthesised or defaulted role.
// The role comes from the MEMBERSHIP row, and it is what roleAtLeast gates
// every org write on — inventing 'member' would demote an owner, inventing
// 'owner' would promote a member.
check('and it carries that membership\'s own role, not a default', () =>
  assert.strictEqual(
    pickActiveOrg([ACME, NW, GLOBEX], 'org_acme', '').role, 'owner'));

// REJECTS: comparing the requested id case-insensitively or after some
// normalisation the key builders do not share. `ORG#org_acme#SETS` is built
// from the literal id; a case-folded match here would resolve to an org whose
// partition key does not exist, and reads would silently come back empty.
check('the match is exact — a differently-cased id is not the same org', () =>
  assert.strictEqual(pickActiveOrg([ACME], 'ORG_ACME', ''), null));

// REJECTS: failing to trim the header value. A stray space in `x-engage-org`
// would otherwise look like a non-member and 403 the caller out of their own
// organisation.
check('surrounding whitespace in the request is trimmed', () =>
  assert.deepStrictEqual(pickActiveOrg([ACME, NW], '  org_acme  ', ''), ACME));

// ---------------------------------------------------------------------------
console.log('\n2. a requested org the caller is NOT in resolves to nothing — never a substitute');
// REJECTS: any `|| fallback` after the requested-org lookup. This is the whole
// reason the module exists: a silent substitution means the caller acts on a
// tenant they did not choose and is not told.

check('one membership, a different org requested → null (NOT that one membership)', () => {
  const got = pickActiveOrg([ACME], 'org_northwind', '');
  assert.strictEqual(got, null,
    `asked for org_northwind, got ${got && got.orgId} — silent tenant swap`);
});

check('a default is not a substitute either', () => {
  const got = pickActiveOrg([ACME, NW], 'org_globex', 'org_acme');
  assert.strictEqual(got, null,
    `asked for org_globex, got ${got && got.orgId} — silent tenant swap`);
});

check('an org that exists for somebody else is still refused', () => {
  const got = pickActiveOrg([NW], 'org_acme', 'org_northwind');
  assert.strictEqual(got, null,
    `asked for org_acme, got ${got && got.orgId} — silent tenant swap`);
});

// ---------------------------------------------------------------------------
console.log('\n3. no request: the single membership, when there is exactly one');
// REJECTS: requiring a header before any org is resolved at all, which would
// leave every caller org-less until a picker ships and make the whole feature
// look inert.

check('exactly one membership and no request → that one', () =>
  assert.deepStrictEqual(pickActiveOrg([NW], '', ''), NW));

// REJECTS: `rows[0]` in place of the length check. With two memberships and no
// request and no default there is no basis to choose, and picking the first is
// a coin toss decided by DynamoDB's sort order — the caller acts for whichever
// org sorts first and is never told which.
check('two memberships, no request, no default → null, not the first one', () => {
  const got = pickActiveOrg([ACME, NW], '', '');
  assert.strictEqual(got, null,
    `picked ${got && got.orgId} out of two with nothing to choose on`);
});

// ---------------------------------------------------------------------------
console.log('\n4. the default breaks a tie, but only a real membership');
// REJECTS: dropping the defaultOrgId clause — with two memberships nothing
// else can produce an answer here.

check('the default is used when the caller has several memberships', () =>
  assert.deepStrictEqual(pickActiveOrg([ACME, NW], '', 'org_northwind'), NW));

// REJECTS: trusting defaultOrgId without checking membership. The PROFILE row
// outlives a membership row — remove someone from an org and their stale
// default would otherwise hand them that org's context back.
check('a default pointing at an org they were removed from is ignored', () => {
  const got = pickActiveOrg([ACME, NW], '', 'org_globex');
  assert.strictEqual(got, null,
    `a stale default resurrected ${got && got.orgId}`);
});

// REJECTS: ordering the default ABOVE the single-membership rule in a way that
// changes the answer — a stale default plus one real membership must still
// resolve to the real membership, not to null.
check('one membership plus a stale default → the real membership', () =>
  assert.deepStrictEqual(pickActiveOrg([ACME], '', 'org_globex'), ACME));

// ---------------------------------------------------------------------------
console.log('\n5. no memberships, and rows that are not memberships');
// REJECTS: throwing, or returning `{orgId: ''}` instead of null. A caller with
// no org is ordinary — a host who has not joined a team — and the authorizer
// turns null into a blank orgId rather than a denial.

check('no memberships → null', () =>
  assert.strictEqual(pickActiveOrg([], '', ''), null));
check('no memberships, even with a request → null', () =>
  assert.strictEqual(pickActiveOrg([], 'org_acme', 'org_acme'), null));
check('a non-array (a failed query) → null, not a throw', () =>
  assert.strictEqual(pickActiveOrg(undefined, 'org_acme', ''), null));

// REJECTS: keeping a row whose orgId is missing or blank. Such a row would
// count towards "exactly one membership" and hand back `orgId: ''`, and
// tenant.js:gamesIndexPk('') THROWS on a blank id — a 500 inside a handler
// instead of a clean no-org read here.
check('a torn row with no orgId is dropped, not counted', () =>
  assert.strictEqual(pickActiveOrg([{ role: 'owner' }], '', ''), null));
check('a torn row does not make a single real membership ambiguous', () =>
  assert.deepStrictEqual(pickActiveOrg([{ role: 'owner' }, ACME], '', ''), ACME));

// REJECTS: leaving the role in whatever case the row carried. `roleAtLeast`
// lower-cases before comparing, but `tenant.js:callerOrgRole` checks membership
// of ORG_ROLES on the lower-cased value — a role of 'Owner' surviving to the
// context is fine there and not fine anywhere that compares it directly.
check('the role is normalised to lower case', () =>
  assert.strictEqual(
    pickActiveOrg([{ orgId: 'org_acme', role: 'OWNER' }], '', '').role, 'owner'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
