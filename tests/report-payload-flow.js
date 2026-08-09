/**
 * Game-report payload regression tests — lambda-functions/game/create-report.js
 * and the host projection in lambda-functions/game/get-report.js.
 *
 * Runs the REAL handlers against a stubbed DynamoDB document client, so these
 * exercise the actual question-list union, the actual questionData projection
 * and the actual whitelist in get-report.js rather than a reimplementation.
 *
 * Stubbing follows tests/edit-question-set-flow.js: hook Module._load BY MODULE
 * NAME, because several @aws-sdk packages exist only in the deployed bundle and
 * cannot be resolved from the repo root.
 *
 * What these tests pin down:
 *   - D12: a round with an AISummary but NO votes and NO RESULTS record still
 *     reaches the report, carrying its Field Notes (it used to be dropped, and
 *     the Workie output with it)
 *   - `image` and `school` reach questionData, so an art round can be labelled
 *     "Artwork" (resolveRoundNoun reads `q.image || q.Image`)
 *   - the per-set `roundNoun` override reaches the report top level, where
 *     GameHostPage reads it as reportData.roundNoun — and survives get-report's
 *     explicit host whitelist
 *   - persona attribution passes through when the AISummary item carries it,
 *     and is absent-safe on summaries written before the resolver stamped it
 *   - a normal voted round is byte-for-byte unchanged: ranks, tallies, winners
 */
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');

// ---- Stub the AWS SDK before any handler loads -----------------------------
const Module = require('module');
const stubs = new Map();
const realLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (stubs.has(request)) return stubs.get(request);
  return realLoad.call(this, request, parent, isMain);
};
function stub(name, exports) { stubs.set(name, exports); }

class GetCommand { constructor(i) { this.input = i; this.type = 'get'; } }
class PutCommand { constructor(i) { this.input = i; this.type = 'put'; } }
class DeleteCommand { constructor(i) { this.input = i; this.type = 'delete'; } }
class QueryCommand { constructor(i) { this.input = i; this.type = 'query'; } }
class ScanCommand { constructor(i) { this.input = i; this.type = 'scan'; } }
class UpdateCommand { constructor(i) { this.input = i; this.type = 'update'; } }
class BatchWriteCommand { constructor(i) { this.input = i; this.type = 'batchWrite'; } }

const TABLE = 'test-table';

const store = new Map();        // "PK|SK" -> Item
const k = (pk, sk) => `${pk}|${sk}`;
const put = (item) => store.set(k(item.PK, item.SK), item);
function resetDb() { store.clear(); }

const fakeDoc = {
  send: async (cmd) => {
    const inp = cmd.input || {};

    if (cmd.type === 'get') return { Item: store.get(k(inp.Key.PK, inp.Key.SK)) };
    if (cmd.type === 'put') { put(inp.Item); return {}; }
    if (cmd.type === 'delete') { store.delete(k(inp.Key.PK, inp.Key.SK)); return {}; }

    if (cmd.type === 'query') {
      const v = inp.ExpressionAttributeValues || {};
      const pk = v[':pk'];
      const prefix = v[':sk'] ?? '';
      const items = [...store.values()]
        .filter((i) => i.PK === pk && String(i.SK).startsWith(String(prefix)));
      return { Items: items, Count: items.length };
    }

    return { Items: [], Count: 0 };
  },
};

stub('@aws-sdk/client-dynamodb', { DynamoDBClient: class {} });
stub('@aws-sdk/lib-dynamodb', {
  DynamoDBDocumentClient: { from: () => fakeDoc },
  GetCommand, PutCommand, DeleteCommand, QueryCommand,
  ScanCommand, UpdateCommand, BatchWriteCommand,
});

process.env.TABLE_NAME = TABLE;

const createReport = require(path.join(REPO, 'lambda-functions', 'game', 'create-report.js')).handler;
const getReport = require(path.join(REPO, 'lambda-functions', 'game', 'get-report.js')).handler;

// Silence the handlers' very chatty logging unless DEBUG=1.
if (!process.env.DEBUG) { console.log = () => {}; console.warn = () => {}; }
const say = (...a) => process.stdout.write(a.join(' ') + '\n');

let pass = 0, fail = 0;
function check(label, fn) {
  try { fn(); say(`  PASS  ${label}`); pass++; }
  catch (e) { say(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

const GAME = '1234';
const SET = 'retro';

const build = () => createReport({ pathParameters: { gameId: GAME } });
const parse = (res) => JSON.parse(res.body);
const questionOf = (report, n) => report.detailedQuestions.find((q) => q.questionNumber === n);

// ---- Seed helpers ----------------------------------------------------------
// Set metadata lives at SETS / SET#{id} (the format edit-question-set.js writes
// and get-question-sets.js reads); questions live at SET#{id} / QUESTION#nnn.
function seedGame({ setId = SET, setMeta = {}, gameType = 'call-and-answer' } = {}) {
  put({
    PK: `GAME#${GAME}`, SK: 'METADATA', GameId: GAME,
    Title: 'Retro Night', GameType: gameType, QuestionSetId: setId,
    HostName: 'Ada',
    CreatedAt: '2026-08-01T00:00:00.000Z',
  });
  put({
    PK: `GAME#${GAME}`, SK: 'STATE', State: 'RESULTS#002', LessonNumber: 2,
    StartedAt: '2026-08-01T00:05:00.000Z',
  });
  put({
    PK: 'SETS', SK: `SET#${setId}`,
    name: 'Retro Set', description: 'A description', category: 'Leadership',
    customInstruction: 'Answer in one line',
    ...setMeta,
  });
}

function seedPlayer(name) {
  put({ PK: `GAME#${GAME}`, SK: `PLAYER#${name}`, PlayerName: name, JoinedAt: '2026-08-01T00:06:00.000Z' });
  put({ PK: `GAME#${GAME}`, SK: `PLAYER#${name}#SCORE`, PlayerName: name, score: 0, afterRound: 1 });
}

function seedQuestion(setId, sk, attrs) {
  put({ PK: `SET#${setId}`, SK: sk, ...attrs });
}

const seedRef = (n, sourceQuestionId) =>
  put({ PK: `GAME#${GAME}`, SK: `QUESTION#${n}#REF`, SourceQuestionId: sourceQuestionId, SetId: SET });

const seedResults = (n, sourceQuestionId, extra = {}) => {
  put({
    PK: `GAME#${GAME}`, SK: `QUESTION#${n}#RESULTS`,
    SourceQuestionId: sourceQuestionId,
    ProcessedAt: '2026-08-01T00:20:00.000Z',
    CompletedAt: '2026-08-01T00:21:00.000Z',
    ...extra,
  });
  // The ROUND# record enterResultsState writes in the SAME call that writes the
  // RESULTS record above (get-results.js). Seeding one without the other
  // described a state production never produces — a round that finished but was
  // never revealed — which the report now correctly declines to attribute.
  // These fixtures are about tally and winner computation, so they need the
  // round in the state a finished round is actually in.
  put({
    PK: `GAME#${GAME}`, SK: `ROUND#${n}`,
    QuestionNumber: n, AuthorsRevealed: true,
    UpdatedAt: '2026-08-01T00:20:00.000Z',
  });
};

const seedAnswer = (n, player, text) =>
  put({ PK: `GAME#${GAME}`, SK: `QUESTION#${n}#ANSWER#${player}`, PlayerName: player, Answer: text });

const seedVote = (n, player, votes) =>
  put({ PK: `GAME#${GAME}`, SK: `QUESTION#${n}#VOTE#${player}`, PlayerName: player, Votes: votes });

const seedAISummary = (n, extra = {}) =>
  put({
    PK: `GAME#${GAME}`, SK: `QUESTION#${n}#AISummary`,
    SummaryText: `Field notes for round ${n}`,
    DiscussionQuestions: [`What stood out in round ${n}?`],
    NextSteps: ['Try it next sprint'],
    MarkdownResponse: `## Round ${n}`,
    GeneratedAt: '2026-08-01T00:22:00.000Z',
    ...extra,
  });

(async () => {
  // ===========================================================================
  say('\n1. D12: a round with an AISummary but NO votes and NO RESULTS still reports');
  // ===========================================================================
  resetDb();
  seedGame();
  seedPlayer('alice');
  seedPlayer('bob');

  seedQuestion(SET, 'QUESTION#001', { Title: 'What went well', Detail: 'Round one', Category: 'Retro' });
  seedQuestion(SET, 'QUESTION#002', { Title: 'What to change', Detail: 'Round two', Category: 'Retro' });

  // Round 1: the ordinary path — results, answers, votes, summary.
  seedRef('001', 'QUESTION#001');
  seedResults('001', 'QUESTION#001', { Winners: ['alice'] });
  seedAnswer('001', 'alice', 'Shipped early');
  seedAnswer('001', 'bob', 'Fewer meetings');
  seedVote('001', 'alice', { 1: 1 });
  seedVote('001', 'bob', { 0: 1, 1: 2 });
  seedAISummary('001');

  // Round 2: the host ended the game mid-question. Workie already ran, but no
  // vote was ever cast and get-results never wrote a RESULTS record.
  seedRef('002', 'QUESTION#002');
  seedAISummary('002');

  let res = await build();
  check('create-report returns 200', () =>
    assert.strictEqual(res.statusCode, 200, `got ${res.statusCode}: ${res.body}`));

  let report = parse(res).report;
  check('both rounds are in the report', () =>
    assert.deepStrictEqual(report.detailedQuestions.map((q) => q.questionNumber), ['001', '002']));

  const orphan = questionOf(report, '002');
  check('the orphaned round carries its Field Notes', () =>
    assert.strictEqual(orphan.aiSummary.summaryText, 'Field notes for round 002'));
  check('...and its discussion questions', () =>
    assert.deepStrictEqual(orphan.aiSummary.discussionQuestions, ['What stood out in round 002?']));
  check('...and its markdown body', () =>
    assert.strictEqual(orphan.aiSummary.markdownResponse, '## Round 002'));
  check('the QUESTION#nnn#REF fallback resolved the question title', () =>
    assert.strictEqual(orphan.questionData.title, 'What to change'));
  check('an answerless round reports maxScore 0, not null (-Infinity)', () =>
    assert.strictEqual(orphan.voteStats.maxScore, 0));
  check('an answerless round reports no answers', () =>
    assert.deepStrictEqual(orphan.answers, []));

  // ===========================================================================
  say('\n2. Regression: the normal voted round is unchanged');
  // ===========================================================================
  const voted = questionOf(report, '001');
  check('title/detail/category still projected', () =>
    assert.deepStrictEqual(
      { t: voted.questionData.title, d: voted.questionData.detail, c: voted.questionData.category },
      { t: 'What went well', d: 'Round one', c: 'Retro' }));
  check('both answers ranked', () => assert.strictEqual(voted.answers.length, 2));
  check("bob's answer wins on 1 first + 1 second (3+2)", () =>
    assert.deepStrictEqual(
      voted.answers.map((a) => [a.playerName, a.totalScore, a.rank]),
      [['bob', 5, 1], ['alice', 3, 2]]));
  check('rankDisplay preserved', () =>
    assert.strictEqual(voted.answers[0].rankDisplay, '🥇 1st Place'));
  check('voteStats intact', () =>
    assert.deepStrictEqual(voted.voteStats, {
      totalAnswers: 2, totalVotes: 2, maxScore: 5, averageScore: 4,
    }));
  check('results metadata still carried', () =>
    assert.strictEqual(voted.processedAt, '2026-08-01T00:20:00.000Z'));
  check('legacy questionSummaries still built for both rounds', () =>
    assert.strictEqual(report.questionSummaries.length, 2));
  check('legacy winners still computed', () =>
    assert.deepStrictEqual(report.questionSummaries[0].winners, ['bob']));
  check('gameTitle reads the Title attribute that is actually written', () =>
    assert.strictEqual(report.gameTitle, 'Retro Night'));

  // ===========================================================================
  say('\n3. Art rounds: image and school reach the report payload');
  // ===========================================================================
  resetDb();
  seedGame();
  seedPlayer('alice');
  seedQuestion(SET, 'QUESTION#001', {
    Title: 'Name this painting',
    Category: 'Art',
    Image: 'https://example.test/starry-night.jpg',
    School: 'Vincent van Gogh',
  });
  seedRef('001', 'QUESTION#001');
  seedResults('001', 'QUESTION#001');
  seedAnswer('001', 'alice', 'The Starry Night');
  seedVote('001', 'alice', { 0: 1 });

  report = parse(await build()).report;
  const art = questionOf(report, '001');
  check('image reaches questionData', () =>
    assert.strictEqual(art.questionData.image, 'https://example.test/starry-night.jpg'));
  check('school (artist credit) reaches questionData', () =>
    assert.strictEqual(art.questionData.school, 'Vincent van Gogh'));
  // This is exactly the predicate resolveRoundNoun() applies to decide "Artwork".
  check('resolveRoundNoun would see a non-empty image', () =>
    assert.ok((art.questionData.image || art.questionData.Image || '').trim().length > 0));

  say('\n   a non-art round must not sprout a bogus image');
  resetDb();
  seedGame();
  seedPlayer('alice');
  seedQuestion(SET, 'QUESTION#001', { Title: 'What went well', Category: 'Retro' });
  seedRef('001', 'QUESTION#001');
  seedResults('001', 'QUESTION#001');
  seedAnswer('001', 'alice', 'Shipped early');
  seedVote('001', 'alice', { 0: 1 });

  report = parse(await build()).report;
  check('image is null for a question with no Image', () =>
    assert.strictEqual(questionOf(report, '001').questionData.image, null));
  check('resolveRoundNoun would NOT see an image', () => {
    const q = questionOf(report, '001').questionData;
    assert.strictEqual((q.image || q.Image || '').trim(), '');
  });

  // ===========================================================================
  say('\n4. The per-set roundNoun override reaches the report');
  // ===========================================================================
  resetDb();
  seedGame({ setMeta: { roundNoun: 'Artwork' } });
  seedPlayer('alice');
  seedQuestion(SET, 'QUESTION#001', { Title: 'Name this painting', Category: 'Art' });
  seedRef('001', 'QUESTION#001');
  seedResults('001', 'QUESTION#001');
  seedAnswer('001', 'alice', 'The Starry Night');
  seedVote('001', 'alice', { 0: 1 });

  report = parse(await build()).report;
  check('roundNoun sits at the report top level (reportData.roundNoun)', () =>
    assert.strictEqual(report.roundNoun, 'Artwork'));
  check('...and on the questionSetData block', () =>
    assert.strictEqual(report.questionSetData.roundNoun, 'Artwork'));
  check('customInstruction still projected alongside it', () =>
    assert.strictEqual(report.questionSetData.customInstruction, 'Answer in one line'));

  say('\n   get-report is an explicit whitelist — it must name roundNoun too');
  let hostRes = await getReport({ pathParameters: { gameId: GAME }, queryStringParameters: { role: 'host' } });
  check('get-report returns 200', () =>
    assert.strictEqual(hostRes.statusCode, 200, `got ${hostRes.statusCode}: ${hostRes.body}`));
  check('the host projection carries roundNoun', () =>
    assert.strictEqual(parse(hostRes).roundNoun, 'Artwork'));
  check('the host projection still carries detailedQuestions', () =>
    assert.strictEqual(parse(hostRes).detailedQuestions.length, 1));

  say('\n   a set with no override reports null, not undefined');
  resetDb();
  seedGame();
  seedPlayer('alice');
  seedQuestion(SET, 'QUESTION#001', { Title: 'What went well' });
  seedRef('001', 'QUESTION#001');
  seedResults('001', 'QUESTION#001');
  seedAnswer('001', 'alice', 'Shipped early');
  seedVote('001', 'alice', { 0: 1 });

  report = parse(await build()).report;
  check('roundNoun is null when the set does not override it', () =>
    assert.strictEqual(report.roundNoun, null));
  hostRes = await getReport({ pathParameters: { gameId: GAME }, queryStringParameters: { role: 'host' } });
  check('get-report reports null too', () =>
    assert.strictEqual(parse(hostRes).roundNoun, null));

  // ===========================================================================
  say('\n5. Persona attribution passes through, and is absent-safe');
  // ===========================================================================
  resetDb();
  seedGame();
  seedPlayer('alice');
  seedQuestion(SET, 'QUESTION#001', { Title: 'Round one' });
  seedQuestion(SET, 'QUESTION#002', { Title: 'Round two' });
  seedRef('001', 'QUESTION#001');
  seedRef('002', 'QUESTION#002');
  seedResults('001', 'QUESTION#001');
  seedResults('002', 'QUESTION#002');
  seedAnswer('001', 'alice', 'Shipped early');
  seedVote('001', 'alice', { 0: 1 });
  seedAnswer('002', 'alice', 'Fewer meetings');
  seedVote('002', 'alice', { 0: 1 });

  // Round 1: stamped by the persona resolver.
  seedAISummary('001', { PersonaName: 'The Sports Commentator', PersonaId: 'sports-commentator' });
  // Round 2: written before the resolver stamped anything.
  seedAISummary('002');

  report = parse(await build()).report;
  check('personaName passes through', () =>
    assert.strictEqual(questionOf(report, '001').aiSummary.personaName, 'The Sports Commentator'));
  check('personaId passes through', () =>
    assert.strictEqual(questionOf(report, '001').aiSummary.personaId, 'sports-commentator'));
  check('an unstamped legacy summary reports null, and does not throw', () =>
    assert.strictEqual(questionOf(report, '002').aiSummary.personaName, null));
  check('...and its summary text is still intact', () =>
    assert.strictEqual(questionOf(report, '002').aiSummary.summaryText, 'Field notes for round 002'));

  say('\n   lower-case spellings are accepted too');
  resetDb();
  seedGame();
  seedPlayer('alice');
  seedQuestion(SET, 'QUESTION#001', { Title: 'Round one' });
  seedRef('001', 'QUESTION#001');
  seedResults('001', 'QUESTION#001');
  seedAnswer('001', 'alice', 'Shipped early');
  seedVote('001', 'alice', { 0: 1 });
  seedAISummary('001', { personaName: 'The Coach', personaId: 'coach' });

  report = parse(await build()).report;
  check('personaName read from the lower-case attribute', () =>
    assert.strictEqual(questionOf(report, '001').aiSummary.personaName, 'The Coach'));
  check('personaId read from the lower-case attribute', () =>
    assert.strictEqual(questionOf(report, '001').aiSummary.personaId, 'coach'));

  say(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('harness error:', e); process.exit(2); });
