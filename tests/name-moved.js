#!/usr/bin/env node
/**
 * MOVING A NAME TO A NEW DEVICE, SERVER SIDE (experience plan §4.4; steps 1c,
 * 1d and 1f; owner's timing, 1 Nov 2026: "Ask again after 1 minute, the
 * request lapses after 10, a grant stays open 5").
 *
 *   §1 the ask lapses after ten minutes: the roster stops reporting it and a
 *      bound grant for it is refused (REQUEST_LAPSED); a newer ask than the
 *      one the host looked at is refused (REQUEST_CHANGED)
 *   §2 the grant window is five minutes, and the ask's reply carries the
 *      phone's timings
 *   §3 the OLD device is refused: its answer (websocket) and its vote (HTTP)
 *      come back with NAME_MOVED, nothing is stored, the host hears nothing
 *   §4 what must keep working: the new device, the same device reconnecting,
 *      pages that send no client id, rows with no client id, event seats
 *   §5 the old device is told: pushed at the moment of the move (1f), told
 *      again on NAME_CHECK after a reconnect, and its own rejoin says so
 *   §6 the roster's `deviceConnected`, and no client id leaks anywhere
 *
 * Tests named `// rejects:` say which wrong implementation each one catches.
 */
const suiteFinished = require('./helpers/finish-guard');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');
const { createTable, installStubs } = require('./helpers/player-table');

const table = createTable();
const store = table.store;
const key = table.keyOf;
const sent = [];
const frames = [];
installStubs({ table, sent, frames });
process.env.TABLE_NAME = 'test-table';
process.env.WEBSOCKET_API_ENDPOINT = 'https://ws.test.invalid/dev';

const joinGame = require(path.join(REPO, 'lambda-functions/game/join-game.js'));
const requestHandover = require(path.join(REPO, 'lambda-functions/game/request-handover.js'));
const grantHandover = require(path.join(REPO, 'lambda-functions/game/grant-handover.js'));
const getPlayers = require(path.join(REPO, 'lambda-functions/game/get-players.js'));
const submitVote = require(path.join(REPO, 'lambda-functions/game/submit-vote.js'));
const wsMessage = require(path.join(REPO, 'lambda-functions/websocket/message.js')).handler;
const {
  HANDOVER_WINDOW_SECONDS, HANDOVER_REQUEST_SECONDS, ASK_AGAIN_AFTER_SECONDS, publicHandoverState,
} = require(path.join(REPO, 'lambda-functions/game/handover.js'));
const { heldByAnotherDevice, NAME_MOVED } = require(path.join(REPO, 'lambda-functions/game/name-holder.js'));

let pass = 0; let fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  PASS  ${label}`); pass += 1; }
  catch (e) { console.log(`  FAIL  ${label}\n        ${e.message}`); fail += 1; }
}

const GAME = '4821';
const PK = `GAME#${GAME}`;
const HOST_SOCKET = 'host-1';
const HOST = { authorizer: { lambda: { userId: 'host-1', groups: 'hosts' } } };

function reset(state = 'ASK#001') {
  table.clear();
  sent.length = 0;
  frames.length = 0;
  store.set(key(PK, 'METADATA'), { PK, SK: 'METADATA', Started: true, Visibility: 'public', AccessCode: null, GameType: 'call-and-answer' });
  store.set(key(PK, 'STATE'), { PK, SK: 'STATE', State: state, LessonNumber: 1, CurrentQuestionId: '001' });
  store.set(key(PK, `CONNECTION#${HOST_SOCKET}`), { PK, SK: `CONNECTION#${HOST_SOCKET}`, ConnectionId: HOST_SOCKET, ConnectionType: 'HOST' });
}
const socket = (connectionId, playerName, extra = {}) => store.set(key(PK, `CONNECTION#${connectionId}`), {
  PK, SK: `CONNECTION#${connectionId}`, ConnectionId: connectionId, ConnectionType: 'PLAYER',
  GameId: GAME, PlayerName: playerName, ConnectedAt: new Date().toISOString(), ...extra,
});
const bodyOf = (res) => JSON.parse(res.body);
const row = (sk) => store.get(key(PK, sk));
const player = (name) => row(`PLAYER#${name}`);

const join = (body) => joinGame.handler({ pathParameters: { gameId: GAME }, body: JSON.stringify(body) });
const ask = (playerName, body) => requestHandover.handler({ pathParameters: { gameId: GAME, playerName }, body: JSON.stringify(body || {}) });
const grant = (playerName, body) => grantHandover.handler({
  requestContext: HOST, pathParameters: { gameId: GAME, playerName }, body: JSON.stringify(body || {}),
});
const answer = (connectionId, playerName, text, extra = {}) => wsMessage({
  requestContext: { connectionId, domainName: 'ws.test.invalid', stage: 'dev' },
  body: JSON.stringify({ messageType: 'ANSWER#001', gameId: GAME, playerName, answer: text, answerType: 'text', ...extra }),
});
const nameCheck = (connectionId, playerName, clientId) => wsMessage({
  requestContext: { connectionId, domainName: 'ws.test.invalid', stage: 'dev' },
  body: JSON.stringify({ messageType: 'NAME_CHECK', gameId: GAME, playerName, clientId }),
});
const vote = (playerName, extra = {}) => submitVote.handler({
  pathParameters: { gameId: GAME },
  body: JSON.stringify({ playerName, questionNumber: '001', votes: { 0: 1 }, ...extra }),
});
const to = (connectionId) => frames.filter((f) => f.connectionId === connectionId).map((f) => f.message);
const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString();

/** Sam on the old phone, asked for from the new one, granted, and claimed. */
async function moveSam() {
  await join({ playerName: 'Sam', clientId: 'old-phone' });
  await ask('Sam', { clientId: 'new-phone' });
  const g = await grant('Sam', { bindToRequester: true });
  assert.strictEqual(g.statusCode, 200, `grant: ${g.body}`);
  const claim = await join({ playerName: 'Sam', clientId: 'new-phone', claimExisting: true });
  assert.strictEqual(claim.statusCode, 200, `claim: ${claim.body}`);
}

(async () => {
  console.log('\n§1 the ask lapses after ten minutes');

  await check('the timings are the owner\'s: ask again 1 min, lapse 10 min, grant open 5 min', () => {
    assert.strictEqual(ASK_AGAIN_AFTER_SECONDS, 60);
    assert.strictEqual(HANDOVER_REQUEST_SECONDS, 600);
    assert.strictEqual(HANDOVER_WINDOW_SECONDS, 300);
  });

  // rejects: a grant that binds to an ask the phone has long stopped waiting on.
  await check('a bound grant for an ask older than ten minutes is refused, REQUEST_LAPSED', async () => {
    reset();
    await join({ playerName: 'Sam', clientId: 'old-phone' });
    await ask('Sam', { clientId: 'new-phone' });
    player('Sam').HandoverRequestedAt = iso(HANDOVER_REQUEST_SECONDS * 1000 + 1000);
    const res = await grant('Sam', { bindToRequester: true });
    assert.strictEqual(res.statusCode, 409);
    assert.strictEqual(bodyOf(res).code, 'REQUEST_LAPSED');
    assert.ok(/ask again/i.test(bodyOf(res).message), 'the host is not told what happens next');
    assert.strictEqual(player('Sam').HandoverExpiresAt, undefined, 'the refused grant was written anyway');
    const claim = await join({ playerName: 'Sam', clientId: 'new-phone', claimExisting: true });
    assert.strictEqual(claim.statusCode, 409);
    assert.strictEqual(player('Sam').ClientId, 'old-phone');
  });

  // rejects: an off-by-a-minute lapse (or one measured from the grant).
  await check('an ask nine minutes old is still grantable', async () => {
    reset();
    await join({ playerName: 'Sam', clientId: 'old-phone' });
    await ask('Sam', { clientId: 'new-phone' });
    player('Sam').HandoverRequestedAt = iso(9 * 60 * 1000);
    const res = await grant('Sam', { bindToRequester: true });
    assert.strictEqual(res.statusCode, 200, res.body);
  });

  await check('asking again restarts the clock, and the new ask is grantable at once', async () => {
    reset();
    await join({ playerName: 'Sam', clientId: 'old-phone' });
    await ask('Sam', { clientId: 'new-phone' });
    player('Sam').HandoverRequestedAt = iso(HANDOVER_REQUEST_SECONDS * 1000 + 1000);
    await ask('Sam', { clientId: 'new-phone' });
    assert.strictEqual((await grant('Sam', { bindToRequester: true })).statusCode, 200);
  });

  // rejects: the host's item outliving the phone's wait (they read one stamp).
  await check('the roster stops reporting a lapsed ask, and says when a live one lapses', async () => {
    reset();
    await join({ playerName: 'Sam', clientId: 'old-phone' });
    await ask('Sam', { clientId: 'new-phone' });
    const live = publicHandoverState(player('Sam'));
    assert.strictEqual(live.requested, true);
    assert.strictEqual(live.requestLapsed, false);
    const expected = Date.parse(player('Sam').HandoverRequestedAt) + HANDOVER_REQUEST_SECONDS * 1000;
    assert.strictEqual(Date.parse(live.requestExpiresAt), expected);

    player('Sam').HandoverRequestedAt = iso(HANDOVER_REQUEST_SECONDS * 1000 + 1000);
    const list = bodyOf(await getPlayers.handler({ pathParameters: { gameId: GAME } }));
    const sam = list.players.find((p) => p.playerName === 'Sam');
    assert.strictEqual(sam.handover.requested, false, 'a lapsed ask still raises the host\'s item');
    assert.strictEqual(sam.handover.requestLapsed, true);
    assert.strictEqual(sam.handover.requestExpiresAt, null);
  });

  // rejects: granting a newer ask on the strength of the one the host saw.
  await check('a grant naming an older ask than the row holds is refused, REQUEST_CHANGED', async () => {
    reset();
    await join({ playerName: 'Sam', clientId: 'old-phone' });
    await ask('Sam', { clientId: 'new-phone' });
    const seen = player('Sam').HandoverRequestedAt;
    player('Sam').HandoverRequestedAt = iso(-5);  // somebody asked again
    const stale = await grant('Sam', { bindToRequester: true, requestedAt: seen });
    assert.strictEqual(stale.statusCode, 409);
    assert.strictEqual(bodyOf(stale).code, 'REQUEST_CHANGED');
    const current = await grant('Sam', { bindToRequester: true, requestedAt: player('Sam').HandoverRequestedAt });
    assert.strictEqual(current.statusCode, 200, current.body);
  });

  await check('an open unlock (nobody asked through the app) is not affected by the lapse', async () => {
    reset();
    await join({ playerName: 'Sam', clientId: 'old-phone' });
    assert.strictEqual((await grant('Sam', {})).statusCode, 200);
  });

  console.log('\n§2 the grant window, and the timings the phone is given');

  // rejects: a grant that stands longer than five minutes.
  await check('a grant opened 4:59 ago is spendable; 5:01 ago it is not', async () => {
    reset();
    await join({ playerName: 'Sam', clientId: 'old-phone' });
    await ask('Sam', { clientId: 'new-phone' });
    await grant('Sam', { bindToRequester: true });
    const now = Math.floor(Date.now() / 1000);
    player('Sam').HandoverExpiresAt = now - 1;  // granted 5:01 ago
    assert.strictEqual((await join({ playerName: 'Sam', clientId: 'new-phone', claimExisting: true })).statusCode, 409);
    player('Sam').HandoverExpiresAt = now + 1;  // granted 4:59 ago
    assert.strictEqual((await join({ playerName: 'Sam', clientId: 'new-phone', claimExisting: true })).statusCode, 200);
  });

  // rejects: a phone that has to hard-code (and so drift from) the server's timings.
  await check('the ask\'s reply carries askAgainAfterSeconds and lapseSeconds; the host frame carries the lapse', async () => {
    reset();
    await join({ playerName: 'Sam', clientId: 'old-phone' });
    const res = bodyOf(await ask('Sam', { clientId: 'new-phone' }));
    assert.strictEqual(res.askAgainAfterSeconds, 60);
    assert.strictEqual(res.lapseSeconds, 600);
    assert.ok(!/take over the name/i.test(res.message), 'the reply still names a button that is gone');
    const frame = to(HOST_SOCKET).find((m) => m.type === 'handoverRequested');
    assert.ok(frame && frame.requestExpiresAt, 'the host frame does not say when the ask lapses');
  });

  await check('a name not in the room gets the same reply shape (no oracle)', async () => {
    reset();
    const res = bodyOf(await ask('Nobody', { clientId: 'new-phone' }));
    assert.strictEqual(res.askAgainAfterSeconds, 60);
    assert.strictEqual(player('Nobody'), undefined);
  });

  console.log('\n§3 the old device is refused');

  // rejects: the old phone answering on as "Sam" and racing the new one.
  await check('an answer from the old device is refused with NAME_MOVED, and nothing is stored', async () => {
    reset();
    await moveSam();
    socket('old-sock', 'Sam');
    frames.length = 0;
    await answer('old-sock', 'Sam', 'from the old phone', { clientId: 'old-phone' });
    assert.strictEqual(row('QUESTION#001#ANSWER#Sam'), undefined, 'the old phone\'s answer was stored');
    const back = to('old-sock');
    const receipt = back.find((m) => m.type === 'answerReceived');
    assert.ok(receipt, 'the old phone was not told its answer was not taken');
    assert.strictEqual(receipt.kept, false);
    assert.strictEqual(receipt.code, NAME_MOVED);
    const moved = back.find((m) => m.type === 'nameMoved');
    assert.ok(moved, 'no nameMoved frame');
    assert.strictEqual(moved.code, NAME_MOVED);
    assert.strictEqual(moved.playerName, 'Sam');
    assert.ok(/Sam is now on another device/.test(moved.message));
    assert.deepStrictEqual(to(HOST_SOCKET), [], 'the host was told about an answer that was refused');
  });

  // rejects: a refusal that only covers on-time answers (the late path is a second door).
  await check('a LATE answer from the old device is refused too, not kept', async () => {
    reset('VOTE#001');
    await moveSam();
    socket('old-sock', 'Sam');
    await answer('old-sock', 'Sam', 'late, old phone', { clientId: 'old-phone' });
    assert.strictEqual(row('QUESTION#001#LATE#Sam'), undefined);
    assert.ok(to('old-sock').some((m) => m.type === 'nameMoved'));
  });

  // rejects: a vote path that still checks no device.
  await check('a vote from the old device is refused 409 NAME_MOVED, and no ballot is stored', async () => {
    reset('VOTE#001');
    store.set(key(PK, 'QUESTION#001#ANSWER#Ada'), { PK, SK: 'QUESTION#001#ANSWER#Ada', Answer: 'x' });
    await moveSam();
    const res = await vote('Sam', { clientId: 'old-phone' });
    assert.strictEqual(res.statusCode, 409);
    const body = bodyOf(res);
    assert.strictEqual(body.code, NAME_MOVED);
    assert.ok(/Sam is now on another device/.test(body.message));
    assert.ok(!res.body.includes('new-phone') && !res.body.includes('old-phone'), 'a client id is in the refusal');
    assert.strictEqual(row('QUESTION#001#VOTE#Sam'), undefined);
  });

  await check('the vote refusal reaches the old device even after voting has closed', async () => {
    reset('RESULTS#001');
    await moveSam();
    const res = await vote('Sam', { clientId: 'old-phone' });
    assert.strictEqual(bodyOf(res).code, NAME_MOVED);
  });

  console.log('\n§4 what must keep working');

  // rejects: a check that refuses the device the name moved TO.
  await check('the new device answers and votes', async () => {
    reset();
    await moveSam();
    socket('new-sock', 'Sam');
    await answer('new-sock', 'Sam', 'from the new phone', { clientId: 'new-phone' });
    assert.ok(row('QUESTION#001#ANSWER#Sam'), 'the new phone\'s answer was not stored');
    assert.ok(to('new-sock').some((m) => m.type === 'answerReceived' && m.kept === true));
    assert.ok(!to('new-sock').some((m) => m.type === 'nameMoved'));
    store.get(key(PK, 'STATE')).State = 'VOTE#001';
    assert.strictEqual((await vote('Sam', { clientId: 'new-phone' })).statusCode, 200);
  });

  // rejects: normal rejoin on the same device broken by the new check.
  await check('the same device reconnecting is accepted, and keeps answering and voting', async () => {
    reset();
    assert.strictEqual((await join({ playerName: 'Ada', clientId: 'ada-phone' })).statusCode, 200);
    const again = await join({ playerName: 'Ada', clientId: 'ada-phone' });
    assert.strictEqual(again.statusCode, 200);
    assert.strictEqual(bodyOf(again).isReconnection, true);
    socket('ada-sock-2', 'Ada');
    await answer('ada-sock-2', 'Ada', 'still me', { clientId: 'ada-phone' });
    assert.ok(row('QUESTION#001#ANSWER#Ada'));
    store.get(key(PK, 'STATE')).State = 'VOTE#001';
    assert.strictEqual((await vote('Ada', { clientId: 'ada-phone' })).statusCode, 200);
    await nameCheck('ada-sock-2', 'Ada', 'ada-phone');
    assert.ok(!to('ada-sock-2').some((m) => m.type === 'nameMoved'), 'a holder was told it had moved');
    assert.ok(row('CONNECTION#ada-sock-2'), 'a holder\'s socket row was dropped');
  });

  // rejects: stopping every phone in the room on the day this deploys.
  await check('a page that sends no client id answers and votes as before', async () => {
    reset();
    await moveSam();
    socket('legacy-sock', 'Sam');
    await answer('legacy-sock', 'Sam', 'old bundle');
    assert.ok(row('QUESTION#001#ANSWER#Sam'));
    store.get(key(PK, 'STATE')).State = 'VOTE#001';
    store.set(key(PK, 'QUESTION#001#ANSWER#Ada'), { PK, SK: 'QUESTION#001#ANSWER#Ada', Answer: 'x' });
    assert.strictEqual((await vote('Sam')).statusCode, 200);
  });

  await check('a row from before identities (no ClientId) takes any device', async () => {
    reset();
    store.set(key(PK, 'PLAYER#Old'), { PK, SK: 'PLAYER#Old', PlayerName: 'Old', playerName: 'Old' });
    socket('old-row-sock', 'Old');
    await answer('old-row-sock', 'Old', 'hi', { clientId: 'whoever' });
    assert.ok(row('QUESTION#001#ANSWER#Old'));
  });

  // rejects: an attendee's laptop and phone (one token, two browsers) stopping each other.
  await check('an event seat answers from either of the attendee\'s browsers', async () => {
    reset();
    store.set(key(PK, 'PLAYER#Priya'), {
      PK, SK: 'PLAYER#Priya', PlayerName: 'Priya', playerName: 'Priya', AttendeeId: 'att-1', ClientId: 'priya-phone',
    });
    socket('priya-laptop-sock', 'Priya');
    await answer('priya-laptop-sock', 'Priya', 'from the laptop', { clientId: 'priya-laptop' });
    assert.ok(row('QUESTION#001#ANSWER#Priya'), 'an event seat was refused for a second browser');
    assert.ok(!to('priya-laptop-sock').some((m) => m.type === 'nameMoved'));
  });

  await check('the rule itself, shape by shape', () => {
    assert.strictEqual(heldByAnotherDevice({ ClientId: 'a' }, 'b'), true);
    assert.strictEqual(heldByAnotherDevice({ ClientId: 'a' }, 'a'), false);
    assert.strictEqual(heldByAnotherDevice({ ClientId: 'a' }, ' a '), false);
    assert.strictEqual(heldByAnotherDevice({ ClientId: 'a' }, null), false);
    assert.strictEqual(heldByAnotherDevice({ ClientId: 'a' }, ''), false);
    assert.strictEqual(heldByAnotherDevice({}, 'b'), false);
    assert.strictEqual(heldByAnotherDevice(undefined, 'b'), false);
    assert.strictEqual(heldByAnotherDevice({ ClientId: 'a', AttendeeId: 'x' }, 'b'), false);
  });

  // rejects: the client id riding on into the host's playerAnswered frame.
  await check('the answer frame\'s client id never reaches the host', async () => {
    reset();
    await join({ playerName: 'Ada', clientId: 'ada-secret-id' });
    socket('ada-sock', 'Ada');
    await answer('ada-sock', 'Ada', 'hello', { clientId: 'ada-secret-id' });
    const hostFrames = JSON.stringify(to(HOST_SOCKET));
    assert.ok(hostFrames.includes('playerAnswered'), 'the host was not told at all');
    assert.ok(!hostFrames.includes('ada-secret-id'), 'the client id reached the host socket');
  });

  console.log('\n§5 the old device is told');

  // rejects: a push that misses the old phone, or reaches anyone else (1f).
  await check('the move pushes nameMoved to the old device\'s socket and to no other', async () => {
    reset();
    await join({ playerName: 'Sam', clientId: 'old-phone' });
    await join({ playerName: 'Ada', clientId: 'ada-phone' });
    socket('old-sock', 'Sam');
    socket('ada-sock', 'Ada');
    socket('wall', null, { Viewer: 'present', ViewerId: 'viewer-123456' });
    await ask('Sam', { clientId: 'new-phone' });
    await grant('Sam', { bindToRequester: true });
    frames.length = 0;
    const claim = await join({ playerName: 'Sam', clientId: 'new-phone', claimExisting: true });
    assert.strictEqual(claim.statusCode, 200);
    const moved = frames.filter((f) => f.message.type === 'nameMoved');
    assert.deepStrictEqual(moved.map((f) => f.connectionId), ['old-sock']);
    assert.strictEqual(moved[0].message.playerName, 'Sam');
    assert.ok(!JSON.stringify(moved).includes('phone'), 'a client id rode in the push');
    assert.strictEqual(row('CONNECTION#old-sock'), undefined, 'the old socket still gets the room\'s broadcasts');
    assert.ok(row('CONNECTION#ada-sock'), 'another player\'s socket was dropped');
    assert.ok(row('CONNECTION#wall'), 'the room\'s window was dropped');
    assert.ok(row(`CONNECTION#${HOST_SOCKET}`), 'the host socket was dropped');
  });

  await check('a plain reconnect pushes nothing (only a move does)', async () => {
    reset();
    await join({ playerName: 'Sam', clientId: 'old-phone' });
    socket('old-sock', 'Sam');
    frames.length = 0;
    await join({ playerName: 'Sam', clientId: 'old-phone' });
    assert.ok(!frames.some((f) => f.message.type === 'nameMoved'));
    assert.ok(row('CONNECTION#old-sock'));
  });

  // rejects: an old phone that slept through the push and plays on after waking.
  await check('NAME_CHECK after a reconnect tells the old device and drops its socket row', async () => {
    reset();
    await moveSam();
    socket('old-sock-2', 'Sam');
    frames.length = 0;
    await nameCheck('old-sock-2', 'Sam', 'old-phone');
    assert.ok(to('old-sock-2').some((m) => m.type === 'nameMoved' && m.code === NAME_MOVED));
    assert.strictEqual(row('CONNECTION#old-sock-2'), undefined);
    assert.deepStrictEqual(to(HOST_SOCKET), [], 'the host heard a NAME_CHECK');
  });

  // rejects: the old device being offered "ask the host" for the name it just handed on.
  await check('the old device rejoining is told nameMoved; a stranger gets the plain refusal', async () => {
    reset();
    await moveSam();
    const back = await join({ playerName: 'Sam', clientId: 'old-phone' });
    assert.strictEqual(back.statusCode, 409);
    assert.strictEqual(bodyOf(back).code, 'NAME_TAKEN');
    assert.strictEqual(bodyOf(back).nameMoved, true);
    assert.strictEqual(bodyOf(back).reason, NAME_MOVED);
    assert.ok(/Sam is now on another device/.test(bodyOf(back).message));
    const stranger = bodyOf(await join({ playerName: 'Sam', clientId: 'someone-else' }));
    assert.strictEqual(stranger.nameMoved, undefined, 'a stranger learned the name had moved');
    assert.ok(/move your name here/.test(stranger.message), 'the refusal does not say a name can move');
  });

  await check('moving the name back clears the old device\'s "moved" for it', async () => {
    reset();
    await moveSam();
    await ask('Sam', { clientId: 'old-phone' });
    await grant('Sam', { bindToRequester: true });
    assert.strictEqual((await join({ playerName: 'Sam', clientId: 'old-phone', claimExisting: true })).statusCode, 200);
    assert.strictEqual(player('Sam').ClientId, 'old-phone');
    socket('old-sock', 'Sam');
    await answer('old-sock', 'Sam', 'back again', { clientId: 'old-phone' });
    assert.ok(row('QUESTION#001#ANSWER#Sam'));
  });

  console.log('\n§6 the roster');

  // rejects: a Let them that cannot tell whether the first device is still here.
  await check('deviceConnected is true while a page is open under the name, false otherwise', async () => {
    reset();
    await join({ playerName: 'Sam', clientId: 'old-phone' });
    await join({ playerName: 'Ada', clientId: 'ada-phone' });
    socket('sam-sock', 'Sam');
    socket('wall', null, { Viewer: 'present', ViewerId: 'viewer-123456' });
    const res = await getPlayers.handler({ pathParameters: { gameId: GAME } });
    const list = bodyOf(res).players;
    assert.strictEqual(list.find((p) => p.playerName === 'Sam').deviceConnected, true);
    assert.strictEqual(list.find((p) => p.playerName === 'Ada').deviceConnected, false);
    assert.ok(!res.body.includes('sam-sock'), 'a connection id reached the public roster');
    assert.ok(!res.body.includes('old-phone'), 'a client id reached the public roster');
  });

  await check('after a move the roster carries neither device\'s client id', async () => {
    reset();
    await moveSam();
    const res = await getPlayers.handler({ pathParameters: { gameId: GAME } });
    assert.ok(!res.body.includes('old-phone') && !res.body.includes('new-phone'));
    assert.strictEqual(player('Sam').MovedFromClientId, 'old-phone');
  });

  await check('the two copies of name-holder.js are identical', () => {
    const a = fs.readFileSync(path.join(REPO, 'lambda-functions/game/name-holder.js'), 'utf8');
    const b = fs.readFileSync(path.join(REPO, 'lambda-functions/websocket/name-holder.js'), 'utf8');
    assert.strictEqual(a, b, 'game/ and websocket/ disagree about who holds a name');
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail ? 1 : 0);
})();
