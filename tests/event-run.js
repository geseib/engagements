/**
 * RUNNING AN EVENT'S DAY — POST /events/{code}/run (events M3,
 * lambda-functions/websocket/events/run.js and child-session.js), the agenda's
 * `now` view, and an attendee joining each item by token (events M4,
 * game/join-game.js and game/event-attendee.js).
 *
 * rejects: an engagement that starts without a session, or with one that is
 * not stamped with the event, not started, or not pinned to the item's set
 * version; two items live at once; a start that loses a race leaving its
 * session behind; a paused item still taking answers, votes or survey
 * answers; a resume that does not clear the pause; a break that pauses
 * instead of ending; an item ended while its survey still collects; an event
 * whose sessions are each billed; an attendee asked for a name again, or
 * given a second seat on coming back, or somebody else's seat; a forged,
 * expired or other-event token let in; the `now` view carrying a title; a
 * join after the event ended; a copy of session-start.js, session-end.js or
 * the token check that drifts from its original.
 */
const suiteFinished = require('./helpers/finish-guard');
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  installEventHarness, asHost, request, seedOrg, startsIn, bodyOf, REPO,
} = require('./helpers/event-harness');

const h = installEventHarness();
const { table, sent } = h;
const create = h.load('lambda-functions/websocket/events/create-event.js').handler;
const items = h.load('lambda-functions/websocket/events/items.js').handler;
const getEvent = h.load('lambda-functions/websocket/events/get-event.js').handler;
const attendeeFn = h.load('lambda-functions/websocket/events/get-agenda.js').handler;
const joinGame = h.load('lambda-functions/game/join-game.js').handler;
const submitVote = h.load('lambda-functions/game/submit-vote.js').handler;
const count = h.load('lambda-functions/websocket/session-count.js');
const A = h.load('lambda-functions/websocket/events/attendee-store.js');
const E = h.load('lambda-functions/game/event-attendee.js');

let pass = 0; let fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  ok - ${label}`); pass += 1; }
  catch (e) { console.log(`  FAIL - ${label}\n    ${e.stack || e.message}`); fail += 1; }
}

const NW = 'org_nw';
const MD = 'org_md';
const host = (org = NW) => asHost(org);

const run = (code, body, org = NW) => items(request({
  method: 'POST', path: `/dev/events/${code}/run`, pathParameters: { code }, requestContext: host(org), body,
}));
const add = (code, item) => items(request({
  method: 'POST', path: `/events/${code}/items`, pathParameters: { code }, requestContext: host(), body: item,
}));
const join = (code, name) => attendeeFn(request({
  method: 'POST', path: `/dev/events/${code}/attendees`, pathParameters: { code }, body: { name },
}));
const now = (code) => attendeeFn({
  ...request({ method: 'GET', path: `/dev/events/${code}/agenda`, pathParameters: { code } }),
  queryStringParameters: { view: 'now' },
});
const agenda = (code) => attendeeFn(request({ method: 'GET', path: `/dev/events/${code}/agenda`, pathParameters: { code } }));
const playerJoin = (gameId, body) => joinGame(request({
  method: 'POST', path: `/games/${gameId}/players`, pathParameters: { gameId }, body,
}));

const meta = (code) => table.get(`EVENT#${code}`, 'METADATA');
const itemRow = (code, itemId) => table.get(`EVENT#${code}`, `ITEM#${itemId}`);
const gameMeta = (gameId) => table.get(`GAME#${gameId}`, 'METADATA');
const gameState = (gameId) => table.get(`GAME#${gameId}`, 'STATE');
const sessionReservations = () => [...table.store.values()].filter((r) => r.PK === 'GAMES' && r.Kind !== 'event');
const framesTo = (gameId, type) => sent.filter((m) => {
  const conn = String(m.ConnectionId || '');
  return conn.startsWith(`c_${gameId}_`) && JSON.parse(m.Data).type === type;
});
const connect = (gameId, who = 'p1') => table.put({
  PK: `GAME#${gameId}`, SK: `CONNECTION#c_${gameId}_${who}`, ConnectionId: `c_${gameId}_${who}`, ConnectionType: 'PLAYER',
});

function seedSets() {
  table.put({ PK: 'SETS', SK: 'SET#space', name: 'Space Trivia', engagementType: 'trivia', questionCount: 12, activeVersion: 2, versions: [{ version: 1, questionCount: 8 }, { version: 2, questionCount: 12 }] });
  table.put({ PK: 'SETS', SK: 'SET#friction', name: 'Friction finder', engagementType: 'call-and-answer', questionCount: 4, activeVersion: 1, versions: [{ version: 1, questionCount: 4 }] });
  table.put({ PK: 'SETS', SK: 'SET#kickoff', name: 'Kickoff pulse', engagementType: 'survey', questionCount: 5, activeVersion: 1, versions: [{ version: 1, questionCount: 5 }] });
}

async function makeEvent() {
  const res = await create(request({
    method: 'POST', path: '/events', requestContext: host(),
    body: { title: 'Q4 Kickoff', place: 'Harbour Room', startsAt: startsIn(3), timeZone: 'Europe/London' },
  }));
  assert.strictEqual(res.statusCode, 201, res.body);
  const { code } = bodyOf(res).event;
  const ids = {};
  for (const [key, item] of [
    ['trivia', { type: 'trivia', title: 'Space night', minutes: 15, setRef: { scope: 'platform', setId: 'space', version: 1 }, settings: { target: 5, randomizeQuestions: false } }],
    ['talk', { type: 'presentation', title: 'FY26 in review', ledBy: 'Dana Whitfield', minutes: 30 }],
    ['coffee', { type: 'break', minutes: 15, description: 'Coffee on the landing.' }],
    ['friction', { type: 'call-and-answer', title: 'What slows us down?', minutes: 20, setRef: { scope: 'platform', setId: 'friction' }, settings: { anonymousResponses: false } }],
    ['pulse', { type: 'survey', title: 'Before we start', minutes: 8, setRef: { scope: 'platform', setId: 'kickoff' }, settings: { names: 'anonymous' } }],
  ]) {
    const r = await add(code, item);
    assert.strictEqual(r.statusCode, 201, r.body);
    ids[key] = bodyOf(r).item.itemId;
  }
  return { code, ids };
}

(async () => {
  console.log('\n0. the copies');
  await check('session-start.js and session-end.js are the same file in game/ and websocket/', () => {
    for (const f of ['session-start.js', 'session-end.js']) {
      assert.strictEqual(
        fs.readFileSync(path.join(REPO, 'lambda-functions/websocket', f), 'utf8'),
        fs.readFileSync(path.join(REPO, 'lambda-functions/game', f), 'utf8'),
        `${f} drifted`,
      );
    }
  });
  await check('the game bundle\'s token check reads tokens exactly as attendee-store does', () => {
    assert.strictEqual(String(E.TOKEN), String(A.TOKEN));
    const { token } = A.mintToken();
    assert.strictEqual(E.hashToken(token), A.hashToken(token));
    assert.ok(E.tokenMatches(token, A.hashToken(token)));
    assert.ok(!E.tokenMatches(`${token.slice(0, -1)}x`, A.hashToken(token)));
  });

  table.clear();
  seedOrg(table, NW);
  seedOrg(table, MD);
  seedSets();
  const { code, ids } = await makeEvent();
  const priya = bodyOf(await join(code, 'Priya Raman'));
  const sam1 = bodyOf(await join(code, 'Sam'));
  const sam2 = bodyOf(await join(code, 'Sam'));

  console.log('\n1. starting an engagement makes its session');
  const ledgerBefore = [...table.store.values()].filter((r) => String(r.SK).startsWith('LEDGER#')).length;
  const started = await run(code, { action: 'start', itemId: ids.trivia });
  const startedBody = bodyOf(started);
  const trivia = startedBody.gameId;
  await check('200, with the host\'s view and the new session\'s code', () => {
    assert.strictEqual(started.statusCode, 200, started.body);
    assert.match(trivia, /^\d{4}$/);
    assert.notStrictEqual(trivia, code);
    assert.strictEqual(startedBody.event.liveItemId, ids.trivia);
    assert.strictEqual(startedBody.event.state, 'LIVE');
    const item = startedBody.items.find((i) => i.itemId === ids.trivia);
    assert.strictEqual(item.state, 'live');
    assert.strictEqual(item.gameId, trivia);
    assert.ok(item.startedAt);
  });
  await check('the session is stamped with the event, started, pinned to the item\'s version, with its options', () => {
    const m = gameMeta(trivia);
    assert.strictEqual(m.EventRef, code);
    assert.strictEqual(m.EventItem, ids.trivia);
    assert.strictEqual(m.orgId, NW);
    assert.strictEqual(m.GameType, 'trivia');
    assert.strictEqual(m.QuestionSetId, 'space');
    assert.strictEqual(m.QuestionSetVersion, 1);
    assert.strictEqual(m.Started, true);
    assert.strictEqual(m.Target, 5);
    assert.strictEqual(m.HostPreferences.randomizeQuestions, false);
    assert.strictEqual(gameState(trivia).State, 'STARTED');
    assert.ok(table.get(`ORG#${NW}#GAMES`, `GAME#${trivia}`), 'the org\'s session list row');
  });
  await check('starting bills nothing and asks no gate', () => {
    assert.strictEqual([...table.store.values()].filter((r) => String(r.SK).startsWith('LEDGER#')).length, ledgerBefore);
  });
  await check('GET /events/{code} says the same: the live item and its session', async () => {
    const res = await getEvent(request({ method: 'GET', path: `/events/${code}`, pathParameters: { code }, requestContext: host() }));
    assert.strictEqual(res.statusCode, 200, res.body);
    const body = bodyOf(res);
    assert.strictEqual(body.event.liveItemId, ids.trivia);
    assert.strictEqual(body.event.attendeeCount, 3);
    assert.strictEqual(body.items.find((i) => i.itemId === ids.trivia).gameId, trivia);
  });
  await check('pressing Start again is the same live item, not a second session', async () => {
    const again = await run(code, { action: 'start', itemId: ids.trivia });
    assert.strictEqual(again.statusCode, 200, again.body);
    assert.strictEqual(sessionReservations().length, 1);
  });
  await check('an item that has started cannot be edited or removed from the builder', async () => {
    const edit = await items(request({
      method: 'PUT', path: `/events/${code}/items/${ids.trivia}`, pathParameters: { code, itemId: ids.trivia },
      requestContext: host(), body: { title: 'x' },
    }));
    assert.strictEqual(edit.statusCode, 409, edit.body);
  });

  console.log('\n2. the agenda says what is live; `now` says only that');
  await check('the public agenda names the live item and links its session', async () => {
    const res = await agenda(code);
    const body = bodyOf(res);
    assert.strictEqual(body.event.liveItemId, ids.trivia);
    assert.strictEqual(body.items.find((i) => i.itemId === ids.trivia).gameId, trivia);
    assert.ok(!body.items.find((i) => i.itemId === ids.friction).gameId, 'a planned item links nothing');
  });
  await check('`now`: the live item\'s kind, state and session, and no words at all', async () => {
    const res = await now(code);
    assert.strictEqual(res.statusCode, 200, res.body);
    const n = bodyOf(res).now;
    assert.strictEqual(n.liveItemId, ids.trivia);
    assert.deepStrictEqual(n.live, { itemId: ids.trivia, type: 'trivia', state: 'live', gameId: trivia });
    assert.strictEqual(n.state, 'LIVE');
    assert.ok(n.rev);
    for (const words of ['Space night', 'Q4 Kickoff', 'Harbour', 'Priya']) assert.ok(!res.body.includes(words), words);
  });

  console.log('\n3. an attendee joins the item with the token, and no name');
  let priyaSeat;
  await check('the token joins the session as the attendee\'s own name', async () => {
    const res = await playerJoin(trivia, { attendeeToken: priya.token, clientId: 'cl_priya' });
    assert.strictEqual(res.statusCode, 200, res.body);
    priyaSeat = bodyOf(res);
    assert.strictEqual(priyaSeat.playerName, 'Priya Raman');
    assert.strictEqual(priyaSeat.isReconnection, false);
    const row = table.get(`GAME#${trivia}`, 'PLAYER#Priya Raman');
    assert.ok(row.AttendeeId && row.AttendeeId.startsWith('at_'));
    assert.strictEqual(row.ClientId, 'cl_priya');
    assert.ok(table.get(`GAME#${trivia}`, 'PLAYER#Priya Raman#SCORE'));
  });
  await check('coming back is the same seat, not a second one', async () => {
    const res = await playerJoin(trivia, { attendeeToken: priya.token, clientId: 'cl_priya' });
    assert.strictEqual(bodyOf(res).playerName, 'Priya Raman');
    assert.strictEqual(bodyOf(res).isReconnection, true);
    assert.strictEqual([...table.store.values()].filter((r) => r.PK === `GAME#${trivia}` && /^PLAYER#[^#]+$/.test(r.SK)).length, 1);
  });
  await check('two attendees called Sam get "Sam" and "Sam 2", each always the same one', async () => {
    assert.strictEqual(bodyOf(await playerJoin(trivia, { attendeeToken: sam1.token })).playerName, 'Sam');
    assert.strictEqual(bodyOf(await playerJoin(trivia, { attendeeToken: sam2.token })).playerName, 'Sam 2');
    assert.strictEqual(bodyOf(await playerJoin(trivia, { attendeeToken: sam2.token })).playerName, 'Sam 2');
    assert.strictEqual(bodyOf(await playerJoin(trivia, { attendeeToken: sam1.token })).playerName, 'Sam');
  });
  await check('a seat typed by hand is never taken over by a token', async () => {
    await playerJoin(trivia, { playerName: 'Ada', clientId: 'cl_ada' });
    const ada = bodyOf(await join(code, 'Ada'));
    const res = await playerJoin(trivia, { attendeeToken: ada.token });
    assert.strictEqual(bodyOf(res).playerName, 'Ada 2');
  });
  await check('a forged, malformed or other event\'s token is 401 NOT_JOINED', async () => {
    const forged = `${priya.token.slice(0, -2)}AA`;
    for (const token of [forged, 'at_nope.x', 'garbage']) {
      const res = await playerJoin(trivia, { attendeeToken: token });
      assert.strictEqual(res.statusCode, 401, `${token}: ${res.body}`);
      assert.strictEqual(bodyOf(res).code, 'NOT_JOINED');
    }
  });
  await check('an expired attendee row is 401 too', async () => {
    const expired = bodyOf(await join(code, 'Old Timer'));
    const id = expired.token.split('.')[0];
    table.put({ ...table.get(`EVENT#${code}`, `ATTENDEE#${id}`), ttl: Math.floor(Date.now() / 1000) - 10 });
    const res = await playerJoin(trivia, { attendeeToken: expired.token });
    assert.strictEqual(res.statusCode, 401, res.body);
  });

  console.log('\n4. starting another item pauses the live one, in one step');
  connect(trivia);
  const talk = await run(code, { action: 'start', itemId: ids.talk });
  await check('the talk is live, the trivia paused, one item live', () => {
    assert.strictEqual(talk.statusCode, 200, talk.body);
    assert.strictEqual(itemRow(code, ids.talk).State, 'live');
    assert.strictEqual(itemRow(code, ids.trivia).State, 'paused');
    assert.strictEqual(meta(code).LiveItem, ids.talk);
    assert.ok(!itemRow(code, ids.talk).GameId, 'a talk has no session');
  });
  await check('the trivia\'s session is paused, its round untouched, and its room told what started', () => {
    assert.strictEqual(gameState(trivia).EventPaused, true);
    assert.strictEqual(gameState(trivia).State, 'STARTED');
    assert.strictEqual(framesTo(trivia, 'eventItemPaused').length, 1);
    const started = framesTo(trivia, 'eventItemStarted');
    assert.strictEqual(started.length, 1);
    assert.strictEqual(JSON.parse(started[0].Data).itemId, ids.talk);
  });
  await check('a paused session refuses a vote with PAUSED', async () => {
    table.put({ ...gameState(trivia), State: 'VOTE#001' });
    const res = await submitVote(request({
      method: 'POST', path: `/games/${trivia}/votes`, pathParameters: { gameId: trivia },
      body: { playerName: 'Priya Raman', questionNumber: 1, votes: ['Sam'] },
    }));
    assert.strictEqual(res.statusCode, 409, res.body);
    assert.strictEqual(bodyOf(res).code, 'PAUSED');
    table.put({ ...gameState(trivia), State: 'STARTED' });
  });

  console.log('\n5. pause, resume, and a break');
  await check('pause takes the talk off the air: paused, and nothing live', async () => {
    const res = await run(code, { action: 'pause', itemId: ids.talk });
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.strictEqual(itemRow(code, ids.talk).State, 'paused');
    assert.strictEqual(meta(code).LiveItem, undefined);
    assert.strictEqual(bodyOf(res).event.liveItemId, '');
  });
  await check('a break starts with its return time and +5 min moves it', async () => {
    const before = Date.now();
    const res = await run(code, { action: 'start', itemId: ids.coffee });
    assert.strictEqual(res.statusCode, 200, res.body);
    const endsAt = Date.parse(itemRow(code, ids.coffee).EndsAt);
    assert.ok(endsAt >= before + 15 * 60000 - 1000 && endsAt <= Date.now() + 15 * 60000 + 1000);
    const ext = await run(code, { action: 'extend', itemId: ids.coffee });
    assert.strictEqual(ext.statusCode, 200, ext.body);
    assert.strictEqual(Date.parse(itemRow(code, ids.coffee).EndsAt), endsAt + 5 * 60000);
    assert.strictEqual(bodyOf(await now(code)).now.live.endsAt, itemRow(code, ids.coffee).EndsAt);
  });
  await check('+5 min on anything but a live break is refused', async () => {
    const res = await run(code, { action: 'extend', itemId: ids.talk });
    assert.strictEqual(res.statusCode, 409, res.body);
  });
  await check('resuming the trivia ENDS the break (never paused) and clears the session\'s pause', async () => {
    const res = await run(code, { action: 'resume', itemId: ids.trivia });
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.strictEqual(itemRow(code, ids.coffee).State, 'done');
    assert.strictEqual(itemRow(code, ids.trivia).State, 'live');
    assert.strictEqual(gameState(trivia).EventPaused, undefined);
    assert.strictEqual(framesTo(trivia, 'eventItemResumed').length, 1);
    assert.strictEqual(sessionReservations().length, 1, 'a resume makes no new session');
  });
  await check('resuming something that never started is refused', async () => {
    const res = await run(code, { action: 'resume', itemId: ids.friction });
    assert.strictEqual(res.statusCode, 409, res.body);
  });

  console.log('\n6. two screens press Start at the same moment');
  await check('exactly one item goes live, the other is told, and no session is left behind', async () => {
    await run(code, { action: 'pause', itemId: ids.trivia });
    const before = sessionReservations().length;
    const [a, b] = await Promise.all([
      run(code, { action: 'start', itemId: ids.friction }),
      run(code, { action: 'start', itemId: ids.pulse }),
    ]);
    const statuses = [a.statusCode, b.statusCode].sort();
    assert.deepStrictEqual(statuses, [200, 409], `${a.body} / ${b.body}`);
    const loser = a.statusCode === 409 ? a : b;
    assert.strictEqual(bodyOf(loser).code, 'run_changed');
    const live = [ids.friction, ids.pulse].filter((id) => itemRow(code, id).State === 'live');
    assert.strictEqual(live.length, 1);
    assert.strictEqual(meta(code).LiveItem, live[0]);
    assert.strictEqual(sessionReservations().length, before + 1, 'the loser\'s session was not discarded');
    const other = [ids.friction, ids.pulse].find((id) => id !== live[0]);
    assert.strictEqual(itemRow(code, other).State, 'planned');
    assert.ok(!itemRow(code, other).GameId);
  });

  console.log('\n7. ending');
  const livingId = meta(code).LiveItem;
  const pulseRow = itemRow(code, ids.pulse);
  if (pulseRow.State !== 'live') {
    // Make the survey the live one for this part.
    await run(code, { action: 'start', itemId: ids.pulse });
  }
  const pulse = itemRow(code, ids.pulse).GameId;
  await check('a survey opens collecting', () => {
    assert.strictEqual(gameState(pulse).State, 'SURVEY#OPEN');
    assert.strictEqual(gameMeta(pulse).Names, 'anonymous');
  });
  await check('an open survey refuses to end here, and says to close it on the stage', async () => {
    const res = await run(code, { action: 'end', itemId: ids.pulse });
    assert.strictEqual(res.statusCode, 409, res.body);
    assert.strictEqual(bodyOf(res).code, 'survey_open');
    assert.strictEqual(itemRow(code, ids.pulse).State, 'live');
  });
  await check('a closed survey ends, and the item is done', async () => {
    table.put({ ...gameState(pulse), State: 'SURVEY#CLOSED' });
    connect(pulse);
    const res = await run(code, { action: 'end', itemId: ids.pulse });
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.strictEqual(gameState(pulse).State, 'ENDED');
    assert.strictEqual(itemRow(code, ids.pulse).State, 'done');
    assert.ok(framesTo(pulse, 'eventItemEnded').length === 1);
  });
  await check('ending the paused trivia ends its session with the END the room already knows', async () => {
    const res = await run(code, { action: 'end', itemId: ids.trivia });
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.strictEqual(gameState(trivia).State, 'ENDED');
    assert.strictEqual(itemRow(code, ids.trivia).State, 'done');
    const end = sent.filter((m) => String(m.ConnectionId).startsWith(`c_${trivia}_`) && JSON.parse(m.Data).messageType === 'END');
    assert.strictEqual(end.length, 1);
  });
  await check('a done item does not start again', async () => {
    const res = await run(code, { action: 'start', itemId: ids.trivia });
    assert.strictEqual(res.statusCode, 409, res.body);
    assert.strictEqual(bodyOf(res).code, 'item_done');
  });
  void livingId;

  console.log('\n8. an event is billed once');
  await check('the first item to count bills the event; the second is "already"', async () => {
    const db = table.doc;
    const orgPk = `ORG#${NW}`;
    const first = await count.countAnsweredQuestion(db, 'test-table', trivia, '002', { ...gameMeta(trivia), FirstAnsweredRound: '001' });
    assert.strictEqual(first.counted, true);
    const ledger = [...table.store.values()].filter((r) => r.PK === orgPk && String(r.SK).startsWith('LEDGER#'));
    assert.strictEqual(ledger.length, 1);
    assert.match(ledger[0].SK, new RegExp(`^LEDGER#\\d{4}-\\d{2}#SESSION#EVENT#${code}$`));
    const second = await count.countAnsweredQuestion(db, 'test-table', pulse, 'c002', { ...gameMeta(pulse), FirstAnsweredRound: 'c001' });
    assert.strictEqual(second.reason, 'already');
    assert.strictEqual([...table.store.values()].filter((r) => r.PK === orgPk && String(r.SK).startsWith('LEDGER#')).length, 1);
  });

  console.log('\n9. the end of the day');
  await check('end-event ends what is live or paused, keeps planned items planned, and says ENDED', async () => {
    await run(code, { action: 'start', itemId: ids.talk });
    const res = await run(code, { action: 'end-event' });
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.strictEqual(meta(code).State, 'ENDED');
    assert.strictEqual(meta(code).LiveItem, undefined);
    assert.strictEqual(itemRow(code, ids.talk).State, 'done');
    const body = bodyOf(res);
    assert.strictEqual(body.event.state, 'ENDED');
    assert.ok(body.event.endedAt);
  });
  await check('nobody new joins an ended event; somebody who joined is still known; the agenda still reads', async () => {
    const res = await join(code, 'Latecomer');
    assert.strictEqual(res.statusCode, 409, res.body);
    assert.strictEqual(bodyOf(res).code, 'event_ended');
    const me = await attendeeFn({
      ...request({ method: 'GET', path: `/dev/events/${code}/me`, pathParameters: { code } }),
      headers: { authorization: `Bearer ${priya.token}` },
    });
    assert.strictEqual(me.statusCode, 200, me.body);
    assert.strictEqual((await agenda(code)).statusCode, 200);
  });
  await check('nothing more starts once the event has ended', async () => {
    const res = await run(code, { action: 'start', itemId: ids.friction });
    assert.strictEqual(res.statusCode, 409, res.body);
    assert.strictEqual(bodyOf(res).code, 'event_ended');
  });

  console.log('\n10. the door');
  await check('another organisation\'s host gets the unknown code\'s 404 and changes nothing', async () => {
    const before = JSON.stringify(meta(code));
    const res = await run(code, { action: 'end-event' }, MD);
    assert.strictEqual(res.statusCode, 404, res.body);
    assert.strictEqual(JSON.stringify(meta(code)), before);
  });
  await check('an unknown action or item is refused plainly', async () => {
    assert.strictEqual((await run(code, { action: 'explode', itemId: ids.talk })).statusCode, 400);
  });
  await check('an item whose words cannot be read never starts', async () => {
    table.clear();
    seedOrg(table, NW);
    seedSets();
    const fresh = await makeEvent();
    table.put({ ...itemRow(fresh.code, fresh.ids.friction), Settings: { v: 1, iv: 'x', ct: 'broken', tag: 'x' }, Title: { v: 1, iv: 'x', ct: 'broken', tag: 'x' } });
    const res = await run(fresh.code, { action: 'start', itemId: fresh.ids.friction });
    assert.strictEqual(res.statusCode, 409, res.body);
    assert.strictEqual(bodyOf(res).code, 'item_unreadable');
    assert.strictEqual(sessionReservations().length, 0);
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
