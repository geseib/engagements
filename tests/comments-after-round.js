/**
 * COMMENTS AFTER THE ROUND (session flow v3 §4.4; late items plan Task 2),
 * through comments.js's public POST /games/{id}/comments, on the in-memory
 * table the follow-up suites share (tests/helpers/followup-table.js).
 *
 * The gate is "this round has been shown": ROUND#nnn exists, and the room is
 * on its RESULTS, on a later round, or ENDED inside the late window
 * (late-window.js). A comment posted while the room was elsewhere is stored
 * with AddedLater: true; every comment carries PostedDuring and Reviewed.
 *
 *   RESULTS#001, about round 1   on time: AddedLater false
 *   ASK#002, about round 1       added later, PostedDuring ASK#002
 *   ENDED 23 h ago               accepted, added later
 *   ENDED 25 h ago               refused
 *   CommentsClosedAt             refused, "Comments are closed for this session."
 *   ASK#001, no results yet      refused (never shown)
 *   VOTE#002, ROUND#002 exists   refused (stage-focus writes ROUND# on VOTE)
 *   a name that never joined     refused, as before
 *   the host's lists             a late comment broadcasts its own round, and
 *                                is never featured on the wall by itself
 *
 * Every expected value is written by hand, never read back off the handler.
 */
const suiteFinished = require('./helpers/finish-guard');
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');
const { createTable, commands } = require('./helpers/followup-table');
const { makeKmsStub, installTestKeyLoader } = require('./helpers/tenant-crypto-stub');

const table = createTable({ pageSize: 2 });
const sent = [];
class PostToConnectionCommand { constructor(i) { this.input = i; } }
class FakeApiGatewayClient { async send(cmd) { sent.push(JSON.parse(cmd.input.Data)); return {}; } }

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
installTestKeyLoader();

const { handler } = require(path.join(REPO, 'lambda-functions/game/comments.js'));
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
const GAME = '4831';
const PK = `GAME#${GAME}`;
const HOUR = 60 * 60 * 1000;
const hoursAgo = (h) => new Date(Date.now() - h * HOUR).toISOString();

const post = async (body) => {
  const routeKey = 'POST /games/{gameId}/comments';
  const res = await handler({
    routeKey,
    requestContext: { http: { method: 'POST' }, routeKey },
    pathParameters: { gameId: GAME },
    body: JSON.stringify(body),
  });
  return { status: res.statusCode, body: JSON.parse(res.body) };
};

const aComment = (over = {}) => ({
  questionNumber: 1,
  playerName: 'Ada',
  clientId: 'c-ada',
  anchorKind: 'summary',
  anchorRef: '',
  anchorLabel: 'What we heard',
  anchorExcerpt: 'Prep matters.',
  text: 'We skipped the part about cost.',
  ...over,
});

/** Round 1 shown; the room on `state`. */
function seed({ state = 'RESULTS#001', meta = {}, stateExtra = {}, rounds = ['001'] } = {}) {
  table.rows.clear();
  sent.length = 0;
  table.put({ PK, SK: 'METADATA', GameType: 'call-and-answer', orgId: ORG, ...meta });
  table.put({ PK, SK: 'STATE', State: state, ...stateExtra });
  for (const r of rounds) table.put({ PK, SK: `ROUND#${r}`, QuestionNumber: r, AuthorsRevealed: true });
  table.put({ PK, SK: 'CONNECTION#c1', ConnectionId: 'c1', ConnectionType: 'HOST' });
  table.put({ PK, SK: 'PLAYER#Ada', PlayerName: 'Ada', ClientId: 'c-ada' });
}
const commentRows = () => [...table.rows.values()]
  .filter((r) => r.PK === PK && String(r.SK).startsWith('COMMENT#'));

(async () => {
  say('\n1. on its own results: on time');
  await check('RESULTS#001, about round 1: 201, AddedLater false, PostedDuring RESULTS#001, Reviewed null', async () => {
    seed();
    const r = await post(aComment());
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    const rows = commentRows();
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].AddedLater, false);
    assert.strictEqual(rows[0].PostedDuring, 'RESULTS#001');
    assert.strictEqual(rows[0].Reviewed, null);
    assert.strictEqual(r.body.comment.addedLater, false);
  });

  say('\n2. the room has moved on');
  await check('ASK#002, about round 1: 201, AddedLater true, PostedDuring ASK#002, Reviewed null', async () => {
    seed({ state: 'ASK#002' });
    const r = await post(aComment());
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    const rows = commentRows();
    assert.strictEqual(rows.length, 1);
    assert.ok(/^COMMENT#001#summary#/.test(rows[0].SK), rows[0].SK);
    assert.strictEqual(rows[0].AddedLater, true);
    assert.strictEqual(rows[0].PostedDuring, 'ASK#002');
    assert.strictEqual(rows[0].Reviewed, null);
    assert.strictEqual(r.body.comment.addedLater, true);
  });

  await check('...sealed like any comment: the text is an envelope at rest and opens to what was sent', async () => {
    seed({ state: 'RESULTS#002', rounds: ['001', '002'] });
    const r = await post(aComment());
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    const raw = commentRows()[0];
    assert.notStrictEqual(raw.Text, 'We skipped the part about cost.');
    const open = await C.decryptItem(ORG, 'comment', raw);
    assert.strictEqual(open.Text, 'We skipped the part about cost.');
    assert.strictEqual(open.AddedLater, true);
    assert.strictEqual(open.PostedDuring, 'RESULTS#002');
  });

  await check('...the broadcast names round 1, so the host on round 2 does not count it on round 2\'s wall', async () => {
    seed({ state: 'RESULTS#002', rounds: ['001', '002'] });
    await post(aComment());
    const frame = sent.find((m) => m.type === 'commentPosted');
    assert.ok(frame, 'no commentPosted frame');
    assert.strictEqual(frame.questionNumber, '001');
    // Nothing reaches the wall without the host: never featured on arrival.
    const row = commentRows()[0];
    assert.notStrictEqual(row.Featured, true);
    assert.ok(!sent.some((m) => m.type === 'commentFeatured'), 'a commentFeatured frame went out');
  });

  say('\n3. after the session ended');
  await check('ENDED 23 h ago: 201, added later', async () => {
    seed({ state: 'ENDED', stateExtra: { EndedAt: hoursAgo(23), UpdatedAt: hoursAgo(23) } });
    const r = await post(aComment());
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    assert.strictEqual(commentRows()[0].AddedLater, true);
    assert.strictEqual(commentRows()[0].PostedDuring, 'ENDED');
  });

  await check('ENDED 25 h ago: 409, nothing written, a plain sentence', async () => {
    seed({ state: 'ENDED', stateExtra: { EndedAt: hoursAgo(25), UpdatedAt: hoursAgo(25) } });
    const r = await post(aComment());
    assert.strictEqual(r.status, 409, JSON.stringify(r.body));
    assert.strictEqual(r.body.code, 'WINDOW_CLOSED');
    assert.strictEqual(r.body.error, 'This session has closed. Nothing more can be added.');
    assert.strictEqual(commentRows().length, 0);
  });

  await check('after "Close comments" (CommentsClosedAt): 409, "Comments are closed for this session."', async () => {
    seed({ state: 'ENDED', meta: { CommentsClosedAt: hoursAgo(1) }, stateExtra: { EndedAt: hoursAgo(2) } });
    const r = await post(aComment());
    assert.strictEqual(r.status, 409, JSON.stringify(r.body));
    assert.strictEqual(r.body.code, 'COMMENTS_CLOSED');
    assert.strictEqual(r.body.error, 'Comments are closed for this session.');
    assert.strictEqual(commentRows().length, 0);
  });

  await check('...closed while the session still runs: refused on the round\'s own results too', async () => {
    seed({ meta: { CommentsClosedAt: hoursAgo(1) } });
    const r = await post(aComment());
    assert.strictEqual(r.status, 409, JSON.stringify(r.body));
    assert.strictEqual(r.body.code, 'COMMENTS_CLOSED');
    assert.strictEqual(commentRows().length, 0);
  });

  say('\n4. a round the room has not seen');
  await check('ASK#001, no results yet (no ROUND#001): 409, nothing written', async () => {
    seed({ state: 'ASK#001', rounds: [] });
    const r = await post(aComment());
    assert.strictEqual(r.status, 409, JSON.stringify(r.body));
    assert.strictEqual(r.body.code, 'NOT_SHOWN');
    assert.strictEqual(r.body.error, 'This round has not been shown yet.');
    assert.strictEqual(r.body.currentState, 'ASK#001');
    assert.strictEqual(commentRows().length, 0);
  });

  await check('VOTE#002 with a ROUND#002 row (a focus writes one on VOTE): round 2 is still refused', async () => {
    seed({ state: 'VOTE#002', rounds: ['001', '002'] });
    const r = await post(aComment({ questionNumber: 2 }));
    assert.strictEqual(r.status, 409, JSON.stringify(r.body));
    assert.strictEqual(r.body.code, 'NOT_SHOWN');
    assert.strictEqual(commentRows().length, 0);
  });

  await check('a later round number than the room is on: refused even if a ROUND# row exists', async () => {
    seed({ state: 'RESULTS#002', rounds: ['001', '002', '003'] });
    const r = await post(aComment({ questionNumber: 3 }));
    assert.strictEqual(r.status, 409, JSON.stringify(r.body));
    assert.strictEqual(commentRows().length, 0);
  });

  await check('ENDED inside the window, but the round was never shown: refused', async () => {
    seed({ state: 'ENDED', rounds: [], stateExtra: { EndedAt: hoursAgo(1) } });
    const r = await post(aComment());
    assert.strictEqual(r.status, 409, JSON.stringify(r.body));
    assert.strictEqual(r.body.code, 'NOT_SHOWN');
  });

  say('\n5. membership is unchanged');
  await check('a name that never joined: 409 "you have not joined this session", nothing written', async () => {
    seed({ state: 'ASK#002' });
    const r = await post(aComment({ playerName: 'Mallory', clientId: 'c-m' }));
    assert.strictEqual(r.status, 409, JSON.stringify(r.body));
    assert.strictEqual(r.body.error, 'you have not joined this session');
    assert.strictEqual(commentRows().length, 0);
  });

  await check('a joined name with the wrong browser: refused the same way', async () => {
    seed({ state: 'ASK#002' });
    const r = await post(aComment({ clientId: 'c-someone-else' }));
    assert.strictEqual(r.status, 409, JSON.stringify(r.body));
    assert.strictEqual(r.body.error, 'you have not joined this session');
  });

  await check('an event pause still refuses everything', async () => {
    seed({ state: 'ASK#002', stateExtra: { EventPaused: true } });
    const r = await post(aComment());
    assert.strictEqual(r.status, 409, JSON.stringify(r.body));
    assert.strictEqual(r.body.code, 'PAUSED');
  });

  say(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail ? 1 : 0);
})().catch((e) => { say(e.stack); process.exit(1); });
