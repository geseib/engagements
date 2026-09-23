/**
 * AN ORGANISATION'S QUESTIONS ARE QUOTED IN ITS REPORT AS WORDS, NOT ENVELOPES.
 *
 * ── THE DEFECT ─────────────────────────────────────────────────────────────
 *
 * `lambda-functions/game/create-report.js` builds each round's `questionData`
 * from the set's question row — a GetCommand on `resolvedSet.pk` (the legacy
 * "new format" branch) or a QueryCommand on the same key (the branch an org
 * set actually takes) — and copied `Title`, `Detail`, `optionA..F` and
 * `AnswerDetails` straight into the report. For an organisation's set those
 * are ENCRYPTED_FIELDS.question, sealed at rest, and nothing opened them: the
 * report carried `{v, iv, tag, ct}` where the question and its options belong,
 * both in the response the host reads and in the stored REPORT snapshot.
 *
 * ── THE RULE ───────────────────────────────────────────────────────────────
 *
 * Decrypted with the SET's org, from the pinned pair (`resolvedSet`, which
 * create-report resolves from the session row's gameSetRef) — the rule
 * get-question.js, get-results.js and get-ai-summary.js already follow.
 * Platform and public sets are never encrypted and pass through untouched.
 *
 * rejects: a report of an org set's round whose title, detail, options or
 *          reveal is an envelope — in the response or in the stored REPORT row
 *          once that row's own envelope is opened; a fix that covers only one
 *          of the two read branches; a fix that disturbs a platform set played
 *          by an org's session; a fix that puts the decrypted words in a log
 *          line (tests/ai-summary-content-not-logged.js holds the rest of that
 *          rule).
 *
 * FIXTURES: the answer is submitted through the real websocket/message.js,
 * which scores it against the same sealed question. The rows the report
 * starts from are seeded as their writers write them — the REF row and the
 * `QUESTION#001#RESULTS` marker from next-question.js (a trivia close writes
 * no RESULTS row of its own, so that marker, which carries no
 * SourceQuestionId, is how the round is found and why the report falls back
 * to the REF row) — and the set's rows are encrypted by the real encryptItem.
 * Only the AWS clients are fakes.
 */
const suiteFinished = require('./helpers/finish-guard');
const path = require('path');
const util = require('util');
const crypto = require('crypto');
const assert = require('assert');

const REPO = path.join(__dirname, '..');
const { createTable, installStubs } = require('./helpers/player-table');

// KMS, faked, and registered before any handler loads.
const kmsStubs = require('./helpers/tenant-crypto-stub');
const kms = kmsStubs.makeKmsStub();
for (const base of [REPO, path.join(REPO, 'lambda-functions'), path.join(REPO, 'lambda-functions', 'game'), path.join(REPO, 'lambda-functions', 'websocket')]) {
  let p;
  try { p = require.resolve('@aws-sdk/client-kms', { paths: [base] }); } catch { continue; }
  require.cache[p] = { id: p, filename: p, loaded: true, exports: kms.exports };
}

const table = createTable();
const sent = [];
const frames = [];
installStubs({ table, sent, frames });
process.env.TABLE_NAME = 'test-table';
process.env.WEBSOCKET_API_ENDPOINT = 'https://ws.test.invalid/dev';

const wsMessage = require(path.join(REPO, 'lambda-functions/websocket/message.js')).handler;
const createReport = require(path.join(REPO, 'lambda-functions/game/create-report.js')).handler;
const C = require(path.join(REPO, 'lambda-functions/game/tenant-crypto.js'));
kmsStubs.installTestKeyLoader();

/* ---- Harness -------------------------------------------------------------- */

let pass = 0; let fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  ok   - ${label}`); pass += 1; } catch (e) { console.log(`  FAIL - ${label}\n         ${e.message}`); fail += 1; }
}

/** Everything printed while `fn` runs, unabridged — and kept off the terminal. */
const FORMAT = { depth: Infinity, maxArrayLength: Infinity, maxStringLength: Infinity, breakLength: Infinity };
const LEVELS = ['log', 'info', 'warn', 'error', 'debug'];
async function captureLogs(fn) {
  const lines = [];
  const orig = {};
  for (const level of LEVELS) {
    orig[level] = console[level];
    console[level] = (...args) => lines.push(util.formatWithOptions(FORMAT, ...args));
  }
  let out;
  try { out = await fn(); } finally { Object.assign(console, orig); }
  return { out, logs: lines.join('\n') };
}

/** A string no fixture, id or log template could contain by accident. */
const marker = (tag) => `zq${tag}${crypto.randomBytes(4).toString('hex')}`;

const put = (item) => table.store.set(table.keyOf(item.PK, item.SK), item);
const get = (pk, sk) => table.store.get(table.keyOf(pk, sk));
const isEnvelope = (v) => !!v && typeof v === 'object' && typeof v.ct === 'string' && typeof v.iv === 'string';

const ORG = 'org_acme';
const HOST = 'host-1';
const PHONE = 'phone-1';
const SET_ID = 'planets';
const SOURCE_ID = 'QUESTION#c001#001';

/**
 * One org-owned trivia room on ASK#001, playing question 1 of a set in
 * `setScope`. For an org set every question field on the boundary is sealed.
 * `legacyMetadata` adds an unscoped `SET#<id>/METADATA` row of the same slug,
 * which is what sends create-report down its GetCommand ("new format") branch
 * instead of the QueryCommand one.
 *
 * @returns the plaintext the report must quote, keyed by questionData field.
 */
async function seedRoom({ gameId, setScope, legacyMetadata = false }) {
  table.store.clear(); sent.length = 0; frames.length = 0;
  kmsStubs.forgetAllOrgs();
  const PK = `GAME#${gameId}`;
  const org = setScope === 'org';

  put(await C.encryptItem(ORG, 'session', {
    PK, SK: 'METADATA', GameType: 'trivia', Started: true, orgId: ORG,
    Title: 'Planets quiz', HostName: 'Host',
    QuestionSetId: SET_ID, QuestionSetScope: setScope, QuestionSetVersion: 1,
    HostPreferences: { anonymousUntilReveal: false },
  }));
  put({ PK, SK: 'STATE', State: 'ASK#001', LessonNumber: 1, CurrentQuestionId: '001' });
  put({ PK, SK: `CONNECTION#${HOST}`, ConnectionId: HOST, ConnectionType: 'HOST', GameId: gameId });
  put({ PK, SK: `CONNECTION#${PHONE}`, ConnectionId: PHONE, ConnectionType: 'PLAYER', GameId: gameId, PlayerName: 'Ada' });
  put({ PK, SK: 'ROUND#001', QuestionNumber: '001', AuthorsRevealed: true });

  // The two rows next-question.js writes when it asks the question: the REF
  // row carrying the pinned pair, and the category-count marker that is the
  // round's RESULTS row. Then the set where that pinned pair addresses it.
  put({
    PK, SK: 'QUESTION#001#REF', SourceQuestionId: SOURCE_ID,
    SetId: SET_ID, SetVersion: 1, SetScope: setScope, ...(org ? { SetOrgId: ORG } : {}),
    StartedAt: new Date().toISOString(),
  });
  put({
    PK, SK: 'QUESTION#001#RESULTS', CategoryCountDecremented: true,
    DecrementedAt: new Date().toISOString(), CategoryId: 'c001', CategoryPosition: 0,
  });
  put({ PK: org ? `ORG#${ORG}#SETS` : 'SETS', SK: `SET#${SET_ID}`, activeVersion: 1, versions: [{ version: 1 }] });
  if (legacyMetadata) {
    put({ PK: `SET#${SET_ID}`, SK: 'METADATA', metadata: { title: 'Planets', roundNoun: 'Round' } });
  }

  const expected = {
    title: `Largest planet ${marker('title')}`,
    detail: `By mass ${marker('detail')}`,
    optionA: `Mercury ${marker('a')}`,
    optionB: `Jupiter ${marker('b')}`,
    optionC: `Neptune ${marker('c')}`,
    optionD: `Saturn ${marker('d')}`,
    answerDetails: `Because ${marker('reveal')}`,
  };
  const question = {
    PK: org ? `ORG#${ORG}#SET#${SET_ID}#v1` : `SET#${SET_ID}#v1`,
    SK: SOURCE_ID, Category: 'c001', points: 10, correctAnswer: 'OptionB',
    Title: expected.title, Detail: expected.detail,
    optionA: expected.optionA, optionB: expected.optionB,
    optionC: expected.optionC, optionD: expected.optionD,
    AnswerDetails: expected.answerDetails,
  };
  put(org ? await C.encryptItem(ORG, 'question', question) : question);
  return expected;
}

/** Ada answers B, through the real handler, which scores it against the set. */
async function playRound(gameId) {
  const { out } = await captureLogs(() => wsMessage({
    requestContext: { connectionId: PHONE, domainName: 'ws.test.invalid', stage: 'dev' },
    body: JSON.stringify({
      messageType: 'ANSWER#001', gameId, playerName: 'Ada', answer: 'B', answerType: 'trivia',
      timestamp: '2026-09-23T10:05:00.000Z',
    }),
  }));
  assert.strictEqual(out.statusCode, 200, `the answer frame answered ${out.statusCode}: ${out.body}`);
  const row = get(`GAME#${gameId}`, 'QUESTION#001#ANSWER#Ada');
  assert.ok(row && row.IsCorrect === true, 'Ada\'s answer was not stored and scored right');
}

/** The one round's questionData, from the response and from the stored snapshot. */
async function reportRound(gameId) {
  const { out, logs } = await captureLogs(() => createReport({ pathParameters: { gameId } }));
  assert.strictEqual(out.statusCode, 200, `create-report answered ${out.statusCode}: ${out.body}`);
  const served = JSON.parse(out.body).report.detailedQuestions;
  const stored = get(`GAME#${gameId}`, 'REPORT');
  return { served, stored, logs };
}

/** Every questionData field the report quotes from the set equals its plaintext. */
function assertQuoted(questionData, expected, where) {
  assert.ok(questionData, `${where}: no questionData for round 001`);
  const sealed = Object.entries(questionData).filter(([, v]) => isEnvelope(v)).map(([k]) => k);
  assert.deepStrictEqual(sealed, [], `${where}: still sealed: ${sealed.join(', ')}`);
  for (const [field, plain] of Object.entries(expected)) {
    assert.strictEqual(questionData[field], plain, `${where}: ${field} is ${JSON.stringify(questionData[field])}`);
  }
  // `questionDetail` is the trivia-only alias of `detail`; it is quoted too.
  assert.strictEqual(questionData.questionDetail, expected.detail, `${where}: questionDetail`);
}

async function reportsTheWords(gameId, expected) {
  const { served, stored, logs } = await reportRound(gameId);

  await check('the report carries exactly the one round played', () => {
    assert.strictEqual(served.length, 1, `${served.length} rounds reported`);
    assert.strictEqual(served[0].questionData.sourceQuestionId, SOURCE_ID);
  });
  await check('the report the host is sent quotes the question and its options in words', () =>
    assertQuoted(served[0].questionData, expected, 'served'));
  await check('the stored snapshot is sealed at rest, and quotes the words once opened', () => {
    assert.ok(stored, 'no REPORT row was written');
    assert.ok(isEnvelope(stored.detailedQuestions), 'the REPORT row stores detailedQuestions in the clear');
    const [round] = kmsStubs.plainRow(ORG, stored).detailedQuestions;
    assertQuoted(round.questionData, expected, 'stored');
  });
  await check('…and none of the words reaches the logs', () => {
    const lower = logs.toLowerCase();
    const leaked = Object.entries(expected).filter(([, plain]) => lower.includes(plain.toLowerCase()));
    assert.deepStrictEqual(leaked.map(([k]) => k), [], 'create-report logged question content');
  });
}

(async () => {
  console.log('\nreport-org-question-decrypted: an org set\'s questions are reported in words\n');

  console.log('1. an org set — the QueryCommand branch every org set takes');
  {
    const gameId = '7101';
    const expected = await seedRoom({ gameId, setScope: 'org' });
    await check('(the question row is sealed at rest)', () => {
      const row = get(`ORG#${ORG}#SET#${SET_ID}#v1`, SOURCE_ID);
      assert.ok(isEnvelope(row.Title) && isEnvelope(row.optionB), 'the fixture question is not encrypted');
    });
    await playRound(gameId);
    await reportsTheWords(gameId, expected);
  }

  console.log('\n2. an org set — the GetCommand branch, reached through a legacy metadata row of the same slug');
  {
    const gameId = '7102';
    const expected = await seedRoom({ gameId, setScope: 'org', legacyMetadata: true });
    await playRound(gameId);
    await reportsTheWords(gameId, expected);
  }

  console.log('\n3. a platform set played by an org\'s session — plaintext, untouched');
  {
    const gameId = '7103';
    const expected = await seedRoom({ gameId, setScope: 'platform' });
    await playRound(gameId);
    await reportsTheWords(gameId, expected);
  }

  console.log(`\n${pass} passed, ${fail} failed\n`);
  suiteFinished();
  process.exit(fail === 0 ? 0 : 1);
})();
