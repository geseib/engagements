/**
 * A SUSPENDED ORGANISATION'S ROOM STOPS ADMITTING JOINS AND ANSWERS (#40).
 *
 * Participants never meet the authorizer — a player joins with a four-digit
 * code — so the participant routes ask org-standing.js with the SESSION's own
 * orgId. Pinned here:
 *
 *   1. the join gate (session-gate.js, which join and handover share) refuses
 *      a suspended org's session with SESSION_UNAVAILABLE and a plain message
 *   2. ...behind the private-code gate, so it is no oracle for the codeless
 *   3. ...and admits an active org's session and a pre-tenancy one
 *   4. the status is cached CACHE_MS and then re-read (how fast it bites)
 *   5. a failed read is good standing (outage rule)
 *   6. the vote, survey and WebSocket answer paths ask BEFORE they store
 *   7. the two copies of org-standing.js are byte-equal
 *   8. the join screen shows the server's sentence for this refusal
 */
const suiteFinished = require('./helpers/finish-guard');
const path = require('path');
const fs = require('fs');
const assert = require('assert');

const REPO = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(REPO, p), 'utf8');

const standing = require(path.join(REPO, 'lambda-functions/game/org-standing.js'));
const { openSessionOr } = require(path.join(REPO, 'lambda-functions/game/session-gate.js'));

let pass = 0, fail = 0;
const say = (s) => console.log(s);
async function check(label, fn) {
  try { await fn(); console.log(`  PASS  ${label}`); pass++; }
  catch (e) { console.log(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

/* A table keyed "PK|SK"; counts reads so the cache can be seen working. */
function fakeDb(rows, { throwOn = null } = {}) {
  const db = {
    reads: [],
    async send(command) {
      const k = command.input.Key;
      db.reads.push(`${k.PK}|${k.SK}`);
      if (throwOn && k.PK.startsWith(throwOn)) throw new Error('ProvisionedThroughputExceededException');
      return { Item: rows[`${k.PK}|${k.SK}`] };
    },
  };
  return db;
}
const game = (orgId, extra = {}) => ({ 'GAME#5479|METADATA': { PK: 'GAME#5479', SK: 'METADATA', Started: true, orgId, ...extra } });
const org = (orgId, status) => ({ [`ORG#${orgId}|METADATA`]: { PK: `ORG#${orgId}`, SK: 'METADATA', status } });

(async () => {
  say('\n1. the join gate refuses a suspended organisation\'s session');
  {
    standing._resetCache();
    const db = fakeDb({ ...game('org_S'), ...org('org_S', 'suspended') });
    const gate = await openSessionOr(db, 'T', '5479', undefined);
    const b = gate.response ? JSON.parse(gate.response.body) : {};
    await check('refused', () => assert.strictEqual(gate.ok, false));
    await check('403 with code SESSION_UNAVAILABLE', () => {
      assert.strictEqual(gate.response.statusCode, 403); assert.strictEqual(b.code, 'SESSION_UNAVAILABLE');
    });
    await check('a plain message that says nothing about why', () => {
      assert.match(b.message, /not available right now/i);
      assert.ok(!/suspend/i.test(b.message), 'a participant must not be told an org is suspended');
    });
  }

  say('\n2. ...behind the private-code gate');
  {
    standing._resetCache();
    const db = fakeDb({ ...game('org_S', { Visibility: 'private', AccessCode: '9999' }), ...org('org_S', 'suspended') });
    const gate = await openSessionOr(db, 'T', '5479', undefined);
    await check('no code: the code refusal, as before', () =>
      assert.strictEqual(JSON.parse(gate.response.body).error, 'Access code required'));
    await check('and the org was never read', () => assert.ok(!db.reads.includes('ORG#org_S|METADATA')));
  }

  say('\n3. other sessions are unaffected');
  {
    standing._resetCache();
    const a = await openSessionOr(fakeDb({ ...game('org_A'), ...org('org_A', 'active'), ...org('org_S', 'suspended') }), 'T', '5479');
    await check('an active org\'s session: admitted', () => assert.strictEqual(a.ok, true));
    const p = await openSessionOr(fakeDb({ ...game(undefined) }), 'T', '5479');
    await check('a pre-tenancy session (no orgId): admitted, no org read', () => assert.strictEqual(p.ok, true));
  }

  say('\n4. how fast it bites: cached for CACHE_MS, then re-read');
  {
    standing._resetCache();
    const rows = { ...org('org_C', 'active') };
    const db = fakeDb(rows);
    const t0 = 1_000_000;
    await check('active at t0', async () => assert.strictEqual(await standing.orgIsSuspended(db, 'T', 'org_C', { now: t0 }), false));
    rows['ORG#org_C|METADATA'].status = 'suspended';
    await check('still active inside the window (one read)', async () => {
      assert.strictEqual(await standing.orgIsSuspended(db, 'T', 'org_C', { now: t0 + standing.CACHE_MS - 1 }), false);
      assert.strictEqual(db.reads.length, 1);
    });
    await check('suspended once the window passes', async () =>
      assert.strictEqual(await standing.orgIsSuspended(db, 'T', 'org_C', { now: t0 + standing.CACHE_MS + 1 }), true));
    await check('the window is short: 30 seconds or less', () => assert.ok(standing.CACHE_MS <= 30 * 1000));
  }

  say('\n5. a failed read is good standing');
  {
    standing._resetCache();
    const db = fakeDb({}, { throwOn: 'ORG#' });
    await check('a throttle does not stop the room', async () =>
      assert.strictEqual(await standing.orgIsSuspended(db, 'T', 'org_X'), false));
  }

  say('\n6. the answer paths ask before they store');
  const before = (src, ask, write, label) => check(label, () => {
    const a = src.indexOf(ask);
    assert.ok(a > -1, `${ask} not found`);
    const w = src.indexOf(write, a);
    assert.ok(w > a, `${write} does not follow the check`);
  });
  {
    const vote = read('lambda-functions/game/submit-vote.js');
    await before(vote, 'orgIsSuspended(db, process.env.TABLE_NAME, voteOrgId)', 'new PutCommand', 'a vote: checked, then stored');
    const survey = read('lambda-functions/game/survey-answers.js');
    for (const fn of ['async function putAnswer', 'async function submit(']) {
      const body = survey.slice(survey.indexOf(fn), survey.indexOf(fn) + 400);
      // eslint-disable-next-line no-await-in-loop
      await check(`a survey ${fn.includes('submit') ? 'submit' : 'answer'}: checked first`, () =>
        assert.match(body, /orgIsSuspended\(db, TABLE\(\), orgOf\(meta\)\)\) return unavailable\(\)/));
    }
    const ws = read('lambda-functions/websocket/message.js');
    await before(ws, 'orgIsSuspended(db, process.env.TABLE_NAME, answerOrgId)', 'Item: itemToStore', 'a WebSocket answer: checked, then stored');
    await check('the phone is told: answerReceived carries the code', () =>
      assert.match(ws, /outcome\.code \? \{ code: outcome\.code, message: outcome\.message \}/));
  }

  say('\n7. the two copies are byte-equal');
  await check('game/org-standing.js === websocket/org-standing.js', () =>
    assert.strictEqual(read('lambda-functions/game/org-standing.js'), read('lambda-functions/websocket/org-standing.js')));

  say('\n8. the join screen shows the server\'s sentence');
  {
    const jr = read('src/src/components/joinResult.js');
    await check('classifyJoinFailure falls back to payload.message', () =>
      assert.match(jr, /message:\s*payload\.message \|\| payload\.error/));
  }

  say(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('harness error:', e); process.exit(2); });
