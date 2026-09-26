/**
 * CLOSING AN OLDER ROUND AGAIN NEITHER REWINDS THE ROOM NOR SCORES TWICE.
 *
 * `POST /games/{gameId}/close-round` (get-results.js) used to write
 * `RESULTS#<asked>` and `LessonNumber=<asked>` whatever round the session was
 * on, and its re-score guard asked only "is this the round the player was
 * LAST scored in?". So with round 3 closed, a request to close round 2 moved
 * the whole room back to round 2 and paid round 2's points a second time.
 *
 * The likely trigger is two host screens: the stage and the phone remote
 * (HostRemote.jsx), which polls `/state` and closes "the current round" as it
 * last saw it. A poll that lands just before the stage moves on sends an old
 * round number.
 *
 * Every caller closes the round the session is ON (GameHostPage's
 * `lessonNumber`, the remote's `snapshot.currentQuestion`); nothing in the
 * product closes an earlier round on purpose, so the refusal costs no flow.
 *
 *   §1  trivia and call-and-answer: close 1 → 2 → 3, then ask for round 2 —
 *       while round 3 is being asked, and after it has closed. 409, nothing
 *       written, nothing broadcast, nobody's points move. Re-showing round 3
 *       is still allowed.
 *   §2  wavelength: its stored-results path re-announces, and must not rewind.
 *   §3  scoring is idempotent per round on its own, even with the transition
 *       guard out of the way: the score row records the rounds it has counted.
 */
const suiteFinished = require('./helpers/finish-guard');
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');
const { createTable, installStubs } = require('./helpers/player-table');

const table = createTable();
const sent = [];
installStubs({ table, sent });

process.env.TABLE_NAME = 'test-table';
process.env.WEBSOCKET_API_ENDPOINT = 'https://ws.test.invalid/dev';

const { handler: getResults } = require(path.join(REPO, 'lambda-functions/game/get-results.js'));

let pass = 0, fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  PASS  ${label}`); pass++; }
  catch (e) { console.log(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

const GAME = '4242';
const PK = `GAME#${GAME}`;
const T_JOIN = '2026-09-26T18:00:00.000Z';
const CLOSE = 'POST /games/{gameId}/close-round';
const closeRound = (questionNumber) => getResults({
  routeKey: CLOSE,
  pathParameters: { gameId: GAME },
  requestContext: {
    routeKey: CLOSE, http: { method: 'POST' },
    authorizer: { lambda: { userId: 'u', groups: 'hosts' } },
  },
  body: JSON.stringify({ questionNumber }),
});

const pad = (n) => String(n).padStart(3, '0');
const WRITES = new Set(['put', 'update', 'delete', 'transactWrite']);
const writesSince = (mark) => table.log.slice(mark).filter((c) => WRITES.has(c.type));
const stateRow = () => table.get(PK, 'STATE');
const scoreRow = (name) => table.get(PK, `PLAYER#${name}#SCORE`) || {};
const scoreOf = (name) => scoreRow(name).score;

/** Points a player earns in every round of the fixture. */
const POINTS = {
  trivia: { Ada: 10, Bo: 8 },
  // One answer (Ada's) and one ballot putting it first: 3 points, the default.
  'call-and-answer': { Ada: 3, Bo: 0 },
};

function seedRoom(gameType) {
  table.clear();
  sent.length = 0;
  table.put({ PK, SK: 'METADATA', Title: 'Room', GameType: gameType });
  table.put({ PK, SK: 'STATE', State: 'CREATED', LessonNumber: 0 });
  // A live socket, so a broadcast would be seen.
  table.put({ PK, SK: 'CONNECTION#stage', ConnectionId: 'stage' });
  for (const name of ['Ada', 'Bo']) {
    table.put({ PK, SK: `PLAYER#${name}#SCORE`, PlayerName: name, score: 0, afterRound: '000', updatedAt: T_JOIN });
  }
}

/** What next-question.js (and start-vote.js) leave on STATE for round n, plus its answers. */
function askRound(gameType, n) {
  const p = pad(n);
  Object.assign(stateRow(), {
    State: gameType === 'call-and-answer' ? `VOTE#${p}` : `ASK#${p}`,
    LessonNumber: n,
    CurrentQuestionId: p,
  });
  if (gameType === 'trivia') {
    table.put({ PK, SK: `QUESTION#${p}#ANSWER#Ada`, PlayerName: 'Ada', Answer: 'OptionA', IsCorrect: true, PointsEarned: POINTS.trivia.Ada });
    table.put({ PK, SK: `QUESTION#${p}#ANSWER#Bo`, PlayerName: 'Bo', Answer: 'OptionA', IsCorrect: true, PointsEarned: POINTS.trivia.Bo });
  } else {
    table.put({ PK, SK: `QUESTION#${p}#ANSWER#Ada`, PlayerName: 'Ada', Answer: `thought ${n}` });
    table.put({ PK, SK: `QUESTION#${p}#VOTE#Bo`, PlayerName: 'Bo', Votes: { 0: 1 } });
  }
}

/** Ask and close rounds 1..n in order, as a host would. Returns the responses. */
async function playRounds(gameType, n) {
  const out = [];
  for (let r = 1; r <= n; r++) {
    askRound(gameType, r);
    out.push(await closeRound(r));
  }
  return out;
}

/** A refused close: 409, nothing written, nothing told to the room. */
async function expectRefused(label, questionNumber, { state, lesson, scores }) {
  const mark = table.log.length;
  const framesBefore = sent.length;
  const res = await closeRound(questionNumber);
  let body = {};
  try { body = JSON.parse(res.body); } catch { /* asserted below */ }

  await check(`${label}: 409`, () => assert.strictEqual(res.statusCode, 409, res.body));
  await check(`${label}: the refusal says, in words, which round the session is on`, () => {
    assert.ok(typeof body.message === 'string' && body.message.trim(), 'message is a sentence');
    assert.strictEqual(body.error, body.message, 'error and message carry the same sentence');
    assert.ok(new RegExp(`round ${lesson}\\b`, 'i').test(body.message), `names round ${lesson}: "${body.message}"`);
  });
  await check(`${label}: nothing is written`, () => {
    const writes = writesSince(mark);
    assert.deepStrictEqual(writes.map((c) => `${c.type} ${(c.input.Key || c.input.Item || {}).SK}`), []);
  });
  await check(`${label}: the room stays on ${state}`, () => {
    assert.strictEqual(stateRow().State, state);
    assert.strictEqual(stateRow().LessonNumber, lesson);
    assert.strictEqual(stateRow().CurrentQuestionId, pad(lesson));
  });
  await check(`${label}: nobody's points move`, () => {
    for (const [name, score] of Object.entries(scores)) assert.strictEqual(scoreOf(name), score, name);
  });
  await check(`${label}: the room is not told anything`, () =>
    assert.strictEqual(sent.length, framesBefore, JSON.stringify(sent.slice(framesBefore))));
}

(async () => {
  for (const gameType of ['trivia', 'call-and-answer']) {
    const per = POINTS[gameType];
    const after = (rounds) => ({ Ada: per.Ada * rounds, Bo: per.Bo * rounds });

    console.log(`\n1. ${gameType}: close 1 → 2 → 3, then ask for round 2 again`);
    seedRoom(gameType);
    const first = await playRounds(gameType, 2);
    await check('rounds 1 and 2 close', () => first.forEach((r) => assert.strictEqual(r.statusCode, 200, r.body)));

    // The stale remote: round 3 is being asked, and a poll from round 2 closes "the current round".
    askRound(gameType, 3);
    const onAsk = stateRow().State;
    await expectRefused('while round 3 is being asked', 2, { state: onAsk, lesson: 3, scores: after(2) });

    const third = await closeRound(3);
    await check('round 3 closes', () => assert.strictEqual(third.statusCode, 200, third.body));
    await check('each player has three rounds of points', () => {
      assert.strictEqual(scoreOf('Ada'), per.Ada * 3);
      assert.strictEqual(scoreOf('Bo'), per.Bo * 3);
    });
    await check('the score row records the rounds it has counted, as a string set', () => {
      const rounds = scoreRow('Ada').scoredRounds;
      assert.ok(rounds instanceof Set, `scoredRounds is a Set (a DynamoDB SS), got ${rounds && rounds.constructor && rounds.constructor.name}`);
      assert.deepStrictEqual([...rounds].sort(), ['001', '002', '003']);
    });

    await expectRefused('after round 3 has closed', 2, { state: 'RESULTS#003', lesson: 3, scores: after(3) });
    await expectRefused('round 2 spelled the way the state stores it', '002', { state: 'RESULTS#003', lesson: 3, scores: after(3) });
    await expectRefused('round 1', 1, { state: 'RESULTS#003', lesson: 3, scores: after(3) });

    const reshow = await closeRound(3);
    await check('re-showing round 3 is still allowed', () => {
      assert.strictEqual(reshow.statusCode, 200, reshow.body);
      assert.strictEqual(JSON.parse(reshow.body).questionId, '003');
    });
    await check('...and it stays on round 3 without paying round 3 again', () => {
      assert.strictEqual(stateRow().State, 'RESULTS#003');
      assert.strictEqual(stateRow().LessonNumber, 3);
      assert.strictEqual(scoreOf('Ada'), per.Ada * 3);
      assert.strictEqual(scoreOf('Bo'), per.Bo * 3);
    });
  }

  console.log('\n2. wavelength: the stored-results path does not rewind either');
  seedRoom('wavelength');
  Object.assign(stateRow(), { State: 'RESULTS#003', LessonNumber: 3, CurrentQuestionId: '003' });
  table.put({
    PK, SK: 'QUESTION#002#RESULTS', gameId: GAME, questionId: '002', gameType: 'wavelength',
    answers: [], wordAnalysis: { matching: 'exact', clustering: 'skipped', words: [], commonWords: [] }, teamScore: 0,
  });
  await expectRefused('round 2 of a wavelength session', 2, { state: 'RESULTS#003', lesson: 3, scores: { Ada: 0, Bo: 0 } });

  for (const gameType of ['trivia', 'call-and-answer']) {
    const per = POINTS[gameType];

    console.log(`\n3. ${gameType}: no round's points are paid twice, even past the transition guard`);
    seedRoom(gameType);
    askRound(gameType, 1);
    await closeRound(1);
    const twice = await closeRound(1);
    await check('closing the same round twice pays it once', () => {
      assert.strictEqual(twice.statusCode, 200, twice.body);
      assert.strictEqual(scoreOf('Ada'), per.Ada);
      assert.strictEqual(scoreOf('Bo'), per.Bo);
    });

    await playRounds(gameType, 3);
    const paid = { Ada: scoreOf('Ada'), Bo: scoreOf('Bo') };
    await check('three rounds paid', () => assert.strictEqual(paid.Ada, per.Ada * 3));
    // Exactly what the old handler left behind on a stale close of round 2:
    // the room rewound. The transition guard has nothing to refuse from here,
    // so only the score row can know round 2 is already paid — its LAST
    // scored round is 3, which is all the old guard compared against.
    Object.assign(stateRow(), { State: 'RESULTS#002', LessonNumber: 2, CurrentQuestionId: '002' });
    const bypass = await closeRound(2);
    await check('the scoring path answers', () => assert.strictEqual(bypass.statusCode, 200, bypass.body));
    await check('round 2 is not paid a second time', () => {
      assert.strictEqual(scoreOf('Ada'), paid.Ada);
      assert.strictEqual(scoreOf('Bo'), paid.Bo);
    });
    await check('the row still says round 3 was the last it counted', () =>
      assert.strictEqual(scoreRow('Ada').afterRound, '003'));
  }

  console.log('\n3b. a score row written before the set existed');
  seedRoom('trivia');
  Object.assign(scoreRow('Ada'), { score: 20, afterRound: '002', updatedAt: T_JOIN });
  askRound('trivia', 2);
  await closeRound(2);
  await check('its last scored round still counts as paid', () => assert.strictEqual(scoreOf('Ada'), 20));
  askRound('trivia', 3);
  await closeRound(3);
  await check('the next round it counts starts the set from that round', () => {
    assert.strictEqual(scoreOf('Ada'), 30);
    assert.deepStrictEqual([...scoreRow('Ada').scoredRounds].sort(), ['002', '003']);
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
