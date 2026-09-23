/**
 * THREE MORE HOST CONTROLS THAT NEVER ASKED WHOSE ROOM IT WAS.
 *
 * ── THE HOLE ───────────────────────────────────────────────────────────────
 *
 * `session-org-ownership.js` and `session-control-org-scope.js` closed the
 * cross-org hole route by route. Three Cognito-gated session routes were missed
 * by every sweep, and between them they decide what a live room is asked, who
 * is counted in it, and who may take over somebody's name:
 *
 *     POST /games/{gameId}/toggle-category                  what gets asked
 *     POST /games/{gameId}/players/{playerName}/handover    unlocks a name
 *     POST /games/{gameId}/players/{playerName}/remove      out of the counts
 *
 * Each carries `Auth: Authorizer: CognitoAuthorizer` in template-clean.yaml and
 * none called `callerMayDriveSession`, so the boundary was "any `hosts` account
 * plus one of 9,000 four-digit codes" — exactly the boundary the files above
 * record as not enough.
 *
 * ── WHY THE HANDOVER IS THE SHARP ONE ──────────────────────────────────────
 *
 * grant-handover's own header says what an unguarded grant is: "a button any
 * phone in the room could press to take another person's answers and score".
 * The authorizer moved that button out of the room and left it in every other
 * organisation. A rival unlocks a name, then claims it with a plain join, and
 * walks off with that person's answers — get-answers.js returns a player's own
 * answer text to whoever presents their clientId.
 *
 * ── WHAT IS PROVEN ─────────────────────────────────────────────────────────
 *
 *   §1–§3  a rival host is refused with 404, WRITES NOTHING and pushes no frame;
 *          the owning org's host still succeeds.
 *   §4     the refusal is not an oracle — not for the room's state, not for
 *          who is in it.
 *   §5     the guard's other two clauses: no identity, and no session.
 *   §6     what is deliberately NOT refused (an orgless, pre-tenancy room).
 *
 * "Writes nothing" is asserted on the fake table's command log rather than on
 * a field or two, because the fake PARSES and applies every write
 * (helpers/player-table.js) — a handler that asked the guard and then wrote
 * anyway fails here whichever attribute it touched.
 *
 * // rejects: a cross-org host changing a room's categories, unlocking a name
 * //          for takeover, or taking somebody out of the counts — and any of
 * //          these handlers calling the guard and acting anyway.
 */
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');

const { createTable, installStubs } = require('./helpers/player-table');

const table = createTable();
const store = table.store;
const key = table.keyOf;
const sent = [];

installStubs({ table, sent });

process.env.TABLE_NAME = 'test-table';
process.env.WEBSOCKET_API_ENDPOINT = 'https://ws.test.invalid/dev';

const { handler: toggleCategory } = require(path.join(REPO, 'lambda-functions/game/toggle-category.js'));
const { handler: grantHandover } = require(path.join(REPO, 'lambda-functions/game/grant-handover.js'));
const { handler: removePlayer } = require(path.join(REPO, 'lambda-functions/game/remove-player.js'));

/* ---- Harness -------------------------------------------------------------- */

let pass = 0; let fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  ok   - ${label}`); pass += 1; } catch (e) {
    console.log(`  FAIL - ${label}\n         ${e.message}`); fail += 1;
  }
}

const ORG_A = 'org_9xK4Fq7Pz2mNbVc8dQwLxR';   // owns the room
const ORG_B = 'org_Tb2VnQ8sLxK4WmC7gRdYpF';   // the rival, holding only the code

const GAME = '4242';
const PK = `GAME#${GAME}`;

const at = (sk) => store.get(key(PK, sk));

/** An authenticated host in `orgId`. Matches the Lambda authorizer context. */
const host = (orgId) => ({
  requestContext: {
    http: { method: 'POST' },
    authorizer: { lambda: { userId: 'u', groups: 'hosts', orgId } },
  },
});

/** A caller the authorizer never saw — no context at all. */
const nobody = () => ({ requestContext: { http: { method: 'POST' } } });

const WRITES = new Set(['put', 'update', 'delete', 'transactWrite', 'batchWrite']);
const writesSince = (mark) => table.log.slice(mark).filter((e) => WRITES.has(e.type));

/**
 * One live session, mid-round, owned by `orgId` (or by nobody). Ada holds a
 * name somebody else has asked to take over; Grace has already been taken out
 * of the counts. Everything the three routes read, so that "the owning org is
 * unaffected" is a real 200 and not an accident of a thin fixture.
 */
function seed({ orgId = ORG_A, state = 'ASK#001', metadata = true } = {}) {
  table.clear();
  sent.length = 0;

  if (metadata) {
    table.put({
      PK, SK: 'METADATA', Title: 'Their session', GameType: 'call-and-answer',
      Started: true, Visibility: 'public',
      ...(orgId ? { orgId } : {}),
    });
  }
  table.put({ PK, SK: 'STATE', State: state, LessonNumber: 1 });
  table.put({
    PK, SK: 'STATE#CATS',
    'HostMask1-8': '11000000', 'HostMask9-16': '00000000', 'HostMask17-24': '00000000',
  });
  table.put({
    PK, SK: 'STATE#CATS#COUNTS',
    '1-8': [4, 4, 0, 0, 0, 0, 0, 0], '9-16': new Array(8).fill(0), '17-24': new Array(8).fill(0),
    TotalEnabled: 8, TotalRemaining: 8, Version: 1,
  });
  table.put({
    PK, SK: 'PLAYER#Ada', PlayerName: 'Ada', ClientId: 'ada-phone',
    HandoverRequestedBy: 'ada-laptop',
  });
  table.put({
    PK, SK: 'PLAYER#Grace', PlayerName: 'Grace', ClientId: 'grace-phone',
    RemovedAt: '2026-09-23T10:00:00.000Z',
  });
  table.put({ PK, SK: 'CONNECTION#host-1', ConnectionId: 'host-1', ConnectionType: 'HOST' });
}

const toggle = (caller, body = { categoryId: '2', categoryName: 'Packaging', enabled: false }) =>
  toggleCategory({ ...caller, pathParameters: { gameId: GAME }, body: JSON.stringify(body) });
const grant = (caller, playerName, body = {}) =>
  grantHandover({ ...caller, pathParameters: { gameId: GAME, playerName }, body: JSON.stringify(body) });
const remove = (caller, playerName, body = {}) =>
  removePlayer({ ...caller, pathParameters: { gameId: GAME, playerName }, body: JSON.stringify(body) });

/** The four-digit space must not be turned into an existence oracle. */
const saysItExists = (res) =>
  /forbidden|not your|permission|organisation|organization/i.test(String(res && res.body));

/* ---- Cases ---------------------------------------------------------------- */

(async () => {
  console.log('1. POST /toggle-category is scoped (it changes what a live room is asked)');

  seed();
  let mark = table.log.length;
  const foreignToggle = await toggle(host(ORG_B));

  // rejects: THE HOLE.
  await check('a rival organisation is refused', () =>
    assert.strictEqual(foreignToggle.statusCode, 404,
      `got ${foreignToggle.statusCode}: ${foreignToggle.body}`));

  await check('...as "not found", never as "not yours"', () =>
    assert.ok(!saysItExists(foreignToggle),
      `the body leaks that the session exists: ${foreignToggle.body}`));

  await check('nothing is written', () =>
    assert.deepStrictEqual(writesSince(mark).map((w) => w.type), [],
      'the refused call still wrote to somebody else\'s session'));

  await check('the category masks are untouched', () =>
    assert.strictEqual(at('STATE#CATS')['HostMask1-8'], '11000000',
      'the refused call still changed which categories the room is asked'));

  await check('the counts row is untouched', () =>
    assert.strictEqual(at('STATE#CATS#COUNTS').Version, 1,
      'the refused call still bumped the counts version'));

  seed();
  const ownToggle = await toggle(host(ORG_A));
  // rejects: closing the hole by breaking the feature.
  await check('its own host still toggles the category', () =>
    assert.strictEqual(ownToggle.statusCode, 200, `got ${ownToggle.statusCode}: ${ownToggle.body}`));

  await check('and the mask bit clears', () =>
    assert.strictEqual(at('STATE#CATS')['HostMask1-8'], '10000000'));

  console.log('\n2. POST /players/{name}/handover is scoped (it unlocks a name for takeover)');

  seed();
  mark = table.log.length;
  const foreignOpen = await grant(host(ORG_B), 'Ada');

  // rejects: THE HOLE — the first half of stealing somebody's answers and score.
  await check('an open grant from a rival organisation is refused', () =>
    assert.strictEqual(foreignOpen.statusCode, 404,
      `got ${foreignOpen.statusCode}: ${foreignOpen.body}`));

  await check('...as "not found", never as "not yours"', () =>
    assert.ok(!saysItExists(foreignOpen),
      `the body leaks that the session exists: ${foreignOpen.body}`));

  await check('no handover window is opened', () =>
    assert.strictEqual(at('PLAYER#Ada').HandoverExpiresAt, undefined,
      'the refused call still unlocked the name'));

  await check('nothing is written', () =>
    assert.deepStrictEqual(writesSince(mark).map((w) => w.type), []));

  seed();
  mark = table.log.length;
  const foreignBound = await grant(host(ORG_B), 'Ada', { bindToRequester: true });
  await check('a bound grant from a rival organisation is refused', () =>
    assert.strictEqual(foreignBound.statusCode, 404,
      `got ${foreignBound.statusCode}: ${foreignBound.body}`));

  await check('no grant is bound to the requester', () => {
    assert.strictEqual(at('PLAYER#Ada').HandoverForClientId, undefined,
      'the refused call still handed the name to whoever asked');
    assert.strictEqual(at('PLAYER#Ada').HandoverExpiresAt, undefined);
  });

  await check('nothing is written', () =>
    assert.deepStrictEqual(writesSince(mark).map((w) => w.type), []));

  seed();
  const ownOpen = await grant(host(ORG_A), 'Ada');
  // rejects: closing the hole by breaking the feature.
  await check('its own host still unlocks the name', () =>
    assert.strictEqual(ownOpen.statusCode, 200, `got ${ownOpen.statusCode}: ${ownOpen.body}`));

  await check('and the window opens', () =>
    assert.ok(at('PLAYER#Ada').HandoverExpiresAt, 'the grant never landed'));

  seed();
  const ownBound = await grant(host(ORG_A), 'Ada', { bindToRequester: true });
  await check('its own host still binds the grant to whoever asked', () => {
    assert.strictEqual(ownBound.statusCode, 200, `got ${ownBound.statusCode}: ${ownBound.body}`);
    assert.strictEqual(at('PLAYER#Ada').HandoverForClientId, 'ada-laptop');
  });

  console.log('\n3. POST /players/{name}/remove is scoped (it changes who the room counts)');

  seed();
  mark = table.log.length;
  const foreignRemove = await remove(host(ORG_B), 'Ada');

  // rejects: THE HOLE.
  await check('a rival organisation is refused', () =>
    assert.strictEqual(foreignRemove.statusCode, 404,
      `got ${foreignRemove.statusCode}: ${foreignRemove.body}`));

  await check('...as "not found", never as "not yours"', () =>
    assert.ok(!saysItExists(foreignRemove),
      `the body leaks that the session exists: ${foreignRemove.body}`));

  await check('the player is NOT taken out of the counts', () =>
    assert.strictEqual(at('PLAYER#Ada').RemovedAt, undefined,
      'the refused call still removed somebody from somebody else\'s room'));

  await check('nothing is written', () =>
    assert.deepStrictEqual(writesSince(mark).map((w) => w.type), []));

  await check('the host is told nothing', () =>
    assert.strictEqual(sent.length, 0, `pushed ${sent.length} frame(s) on a refused call`));

  seed();
  mark = table.log.length;
  const foreignRestore = await remove(host(ORG_B), 'Grace', { removed: false });
  // rejects: the undo is the same door.
  await check('a rival cannot put a removed player back either', () => {
    assert.strictEqual(foreignRestore.statusCode, 404,
      `got ${foreignRestore.statusCode}: ${foreignRestore.body}`);
    assert.strictEqual(at('PLAYER#Grace').RemovedAt, '2026-09-23T10:00:00.000Z',
      'the refused call still restored somebody to somebody else\'s room');
    assert.deepStrictEqual(writesSince(mark).map((w) => w.type), []);
    assert.strictEqual(sent.length, 0);
  });

  seed();
  const ownRemove = await remove(host(ORG_A), 'Ada');
  // rejects: closing the hole by breaking the feature.
  await check('its own host still removes the player', () =>
    assert.strictEqual(ownRemove.statusCode, 200, `got ${ownRemove.statusCode}: ${ownRemove.body}`));

  await check('and they leave the counts', () =>
    assert.ok(at('PLAYER#Ada').RemovedAt, 'the removal never landed'));

  await check('and the host\'s other device is told', () =>
    assert.deepStrictEqual(sent.map((m) => m.type), ['playerRemoved']));

  console.log('\n4. the refusal is not an oracle');

  /*
    The guard has to answer BEFORE the handler reads anything else, or the
    handler's own early returns tell a rival what they were refused from.
    toggle-category answers 400 "only allowed during active games" for an
    ENDED room, and both player routes answer 404 naming the player when the
    name is not in the room. Refused first, a rival sees one answer for all of
    it.
  */
  seed({ state: 'ENDED' });
  const foreignEnded = await toggle(host(ORG_B));
  // rejects: a guard placed after the state check, which leaks the room's state.
  await check('toggle-category: a rival learns nothing about the room\'s state', () => {
    assert.strictEqual(foreignEnded.statusCode, 404,
      `got ${foreignEnded.statusCode}: ${foreignEnded.body}`);
    assert.strictEqual(foreignEnded.body, foreignToggle.body,
      'an ended room and a live one answered a rival differently');
  });

  seed();
  const foreignGrantNobody = await grant(host(ORG_B), 'Nobody');
  // rejects: a guard placed after the player lookup, which echoes the roster.
  await check('handover: a name in the room and a name not in it answer alike', () =>
    assert.strictEqual(foreignGrantNobody.body, foreignOpen.body,
      `${foreignGrantNobody.body} vs ${foreignOpen.body}`));

  seed();
  const foreignRemoveNobody = await remove(host(ORG_B), 'Nobody');
  await check('remove: a name in the room and a name not in it answer alike', () =>
    assert.strictEqual(foreignRemoveNobody.body, foreignRemove.body,
      `${foreignRemoveNobody.body} vs ${foreignRemove.body}`));

  await check('no refusal names anybody in the room', () => {
    for (const res of [foreignOpen, foreignBound, foreignRemove, foreignRestore,
      foreignGrantNobody, foreignRemoveNobody]) {
      assert.ok(!/Ada|Grace|Nobody/.test(res.body), `a refusal named somebody: ${res.body}`);
    }
  });

  console.log('\n5. the guard\'s other two clauses');

  /*
    NO IDENTITY IS REFUSED, as save-report.js and mint-host-ticket.js do.
    `callerMayDriveSession` passes a caller with no groups — the participant
    journey is never gated — so on its own it would let anyone drive an
    orgless room the day one of these routes lost its authorizer. None of the
    three is ever a participant's act.
  */
  for (const [label, run] of [
    ['toggle-category', (c) => toggle(c)],
    ['handover', (c) => grant(c, 'Ada')],
    ['remove', (c) => remove(c, 'Ada')],
  ]) {
    seed({ orgId: '' });
    mark = table.log.length;
    const res = await run(nobody());
    // rejects: leaning on the authorizer alone for the "is this anybody" half.
    await check(`${label}: a caller with no identity is refused, even on an orgless room`, () => {
      assert.strictEqual(res.statusCode, 404, `got ${res.statusCode}: ${res.body}`);
      assert.deepStrictEqual(writesSince(mark).map((w) => w.type), []);
      assert.strictEqual(sent.length, 0);
    });

    seed({ metadata: false });
    mark = table.log.length;
    const orphan = await run(host(ORG_A));
    // rejects: acting on a room whose owner cannot be read.
    await check(`${label}: a session with no METADATA row is refused`, () => {
      assert.strictEqual(orphan.statusCode, 404, `got ${orphan.statusCode}: ${orphan.body}`);
      assert.deepStrictEqual(writesSince(mark).map((w) => w.type), []);
      assert.strictEqual(sent.length, 0);
    });
  }

  console.log('\n6. what this deliberately does NOT refuse');

  /*
    A session with no orgId predates tenancy or was created by an orgless host.
    Refusing those would break running rooms to close a hole they are not part
    of — see tenant.callerMayDriveSession, which makes this choice once for
    every route rather than each route making it again.
  */
  // rejects: breaking every pre-tenancy room to close a new hole.
  seed({ orgId: '' });
  const orphanToggle = await toggle(host(ORG_B));
  await check('toggle-category on an orgless session is left alone', () =>
    assert.strictEqual(orphanToggle.statusCode, 200,
      `got ${orphanToggle.statusCode}: ${orphanToggle.body}`));

  seed({ orgId: '' });
  const orphanGrant = await grant(host(ORG_B), 'Ada');
  await check('handover on an orgless session is left alone', () =>
    assert.strictEqual(orphanGrant.statusCode, 200,
      `got ${orphanGrant.statusCode}: ${orphanGrant.body}`));

  seed({ orgId: '' });
  const orphanRemove = await remove(host(ORG_B), 'Ada');
  await check('remove on an orgless session is left alone', () =>
    assert.strictEqual(orphanRemove.statusCode, 200,
      `got ${orphanRemove.statusCode}: ${orphanRemove.body}`));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
