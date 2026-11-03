/**
 * THE IMPROMPTU ASK, END TO END — a question the host writes during a session
 * (docs/design/impromptu-ask README §5, §7), against a DynamoDB fake that
 * really evaluates ConditionExpressions and transactions.
 *
 *   §1 add-own through POST /queue: Next, Later (after a queued round and
 *      after an automatic one), Now (at the head), the field guards, the cap.
 *      The row and its place land in ONE transaction.
 *   §2 edit-own until it runs; remove marks the row `removed`.
 *   §3 Ask it now (`select_own`): refused while answers or votes are coming
 *      in (F2), served in RESULTS# and CREATED.
 *   §4 the drain serves the head own question: the REF carries `Source:
 *      'host'` and no set; the row becomes `asked` with its round; category
 *      counts, cursors and AvailMask are untouched (no decrementCategoryCount);
 *      edit is then refused (F3).
 *   §5 a queue built against a replaced set still serves the host's own entry
 *      and parks the set entries.
 *   §6 a full round on a host-written question: the phone's question (no
 *      category, no label, the fixed task, never the note), answers over the
 *      socket, votes, the host closing the round, and the results' read-back.
 *
 * rejects: an own question served from the set (or "Source question not
 *          found"); a Now that cuts a live round; an edit after the round ran;
 *          a category count spent on a question in no category; the host's
 *          note on any participant payload; a stale set dropping the host's
 *          own entry.
 */
const suiteFinished = require('./helpers/finish-guard');
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');
const { createTable, installStubs } = require('./helpers/player-table');

const table = createTable();
const store = table.store;
const sent = [];
const frames = [];

installStubs({ table, sent, frames });

// The read and the summary job ride along with closing a round; none may reach AWS.
const noopClient = class { async send() { return {}; } };
for (const [name, exports] of [
  ['@aws-sdk/client-lambda', { LambdaClient: noopClient, InvokeCommand: class {} }],
  ['@aws-sdk/client-s3', { S3Client: noopClient, GetObjectCommand: class {} }],
  ['@aws-sdk/client-bedrock-runtime', { BedrockRuntimeClient: class { async send() { throw new Error('no Bedrock in tests'); } }, InvokeModelCommand: class {} }],
]) {
  for (const base of [REPO, path.join(REPO, 'lambda-functions'), path.join(REPO, 'lambda-functions', 'game'), path.join(REPO, 'lambda-functions', 'websocket')]) {
    let p;
    try { p = require.resolve(name, { paths: [base] }); } catch { continue; }
    require.cache[p] = { id: p, filename: p, loaded: true, exports };
  }
}

process.env.TABLE_NAME = 'test-table';
process.env.WEBSOCKET_API_ENDPOINT = 'https://ws.test.invalid/dev';

const queueHandler = require(path.join(REPO, 'lambda-functions/game/question-queue.js'));
const nextQuestion = require(path.join(REPO, 'lambda-functions/game/next-question.js'));
const { handler: getQuestion } = require(path.join(REPO, 'lambda-functions/game/get-question.js'));
const { handler: getState } = require(path.join(REPO, 'lambda-functions/game/get-game-state.js'));
const { handler: getResults } = require(path.join(REPO, 'lambda-functions/game/get-results.js'));
const { handler: submitVote } = require(path.join(REPO, 'lambda-functions/game/submit-vote.js'));
const { handler: joinGame } = require(path.join(REPO, 'lambda-functions/game/join-game.js'));
const { handler: wsMessage } = require(path.join(REPO, 'lambda-functions/websocket/message.js'));
const { OWN_TASK } = require(path.join(REPO, 'lambda-functions/game/round-question.js'));

let pass = 0, fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  PASS  ${label}`); pass++; }
  catch (e) { console.log(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

const GAME = '6150';
const SET = 'set-alpha';
const PK = `GAME#${GAME}`;
const SETPK = `SET#${SET}#v2`;

const put = (item) => { store.set(table.keyOf(item.PK, item.SK), item); };
const get = (sk, pk = PK) => store.get(table.keyOf(pk, sk));
const bodyOf = (res) => JSON.parse(res.body);

function seed({ state = 'RESULTS#001', lesson = 1, queue = null, queueSetVersion = 2 } = {}) {
  store.clear();
  sent.length = 0;
  frames.length = 0;
  put({ PK, SK: 'METADATA', GameType: 'call-and-answer', Title: 'Q4 retro', QuestionSetId: SET, QuestionSetVersion: 2, Started: true, Visibility: 'public' });
  put({ PK, SK: 'STATE', State: state, LessonNumber: lesson, CurrentQuestionId: String(lesson).padStart(3, '0') });
  put({ PK: 'SETS', SK: `SET#${SET}`, activeVersion: 2, versions: [{ version: 2 }, { version: 3 }], customInstruction: 'How could you adapt this lesson to your team?' });
  put({
    PK, SK: 'STATE#CATS',
    'AvailMask1-8': '10000000', 'AvailMask9-16': '00000000', 'AvailMask17-24': '00000000',
    'HostMask1-8': '10000000', 'HostMask9-16': '00000000', 'HostMask17-24': '00000000',
  });
  put({ PK: SETPK, SK: 'CATEGORY#c001', Name: 'Pricing' });
  put({ PK, SK: 'CATEGORY#c001#ACTIVE', ActiveIndex: 5, QuestionCount: 40 });
  put({ PK, SK: 'CATEGORY#c001#ORDER', QuestionOrder: ['090', '091'], IsRandom: false });
  put({ PK: SETPK, SK: 'QUESTION#c001#090', Category: 'Pricing', Title: 'Ninety' });
  put({ PK: SETPK, SK: 'QUESTION#c001#091', Category: 'Pricing', Title: 'Ninety-one' });
  put({ PK: SETPK, SK: 'QUESTION#c001#017', Category: 'Pricing', Title: 'Seventeen' });
  put({ PK, SK: 'STATE#CATS#COUNTS', '1-8': [40], '9-16': [], '17-24': [], TotalEnabled: 40, TotalRemaining: 40, Version: 1 });
  put({ PK, SK: 'CONNECTION#host-1', ConnectionId: 'host-1', ConnectionType: 'HOST' });
  if (queue) {
    put({ PK, SK: 'QUEUE', Queue: [...queue], Version: 4, SetId: SET, SetVersion: queueSetVersion, UpdatedAt: '2026-11-03T00:00:00.000Z' });
  }
}

const HOST = { authorizer: { lambda: { userId: 'host-1', groups: 'hosts' }, claims: { name: 'Dana Host' } } };
const post = (body) => queueHandler.handler({
  requestContext: { http: { method: 'POST' }, ...HOST },
  pathParameters: { gameId: GAME },
  body: JSON.stringify(body),
});
const advance = (body = {}) => nextQuestion.handler({
  requestContext: HOST,
  pathParameters: { gameId: GAME },
  body: JSON.stringify(body),
});
const queueNow = () => (get('QUEUE') || {}).Queue || [];
const ownRow = (key) => get(`OWNQ#${String(key).replace(/^own:/, '')}`);
const addOwn = (extra = {}) => post({
  op: 'add-own', place: 'next', question: { title: 'What would have to be true to ship by March?', detail: 'Think about people and money.', note: 'Is the blocker budget or sign-off?' }, ...extra,
});

(async () => {
  console.log('\n1. add-own: the row and its place, in one transaction');

  seed({ queue: ['c001#017'] });
  const added = await addOwn();
  const addedBody = bodyOf(added);
  const key = addedBody.key;
  await check('200, changed, and the minted own: key comes back', () => {
    assert.strictEqual(added.statusCode, 200, added.body);
    assert.strictEqual(addedBody.changed, true);
    assert.match(String(key), /^own:[0-9a-f]{12}$/);
  });
  await check('Next puts it at the head of the running order', () =>
    assert.deepStrictEqual(queueNow(), [key, 'c001#017']));
  await check('the OWNQ row holds the three fields, the fixed task and Status queued', () => {
    const row = ownRow(key);
    assert.ok(row, 'no OWNQ row');
    assert.strictEqual(row.Title, 'What would have to be true to ship by March?');
    assert.strictEqual(row.Detail, 'Think about people and money.');
    assert.strictEqual(row.Background, 'Is the blocker budget or sign-off?');
    assert.strictEqual(row.CustomInstructions, OWN_TASK);
    assert.strictEqual(row.Status, 'queued');
    assert.strictEqual(row.Placement, 'next');
    assert.strictEqual(row.PlacedAtRound, 1);
    assert.strictEqual(row.CreatedByName, 'Dana Host');
    assert.ok(Number.isInteger(row.ttl), 'the row rides the session lifetime');
  });
  await check('the response lists the host\'s own questions with the note (host-only route)', () => {
    const own = addedBody.ownQuestions.find((o) => o.key === key);
    assert.ok(own, JSON.stringify(addedBody.ownQuestions));
    assert.strictEqual(own.note, 'Is the blocker budget or sign-off?');
    assert.strictEqual(own.status, 'queued');
  });

  const later = await addOwn({ place: 'later', anchorKey: 'c001#017', anchorRound: 3, question: { title: 'Second own' } });
  await check('Later after a queued round lands right after it', () => {
    const k = bodyOf(later).key;
    assert.deepStrictEqual(queueNow(), [key, 'c001#017', k]);
    assert.strictEqual(ownRow(k).PlacedAfterRound, 3);
  });

  seed({ queue: [] });
  const afterAuto = await addOwn({ place: 'later', anchorKey: 'c001#091', through: ['c001#090', 'c001#091'], question: { title: 'After an automatic round' } });
  await check('Later after an AUTOMATIC round queues the walk through it, then the question', () =>
    assert.deepStrictEqual(queueNow(), ['c001#090', 'c001#091', bodyOf(afterAuto).key]));

  seed({ queue: ['c001#017'] });
  const nowAdd = await addOwn({ place: 'now', question: { title: 'Now one' } });
  await check('Now also goes to the head (select_own then serves it)', () =>
    assert.strictEqual(queueNow()[0], bodyOf(nowAdd).key));

  seed();
  const blank = await post({ op: 'add-own', question: { title: '   ' } });
  await check('a question with no words is refused, 400, nothing written', () => {
    assert.strictEqual(blank.statusCode, 400);
    assert.ok(![...store.keys()].some((k) => k.includes('OWNQ#')), 'a row was written');
  });
  const long = await post({ op: 'add-own', question: { title: 'x'.repeat(201) } });
  await check('a question past 200 characters is refused', () => assert.strictEqual(long.statusCode, 400));
  const longNote = await post({ op: 'add-own', question: { title: 'ok', note: 'n'.repeat(401) } });
  await check('a note past 400 characters is refused', () => assert.strictEqual(longNote.statusCode, 400));

  seed({ queue: Array.from({ length: 24 }, (_, i) => `c001#${String(i + 100)}`) });
  const full = await addOwn();
  await check('the queue\'s 24 is the only cap (F7): full is refused and no row is left behind', () => {
    assert.strictEqual(bodyOf(full).refused, 'full');
    assert.ok(![...store.keys()].some((k) => k.includes('OWNQ#')), 'a row without a place was written');
  });

  console.log('\n2. edit-own until it runs; remove marks it removed');

  seed({ queue: [] });
  const k2 = bodyOf(await addOwn()).key;
  const edited = await post({ op: 'edit-own', questionKey: k2, question: { title: 'Edited words', detail: '', note: 'new note' } });
  await check('edit-own rewrites the words and never the order', () => {
    assert.strictEqual(bodyOf(edited).changed, true, edited.body);
    assert.strictEqual(ownRow(k2).Title, 'Edited words');
    assert.strictEqual(ownRow(k2).Background, 'new note');
    assert.deepStrictEqual(queueNow(), [k2]);
  });
  const badEdit = await post({ op: 'edit-own', questionKey: 'c001#017', question: { title: 'x' } });
  await check('edit-own refuses a set key', () => assert.strictEqual(badEdit.statusCode, 400));

  const removed = await post({ op: 'remove', questionKey: k2 });
  await check('remove takes it out of the queue and marks the row removed', () => {
    assert.strictEqual(bodyOf(removed).changed, true);
    assert.deepStrictEqual(queueNow(), []);
    assert.strictEqual(ownRow(k2).Status, 'removed');
    assert.ok(!bodyOf(removed).ownQuestions.some((o) => o.key === k2), 'a removed question is still listed');
  });

  console.log('\n3. Ask it now: only between rounds');

  for (const state of ['ASK#002', 'VOTE#002']) {
    seed({ state, lesson: 2, queue: [] });
    const k = bodyOf(await addOwn()).key;
    const res = await advance({ action: 'select_own', ownId: k.slice(4) });
    // eslint-disable-next-line no-await-in-loop
    await check(`refused in ${state} with the reason, and nothing moves`, () => {
      assert.strictEqual(res.statusCode, 409, res.body);
      assert.match(bodyOf(res).error, /Answers are still coming in/);
      assert.strictEqual(get('STATE').State, state);
      assert.strictEqual(ownRow(k).Status, 'queued');
    });
  }

  seed({ state: 'RESULTS#002', lesson: 2, queue: ['c001#017'] });
  const kNow = bodyOf(await addOwn({ place: 'now' })).key;
  const nowRes = await advance({ action: 'select_own', ownId: kNow.slice(4) });
  await check('accepted in RESULTS#: round 3 asks the host\'s question', () => {
    assert.strictEqual(nowRes.statusCode, 200, nowRes.body);
    assert.strictEqual(get('STATE').State, 'ASK#003');
    assert.strictEqual(get('QUESTION#003#REF').SourceQuestionId, `OWNQ#${kNow.slice(4)}`);
    assert.strictEqual(bodyOf(nowRes).ownQuestion, true);
  });
  await check('…and it left the running order, so Next round does not serve it twice', () =>
    assert.deepStrictEqual(queueNow(), ['c001#017']));
  const again = await advance({ action: 'select_own', ownId: kNow.slice(4) });
  await check('a second Now of the same question is refused (already asked)', () =>
    assert.strictEqual(again.statusCode, 409));

  seed({ state: 'CREATED', lesson: 0, queue: [] });
  const kFirst = bodyOf(await addOwn({ question: { title: 'What do you need from today?' } })).key;
  const firstRes = await advance({ action: 'select_own', ownId: kFirst.slice(4) });
  await check('accepted in CREATED: written in Setup, it is round 1 (F8)', () => {
    assert.strictEqual(firstRes.statusCode, 200, firstRes.body);
    assert.strictEqual(get('STATE').State, 'ASK#001');
    assert.strictEqual(get('QUESTION#001#REF').Source, 'host');
  });

  console.log('\n4. the drain serves the head own question as a specific, category-less round');

  seed({ queue: [] });
  const k4 = bodyOf(await addOwn()).key;
  const countsBefore = JSON.stringify(get('STATE#CATS#COUNTS'));
  const catsBefore = JSON.stringify(get('STATE#CATS'));
  const served = await advance();
  const ref = get('QUESTION#002#REF');
  await check('Next round serves the host\'s question', () => {
    assert.strictEqual(served.statusCode, 200, served.body);
    assert.strictEqual(bodyOf(served).fromQueue, true);
    assert.strictEqual(ref.SourceQuestionId, `OWNQ#${k4.slice(4)}`);
  });
  await check('the REF says Source host and names no set, scope or version', () => {
    assert.strictEqual(ref.Source, 'host');
    assert.ok(!('SetId' in ref) && !('SetScope' in ref) && !('SetVersion' in ref), JSON.stringify(ref));
  });
  await check('the row is asked, with its round', () => {
    assert.strictEqual(ownRow(k4).Status, 'asked');
    assert.strictEqual(ownRow(k4).AskedRound, 2);
  });
  await check('no category count was spent (decrementCategoryCount skipped)', () =>
    assert.strictEqual(JSON.stringify(get('STATE#CATS#COUNTS')), countsBefore));
  await check('the masks and the automatic cursor are untouched', () => {
    assert.strictEqual(JSON.stringify(get('STATE#CATS')), catsBefore);
    assert.strictEqual(get('CATEGORY#c001#ACTIVE').ActiveIndex, 5);
  });
  await check('the room\'s frame carries no "from the host" label (F6)', () => {
    const started = sent.find((m) => m.type === 'questionStarted');
    assert.ok(started, 'no questionStarted frame');
    assert.ok(!JSON.stringify(started).match(/own|host/i), JSON.stringify(started));
  });
  const lateEdit = await post({ op: 'edit-own', questionKey: k4, question: { title: 'too late' } });
  await check('once asked, edit-own is refused: "already-asked" (F3)', () => {
    assert.strictEqual(bodyOf(lateEdit).refused, 'already-asked');
    assert.notStrictEqual(ownRow(k4).Title, 'too late');
  });

  console.log('\n5. a replaced set parks set entries and still serves the host\'s own');

  seed({ queue: ['c001#017'], queueSetVersion: 1 });
  const k5 = bodyOf(await addOwn({ place: 'end' })).key;
  // add-own re-stamped the queue's set version; put the stale stamp back.
  put({ ...get('QUEUE'), SetVersion: 1 });
  const staleServe = await advance();
  await check('the own entry is served although the set entry ahead of it is stale', () => {
    assert.strictEqual(staleServe.statusCode, 200, staleServe.body);
    assert.strictEqual(get('QUESTION#002#REF').SourceQuestionId, `OWNQ#${k5.slice(4)}`);
  });
  await check('the set entry is left queued (recoverable), the own one is gone', () =>
    assert.deepStrictEqual(queueNow(), ['c001#017']));

  console.log('\n6. a full round on a host-written question');

  seed({ state: 'RESULTS#001', lesson: 1, queue: [] });
  const k6 = bodyOf(await addOwn()).key;
  await advance();
  const asPlayer = await getQuestion({ pathParameters: { gameId: GAME }, queryStringParameters: { role: 'player' } });
  const pq = bodyOf(asPlayer);
  await check('the phone gets the question — never "Source question not found"', () => {
    assert.strictEqual(asPlayer.statusCode, 200, asPlayer.body);
    assert.strictEqual(pq.title, 'What would have to be true to ship by March?');
    assert.strictEqual(pq.detail, 'Think about people and money.');
  });
  await check('no category, and the fixed task — not the set\'s lesson task', () => {
    assert.ok(!pq.category, `category: ${pq.category}`);
    assert.strictEqual(pq.customInstructions, OWN_TASK);
    assert.strictEqual(pq.setCustomInstruction, null);
  });
  await check('the host\'s note is on no participant payload', () => {
    assert.ok(!asPlayer.body.includes('Is the blocker budget'), asPlayer.body);
    assert.ok(!asPlayer.body.includes('Background'), 'a Background field reached the phone');
  });
  const pub = await getState({ pathParameters: { gameId: GAME }, requestContext: { http: { method: 'GET' } } });
  await check('the public /state shows the question and never the note or the queue\'s own list', () => {
    assert.strictEqual(pub.statusCode, 200, pub.body);
    assert.ok(pub.body.includes('What would have to be true'), 'the round is missing from /state');
    assert.ok(!pub.body.includes('Is the blocker budget'), 'the note leaked to /state');
    assert.ok(!pub.body.includes('ownQuestions'), 'the own list leaked to /state');
  });

  for (const [name, client] of [['Ada', 'c-ada'], ['Grace', 'c-grace'], ['Lin', 'c-lin']]) {
    // eslint-disable-next-line no-await-in-loop
    await joinGame({ pathParameters: { gameId: GAME }, body: JSON.stringify({ playerName: name, clientId: client }) });
    put({ PK, SK: `CONNECTION#p-${name}`, ConnectionId: `p-${name}`, ConnectionType: 'PLAYER', PlayerName: name });
    // eslint-disable-next-line no-await-in-loop
    await wsMessage({
      requestContext: { connectionId: `p-${name}` },
      body: JSON.stringify({ messageType: 'ANSWER#002', gameId: GAME, playerName: name, answer: `${name} says ship smaller`, answerType: 'text' }),
    });
  }
  await check('answers land under the round like any round', () =>
    assert.strictEqual([...store.keys()].filter((k) => k.startsWith(`${PK}|QUESTION#002#ANSWER#`)).length, 3));

  put({ ...get('STATE'), State: 'VOTE#002' });
  const vote = await submitVote({ pathParameters: { gameId: GAME }, body: JSON.stringify({ playerName: 'Ada', questionNumber: '002', votes: { 1: 1, 2: 2 } }) });
  await check('a vote is taken like any round', () => assert.strictEqual(vote.statusCode, 200, vote.body));

  const closed = await getResults({
    requestContext: { routeKey: 'POST /games/{gameId}/close-round', ...HOST },
    pathParameters: { gameId: GAME },
    body: JSON.stringify({ questionNumber: 2 }),
  });
  const results = bodyOf(closed);
  await check('the host closes it: RESULTS#002', () => {
    assert.strictEqual(closed.statusCode, 200, closed.body);
    assert.strictEqual(get('STATE').State, 'RESULTS#002');
  });
  await check('scoring is the same as any round: the vote scored 3 for first place', () => {
    const tallies = Object.values(results.voteTallies || {});
    assert.ok(tallies.some((t) => t.totalScore === 3 && t.firstPlace === 1), JSON.stringify(results.voteTallies));
    assert.ok(!closed.body.includes('Is the blocker budget'), 'the note reached the close payload');
  });
  // The phone going back to the round from the end screen (issue #47): the
  // public route, no identity, once the room has moved on.
  put({ ...get('STATE'), State: 'ENDED' });
  const readBack = await getResults({ body: JSON.stringify({ gameId: GAME, questionNumber: 2 }) });
  await check('the public read-back names the host\'s question, without the note', () => {
    assert.strictEqual(readBack.statusCode, 200, readBack.body);
    const rb = bodyOf(readBack);
    assert.strictEqual(rb.questionTitle, 'What would have to be true to ship by March?', readBack.body.slice(0, 300));
    assert.ok(!readBack.body.includes('Is the blocker budget'), 'the note reached the public read-back');
  });
  void k6;

  console.log(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail === 0 ? 0 : 1);
})();
