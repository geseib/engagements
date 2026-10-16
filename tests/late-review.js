/**
 * THE HOST'S LATE LIST AND ITS REVIEW (session flow v3 §4.4; late items plan
 * Task 3), through comments.js's handler on the paging in-memory table the
 * follow-up suites share (tests/helpers/followup-table.js, two rows a page, so
 * a one-call Query would miss rows).
 *
 *   GET  /games/{id}/late          every late item, grouped by round, with the
 *                                  owner's labels and a not-reviewed count
 *   POST /games/{id}/late/review   { kind, round, ref, how: shown|read } on one
 *                                  row; { kind: 'comments', how: 'close' } sets
 *                                  CommentsClosedAt, only once ENDED
 *
 *   Review Focus 3   no identity, or a host of another org: 404, nothing read
 *                    or written
 *   Review Focus 4   a hid-names round: author null, never a name
 *   feature / pick   putting a comment or a late idea on the wall marks it
 *                    "Reviewed with the room"
 *
 * Every expected value is written by hand, never read back off the handler.
 */
const suiteFinished = require('./helpers/finish-guard');
const path = require('path');
const assert = require('assert');
const nodeCrypto = require('crypto');

const REPO = path.join(__dirname, '..');
const { createTable, commands } = require('./helpers/followup-table');
const { makeKmsStub, installTestKeyLoader } = require('./helpers/tenant-crypto-stub');
const { routesFromTemplate, findRoute, assertScannerWorks } = require('./helpers/template-routes');

const table = createTable({ pageSize: 2 });
const sent = [];
class PostToConnectionCommand { constructor(i) { this.input = i; } }
class FakeApiGatewayClient {
  async send(cmd) { sent.push({ to: cmd.input.ConnectionId, message: JSON.parse(cmd.input.Data) }); return {}; }
}

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

process.env.TABLE_NAME = 'test-table';
process.env.WEBSOCKET_API_ENDPOINT = 'https://ws.test.invalid/dev';
process.env.TENANT_KMS_KEY_ID = 'alias/engage-tenant';
process.env.FOLLOWUP_ASKS_ENABLED = 'on';
installTestKeyLoader();

const { handler } = require(path.join(REPO, 'lambda-functions/game/comments.js'));
const C = require(path.join(REPO, 'lambda-functions/game/tenant-crypto.js'));
const { lateWindow } = require(path.join(REPO, 'lambda-functions/game/late-window.js'));

const logs = [];
if (!process.env.DEBUG) { console.log = (...a) => logs.push(a.join(' ')); console.warn = console.log; console.error = console.log; }
const say = (s) => process.stdout.write(s + '\n');
let pass = 0, fail = 0;
async function check(label, fn) {
  try { await fn(); say(`  PASS  ${label}`); pass++; }
  catch (e) { say(`  FAIL  ${label}\n        ${e.stack.split('\n').slice(0, 3).join('\n        ')}`); fail++; }
}

const ORG = 'org_acme';
const GAME = '4851';
const OTHER_GAME = '4852';
const PK = `GAME#${GAME}`;
const HOUR = 60 * 60 * 1000;
const hoursAgo = (h) => new Date(Date.now() - h * HOUR).toISOString();
const HOST = { lambda: { userId: 'u-host', groups: 'hosts', orgId: ORG, orgIds: ORG } };
const RIVAL = { lambda: { userId: 'u-rival', groups: 'hosts', orgId: 'org_rival', orgIds: 'org_rival' } };
const ASK = 'k00000001abc';
/** The session's id secret (METADATA IdSecret), fixed here so ids can be worked out by hand. */
const SECRET = 'c2Vzc2lvbi1zZWNyZXQtZm9yLWxhdGUtcmV2aWV3LXRlc3Q=';
/** The Ideas pick's id / a late ref: the first 12 hex of HMAC-SHA256(secret, key). */
const idOf = (sk, secret = SECRET) => nodeCrypto.createHmac('sha256', secret).update(sk).digest('hex').slice(0, 12);
const sha = (s) => nodeCrypto.createHash('sha256').update(s).digest('hex');

const call = async (method, routeKey, { gameId = GAME, body, authorizer, pathParameters = {} } = {}) => {
  const res = await handler({
    routeKey,
    requestContext: { http: { method }, routeKey, ...(authorizer ? { authorizer } : {}) },
    pathParameters: { gameId, ...pathParameters },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.statusCode, body: JSON.parse(res.body) };
};
const getLate = (opts = {}) => call('GET', 'GET /games/{gameId}/late', { authorizer: HOST, ...opts });
const review = (body, opts = {}) => call('POST', 'POST /games/{gameId}/late/review', { authorizer: HOST, body, ...opts });

const sealed = (entity, row) => C.encryptItem(ORG, entity, row);

/**
 * Round 1 named (AuthorsRevealed), round 2 hid names (anonymous until reveal,
 * never revealed). Late items on both, plus on-time rows that must not appear.
 */
async function seed({ state = 'ASK#003', stateExtra = {}, secret = SECRET } = {}) {
  table.rows.clear();
  sent.length = 0;
  table.put({
    PK, SK: 'METADATA', GameType: 'call-and-answer', orgId: ORG, HostPreferences: { anonymousUntilReveal: true },
    ...(secret ? { IdSecret: secret } : {}),
  });
  table.put({ PK, SK: 'STATE', State: state, ...stateExtra });
  table.put({ PK, SK: 'ROUND#001', QuestionNumber: '001', AuthorsRevealed: true, ResultsShownAt: hoursAgo(2) });
  table.put({ PK, SK: 'ROUND#002', QuestionNumber: '002', AuthorsRevealed: false, ResultsShownAt: hoursAgo(1) });
  table.put({ PK, SK: 'CONNECTION#h1', ConnectionId: 'h1', ConnectionType: 'HOST' });
  table.put({ PK, SK: 'CONNECTION#p1', ConnectionId: 'p1', ConnectionType: 'PLAYER', PlayerName: 'Ada' });
  table.put({ PK, SK: 'PLAYER#Ada', PlayerName: 'Ada', ClientId: 'c-ada' });

  // Round answers: one on time (not late), one late on each round.
  table.put(await sealed('answer', { PK, SK: 'QUESTION#001#ANSWER#Bea', PlayerName: 'Bea', QuestionNumber: '001', Answer: 'On time.' }));
  table.put(await sealed('answer', {
    PK, SK: 'QUESTION#001#LATE#Ada', PlayerName: 'Ada', QuestionNumber: '001', Answer: 'Ship it on Friday.',
    AnswerType: 'standard', ArrivedDuring: 'VOTE#001', SubmittedAt: '2026-10-16T09:01:00.000Z',
  }));
  table.put(await sealed('answer', {
    PK, SK: 'QUESTION#002#LATE#Grace', PlayerName: 'Grace', QuestionNumber: '002', Answer: 'Ask the customer.',
    AnswerType: 'standard', ArrivedDuring: 'RESULTS#002', SubmittedAt: '2026-10-16T09:20:00.000Z',
  }));

  // Comments: an on-time one (not listed) and two added later.
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
    playerName: 'Linus', name: 'Linus', PostedDuring: 'ASK#003', AddedLater: true, Reviewed: 'read',
    ReviewedAt: '2026-10-16T09:30:00.000Z', SubmittedAt: '2026-10-16T09:25:00.000Z',
  }));

  // An Ideas question for the room on round 1: one on-time idea, one late.
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

  // Another session, same org: its rows must never be reachable from this one.
  table.put({ PK: `GAME#${OTHER_GAME}`, SK: 'METADATA', GameType: 'call-and-answer', orgId: ORG });
  table.put({ PK: `GAME#${OTHER_GAME}`, SK: 'STATE', State: 'ASK#002' });
  table.put(await sealed('comment', {
    PK: `GAME#${OTHER_GAME}`, SK: 'COMMENT#001#summary##000000000000030-dddd', QuestionNumber: '001', AnchorKind: 'summary',
    AnchorRef: '', Text: 'Elsewhere.', playerName: 'Zed', name: 'Zed', AddedLater: true, Reviewed: null,
  }));
}
const row = (sk, pk = PK) => table.get(pk, sk);
const lateFrames = () => sent.filter((s) => s.message.type === 'lateChanged');

(async () => {
  say('\n1. GET /late: what the host sees');
  await seed();
  const res = await getLate();
  const body = res.body;
  await check('200, two rounds in order', () => {
    assert.strictEqual(res.status, 200, JSON.stringify(body));
    assert.deepStrictEqual(body.rounds.map((r) => r.round), ['001', '002']);
  });
  await check('round 1: the late answer, the late idea and the added-later comment, oldest first; nothing on time', () => {
    const items = body.rounds[0].items;
    assert.deepStrictEqual(items.map((i) => [i.kind, i.text]), [
      ['answer', 'Ship it on Friday.'],
      ['comment', 'We skipped cost.'],
      ['askAnswer', 'The finance team'],
    ]);
  });
  await check('round 1 names the authors it may (revealed), the question for the room never does', () => {
    const [answer, comment, idea] = body.rounds[0].items;
    assert.strictEqual(answer.author, 'Ada');
    assert.strictEqual(comment.author, 'Ada');
    assert.strictEqual(idea.author, null);
  });
  await check('each item carries the owner\'s label, its state and when it arrived', () => {
    const [answer, comment] = body.rounds[0].items;
    assert.strictEqual(answer.label, 'Not reviewed');
    assert.strictEqual(answer.reviewed, null);
    assert.strictEqual(answer.arrivedAt, '2026-10-16T09:01:00.000Z');
    assert.strictEqual(answer.arrivedDuring, 'VOTE#001');
    assert.strictEqual(answer.round, '001');
    assert.strictEqual(comment.arrivedDuring, 'ASK#002');
    const hidden = body.rounds[1].items.find((i) => i.kind === 'comment');
    assert.strictEqual(hidden.reviewed, 'read');
    assert.strictEqual(hidden.label, 'Reviewed by the host');
  });
  await check('refs: a comment by its id; an idea by its ask and pick id; no ref carries a name', () => {
    const [answer, comment, idea] = body.rounds[0].items;
    assert.strictEqual(comment.ref, '000000000000010-aaaa');
    assert.strictEqual(idea.ref, `${ASK}:${idOf(`FOLLOWUP#001#ASK#${ASK}#LATE#Grace`)}`);
    assert.strictEqual(idea.askId, ASK);
    assert.strictEqual(idea.id, idOf(`FOLLOWUP#001#ASK#${ASK}#LATE#Grace`));
    assert.strictEqual(answer.ref, idOf('QUESTION#001#LATE#Ada'));
    for (const r of body.rounds) for (const i of r.items) assert.ok(!/Ada|Grace|Linus/.test(i.ref), i.ref);
  });
  await check('Review Focus 4: the hid-names round prints no name anywhere, and the late answer reads "Late answer"', () => {
    const r2 = body.rounds[1];
    assert.deepStrictEqual(r2.items.map((i) => [i.kind, i.author]), [['answer', null], ['comment', null]]);
    assert.strictEqual(r2.items[0].who, 'Late answer');
    const wire = JSON.stringify(r2);
    assert.ok(!/Grace|Linus|Sam/.test(wire), wire);
  });
  await check('counts: four not reviewed (the read comment is not one); commentsClosedAt null', () => {
    assert.deepStrictEqual(body.counts, { notReviewed: 4 });
    assert.strictEqual(body.commentsClosedAt, null);
  });
  await check('the rows were sealed at rest, so this read decrypted them', () => {
    assert.notStrictEqual(row('QUESTION#001#LATE#Ada').Answer, 'Ship it on Friday.');
    assert.notStrictEqual(row(`FOLLOWUP#001#ASK#${ASK}#LATE#Grace`).Value, 'The finance team');
  });

  say('\n1b. refs cannot be traced to a name (keyed by the session\'s secret)');
  await check('no ref or idea id matches any roster name under plain sha256 or other guessable schemes', async () => {
    await seed();
    const b = (await getLate()).body;
    const refs = b.rounds.flatMap((r) => r.items.flatMap((i) => [i.ref, i.id].filter(Boolean)));
    const ids = refs.flatMap((ref) => String(ref).split(':'));
    const roster = ['Ada', 'Bea', 'Grace', 'Linus'];
    const guesses = new Set();
    for (const name of roster) {
      for (const round of ['001', '002']) {
        for (const sk of [`QUESTION#${round}#LATE#${name}`, `FOLLOWUP#${round}#ASK#${ASK}#LATE#${name}`, `FOLLOWUP#${round}#ASK#${ASK}#A#${name}`, name]) {
          const h = sha(sk);
          guesses.add(h.slice(0, 12));
          guesses.add(h.slice(-12));
          guesses.add(nodeCrypto.createHash('md5').update(sk).digest('hex').slice(0, 12));
          guesses.add(nodeCrypto.createHmac('sha256', GAME).update(sk).digest('hex').slice(0, 12));
          guesses.add(nodeCrypto.createHmac('sha256', ORG).update(sk).digest('hex').slice(0, 12));
        }
      }
    }
    for (const id of ids) assert.ok(!guesses.has(id), `ref part ${id} is guessable`);
  });
  await check('a session with no secret gets one on first need (32 random bytes), and refs are stable across reads', async () => {
    await seed({ secret: null });
    const first = (await getLate()).body;
    const made = row('METADATA').IdSecret;
    assert.strictEqual(Buffer.from(String(made), 'base64').length, 32);
    const second = (await getLate()).body;
    const refsOf = (b) => b.rounds.flatMap((r) => r.items.map((i) => i.ref));
    assert.deepStrictEqual(refsOf(second), refsOf(first));
    assert.strictEqual(row('METADATA').IdSecret, made);
    assert.strictEqual(first.rounds[0].items[0].ref, idOf('QUESTION#001#LATE#Ada', made));
  });
  await check('the secret is never in a reply: GET /late, review, close, feature, the Ideas host read and pick', async () => {
    await seed({ state: 'ENDED', stateExtra: { EndedAt: hoursAgo(1) } });
    const replies = [
      await getLate(),
      await review({ kind: 'comment', round: 1, ref: '000000000000010-aaaa', how: 'read' }),
      await call('POST', 'POST /games/{gameId}/comments/{commentId}/feature', {
        authorizer: HOST, pathParameters: { commentId: '000000000000010-aaaa' }, body: { questionNumber: 1, featured: true },
      }),
      await call('GET', 'GET /games/{gameId}/followups/{proxy+}', { authorizer: HOST, pathParameters: { proxy: 'round/001' } }),
      await call('POST', 'POST /games/{gameId}/followups/{proxy+}', {
        authorizer: HOST, pathParameters: { proxy: `asks/${ASK}/pick` }, body: { round: '001', id: idOf(`FOLLOWUP#001#ASK#${ASK}#A#Bea`), picked: true },
      }),
      await call('GET', 'GET /games/{gameId}/comments', { authorizer: null }),
      await review({ kind: 'comments', how: 'close' }),
    ];
    assert.deepStrictEqual(replies.map((r) => r.status), [200, 200, 200, 200, 200, 400, 200]);
    for (const r of replies) {
      const raw = JSON.stringify(r.body);
      assert.ok(!raw.includes(SECRET) && !raw.includes('IdSecret'), raw.slice(0, 200));
    }
    assert.ok(!sent.some((f) => JSON.stringify(f).includes(SECRET)), 'a broadcast carried the secret');
  });

  say('\n2. Review Focus 3: nobody but this session\'s host');
  await check('GET with no identity: 404, nothing in the body', async () => {
    const r = await getLate({ authorizer: null });
    assert.strictEqual(r.status, 404);
    assert.ok(!r.body.rounds);
  });
  await check('GET as a host of another org: 404', async () => {
    const r = await getLate({ authorizer: RIVAL });
    assert.strictEqual(r.status, 404);
    assert.ok(!r.body.rounds);
  });
  await check('POST with no identity, or another org: 404, nothing written, nothing sent', async () => {
    await seed();
    for (const authorizer of [null, RIVAL]) {
      const r = await review({ kind: 'comment', round: 1, ref: '000000000000010-aaaa', how: 'read' }, { authorizer });
      assert.strictEqual(r.status, 404);
      const c = await review({ kind: 'comments', how: 'close' }, { authorizer });
      assert.strictEqual(c.status, 404);
    }
    assert.strictEqual(row('COMMENT#001#summary##000000000000010-aaaa').Reviewed, null);
    assert.strictEqual(row('METADATA').CommentsClosedAt, undefined);
    assert.strictEqual(sent.length, 0);
  });

  say('\n3. POST /late/review: shown and read');
  await check('a late round answer, read: Reviewed read with a time; lateChanged to the host only', async () => {
    await seed();
    const r = await review({ kind: 'answer', round: 1, ref: idOf('QUESTION#001#LATE#Ada'), how: 'read' });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    const a = row('QUESTION#001#LATE#Ada');
    assert.strictEqual(a.Reviewed, 'read');
    assert.ok(/^\d{4}-\d{2}-\d{2}T/.test(String(a.ReviewedAt)), a.ReviewedAt);
    // Still sealed: the review touched only the two plain fields.
    assert.strictEqual((await C.decryptItem(ORG, 'answer', a)).Answer, 'Ship it on Friday.');
    assert.deepStrictEqual(lateFrames(), [{ to: 'h1', message: { type: 'lateChanged', gameId: GAME } }]);
  });
  await check('a late round answer cannot be "shown": it has no wall view (400, unchanged)', async () => {
    await seed();
    const r = await review({ kind: 'answer', round: 1, ref: idOf('QUESTION#001#LATE#Ada'), how: 'shown' });
    assert.strictEqual(r.status, 400, JSON.stringify(r.body));
    assert.strictEqual(row('QUESTION#001#LATE#Ada').Reviewed, undefined);
  });
  await check('a comment, read; then the label reads "Reviewed by the host" and the count drops', async () => {
    await seed();
    const r = await review({ kind: 'comment', round: '001', ref: '000000000000010-aaaa', how: 'read' });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual(row('COMMENT#001#summary##000000000000010-aaaa').Reviewed, 'read');
    const after = (await getLate()).body;
    const c = after.rounds[0].items.find((i) => i.kind === 'comment');
    assert.strictEqual(c.label, 'Reviewed by the host');
    assert.deepStrictEqual(after.counts, { notReviewed: 3 });
  });
  await check('a late idea, shown: "Reviewed with the room"', async () => {
    await seed();
    const ref = `${ASK}:${idOf(`FOLLOWUP#001#ASK#${ASK}#LATE#Grace`)}`;
    const r = await review({ kind: 'askAnswer', round: 1, ref, how: 'shown' });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual(row(`FOLLOWUP#001#ASK#${ASK}#LATE#Grace`).Reviewed, 'shown');
    const idea = (await getLate()).body.rounds[0].items.find((i) => i.kind === 'askAnswer');
    assert.strictEqual(idea.label, 'Reviewed with the room');
  });
  await check('shown is not taken back by a later "read"', async () => {
    await seed();
    const ref = `${ASK}:${idOf(`FOLLOWUP#001#ASK#${ASK}#LATE#Grace`)}`;
    await review({ kind: 'askAnswer', round: 1, ref, how: 'shown' });
    const r = await review({ kind: 'askAnswer', round: 1, ref, how: 'read' });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual(row(`FOLLOWUP#001#ASK#${ASK}#LATE#Grace`).Reviewed, 'shown');
  });

  say('\n4. a bad ref is a 400; a ref that names nothing here is a 404');
  await check('bad kind, bad how, bad round, malformed refs: 400 and nothing written', async () => {
    await seed();
    const bad = [
      { kind: 'vote', round: 1, ref: '000000000000010-aaaa', how: 'read' },
      { kind: 'comment', round: 1, ref: '000000000000010-aaaa', how: 'hide' },
      { kind: 'comment', round: 'one', ref: '000000000000010-aaaa', how: 'read' },
      { kind: 'comment', round: 1, ref: 'COMMENT#001#summary##000000000000010-aaaa', how: 'read' },
      { kind: 'comment', round: 1, ref: '../METADATA', how: 'read' },
      { kind: 'answer', round: 1, ref: 'Ada', how: 'read' },
      { kind: 'answer', round: 1, ref: 'QUESTION#001#LATE#Ada', how: 'read' },
      { kind: 'askAnswer', round: 1, ref: idOf(`FOLLOWUP#001#ASK#${ASK}#LATE#Grace`), how: 'read' },
      { kind: 'askAnswer', round: 1, ref: `${ASK}:Grace`, how: 'read' },
      { kind: 'comments', how: 'read' },
    ];
    for (const b of bad) {
      const r = await review(b);
      assert.strictEqual(r.status, 400, `${JSON.stringify(b)} → ${r.status} ${JSON.stringify(r.body)}`);
    }
    const before = [...table.rows.values()].filter((x) => x.Reviewed || x.CommentsClosedAt);
    assert.deepStrictEqual(before.map((x) => x.SK), ['COMMENT#002#response#1#000000000000020-cccc']);
    assert.strictEqual(lateFrames().length, 0);
  });
  await check('a well-formed ref to another game\'s comment, or to an on-time answer: 404', async () => {
    await seed();
    const elsewhere = await review({ kind: 'comment', round: 1, ref: '000000000000030-dddd', how: 'read' });
    assert.strictEqual(elsewhere.status, 404, JSON.stringify(elsewhere.body));
    assert.strictEqual(row('COMMENT#001#summary##000000000000030-dddd', `GAME#${OTHER_GAME}`).Reviewed, null);
    const onTime = await review({ kind: 'answer', round: 1, ref: idOf('QUESTION#001#ANSWER#Bea'), how: 'read' });
    assert.strictEqual(onTime.status, 404, JSON.stringify(onTime.body));
    assert.strictEqual(row('QUESTION#001#ANSWER#Bea').Reviewed, undefined);
    const wrongRound = await review({ kind: 'comment', round: 2, ref: '000000000000010-aaaa', how: 'read' });
    assert.strictEqual(wrongRound.status, 404, JSON.stringify(wrongRound.body));
    const onTimeComment = await review({ kind: 'comment', round: 1, ref: '000000000000005-bbbb', how: 'read' });
    assert.strictEqual(onTimeComment.status, 404, JSON.stringify(onTimeComment.body));
    assert.strictEqual(row('COMMENT#001#summary##000000000000005-bbbb').Reviewed, null);
  });
  await check('no routeKey: the late routes are still found by method and rawPath, never the public comments read', async () => {
    await seed();
    const bare = async (method, rawPath, authorizer, body) => {
      const res = await handler({
        rawPath, requestContext: { http: { method, path: rawPath }, ...(authorizer ? { authorizer } : {}) },
        pathParameters: { gameId: GAME }, body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: res.statusCode, body: JSON.parse(res.body) };
    };
    const anon = await bare('GET', `/games/${GAME}/late`, null);
    assert.strictEqual(anon.status, 404, JSON.stringify(anon.body));
    assert.ok(!anon.body.comments && !anon.body.rounds);
    const asHost = await bare('GET', `/dev/games/${GAME}/late`, HOST);
    assert.strictEqual(asHost.status, 200, JSON.stringify(asHost.body));
    assert.ok(Array.isArray(asHost.body.rounds));
    const reviewed = await bare('POST', `/games/${GAME}/late/review`, HOST, { kind: 'comment', round: 1, ref: '000000000000010-aaaa', how: 'read' });
    assert.strictEqual(reviewed.status, 200, JSON.stringify(reviewed.body));
  });

  say('\n5. "Close comments"');
  await check('before ENDED: 409 with the sentence, nothing set', async () => {
    await seed({ state: 'RESULTS#003' });
    const r = await review({ kind: 'comments', how: 'close' });
    assert.strictEqual(r.status, 409, JSON.stringify(r.body));
    assert.strictEqual(r.body.error, 'Comments can be closed once the session has ended.');
    assert.strictEqual(row('METADATA').CommentsClosedAt, undefined);
  });
  await check('after ENDED: CommentsClosedAt set, lateChanged sent, and the GET says so', async () => {
    await seed({ state: 'ENDED', stateExtra: { EndedAt: hoursAgo(1), UpdatedAt: hoursAgo(1) } });
    const r = await review({ kind: 'comments', how: 'close' });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    const at = row('METADATA').CommentsClosedAt;
    assert.ok(/^\d{4}-\d{2}-\d{2}T/.test(String(at)), at);
    assert.deepStrictEqual(lateFrames(), [{ to: 'h1', message: { type: 'lateChanged', gameId: GAME } }]);
    assert.strictEqual((await getLate()).body.commentsClosedAt, at);
    // A second press keeps the first time.
    await review({ kind: 'comments', how: 'close' });
    assert.strictEqual(row('METADATA').CommentsClosedAt, at);
  });
  await check('...and after it the late window refuses: a comment is turned away with the sentence', async () => {
    assert.strictEqual(lateWindow({ meta: row('METADATA'), state: row('STATE') }).code, 'COMMENTS_CLOSED');
    const r = await call('POST', 'POST /games/{gameId}/comments', {
      body: {
        questionNumber: 1, playerName: 'Ada', clientId: 'c-ada', anchorKind: 'summary', anchorRef: '', text: 'One more thing.',
      },
    });
    assert.strictEqual(r.status, 409, JSON.stringify(r.body));
    assert.strictEqual(r.body.error, 'Comments are closed for this session.');
  });

  say('\n6. putting it on the wall marks it reviewed with the room');
  await check('featuring a comment sets Reviewed shown; taking it down leaves it shown', async () => {
    await seed();
    const r = await call('POST', 'POST /games/{gameId}/comments/{commentId}/feature', {
      authorizer: HOST, pathParameters: { commentId: '000000000000010-aaaa' }, body: { questionNumber: 1, featured: true },
    });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    const c = row('COMMENT#001#summary##000000000000010-aaaa');
    assert.strictEqual(c.Featured, true);
    assert.strictEqual(c.Reviewed, 'shown');
    assert.ok(/^\d{4}-/.test(String(c.ReviewedAt)));
    assert.ok(lateFrames().some((f) => f.to === 'h1'), 'no lateChanged to the host');
    const off = await call('POST', 'POST /games/{gameId}/comments/{commentId}/feature', {
      authorizer: HOST, pathParameters: { commentId: '000000000000010-aaaa' }, body: { questionNumber: 1, featured: false },
    });
    assert.strictEqual(off.status, 200, JSON.stringify(off.body));
    assert.strictEqual(row('COMMENT#001#summary##000000000000010-aaaa').Reviewed, 'shown');
  });
  await check('featuring an ON-TIME comment stamps no review on it', async () => {
    await seed();
    const r = await call('POST', 'POST /games/{gameId}/comments/{commentId}/feature', {
      authorizer: HOST, pathParameters: { commentId: '000000000000005-bbbb' }, body: { questionNumber: 1, featured: true },
    });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    const c = row('COMMENT#001#summary##000000000000005-bbbb');
    assert.strictEqual(c.Featured, true);
    assert.strictEqual(c.Reviewed, null);
    assert.strictEqual(c.ReviewedAt, undefined);
    assert.strictEqual(lateFrames().length, 0);
  });
  await check('pick then unpick a late idea by its keyed id: on, then off, and it stays shown', async () => {
    await seed();
    const routeKey = 'POST /games/{gameId}/followups/{proxy+}';
    const id = idOf(`FOLLOWUP#001#ASK#${ASK}#LATE#Grace`);
    const pick = (picked) => call('POST', routeKey, { authorizer: HOST, pathParameters: { proxy: `asks/${ASK}/pick` }, body: { round: '001', id, picked } });
    assert.deepStrictEqual((await pick(true)).body.picked.map((p) => p.id), [id]);
    const off = await pick(false);
    assert.strictEqual(off.status, 200, JSON.stringify(off.body));
    assert.deepStrictEqual(off.body.picked, []);
    assert.strictEqual(row(`FOLLOWUP#001#ASK#${ASK}#LATE#Grace`).Reviewed, 'shown');
    // An id made the old way (plain sha256) names nothing.
    const old = await call('POST', routeKey, {
      authorizer: HOST, pathParameters: { proxy: `asks/${ASK}/pick` },
      body: { round: '001', id: sha(`FOLLOWUP#001#ASK#${ASK}#LATE#Grace`).slice(0, 12), picked: true },
    });
    assert.strictEqual(old.status, 404, JSON.stringify(old.body));
  });
  await check('picking a late idea through the Ideas pick sets Reviewed shown on its LATE row', async () => {
    await seed();
    const routeKey = 'POST /games/{gameId}/followups/{proxy+}';
    const id = idOf(`FOLLOWUP#001#ASK#${ASK}#LATE#Grace`);
    const r = await call('POST', routeKey, {
      authorizer: HOST, pathParameters: { proxy: `asks/${ASK}/pick` }, body: { round: '001', id, picked: true },
    });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.deepStrictEqual(r.body.picked.map((p) => p.text), ['The finance team']);
    const late = row(`FOLLOWUP#001#ASK#${ASK}#LATE#Grace`);
    assert.strictEqual(late.Reviewed, 'shown');
    assert.ok(/^\d{4}-/.test(String(late.ReviewedAt)));
    assert.ok(lateFrames().some((f) => f.to === 'h1'), 'no lateChanged to the host');
  });
  await check('picking an on-time idea writes no review onto any row', async () => {
    await seed();
    const routeKey = 'POST /games/{gameId}/followups/{proxy+}';
    const r = await call('POST', routeKey, {
      authorizer: HOST, pathParameters: { proxy: `asks/${ASK}/pick` },
      body: { round: '001', id: idOf(`FOLLOWUP#001#ASK#${ASK}#A#Bea`), picked: true },
    });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual(row(`FOLLOWUP#001#ASK#${ASK}#A#Bea`).Reviewed, undefined);
    assert.strictEqual(row(`FOLLOWUP#001#ASK#${ASK}#LATE#Grace`).Reviewed, null);
    assert.strictEqual(lateFrames().length, 0);
  });

  say('\n7. the routes (template-clean.yaml, authorizer.js)');
  await check('GET /late and POST /late/review: Cognito, events of the comments function', () => {
    const routes = routesFromTemplate();
    assertScannerWorks(routes);
    const g = findRoute(routes, 'GET', '/games/{gameId}/late');
    const p = findRoute(routes, 'POST', '/games/{gameId}/late/review');
    assert.ok(g && p, 'routes missing');
    assert.strictEqual(g.authorizer, 'CognitoAuthorizer');
    assert.strictEqual(p.authorizer, 'CognitoAuthorizer');
    const template = require('fs').readFileSync(path.join(REPO, 'template-clean.yaml'), 'utf8');
    const start = template.indexOf('\n  CommentsFunction:\n');
    const rest = template.slice(start + 1);
    const block = rest.slice(0, rest.slice(1).search(/\n {2}[A-Za-z][A-Za-z0-9]*:\n/) + 1);
    assert.ok(block.includes('Path: /games/{gameId}/late\n'), 'GET /late is not on CommentsFunction');
    assert.ok(block.includes('Path: /games/{gameId}/late/review\n'), 'POST /late/review is not on CommentsFunction');
  });
  await check('the authorizer admits hosts|admins to both', () => {
    const { requiredGroupsForRoute } = require(path.join(REPO, 'lambda-functions/auth/authorizer.js'));
    assert.deepStrictEqual(requiredGroupsForRoute('GET', 'games/{gameId}/late'), ['hosts', 'admins']);
    assert.deepStrictEqual(requiredGroupsForRoute('POST', 'games/{gameId}/late/review'), ['hosts', 'admins']);
  });

  say(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail ? 1 : 0);
})();
