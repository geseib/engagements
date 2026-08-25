/**
 * ENGAGE'S LIBRARY IS ONLY EDITABLE WHILE ACTING AS ENGAGE.
 *
 * ── WHAT HAPPENED ──────────────────────────────────────────────────────────
 *
 * Reported from dev: "i was acting as a host for TeamG and went to change the
 * name of a question set and add a question. it changed the engage version, it
 * did not create a new copy."
 *
 * The system did exactly what it was told. `canManageScope(PLATFORM)` was
 * `isPlatformAdmin(event)` and nothing else — and being inside TeamG does not
 * remove somebody's `admins` group. So an Engage admin standing in a customer's
 * team, looking at a row badged "Engage", got Edit rather than Copy, and their
 * edit changed the shared library that every organisation reads.
 *
 * That is worse than the muddle it was known to be. It was recorded as a loose
 * end — "where does an Engage admin edit the platform library? today: from
 * their own personal space, which works and is conceptually muddy" — and the
 * real answer is that editing it from ANY organisation is wrong.
 *
 * ── WHY "NO ORG" WAS NOT A USABLE SIGNAL ───────────────────────────────────
 *
 * The obvious interlock is "platform edits need no active organisation". But
 * `pickActiveOrg` FALLS BACK: with no header it returns the single membership,
 * or `defaultOrgId`. Every approved account has a personal org, so `callerOrgId`
 * is essentially never empty and "no org" never happens.
 *
 * So the mode had to become real on the wire: the switcher's platform sentinel
 * now travels as `X-Engage-Org`, and the authorizer resolves it to NO
 * organisation deliberately rather than falling back. That is the one state
 * where Engage's own library may be changed.
 *
 * // rejects: an Engage admin editing the shared library while standing inside
 * //          any organisation, including their own personal space.
 */
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');
const tenant = require(path.join(REPO, 'lambda-functions/admin/shared/tenant.js'));
const access = require(path.join(REPO, 'lambda-functions/admin/shared/question-set-access.js'));
const { pickActiveOrg } = require(path.join(REPO, 'lambda-functions/auth/pick-active-org.js'));

let pass = 0; let fail = 0;
const check = (label, fn) => {
  try { fn(); console.log(`  ok   - ${label}`); pass += 1; } catch (e) {
    console.log(`  FAIL - ${label}\n         ${e.message}`); fail += 1;
  }
};

const ev = (groups, orgId, role = 'owner') => ({
  requestContext: { authorizer: { lambda: { userId: 'u_george', groups, orgId, orgRole: orgId ? role : '' } } },
});
const HOME = 'org_WLZyeb6wGSarf1grsXGxSM';
const TEAM = 'org_Y8LbpJ77xSLR6vZ8VRDbSi';
/** A platform set: absence of `scope` IS the platform stamp. */
const ENGAGE_SET = { PK: 'SETS', SK: 'SET#80strivia', name: '80s Trivia' };

console.log('1. the reported bug');

// rejects: THE REPORT. Staff inside a team editing the shared library.
check('an Engage admin acting as a host in a team may NOT edit an Engage set', () =>
  assert.strictEqual(access.canManageSet(ev('admins,hosts', TEAM), ENGAGE_SET), false));

// rejects: the same thing one door along — their own space is still an org.
check('nor from their own personal space', () =>
  assert.strictEqual(access.canManageSet(ev('admins,hosts', HOME), ENGAGE_SET), false));

console.log('\n2. and it is still editable where it should be');

// rejects: locking Engage out of its own library. Platform mode is the place.
check('an Engage admin acting AS ENGAGE may edit it', () =>
  assert.strictEqual(access.canManageSet(ev('admins,hosts', ''), ENGAGE_SET), true));

// rejects: the mode becoming the permission. It is an interlock, not a grant.
check('a host asking for platform mode still may not', () =>
  assert.strictEqual(access.canManageSet(ev('hosts', ''), ENGAGE_SET), false));

console.log('\n3. reading is unaffected');

/* Every organisation reads Engage's library — that is the point of it. Only
   WRITING is gated on the mode. */
// rejects: gating reads on the mode, which would empty every host's picker.
check('a host inside a team still READS the platform scope', () =>
  assert.ok(tenant.readableScopes(ev('hosts', TEAM)).includes(tenant.PLATFORM)));
check('and so does Engage staff inside a team', () =>
  assert.ok(tenant.readableScopes(ev('admins,hosts', TEAM)).includes(tenant.PLATFORM)));

console.log('\n4. the sentinel has to mean "no organisation, deliberately"');

const MEMBERSHIPS = [{ orgId: HOME, role: 'owner' }, { orgId: TEAM, role: 'owner' }];

/*
  Without this, platform mode is unreachable: the client sends no org, and
  `pickActiveOrg` helpfully falls back to `defaultOrgId` — so the caller lands
  in their personal space and the interlock above refuses them for ever.
*/
// rejects: falling back to a real organisation when platform mode was asked for.
check('an explicit platform request resolves to NO organisation', () =>
  assert.strictEqual(pickActiveOrg(MEMBERSHIPS, '~platform', HOME), null));

// rejects: changing what "no header" means, which is a different case and must
// keep falling back exactly as it did.
check('no header at all still falls back to the default org', () =>
  assert.deepStrictEqual(pickActiveOrg(MEMBERSHIPS, '', HOME), { orgId: HOME, role: 'owner' }));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
