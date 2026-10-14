/**
 * THE FOLLOW-UP ROUTES AND ROWS (game/followups.js through comments.js's
 * handler, game/followup-store.js, and next-question.js's close), against a
 * paging in-memory table that runs transactions and conditions as DynamoDB
 * does (tests/helpers/followup-table.js).
 *
 *   switch off            every route 404s, nothing read past the switch
 *   the host              a rival org's host is refused (404); the round
 *                         read carries suggestions, asks and counts
 *   send                  only on this round's RESULTS, only Call & Answer,
 *                         one live at a time per session (a race too); the
 *                         origin is decided from the stored suggestion
 *   answers               the comments gate: a member, the stamped ClientId,
 *                         the right shape; a change overwrites; refused once
 *                         closed; conflicts retried, never misread as closed
 *   close                 freezes the count; it survives the answer rows'
 *                         7-day expiry; cancel shows nothing to phones
 *   phones                never `why`, FromAnswers, the origin, suggestions
 *                         or a name; counts only after close
 *   at rest               sealed under the session's org; the TTLs of SPEC §5
 *   next round            closes a live ask first, with its count
 *   billing               nothing reaches session-count.js
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

const { handler: comments } = require(path.join(REPO, 'lambda-functions/game/comments.js'));
const { handler: nextQuestion } = require(path.join(REPO, 'lambda-functions/game/next-question.js'));
const store = require(path.join(REPO, 'lambda-functions/game/followup-store.js'));
const C = require(path.join(REPO, 'lambda-functions/game/tenant-crypto.js'));
const { isEnvelope } = C;
const { DAY } = require(path.join(REPO, 'lambda-functions/game/session-ttl.js'));

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
const RIVAL = { lambda: { userId: 'u-rival', groups: 'hosts', orgId: 'org_rival', orgIds: 'org_rival' } };

const call = async (family, method, proxy, { body, query, authorizer, gameId = GAME } = {}) => {
  const routeKey = `${method} /games/{gameId}/${family}/{proxy+}`;
  const res = await comments({
    routeKey,
    requestContext: { http: { method }, routeKey, ...(authorizer ? { authorizer } : {}) },
    pathParameters: { gameId, proxy },
    queryStringParameters: query,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.statusCode, body: JSON.parse(res.body) };
};
const host = (m, p, opts = {}) => call('followups', m, p, { authorizer: HOST, ...opts });
const phone = (m, p, opts = {}) => call('followup-play', m, p, opts);
const answer = (askId, name, clientId, value, round = '003') => phone('POST', `asks/${askId}/answer`, { body: { round, playerName: name, clientId, value } });

const SUGGESTED = {
  asks: [
    { type: 'rate', statement: 'Code can be rolled back; a bad backfill cannot.', answers: [3], why: 'Tests the backfill line.', anchor: { section: 'Discussion topics', point: 2 }, marks: [] },
    { type: 'choice', question: 'What do you read first?', answers: [1, 2], why: 'Settles the split.', marks: ['reworded'],
      options: [{ text: 'the interface diff', answer: 1, marks: [] }, { text: 'security files', answer: 2, marks: ['reworded'] }] },
  ],
  dropped: 1, reasons: { names: 1 }, raw: 3, model: 'us.anthropic.claude-sonnet-4-6', servedBy: 'claude-sonnet-5-5', ms: 6100, reason: null, promptVersion: 'v-test',
};

async function seed({ gameType = 'call-and-answer', state = 'RESULTS#003', orgId = ORG } = {}) {
  table.rows.clear();
  sent.length = 0;
  table.put({ PK, SK: 'METADATA', GameType: gameType, ...(orgId ? { orgId } : {}), QuestionSetScope: orgId ? 'org' : '' });
  table.put({ PK, SK: 'STATE', State: state, CurrentQuestionId: '003' });
  table.put({ PK, SK: 'ROUND#003', QuestionNumber: '003' });
  table.put({ PK, SK: 'CONNECTION#c1', ConnectionId: 'c1', ConnectionType: 'HOST' });
  table.put({ PK, SK: 'PLAYER#Ada', PlayerName: 'Ada', ClientId: 'c-ada' });
  table.put({ PK, SK: 'PLAYER#Grace', PlayerName: 'Grace' });
  table.put({ PK, SK: 'PLAYER#Linus', PlayerName: 'Linus', ClientId: 'c-linus' });
  table.put({ PK, SK: 'PLAYER#Barbara', PlayerName: 'Barbara', ClientId: 'c-barbara' });
  await store.writeSuggestions(table.doc, { gameId: GAME, round: '003', orgId, forSummaryAt: '2026-10-11T10:00:00.000Z', result: SUGGESTED });
}
const followUpRows = () => table.prefix(PK, 'FOLLOWUP#');

(async () => {
  say('\n1. switched off');
  delete process.env.FOLLOWUP_ASKS_ENABLED;
  await seed();
  for (const [label, run] of [
    ['the host round read', () => host('GET', 'round/003')],
    ['send', () => host('POST', 'send', { body: { round: '003', kind: 'rate', statement: 'x' } })],
    ['the phone read', () => phone('GET', 'live')],
    ['an answer', () => answer('abc123def', 'Ada', 'c-ada', 5)],
  ]) {
    await check(`${label}: 404`, async () => assert.strictEqual((await run()).status, 404));
  }
  await check('and with "off", "true" or "ON " it is still off unless exactly on', async () => {
    for (const v of ['off', 'true', '1']) {
      process.env.FOLLOWUP_ASKS_ENABLED = v;
      assert.strictEqual((await host('GET', 'round/003')).status, 404, v);
    }
    process.env.FOLLOWUP_ASKS_ENABLED = ' ON ';
    assert.strictEqual((await host('GET', 'round/003')).status, 200);
  });
  await check('the comments routes beside them are untouched by the switch', async () => {
    delete process.env.FOLLOWUP_ASKS_ENABLED;
    const routeKey = 'GET /games/{gameId}/comments';
    const res = await comments({ routeKey, requestContext: { http: { method: 'GET' }, routeKey }, pathParameters: { gameId: GAME }, queryStringParameters: { questionNumber: '3' } });
    assert.strictEqual(res.statusCode, 200);
  });

  process.env.FOLLOWUP_ASKS_ENABLED = 'on';

  say('\n2. the host');
  await seed();
  await check('a rival org\'s host gets 404 on every host route', async () => {
    for (const [m, p, body] of [['GET', 'round/003'], ['GET', 'rounds'], ['POST', 'send', { round: '003', kind: 'rate', statement: 'x' }]]) {
      assert.strictEqual((await call('followups', m, p, { authorizer: RIVAL, body })).status, 404, p);
    }
  });
  await check('no identity at all on the host family: 404', async () => {
    assert.strictEqual((await call('followups', 'GET', 'round/003')).status, 404);
  });
  await check('the round read: the suggestions with why and marks, opened', async () => {
    const r = await host('GET', 'round/003');
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual(r.body.suggestions.asks.length, 2);
    assert.strictEqual(r.body.suggestions.asks[0].why, 'Tests the backfill line.');
    assert.deepStrictEqual(r.body.suggestions.dropReasons, { names: 1 });
    assert.strictEqual(r.body.suggestions.servedBy, 'claude-sonnet-5-5');
    assert.deepStrictEqual(r.body.asks, []);
    assert.strictEqual(r.body.live, null);
  });
  await check('the measurement read lists every round\'s suggestions', async () => {
    await store.writeSuggestions(table.doc, { gameId: GAME, round: '001', orgId: ORG, forSummaryAt: 'x', result: { asks: [], reason: 'no-tool-call', model: 'm' } });
    const r = await host('GET', 'rounds');
    assert.deepStrictEqual(r.body.rounds.map((x) => [x.round, x.kept, x.reason]), [['001', 0, 'no-tool-call'], ['003', 2, null]]);
  });
  await check('the SUGGESTED row is sealed, 30-day ttl, counts in the clear', async () => {
    const row = table.get(PK, 'FOLLOWUP#003#SUGGESTED');
    assert.ok(isEnvelope(row.Asks));
    assert.ok(!JSON.stringify(row).includes('backfill'));
    assert.strictEqual(row.Kept, 2);
    assert.deepStrictEqual(row.DropReasons, { names: 1 });
    const days = (row.ttl - Date.parse(row.CreatedAt) / 1000) / DAY;
    assert.ok(Math.abs(days - 30) < 0.01, String(days));
  });

  say('\n3. send');
  await check('a bad body: 400 with words the host can act on', async () => {
    const r = await host('POST', 'send', { body: { round: '003', kind: 'choice', question: 'Q?', options: [{ text: 'only one' }] } });
    assert.strictEqual(r.status, 400);
    assert.match(r.body.error, /at least 2 options/);
  });
  await check('not on this round\'s results: 409, nothing written', async () => {
    const before = followUpRows().length;
    const r = await host('POST', 'send', { body: { round: '002', kind: 'rate', statement: 'x' } });
    assert.strictEqual(r.status, 409);
    assert.strictEqual(r.body.code, 'NOT_ON_SCREEN');
    assert.strictEqual(followUpRows().length, before);
  });
  await check('a stale suggestion index: 409', async () => {
    const r = await host('POST', 'send', { body: { round: '003', kind: 'rate', statement: 'x', suggestionIndex: 7 } });
    assert.strictEqual(r.body.code, 'STALE_SUGGESTION');
  });
  let rateId;
  await check('sent as suggested: 201, origin "suggested", cited answers kept, broadcast without words', async () => {
    const r = await host('POST', 'send', { body: { round: '003', kind: 'rate', statement: 'Code can be rolled back; a bad backfill cannot.', suggestionIndex: 0 } });
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    rateId = r.body.ask.askId;
    assert.strictEqual(r.body.ask.origin, 'suggested');
    assert.deepStrictEqual(r.body.ask.fromAnswers, [3]);
    assert.strictEqual(r.body.ask.status, 'live');
    const frame = sent.find((m) => m.type === 'followUpChanged' && m.status === 'live');
    assert.ok(frame);
    assert.ok(!JSON.stringify(frame).includes('backfill'));
  });
  await check('the ask row is sealed, ttl 30 days from sending; the LIVE pointer 7', async () => {
    const row = table.get(PK, `FOLLOWUP#003#ASK#${rateId}`);
    assert.ok(isEnvelope(row.Statement));
    assert.strictEqual(row.Status, 'live');
    assert.ok(Math.abs((row.ttl - Date.parse(row.SentAt) / 1000) / DAY - 30) < 0.01);
    const live = table.get(PK, 'FOLLOWUP#LIVE');
    assert.strictEqual(live.AskId, rateId);
    assert.ok(Math.abs((live.ttl - Date.parse(live.SentAt) / 1000) / DAY - 7) < 0.01);
  });
  await check('a second send while one is live: 409 "Finish the open question first"', async () => {
    const r = await host('POST', 'send', { body: { round: '003', kind: 'rate', statement: 'Another' } });
    assert.strictEqual(r.status, 409);
    assert.strictEqual(r.body.error, 'Finish the open question first');
  });

  say('\n4. answers');
  await check('a name that never joined: 409, nothing written', async () => {
    const r = await answer(rateId, 'Mallory', 'c-m', 5);
    assert.strictEqual(r.status, 409);
    assert.match(r.body.error, /not joined/);
    assert.strictEqual(table.prefix(PK, `FOLLOWUP#003#ASK#${rateId}#A#`).length, 0);
  });
  await check('somebody else\'s stamped name without their ClientId: 409', async () => {
    assert.strictEqual((await answer(rateId, 'Ada', 'c-wrong', 5)).status, 409);
    assert.strictEqual((await answer(rateId, 'Ada', undefined, 5)).status, 409);
  });
  await check('a value of the wrong shape: 400', async () => {
    for (const v of [[0], 'yes', 6, null, 2.5]) {
      assert.strictEqual((await answer(rateId, 'Ada', 'c-ada', v)).status, 400, JSON.stringify(v));
    }
  });
  await check('members answer; a row with no stamp is admitted on membership alone', async () => {
    assert.strictEqual((await answer(rateId, 'Ada', 'c-ada', 5)).status, 200);
    assert.strictEqual((await answer(rateId, 'Grace', undefined, 1)).status, 200);
    assert.strictEqual((await answer(rateId, 'Linus', 'c-linus', 3)).status, 200);
  });
  await check('a change overwrites: one row per person', async () => {
    assert.strictEqual((await answer(rateId, 'Grace', undefined, 5)).status, 200);
    const rows = table.prefix(PK, `FOLLOWUP#003#ASK#${rateId}#A#`);
    assert.strictEqual(rows.length, 3);
  });
  await check('a transaction conflict (a room answering at once) is retried, not refused', async () => {
    table.conflictNext(2);
    assert.strictEqual((await answer(rateId, 'Barbara', 'c-barbara', 5)).status, 200);
  });
  await check('answer rows: Value and Text sealed, 7-day ttl, the name in the key only as on every player row', async () => {
    const row = table.get(PK, `FOLLOWUP#003#ASK#${rateId}#A#Ada`);
    assert.ok(isEnvelope(row.Value) && isEnvelope(row.Text));
    assert.ok(Math.abs((row.ttl - Date.parse(row.At) / 1000) / DAY - 7) < 0.01);
  });
  await check('the host sees the live count; a phone sees the words and no count yet', async () => {
    const h = await host('GET', 'round/003');
    assert.deepStrictEqual(h.body.asks[0].tally, { n: 4, counts: [0, 0, 1, 0, 3], mean: 4.5 });
    const p = await phone('GET', 'live', { query: { playerName: 'Ada', clientId: 'c-ada' } });
    assert.strictEqual(p.body.ask.statement, 'Code can be rolled back; a bad backfill cannot.');
    assert.deepStrictEqual(p.body.ask.scale, { lowLabel: 'Disagree', highLabel: 'Agree' });
    assert.ok(!('tally' in p.body.ask));
    assert.deepStrictEqual(p.body.yours, 5);
  });
  await check('a phone never gets why, FromAnswers, the origin, a suggestion or a name', async () => {
    const p = await phone('GET', 'live', { query: { playerName: 'Ada', clientId: 'c-ada' } });
    const text = JSON.stringify(p.body);
    for (const bit of ['why', 'fromAnswers', 'FromAnswers', 'origin', 'Origin', 'suggest', 'Tests the backfill', 'Grace', 'Linus', 'Ada"']) {
      assert.ok(!text.includes(bit), bit);
    }
    const wrong = await phone('GET', 'live', { query: { playerName: 'Ada', clientId: 'c-wrong' } });
    assert.ok(!('yours' in wrong.body), 'somebody else\'s answer was handed out');
  });

  say('\n5. close');
  await check('close freezes the count and frees the session', async () => {
    const r = await host('POST', `asks/${rateId}/close`, { body: { round: '003' } });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.deepStrictEqual(r.body.ask.tally, { n: 4, counts: [0, 0, 1, 0, 3], mean: 4.5 });
    assert.strictEqual(table.get(PK, 'FOLLOWUP#LIVE'), undefined);
    const row = table.get(PK, `FOLLOWUP#003#ASK#${rateId}`);
    assert.strictEqual(row.Status, 'closed');
    assert.ok(isEnvelope(row.Tally));
  });
  await check('an answer after close: 409, nothing written', async () => {
    const r = await answer(rateId, 'Ada', 'c-ada', 1);
    assert.strictEqual(r.status, 409);
    assert.strictEqual(r.body.code, 'NOT_LIVE');
  });
  await check('closing twice: 409', async () => {
    assert.strictEqual((await host('POST', `asks/${rateId}/close`, { body: { round: '003' } })).status, 409);
  });
  await check('phones see the same counts as the Stage after close', async () => {
    const p = await phone('GET', 'live');
    assert.deepStrictEqual(p.body.ask.tally, { n: 4, counts: [0, 0, 1, 0, 3], mean: 4.5 });
    assert.ok(!JSON.stringify(p.body.ask.tally).includes('%'));
  });
  await check('the frozen count survives the answer rows expiring at 7 days', async () => {
    for (const row of table.prefix(PK, `FOLLOWUP#003#ASK#${rateId}#A#`)) table.remove(row.PK, row.SK);
    const h = await host('GET', 'round/003');
    assert.deepStrictEqual(h.body.asks[0].tally, { n: 4, counts: [0, 0, 1, 0, 3], mean: 4.5 });
  });

  say('\n6. a pick-one, edited, then cancelled');
  let choiceId;
  await check('one option reworded by the host: origin "edited", that option is the host\'s words', async () => {
    const r = await host('POST', 'send', { body: {
      round: '003', kind: 'choice', question: 'What do you read first?', suggestionIndex: 1,
      options: [{ text: 'the interface diff', answer: 1 }, { text: 'the security files', answer: 2 }],
    } });
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    choiceId = r.body.ask.askId;
    assert.strictEqual(r.body.ask.origin, 'edited');
    assert.deepStrictEqual(r.body.ask.options, [{ text: 'the interface diff', answer: 1 }, { text: 'the security files', ownWords: true }]);
  });
  await check('one pick only; an index past the options is refused', async () => {
    assert.strictEqual((await answer(choiceId, 'Ada', 'c-ada', [0, 1])).status, 400);
    assert.strictEqual((await answer(choiceId, 'Ada', 'c-ada', [2])).status, 400);
    assert.strictEqual((await answer(choiceId, 'Ada', 'c-ada', [1])).status, 200);
  });
  await check('cancel: no count, and phones go back to the last shown ask', async () => {
    const r = await host('POST', `asks/${choiceId}/cancel`, { body: { round: '003' } });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.ask.status, 'cancelled');
    assert.strictEqual(r.body.ask.tally, null);
    const p = await phone('GET', 'live');
    assert.strictEqual(p.body.ask.askId, rateId);
  });

  say('\n7. one live ask at a time, under a race');
  await check('two sends at once: exactly one goes live', async () => {
    const both = await Promise.all([
      host('POST', 'send', { body: { round: '003', kind: 'rate', statement: 'First' } }),
      host('POST', 'send', { body: { round: '003', kind: 'rate', statement: 'Second' } }),
    ]);
    assert.deepStrictEqual(both.map((r) => r.status).sort(), [201, 409]);
  });

  say('\n8. next round closes a live ask first, with its count');
  await check('the live ask is closed and counted before the room moves', async () => {
    const live = table.get(PK, 'FOLLOWUP#LIVE');
    assert.ok(live, 'no live ask to close');
    assert.strictEqual((await answer(live.AskId, 'Linus', 'c-linus', 1)).status, 200);
    const routeKey = 'POST /games/{gameId}/next-question';
    await nextQuestion({ routeKey, requestContext: { http: { method: 'POST' }, routeKey, authorizer: HOST }, pathParameters: { gameId: GAME }, body: '{}' });
    const row = table.get(PK, `FOLLOWUP#003#ASK#${live.AskId}`);
    assert.strictEqual(row.Status, 'closed');
    const opened = await C.decryptItem(ORG, 'followup', row);
    assert.deepStrictEqual(opened.Tally, { n: 1, counts: [1, 0, 0, 0, 0], mean: 1 });
    assert.strictEqual(table.get(PK, 'FOLLOWUP#LIVE'), undefined);
    assert.ok(sent.some((m) => m.type === 'followUpChanged' && m.status === 'closed'));
  });
  await check('with the switch off, next-question reads no follow-up row at all', async () => {
    delete process.env.FOLLOWUP_ASKS_ENABLED;
    table.log.length = 0;
    const routeKey = 'POST /games/{gameId}/next-question';
    await nextQuestion({ routeKey, requestContext: { http: { method: 'POST' }, routeKey, authorizer: HOST }, pathParameters: { gameId: GAME }, body: '{}' });
    assert.ok(!table.log.some((e) => JSON.stringify(e.input).includes('FOLLOWUP')));
    process.env.FOLLOWUP_ASKS_ENABLED = 'on';
  });
  await check('a stale live ask (the room moved on without next-question) is closed on the host\'s next read', async () => {
    await seed();
    const s = await host('POST', 'send', { body: { round: '003', kind: 'rate', statement: 'Stale' } });
    table.put({ PK, SK: 'STATE', State: 'RESULTS#004', CurrentQuestionId: '004' });
    await host('GET', 'round/004');
    assert.strictEqual(table.get(PK, `FOLLOWUP#003#ASK#${s.body.ask.askId}`).Status, 'closed');
    assert.strictEqual(table.get(PK, 'FOLLOWUP#LIVE'), undefined);
  });

  say('\n9. scope');
  await check('send refuses a session that is not Call & Answer', async () => {
    await seed({ gameType: 'poll' });
    const r = await host('POST', 'send', { body: { round: '003', kind: 'rate', statement: 'x' } });
    assert.strictEqual(r.body.code, 'NOT_CALL_AND_ANSWER');
  });
  await check('an orgless session keeps plaintext, as every row of it does', async () => {
    await seed({ orgId: '' });
    const r = await host('POST', 'send', { body: { round: '003', kind: 'rate', statement: 'Plain words' } });
    assert.strictEqual(r.status, 201);
    assert.strictEqual(table.get(PK, `FOLLOWUP#003#ASK#${r.body.ask.askId}`).Statement, 'Plain words');
  });
  await check('nothing outside FOLLOWUP# rows is written by the routes, but the round\'s beat', async () => {
    await seed();
    const writes = (from) => table.log.slice(from).filter((e) => ['put', 'update', 'delete', 'transact'].includes(e.type));
    const from = table.log.length;
    const s = await host('POST', 'send', { body: { round: '003', kind: 'rate', statement: 'x' } });
    await answer(s.body.ask.askId, 'Ada', 'c-ada', 5);
    await host('POST', `asks/${s.body.ask.askId}/close`, { body: { round: '003' } });
    const keys = writes(from).flatMap((e) => (e.type === 'transact'
      ? e.input.TransactItems.map((t) => (t.Put ? t.Put.Item.SK : (t.ConditionCheck || t.Update || t.Delete).Key.SK))
      : [e.input.Item ? e.input.Item.SK : e.input.Key.SK]));
    assert.ok(keys.length > 0);
    for (const sk of keys) assert.ok(sk.startsWith('FOLLOWUP#') || sk === 'ROUND#003', sk);
    // The round row gets its beat and nothing else.
    const roundWrites = writes(from).filter((e) => e.input.Key && e.input.Key.SK === 'ROUND#003');
    for (const w of roundWrites) assert.ok(!/AuthorsRevealed/.test(w.input.UpdateExpression), w.input.UpdateExpression);
  });

  say('\n10. the ask beat, the anchor, and Ideas (docs/design/followup-icons)');
  await check('send moves the round to the ask beat and tells every screen; the anchor rides along', async () => {
    await seed();
    sent.length = 0;
    const r = await host('POST', 'send', { body: { round: '003', kind: 'rate', statement: 'Code can be rolled back; a bad backfill cannot.', suggestionIndex: 0 } });
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    assert.strictEqual(table.get(PK, 'ROUND#003').StageBeat, 'ask');
    assert.ok(sent.some((m) => m.type === 'stageBeatChanged' && m.beat === 'ask'));
    assert.deepStrictEqual(r.body.ask.anchor, { section: 'Discussion topics', point: 2 });
    const opened = await C.decryptItem(ORG, 'followup', table.get(PK, `FOLLOWUP#003#ASK#${r.body.ask.askId}`));
    assert.deepStrictEqual(opened.Anchor, { section: 'Discussion topics', point: 2 });
  });
  await check('cancel returns the round to the read; close keeps the ask beat for the results', async () => {
    const live = table.get(PK, 'FOLLOWUP#LIVE');
    await host('POST', `asks/${live.AskId}/cancel`, { body: { round: '003' } });
    assert.strictEqual(table.get(PK, 'ROUND#003').StageBeat, 'field-notes');
    const s2 = await host('POST', 'send', { body: { round: '003', kind: 'rate', statement: 'Second try' } });
    await host('POST', `asks/${s2.body.ask.askId}/close`, { body: { round: '003' } });
    assert.strictEqual(table.get(PK, 'ROUND#003').StageBeat, 'ask');
  });
  let ideasId;
  await check('an Ideas question: the host sees the words with ids and no names; phones see nothing until picked', async () => {
    await seed();
    const r = await host('POST', 'send', { body: { round: '003', kind: 'ideas', question: 'Which customer pushes back first?' } });
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    ideasId = r.body.ask.askId;
    assert.strictEqual((await answer(ideasId, 'Ada', 'c-ada', 'The two agencies on fixed budgets')).status, 200);
    assert.strictEqual((await answer(ideasId, 'Grace', undefined, 'Anyone from the discount push')).status, 200);
    assert.strictEqual((await answer(ideasId, 'Linus', 'c-linus', '   ')).status, 400);
    await host('POST', `asks/${ideasId}/close`, { body: { round: '003' } });
    const h = await host('GET', 'round/003');
    const ask = h.body.asks.find((a) => a.askId === ideasId);
    assert.deepStrictEqual(ask.ideas.map((i) => i.text), ['The two agencies on fixed budgets', 'Anyone from the discount push']);
    assert.ok(!JSON.stringify(ask.ideas).includes('Ada') && !JSON.stringify(ask.ideas).includes('Grace'));
    assert.deepStrictEqual(ask.tally, { n: 2 });
    const p = await phone('GET', 'live');
    assert.deepStrictEqual(p.body.ask.picked, []);
    assert.ok(!JSON.stringify(p.body).includes('agencies'));
  });
  await check('picking an idea puts its words (and only its words) on the wall; unpicking takes it down', async () => {
    const h = await host('GET', 'round/003');
    const [first] = h.body.asks.find((a) => a.askId === ideasId).ideas;
    const on = await host('POST', `asks/${ideasId}/pick`, { body: { round: '003', id: first.id, picked: true } });
    assert.strictEqual(on.status, 200, JSON.stringify(on.body));
    assert.deepStrictEqual((await phone('GET', 'live')).body.ask.picked, ['The two agencies on fixed budgets']);
    const row = table.get(PK, `FOLLOWUP#003#ASK#${ideasId}`);
    assert.ok(C.isEnvelope(row.Picked), 'Picked is not sealed');
    assert.ok(sent.some((m) => m.type === 'followUpChanged' && m.status === 'picked'));
    await host('POST', `asks/${ideasId}/pick`, { body: { round: '003', id: first.id, picked: false } });
    assert.deepStrictEqual((await phone('GET', 'live')).body.ask.picked, []);
  });
  await check('pick: an unknown id is 404, a rival org 404, a Rate question 409', async () => {
    assert.strictEqual((await host('POST', `asks/${ideasId}/pick`, { body: { round: '003', id: 'nope', picked: true } })).status, 404);
    assert.strictEqual((await host('POST', `asks/${ideasId}/pick`, { body: { round: '003', id: 'nope', picked: true }, authorizer: RIVAL })).status, 404);
    const rate = await host('POST', 'send', { body: { round: '003', kind: 'rate', statement: 'x' } });
    assert.strictEqual((await host('POST', `asks/${rate.body.ask.askId}/pick`, { body: { round: '003', id: 'x', picked: true } })).status, 409);
  });
  await check('the public read counts the answers so far, never who', async () => {
    await seed();
    const r = await host('POST', 'send', { body: { round: '003', kind: 'rate', statement: 'Count me' } });
    await answer(r.body.ask.askId, 'Ada', 'c-ada', 4);
    await answer(r.body.ask.askId, 'Grace', undefined, 2);
    const p = await phone('GET', 'live');
    assert.strictEqual(p.body.ask.answered, 2);
    // A device that missed the frame still learns the room is on the question.
    assert.strictEqual(p.body.beat, 'ask');
    assert.ok(!/Ada|Grace/.test(JSON.stringify(p.body.ask)));
  });
  await check('the generic stage-beat route will not open the ask beat', async () => {
    const sb = require(path.join(REPO, 'lambda-functions/game/stage-beat.js'));
    const routeKey = 'POST /games/{gameId}/stage-beat';
    const res = await sb.handler({ routeKey, requestContext: { http: { method: 'POST' }, routeKey, authorizer: HOST }, pathParameters: { gameId: GAME }, body: JSON.stringify({ beat: 'ask', questionNumber: 3 }) });
    assert.strictEqual(res.statusCode, 400, res.body);
  });

  await check('billing: session-count.js is never loaded by any of it', () => {
    const loaded = Object.keys(require.cache).filter((p) => /session-count\.js$/.test(p));
    assert.deepStrictEqual(loaded, []);
  });
  await check('the logs never carry an answer, a statement or a name', () => {
    const all = logs.join('\n');
    for (const bit of ['backfill', 'Plain words', 'interface diff', 'security files']) assert.ok(!all.includes(bit), bit);
  });

  say(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail ? 1 : 0);
})().catch((e) => { say(`CRASH ${e.stack}`); process.exit(1); });
