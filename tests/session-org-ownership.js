/**
 * A SESSION CAN ONLY BE DRIVEN BY THE ORGANISATION THAT OWNS IT.
 *
 * ── THE HOLE ───────────────────────────────────────────────────────────────
 *
 * Tenancy put sessions in per-org partitions and then exactly ONE handler used
 * that fact. `get-games-list` queries `gamesIndexPk(callerOrgId)`, so a rival's
 * LIST is correctly empty — which is precisely what made this hard to see.
 * Every other session route read `orgId` off the row it had just fetched and
 * never compared it to the caller.
 *
 * Verified against dev by driving it: an authenticated host in organisation B,
 * holding only a four-digit code, could read a session's private briefing,
 * write its results, ADVANCE A LIVE ROOM to the next question, rename it, and
 * start it. The rival's new title was written back encrypted under the victim
 * organisation's key.
 *
 * The real boundary was "any `hosts` account plus one of 9,000 ids".
 *
 * // rejects: a session route that reads orgId and does not compare it, and any
 * //          future route that forgets the comparison entirely.
 */
const path = require('path');
const fs = require('fs');
const assert = require('assert');

const REPO = path.join(__dirname, '..');
const tenant = require(path.join(REPO, 'lambda-functions/game/tenant.js'));

let pass = 0; let fail = 0;
const check = (label, fn) => {
  try { fn(); console.log(`  ok   - ${label}`); pass += 1; } catch (e) {
    console.log(`  FAIL - ${label}\n         ${e.message}`); fail += 1;
  }
};

const caller = (groups, orgId) => ({
  requestContext: { authorizer: { lambda: { userId: 'u', groups, orgId } } },
});
const ORG_A = 'org_9xK4Fq7Pz2mNbVc8dQwLxR';
const ORG_B = 'org_Tb2VnQ8sLxK4WmC7gRdYpF';

console.log('1. the decision itself');

check('the owning org may drive its own session', () =>
  assert.strictEqual(
    tenant.callerMayDriveSession(caller('hosts', ORG_A), { orgId: ORG_A }), true));

// rejects: THE HOLE. This is the whole file.
check('another organisation may NOT, even holding the code', () =>
  assert.strictEqual(
    tenant.callerMayDriveSession(caller('hosts', ORG_B), { orgId: ORG_A }), false));

// rejects: Engage staff being exempt. The platform split took content access
// away from staff deliberately; a live session is content.
check('Engage staff are not exempt', () =>
  assert.strictEqual(
    tenant.callerMayDriveSession(caller('admins,hosts', ORG_B), { orgId: ORG_A }), false));

check('a host with no organisation may not drive an org\'s session', () =>
  assert.strictEqual(
    tenant.callerMayDriveSession(caller('hosts', ''), { orgId: ORG_A }), false));

console.log('\n2. what it deliberately does NOT refuse');

/* A session with no orgId predates tenancy or was made by an orgless host.
   Refusing those would break running rooms to close a hole they are not part
   of — they are a separate problem (unlisted, and their code can never be
   released) and not this function's to solve. */
// rejects: breaking every pre-tenancy session to close a new hole.
check('a session with no owning org is left alone', () =>
  assert.strictEqual(
    tenant.callerMayDriveSession(caller('hosts', ORG_B), { orgId: '' }), true));

/* THE PARTICIPANT JOURNEY IS NEVER GATED. Joining, answering, voting and
   reading a resolved result carry no token by design, so an unauthenticated
   caller is judged by the existing role logic and not by this. */
// rejects: gating a room full of people out of a session that is running.
check('an anonymous participant is not judged by this at all', () =>
  assert.strictEqual(
    tenant.callerMayDriveSession({}, { orgId: ORG_A }), true));

console.log('\n3. the routes that must ask');

/*
  A source scan, because the decision above is worthless if a route does not
  consult it — and "forgot to call the guard" is exactly how this shipped the
  first time.
*/
for (const rel of [
  'lambda-functions/game/next-question.js',
  'lambda-functions/game/update-game.js',
  'lambda-functions/game/start-game.js',
  // Added late, and they had been unscoped since before tenancy: both carry the
  // Cognito authorizer, so the boundary was "any `hosts` account plus one of
  // 9,000 codes". `stage-beat` is the sharper one — the `feedback` beat it
  // writes is half of the gate the PUBLIC comment route trusts, so leaving it
  // unscoped handed a stranger a write path into a rival's round report.
  // `session-beat-org-scope.js` drives both handlers and proves that chain.
  'lambda-functions/game/stage-beat.js',
  'lambda-functions/game/reveal-authors.js',
]) {
  const src = fs.readFileSync(path.join(REPO, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
  check(`${path.basename(rel)} asks before acting`, () => {
    assert.ok(/callerMayDriveSession\s*\(/.test(src),
      'this route drives somebody\'s live session and must check whose it is');
  });
}

console.log('\n4. the three bundles agree');

const copies = [
  'lambda-functions/game/tenant.js',
  'lambda-functions/websocket/tenant.js',
  'lambda-functions/admin/shared/tenant.js',
].map((rel) => fs.readFileSync(path.join(REPO, rel), 'utf8'));
// rejects: one bundle enforcing the boundary and another not.
check('callerMayDriveSession is in all three copies, identically', () => {
  for (const body of copies) {
    assert.ok(body.includes('function callerMayDriveSession'), 'missing from a bundle');
  }
  assert.strictEqual(copies[0], copies[1], 'game and websocket copies have drifted');
  assert.strictEqual(copies[0], copies[2], 'game and admin copies have drifted');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
