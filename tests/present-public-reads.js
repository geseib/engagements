/**
 * THE ROOM VIEW OF THE PUBLIC READS (two-surface PLAN 1.11-1.12, D3).
 *
 * The Presentation (Phase 2) is unauthenticated: it shows only what the room
 * already sees, so it reads the public routes anyone holding the four-digit
 * code can read. `?view=room` adds exactly two things and takes away more:
 *
 *   §1  GET /games/{id}/state?view=room adds `roomCounts` — integers only —
 *       and carries nothing from the host's door: no running order, no goal,
 *       no answerer or voter lists, no Background, no player name.
 *   §2  without `view=room` the public body is what it was, with no
 *       roomCounts; the room view is that body plus roomCounts and nothing else.
 *   §3  GET /games/{id}/answers?view=room always strips authorship and the
 *       submission time — during VOTE on a NAMED round too (the owner's
 *       ruling: during voting names are always hidden). Without the
 *       parameter, unchanged.
 *
 * The counts are read through tests/helpers/paged-table.js with a page of 3
 * rows, so a count that read one page and stopped would come out short.
 */
const suiteFinished = require('./helpers/finish-guard');
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');

const Module = require('module');
const stubs = new Map();
const realLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (stubs.has(request)) return stubs.get(request);
  return realLoad.call(this, request, parent, isMain);
};
const stub = (name, exports) => stubs.set(name, exports);

process.env.TABLE_NAME = 'engage-test';
process.env.AWS_REGION = 'us-east-1';

const { createPagedTable, commands } = require('./helpers/paged-table');
const table = createPagedTable({ pageSize: 3 });
stub('@aws-sdk/client-dynamodb', { DynamoDBClient: class {} });
stub('@aws-sdk/lib-dynamodb', { DynamoDBDocumentClient: { from: () => table }, ...commands });

const { handler: getState } = require(path.join(REPO, 'lambda-functions/game/get-game-state.js'));
const { handler: getAnswers } = require(path.join(REPO, 'lambda-functions/game/get-answers.js'));

if (!process.env.DEBUG) { console.log = () => {}; console.warn = () => {}; console.error = () => {}; }
const say = (...a) => process.stdout.write(a.join(' ') + '\n');

let pass = 0; let fail = 0;
async function check(label, fn) {
  try { await fn(); pass += 1; say(`  PASS  ${label}`); } catch (e) { fail += 1; say(`  FAIL  ${label}\n        ${e.message}`); }
}

// Distinctive, so a substring check on the raw body means something.
const NAMES = ['Ada-Lovelace-7', 'Grace-Hopper-7', 'Hedy-Lamarr-7', 'Katherine-Johnson-7', 'Mary-Jackson-7'];
const GONE = 'Dorothy-Vaughan-7'; // removed by the host: never counted as in the room
const BACKGROUND = 'PRIVATE-BACKGROUND-NOTE-7';
const QUEUED = 'c009#099';
const SET = 'set-room-view';

function seed(gameId, { state, round = 1, anonymous = true, revealed = false, answerers = 3, voters = 2 }) {
  const PK = `GAME#${gameId}`;
  table.put({
    PK, SK: 'METADATA', Title: 'Room view', HostName: 'Host', GameType: 'call-and-answer',
    QuestionSetId: SET, QuestionSetScope: 'platform', Target: 5,
    HostPreferences: { anonymousUntilReveal: anonymous },
    CreatedAt: '2026-10-12T09:00:00.000Z', Started: true,
  });
  table.put({ PK, SK: 'STATE', State: state, LessonNumber: round, CurrentQuestionId: 'q-1' });
  table.put({ PK, SK: 'QUEUE', Queue: [QUEUED], Version: 1 });
  for (const name of NAMES) {
    table.put({ PK, SK: `PLAYER#${name}`, PlayerName: name, JoinedAt: '2026-10-12T09:05:00.000Z' });
  }
  table.put({ PK, SK: `PLAYER#${GONE}`, PlayerName: GONE, JoinedAt: '2026-10-12T09:05:00.000Z', RemovedAt: '2026-10-12T09:06:00.000Z' });
  const padded = String(round).padStart(3, '0');
  NAMES.slice(0, answerers).forEach((name, i) => table.put({
    PK, SK: `QUESTION#${padded}#ANSWER#${name}`, PlayerName: name, Answer: `answer ${i} from the room`,
    SubmittedAt: `2026-10-12T09:1${i}:00.000Z`,
  }));
  NAMES.slice(0, voters).forEach((name) => table.put({
    PK, SK: `QUESTION#${padded}#VOTE#${name}`, VoterName: name, Votes: { 0: 1 },
  }));
  table.put({ PK, SK: `ROUND#${padded}`, QuestionNumber: padded, AuthorsRevealed: revealed });
  // The question the round is on, with a Background the room must not see on
  // this route and the set's own round noun, which it may.
  table.put({ PK, SK: `QUESTION#${padded}#REF`, SourceQuestionId: 'Q#1', SetId: SET, SetScope: 'platform' });
  table.put({ PK: 'SETS', SK: `SET#${SET}`, name: 'Room view set', roundNoun: 'Lesson', customInstruction: 'Name one structure to dismantle.' });
  table.put({ PK: `SET#${SET}`, SK: 'Q#1', Title: 'What should we stop doing', Detail: 'detail', Background: BACKGROUND });
}

const stateRead = async (gameId, query) => {
  const res = await getState({
    version: '2.0', routeKey: 'GET /games/{gameId}/state', rawPath: `/games/${gameId}/state`,
    pathParameters: { gameId }, ...(query ? { queryStringParameters: query } : {}),
    requestContext: { routeKey: 'GET /games/{gameId}/state', http: { method: 'GET' } },
  });
  return { status: res.statusCode, body: JSON.parse(res.body), raw: String(res.body) };
};

const answersRead = async (gameId, query) => {
  const res = await getAnswers({
    version: '2.0', routeKey: 'GET /games/{gameId}/answers', rawPath: `/games/${gameId}/answers`,
    pathParameters: { gameId }, ...(query ? { queryStringParameters: query } : {}),
    requestContext: { routeKey: 'GET /games/{gameId}/answers', http: { method: 'GET' } },
  });
  return { status: res.statusCode, body: JSON.parse(res.body), raw: String(res.body) };
};

const HOST_ONLY = ['questionQueue', 'categoryCounts', 'categoryState', 'answerProgress', 'votingProgress', 'target', 'presenting'];

(async () => {
  say('\n§1. /state?view=room: counts, and nothing from the host\'s door');
  for (const [gameId, state, answered, voted] of [['7101', 'ASK#001', 3, 2], ['7102', 'VOTE#001', 3, 2], ['7103', 'RESULTS#001', 3, 2]]) {
    seed(gameId, { state });
    const r = await stateRead(gameId, { view: 'room' });
    await check(`${state}: 200`, () => assert.strictEqual(r.status, 200, r.raw));
    await check(`${state}: roomCounts are integers, read across every page`, () =>
      assert.deepStrictEqual(r.body.roomCounts, { joined: NAMES.length, answered, voted }));
    await check(`${state}: a removed person is not in the room`, () => assert.strictEqual(r.body.roomCounts.joined, 5));
    await check(`${state}: no host-door field`, () => {
      const present = HOST_ONLY.filter((f) => Object.prototype.hasOwnProperty.call(r.body, f));
      assert.deepStrictEqual(present, []);
    });
    await check(`${state}: no answerer or voter list, by key or by value`, () => {
      assert.ok(!/answererIds|votersIds/.test(r.raw), 'an id list key is in the body');
      for (const name of [...NAMES, GONE]) assert.ok(!r.raw.includes(name), `the body names ${name}`);
    });
    await check(`${state}: no Background, no running order`, () => {
      assert.ok(!r.raw.includes(BACKGROUND), 'the Background is in the body');
      assert.ok(!r.raw.includes(QUEUED), 'the running order is in the body');
    });
  }
  seed('7104', { state: 'CREATED', round: 0, answerers: 0, voters: 0 });
  const lobby = await stateRead('7104', { view: 'room' });
  await check('the lobby counts who has joined, and nobody has answered', () =>
    assert.deepStrictEqual(lobby.body.roomCounts, { joined: 5, answered: 0, voted: 0 }));

  say('\n§2. without view=room the public body is unchanged, and the room view only adds roomCounts');
  seed('7105', { state: 'VOTE#001' });
  const plain = await stateRead('7105');
  const room = await stateRead('7105', { view: 'room' });
  await check('no roomCounts without the parameter', () => assert.strictEqual(plain.body.roomCounts, undefined));
  await check('the public body carries neither presentDetail nor hostNotes', () => {
    assert.strictEqual(plain.body.presentDetail, undefined);
    assert.strictEqual(plain.body.hostNotes, undefined);
  });
  await check('the room view is the public body plus roomCounts, key for key', () => {
    const { roomCounts, ...rest } = room.body;
    assert.ok(roomCounts);
    assert.deepStrictEqual(rest, plain.body);
  });
  await check('an unknown view is the plain body', async () => {
    const odd = await stateRead('7105', { view: 'host' });
    assert.deepStrictEqual(odd.body, plain.body);
  });
  await check('the set\'s own round noun travels with the question (the public get-question already gives it)', () =>
    assert.strictEqual(plain.body.currentQuestionData && plain.body.currentQuestionData.setRoundNoun, 'Lesson'));
  // Session 7924 finding #4: the wall left out the team's task. The set's own
  // instruction now rides with the question, as it does on get-question.
  await check('the set\'s own instruction travels with the question, for the wall\'s task line', () =>
    assert.strictEqual(plain.body.currentQuestionData && plain.body.currentQuestionData.setCustomInstruction, 'Name one structure to dismantle.'));
  await check('the stage facts are on the public read: notes, focus, profile', () => {
    assert.ok(plain.body.stageNotes && Number.isInteger(plain.body.stageNotes.page));
    assert.ok(plain.body.stageFocus && typeof plain.body.stageFocus.focus === 'string');
    assert.ok('stageProfile' in plain.body);
  });

  say('\n§3. /answers?view=room: during VOTE the answers, never their authors');
  seed('7201', { state: 'VOTE#001', anonymous: false });
  const named = await answersRead('7201');
  const namedRoom = await answersRead('7201', { view: 'room' });
  await check('without the parameter a named round still names its authors (unchanged)', () => {
    assert.strictEqual(named.status, 200, named.raw);
    assert.ok(named.body.answers.some((a) => a.playerName), 'the plain read lost its names');
  });
  await check('with view=room the same answers, in the same voting order', () =>
    assert.deepStrictEqual(namedRoom.body.answers.map((a) => a.answer), named.body.answers.map((a) => a.answer)));
  await check('with view=room no playerName, no name, no submittedAt — on a NAMED round', () => {
    for (const a of namedRoom.body.answers) {
      for (const k of ['playerName', 'name', 'submittedAt', 'PlayerName']) assert.ok(!(k in a), `an answer carries ${k}`);
    }
    for (const name of NAMES) assert.ok(!namedRoom.raw.includes(name), `the body names ${name}`);
  });
  seed('7202', { state: 'VOTE#001', anonymous: true });
  const anonRoom = await answersRead('7202', { view: 'room' });
  await check('an anonymous round in the room view: no authors either', () => {
    for (const name of NAMES) assert.ok(!anonRoom.raw.includes(name), `the body names ${name}`);
    assert.ok(anonRoom.body.answers.every((a) => !('submittedAt' in a)));
  });
  seed('7203', { state: 'ASK#001', anonymous: false });
  const asking = await answersRead('7203', { view: 'room' });
  await check('while the room answers, the room view is a count, as the public read always was', () => {
    assert.strictEqual(asking.body.answers, undefined);
    assert.strictEqual(asking.body.answerCount, 3);
  });
  seed('7204', { state: 'RESULTS#001', anonymous: false, revealed: true });
  const results = await answersRead('7204', { view: 'room' });
  await check('at RESULTS the room view is a count too: the tally is get-results\' to give', () => {
    assert.strictEqual(results.body.answers, undefined);
    for (const name of NAMES) assert.ok(!results.raw.includes(name));
  });
  seed('7205', { state: 'VOTE#001', anonymous: false });
  const asPlayer = await answersRead('7205', { view: 'room', player: NAMES[0] });
  await check('the room view never turns into one player\'s own-answer lookup', () => {
    assert.ok(Array.isArray(asPlayer.body.answers), asPlayer.raw);
    assert.ok(!asPlayer.raw.includes(NAMES[0]));
  });

  say(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail === 0 ? 0 : 1);
})();
