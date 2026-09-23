/**
 * THE REPORT OUTLIVES THE ROWS IT IS BUILT FROM — and must not pretend otherwise.
 *
 * `create-report.js` rebuilds a session report from the live table on every
 * call. The rows it reads do not all live the same length of time:
 *
 *   24 hours   QUESTION#nnn#REF                 next-question.js:1123
 *    7 days    QUESTION#nnn#ANSWER#{player}     websocket/message.js:374
 *    7 days    QUESTION#nnn#VOTE#{player}       game/submit-vote.js:66
 *    7 days    PLAYER#{name}                    join-game.js:338
 *    7 days    QUESTION#nnn#RESULTS (wavelength) get-results.js:1128
 *   30 days    QUESTION#nnn#RESULTS (voted)     get-results.js:632
 *   30 days    PLAYER#{name}#SCORE              join-game.js:362
 *   30 days    QUESTION#nnn#AISummary           get-ai-summary.js:1203
 *   30 days    GAME#{id} / REPORT               create-report.js:728
 *   90 days    GAME#{id} / METADATA and STATE   schema-compliant-manager.js
 *
 * So from about day 8 the participants are gone from the table while the
 * session, its AI summaries and its results are still there. A rebuild at that
 * point returns 200 with `totalAnswers: 0` and every `answers` array empty: a
 * report that looks like a session nobody attended.
 *
 * ── THE PART THAT IS WORSE THAN A BAD RESPONSE ─────────────────────────────
 *
 * `create-report.js` already writes a REPORT snapshot as its last act, and it
 * has always overwritten it unconditionally. So the hollow day-8 rebuild does
 * not merely fail to show the answers — it REPLACES the good snapshot taken on
 * the day of the session, and stamps a fresh 30-day TTL on the hollow one. The
 * retro is not hidden, it is destroyed, and it is destroyed by the act of
 * opening it. GameHostPage's Rounds tab POSTs this route on every round
 * advance and from the history list, so it fires without anyone asking for a
 * report at all.
 *
 * ── THE RULE THESE TESTS PIN ───────────────────────────────────────────────
 *
 * A regenerated report is NEVER less complete than the one already stored.
 * Where the live table can still answer, it wins — a summary regenerated today
 * is today's. Where it has gone silent and the snapshot remembers, the
 * snapshot wins. And where neither has anything, the report SAYS SO rather
 * than returning a plausible-looking empty one.
 *
 * TTL expiry is modelled by deleting the rows, which is what DynamoDB does.
 *
 * Stub preamble follows tests/report-payload-flow.js; the KMS helpers come from
 * tests/helpers/tenant-crypto-stub.js so the org path — where the stored
 * snapshot is an envelope and merging it means decrypting it first — is
 * exercised rather than assumed.
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

const { makeKmsStub, installTestKeyLoader, plainRow } = require('./helpers/tenant-crypto-stub');
stub('@aws-sdk/client-kms', makeKmsStub().exports);
installTestKeyLoader();
stub('@aws-sdk/client-dynamodb', { DynamoDBClient: class {} });
stub('@aws-sdk/lib-dynamodb', {
  DynamoDBDocumentClient: { from: () => fakeDoc },
  GetCommand, PutCommand, DeleteCommand, QueryCommand,
  ScanCommand, UpdateCommand, BatchWriteCommand,
});

process.env.TABLE_NAME = TABLE;

const createReport = require(path.join(REPO, 'lambda-functions', 'game', 'create-report.js')).handler;
const getReport = require(path.join(REPO, 'lambda-functions', 'game', 'get-report.js')).handler;

if (!process.env.DEBUG) { console.log = () => {}; console.warn = () => {}; }
const say = (...a) => process.stdout.write(a.join(' ') + '\n');

let pass = 0, fail = 0;
function check(label, fn) {
  try { fn(); say(`  PASS  ${label}`); pass++; }
  catch (e) { say(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

const GAME = '1234';
const SET = 'retro';

const build = (gameId = GAME) => createReport({ pathParameters: { gameId } });
const reportOf = async (gameId = GAME) => JSON.parse((await build(gameId)).body).report;
const roundOf = (report, n) => (report.detailedQuestions || []).find((q) => q.questionNumber === n);
const storedReport = (gameId = GAME) => store.get(k(`GAME#${gameId}`, 'REPORT'));

/**
 * What DynamoDB's TTL sweeper does, in one line: the row is simply gone. No
 * event, no tombstone, and nothing in the table records that it was ever there.
 */
function expire(gameId, matches) {
  for (const [key, item] of [...store.entries()]) {
    if (item.PK === `GAME#${gameId}` && matches(String(item.SK))) store.delete(key);
  }
}
/** Day 8: the participants and their ballots are gone; the session is not. */
const expireSevenDayRows = (gameId = GAME) => expire(gameId, (sk) =>
  sk.includes('#ANSWER#') || sk.includes('#VOTE#') || (sk.startsWith('PLAYER#') && !sk.endsWith('#SCORE')));
/** Day 31: the results, the scores and the AI summaries follow. */
const expireThirtyDayRows = (gameId = GAME) => expire(gameId, (sk) =>
  sk.includes('#RESULTS') || sk.endsWith('#SCORE') || sk.includes('#AISummary'));

// ---- Seed helpers (shapes copied from tests/report-payload-flow.js) ---------
function seedGame({ gameId = GAME, orgId = null, gameType = 'call-and-answer' } = {}) {
  put({
    PK: `GAME#${gameId}`, SK: 'METADATA', GameId: gameId,
    Title: 'Retro Night', GameType: gameType, QuestionSetId: SET, HostName: 'Ada',
    CreatedAt: '2026-08-01T00:00:00.000Z',
    ...(orgId ? { orgId } : {}),
  });
  put({
    PK: `GAME#${gameId}`, SK: 'STATE', State: 'RESULTS#002', LessonNumber: 2,
    StartedAt: '2026-08-01T00:05:00.000Z',
  });
  put({
    PK: 'SETS', SK: `SET#${SET}`,
    name: 'Retro Set', description: 'A description', category: 'Leadership',
  });
}

function seedPlayer(name, gameId = GAME, score = 0) {
  put({ PK: `GAME#${gameId}`, SK: `PLAYER#${name}`, PlayerName: name, JoinedAt: '2026-08-01T00:06:00.000Z' });
  put({ PK: `GAME#${gameId}`, SK: `PLAYER#${name}#SCORE`, PlayerName: name, score, afterRound: '001' });
}

/** A round the room finished and the host revealed. */
function seedRound(n, { gameId = GAME, withResults = true, withAI = true } = {}) {
  put({
    PK: `GAME#${gameId}`, SK: `ROUND#${n}`,
    QuestionNumber: n, AuthorsRevealed: true, UpdatedAt: '2026-08-01T00:20:00.000Z',
  });
  if (withResults) {
    put({
      PK: `GAME#${gameId}`, SK: `QUESTION#${n}#RESULTS`,
      SourceQuestionId: `QUESTION#${n}`, Winners: ['Ada'],
      ProcessedAt: '2026-08-01T00:20:00.000Z', CompletedAt: '2026-08-01T00:21:00.000Z',
    });
  }
  if (withAI) {
    put({
      PK: `GAME#${gameId}`, SK: `QUESTION#${n}#AISummary`,
      SummaryText: `Field notes for round ${n}`,
      DiscussionQuestions: [`What stood out in round ${n}?`],
      NextSteps: ['Try it next sprint'],
      GeneratedAt: '2026-08-01T00:22:00.000Z',
    });
  }
  put({ PK: `SET#${SET}`, SK: `QUESTION#${n}`, Title: `Round ${n} question`, Detail: 'Say more', Category: 'Team' });
}

const seedAnswer = (n, player, text, gameId = GAME) =>
  put({ PK: `GAME#${gameId}`, SK: `QUESTION#${n}#ANSWER#${player}`, PlayerName: player, Answer: text });

const seedVote = (n, voter, votes, gameId = GAME) =>
  put({ PK: `GAME#${gameId}`, SK: `QUESTION#${n}#VOTE#${voter}`, VoterName: voter, Votes: votes });

/**
 * The session as it stood on the night: two players, round 001 fully finished,
 * round 002 answered and voted but never closed (no RESULTS, no summary) —
 * which is the round that vanishes ENTIRELY once the votes expire, because
 * `questionNumbers` is built from votes ∪ results ∪ summaries.
 */
function seedFinishedSession({ gameId = GAME, orgId = null } = {}) {
  seedGame({ gameId, orgId });
  seedPlayer('Ada', gameId, 5);
  seedPlayer('Grace', gameId, 3);
  seedRound('001', { gameId });
  seedAnswer('001', 'Ada', 'We shipped the thing', gameId);
  seedAnswer('001', 'Grace', 'Standups ran long', gameId);
  seedVote('001', 'Ada', { 1: 1 }, gameId);
  seedVote('001', 'Grace', { 0: 1 }, gameId);
  seedRound('002', { gameId, withResults: false, withAI: false });
  seedAnswer('002', 'Ada', 'More pairing next time', gameId);
  seedVote('002', 'Grace', { 0: 1 }, gameId);
}

(async () => {
  // ===========================================================================
  say('\n1. A report regenerated after the answer rows expire still has the answers');
  // ===========================================================================
  resetDb();
  seedFinishedSession();

  const onTheNight = await reportOf();
  check('the live report has both rounds', () => {
    assert.strictEqual(onTheNight.detailedQuestions.length, 2);
  });
  check('the live report counts three answers', () => {
    assert.strictEqual(onTheNight.gameStats.totalAnswers, 3);
  });

  expireSevenDayRows();
  const threeWeeksLater = await reportOf();

  check('round 001 still quotes what the room said', () => {
    const texts = (roundOf(threeWeeksLater, '001').answers || []).map((a) => a.answerText).sort();
    assert.deepStrictEqual(texts, ['Standups ran long', 'We shipped the thing']);
  });
  check('round 001 keeps its attribution', () => {
    const names = (roundOf(threeWeeksLater, '001').answers || []).map((a) => a.playerName).sort();
    assert.deepStrictEqual(names, ['Ada', 'Grace']);
  });
  check('the front page does not read "0 answers"', () => {
    assert.strictEqual(threeWeeksLater.gameStats.totalAnswers, 3);
  });
  check('the leaderboard is still there', () => {
    assert.deepStrictEqual(
      threeWeeksLater.playerPerformance.map((p) => p.playerName).sort(), ['Ada', 'Grace']
    );
  });
  check('the round that only ever had votes has not vanished', () => {
    const r = roundOf(threeWeeksLater, '002');
    assert.ok(r, 'round 002 is absent from the report entirely');
    assert.strictEqual((r.answers || []).length, 1);
  });
  check('the round count is still two', () => {
    assert.strictEqual(threeWeeksLater.detailedQuestions.length, 2);
  });

  // ===========================================================================
  say('\n2. The hollow rebuild does not overwrite the good snapshot');
  // ===========================================================================
  check('the stored REPORT row still holds the answers', () => {
    const row = storedReport();
    assert.ok(row, 'no REPORT row was stored at all');
    assert.strictEqual(row.gameStats.totalAnswers, 3);
  });
  check('the stored REPORT row still holds both rounds', () => {
    assert.strictEqual(storedReport().detailedQuestions.length, 2);
  });

  // ===========================================================================
  say('\n3. The live table still wins wherever it can answer');
  // ===========================================================================
  // A host who regenerates a summary three weeks on must read the NEW one, not
  // the snapshot's. Recovery is a floor under the report, not a freeze on it.
  put({
    PK: `GAME#${GAME}`, SK: 'QUESTION#001#AISummary',
    SummaryText: 'Regenerated field notes', DiscussionQuestions: ['And now?'],
    NextSteps: ['Ship it'], GeneratedAt: '2026-08-22T09:00:00.000Z',
  });
  const regenerated = await reportOf();
  check('the newly generated summary is the one that shows', () => {
    assert.strictEqual(roundOf(regenerated, '001').aiSummary.summaryText, 'Regenerated field notes');
  });
  check('and the recovered answers are still beside it', () => {
    assert.strictEqual(roundOf(regenerated, '001').answers.length, 2);
  });

  // ===========================================================================
  say('\n4. A report that cannot be reconstructed says so');
  // ===========================================================================
  resetDb();
  seedFinishedSession();
  // Never reported on within seven days: there is no snapshot to fall back to.
  expireSevenDayRows();
  const noSnapshot = await reportOf();

  check('it does not claim to be complete', () => {
    assert.ok(noSnapshot.reportCompleteness, 'reportCompleteness is absent from the report');
    assert.strictEqual(noSnapshot.reportCompleteness.complete, false);
  });
  check('it names the round whose answers are gone', () => {
    assert.deepStrictEqual(noSnapshot.reportCompleteness.unrecoverableRounds, ['001']);
  });
  check('it carries a sentence a human can read', () => {
    assert.match(String(noSnapshot.reportCompleteness.note || ''), /expired/i);
  });

  // ===========================================================================
  say('\n5. A live session says it is complete, and is otherwise untouched');
  // ===========================================================================
  resetDb();
  seedFinishedSession();
  const live = await reportOf();

  check('a report with nothing missing reports itself complete', () => {
    assert.strictEqual(live.reportCompleteness.complete, true);
    assert.deepStrictEqual(live.reportCompleteness.recoveredRounds, []);
    assert.deepStrictEqual(live.reportCompleteness.unrecoverableRounds, []);
  });
  check('regenerating it changes nothing at all', () => {
    // The live path must stay byte-identical to what it produced before any of
    // this existed — everything above is confined to the degraded path.
    const again = live;
    assert.strictEqual(again.gameStats.totalAnswers, 3);
    assert.strictEqual(again.detailedQuestions.length, 2);
  });

  const secondPass = await reportOf();
  check('a second identical build is byte-for-byte the same report', () => {
    // Two timestamps are expected to move and neither is content. The second
    // is the subtle one: the FIRST build of a session finds no snapshot, so it
    // reports `snapshotTakenAt: null`; the second finds the one the first just
    // wrote. Both are true statements about the build that made them.
    const strip = (r) => {
      const { reportGeneratedAt, reportCompleteness, ...rest } = r;
      const { snapshotTakenAt, ...completeness } = reportCompleteness;
      return { ...rest, reportCompleteness: completeness };
    };
    assert.deepStrictEqual(strip(secondPass), strip(live));
  });

  // ===========================================================================
  say('\n6. The host projection lets the completeness through');
  // ===========================================================================
  // Rule 3 of the public-library handoff: get-report.js projects an explicit
  // whitelist, so storing a field faithfully still shows the client nothing.
  resetDb();
  seedFinishedSession();
  await build();
  expireSevenDayRows();
  await build();
  const hostView = JSON.parse((await getReport({
    // A signed-in host: the route carries the Cognito authorizer since 2026-09-23.
    requestContext: { authorizer: { lambda: { userId: 'host-1', groups: 'hosts' } } },
    pathParameters: { gameId: GAME }, queryStringParameters: { role: 'host' },
  })).body);

  check('GET /report?role=host carries reportCompleteness', () => {
    assert.ok(hostView.reportCompleteness, 'the host whitelist drops reportCompleteness');
  });
  check('and the recovered answers survive the projection', () => {
    assert.strictEqual(
      (hostView.detailedQuestions.find((q) => q.questionNumber === '001').answers || []).length, 2
    );
  });

  // ===========================================================================
  say("\n7. An organisation's snapshot is decrypted before it is merged");
  // ===========================================================================
  // The stored REPORT row is an envelope for an org session. Merging it without
  // decrypting first would splice ciphertext into the answers — the failure
  // that looks like data and is not.
  resetDb();
  const ORG_GAME = '5678';
  seedFinishedSession({ gameId: ORG_GAME, orgId: 'acme' });
  await build(ORG_GAME);
  expireSevenDayRows(ORG_GAME);
  const orgReport = await reportOf(ORG_GAME);

  check('the recovered answers are plaintext, not envelopes', () => {
    const texts = (roundOf(orgReport, '001').answers || []).map((a) => a.answerText).sort();
    assert.deepStrictEqual(texts, ['Standups ran long', 'We shipped the thing']);
  });
  check('the org snapshot is still stored encrypted', () => {
    const row = storedReport(ORG_GAME);
    assert.ok(row.detailedQuestions && row.detailedQuestions.v, 'detailedQuestions is not an envelope at rest');
  });
  check('and it round-trips back to the same answers', () => {
    const texts = plainRow('acme', storedReport(ORG_GAME))
      .detailedQuestions.find((q) => q.questionNumber === '001')
      .answers.map((a) => a.answerText).sort();
    assert.deepStrictEqual(texts, ['Standups ran long', 'We shipped the thing']);
  });

  // ===========================================================================
  say('\n8. Day 31: the results and summaries go too, and the report holds');
  // ===========================================================================
  resetDb();
  seedFinishedSession();
  await build();
  expireSevenDayRows();
  expireThirtyDayRows();
  const dayThirtyOne = await reportOf();

  check('both rounds survive on the snapshot alone', () => {
    assert.strictEqual(dayThirtyOne.detailedQuestions.length, 2);
  });
  check('the AI summary written on the night is still readable', () => {
    assert.strictEqual(
      roundOf(dayThirtyOne, '001').aiSummary.summaryText, 'Field notes for round 001'
    );
  });
  check('the session brief still comes from the live session row', () => {
    assert.strictEqual(dayThirtyOne.gameTitle, 'Retro Night');
    assert.strictEqual(dayThirtyOne.hostName, 'Ada');
  });

  say(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})();
