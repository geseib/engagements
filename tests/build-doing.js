const suiteFinished = require('./helpers/finish-guard');
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');

class PutCommand { constructor(i) { this.input = i; this.type = 'put'; } }
class GetCommand { constructor(i) { this.input = i; this.type = 'get'; } }
class QueryCommand { constructor(i) { this.input = i; this.type = 'query'; } }
class DeleteCommand { constructor(i) { this.input = i; this.type = 'delete'; } }
class UpdateCommand { constructor(i) { this.input = i; this.type = 'update'; } }
class PostToConnectionCommand { constructor(i) { this.input = i; } }

const store = new Map();
const key = (pk, sk) => `${pk}|${sk}`;
let sent = [];

/** Just enough of UpdateExpression for build-room.js: SET a = :v, … ADD b :n, … */
function applyUpdate(inp) {
  const k = key(inp.Key.PK, inp.Key.SK);
  const cur = store.get(k);
  if (inp.ConditionExpression === 'attribute_exists(PK)' && !cur) {
    const e = new Error('cond'); e.name = 'ConditionalCheckFailedException'; throw e;
  }
  if (inp.ConditionExpression === 'attribute_not_exists(DeliveredAt)' && cur && cur.DeliveredAt) {
    const e = new Error('cond'); e.name = 'ConditionalCheckFailedException'; throw e;
  }
  const item = { ...(cur || { PK: inp.Key.PK, SK: inp.Key.SK }) };
  const names = inp.ExpressionAttributeNames || {};
  const vals = inp.ExpressionAttributeValues || {};
  const n = (x) => names[x] || x;
  const expr = inp.UpdateExpression;
  const setPart = (/SET (.*?)(?: ADD |$)/.exec(expr) || [])[1];
  const addPart = (/ADD (.*)$/.exec(expr) || [])[1];
  if (setPart) for (const clause of setPart.split(',')) {
    const [l, r] = clause.split('=').map((s) => s.trim());
    item[n(l)] = vals[r];
  }
  if (addPart) for (const clause of addPart.split(',')) {
    const [l, r] = clause.trim().split(/\s+/);
    item[n(l)] = (Number(item[n(l)]) || 0) + Number(vals[r]);
  }
  store.set(k, item);
  return { Attributes: inp.ReturnValues === 'UPDATED_OLD' ? (cur || {}) : item };
}

const fakeDoc = {
  send: async (cmd) => {
    const inp = cmd.input || {};
    switch (cmd.type) {
      case 'put': store.set(key(inp.Item.PK, inp.Item.SK), JSON.parse(JSON.stringify(inp.Item))); return {};
      case 'get': return { Item: store.get(key(inp.Key.PK, inp.Key.SK)) };
      case 'delete': store.delete(key(inp.Key.PK, inp.Key.SK)); return {};
      case 'update': return applyUpdate(inp);
      case 'query': {
        const pk = inp.ExpressionAttributeValues[':pk'];
        const prefix = inp.ExpressionAttributeValues[':sk'] ?? '';
        let items = [...store.values()]
          .filter((i) => i.PK === pk && String(i.SK).startsWith(String(prefix)))
          .sort((a, b) => String(a.SK).localeCompare(String(b.SK)));
        if (inp.ExpressionAttributeValues[':type']) items = items.filter((i) => i.ConnectionType === inp.ExpressionAttributeValues[':type']);
        return { Items: items, Count: items.length };
      }
      default: return {};
    }
  },
};

class FakeApiGatewayClient {
  async send(cmd) { sent.push({ connectionId: cmd.input.ConnectionId, message: JSON.parse(cmd.input.Data) }); return {}; }
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

const { makeKmsStub, installTestKeyLoader } = require('./helpers/tenant-crypto-stub');
stub('@aws-sdk/client-kms', makeKmsStub().exports);
stub('@aws-sdk/client-dynamodb', { DynamoDBClient: class {} });
stub('@aws-sdk/lib-dynamodb', {
  DynamoDBDocumentClient: { from: () => fakeDoc },
  PutCommand, GetCommand, QueryCommand, DeleteCommand, UpdateCommand,
});
// S3, for the room's screenshots.
const bucket = new Map();
class S3PutObjectCommand { constructor(i) { this.input = i; this.op = 'put'; } }
class S3GetObjectCommand { constructor(i) { this.input = i; this.op = 'get'; } }
class S3DeleteObjectCommand { constructor(i) { this.input = i; this.op = 'delete'; } }
class FakeS3 {
  async send(cmd) {
    const { Key, Body, Metadata, ContentType } = cmd.input;
    if (cmd.op === 'put') { bucket.set(Key, { Body: Buffer.from(Body), Metadata, ContentType }); return {}; }
    if (cmd.op === 'delete') { bucket.delete(Key); return {}; }
    const o = bucket.get(Key);
    if (!o) { const e = new Error('NoSuchKey'); e.name = 'NoSuchKey'; throw e; }
    return { Metadata: o.Metadata, Body: { transformToByteArray: async () => new Uint8Array(o.Body) } };
  }
}
stub('@aws-sdk/client-s3', { S3Client: FakeS3, PutObjectCommand: S3PutObjectCommand, GetObjectCommand: S3GetObjectCommand, DeleteObjectCommand: S3DeleteObjectCommand });
process.env.MEDIA_BUCKET = 'test-media';

stub('@aws-sdk/client-apigatewaymanagementapi', { ApiGatewayManagementApiClient: FakeApiGatewayClient, PostToConnectionCommand });

process.env.TABLE_NAME = 'test-table';
process.env.WEBSOCKET_API_ENDPOINT = 'https://ws.test.invalid/dev';

installTestKeyLoader();
const { handler } = require(path.join(REPO, 'lambda-functions/game/build-room.js'));
const S = require(path.join(REPO, 'lambda-functions/game/build-store.js'));

let pass = 0;
let failed = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  PASS  ${label}`); pass++; } catch (e) { console.log(`  FAIL  ${label}\n        ${e.stack.split('\n').slice(0, 3).join('\n        ')}`); failed++; }
}

const GAME = '4821';
const ORG = 'org_TestOrg1';
const put = (item) => store.set(key(item.PK, item.SK), item);

function seed({ orgId = '', createdBy = '' } = {}) {
  store.clear();
  sent = [];
  put({ PK: `GAME#${GAME}`, SK: 'METADATA', GameType: 'build', Title: 'Food bank sign-up', Details: 'Build a volunteer sign-up site', ttl: 2000000000, ...(orgId ? { orgId } : {}), ...(createdBy ? { CreatedBy: createdBy } : {}) });
  put({ PK: `GAME#${GAME}`, SK: 'STATE', State: 'STARTED' });
  put({ PK: `GAME#${GAME}`, SK: 'PLAYER#Priya', PlayerName: 'Priya', ClientId: 'c-priya' });
  put({ PK: `GAME#${GAME}`, SK: 'PLAYER#Marcus', PlayerName: 'Marcus', ClientId: 'c-marcus' });
  put({ PK: `GAME#${GAME}`, SK: 'PLAYER#Marcus#SCORE', PlayerName: 'Marcus' });
  put({ PK: `GAME#${GAME}`, SK: 'CONNECTION#host-1', ConnectionId: 'host-1', ConnectionType: 'HOST' });
  put({ PK: `GAME#${GAME}`, SK: 'CONNECTION#p-1', ConnectionId: 'p-1', ConnectionType: 'PLAYER' });
}

const HOST = { userId: 'user-1', groups: 'hosts', orgId: '', orgIds: '' };
const agentCtx = (gameId = GAME) => ({ agent: 'build', agentGameId: gameId, agentKeyHash: 'h', groups: '', orgId: '', orgIds: '' });

function hostCall(method, proxy, body, auth = HOST) {
  return handler({
    routeKey: `${method} /games/{gameId}/build/{proxy+}`,
    requestContext: { http: { method }, authorizer: { lambda: auth } },
    pathParameters: { gameId: GAME, proxy },
    body: body ? JSON.stringify(body) : undefined,
  }).then((r) => ({ status: r.statusCode, body: JSON.parse(r.body) }));
}
const agentCall = (method, proxy, body, gameId) => hostCall(method, proxy, body, agentCtx(gameId));
function playCall(method, proxy, input) {
  return handler({
    routeKey: `${method} /games/{gameId}/build-play/{proxy+}`,
    requestContext: { http: { method } },
    pathParameters: { gameId: GAME, proxy },
    ...(method === 'GET' ? { queryStringParameters: input } : { body: JSON.stringify(input) }),
  }).then((r) => ({ status: r.statusCode, body: JSON.parse(r.body) }));
}
const priya = { playerName: 'Priya', clientId: 'c-priya' };
const marcus = { playerName: 'Marcus', clientId: 'c-marcus' };


/*
 * BUILD ROOM: the "what Claude is doing" line (docs/design/build-room-doing D6,
 * plan 2026-10-10 Task 1): precedence, validation, step entries, stale, ttl,
 * sealing, and the view each audience gets. Expectations are written by hand.
 */
const ACT = () => store.get(key(`GAME#${GAME}`, 'BUILD#ACTIVITY'));
const steps = () => [...store.values()].filter((r) => String(r.SK).startsWith('BUILD#LOG#') && r.Kind === 'step').sort((a, b) => String(a.CreatedAt).localeCompare(String(b.CreatedAt)));
const ago = (ms) => new Date(Date.now() - ms).toISOString();
const hostDoing = async () => (await hostCall('GET', 'state')).body.doing;
const pubDoing = async () => (await playCall('GET', 'state', priya)).body.doing;
const todo = (text) => agentCall('POST', 'activity', { doing: { source: 'todo', text } });
const todoDone = (...items) => agentCall('POST', 'activity', { done: items.map((item) => ({ item })) });
const listen = () => handler({ routeKey: 'GET /games/{gameId}/build/{proxy+}', requestContext: { http: { method: 'GET' }, authorizer: { lambda: agentCtx() } }, pathParameters: { gameId: GAME, proxy: 'inbox' }, queryStringParameters: { listening: '1' } }).then((r) => ({ status: r.statusCode, body: JSON.parse(r.body) }));
const say = (b) => agentCall('POST', 'log', { kind: 'progress', text: 'Working on it', ...b });

(async () => {
  console.log('\nthe line: cleaning (D6)');
  await check('as written; over 50 characters cut at the last whole word, no ellipsis; under 2 words ignored', () => {
    assert.strictEqual(S.cleanDoingLine('  Scaffolding   the site. '), 'Scaffolding the site');
    const cut = S.cleanDoingLine('Researching accessible colour contrast rules for dark themes');
    assert.strictEqual(cut, 'Researching accessible colour contrast rules for');
    assert.ok(cut.length <= 50 && !cut.includes('…'));
    assert.strictEqual(S.cleanDoingLine('Researching'), '');
    assert.strictEqual(S.cleanDoingLine(''), '');
    assert.strictEqual(S.cleanDoingLine(42), '');
    assert.strictEqual(S.cleanDoingLine('Scaffolded the site'), 'Scaffolded the site', 'a past form of 3 words is fine');
  });
  await check('a slash, backtick, @, :// or a file extension is refused outright', () => {
    for (const bad of ['Editing src/App.jsx now', 'Running `npm test` again', 'Emailing @priya about it', 'Opening https://x.test now', 'Fixing App.jsx layout', 'Reading notes.md today', 'Running npm/test']) {
      assert.strictEqual(S.cleanDoingLine(bad), '', bad);
    }
    assert.strictEqual(S.cleanDoingLine('Making 3 graph options'), 'Making 3 graph options');
  });

  console.log('\nprecedence: Claude\'s line (B) beats the to-do item (A) while fresh');
  seed();
  await check('A alone shows; B wins over it; a new A item does not unseat B', async () => {
    assert.strictEqual(await hostDoing(), null, 'nothing yet');
    const a = await todo('Building the bar chart');
    assert.strictEqual(a.status, 200, JSON.stringify(a.body));
    assert.strictEqual(a.body.doing.text, 'Building the bar chart');
    let h = await hostDoing();
    assert.deepStrictEqual([h.text, h.source, h.stale, h.helper], ['Building the bar chart', 'todo', false, '']);
    assert.ok(Date.parse(h.startedAt) <= Date.now());
    const b = await say({ doing: 'Scaffolding the site', done: 'Scaffolded the site' });
    assert.strictEqual(b.status, 201, JSON.stringify(b.body));
    h = await hostDoing();
    assert.deepStrictEqual([h.text, h.past, h.source], ['Scaffolding the site', 'Scaffolded the site', 'claude']);
    await todo('Writing the tests');
    h = await hostDoing();
    assert.strictEqual(h.text, 'Scaffolding the site', 'B still wins');
  });
  await check('an unsafe B line is refused; the line falls back to A and B\'s old step is kept', async () => {
    const before = steps().length;
    const r = await say({ doing: 'Editing src/App.jsx now' });
    assert.strictEqual(r.status, 201);
    const h = await hostDoing();
    assert.strictEqual(h.text, 'Writing the tests', 'fell back to the to-do item');
    assert.strictEqual(h.source, 'todo');
    const s = steps();
    assert.strictEqual(s.length, before + 1);
    assert.strictEqual(s[s.length - 1].Text, 'Scaffolded the site');
  });
  await check('an unsafe to-do line is dropped too', async () => {
    seed();
    await todo('Opening https://example.test now');
    assert.strictEqual(await hostDoing(), null);
  });
  await check('B expires after 15 minutes while the to-do list has moved on', async () => {
    seed();
    await say({ doing: 'Mocking up three layouts' });
    await todo('Wiring the form');
    assert.strictEqual((await hostDoing()).text, 'Mocking up three layouts');
    const row = ACT();
    row.DoingB = { ...row.DoingB, at: ago(16 * 60000), startedAt: ago(16 * 60000) };
    row.DoingA = { ...row.DoingA, startedAt: ago(60000), at: ago(1000) };
    assert.strictEqual((await hostDoing()).text, 'Wiring the form', 'the view already reads A');
    await todo('Wiring the form'); // any post: the expired B is ended and kept
    assert.ok(!ACT().DoingB);
    const s = steps();
    assert.strictEqual(s.length, 1);
    assert.strictEqual(s[0].Text, 'Done: Mocking up three layouts');
    assert.ok(s[0].DurationMs >= 15 * 60000, String(s[0].DurationMs));
  });
  await check('15 minutes old with no to-do movement keeps B (nothing to fall back on)', async () => {
    seed();
    await say({ doing: 'Mocking up three layouts' });
    const row = ACT();
    row.DoingB = { ...row.DoingB, at: ago(20 * 60000) };
    assert.strictEqual((await hostDoing()).text, 'Mocking up three layouts');
  });

  console.log('\nsteps: one History entry when a line ends');
  await check('a to-do item done writes "Done: <the item\'s own words>" with its duration, and clears the line', async () => {
    seed();
    await todo('Building the bar chart');
    ACT().DoingA.startedAt = ago(5 * 60000);
    const r = await todoDone('Build the bar chart');
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    const s = steps();
    assert.strictEqual(s.length, 1);
    assert.strictEqual(s[0].Text, 'Done: Build the bar chart');
    assert.strictEqual(s[0].Source, 'todo');
    assert.ok(s[0].DurationMs >= 5 * 60000 && s[0].DurationMs < 6 * 60000, String(s[0].DurationMs));
    assert.ok(Date.parse(s[0].EndedAt) >= Date.parse(s[0].StartedAt));
    assert.strictEqual(s[0].By, 'agent');
    assert.strictEqual(await hostDoing(), null);
  });
  await check('done closes BEFORE the new doing in one post; a batch of dones is one step each', async () => {
    seed();
    await todo('Scaffolding the site');
    const r = await agentCall('POST', 'activity', { done: [{ item: 'Scaffold the site' }, { item: 'Pick a palette' }], doing: { source: 'todo', text: 'Adding the header' } });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.deepStrictEqual(steps().map((x) => x.Text).sort(), ['Done: Pick a palette', 'Done: Scaffold the site']);
    assert.strictEqual((await hostDoing()).text, 'Adding the header');
    assert.strictEqual(ACT().DoingA.text, 'Adding the header');
  });
  await check('without the item\'s words the step reads Done: and the line', async () => {
    seed();
    await todo('Adding the donate button');
    await agentCall('POST', 'activity', { done: true });
    assert.strictEqual(steps()[0].Text, 'Done: Adding the donate button');
  });
  await check('a new B line ends the last: past tense from Claude, else Done:; the same line again is not a step', async () => {
    seed();
    await say({ doing: 'Scaffolding the site', done: 'Scaffolded the site' });
    await say({ doing: 'Scaffolding the site' });
    assert.strictEqual(steps().length, 0);
    await say({ doing: 'Researching contrast rules' });
    await say({ doing: 'Drafting the home page' });
    assert.deepStrictEqual(steps().map((s) => s.Text).sort(), ['Done: Researching contrast rules', 'Scaffolded the site']);
    assert.strictEqual((await hostDoing()).text, 'Drafting the home page');
  });
  await check('done alone ends B (its text is the past form, 2 words is fine); no text means no timeline post', async () => {
    seed();
    assert.strictEqual((await agentCall('POST', 'log', { doing: 'Scaffolding the site' })).status, 200, 'a doing-only post is fine');
    const r = await agentCall('POST', 'log', { kind: 'progress', done: 'Scaffolded site' });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual(r.body.doing, null);
    assert.deepStrictEqual(steps().map((s) => s.Text), ['Scaffolded site']);
    assert.strictEqual([...store.values()].filter((x) => x.Kind === 'progress').length, 0);
  });
  await check('Claude waiting for direction ends the line (one step), clears the helper, and the views go quiet', async () => {
    seed();
    await say({ doing: 'Scaffolding the site', done: 'Scaffolded the site', helper: 'A helper is researching contrast rules' });
    assert.strictEqual((await hostDoing()).helper, 'A helper is researching contrast rules');
    const r = await listen();
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(steps().map((s) => s.Text), ['Scaffolded the site']);
    assert.strictEqual(await hostDoing(), null);
    assert.strictEqual(await pubDoing(), null);
    assert.ok(!ACT().Helper);
    await listen();
    assert.strictEqual(steps().length, 1, 'polling again adds nothing');
  });
  await check('waiting while B wins ends B once; A\'s end is no extra step', async () => {
    seed();
    await todo('Building the bar chart');
    await say({ doing: 'Scaffolding the site' });
    await listen();
    assert.deepStrictEqual(steps().map((s) => s.Text), ['Done: Scaffolding the site']);
  });
  await check('waiting while only A runs ends A as a step', async () => {
    seed();
    await todo('Building the bar chart');
    await listen();
    assert.deepStrictEqual(steps().map((s) => s.Text), ['Done: Building the bar chart']);
  });
  await check('step entries are in the host and phone timelines and carry their times', async () => {
    seed();
    await say({ doing: 'Scaffolding the site', done: 'Scaffolded the site' });
    await agentCall('POST', 'log', { kind: 'progress', done: true });
    const h = (await hostCall('GET', 'state')).body.log.find((l) => l.kind === 'step');
    assert.strictEqual(h.text, 'Scaffolded the site');
    assert.deepStrictEqual(Object.keys(h.step).sort(), ['durationMs', 'endedAt', 'source', 'startedAt']);
    const p = (await playCall('GET', 'state', priya)).body.log.find((l) => l.kind === 'step');
    assert.strictEqual(p.text, 'Scaffolded the site');
    assert.strictEqual(p.step.source, 'claude');
  });

  await check('the plugin\'s `at` times set a step\'s start and end; the helper is its own field', async () => {
    seed();
    const t0 = ago(10 * 60000);
    const t1 = ago(4 * 60000);
    await agentCall('POST', 'activity', { doing: { source: 'todo', text: 'Building the bar chart', at: t0 } });
    const r = await agentCall('POST', 'activity', {
      done: [{ item: 'Build the bar chart', at: t1 }],
      doing: { source: 'todo', text: 'Writing the tests', at: t1 },
      helper: { text: 'A helper is researching contrast rules', at: t1 },
    });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    const s = steps();
    assert.strictEqual(s.length, 1);
    assert.strictEqual(s[0].StartedAt, t0);
    assert.strictEqual(s[0].EndedAt, t1);
    assert.strictEqual(s[0].DurationMs, 6 * 60000);
    assert.strictEqual((await hostDoing()).text, 'Writing the tests');
    assert.strictEqual((await hostDoing()).startedAt, t1);
    assert.strictEqual((await hostDoing()).helper, 'A helper is researching contrast rules');
    await agentCall('POST', 'activity', { helper: { end: true, at: t1 } });
    assert.strictEqual((await hostDoing()).helper, '');
    assert.strictEqual((await hostDoing()).text, 'Writing the tests', 'ending the helper leaves the line');
  });
  await check('www. and a dotted number are refused like a file name', () => {
    assert.strictEqual(S.cleanDoingLine('Opening www example site'), 'Opening www example site');
    assert.strictEqual(S.cleanDoingLine('Opening www.example site'), '');
    assert.strictEqual(S.cleanDoingLine('Backslash C:\\temp now'), '');
  });

  console.log('\nhelper, stale and the views per audience');
  seed();
  await check('the helper line shows to the host AND the room; a record may carry only a helper', async () => {
    await todo('Building the bar chart');
    const r = await agentCall('POST', 'activity', { doing: { source: 'todo', helper: 'A helper is researching contrast rules' } });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual((await hostDoing()).text, 'Building the bar chart', 'the line is untouched');
    assert.strictEqual((await hostDoing()).helper, 'A helper is researching contrast rules');
    assert.strictEqual((await pubDoing()).helper, 'A helper is researching contrast rules');
    await agentCall('POST', 'activity', { doing: { source: 'todo', helper: '' } });
    assert.strictEqual((await hostDoing()).helper, '');
    await agentCall('POST', 'activity', { doing: { source: 'todo', helper: 'A helper is reading src/App.jsx' } });
    assert.strictEqual((await hostDoing()).helper, '', 'an unsafe helper line is dropped');
  });
  await check('the room\'s view has no source details; Claude\'s own state view gets no doing', async () => {
    const h = await hostDoing();
    const p = await pubDoing();
    assert.deepStrictEqual(Object.keys(p).sort(), ['helper', 'lastActiveAt', 'stale', 'startedAt', 'text']);
    assert.strictEqual(p.text, h.text);
    assert.deepStrictEqual(Object.keys(h).sort(), ['helper', 'lastActiveAt', 'past', 'source', 'stale', 'startedAt', 'text']);
    assert.strictEqual('doing' in (await agentCall('GET', 'state')).body, false);
  });
  await check('stale after 3 minutes with no activity; fresh again on the next post', async () => {
    ACT().ActiveAt = ago(4 * 60000);
    assert.strictEqual((await hostDoing()).stale, true);
    assert.strictEqual((await pubDoing()).stale, true);
    await agentCall('POST', 'activity', { items: [{ kind: 'edit', text: 'Edited Header.jsx' }] });
    assert.strictEqual((await hostDoing()).stale, false);
  });
  await check('only Claude posts a doing line; the host cannot', async () => {
    assert.strictEqual((await hostCall('POST', 'activity', { doing: { text: 'Faking the line now' } })).status, 403);
    const r = await hostCall('POST', 'log', { kind: 'verbal', text: 'Hello', doing: 'Faking the line now' });
    assert.strictEqual(r.status, 201);
    assert.strictEqual((await hostDoing()).text, 'Building the bar chart');
  });
  await check('the line changing tells the phones (Rev bump); a repeat of the same line does not', async () => {
    seed();
    await todo('Building the bar chart');
    sent = [];
    await todo('Building the bar chart');
    assert.ok(!sent.some((s) => s.message.type === 'buildChanged'), 'no refetch for a repeat');
    await todo('Writing the tests');
    assert.ok(sent.some((s) => s.connectionId === 'p-1' && s.message.type === 'buildChanged'));
  });

  console.log('\nttl and sealing');
  await check('every row written carries the session ttl', async () => {
    seed();
    await say({ doing: 'Scaffolding the site', helper: 'A helper is researching contrast rules' });
    await say({ doing: 'Drafting the home page' });
    assert.ok(ACT().ttl > 0);
    assert.ok(steps().length === 1 && steps()[0].ttl > 0);
  });
  await check('in a team\'s room the line, the helper and the step are sealed at rest and still read', async () => {
    seed({ orgId: ORG });
    const HOST_ORG = { userId: 'user-1', groups: 'hosts', orgId: ORG, orgIds: ORG };
    const AGENT_ORG = { ...agentCtx(), orgId: ORG, orgIds: ORG };
    await hostCall('POST', 'log', { kind: 'progress', text: 'Hi', doing: 'Scaffolding the secret site', done: 'Scaffolded the secret site', helper: 'A helper is researching secret contrast' }, AGENT_ORG);
    await hostCall('POST', 'log', { kind: 'progress', text: 'Hi', doing: 'Drafting the secret page' }, AGENT_ORG);
    const raw = JSON.stringify([...store.values()].filter((x) => String(x.SK).startsWith('BUILD#')));
    assert.ok(!raw.includes('secret'), 'plaintext at rest: ' + (raw.match(/.{20}secret.{20}/) || [''])[0]);
    const st = (await hostCall('GET', 'state', undefined, HOST_ORG)).body;
    assert.strictEqual(st.doing.text, 'Drafting the secret page');
    assert.strictEqual(st.doing.helper, 'A helper is researching secret contrast');
    assert.ok(st.log.some((l) => l.kind === 'step' && l.text === 'Scaffolded the secret site'));
    assert.ok(ACT().ttl > 0);
  });

  console.log(`\n${pass} passed, ${failed} failed`);
  suiteFinished();
  process.exit(failed ? 1 : 0);
})();
