/**
 * WHEN ONE OF ENGAGE'S OWN SETS IS CHECKED, AND WHO STARTS IT.
 *
 * A platform set is served to every organisation, so it reaches further than
 * anything in the public library, and nothing had ever measured one. The
 * owner's trigger is the moment what every organisation plays CHANGES, which
 * is three routes:
 *
 *   SWITCHED ON            the moment it becomes servable to everybody, which
 *                          is the analogue of an organisation sharing theirs
 *                          (admin/toggle-question-set.js).
 *   REPLACED WHILE ON      new questions under a set the library is already
 *                          serving — the same content change a share would
 *                          have had checked (admin/upload-questions.js).
 *   PROMOTED WHILE ON      a different version of a set the library is already
 *                          serving becomes the one it serves, and a version
 *                          reached this way may never have been measured at all
 *                          (admin/promote-set-version.js).
 *
 * THE SERVER IS THE TRIGGER. Each of the three dispatches the check itself once
 * its own write has landed — `admin/shared/house-check.js`, an
 * `InvocationType: 'Event'` invoke of the check function, which is what the
 * narrow `lambda:InvokeFunction` grant in template-clean.yaml exists for. The
 * console used to fire it off the answer, and a console closed between the two
 * calls left one of Engage's sets live and unchecked; there is nothing to close
 * now.
 *
 * WHAT THESE PIN is that the dispatch follows the CHANGE and nothing else — a
 * transition rather than a state, Engage's library and never an organisation's,
 * exactly one request rather than two — and above all that THE WRITE NEVER
 * FAILS OR WAITS BECAUSE OF IT: a dispatch that will not go is logged and
 * swallowed, and the activation, the save and the promote all still answer
 * success. `checkDue` is still stated on every answer, true or false, because
 * it is the sentence the console shows the person.
 */
const assert = require('assert');
const path = require('path');
const h = require('./helpers/archive-harness');

const REPO = path.join(__dirname, '..');
const { setMetadataKey } = require(path.join(REPO, 'lambda-functions/admin/shared/set-version.js'));
const toggle = require(path.join(REPO, 'lambda-functions/admin/toggle-question-set.js')).handler;
const upload = require(path.join(REPO, 'lambda-functions/admin/upload-questions.js')).handler;
const promote = require(path.join(REPO, 'lambda-functions/admin/promote-set-version.js')).handler;

const { check, finish } = h.checker();
const CSV = 'Category,Title,Detail\nWarmups,First,One\nWarmups,Second,Two';
const CSV2 = 'Category,Title,Detail\nWarmups,Third,Three';
const HOUSE = { scope: 'platform', setId: 'warmups' };
const ORG = 'org_acme';
const body = (res) => JSON.parse(res.body || '{}');

// `topic` because a live set is created with a shelf now (shared/set-topics.js);
// `extra` still overrides it, so a caller may drop or change it.
const create = (extra) => upload(h.adminEvent({ fileName: 'warm.csv', fileContent: CSV, customTitle: 'Warm Ups', topic: 'everyday-life', ...extra }));
const replace = () => upload(h.adminEvent({ fileName: 'edit.csv', fileContent: CSV2, replaceSetId: 'warmups' }));
const setActive = (active) => toggle({
  ...h.adminEvent({ active }),
  pathParameters: { setId: 'warmups' },
});
const promoteTo = (version, setId = 'warmups') => promote({
  ...h.adminEvent(undefined),
  pathParameters: { setId, version: String(version) },
});
const meta = () => h.get(setMetadataKey(HOUSE).PK, setMetadataKey(HOUSE).SK);

/** The checks dispatched since the last reset, and for which set. */
const checksSent = () => h.dispatched.filter((d) => d.payload?.pathParameters?.setId !== undefined);

(async () => {
  console.log('1. switching one of Engage\'s sets on');
  h.reset();
  await create({ startInactive: true });
  h.dispatched.length = 0;
  let res = await setActive(true);
  await check('an activation that made it servable says the check is due', () => {
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.strictEqual(body(res).checkDue, true);
    assert.strictEqual(body(res).active, true);
  });

  // rejects: the console being the only thing that fires it, which left a set
  // live and unchecked whenever the tab was closed between the two calls.
  await check('and the activation STARTS it, exactly once', () => {
    assert.strictEqual(checksSent().length, 1,
      `${checksSent().length} checks were dispatched by one activation`);
  });

  // rejects: a request that waits for the check (which would put the
  // activation behind a 900-second job), and one aimed at the wrong function.
  await check('as a fire-and-forget invoke of the check function, for that set', () => {
    const [sent] = checksSent();
    assert.strictEqual(sent.InvocationType, 'Event', 'the activation waits on the check');
    assert.strictEqual(sent.FunctionName, process.env.CHECK_FUNCTION_NAME);
    assert.strictEqual(sent.payload.pathParameters.setId, 'warmups');
  });

  // rejects: a dispatch that invents a caller. The check writes who asked onto
  // the set's own review log, and the answer is the person who switched it on.
  await check('carrying the authorizer of the person who switched it on', () => {
    const [sent] = checksSent();
    assert.deepStrictEqual(sent.payload.requestContext.authorizer.lambda, {
      groups: 'admins', userId: 'staff-1', username: 'staff@engage.test',
    });
  });

  // rejects: a state rather than a transition. Switching on a set that is
  // already on makes nothing newly servable, and a check for every press would
  // spend guardrail calls on content nobody changed.
  h.dispatched.length = 0;
  res = await setActive(true);
  await check('switching on a set that was already on is not a transition', () => {
    assert.strictEqual(body(res).checkDue, false);
    assert.strictEqual(checksSent().length, 0, 'a press that changed nothing spent a check');
  });

  h.dispatched.length = 0;
  res = await setActive(false);
  await check('switching one OFF is never due — nothing is served by it now', () => {
    assert.strictEqual(body(res).checkDue, false);
    assert.strictEqual(meta().active, false);
    assert.strictEqual(checksSent().length, 0, 'switching a set off started a check on it');
  });

  // rejects: an absent field, which a client cannot tell from "not due"
  // without also knowing which build it is talking to.
  await check('the fact is stated on every answer, true or false', () => {
    assert.ok('checkDue' in body(res));
  });

  console.log('\n2. replacing the questions while it is on');
  h.reset();
  await create({});
  h.dispatched.length = 0;
  res = await replace();
  await check('new questions under a set the library is serving are due a check', () => {
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.strictEqual(body(res).checkDue, true);
    assert.strictEqual(body(res).replaced, true);
  });
  await check('and the save starts it, exactly once, on the set it replaced', () => {
    assert.strictEqual(checksSent().length, 1,
      `${checksSent().length} checks were dispatched by one save`);
    assert.strictEqual(checksSent()[0].payload.pathParameters.setId, 'warmups');
    assert.strictEqual(checksSent()[0].InvocationType, 'Event');
  });

  h.reset();
  await create({ startInactive: true });
  h.dispatched.length = 0;
  res = await replace();
  await check('replacing an Engage set that is switched OFF is not due', () => {
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.strictEqual(body(res).checkDue, false);
    assert.strictEqual(checksSent().length, 0, 'a set nobody is served started a check');
  });

  // rejects: a brand-new set claiming a due check. Nothing is served by it
  // until somebody switches it on, and that activation is the trigger.
  h.reset();
  res = await create({});
  await check('creating a set is not replacing one, and says so', () => {
    assert.strictEqual(body(res).checkDue, false);
    assert.strictEqual(body(res).replaced, false);
    assert.strictEqual(checksSent().length, 0, 'a create started a check');
  });

  console.log('\n3. promoting a different version of one it is serving');
  /*
    THE THIRD ROUTE THAT CHANGES WHAT EVERY ORGANISATION PLAYS. A promote is the
    rollback — every version stays on disk — and the version it rolls back to may
    never have been measured: a replace made while the set was switched OFF
    dispatches nothing, and the activation that followed checked only whichever
    version was active by then. So a promote can put content the library has
    never judged in front of everybody, which is the same situation as a replace
    while on and is treated as one.
  */
  h.reset();
  await create({});
  const replaced = body(await replace());
  h.dispatched.length = 0;
  const rollback = await promoteTo(1);
  await check('a promote on a set the library is serving starts a check on it', () => {
    assert.strictEqual(rollback.statusCode, 200, rollback.body);
    assert.strictEqual(body(rollback).promoted, true, `v${replaced.version} did not roll back`);
    assert.strictEqual(body(rollback).checkDue, true);
    assert.strictEqual(checksSent().length, 1,
      `${checksSent().length} checks were dispatched by one promote`);
    assert.strictEqual(checksSent()[0].payload.pathParameters.setId, 'warmups');
  });

  // rejects: a promote to the version that is already active — nothing moved,
  // so nothing newly reaches anybody.
  h.dispatched.length = 0;
  const again = await promoteTo(1);
  await check('promoting the version that is already active changes nothing and starts nothing', () => {
    assert.strictEqual(body(again).promoted, false);
    assert.strictEqual(body(again).checkDue, false);
    assert.strictEqual(checksSent().length, 0);
  });

  h.reset();
  await create({ startInactive: true });
  await replace();
  h.dispatched.length = 0;
  const offPromote = await promoteTo(1);
  await check('promoting a version of a set that is switched OFF starts nothing', () => {
    assert.strictEqual(offPromote.statusCode, 200, offPromote.body);
    assert.strictEqual(body(offPromote).promoted, true);
    assert.strictEqual(body(offPromote).checkDue, false);
    assert.strictEqual(checksSent().length, 0);
  });

  console.log('\n4. an organisation\'s own set is untouched');
  /*
    Seeded rather than uploaded: an organisation's rows are encrypted under that
    organisation's key and this harness has no key loader, which is itself the
    reason `checkPlatformSet` reads platform rows in plaintext. What is being
    pinned here is the RULE, and the rule is read off the scope.
  */
  h.reset();
  h.seedSet({
    scope: 'org', orgId: ORG, setId: 'teamwarm', version: 1,
    // FILED, because this set is switched on below and toggle-question-set.js
    // refuses to make an unfiled one servable. Which shelf does not matter to
    // what is pinned here — that the check is Engage's trigger, not an org's.
    meta: {
      name: 'Team Warm Ups', scope: 'org', orgId: ORG, active: false,
      createdBy: 'staff-1', questionCount: 2, topic: 'business-work',
    },
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
  // rejects: Engage starting to check customer content on its own. An
  // organisation's set is checked when THEY share it, on their own quota, by
  // their own action — nothing here may add a second trigger to that.
  await check('and nothing is dispatched for it', () => {
    assert.strictEqual(checksSent().length, 0,
      'switching an organisation\'s own set on started a check on their content');
  });

  console.log('\n5. a dispatch that will not go');
  /*
    THE RULE THAT MATTERS MOST. The check is work that follows a write which has
    already landed; it may not reach back and undo it. A missing grant, a
    throttle or a Lambda control-plane outage all arrive here as a throw out of
    `lambda.send`, and all three must leave the person with the thing they
    pressed the button for.
  */
  h.reset();
  await create({ startInactive: true });
  h.options.lambdaShouldFail = true;
  res = await setActive(true);
  await check('an activation whose dispatch throws still switches the set on', () => {
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.strictEqual(body(res).active, true);
    assert.strictEqual(meta().active, true, 'the set was not switched on');
  });

  res = await replace();
  await check('a save whose dispatch throws still replaces the questions', () => {
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.strictEqual(body(res).replaced, true);
    assert.strictEqual(meta().activeVersion, body(res).version, 'the new version is not live');
  });

  const failedPromote = await promoteTo(1);
  await check('a promote whose dispatch throws still promotes', () => {
    assert.strictEqual(failedPromote.statusCode, 200, failedPromote.body);
    assert.strictEqual(body(failedPromote).promoted, true);
    assert.strictEqual(meta().activeVersion, 1);
  });

  finish();
})().catch((e) => { console.error('harness error:', e); process.exit(2); });
