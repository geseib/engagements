/**
 * THE REPORT'S "ARRIVED LATE" AND "INCLUDE ITEMS NOT REVIEWED" (session flow
 * v3 §4.4 and §4.5; late items plan Task 5), through the real create-report
 * handler, comments.js's late routes and its public feedback-round read, on
 * the in-memory table the follow-up suites share.
 *
 *   1  each round's `late: { answers, askAnswers, comments }` lands in its own
 *      round row (REPORT#R#nnn), never in the head; each item carries its
 *      words, who (null where the round hid names; never on an ask answer),
 *      when and during what it arrived, and the owner's label
 *   2  an added-later comment is listed under late, not twice; an on-time
 *      comment keeps today's place
 *   3  "Include items not reviewed" off: not-reviewed late items are left out,
 *      reviewed ones stay, the on-time comment is unaffected, and the report
 *      says how many it left out
 *   4  the setting is the host's, on POST /late/review { kind: 'report' }
 *   5  the phone's feedback-round read never carries the late section (Q14)
 *
 * Every expected value is written by hand, never read back off the handler.
 */
const suiteFinished = require('./helpers/finish-guard');
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');
const { createTable, commands } = require('./helpers/followup-table');
const { makeKmsStub, installTestKeyLoader } = require('./helpers/tenant-crypto-stub');

const table = createTable({ pageSize: 1000 });
class PostToConnectionCommand { constructor(i) { this.input = i; } }
class FakeApiGatewayClient { async send() { return {}; } }

const STUB_PATHS = [REPO, path.join(REPO, 'lambda-functions'), path.join(REPO, 'lambda-functions', 'game')];
function stub(name, exports) {
  const seen = new Set();
  for (const base of STUB_PATHS) {
    let p;
    try { p = require.resolve(name, { paths: [base] }); } catch { continue; }
    if (seen.has(p)) continue;
    seen.add(p);
    require.cache[p] = { id: p, filename: p, loaded: true, exports };
  }
  if (!seen.size) throw new Error(`stub(): could not resolve ${name}`);
}
stub('@aws-sdk/client-kms', makeKmsStub().exports);
stub('@aws-sdk/client-dynamodb', { DynamoDBClient: class {} });
stub('@aws-sdk/lib-dynamodb', { DynamoDBDocumentClient: { from: () => table.doc }, ...commands });
stub('@aws-sdk/client-apigatewaymanagementapi', { ApiGatewayManagementApiClient: FakeApiGatewayClient, PostToConnectionCommand });
try { stub('@aws-sdk/client-s3', { S3Client: class {}, PutObjectCommand: class {} }); } catch { /* not installed here */ }

process.env.TABLE_NAME = 'test-table';
process.env.WEBSOCKET_API_ENDPOINT = 'https://ws.test.invalid/dev';
process.env.TENANT_KMS_KEY_ID = 'alias/engage-tenant';
process.env.FOLLOWUP_ASKS_ENABLED = 'on';
installTestKeyLoader();

const { handler: createReport } = require(path.join(REPO, 'lambda-functions/game/create-report.js'));
const { handler: comments } = require(path.join(REPO, 'lambda-functions/game/comments.js'));
const C = require(path.join(REPO, 'lambda-functions/game/tenant-crypto.js'));

const logs = [];
if (!process.env.DEBUG) { console.log = (...a) => logs.push(a.join(' ')); console.warn = console.log; console.error = console.log; }
const say = (s) => process.stdout.write(s + '\n');
let pass = 0, fail = 0;
async function check(label, fn) {
  try { await fn(); say(`  PASS  ${label}`); pass++; }
  catch (e) { say(`  FAIL  ${label}\n        ${e.stack.split('\n').slice(0, 3).join('\n        ')}`); fail++; }
}

const ORG = 'org_acme';
const GAME = '4861';
const PK = `GAME#${GAME}`;
const HOST = { lambda: { userId: 'u-host', groups: 'hosts', orgId: ORG, orgIds: ORG } };
const RIVAL = { lambda: { userId: 'u-rival', groups: 'hosts', orgId: 'org_rival', orgIds: 'org_rival' } };
const ASK = 'k00000001abc';
const sealed = (entity, row) => C.encryptItem(ORG, entity, row);

/**
 * Round 1 named (AuthorsRevealed), round 2 hid names. Late items on both:
 *   round 1  a late answer (Ada, not reviewed), an added-later comment (Ada,
 *            not reviewed), a late idea (Grace, not reviewed); plus an
 *            on-time comment (Bea) and an on-time idea
 *   round 2  a late answer (Grace, not reviewed), an added-later comment
 *            (Linus, reviewed by the host)
 */
async function seed({ includeNotReviewed } = {}) {
  table.rows.clear();
  table.put({
    PK, SK: 'METADATA', GameType: 'call-and-answer', orgId: ORG, QuestionSetId: 'none',
    HostPreferences: { anonymousUntilReveal: true },
    ...(includeNotReviewed === undefined ? {} : { IncludeNotReviewed: includeNotReviewed }),
  });
  table.put({ PK, SK: 'STATE', State: 'RESULTS#002', LessonNumber: 2 });
  table.put({ PK, SK: 'ROUND#001', QuestionNumber: '001', AuthorsRevealed: true });
  table.put({ PK, SK: 'ROUND#002', QuestionNumber: '002', AuthorsRevealed: false, StageBeat: 'feedback' });
  for (const n of ['001', '002']) {
    table.put(await sealed('results', { PK, SK: `QUESTION#${n}#RESULTS`, QuestionId: n, Winners: [], VoteTallies: {} }));
    table.put(await sealed('answer', { PK, SK: `QUESTION#${n}#ANSWER#Bea`, PlayerName: 'Bea', QuestionNumber: n, Answer: `Bea on ${n}` }));
  }
  table.put({ PK, SK: 'PLAYER#Bea', PlayerName: 'Bea', playerId: 'p1' });

  table.put(await sealed('answer', {
    PK, SK: 'QUESTION#001#LATE#Ada', PlayerName: 'Ada', QuestionNumber: '001', Answer: 'Ship it on Friday.',
    AnswerType: 'standard', ArrivedDuring: 'VOTE#001', SubmittedAt: '2026-10-16T09:01:00.000Z',
  }));
  table.put(await sealed('answer', {
    PK, SK: 'QUESTION#002#LATE#Grace', PlayerName: 'Grace', QuestionNumber: '002', Answer: 'Ask the customer.',
    AnswerType: 'standard', ArrivedDuring: 'RESULTS#002', SubmittedAt: '2026-10-16T09:20:00.000Z',
  }));

  table.put(await sealed('comment', {
    PK, SK: 'COMMENT#001#summary##000000000000005-bbbb', QuestionNumber: '001', AnchorKind: 'summary', AnchorRef: '',
    AnchorLabel: 'What we heard', AnchorExcerpt: '', Text: 'Said at the time.', playerName: 'Bea', name: 'Bea',
    PostedDuring: 'RESULTS#001', AddedLater: false, Reviewed: null, SubmittedAt: '2026-10-16T09:02:00.000Z',
  }));
  table.put(await sealed('comment', {
    PK, SK: 'COMMENT#001#summary##000000000000010-aaaa', QuestionNumber: '001', AnchorKind: 'summary', AnchorRef: '',
    AnchorLabel: 'What we heard', AnchorExcerpt: '', Text: 'We skipped cost.', playerName: 'Ada', name: 'Ada',
    PostedDuring: 'ASK#002', AddedLater: true, Reviewed: null, SubmittedAt: '2026-10-16T09:10:00.000Z',
  }));
  table.put(await sealed('comment', {
    PK, SK: 'COMMENT#002#response#1#000000000000020-cccc', QuestionNumber: '002', AnchorKind: 'response', AnchorRef: '1',
    AnchorLabel: 'Response 2 — Sam', AnchorExcerpt: 'Re-price it.', Text: 'Only this one touches the customer.',
    playerName: 'Linus', name: 'Linus', PostedDuring: 'RESULTS#002', AddedLater: true, Reviewed: 'read',
    ReviewedAt: '2026-10-16T09:30:00.000Z', SubmittedAt: '2026-10-16T09:25:00.000Z',
  }));

  table.put(await sealed('followup', {
    PK, SK: `FOLLOWUP#001#ASK#${ASK}`, AskId: ASK, QuestionNumber: '001', Kind: 'ideas',
    Question: 'Who else should hear this?', Status: 'closed', SentAt: '2026-10-16T09:03:00.000Z',
  }));
  table.put(await sealed('followup', {
    PK, SK: `FOLLOWUP#001#ASK#${ASK}#A#Bea`, AskId: ASK, QuestionNumber: '001', PlayerName: 'Bea',
    Value: 'Sales', Text: 'Sales', At: '2026-10-16T09:04:00.000Z',
  }));
  table.put(await sealed('followup', {
    PK, SK: `FOLLOWUP#001#ASK#${ASK}#LATE#Grace`, AskId: ASK, QuestionNumber: '001', Kind: 'ideas', PlayerName: 'Grace',
    Value: 'The finance team', Text: 'The finance team', ArrivedDuring: 'ASK#002',
    SubmittedAt: '2026-10-16T09:12:00.000Z', Reviewed: null,
  }));
}

const runReport = async () => {
  const res = await createReport({
    pathParameters: { gameId: GAME },
    requestContext: { routeKey: 'POST /games/{gameId}/report', authorizer: HOST },
  });
  return { status: res.statusCode, body: JSON.parse(res.body) };
};
const storedRound = async (n) => {
  const row = table.get(PK, `REPORT#R#${n}`);
  return row ? (await C.decryptItem(ORG, 'reportRound', row)).Round : null;
};
const storedHead = async () => C.decryptItem(ORG, 'report', table.get(PK, 'REPORT'));
const lateCall = (method, routeKey, { body, authorizer = HOST } = {}) => comments({
  routeKey,
  requestContext: { http: { method }, routeKey, ...(authorizer ? { authorizer } : {}) },
  pathParameters: { gameId: GAME },
  body: body === undefined ? undefined : JSON.stringify(body),
}).then((res) => ({ status: res.statusCode, body: JSON.parse(res.body) }));
const brief = (it) => ({ text: it.text, who: it.who, arrivedDuring: it.arrivedDuring, arrivedAt: it.arrivedAt, label: it.label });

(async () => {
  say('\n1. the late section, in the round rows');
  await seed();
  const on = await runReport();
  await check('the report builds', () => assert.strictEqual(on.status, 200, JSON.stringify(on.body)));
  const r1 = await storedRound('001');
  const r2 = await storedRound('002');
  await check('round 1 row: the late answer, named (the round showed names)', () => {
    assert.deepStrictEqual(r1.late.answers.map(brief), [{
      text: 'Ship it on Friday.', who: 'Ada', arrivedDuring: 'VOTE#001', arrivedAt: '2026-10-16T09:01:00.000Z', label: 'Not reviewed',
    }]);
  });
  await check('round 1 row: the late idea, never named, with its question', () => {
    assert.deepStrictEqual(r1.late.askAnswers.map(brief), [{
      text: 'The finance team', who: null, arrivedDuring: 'ASK#002', arrivedAt: '2026-10-16T09:12:00.000Z', label: 'Not reviewed',
    }]);
    assert.strictEqual(r1.late.askAnswers[0].askQuestion, 'Who else should hear this?');
  });
  await check('round 1 row: the added-later comment is under late', () => {
    assert.deepStrictEqual(r1.late.comments.map(brief), [{
      text: 'We skipped cost.', who: 'Ada', arrivedDuring: 'ASK#002', arrivedAt: '2026-10-16T09:10:00.000Z', label: 'Not reviewed',
    }]);
  });
  await check('...and not twice: the round\'s comments keep only the on-time one', () => {
    assert.deepStrictEqual(r1.comments.map((c) => c.text), ['Said at the time.']);
  });
  await check('round 2 hid names: who is null on every late item, no name anywhere in them', () => {
    assert.deepStrictEqual(r2.late.answers.map(brief), [{
      text: 'Ask the customer.', who: null, arrivedDuring: 'RESULTS#002', arrivedAt: '2026-10-16T09:20:00.000Z', label: 'Not reviewed',
    }]);
    assert.deepStrictEqual(r2.late.comments.map(brief), [{
      text: 'Only this one touches the customer.', who: null, arrivedDuring: 'RESULTS#002', arrivedAt: '2026-10-16T09:25:00.000Z', label: 'Reviewed by the host',
    }]);
    const words = JSON.stringify(r2.late);
    for (const name of ['Grace', 'Linus', 'Sam']) assert.ok(!words.includes(name), `${name} in ${words}`);
  });
  await check('the head carries no rounds, and with the setting on nothing is left out', async () => {
    const head = await storedHead();
    assert.ok(!('detailedQuestions' in head), 'rounds in the head');
    assert.strictEqual(head.includeNotReviewed, true);
    assert.deepStrictEqual(head.notReviewedLeftOut, { comments: 0, answers: 0, line: '' });
  });
  await check('the comment count is the comments the report prints (3)', () => {
    assert.strictEqual(on.body.report.gameStats.totalComments, 3);
  });

  say('\n2. "Include items not reviewed" off');
  await seed({ includeNotReviewed: false });
  const off = await runReport();
  await check('the report builds', () => assert.strictEqual(off.status, 200, JSON.stringify(off.body)));
  const o1 = await storedRound('001');
  const o2 = await storedRound('002');
  await check('round 1: every not-reviewed late item is left out', () => {
    assert.deepStrictEqual(o1.late.answers, []);
    assert.deepStrictEqual(o1.late.askAnswers, []);
    assert.deepStrictEqual(o1.late.comments, []);
  });
  await check('round 2: the reviewed comment stays, the not-reviewed answer goes', () => {
    assert.deepStrictEqual(o2.late.answers, []);
    assert.deepStrictEqual(o2.late.comments.map((c) => c.text), ['Only this one touches the customer.']);
  });
  await check('the on-time comment is unaffected', () => {
    assert.deepStrictEqual(o1.comments.map((c) => c.text), ['Said at the time.']);
  });
  await check('each round says how many it left out', () => {
    assert.deepStrictEqual(o1.late.leftOut, { comments: 1, answers: 2 });
    assert.deepStrictEqual(o2.late.leftOut, { comments: 0, answers: 1 });
  });
  await check('the report says how many, in one line ("items" when mixed)', async () => {
    const head = await storedHead();
    assert.strictEqual(head.includeNotReviewed, false);
    assert.deepStrictEqual(head.notReviewedLeftOut, {
      comments: 1, answers: 3, line: "4 items not reviewed are left out of this report, at the host's choice.",
    });
    assert.deepStrictEqual(off.body.report.notReviewedLeftOut, head.notReviewedLeftOut);
  });
  await check('the comment count drops the one left out (2)', () => {
    assert.strictEqual(off.body.report.gameStats.totalComments, 2);
  });

  say('\n3. the line\'s words');
  const { leftOutLine } = require(path.join(REPO, 'lambda-functions/game/late-labels.js'));
  await check('comments only, plural and singular; answers only; none', () => {
    assert.strictEqual(leftOutLine({ comments: 2, answers: 0 }), "2 comments not reviewed are left out of this report, at the host's choice.");
    assert.strictEqual(leftOutLine({ comments: 1, answers: 0 }), "1 comment not reviewed is left out of this report, at the host's choice.");
    assert.strictEqual(leftOutLine({ comments: 0, answers: 3 }), "3 answers not reviewed are left out of this report, at the host's choice.");
    assert.strictEqual(leftOutLine({ comments: 0, answers: 0 }), '');
  });

  say('\n4. the setting, on the host\'s late route');
  await seed();
  const set = await lateCall('POST', 'POST /games/{gameId}/late/review', { body: { kind: 'report', how: 'leave-out' } });
  await check('the host turns it off', () => {
    assert.strictEqual(set.status, 200, JSON.stringify(set.body));
    assert.strictEqual(set.body.includeNotReviewed, false);
    assert.strictEqual(table.get(PK, 'METADATA').IncludeNotReviewed, false);
  });
  await check('GET /late says so', async () => {
    const got = await lateCall('GET', 'GET /games/{gameId}/late');
    assert.strictEqual(got.body.includeNotReviewed, false);
  });
  await check('and back on', async () => {
    const back = await lateCall('POST', 'POST /games/{gameId}/late/review', { body: { kind: 'report', how: 'include' } });
    assert.strictEqual(back.body.includeNotReviewed, true);
    assert.strictEqual(table.get(PK, 'METADATA').IncludeNotReviewed, true);
  });
  await check('anything else is refused', async () => {
    const bad = await lateCall('POST', 'POST /games/{gameId}/late/review', { body: { kind: 'report', how: 'maybe' } });
    assert.strictEqual(bad.status, 400);
  });
  await check('a host of another team gets 404 and changes nothing', async () => {
    const r = await lateCall('POST', 'POST /games/{gameId}/late/review', { body: { kind: 'report', how: 'leave-out' }, authorizer: RIVAL });
    assert.strictEqual(r.status, 404);
    assert.strictEqual(table.get(PK, 'METADATA').IncludeNotReviewed, true);
  });

  say('\n5. the phone\'s feedback round never carries it (Q14)');
  await seed();
  await runReport();
  const fb = await lateCall('GET', 'GET /games/{gameId}/feedback-round', { authorizer: null });
  await check('the round is served, without late', () => {
    assert.strictEqual(fb.status, 200, JSON.stringify(fb.body));
    assert.ok(!('late' in fb.body.round), 'late reached the phone');
    assert.ok(!JSON.stringify(fb.body).includes('Not reviewed'), 'a review label reached the phone');
  });

  say(`\n${pass} passed, ${fail} failed`);
  if (fail && process.env.DEBUG !== '1') say(logs.slice(-30).join('\n'));
  suiteFinished();
  process.exit(fail ? 1 : 0);
})().catch((e) => { say(`CRASH ${e.stack}`); process.exit(1); });
