/**
 * RUNNING AN EVENT'S DAY — POST /events/{code}/run (events M3,
 * lambda-functions/websocket/events/run.js and child-session.js), the agenda's
 * `now` view, and an attendee joining each item by token (events M4,
 * game/join-game.js and game/event-attendee.js).
 *
 * rejects: an engagement that starts without a session, or with one that is
 * not stamped with the event, not started, or not pinned to the item's set
 * version; two items live at once; a start that loses a race leaving its
 * session behind; going live on the next item PAUSING the one that was live
 * instead of finishing it (an open survey excepted: it pauses, since it
 * cannot end); a paused item still taking answers, votes or survey
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
  // rejects: an event that runs without its $2.00, or one billed per session
  // (the owner, 27 Sep 2026: "all events cost money").
  await check('the first go-live bills the EVENT once, as an event, and asks no gate', () => {
    const rows = [...table.store.values()].filter((r) => String(r.SK).startsWith('LEDGER#'));
    assert.strictEqual(rows.length, ledgerBefore + 1);
    const row = rows.find((r) => r.kind === 'EVENT');
    assert.ok(row, 'an EVENT ledger row');
    assert.match(row.SK, new RegExp(`^LEDGER#\\d{4}-\\d{2}#EVENT#${code}$`));
    assert.strictEqual(row.PK, `ORG#${NW}`);
    const usageRow = [...table.store.values()].find((r) => r.PK === `ORG#${NW}` && String(r.SK).startsWith('USAGE#'));
    assert.strictEqual(usageRow && usageRow.eventsRun, 1);
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

  console.log('\n4. going live on another item FINISHES the live one, in one step');
  // rejects (QA drive 29 Sep 2026, finding #2): moving on PAUSING the item
  // that was live, so a day run straight through ended "0 OF 5 DONE" with
  // every item Paused and every phone's agenda saying so.
  connect(trivia);
  const talk = await run(code, { action: 'start', itemId: ids.talk });
  await check('the talk is live, the trivia DONE (not paused), one item live', () => {
    assert.strictEqual(talk.statusCode, 200, talk.body);
    assert.strictEqual(itemRow(code, ids.talk).State, 'live');
    assert.strictEqual(itemRow(code, ids.trivia).State, 'done');
    assert.ok(itemRow(code, ids.trivia).EndedAt);
    assert.strictEqual(meta(code).LiveItem, ids.talk);
    assert.ok(!itemRow(code, ids.talk).GameId, 'a talk has no session');
    assert.strictEqual(bodyOf(talk).items.find((i) => i.itemId === ids.trivia).state, 'done');
  });
  await check('the trivia\'s session is ENDED with the END the room knows, and its room told what started', () => {
    assert.strictEqual(gameState(trivia).State, 'ENDED');
    assert.strictEqual(gameState(trivia).EventPaused, undefined);
    const end = sent.filter((m) => String(m.ConnectionId).startsWith(`c_${trivia}_`) && JSON.parse(m.Data).messageType === 'END');
    assert.strictEqual(end.length, 1);
    assert.strictEqual(framesTo(trivia, 'eventItemEnded').length, 1);
    assert.strictEqual(framesTo(trivia, 'eventItemPaused').length, 0);
    const startedFrames = framesTo(trivia, 'eventItemStarted');
    assert.strictEqual(startedFrames.length, 1);
    assert.strictEqual(JSON.parse(startedFrames[0].Data).itemId, ids.talk);
  });
  await check('each item that goes live carries when (liveAt), for the board\'s next step', () => {
    const body = bodyOf(talk);
    const t = body.items.find((i) => i.itemId === ids.talk);
    assert.ok(t.liveAt);
    assert.ok(Date.parse(t.liveAt) >= Date.parse(body.items.find((i) => i.itemId === ids.trivia).liveAt));
  });

  console.log('\n5. pause, resume, and a break');
  const moveOn = await run(code, { action: 'start', itemId: ids.friction });
  const friction = bodyOf(moveOn).gameId;
  await check('a live talk ends when the next item goes live', () => {
    assert.strictEqual(moveOn.statusCode, 200, moveOn.body);
    assert.strictEqual(itemRow(code, ids.talk).State, 'done');
    assert.strictEqual(itemRow(code, ids.friction).State, 'live');
  });
  await check('Pause is still a pause: the item is paused, nothing is live, its session holds', async () => {
    connect(friction);
    const res = await run(code, { action: 'pause', itemId: ids.friction });
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.strictEqual(itemRow(code, ids.friction).State, 'paused');
    assert.strictEqual(meta(code).LiveItem, undefined);
    assert.strictEqual(bodyOf(res).event.liveItemId, '');
    assert.strictEqual(gameState(friction).EventPaused, true);
    assert.strictEqual(gameState(friction).State, 'STARTED');
    assert.strictEqual(framesTo(friction, 'eventItemPaused').length, 1);
  });
  await check('a paused session refuses a vote with PAUSED', async () => {
    table.put({ ...gameState(friction), State: 'VOTE#001' });
    const res = await submitVote(request({
      method: 'POST', path: `/games/${friction}/votes`, pathParameters: { gameId: friction },
      body: { playerName: 'Priya Raman', questionNumber: 1, votes: ['Sam'] },
    }));
    assert.strictEqual(res.statusCode, 409, res.body);
    assert.strictEqual(bodyOf(res).code, 'PAUSED');
    table.put({ ...gameState(friction), State: 'STARTED' });
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
  await check('resuming the paused item ENDS the break (never paused) and clears the session\'s pause', async () => {
    const before = sessionReservations().length;
    const res = await run(code, { action: 'resume', itemId: ids.friction });
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.strictEqual(itemRow(code, ids.coffee).State, 'done');
    assert.strictEqual(itemRow(code, ids.friction).State, 'live');
    assert.strictEqual(gameState(friction).EventPaused, undefined);
    assert.strictEqual(gameState(friction).State, 'STARTED');
    assert.strictEqual(framesTo(friction, 'eventItemResumed').length, 1);
    assert.strictEqual(sessionReservations().length, before, 'a resume makes no new session');
    assert.ok(Date.parse(itemRow(code, ids.friction).LiveAt) >= Date.parse(itemRow(code, ids.coffee).LiveAt), 'a resume moves LiveAt');
  });
  await check('resuming something that never started is refused', async () => {
    const res = await run(code, { action: 'resume', itemId: ids.pulse });
    assert.strictEqual(res.statusCode, 409, res.body);
  });

  console.log('\n6. two screens press Go live at the same moment');
  ids.trivia2 = bodyOf(await add(code, { type: 'trivia', title: 'Space night II', minutes: 10, setRef: { scope: 'platform', setId: 'space', version: 1 } })).item.itemId;
  await check('exactly one item goes live, the live one is finished once, and no session is left behind', async () => {
    const before = sessionReservations().length;
    const [a, b] = await Promise.all([
      run(code, { action: 'start', itemId: ids.trivia2 }),
      run(code, { action: 'start', itemId: ids.pulse }),
    ]);
    const statuses = [a.statusCode, b.statusCode].sort();
    assert.deepStrictEqual(statuses, [200, 409], `${a.body} / ${b.body}`);
    const loser = a.statusCode === 409 ? a : b;
    assert.strictEqual(bodyOf(loser).code, 'run_changed');
    const live = [ids.trivia2, ids.pulse].filter((id) => itemRow(code, id).State === 'live');
    assert.strictEqual(live.length, 1);
    assert.strictEqual(meta(code).LiveItem, live[0]);
    assert.strictEqual(sessionReservations().length, before + 1, 'the loser\'s session was not discarded');
    const other = [ids.trivia2, ids.pulse].find((id) => id !== live[0]);
    assert.strictEqual(itemRow(code, other).State, 'planned');
    assert.ok(!itemRow(code, other).GameId);
    // The item that was live: done, its session ended by the winner alone.
    assert.strictEqual(itemRow(code, ids.friction).State, 'done');
    assert.strictEqual(gameState(friction).State, 'ENDED');
    const end = sent.filter((m) => String(m.ConnectionId).startsWith(`c_${friction}_`) && JSON.parse(m.Data).messageType === 'END');
    assert.strictEqual(end.length, 1, 'the losing start touched the live item\'s session');
  });

  console.log('\n7. a survey, open and closed, and ending');
  ids.talk2 = bodyOf(await add(code, { type: 'presentation', title: 'Where we go next', minutes: 10 })).item.itemId;
  ids.trivia3 = bodyOf(await add(code, { type: 'trivia', title: 'Space night III', minutes: 10, setRef: { scope: 'platform', setId: 'space', version: 1 } })).item.itemId;
  if (itemRow(code, ids.pulse).State !== 'live') {
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
  await check('moving on from an OPEN survey pauses it: it cannot end until it is closed', async () => {
    connect(pulse);
    const res = await run(code, { action: 'start', itemId: ids.talk2 });
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.strictEqual(itemRow(code, ids.pulse).State, 'paused');
    assert.strictEqual(itemRow(code, ids.talk2).State, 'live');
    assert.strictEqual(gameState(pulse).State, 'SURVEY#OPEN');
    assert.strictEqual(gameState(pulse).EventPaused, true);
    assert.strictEqual(framesTo(pulse, 'eventItemPaused').length, 1);
    assert.strictEqual(framesTo(pulse, 'eventItemEnded').length, 0);
    assert.strictEqual(framesTo(pulse, 'eventItemStarted').length, 1);
  });
  await check('resumed and closed on its stage, moving on from it ENDS it: done, and the phones say so', async () => {
    const back = await run(code, { action: 'resume', itemId: ids.pulse });
    assert.strictEqual(back.statusCode, 200, back.body);
    assert.strictEqual(itemRow(code, ids.talk2).State, 'done');
    assert.strictEqual(gameState(pulse).EventPaused, undefined);
    table.put({ ...gameState(pulse), State: 'SURVEY#CLOSED' });
    const res = await run(code, { action: 'start', itemId: ids.trivia3 });
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.strictEqual(itemRow(code, ids.pulse).State, 'done');
    assert.strictEqual(gameState(pulse).State, 'ENDED');
    assert.strictEqual(framesTo(pulse, 'eventItemEnded').length, 1);
    assert.strictEqual(framesTo(pulse, 'gameEnded').length, 1);
    const pub = bodyOf(await agenda(code));
    assert.strictEqual(pub.items.find((i) => i.itemId === ids.pulse).state, 'done');
  });
  const trivia3 = itemRow(code, ids.trivia3).GameId;
  await check('a closed survey ends from its row too, and the item is done', async () => {
    // The same endChild, through `end`: a second survey goes live (trivia3
    // finishes), closes, and is ended from its row.
    ids.pulse2 = bodyOf(await add(code, { type: 'survey', title: 'After lunch', minutes: 5, setRef: { scope: 'platform', setId: 'kickoff' } })).item.itemId;
    const started = await run(code, { action: 'start', itemId: ids.pulse2 });
    assert.strictEqual(started.statusCode, 200, started.body);
    const pulse2 = bodyOf(started).gameId;
    assert.strictEqual(itemRow(code, ids.trivia3).State, 'done');
    assert.strictEqual(gameState(trivia3).State, 'ENDED');
    table.put({ ...gameState(pulse2), State: 'SURVEY#CLOSED' });
    const res = await run(code, { action: 'end', itemId: ids.pulse2 });
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.strictEqual(gameState(pulse2).State, 'ENDED');
    assert.strictEqual(itemRow(code, ids.pulse2).State, 'done');
    assert.strictEqual(meta(code).LiveItem, undefined);
  });
  await check('End on a PAUSED item ends its session with the END the room already knows', async () => {
    ids.trivia4 = bodyOf(await add(code, { type: 'trivia', title: 'Space night IV', minutes: 5, setRef: { scope: 'platform', setId: 'space', version: 1 } })).item.itemId;
    const t4 = bodyOf(await run(code, { action: 'start', itemId: ids.trivia4 })).gameId;
    connect(t4);
    await run(code, { action: 'pause', itemId: ids.trivia4 });
    const res = await run(code, { action: 'end', itemId: ids.trivia4 });
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.strictEqual(gameState(t4).State, 'ENDED');
    assert.strictEqual(gameState(t4).EventPaused, undefined);
    assert.strictEqual(itemRow(code, ids.trivia4).State, 'done');
    const end = sent.filter((m) => String(m.ConnectionId).startsWith(`c_${t4}_`) && JSON.parse(m.Data).messageType === 'END');
    assert.strictEqual(end.length, 1);
  });
  await check('a done item does not start again', async () => {
    const res = await run(code, { action: 'start', itemId: ids.trivia });
    assert.strictEqual(res.statusCode, 409, res.body);
    assert.strictEqual(bodyOf(res).code, 'item_done');
  });

  console.log('\n8. an event is billed once, as an event');
  // rejects: an event's sessions charged on top of the event's $2.00.
  await check('its sessions add nothing to the one EVENT row going live wrote', async () => {
    const db = table.doc;
    const orgPk = `ORG#${NW}`;
    const ledgerOf = () => [...table.store.values()].filter((r) => r.PK === orgPk && String(r.SK).startsWith('LEDGER#'));
    const first = await count.countAnsweredQuestion(db, 'test-table', trivia, '002', { ...gameMeta(trivia), FirstAnsweredRound: '001' });
    assert.strictEqual(first.reason, 'covered-by-event');
    assert.strictEqual(first.counted, false);
    const second = await count.countAnsweredQuestion(db, 'test-table', pulse, 'c002', { ...gameMeta(pulse), FirstAnsweredRound: 'c001' });
    assert.ok(['covered-by-event', 'already'].includes(second.reason), second.reason);
    const ledger = ledgerOf();
    assert.strictEqual(ledger.length, 1);
    assert.match(ledger[0].SK, new RegExp(`^LEDGER#\\d{4}-\\d{2}#EVENT#${code}$`));
    assert.ok(gameMeta(trivia).CountedAt, 'the session is marked counted, so it stops asking');
  });

  console.log('\n9. the end of the day');
  await check('end-event ends what is live or paused, keeps planned items planned, and says ENDED', async () => {
    ids.talk3 = bodyOf(await add(code, { type: 'presentation', title: 'Close', minutes: 5 })).item.itemId;
    ids.talk4 = bodyOf(await add(code, { type: 'presentation', title: 'Thanks', minutes: 5 })).item.itemId;
    await run(code, { action: 'start', itemId: ids.talk3 });
    await run(code, { action: 'pause', itemId: ids.talk3 });
    await run(code, { action: 'start', itemId: ids.talk4 });
    assert.strictEqual(itemRow(code, ids.talk3).State, 'paused');
    const res = await run(code, { action: 'end-event' });
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.strictEqual(meta(code).State, 'ENDED');
    assert.strictEqual(meta(code).LiveItem, undefined);
    assert.strictEqual(itemRow(code, ids.talk3).State, 'done');
    assert.strictEqual(itemRow(code, ids.talk4).State, 'done');
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

  console.log('\n11. preview: the host opens an item\'s stage without taking it live');
  {
    table.clear();
    seedOrg(table, NW);
    seedSets();
    const fresh = await makeEvent();
    const p = fresh.code;
    const ann = bodyOf(await join(p, 'Ann'));
    const before = sessionReservations().length;
    const prep = await run(p, { action: 'prepare', itemId: fresh.ids.friction });
    const previewId = bodyOf(prep).gameId;
    await check('prepare makes the item\'s session, CREATED and unopened, and the item stays planned', () => {
      assert.strictEqual(prep.statusCode, 200, prep.body);
      assert.match(previewId, /^\d{4}$/);
      assert.strictEqual(sessionReservations().length, before + 1);
      assert.strictEqual(gameState(previewId).State, 'CREATED');
      assert.strictEqual(gameMeta(previewId).Started, false);
      assert.strictEqual(gameMeta(previewId).EventRef, p);
      assert.strictEqual(itemRow(p, fresh.ids.friction).State, 'planned');
      assert.strictEqual(itemRow(p, fresh.ids.friction).GameId, previewId);
      assert.strictEqual(meta(p).LiveItem, undefined);
    });
    await check('nobody can join a preview, and the public agenda does not link it', async () => {
      const res = await playerJoin(previewId, { attendeeToken: ann.token });
      assert.strictEqual(res.statusCode, 403, res.body);
      const pub = bodyOf(await agenda(p));
      assert.ok(!pub.items.find((i) => i.itemId === fresh.ids.friction).gameId);
      assert.strictEqual(bodyOf(await now(p)).now.liveItemId, '');
    });
    await check('preview again is the same session, never a second', async () => {
      const again = await run(p, { action: 'prepare', itemId: fresh.ids.friction });
      assert.strictEqual(bodyOf(again).gameId, previewId);
      assert.strictEqual(sessionReservations().length, before + 1);
    });
    await check('a talk, a break or an activity has no session to preview', async () => {
      const res = await run(p, { action: 'prepare', itemId: fresh.ids.talk });
      assert.strictEqual(res.statusCode, 409, res.body);
      assert.strictEqual(bodyOf(res).code, 'not_an_engagement');
    });
    await check('going live opens the SAME session: joinable, live, and the phones follow', async () => {
      const res = await run(p, { action: 'start', itemId: fresh.ids.friction });
      assert.strictEqual(res.statusCode, 200, res.body);
      assert.strictEqual(bodyOf(res).gameId, previewId);
      assert.strictEqual(sessionReservations().length, before + 1);
      assert.strictEqual(gameState(previewId).State, 'STARTED');
      assert.strictEqual(gameMeta(previewId).Started, true);
      assert.strictEqual(meta(p).LiveItem, fresh.ids.friction);
      const joinRes = await playerJoin(previewId, { attendeeToken: ann.token });
      assert.strictEqual(joinRes.statusCode, 200, joinRes.body);
    });
    await check('an engagement whose session has ENDED is finished, not paused, when the next item goes live', async () => {
      table.put({ ...gameState(previewId), State: 'ENDED' });
      connect(previewId);
      const res = await run(p, { action: 'start', itemId: fresh.ids.talk });
      assert.strictEqual(res.statusCode, 200, res.body);
      assert.strictEqual(itemRow(p, fresh.ids.friction).State, 'done');
      assert.strictEqual(gameState(previewId).EventPaused, undefined);
      assert.strictEqual(framesTo(previewId, 'eventItemEnded').length, 1);
      assert.strictEqual(framesTo(previewId, 'eventItemPaused').length, 0);
    });
    // THE RUNNING ORDER SURVIVES A HARMLESS EDIT (30 Sep 2026). Every saved
    // edit used to discard the prepared session, so a new description or a
    // longer planned length threw away the order a host had queued in it.
    const editItem = (body) => items(request({
      method: 'PUT', path: `/events/${p}/items/${fresh.ids.trivia}`, pathParameters: { code: p, itemId: fresh.ids.trivia },
      requestContext: host(), body,
    }));
    const TC = h.load('lambda-functions/websocket/tenant-crypto.js');
    await check('editing a previewed item\'s title, description or length keeps its session, and the new title reaches it', async () => {
      const kept = bodyOf(await run(p, { action: 'prepare', itemId: fresh.ids.trivia })).gameId;
      assert.ok(gameMeta(kept));
      const edit = await editItem({ title: 'Space night, again', description: 'Now with moons', minutes: 25 });
      assert.strictEqual(edit.statusCode, 200, edit.body);
      assert.strictEqual(itemRow(p, fresh.ids.trivia).GameId, kept, 'the preview was let go');
      assert.ok(gameMeta(kept), 'the prepared session was discarded');
      assert.strictEqual(await TC.decryptValue(NW, gameMeta(kept).Title), 'Space night, again');
      const index = [...table.store.values()].find((r) => r.SK === `GAME#${kept}` && r.PK !== 'GAMES');
      if (index) assert.strictEqual(await TC.decryptValue(NW, index.Title), 'Space night, again');
      // Re-sending the options unchanged is not a change either.
      const same = await editItem({ settings: { target: 5, randomizeQuestions: false } });
      assert.strictEqual(same.statusCode, 200, same.body);
      assert.strictEqual(itemRow(p, fresh.ids.trivia).GameId, kept);
      assert.strictEqual(bodyOf(await run(p, { action: 'prepare', itemId: fresh.ids.trivia })).gameId, kept);
    });
    await check('changing a previewed item\'s session options lets its session go, and the next preview is made from the edit', async () => {
      const again = itemRow(p, fresh.ids.trivia).GameId;
      assert.ok(gameMeta(again));
      const edit = await editItem({ settings: { target: 3, randomizeQuestions: false } });
      assert.strictEqual(edit.statusCode, 200, edit.body);
      assert.strictEqual(itemRow(p, fresh.ids.trivia).GameId, undefined);
      assert.strictEqual(gameMeta(again), undefined, 'the old preview was not discarded');
      assert.ok(!table.get('GAMES', `GAME#${again}`), 'its code is still held');
      const next = bodyOf(await run(p, { action: 'prepare', itemId: fresh.ids.trivia })).gameId;
      assert.notStrictEqual(next, again);
    });
    await check('a new title on a preview whose session has vanished clears the stale pointer', async () => {
      const gid = itemRow(p, fresh.ids.trivia).GameId;
      table.store.delete(table.keyOf(`GAME#${gid}`, 'METADATA'));
      const edit = await editItem({ title: 'Space night, last call' });
      assert.strictEqual(edit.statusCode, 200, edit.body);
      assert.strictEqual(itemRow(p, fresh.ids.trivia).GameId, undefined);
      const next = bodyOf(await run(p, { action: 'prepare', itemId: fresh.ids.trivia })).gameId;
      assert.ok(gameMeta(next));
    });
    await check('removing a previewed item lets its session go', async () => {
      const gid = itemRow(p, fresh.ids.trivia).GameId;
      const res = await items(request({
        method: 'DELETE', path: `/events/${p}/items/${fresh.ids.trivia}`, pathParameters: { code: p, itemId: fresh.ids.trivia },
        requestContext: host(),
      }));
      assert.strictEqual(res.statusCode, 200, res.body);
      assert.strictEqual(gameMeta(gid), undefined);
      assert.ok(!table.get('GAMES', `GAME#${gid}`));
    });
    await check('deleting an event lets its previews go too', async () => {
      table.clear();
      seedOrg(table, NW);
      seedSets();
      const other = await makeEvent();
      const gid = bodyOf(await run(other.code, { action: 'prepare', itemId: other.ids.pulse })).gameId;
      const del = await h.load('lambda-functions/websocket/events/update-event.js').handler(request({
        method: 'DELETE', path: `/events/${other.code}`, pathParameters: { code: other.code }, requestContext: host(),
      }));
      assert.strictEqual(del.statusCode, 200, del.body);
      assert.strictEqual(gameMeta(gid), undefined);
      assert.strictEqual(sessionReservations().length, 0);
    });
    await check('ending the day lets a preview nobody took live go, and keeps what was played', async () => {
      table.clear();
      seedOrg(table, NW);
      seedSets();
      const day = await makeEvent();
      const previewed = bodyOf(await run(day.code, { action: 'prepare', itemId: day.ids.pulse })).gameId;
      const played = bodyOf(await run(day.code, { action: 'start', itemId: day.ids.friction })).gameId;
      const res = await run(day.code, { action: 'end-event' });
      assert.strictEqual(res.statusCode, 200, res.body);
      assert.strictEqual(gameMeta(previewed), undefined, 'the unopened preview was kept');
      assert.ok(!table.get('GAMES', `GAME#${previewed}`), 'its code is still held');
      assert.strictEqual(itemRow(day.code, day.ids.pulse).GameId, undefined);
      assert.strictEqual(itemRow(day.code, day.ids.pulse).State, 'planned');
      assert.ok(gameMeta(played), 'the item that was played lost its session');
      assert.strictEqual(itemRow(day.code, day.ids.friction).State, 'done');
      assert.strictEqual(framesTo(previewed, 'eventEnded').length, 0);
    });
  }

  console.log('\n12. a day run straight through (QA drive 29 Sep 2026, finding #2)');
  // rejects: "0 OF 5 DONE" after every item was taken live in turn, four of
  // them Paused, and phones listing a closed survey as Paused.
  await check('Go live on each item in turn leaves every one before it DONE, and the phones say Done', async () => {
    table.clear();
    seedOrg(table, NW);
    seedSets();
    const day = await makeEvent();
    const order = ['trivia', 'talk', 'coffee', 'pulse', 'friction'];
    for (const key of order) {
      if (key === 'friction') {
        // The survey before it is closed on its stage, as a host does.
        table.put({ ...gameState(itemRow(day.code, day.ids.pulse).GameId), State: 'SURVEY#CLOSED' });
      }
      const res = await run(day.code, { action: 'start', itemId: day.ids[key] });
      assert.strictEqual(res.statusCode, 200, `${key}: ${res.body}`);
    }
    const res = await run(day.code, { action: 'end', itemId: day.ids.friction });
    assert.strictEqual(res.statusCode, 200, res.body);
    const view = bodyOf(res);
    assert.deepStrictEqual(view.items.map((i) => i.state), ['done', 'done', 'done', 'done', 'done']);
    const pub = bodyOf(await agenda(day.code));
    assert.ok(pub.items.every((i) => i.state === 'done'), JSON.stringify(pub.items.map((i) => i.state)));
    for (const key of ['trivia', 'pulse', 'friction']) {
      assert.strictEqual(gameState(itemRow(day.code, day.ids[key]).GameId).State, 'ENDED', key);
    }
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
