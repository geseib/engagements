/**
 * LATE ANSWERS TO A QUESTION FOR THE ROOM (session flow v3 §4.4; late items
 * plan Task 1), through comments.js's handler into game/followups.js and
 * game/followup-store.js, on the paging in-memory table the follow-up suites
 * share (tests/helpers/followup-table.js).
 *
 *   on time, then late    the same person: the late one is a change, refused
 *   after "Show results"  kept as FOLLOWUP#nnn#ASK#<id>#LATE#<player>, sealed,
 *                         30 days, Reviewed null; the frozen count unchanged
 *   the round moved on    still kept, with the state it arrived during
 *   one late per person   a second late answer is refused
 *   ENDED                 kept at 23 h, refused at 25 h
 *   comments closed       CommentsClosedAt on METADATA refuses it
 *   cancelled / paused    refused, as before
 *   Ideas                 the host's list marks it late: true; the frozen
 *                         Ideas record never takes it
 *   billing               session-count.js never loaded
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
process.env.FOLLOWUP_ASKS_ENABLED = 'on';
installTestKeyLoader();

const { handler: comments } = require(path.join(REPO, 'lambda-functions/game/comments.js'));
const C = require(path.join(REPO, 'lambda-functions/game/tenant-crypto.js'));
const { lateWindow, LATE_WINDOW_HOURS } = require(path.join(REPO, 'lambda-functions/game/late-window.js'));

const logs = [];
if (!process.env.DEBUG) { console.log = (...a) => logs.push(a.join(' ')); console.warn = console.log; console.error = console.log; }
const say = (s) => process.stdout.write(s + '\n');
let pass = 0, fail = 0;
async function check(label, fn) {
  try { await fn(); say(`  PASS  ${label}`); pass++; }
  catch (e) { say(`  FAIL  ${label}\n        ${e.stack.split('\n').slice(0, 3).join('\n        ')}`); fail++; }
}

const ORG = 'org_acme';
const GAME = '4821';
const PK = `GAME#${GAME}`;
const HOST = { lambda: { userId: 'u-host', groups: 'hosts', orgId: ORG, orgIds: ORG } };
const HOUR = 60 * 60 * 1000;

const call = async (family, method, proxy, { body, query, authorizer } = {}) => {
  const routeKey = `${method} /games/{gameId}/${family}/{proxy+}`;
  const res = await comments({
    routeKey,
    requestContext: { http: { method }, routeKey, ...(authorizer ? { authorizer } : {}) },
    pathParameters: { gameId: GAME, proxy },
    queryStringParameters: query,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.statusCode, body: JSON.parse(res.body) };
};
const host = (m, p, opts = {}) => call('followups', m, p, { authorizer: HOST, ...opts });
const phone = (m, p, opts = {}) => call('followup-play', m, p, opts);
const answer = (askId, name, clientId, value, round = '003') => phone('POST', `asks/${askId}/answer`, { body: { round, playerName: name, clientId, value } });

function seed({ state = 'RESULTS#003', meta = {}, stateExtra = {} } = {}) {
  table.rows.clear();
  sent.length = 0;
  table.put({ PK, SK: 'METADATA', GameType: 'call-and-answer', orgId: ORG, QuestionSetScope: 'org', ...meta });
  table.put({ PK, SK: 'STATE', State: state, CurrentQuestionId: '003', ...stateExtra });
  table.put({ PK, SK: 'ROUND#003', QuestionNumber: '003' });
  table.put({ PK, SK: 'CONNECTION#c1', ConnectionId: 'c1', ConnectionType: 'HOST' });
  table.put({ PK, SK: 'PLAYER#Ada', PlayerName: 'Ada', ClientId: 'c-ada' });
  table.put({ PK, SK: 'PLAYER#Grace', PlayerName: 'Grace' });
  table.put({ PK, SK: 'PLAYER#Linus', PlayerName: 'Linus', ClientId: 'c-linus' });
}
const setState = (fields) => table.put({ ...table.get(PK, 'STATE'), ...fields });
const setMeta = (fields) => table.put({ ...table.get(PK, 'METADATA'), ...fields });

/** Send a Rate ask, have Ada answer on time, show the results. */
async function closedRate() {
  seed();
  const s = await host('POST', 'send', { body: { round: '003', kind: 'rate', statement: 'Rollback is cheap' } });
  assert.strictEqual(s.status, 201, JSON.stringify(s.body));
  const askId = s.body.ask.askId;
  assert.strictEqual((await answer(askId, 'Ada', 'c-ada', 4)).status, 200);
  const c = await host('POST', `asks/${askId}/close`, { body: { round: '003' } });
  assert.strictEqual(c.status, 200, JSON.stringify(c.body));
  return askId;
}

(async () => {
  say('\n1. the window (late-window.js)');
  await check('running: open; ENDED at 23 h: open; at 25 h: closed; CommentsClosedAt: closed', () => {
    const now = Date.parse('2026-10-16T12:00:00.000Z');
    const ago = (h) => new Date(now - h * HOUR).toISOString();
    assert.strictEqual(LATE_WINDOW_HOURS, 24);
    assert.strictEqual(lateWindow({ meta: {}, state: { State: 'ASK#004' }, now }).open, true);
    assert.strictEqual(lateWindow({ meta: {}, state: { State: 'ENDED', UpdatedAt: ago(23) }, now }).open, true);
    const late = lateWindow({ meta: {}, state: { State: 'ENDED', UpdatedAt: ago(25) }, now });
    assert.strictEqual(late.open, false);
    assert.strictEqual(late.code, 'WINDOW_CLOSED');
    const shut = lateWindow({ meta: { CommentsClosedAt: ago(1) }, state: { State: 'RESULTS#003' }, now });
    assert.strictEqual(shut.open, false);
    assert.strictEqual(shut.code, 'COMMENTS_CLOSED');
    assert.strictEqual(shut.error, 'Comments are closed for this session.');
    // EndedAt wins over UpdatedAt, which a later STATE write (a display
    // profile change) moves: ended 25 h ago, touched 1 h ago, is closed.
    assert.strictEqual(lateWindow({ meta: {}, state: { State: 'ENDED', EndedAt: ago(25), UpdatedAt: ago(1) }, now }).open, false);
    // An ENDED session with no time to measure from is not guessed open.
    assert.strictEqual(lateWindow({ meta: {}, state: { State: 'ENDED' }, now }).open, false);
  });

  say('\n2. on time, then late, from the same person');
  await check('the late one is a change: 409, no LATE row', async () => {
    const askId = await closedRate();
    const r = await answer(askId, 'Ada', 'c-ada', 1);
    assert.strictEqual(r.status, 409, JSON.stringify(r.body));
    assert.strictEqual(r.body.code, 'ALREADY_ANSWERED');
    assert.strictEqual(table.get(PK, `FOLLOWUP#003#ASK#${askId}#LATE#Ada`), undefined);
    assert.strictEqual(table.get(PK, `FOLLOWUP#003#ASK#${askId}#A#Ada`) !== undefined, true);
  });

  say('\n3. after "Show results"');
  await check('kept, sealed, 30 days, Reviewed null, and the count does not move', async () => {
    const askId = await closedRate();
    const before = table.get(PK, `FOLLOWUP#003#ASK#${askId}`).Tally;
    const r = await answer(askId, 'Linus', 'c-linus', 2);
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual(r.body.late, true);
    // One transaction: no on-time row for this person, and the LATE put.
    const tx = table.log.filter((l) => l.type === 'transact').pop();
    const cc = tx.input.TransactItems[0].ConditionCheck;
    assert.strictEqual(cc.Key.SK, `FOLLOWUP#003#ASK#${askId}#A#Linus`);
    assert.strictEqual(cc.ConditionExpression, 'attribute_not_exists(SK)');
    assert.strictEqual(tx.input.TransactItems[1].Put.Item.SK, `FOLLOWUP#003#ASK#${askId}#LATE#Linus`);
    const row = table.get(PK, `FOLLOWUP#003#ASK#${askId}#LATE#Linus`);
    assert.ok(row, 'no LATE row');
    assert.strictEqual(row.Kind, 'rate');
    assert.strictEqual(row.ArrivedDuring, 'RESULTS#003');
    assert.ok(row.SubmittedAt);
    assert.strictEqual(row.Reviewed, null);
    assert.ok(C.isEnvelope(row.Value), 'Value is not sealed');
    assert.ok(C.isEnvelope(row.Text), 'Text is not sealed');
    const days = (row.ttl - Math.floor(Date.now() / 1000)) / 86400;
    assert.ok(days > 29.9 && days <= 30, `ttl ${days} days`);
    assert.deepStrictEqual(table.get(PK, `FOLLOWUP#003#ASK#${askId}`).Tally, before, 'the frozen count moved');
    const h = await host('GET', 'round/003');
    assert.deepStrictEqual(h.body.asks[0].tally, { n: 1, counts: [0, 0, 0, 1, 0], mean: 4 });
    const p = await phone('GET', 'live');
    assert.deepStrictEqual(p.body.ask.tally, { n: 1, counts: [0, 0, 0, 1, 0], mean: 4 });
  });
  await check('one late answer per person: a second is refused', async () => {
    const askId = await closedRate();
    assert.strictEqual((await answer(askId, 'Linus', 'c-linus', 2)).status, 200);
    const again = await answer(askId, 'Linus', 'c-linus', 5);
    assert.strictEqual(again.status, 409);
    assert.strictEqual(again.body.code, 'ALREADY_ANSWERED');
  });
  await check('the late answer is still checked: membership and shape', async () => {
    const askId = await closedRate();
    assert.strictEqual((await answer(askId, 'Linus', 'c-wrong', 2)).status, 409);
    assert.strictEqual((await answer(askId, 'Linus', 'c-linus', 9)).status, 400);
    assert.strictEqual(table.prefix(PK, `FOLLOWUP#003#ASK#${askId}#LATE#`).length, 0);
  });

  await check('the host hears of it: lateChanged, to hosts only, beside followUpChanged', async () => {
    const askId = await closedRate();
    sent.length = 0;
    const r = await answer(askId, 'Linus', 'c-linus', 2);
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.ok(sent.some((f) => f.type === 'followUpChanged' && f.status === 'late'), JSON.stringify(sent));
    const late = sent.filter((f) => f.type === 'lateChanged');
    assert.strictEqual(late.length, 1, JSON.stringify(sent));
    assert.deepStrictEqual(late[0], { type: 'lateChanged', gameId: GAME });
  });
  await check('an on-time answer sends no lateChanged', async () => {
    seed();
    const s = await host('POST', 'send', { body: { round: '003', kind: 'rate', statement: 'Rollback is cheap' } });
    sent.length = 0;
    assert.strictEqual((await answer(s.body.ask.askId, 'Ada', 'c-ada', 4)).status, 200);
    assert.strictEqual(sent.some((f) => f.type === 'lateChanged'), false, JSON.stringify(sent));
  });

  say('\n4. the round moved on');
  await check('kept, with the state it arrived during', async () => {
    const askId = await closedRate();
    setState({ State: 'ASK#004', CurrentQuestionId: '004' });
    const r = await answer(askId, 'Grace', undefined, 5);
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual(r.body.late, true);
    assert.strictEqual(table.get(PK, `FOLLOWUP#003#ASK#${askId}#LATE#Grace`).ArrivedDuring, 'ASK#004');
  });

  say('\n5. after ENDED');
  await check('23 h after ENDED: kept', async () => {
    const askId = await closedRate();
    setState({ State: 'ENDED', UpdatedAt: new Date(Date.now() - 23 * HOUR).toISOString() });
    const r = await answer(askId, 'Grace', undefined, 5);
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual(table.get(PK, `FOLLOWUP#003#ASK#${askId}#LATE#Grace`).ArrivedDuring, 'ENDED');
  });
  await check('25 h after ENDED: refused with a plain message, nothing written', async () => {
    const askId = await closedRate();
    setState({ State: 'ENDED', UpdatedAt: new Date(Date.now() - 25 * HOUR).toISOString() });
    const r = await answer(askId, 'Grace', undefined, 5);
    assert.strictEqual(r.status, 409);
    assert.strictEqual(r.body.code, 'WINDOW_CLOSED');
    assert.ok(/closed/i.test(r.body.error), r.body.error);
    assert.strictEqual(table.prefix(PK, `FOLLOWUP#003#ASK#${askId}#LATE#`).length, 0);
  });

  await check('EndedAt 25 h ago, UpdatedAt 1 h ago (a later profile change): refused', async () => {
    const askId = await closedRate();
    setState({ State: 'ENDED', EndedAt: new Date(Date.now() - 25 * HOUR).toISOString(), UpdatedAt: new Date(Date.now() - HOUR).toISOString() });
    const r = await answer(askId, 'Grace', undefined, 5);
    assert.strictEqual(r.status, 409);
    assert.strictEqual(r.body.code, 'WINDOW_CLOSED');
  });

  say('\n6. after "Close comments"');
  await check('CommentsClosedAt refuses it', async () => {
    const askId = await closedRate();
    setMeta({ CommentsClosedAt: new Date().toISOString() });
    const r = await answer(askId, 'Grace', undefined, 5);
    assert.strictEqual(r.status, 409);
    assert.strictEqual(r.body.code, 'COMMENTS_CLOSED');
    assert.strictEqual(r.body.error, 'Comments are closed for this session.');
    assert.strictEqual(table.prefix(PK, `FOLLOWUP#003#ASK#${askId}#LATE#`).length, 0);
  });

  say('\n7. still refused');
  await check('a cancelled question takes no late answers', async () => {
    seed();
    const s = await host('POST', 'send', { body: { round: '003', kind: 'rate', statement: 'Gone' } });
    await host('POST', `asks/${s.body.ask.askId}/cancel`, { body: { round: '003' } });
    const r = await answer(s.body.ask.askId, 'Grace', undefined, 5);
    assert.strictEqual(r.status, 409);
    assert.strictEqual(r.body.code, 'NOT_LIVE');
  });
  await check('a paused event refuses everything, as now', async () => {
    const askId = await closedRate();
    setState({ EventPaused: true });
    const r = await answer(askId, 'Grace', undefined, 5);
    assert.strictEqual(r.status, 409);
    assert.strictEqual(r.body.code, 'PAUSED');
  });
  await check('an on-time answer is still on time (no late flag)', async () => {
    seed();
    const s = await host('POST', 'send', { body: { round: '003', kind: 'rate', statement: 'Now' } });
    const r = await answer(s.body.ask.askId, 'Grace', undefined, 5);
    assert.strictEqual(r.status, 200);
    assert.ok(!r.body.late);
  });

  say('\n8. Ideas');
  await check('a late idea joins the host\'s list marked late, and never the frozen Ideas', async () => {
    seed();
    const s = await host('POST', 'send', { body: { round: '003', kind: 'ideas', question: 'Who pushes back first?' } });
    const askId = s.body.ask.askId;
    assert.strictEqual((await answer(askId, 'Ada', 'c-ada', 'The agencies')).status, 200);
    await host('POST', `asks/${askId}/close`, { body: { round: '003' } });
    const frozenBefore = table.get(PK, `FOLLOWUP#003#ASK#${askId}`).Ideas;
    const r = await answer(askId, 'Linus', 'c-linus', 'The finance team');
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual(r.body.late, true);
    const h = await host('GET', 'round/003');
    const ask = h.body.asks.find((a) => a.askId === askId);
    assert.deepStrictEqual(ask.ideas.map((i) => [i.text, Boolean(i.late)]), [['The agencies', false], ['The finance team', true]]);
    assert.deepStrictEqual(ask.tally, { n: 1 });
    assert.deepStrictEqual(table.get(PK, `FOLLOWUP#003#ASK#${askId}`).Ideas, frozenBefore, 'the frozen Ideas changed');
    // The host can still put a late idea on the wall (Task 3 reuses the pick).
    const lateIdea = ask.ideas.find((i) => i.late);
    const on = await host('POST', `asks/${askId}/pick`, { body: { round: '003', id: lateIdea.id, picked: true } });
    assert.strictEqual(on.status, 200, JSON.stringify(on.body));
    assert.deepStrictEqual(on.body.picked.map((p) => p.text), ['The finance team']);
  });

  await check('billing: session-count.js is never loaded', () => {
    assert.deepStrictEqual(Object.keys(require.cache).filter((p) => /session-count\.js$/.test(p)), []);
  });
  await check('the logs never carry an answer or a name', () => {
    const all = logs.join('\n');
    for (const bit of ['finance team', 'agencies', 'Linus', 'Grace']) assert.ok(!all.includes(bit), bit);
  });

  say(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail ? 1 : 0);
})().catch((e) => { say(`CRASH ${e.stack}`); process.exit(1); });
