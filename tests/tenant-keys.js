/**
 * THE KEY SCHEME, PINNED.
 *
 * Every partition that carries content is built by the tenant.js copies under
 * lambda-functions (game, websocket and admin/shared).
 * If a key builder ever drops its scope segment, one organisation reads another
 * organisation's rows and nothing else in the system notices — a Query does not
 * know or care which tenant a partition was meant for. That is the failure this
 * file exists to make loud.
 *
 * rejects: dropping a scope prefix; an unknown scope defaulting to platform
 * instead of throwing; an org key built with a blank orgId; the three copies of
 * tenant.js drifting apart; platform keys changing shape at all.
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');
const T = require(path.join(REPO, 'lambda-functions/game/tenant.js'));

let pass = 0, fail = 0;
function check(label, fn) {
  try { fn(); console.log(`  ok - ${label}`); pass++; }
  catch (e) { console.log(`  FAIL - ${label}\n    ${e.message}`); fail++; }
}
const evt = (lambda) => ({ requestContext: { authorizer: { lambda } } });

// ---------- 1. Platform keys are TODAY's keys, unchanged ----------
// This is the entire migration: every existing set lives at PK='SETS' and
// SET#<id>, and the owner's decision is that all of it is central content
// available to everyone. If these four assertions ever change, a migration
// exists that did not before.
console.log('\n1. platform keys are byte-identical to the current live keys');
check("metadata partition is exactly 'SETS'", () =>
  assert.strictEqual(T.setsMetadataPk(T.PLATFORM), 'SETS'));
check("unversioned content is exactly 'SET#<id>'", () =>
  assert.strictEqual(T.setContentPk(T.PLATFORM, null, '80strivia'), 'SET#80strivia'));
check("versioned content is exactly 'SET#<id>#v<n>'", () =>
  assert.strictEqual(T.setContentPk(T.PLATFORM, null, '80strivia', 3), 'SET#80strivia#v3'));
check('platform prefix is the empty string, which is what makes that true', () =>
  assert.strictEqual(T.scopePrefix(T.PLATFORM), ''));

// ---------- 2. Org keys carry the org, always ----------
console.log('\n2. org keys carry the organisation');
check('metadata partition', () =>
  assert.strictEqual(T.setsMetadataPk(T.ORG, 'org_nw'), 'ORG#org_nw#SETS'));
check('content partition', () =>
  assert.strictEqual(T.setContentPk(T.ORG, 'org_nw', 'teamretro'), 'ORG#org_nw#SET#teamretro'));
check('versioned content partition', () =>
  assert.strictEqual(T.setContentPk(T.ORG, 'org_nw', 'teamretro', 2),
    'ORG#org_nw#SET#teamretro#v2'));
check('session index', () =>
  assert.strictEqual(T.gamesIndexPk('org_nw'), 'ORG#org_nw#GAMES'));

// THE COLLISION THAT USED TO DESTROY DATA. setId is a slug of the title
// (upload-questions.js:298), so two orgs naming a set "Team Retro" both produce
// `teamretro`. In one global partition the second write silently clobbers the
// first. Scoped, they cannot meet.
check('two orgs with the same slug do not collide', () =>
  assert.notStrictEqual(
    T.setContentPk(T.ORG, 'org_nw', 'teamretro'),
    T.setContentPk(T.ORG, 'org_md', 'teamretro')));
check('and neither collides with the platform set of that name', () => {
  const plat = T.setContentPk(T.PLATFORM, null, 'teamretro');
  assert.notStrictEqual(plat, T.setContentPk(T.ORG, 'org_nw', 'teamretro'));
  assert.notStrictEqual(plat, T.setContentPk(T.PUBLIC, null, 'teamretro'));
});

// ---------- 3. Public is its own place ----------
console.log('\n3. public is a third scope, not platform');
check('public metadata partition', () =>
  assert.strictEqual(T.setsMetadataPk(T.PUBLIC), 'PUBLIC#SETS'));
check('public content partition', () =>
  assert.strictEqual(T.setContentPk(T.PUBLIC, null, 'retrostarters'), 'PUBLIC#SET#retrostarters'));
check('public is NOT the same partition as platform', () =>
  assert.notStrictEqual(T.setsMetadataPk(T.PUBLIC), T.setsMetadataPk(T.PLATFORM)));

// ---------- 4. It fails loudly, never quietly ----------
// A typo'd scope defaulting to platform would publish an org's content to
// everybody. A blank orgId building `ORG##SETS` would put every org that
// happened to have one in the same partition.
console.log('\n4. bad input throws rather than defaulting');
for (const bad of ['Org', 'ORG', 'private', '', null, undefined, 0]) {
  check(`scope ${JSON.stringify(bad)} throws`, () =>
    assert.throws(() => T.scopePrefix(bad), /unknown scope/));
}
for (const blank of ['', '   ', null, undefined]) {
  check(`org scope with orgId ${JSON.stringify(blank)} throws`, () =>
    assert.throws(() => T.setsMetadataPk(T.ORG, blank), /requires an orgId/));
}
check('setContentPk with a blank setId throws', () =>
  assert.throws(() => T.setContentPk(T.PLATFORM, null, ''), /requires a setId/));
check('gamesIndexPk with a blank orgId throws', () =>
  assert.throws(() => T.gamesIndexPk(''), /requires an orgId/));

// A version that is not a positive integer must produce the UNVERSIONED key,
// not `#vNaN` or `#v0` — set-version.js's toVersion has the same contract and
// the two must agree or a game pins a partition that does not exist.
console.log('\n   and a junk version reads as unversioned, never #vNaN');
for (const v of [null, undefined, 0, -1, 'x', NaN, '']) {
  check(`version ${JSON.stringify(v)} -> unversioned`, () =>
    assert.strictEqual(T.setContentPk(T.PLATFORM, null, 's', v), 'SET#s'));
}

// ---------- 5. The caller's organisation ----------
console.log('\n5. reading the caller out of the authorizer context');
check('orgId comes from .authorizer.lambda, the shape this API produces', () =>
  assert.strictEqual(T.callerOrgId(evt({ orgId: 'org_nw' })), 'org_nw'));
check('a missing context yields the empty string, not undefined', () =>
  assert.strictEqual(T.callerOrgId({}), ''));
check('an unknown role is refused rather than defaulted', () =>
  assert.strictEqual(T.callerOrgRole(evt({ orgRole: 'superuser' })), ''));
check('orgIds is comma-joined, like groups', () =>
  assert.deepStrictEqual(T.callerOrgIds(evt({ orgIds: 'org_a, org_b ,org_c' })),
    ['org_a', 'org_b', 'org_c']));

console.log('\n   role precedence');
check('owner satisfies admin', () => assert.ok(T.roleAtLeast('owner', 'admin')));
check('admin satisfies admin', () => assert.ok(T.roleAtLeast('admin', 'admin')));
check('member does NOT satisfy admin', () => assert.ok(!T.roleAtLeast('member', 'admin')));
check('a blank role satisfies nothing', () => assert.ok(!T.roleAtLeast('', 'member')));

// ---------- 6. Who may see and change what ----------
console.log('\n6. readable scopes');
check('a signed-in caller with no org still sees platform and public', () =>
  assert.deepStrictEqual(T.readableScopes({}), [T.PLATFORM, T.PUBLIC]));
check('a caller with an org sees their own too', () =>
  assert.deepStrictEqual(T.readableScopes(evt({ orgId: 'org_nw' })),
    [T.PLATFORM, T.PUBLIC, T.ORG]));

// THE ASSERTION THE WHOLE ISOLATION STORY RESTS ON. There is no scope value
// meaning "everyone's", and being Engage staff does not add one.
check('a platform admin gets NO extra scope', () =>
  assert.deepStrictEqual(T.readableScopes(evt({ groups: 'admins' })),
    [T.PLATFORM, T.PUBLIC]));

console.log('\n   manageable scopes');
/*
  TWO STAFF FIXTURES NOW, because being Engage staff is no longer enough on its
  own to write Engage's library — the caller must also be ACTING AS Engage.

  An Engage admin standing inside a customer's team renamed a platform question
  set on dev, and every organisation reads that library. The staff group says
  WHO may change it; the absence of an active organisation says they meant to.
*/
const staffAsEngage = evt({ groups: 'admins,hosts', orgId: '', orgRole: '' });
const staff = evt({ groups: 'admins,hosts', orgId: 'org_nw', orgRole: 'member' });
const member = evt({ groups: 'hosts', orgId: 'org_nw', orgRole: 'member' });
const orgAdmin = evt({ groups: 'hosts', orgId: 'org_nw', orgRole: 'admin' });

check('platform content: Engage staff ACTING AS ENGAGE yes', () =>
  assert.ok(T.canManageScope(staffAsEngage, T.PLATFORM)));
// rejects: the reported bug — staff editing the shared library from inside an
// organisation, where the row looks like one of that organisation's own.
check('platform content: the same staff INSIDE AN ORG no', () =>
  assert.ok(!T.canManageScope(staff, T.PLATFORM)));
check('platform content: Engage staff yes (legacy name, acting as Engage)', () =>
  assert.ok(T.canManageScope(staffAsEngage, T.PLATFORM)));
check('platform content: an org admin no', () =>
  assert.ok(!T.canManageScope(orgAdmin, T.PLATFORM)));
check('own org: a member yes', () =>
  assert.ok(T.canManageScope(member, T.ORG, 'org_nw')));
check("ANOTHER org: a member no", () =>
  assert.ok(!T.canManageScope(member, T.ORG, 'org_md')));
check('ANOTHER org: Engage staff no, and this is the point', () =>
  assert.ok(!T.canManageScope(staff, T.ORG, 'org_md')));
check('own org at admin level: a member no', () =>
  assert.ok(!T.canManageScope(member, T.ORG, 'org_nw', 'admin')));
check('own org at admin level: an admin yes', () =>
  assert.ok(T.canManageScope(orgAdmin, T.ORG, 'org_nw', 'admin')));
check('public: nobody, because a public row is a copy', () => {
  assert.ok(!T.canManageScope(staff, T.PUBLIC));
  assert.ok(!T.canManageScope(orgAdmin, T.PUBLIC));
});
check('an anonymous caller manages nothing', () => {
  assert.ok(!T.canManageScope({}, T.PLATFORM));
  assert.ok(!T.canManageScope({}, T.ORG, 'org_nw'));
});

// ---------- 7. Guards ----------
console.log('\n7. guards return a response or null');
check('requireOrg passes a member', () => assert.strictEqual(T.requireOrg(member), null));
check('requireOrg refuses a caller with no org', () =>
  assert.strictEqual(T.requireOrg({}).statusCode, 403));
check('requireOrgAdmin refuses a member', () =>
  assert.strictEqual(T.requireOrgAdmin(member).statusCode, 403));
check('requireOrgAdmin passes an admin', () =>
  assert.strictEqual(T.requireOrgAdmin(orgAdmin), null));
check('tenantStamp records the org, or nothing at all', () => {
  assert.deepStrictEqual(T.tenantStamp(member), { orgId: 'org_nw' });
  assert.deepStrictEqual(T.tenantStamp({}), {});
});

// ---------- 8. The three copies are byte-identical ----------
// CodeUri is per-directory and there are no Lambda layers, so this module is
// triplicated exactly as set-version.js and game-types.js already are. A drift
// between them is a bug that only shows up in one bundle.
console.log('\n8. the three bundle copies have not drifted');
{
  const copies = [
    'lambda-functions/game/tenant.js',
    'lambda-functions/websocket/tenant.js',
    'lambda-functions/admin/shared/tenant.js',
  ].map((p) => ({ p, body: fs.readFileSync(path.join(REPO, p), 'utf8') }));
  check('all three exist', () => assert.strictEqual(copies.length, 3));
  for (const c of copies.slice(1)) {
    check(`${c.p} matches game/tenant.js`, () =>
      assert.strictEqual(c.body, copies[0].body,
        'the copies have drifted — one bundle is running different rules'));
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
