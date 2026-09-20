/**
 * WHEN ONE OF ENGAGE'S OWN SETS IS DUE A CONTENT CHECK.
 *
 * A platform set is served to every organisation, so it reaches further than
 * anything in the public library, and nothing had ever measured one. The
 * owner's trigger, in two halves:
 *
 *   SWITCHED ON            the moment it becomes servable to everybody, which
 *                          is the analogue of an organisation sharing theirs
 *                          (admin/toggle-question-set.js).
 *   REPLACED WHILE ON      new questions under a set the library is already
 *                          serving — the same content change a share would
 *                          have had checked (admin/upload-questions.js).
 *
 * NEITHER ROUTE RUNS THE CHECK, and that is deliberate rather than unfinished.
 * A check is a JOB: the POST that starts one self-invokes the check function
 * against its 900-second budget, which needs `lambda:InvokeFunction` on that
 * function. Neither of these two holds it (template-clean.yaml gives them
 * DynamoDBCrudPolicy), so an invoke from inside either is an AccessDenied at
 * run time — and an activation must never fail because of a check, so it would
 * have to be swallowed, which is a trigger that looks like one and is not.
 *
 * So they ANSWER with the fact and the console runs it (src/utils/houseCheck.js),
 * after the write has already returned. The set is live before a byte of the
 * check is sent, which is what E3 asks for: the activation is neither delayed
 * by the check nor failed by it.
 *
 * WHAT THESE PIN is the FACT — that it is stated on every answer rather than
 * only when true, that it is a transition and not a state, and that it is
 * never stated for an organisation's own set, whose content change already
 * goes through its own share-and-check path untouched.
 */
const assert = require('assert');
const path = require('path');
const h = require('./helpers/archive-harness');

const REPO = path.join(__dirname, '..');
const { setMetadataKey } = require(path.join(REPO, 'lambda-functions/admin/shared/set-version.js'));
const toggle = require(path.join(REPO, 'lambda-functions/admin/toggle-question-set.js')).handler;
const upload = require(path.join(REPO, 'lambda-functions/admin/upload-questions.js')).handler;

const { check, finish } = h.checker();
const CSV = 'Category,Title,Detail\nWarmups,First,One\nWarmups,Second,Two';
const CSV2 = 'Category,Title,Detail\nWarmups,Third,Three';
const HOUSE = { scope: 'platform', setId: 'warmups' };
const ORG = 'org_acme';
const body = (res) => JSON.parse(res.body || '{}');

const create = (extra) => upload(h.adminEvent({ fileName: 'warm.csv', fileContent: CSV, customTitle: 'Warm Ups', ...extra }));
const replace = () => upload(h.adminEvent({ fileName: 'edit.csv', fileContent: CSV2, replaceSetId: 'warmups' }));
const setActive = (active) => toggle({
  ...h.adminEvent({ active }),
  pathParameters: { setId: 'warmups' },
});
const meta = () => h.get(setMetadataKey(HOUSE).PK, setMetadataKey(HOUSE).SK);

(async () => {
  console.log('1. switching one of Engage\'s sets on');
  h.reset();
  await create({ startInactive: true });
  let res = await setActive(true);
  await check('an activation that made it servable says the check is due', () => {
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.strictEqual(body(res).checkDue, true);
    assert.strictEqual(body(res).active, true);
  });

  // rejects: a state rather than a transition. Switching on a set that is
  // already on makes nothing newly servable, and a check for every press would
  // spend guardrail calls on content nobody changed.
  res = await setActive(true);
  await check('switching on a set that was already on is not a transition', () => {
    assert.strictEqual(body(res).checkDue, false);
  });

  res = await setActive(false);
  await check('switching one OFF is never due — nothing is served by it now', () => {
    assert.strictEqual(body(res).checkDue, false);
    assert.strictEqual(meta().active, false);
  });

  // rejects: an absent field, which a client cannot tell from "not due"
  // without also knowing which build it is talking to.
  await check('the fact is stated on every answer, true or false', () => {
    assert.ok('checkDue' in body(res));
  });

  console.log('\n2. replacing the questions while it is on');
  h.reset();
  await create({});
  res = await replace();
  await check('new questions under a set the library is serving are due a check', () => {
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.strictEqual(body(res).checkDue, true);
    assert.strictEqual(body(res).replaced, true);
  });

  h.reset();
  await create({ startInactive: true });
  res = await replace();
  await check('replacing an Engage set that is switched OFF is not due', () => {
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.strictEqual(body(res).checkDue, false);
  });

  // rejects: a brand-new set claiming a due check. Nothing is served by it
  // until somebody switches it on, and that activation is the trigger.
  h.reset();
  res = await create({});
  await check('creating a set is not replacing one, and says so', () => {
    assert.strictEqual(body(res).checkDue, false);
    assert.strictEqual(body(res).replaced, false);
  });

  console.log('\n3. an organisation\'s own set is untouched');
  /*
    Seeded rather than uploaded: an organisation's rows are encrypted under that
    organisation's key and this harness has no key loader, which is itself the
    reason `checkPlatformSet` reads platform rows in plaintext. What is being
    pinned here is the RULE, and the rule is read off the scope.
  */
  h.reset();
  h.seedSet({
    scope: 'org', orgId: ORG, setId: 'teamwarm', version: 1,
    meta: { name: 'Team Warm Ups', scope: 'org', orgId: ORG, active: false, createdBy: 'staff-1', questionCount: 2 },
  });
  const orgToggle = await toggle({ ...h.orgAdminEvent(ORG, { active: true }), pathParameters: { setId: 'teamwarm' } });
  await check('switching an organisation\'s own set on is never due a check here', () => {
    assert.strictEqual(orgToggle.statusCode, 200, orgToggle.body);
    assert.strictEqual(body(orgToggle).scope, 'org');
    assert.strictEqual(body(orgToggle).checkDue, false);
  });
  await check('and the field is still stated, so a client reads one shape', () => {
    assert.ok('checkDue' in body(orgToggle));
  });

  finish();
})().catch((e) => { console.error('harness error:', e); process.exit(2); });
