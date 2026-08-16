/**
 * Two people called Chris walk into a session.
 *
 * join-game.js keys players by `PLAYER#{playerName}` and, on finding the key
 * already there, used to return `isReconnection: true` and hand the arriving
 * browser the existing player row. The second Chris inherited the first
 * Chris's answers, votes and score; the first Chris's own reconnect then
 * fought over the same row. Neither of them was told anything — the response
 * said "Reconnected to existing player" in both cases, which is true of one of
 * them and a data-loss event for the other. In a room where two people share a
 * first name it is not an edge case, it is Tuesday.
 *
 * The join request carried no way to tell those apart: a name, and for private
 * sessions an access code. No session token (players are unauthenticated by
 * design), no connection id (the player socket opens only after the join
 * returns). So the client now mints a per-session random id, keeps it in
 * localStorage and presents it on every join; the server stamps it on the row
 * once and requires it thereafter.
 *
 * What this file pins down:
 *   - a matching id reconnects, a mismatched or missing one is refused;
 *   - the refusal is a distinct machine-readable code, not a 500 and not a
 *     silent success;
 *   - a refusal writes nothing and notifies nobody — the first Chris keeps
 *     their row;
 *   - a row that predates ids is NOT guessed about: it is refused with a
 *     different code so the client can ask the person, and only an explicit
 *     claim adopts it;
 *   - a player already mid-session when this shipped (no id on either side)
 *     still reconnects, because breaking them would be the same bug wearing a
 *     hat;
 *   - two simultaneous joins under one name cannot both win the row;
 *   - the refusal is not a roster probe: a private session still demands the
 *     access code before it will say anything about a name.
 */
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');

/* ---- Stubs, installed before the handler loads ---------------------------- */

/**
 * THE FAKE PARSES THE CONDITIONS NOW, rather than string-matching them.
 *
 * This file used to carry its own switch, which rejected any ConditionExpression
 * it had not been written for — fine with one condition in the product, and a
 * wall the moment `join-game.js` grew the handover branch's three-clause one.
 * `helpers/player-table.js` evaluates the expression against the stored item,
 * so a condition that would fail in DynamoDB fails here, and one that would
 * pass passes. See that file's header for why a memorising stub cannot test a
 * race at all.
 */
const { createTable, installStubs } = require('./helpers/player-table');

const table = createTable();
const store = table.store;
const key = table.keyOf;

/** Every WebSocket message the handler tried to send, in order. */
const sent = [];

installStubs({ table, sent });

process.env.TABLE_NAME = 'test-table';

const joinGame = require(path.join(REPO, 'lambda-functions/game/join-game.js'));
const { handler, classifyRejoin } = joinGame;

/* ---- Harness -------------------------------------------------------------- */

let pass = 0, fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  PASS  ${label}`); pass++; }
  catch (e) { console.log(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

const GAME = '4821';

function reset({ visibility = 'public', accessCode = null } = {}) {
  table.clear();
  sent.length = 0;
  store.set(key(`GAME#${GAME}`, 'METADATA'), {
    PK: `GAME#${GAME}`, SK: 'METADATA', Started: true,
    Visibility: visibility, AccessCode: accessCode,
  });
  // A host socket, so a notification would be observable if one were sent.
  store.set(key(`GAME#${GAME}`, 'CONNECTION#host-1'), {
    PK: `GAME#${GAME}`, SK: 'CONNECTION#host-1',
    ConnectionId: 'host-1', ConnectionType: 'HOST',
  });
}

const join = (body) => handler({
  pathParameters: { gameId: GAME },
  body: JSON.stringify(body),
});

const bodyOf = (res) => JSON.parse(res.body);
const playerRow = (name) => store.get(key(`GAME#${GAME}`, `PLAYER#${name}`));

/* ---- Cases ---------------------------------------------------------------- */

(async () => {
  console.log('\njoin name collision');

  /* --- the decision itself, without a database in the way ------------------ */

  await check('a matching client id is a reconnection', () => {
    assert.strictEqual(
      classifyRejoin({ storedClientId: 'a', clientId: 'a', claimExisting: false }),
      'reconnect'
    );
  });

  await check('a different client id on an owned row is a collision', () => {
    assert.strictEqual(
      classifyRejoin({ storedClientId: 'a', clientId: 'b', claimExisting: false }),
      'collision'
    );
  });

  // The important half of that: claiming loudly must not open an owned row.
  await check('claiming does not override an owned row', () => {
    assert.strictEqual(
      classifyRejoin({ storedClientId: 'a', clientId: 'b', claimExisting: true }),
      'collision'
    );
    assert.strictEqual(
      classifyRejoin({ storedClientId: 'a', clientId: null, claimExisting: true }),
      'collision'
    );
  });

  await check('an unowned row met by an identified client is unverified, not a guess', () => {
    assert.strictEqual(
      classifyRejoin({ storedClientId: null, clientId: 'b', claimExisting: false }),
      'unverified'
    );
  });

  await check('an unowned row is adopted only when the person says so', () => {
    assert.strictEqual(
      classifyRejoin({ storedClientId: null, clientId: 'b', claimExisting: true }),
      'adopt'
    );
  });

  await check('no ids on either side keeps the old behaviour', () => {
    assert.strictEqual(
      classifyRejoin({ storedClientId: null, clientId: null, claimExisting: false }),
      'legacy'
    );
  });

  /* --- and now through the handler ----------------------------------------- */

  await check('a first join stores the client id on the player row', async () => {
    reset();
    const res = await join({ playerName: 'Chris', clientId: 'chris-phone' });
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(bodyOf(res).isReconnection, false);
    assert.strictEqual(playerRow('Chris').ClientId, 'chris-phone');
  });

  await check('the same browser reconnects', async () => {
    reset();
    await join({ playerName: 'Chris', clientId: 'chris-phone' });
    sent.length = 0;
    const res = await join({ playerName: 'Chris', clientId: 'chris-phone' });
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(bodyOf(res).isReconnection, true);
    assert.strictEqual(sent.filter((m) => m.type === 'playerJoined').length, 1);
  });

  // The defect, stated as an assertion.
  await check('a second Chris is refused instead of inheriting the first Chris', async () => {
    reset();
    await join({ playerName: 'Chris', clientId: 'chris-phone' });
    const res = await join({ playerName: 'Chris', clientId: 'other-chris-phone' });

    assert.strictEqual(res.statusCode, 409, 'the second Chris was let in');
    const body = bodyOf(res);
    assert.strictEqual(body.code, 'NAME_TAKEN');
    assert.notStrictEqual(body.isReconnection, true, 'refusal still claimed a reconnection');
    assert.ok(/already answering as "Chris"/.test(body.message), 'no message a person can read');
  });

  await check('a refusal writes nothing and tells the host nothing', async () => {
    reset();
    await join({ playerName: 'Chris', clientId: 'chris-phone' });
    const before = { ...playerRow('Chris') };
    sent.length = 0;

    await join({ playerName: 'Chris', clientId: 'other-chris-phone' });

    assert.deepStrictEqual(playerRow('Chris'), before, 'the first Chris\'s row was touched');
    assert.deepStrictEqual(sent, [], 'the host was told a player joined when none did');
  });

  await check('an owned row is not opened by presenting no id at all', async () => {
    reset();
    await join({ playerName: 'Chris', clientId: 'chris-phone' });
    const res = await join({ playerName: 'Chris' });
    assert.strictEqual(res.statusCode, 409);
    assert.strictEqual(bodyOf(res).code, 'NAME_TAKEN');
  });

  await check('an empty-string id is treated as no id, not as a match', async () => {
    reset();
    await join({ playerName: 'Chris', clientId: '   ' });
    assert.strictEqual(playerRow('Chris').ClientId, undefined,
      'blank id was stored and would then match the next blank');
    // And a second blank-id arrival hits the legacy path rather than
    // "matching" the first — the pre-existing behaviour, not a new hole.
    const res = await join({ playerName: 'Chris', clientId: '' });
    assert.strictEqual(res.statusCode, 200);
  });

  await check('a row from before client ids is asked about, not guessed at', async () => {
    reset();
    await join({ playerName: 'Chris' });                       // old bundle
    const res = await join({ playerName: 'Chris', clientId: 'chris-phone' });
    assert.strictEqual(res.statusCode, 409);
    assert.strictEqual(bodyOf(res).code, 'NAME_UNVERIFIED');
    assert.ok(/If that was you/.test(bodyOf(res).message), 'the refusal does not ask anything');
    assert.strictEqual(playerRow('Chris').ClientId, undefined, 'refusal claimed the row anyway');
  });

  await check('answering "yes, that is me" adopts the row', async () => {
    reset();
    await join({ playerName: 'Chris' });
    const res = await join({ playerName: 'Chris', clientId: 'chris-phone', claimExisting: true });
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(bodyOf(res).isReconnection, true);
    assert.strictEqual(playerRow('Chris').ClientId, 'chris-phone');

    // ...and having been adopted, it is now closed to everyone else.
    const other = await join({ playerName: 'Chris', clientId: 'someone-else', claimExisting: true });
    assert.strictEqual(other.statusCode, 409);
  });

  await check('a player mid-session when this shipped still reconnects', async () => {
    reset();
    await join({ playerName: 'Chris' });
    const res = await join({ playerName: 'Chris' });
    assert.strictEqual(res.statusCode, 200, 'the old bundle was locked out of its own session');
    assert.strictEqual(bodyOf(res).isReconnection, true);
  });

  await check('two simultaneous first joins cannot both take the name', async () => {
    reset();
    /*
      TWO HANDLERS, GENUINELY INTERLEAVED — not one handler and a seeded row.
      The second Chris's join is held at the instant it is about to Put, by
      which point it has already read "no such player". The first Chris then
      runs to completion underneath it. Releasing the latch replays exactly the
      window that used to let the second Put overwrite the first: both callers
      read a miss, both write, last one wins.
    */
    const latch = table.hold((command) => command.type === 'put'
      && command.input.Item?.SK === 'PLAYER#Chris');

    const loser = join({ playerName: 'Chris', clientId: 'other-chris-phone' });
    await latch.reached;
    const winner = await join({ playerName: 'Chris', clientId: 'chris-phone' });
    latch.release();
    const res = await loser;

    assert.strictEqual(winner.statusCode, 200, 'the winner did not get in');
    assert.strictEqual(res.statusCode, 409, 'the loser of the race overwrote the winner');
    assert.strictEqual(bodyOf(res).code, 'NAME_TAKEN');
    assert.strictEqual(playerRow('Chris').ClientId, 'chris-phone', 'the winner was overwritten');
  });

  /* --- and it must not become a way to read the roster ---------------------- */

  await check('a private session demands the access code before it will discuss a name', async () => {
    reset({ visibility: 'private', accessCode: 'summit' });
    await join({ playerName: 'Chris', clientId: 'chris-phone', accessCode: 'summit' });

    const noCode = await join({ playerName: 'Chris', clientId: 'prober' });
    assert.strictEqual(noCode.statusCode, 401);
    assert.strictEqual(bodyOf(noCode).code, undefined, 'a name conflict leaked past the code gate');

    const wrongCode = await join({ playerName: 'Chris', clientId: 'prober', accessCode: 'nope' });
    assert.strictEqual(wrongCode.statusCode, 403);
    assert.strictEqual(bodyOf(wrongCode).code, undefined, 'a name conflict leaked past the code gate');
  });

  await check('a refusal names only the name that was submitted', async () => {
    reset();
    await join({ playerName: 'Chris', clientId: 'chris-phone' });
    await join({ playerName: 'Priya', clientId: 'priya-phone' });
    await join({ playerName: 'Sam', clientId: 'sam-phone' });

    const res = await join({ playerName: 'Chris', clientId: 'other-chris-phone' });
    assert.ok(!res.body.includes('Priya'), 'the refusal listed other players');
    assert.ok(!res.body.includes('Sam'), 'the refusal listed other players');
    assert.strictEqual(bodyOf(res).playerName, 'Chris');
  });

  await check('an unstarted session refuses before it looks at names', async () => {
    reset();
    store.get(key(`GAME#${GAME}`, 'METADATA')).Started = false;
    const res = await join({ playerName: 'Chris', clientId: 'prober' });
    assert.strictEqual(res.statusCode, 403);
    assert.strictEqual(bodyOf(res).code, undefined);
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
