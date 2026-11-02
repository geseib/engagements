/**
 * THE TRIVIA ANSWER IS THE HOST'S UNTIL THE REVEAL (experience plan 2g).
 *
 * Trivia on two screens puts the question on the room's window (/present,
 * unauthenticated) and the answer on the host's console ("B is correct. Only
 * you see this."). The room's window reads only public doors, and every phone
 * holds a PLAYER socket, so this file holds every one of them to the same line
 * before RESULTS: no correct answer, no per-answer verdict, no explanation.
 *
 *   §1  GET /state, /state?view=room, the player's /state, get-question
 *       (player and a typed role=host), /answers and /answers?view=room, and
 *       the public get-results read, at ASK and VOTE.
 *   §2  the frames: opening the round (next-question.js) and an answer landing
 *       (websocket/message.js), as received by a PLAYER socket and the room's
 *       window's viewer socket.
 *   §3  the host's door carries the answer as drawn letters, resolved by the
 *       scorer's own module (gapped slots included); the public doors do not.
 *   §4  at RESULTS the answer is out on the public read, as the stage shows it.
 *   §5  a poll's board on ?view=room: counts and the question, never a name.
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
process.env.TABLE_NAME = 'test-table';
process.env.WEBSOCKET_API_ENDPOINT = 'https://ws.test.invalid/dev';

if (!process.env.DEBUG) { console.log = () => {}; console.warn = () => {}; console.error = () => {}; }
const say = (...a) => process.stdout.write(`${a.join(' ')}\n`);

const getState = require(path.join(REPO, 'lambda-functions/game/get-game-state.js')).handler;
const getQuestion = require(path.join(REPO, 'lambda-functions/game/get-question.js')).handler;
const getAnswers = require(path.join(REPO, 'lambda-functions/game/get-answers.js')).handler;
const getResults = require(path.join(REPO, 'lambda-functions/game/get-results.js')).handler;
const nextQuestion = require(path.join(REPO, 'lambda-functions/game/next-question.js')).handler;
const wsMessage = require(path.join(REPO, 'lambda-functions/websocket/message.js')).handler;

let pass = 0; let fail = 0;
async function check(label, fn) {
  try { await fn(); pass += 1; say(`  PASS  ${label}`); } catch (e) { fail += 1; say(`  FAIL  ${label}\n        ${e.message}`); }
}

const put = (item) => store.set(table.keyOf(item.PK, item.SK), item);
const GAME = '7451';
const PK = `GAME#${GAME}`;
const SET = 'set-trivia-private';
const EXPLAIN = 'SPOILER-EXPLANATION-7451';

/*
  A GAPPED question: optionA, optionC, optionD filled, optionB empty. The room
  sees A, B, C; the stored answer `OptionC` is the option drawn as B. So the
  host's door must say B (the letter the room is paid for), and a public body
  that carried `OptionC` anywhere would be a leak.
*/
const QUESTION = {
  Title: 'Which planet is largest',
  Detail: 'Pick one.',
  Category: 'Space',
  optionA: 'Mercury-7451', optionC: 'Jupiter-7451', optionD: 'Mars-7451',
  correctAnswer: 'OptionC',
  answerDetails: EXPLAIN,
  points: 10,
};

/** The leak signatures: any one in a public body before RESULTS fails it. */
const LEAKS = [
  [/correctAnswer/i, 'a correctAnswer field'],
  [/OptionC/, 'the stored answer'],
  [/isCorrect/i, 'a per-answer verdict'],
  [/pointsEarned|PointsEarned/, 'points earned'],
  [new RegExp(EXPLAIN), 'the explanation'],
  [/hostAnswer/, 'the host door\'s answer'],
];
const assertNoLeak = (raw, where) => {
  for (const [re, what] of LEAKS) assert.ok(!re.test(raw), `${where} carries ${what}: ${raw.slice(0, 300)}`);
};

function seed(state, { gameType = 'trivia', question = QUESTION } = {}) {
  store.clear(); sent.length = 0; frames.length = 0;
  put({
    PK, SK: 'METADATA', Title: 'Quiz night', HostName: 'Host', GameType: gameType,
    QuestionSetId: SET, QuestionSetScope: 'platform', Started: true, CreatedAt: '2026-11-01T09:00:00.000Z',
  });
  put({ PK, SK: 'STATE', State: state, LessonNumber: 1, CurrentQuestionId: 'QUESTION#c001#001' });
  put({ PK: 'SETS', SK: `SET#${SET}`, name: 'Quiz', engagementType: gameType });
  put({ PK: `SET#${SET}`, SK: 'QUESTION#c001#001', ...question });
  put({ PK, SK: 'QUESTION#001#REF', SourceQuestionId: 'QUESTION#c001#001', SetId: SET, SetScope: 'platform', StartedAt: '2026-11-01T09:10:00.000Z' });
  put({ PK, SK: 'PLAYER#Ada', PlayerName: 'Ada', JoinedAt: '2026-11-01T09:05:00.000Z' });
  put({ PK, SK: 'PLAYER#Bob', PlayerName: 'Bob', JoinedAt: '2026-11-01T09:05:00.000Z' });
  // Answers as message.js stores them for trivia: the drawn letter, with its verdict.
  put({ PK, SK: 'QUESTION#001#ANSWER#Ada', PlayerName: 'Ada', Answer: 'B', AnswerType: 'trivia', IsCorrect: true, PointsEarned: 14, SubmittedAt: '2026-11-01T09:11:00.000Z' });
  put({ PK, SK: 'QUESTION#001#ANSWER#Bob', PlayerName: 'Bob', Answer: 'A', AnswerType: 'trivia', IsCorrect: false, PointsEarned: 0, SubmittedAt: '2026-11-01T09:11:05.000Z' });
  put({ PK, SK: 'CONNECTION#host-1', ConnectionId: 'host-1', ConnectionType: 'HOST' });
  put({ PK, SK: 'CONNECTION#player-1', ConnectionId: 'player-1', ConnectionType: 'PLAYER', PlayerName: 'Ada' });
  put({ PK, SK: 'CONNECTION#viewer-1', ConnectionId: 'viewer-1', ConnectionType: 'PLAYER', Viewer: 'present', ViewerId: 'tab-1' });
}

const http = (routeKey, rawPath, { query = null, authorizer = null } = {}) => ({
  version: '2.0', routeKey, rawPath,
  pathParameters: { gameId: GAME },
  ...(query ? { queryStringParameters: query } : {}),
  requestContext: { routeKey, http: { method: 'GET' }, ...(authorizer ? { authorizer } : {}) },
});
const stateRead = (query) => getState(http('GET /games/{gameId}/state', `/games/${GAME}/state`, { query }));
const playerStateRead = () => getState({
  ...http('GET /games/{gameId}/state/{playerId}', `/games/${GAME}/state/Ada`),
  pathParameters: { gameId: GAME, playerId: 'Ada' },
});
const hostStateRead = () => getState(http('GET /games/{gameId}/host-state', `/games/${GAME}/host-state`, {
  authorizer: { lambda: { userId: 'u-1', groups: 'hosts', orgId: '', orgIds: '' } },
}));
const questionRead = (role) => getQuestion({ pathParameters: { gameId: GAME }, queryStringParameters: { role } });
const answersRead = (query) => getAnswers(http('GET /games/{gameId}/answers', `/games/${GAME}/answers`, { query }));
const resultsRead = () => getResults({
  version: '2.0', routeKey: 'POST /games/get-results', rawPath: '/games/get-results',
  requestContext: { routeKey: 'POST /games/get-results', http: { method: 'POST' } },
  body: JSON.stringify({ gameId: GAME, questionNumber: '001' }),
});

(async () => {
  say('\n§1. every public read, before the reveal');
  for (const state of ['ASK#001', 'VOTE#001']) {
    const reads = [
      ['/state', () => stateRead()],
      ['/state?view=room (the room\'s window)', () => stateRead({ view: 'room' })],
      ['the player\'s /state', () => playerStateRead()],
      ['get-question role=player', () => questionRead('player')],
      ['get-question role=host (a typed claim)', () => questionRead('host')],
      ['/answers', () => answersRead({ questionNumber: '001' })],
      ['/answers?view=room', () => answersRead({ questionNumber: '001', view: 'room' })],
    ];
    for (const [where, read] of reads) {
      seed(state);
      const res = await read();
      await check(`${state} ${where}: no answer, no verdict, no explanation`, () => {
        assert.ok(res.statusCode < 500, `status ${res.statusCode}: ${res.body}`);
        assertNoLeak(String(res.body || ''), where);
      });
    }
    seed(state);
    const results = await resultsRead();
    await check(`${state} the public get-results read: refused, and nothing in the refusal`, () => {
      assert.notStrictEqual(results.statusCode, 200, `a public caller read the results at ${state}: ${results.body}`);
      assertNoLeak(String(results.body || ''), 'get-results');
    });
    await check(`${state} …and it moved nothing: the round is still ${state}`, () =>
      assert.strictEqual(store.get(table.keyOf(PK, 'STATE')).State, state));
  }
  seed('ASK#001');
  const room = await stateRead({ view: 'room' });
  await check('the room\'s window still gets the options it draws (A, B, C, the gap closed by the page)', () => {
    const q = JSON.parse(room.body).currentQuestionData;
    assert.strictEqual(q.optionA, 'Mercury-7451');
    assert.strictEqual(q.optionC, 'Jupiter-7451');
  });

  say('\n§2. the frames a phone and the room\'s window receive');
  seed('RESULTS#000');
  store.get(table.keyOf(PK, 'STATE')).LessonNumber = 0;
  store.delete(table.keyOf(PK, 'QUESTION#001#REF'));
  put({ PK, SK: 'QUEUE', Queue: ['c001#001'], Version: 1, SetId: SET, SetVersion: null });
  put({ PK, SK: 'CATEGORY#c001#ACTIVE', ActiveIndex: 0, QuestionCount: 1 });
  put({ PK, SK: 'CATEGORY#c001#ORDER', QuestionOrder: ['001'], IsRandom: false });
  put({ PK: `SET#${SET}`, SK: 'CATEGORY#c001', Name: 'Space' });
  put({ PK, SK: 'STATE#CATS', 'AvailMask1-8': '10000000', 'HostMask1-8': '10000000', 'AvailMask9-16': '00000000', 'HostMask9-16': '00000000', 'AvailMask17-24': '00000000', 'HostMask17-24': '00000000' });
  put({ PK, SK: 'STATE#CATS#COUNTS', '1-8': [1], '9-16': [], '17-24': [], TotalEnabled: 1, TotalRemaining: 1, Version: 1 });
  const opened = await nextQuestion({ pathParameters: { gameId: GAME }, body: JSON.stringify({}) });
  const roomFrames = () => frames.filter((f) => f.connectionId !== 'host-1');
  await check('opening a trivia round: the fixture opened it, and a frame reached the room', () => {
    assert.strictEqual(opened.statusCode, 200, opened.body);
    assert.ok(roomFrames().some((f) => f.message.type === 'questionStarted'), JSON.stringify(frames.map((f) => [f.connectionId, f.message.type])));
  });
  await check('opening a trivia round: no frame to a phone or the room\'s window carries the answer', () => {
    for (const f of roomFrames()) assertNoLeak(JSON.stringify(f.message), `${f.message.type} to ${f.connectionId}`);
  });

  seed('ASK#001');
  store.delete(table.keyOf(PK, 'QUESTION#001#ANSWER#Ada'));
  await wsMessage({
    requestContext: { connectionId: 'player-1' },
    body: JSON.stringify({ messageType: 'ANSWER#001', gameId: GAME, playerName: 'Ada', answer: 'B', answerType: 'trivia' }),
  });
  const stored = store.get(table.keyOf(PK, 'QUESTION#001#ANSWER#Ada'));
  await check('an answer landing: the fixture scored it (B is the gapped C), so a verdict exists to leak', () => {
    assert.ok(stored, 'no answer row');
    assert.strictEqual(stored.IsCorrect, true);
  });
  await check('an answer landing: nothing to the room\'s window, and the phone hears only that it was kept', () => {
    assert.ok(!frames.some((f) => f.connectionId === 'viewer-1'), JSON.stringify(frames));
    for (const f of roomFrames()) assertNoLeak(JSON.stringify(f.message), `${f.message.type} to ${f.connectionId}`);
  });

  say('\n§3. the host\'s door: the answer as the letters the room sees');
  seed('ASK#001');
  const host = await hostStateRead();
  await check('host-state at ASK carries hostAnswer: round 001, letter B (the gapped slot C)', () => {
    assert.strictEqual(host.statusCode, 200, host.body);
    assert.deepStrictEqual(JSON.parse(host.body).hostAnswer, { round: '001', letters: ['B'] });
  });
  await check('…and still not the raw stored spelling, nor the explanation', () => {
    assert.ok(!/OptionC/.test(host.body), 'the raw spelling reached the host door');
    assert.ok(!host.body.includes(EXPLAIN), 'the explanation reached the host door');
  });
  seed('ASK#001', { gameType: 'call-and-answer' });
  const caHost = await hostStateRead();
  await check('a Call & Answer round has no hostAnswer', () => assert.strictEqual(JSON.parse(caHost.body).hostAnswer, null));

  say('\n§4. at RESULTS the answer is out, as the stage shows it');
  seed('RESULTS#001');
  const out = await stateRead({ view: 'room' });
  await check('/state?view=room at RESULTS carries the correct answer', () =>
    assert.strictEqual(JSON.parse(out.body).currentQuestionData.correctAnswer, 'OptionC'));

  say('\n§5. a poll\'s board on the room\'s window');
  const POLL_Q = { Title: 'Best day', Category: 'Meet', kind: 'choice', options: ['Monday', 'Friday'] };
  for (const state of ['ASK#001', 'RESULTS#001']) {
    seed(state, { gameType: 'poll', question: POLL_Q });
    put({ PK, SK: 'QUESTION#001#ANSWER#Ada', PlayerName: 'Ada', Answer: 'Friday', PollValue: [1], SubmittedAt: '2026-11-01T09:11:00.000Z' });
    put({ PK, SK: 'QUESTION#001#ANSWER#Bob', PlayerName: 'Bob', Answer: 'Friday', PollValue: [1], SubmittedAt: '2026-11-01T09:11:00.000Z' });
    const board = await answersRead({ questionNumber: '001', view: 'room' });
    const body = JSON.parse(board.body);
    await check(`${state}: ?view=room carries the board (question and tally), counted`, () => {
      assert.ok(body.poll && body.poll.question && body.poll.tally, board.body);
      assert.strictEqual(body.poll.question.kind, 'choice');
      assert.strictEqual(body.poll.tally.n, 2);
    });
    await check(`${state}: …never an answer row or a name`, () => {
      assert.strictEqual(body.answers, undefined);
      assert.ok(!/Ada|Bob/.test(board.body), board.body);
    });
  }
  seed('ASK#001', { gameType: 'poll', question: POLL_Q });
  const plain = await answersRead({ questionNumber: '001' });
  await check('without view=room the public read is a count, as before', () => assert.strictEqual(JSON.parse(plain.body).poll, undefined));
  seed('ASK#001');
  const triviaRoom = await answersRead({ questionNumber: '001', view: 'room' });
  await check('a trivia round gets no board on ?view=room (the split is the host\'s until the reveal)', () => {
    const b = JSON.parse(triviaRoom.body);
    assert.strictEqual(b.poll, undefined);
    assert.strictEqual(b.answers, undefined);
  });

  say(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail ? 1 : 0);
})().catch((e) => { say(e.stack); process.exit(1); });
