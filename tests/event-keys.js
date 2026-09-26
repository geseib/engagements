/**
 * AN EVENT'S KEYS, AND WHO MAY TOUCH ITS ROWS — the tenant.js copies.
 *
 * An event is two partitions (docs/design/agenda-redesign/40-data-model.html):
 * the organisation's list, `ORG#<org>#EVENTS`, and the event itself,
 * `EVENT#<code>`. Both are built in tenant.js and nowhere else, as every
 * partition that carries content is (tests/no-global-partition-literals.js).
 *
 * The guard beside them, `callerMayManageEvent`, is `callerMayDriveSession`'s
 * membership rule without its two lenient doors: no orgless row and no caller
 * in no group gets through, because neither exists for an event.
 *
 * rejects: an events index built without its org; an EVENT# key built from
 * junk (a blank, three digits, a `#`); a copy that lacks the builders or
 * builds different keys; the event guard admitting an orgless row, an
 * anonymous caller, Engage staff who are not members, or another
 * organisation's member; the session guard changing on the way past.
 */
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');
const COPIES = ['game', 'websocket', 'admin/shared']
  .map((dir) => ({ dir, T: require(path.join(REPO, 'lambda-functions', dir, 'tenant.js')) }));
const T = COPIES[0].T;

let pass = 0; let fail = 0;
function check(label, fn) {
  try { fn(); console.log(`  ok - ${label}`); pass += 1; }
  catch (e) { console.log(`  FAIL - ${label}\n    ${e.message}`); fail += 1; }
}
const as = (lambda) => ({ requestContext: { authorizer: { lambda } } });

console.log('\n1. the two partitions');
check('the organisation\'s list is ORG#<org>#EVENTS', () =>
  assert.strictEqual(T.eventsIndexPk('org_nw'), 'ORG#org_nw#EVENTS'));
check('an event is EVENT#<code>', () =>
  assert.strictEqual(T.eventPk('5307'), 'EVENT#5307'));
check('a numeric code builds the same key as its digits', () =>
  assert.strictEqual(T.eventPk(5307), 'EVENT#5307'));
check('an event partition is never a session partition', () =>
  assert.notStrictEqual(T.eventPk('5307'), 'GAME#5307'));
for (const blank of ['', '   ', null, undefined]) {
  check(`eventsIndexPk(${JSON.stringify(blank)}) throws`, () =>
    assert.throws(() => T.eventsIndexPk(blank), /requires an orgId/));
}
for (const bad of ['', '530', '53071', '53a7', '5307#ITEM', 'EVENT#5307', null, undefined]) {
  check(`eventPk(${JSON.stringify(bad)}) throws`, () =>
    assert.throws(() => T.eventPk(bad), /four-digit code/));
}

console.log('\n2. every copy builds the same keys');
for (const { dir, T: C } of COPIES) {
  check(`${dir}/tenant.js exports the builders and the guard`, () => {
    for (const name of ['eventsIndexPk', 'eventPk', 'callerMayManageEvent']) {
      assert.strictEqual(typeof C[name], 'function', `${name} is missing`);
    }
    assert.strictEqual(C.eventsIndexPk('org_x'), 'ORG#org_x#EVENTS');
    assert.strictEqual(C.eventPk('1234'), 'EVENT#1234');
  });
}

console.log('\n3. only the owning organisation\'s members');
const ROW = { orgId: 'org_nw' };
check('a member acting for the organisation', () =>
  assert.ok(T.callerMayManageEvent(as({ groups: 'hosts', orgId: 'org_nw', orgIds: 'org_nw' }), ROW)));
check('a member acting for another of their organisations', () =>
  assert.ok(T.callerMayManageEvent(as({ groups: 'hosts', orgId: 'org_me', orgIds: 'org_me,org_nw' }), ROW)));
// rejects: the cross-tenant read this whole file exists to stop.
check('another organisation\'s member: no', () =>
  assert.ok(!T.callerMayManageEvent(as({ groups: 'hosts', orgId: 'org_md', orgIds: 'org_md' }), ROW)));
check('Engage staff who are not members: no', () =>
  assert.ok(!T.callerMayManageEvent(as({ groups: 'admins,hosts', orgId: '', orgIds: '' }), ROW)));
// rejects: callerMayDriveSession's anonymous door carried over.
check('an anonymous caller: no', () =>
  assert.ok(!T.callerMayManageEvent({}, ROW)));
check('a context naming the org but no group: no', () =>
  assert.ok(!T.callerMayManageEvent(as({ orgId: 'org_nw', orgIds: 'org_nw' }), ROW)));
// rejects: callerMayDriveSession's orgless door carried over.
check('a row with no organisation: no, even for its would-be members', () =>
  assert.ok(!T.callerMayManageEvent(as({ groups: 'hosts', orgId: 'org_nw', orgIds: 'org_nw' }), {})));
check('no row at all: no', () =>
  assert.ok(!T.callerMayManageEvent(as({ groups: 'hosts', orgId: 'org_nw', orgIds: 'org_nw' }), null)));
check('the session guard is unchanged: an orgless session still passes', () =>
  assert.ok(T.callerMayDriveSession(as({ groups: 'hosts', orgId: 'org_md' }), {})));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
