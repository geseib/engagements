/**
 * A POLL QUESTION IS A SURVEY QUESTION THE HOST ASKS (typed polls, 27 Sep
 * 2026; docs/design/survey-redesign/PLAN.md "Phase 6").
 *
 * The owner: "it should be a short instant feedback version of the survey
 * items … rate, pick from a few choices, binary (yes/no, approve/decline,
 * true/false) and open ended … the question is asked and the options are
 * registered on screen right away." Driven through the real handlers:
 *   get-question.js    sends the kind and its fields (options, labels, scale)
 *   websocket/message.js checks a typed answer with the survey's own rules,
 *                      stores readable text + the structured value (encrypted)
 *   get-answers.js     hands the host the live tally (the survey aggregate)
 *   get-results.js     closes the round with no vote and no points
 *   start-vote.js      refuses a poll
 *
 * rejects: a poll question reaching the phone with no options (the owner's
 * "didn't give options but open text box"); an answer that names no option
 * being stored and counted against nothing; a 0 on a 0–10 scale dropped as
 * falsy; a tally that carries a name; a poll round that runs a vote or scores
 * anyone; the structured value readable at rest; the websocket copies of the
 * contract drifting from game/'s.
 */
const suiteFinished = require('./helpers/finish-guard');
const path = require('path');
const fs = require('fs');
const assert = require('assert');

const REPO = path.join(__dirname, '..');
const { createTable, installStubs } = require('./helpers/player-table');

const kmsStubs = require('./helpers/tenant-crypto-stub');
const kms = kmsStubs.makeKmsStub();
for (const base of [REPO, path.join(REPO, 'lambda-functions'), path.join(REPO, 'lambda-functions', 'game'), path.join(REPO, 'lambda-functions', 'websocket')]) {
  let p;
  try { p = require.resolve('@aws-sdk/client-kms', { paths: [base] }); } catch { continue; }
  require.cache[p] = { id: p, filename: p, loaded: true, exports: kms.exports };
}

const table = createTable();
const sent = [];
installStubs({ table, sent });
process.env.TABLE_NAME = 'test-table';
process.env.WEBSOCKET_API_ENDPOINT = 'https://ws.test.invalid/dev';

const wsMessage = require(path.join(REPO, 'lambda-functions/websocket/message.js')).handler;
const { handler: getQuestion } = require(path.join(REPO, 'lambda-functions/game/get-question.js'));
const { handler: getAnswers } = require(path.join(REPO, 'lambda-functions/game/get-answers.js'));
const { handler: getResults } = require(path.join(REPO, 'lambda-functions/game/get-results.js'));
const { handler: startVote } = require(path.join(REPO, 'lambda-functions/websocket/start-vote.js'));
const C = require(path.join(REPO, 'lambda-functions/websocket/tenant-crypto.js'));
const GC = require(path.join(REPO, 'lambda-functions/game/tenant-crypto.js'));
kmsStubs.installTestKeyLoader();

let pass = 0; let fail = 0;
const check = async (label, fn) => {
  try { await fn(); console.log(`  PASS  ${label}`); pass += 1; } catch (e) { console.log(`  FAIL  ${label}\n        ${e.message}`); fail += 1; }
};
const put = (item) => table.store.set(table.keyOf(item.PK, item.SK), item);
const get = (pk, sk) => table.store.get(table.keyOf(pk, sk));

const ORG = 'org_acme';
const SET = 'how-we-work';
const META_PK = `ORG#${ORG}#SETS`;
const CONTENT_PK = `ORG#${ORG}#SET#${SET}#v1`;
const HOST = { lambda: { userId: 'u-1', groups: 'hosts', orgId: ORG, orgIds: ORG } };

/** A poll session on ASK#001, its question an org set's (encrypted at rest). */
async function seed(gameId, question, { gameType = 'poll', engagementType = 'poll' } = {}) {
  table.store.clear(); sent.length = 0;
  kmsStubs.forgetAllOrgs();
  const PK = `GAME#${gameId}`;
  put({ PK, SK: 'METADATA', GameType: gameType, Started: true, QuestionSetId: SET, QuestionSetScope: 'org', QuestionSetVersion: 1, orgId: ORG });
  put({ PK, SK: 'STATE', State: 'ASK#001', LessonNumber: 1, CurrentQuestionId: '001' });
  put({ PK, SK: 'CONNECTION#host-1', ConnectionId: 'host-1', ConnectionType: 'HOST' });
  put({ PK, SK: 'QUESTION#001#REF', SourceQuestionId: 'QUESTION#c001#001', SetId: SET, SetVersion: 1, SetScope: 'org', SetOrgId: ORG, StartedAt: new Date().toISOString() });
  put({ PK: META_PK, SK: `SET#${SET}`, engagementType, activeVersion: 1, versions: [{ version: 1 }] });
  put(await C.encryptItem(ORG, 'question', { PK: CONTENT_PK, SK: 'QUESTION#c001#001', Title: 'Best day to meet', Detail: 'In person, once a week.', Category: 'Work', ...question }));
}

async function answer(gameId, playerName, value) {
  await wsMessage({
    requestContext: { connectionId: `p-${playerName}` },
    body: JSON.stringify({ messageType: 'ANSWER#001', gameId, playerName, answer: value, answerType: 'poll' }),
  });
  return get(`GAME#${gameId}`, `QUESTION#001#ANSWER#${playerName}`);
}

const question = async (gameId) => JSON.parse((await getQuestion({ pathParameters: { gameId }, queryStringParameters: { role: 'player' } })).body);
const hostAnswers = async (gameId) => JSON.parse((await getAnswers({
  version: '2.0', routeKey: 'GET /games/{gameId}/answers/host', rawPath: `/games/${gameId}/answers/host`,
  pathParameters: { gameId }, queryStringParameters: { questionId: '001' },
  requestContext: { routeKey: 'GET /games/{gameId}/answers/host', http: { method: 'GET' }, authorizer: HOST },
})).body);
const closeRound = async (gameId) => {
  const r = await getResults({
    routeKey: 'POST /games/{gameId}/close-round', pathParameters: { gameId },
    requestContext: { routeKey: 'POST /games/{gameId}/close-round', http: { method: 'POST' }, authorizer: HOST },
    body: JSON.stringify({ questionNumber: 1 }),
  });
  return { status: r.statusCode, body: JSON.parse(r.body) };
};

const CHOICE = { kind: 'choice', options: ['Monday', 'Wednesday', 'Friday'], allowMultiple: false, allowOther: false };

(async () => {
  console.log('\n1. the phone is sent the question it will answer');
  await seed('5101', CHOICE);
  const q = await question('5101');
  await check('a choice poll reaches the phone with its options, decrypted', () => {
    assert.ok(q.poll, `no poll field: ${JSON.stringify(q).slice(0, 200)}`);
    assert.strictEqual(q.poll.kind, 'choice');
    assert.deepStrictEqual(q.poll.options, ['Monday', 'Wednesday', 'Friday']);
  });
  await check('…and nothing a phone does not draw (no rank, no survey-only fields)', () =>
    assert.deepStrictEqual(Object.keys(q.poll).sort(), ['allowMultiple', 'allowOther', 'kind', 'options', 'required', 'shuffle']));

  await seed('5102', { kind: 'yesno', yesLabel: 'Approve', noLabel: 'Decline', followUpWhen: 'any', followUpPrompt: 'Why?' });
  const yn = await question('5102');
  await check('a binary poll carries its own labels (approve/decline)', () => {
    assert.strictEqual(yn.poll.kind, 'yesno');
    assert.strictEqual(yn.poll.yesLabel, 'Approve');
    assert.strictEqual(yn.poll.noLabel, 'Decline');
  });

  await seed('5103', { options: ['Tea', 'Coffee'] });
  await check('a poll row from before kinds plays as the choice its options meant', async () =>
    assert.strictEqual((await question('5103')).poll.kind, 'choice'));
  await seed('5104', {});
  await check('…and one with no options as an open question, never a blank choice', async () =>
    assert.strictEqual((await question('5104')).poll.kind, 'text'));

  await seed('5105', CHOICE, { gameType: 'trivia', engagementType: 'trivia' });
  await check('a trivia round carries no poll field', async () => assert.ok(!('poll' in (await question('5105')))));

  console.log('\n2. a typed answer is checked, stored as words and as a value');
  await seed('5110', CHOICE);
  const ada = await answer('5110', 'Ada', [2]);
  await check('a valid pick is stored with readable text for every text reader', async () => {
    assert.ok(ada, 'no answer row');
    const open = await C.decryptItem(ORG, 'answer', ada);
    assert.strictEqual(open.Answer, 'Friday');
    assert.deepStrictEqual(open.PollValue, [2]);
    assert.strictEqual(ada.PollKind, 'choice');
    assert.strictEqual(ada.AnswerType, 'poll');
  });
  await check('the structured value is ciphertext at rest, like the text beside it', () => {
    assert.ok(ada.PollValue && typeof ada.PollValue === 'object', `PollValue at rest: ${JSON.stringify(ada.PollValue)}`);
    assert.ok(!Array.isArray(ada.PollValue), `PollValue is plaintext at rest: ${JSON.stringify(ada.PollValue)}`);
  });
  await check('an index that names no option is refused whole: nothing stored', async () =>
    assert.strictEqual(await answer('5110', 'Bob', [7]), undefined));
  await check('two picks on a pick-one question are refused', async () =>
    assert.strictEqual(await answer('5110', 'Cy', [0, 1]), undefined));

  await seed('5111', { kind: 'rating', scale: '0-10' });
  await check('a 0 on a 0–10 scale is an answer, not "no answer"', async () => {
    const row = await answer('5111', 'Ada', 0);
    assert.ok(row, 'the 0 was dropped as falsy');
    assert.strictEqual((await C.decryptItem(ORG, 'answer', row)).Answer, '0 / 10');
  });

  await seed('5112', { kind: 'yesno', yesLabel: 'Approve', noLabel: 'Decline', followUpWhen: 'any', followUpPrompt: 'Why?' });
  await check('a binary answer reads in its own labels, with its why', async () => {
    const row = await answer('5112', 'Ada', { v: 'yes', why: 'It is cheaper' });
    assert.strictEqual((await C.decryptItem(ORG, 'answer', row)).Answer, 'Approve — It is cheaper');
  });

  await seed('5113', CHOICE, { gameType: 'call-and-answer', engagementType: 'call-and-answer' });
  await check('a "poll" answer to a round that is not a poll\'s is refused', async () =>
    assert.strictEqual(await answer('5113', 'Ada', [0]), undefined));

  console.log('\n3. the host\'s live tally and the round\'s close');
  await seed('5120', CHOICE);
  await answer('5120', 'Ada', [2]);
  await answer('5120', 'Bob', [2]);
  await answer('5120', 'Cy', [0]);
  const live = await hostAnswers('5120');
  await check('the host door hands back the tally: counts per option', () => {
    assert.ok(live.poll, `no poll on the host answers: ${JSON.stringify(live).slice(0, 200)}`);
    assert.strictEqual(live.poll.tally.n, 3);
    assert.deepStrictEqual(live.poll.tally.counts, [1, 0, 2]);
  });
  await check('the tally carries no name', () =>
    assert.ok(!/Ada|Bob|\bCy\b/.test(JSON.stringify(live.poll)), JSON.stringify(live.poll)));

  const closed = await closeRound('5120');
  await check('closing the round: RESULTS, no vote, a poll payload with the final tally', () => {
    assert.strictEqual(closed.status, 200);
    assert.strictEqual(closed.body.gameType, 'poll');
    assert.deepStrictEqual(closed.body.poll.tally.counts, [1, 0, 2]);
    assert.strictEqual(get('GAME#5120', 'STATE').State, 'RESULTS#001');
  });
  await check('nobody is scored', () =>
    assert.ok(!['Ada', 'Bob', 'Cy'].some((n) => (get('GAME#5120', `PLAYER#${n}#SCORE`) || {}).score > 0)));
  await check('the RESULTS row keeps counts only — the open words stay in the encrypted answers', () => {
    const row = get('GAME#5120', 'QUESTION#001#RESULTS');
    assert.ok(row && row.PollCounts, 'no RESULTS row');
    assert.ok(!('texts' in row.PollCounts));
    assert.strictEqual(row.PollKind, 'choice');
  });

  await seed('5121', { kind: 'text', textLength: 'short', maxLength: 280 });
  await answer('5121', 'Ada', 'Tuesdays');
  await answer('5121', 'Bob', 'Fridays');
  await check('an open poll\'s answers come back as nameless texts, in no arrival order', async () => {
    const t = (await hostAnswers('5121')).poll.tally;
    assert.strictEqual(t.n, 2);
    assert.deepStrictEqual(t.texts.map((x) => x.text).sort(), ['Fridays', 'Tuesdays']);
    assert.ok(t.texts.every((x) => Object.keys(x).every((k) => ['id', 'text', 'v'].includes(k))));
  });

  console.log('\n4. a poll never votes');
  await seed('5130', CHOICE);
  const vote = await startVote({
    pathParameters: { gameId: '5130' }, body: JSON.stringify({ questionNumber: 1 }),
    requestContext: { http: { method: 'POST' }, authorizer: HOST },
  });
  await check('start-vote refuses a poll with 409 and leaves STATE on ASK', () => {
    assert.strictEqual(vote.statusCode, 409, vote.body);
    assert.strictEqual(get('GAME#5130', 'STATE').State, 'ASK#001');
  });

  console.log('\n5. the copies');
  const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8');
  for (const f of ['survey-kinds.js', 'csv.js', 'tags.js', 'survey-answer.js', 'poll-question.js']) {
    await check(`websocket/${f} is byte-identical to game/${f}`, () =>
      assert.strictEqual(read(`lambda-functions/websocket/${f}`), read(`lambda-functions/game/${f}`)));
  }
  await check('every tenant-crypto copy seals PollValue on an answer row', () => {
    for (const mod of [C, GC]) assert.ok(mod.ENCRYPTED_FIELDS.answer.includes('PollValue'));
  });

  console.log(`\n${pass} passed, ${fail} failed\n`);
  suiteFinished();
  if (fail) process.exit(1);
})();
