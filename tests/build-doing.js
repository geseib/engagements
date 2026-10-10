const suiteFinished = require('./helpers/finish-guard');
const path = require('path');
const assert = require('assert');
const fs = require('fs');

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

const hooks = { beforePut: null };
const fakeDoc = {
  send: async (cmd) => {
    const inp = cmd.input || {};
    switch (cmd.type) {
      case 'put': {
        if (hooks.beforePut && inp.Item.SK === 'BUILD#ACTIVITY') hooks.beforePut(inp);
        if (inp.ConditionExpression) {
          const cur = store.get(key(inp.Item.PK, inp.Item.SK));
          const rev = cur ? cur.DoingRev : undefined;
          const ok = rev === undefined
            ? /attribute_not_exists\(DoingRev\)/.test(inp.ConditionExpression)
            : /DoingRev = :rev/.test(inp.ConditionExpression) && rev === inp.ExpressionAttributeValues[':rev'];
          if (!ok) { const e = new Error('cond'); e.name = 'ConditionalCheckFailedException'; throw e; }
        }
        store.set(key(inp.Item.PK, inp.Item.SK), JSON.parse(JSON.stringify(inp.Item))); return {};
      }
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
// The pump's shape: an ordered list of events, applied in file order (plan 2026-10-10, fix round).
const evs = (...events) => agentCall('POST', 'activity', { events });
const todo = (text, at) => evs({ type: 'doing', text, ...(at ? { at } : {}) });
const todoDone = (...items) => evs(...items.map((item) => ({ type: 'done', item })));
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
    assert.strictEqual(S.cleanDoingLine('Comparing 3.5 inch options'), 'Comparing 3.5 inch options', 'a dotted number is not a file name');
    assert.strictEqual(S.cleanDoingLine('Fixing Header.jsx now'), '');
  });
  await check('the plugin\'s refusal rule and the server\'s give the same verdict over one shared list (M1)', () => {
    const src = fs.readFileSync(path.join(REPO, 'src/public/engage-mcp.mjs'), 'utf8');
    const m = /export function unsafeForRoom\(text\) \{([\s\S]*?)\n\}/.exec(src);
    assert.ok(m, 'unsafeForRoom not found in the plugin');
    const unsafe = new Function('text', m[1]);
    const shared = [
      'Scaffolding the site', 'Making 3 graph options', 'Comparing 3.5 inch options', 'Fixing Header.jsx now', 'Editing src/App.jsx now',
      'Running `npm test` again', 'Emailing @priya about it', 'Opening https://x.test now', 'Opening www.example site', 'Opening www example site',
      'Reading notes.md today', 'Backslash C:\\temp now', 'Running npm/test', 'Wiring v1.2 of the form', 'Trying e.g. two layouts',
      'Checking Node.js versions', 'Mocking up three layouts.', 'Adding the donate button',
    ];
    for (const line of shared) {
      const server = S.cleanDoingLine(line) === '';
      assert.strictEqual(unsafe(line), server, `${line}: plugin ${unsafe(line)} server ${server}`);
    }
    assert.ok(shared.some((l) => unsafe(l)) && shared.some((l) => !unsafe(l)));
  });

  console.log('\nprecedence: Claude\'s line (B) beats the to-do item (A) while fresh');
  seed();
  await check('A alone shows; B wins over it; a new A item does not unseat B', async () => {
    assert.strictEqual(await hostDoing(), null, 'nothing yet');
    const a = await todo('Building the bar chart');
    assert.strictEqual(a.status, 200, JSON.stringify(a.body));
    assert.deepStrictEqual(a.body, { ok: true }, 'Claude gets no doing view back (M3)');
    let h = await hostDoing();
    assert.deepStrictEqual([h.text, h.source, h.stale, h.helper], ['Building the bar chart', 'todo', false, '']);
    assert.ok(Date.parse(h.startedAt) <= Date.now());
    const b = await say({ doing: 'Scaffolding the site' });
    assert.strictEqual(b.status, 201, JSON.stringify(b.body));
    h = await hostDoing();
    assert.deepStrictEqual([h.text, h.past, h.source], ['Scaffolding the site', '', 'claude']);
    await todo('Writing the tests');
    h = await hostDoing();
    assert.strictEqual(h.text, 'Scaffolding the site', 'B still wins');
  });
  await check('an unsafe B line is refused in words and changes nothing (dev walk, 2026-10-10)', async () => {
    const before = steps().length;
    const h0 = await hostDoing();
    const r = await say({ doing: 'Editing src/App.jsx now', done: 'Scaffolded the site' });
    assert.strictEqual(r.status, 400);
    assert.match(String(r.body.error || r.body.message), /can't go on screen/);
    const h = await hostDoing();
    assert.strictEqual(h && h.text, h0 && h0.text, 'the line the room reads is unchanged');
    assert.strictEqual(steps().length, before, 'no step written');
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
    row.DoingB = { ...row.DoingB, at: ago(16 * 60000), startedAt: ago(17 * 60000) };
    row.DoingA = { ...row.DoingA, startedAt: ago(60000), at: ago(1000) };
    assert.strictEqual((await hostDoing()).text, 'Wiring the form', 'the view already reads A');
    await todo('Wiring the form'); // any post: the expired B is ended and kept
    assert.ok(!ACT().DoingB);
    const s = steps();
    assert.strictEqual(s.length, 1);
    assert.strictEqual(s[0].Text, 'Done: Mocking up three layouts');
    assert.ok(s[0].DurationMs >= 15 * 60000, String(s[0].DurationMs));
    assert.strictEqual(s[0].EndedAt, row.DoingA.startedAt, 'an expired B ends where A took over (I7)');
    assert.ok(s[0].DurationMs < 17 * 60000, 'not stretched to now: ' + s[0].DurationMs);
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
    const r = await evs({ type: 'done', item: 'Scaffold the site' }, { type: 'done', item: 'Pick a palette' }, { type: 'doing', text: 'Adding the header' });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.deepStrictEqual(steps().map((x) => x.Text).sort(), ['Done: Pick a palette', 'Done: Scaffold the site']);
    assert.strictEqual((await hostDoing()).text, 'Adding the header');
    assert.strictEqual(ACT().DoingA.text, 'Adding the header');
  });
  await check('without the item\'s words the step reads Done: and the line', async () => {
    seed();
    await todo('Adding the donate button');
    await evs({ type: 'done', item: '' });
    assert.strictEqual(steps()[0].Text, 'Done: Adding the donate button');
  });
  await check('an unsafe subject still ends the step: the done event carries no words, the server uses the line\'s own (I2)', async () => {
    seed();
    await todo('Adding the donate button');
    await evs({ type: 'done', item: '' });
    assert.deepStrictEqual(steps().map((s) => s.Text), ['Done: Adding the donate button']);
    assert.strictEqual(await hostDoing(), null);
  });
  await check('events are applied in file order: done then doing closes the old step; doing then done ends the new line (I1)', async () => {
    seed();
    await todo('Scaffolding the site');
    await evs({ type: 'done', item: 'Scaffold the site' }, { type: 'doing', text: 'Adding the header' });
    assert.deepStrictEqual(steps().map((s) => s.Text), ['Done: Scaffold the site']);
    assert.strictEqual((await hostDoing()).text, 'Adding the header');
    seed();
    await todo('Scaffolding the site');
    await evs({ type: 'doing', text: 'Adding the header' }, { type: 'done', item: 'Add the header' });
    assert.deepStrictEqual(steps().map((s) => s.Text).sort(), ['Done: Add the header', 'Done: Scaffolding the site']);
    assert.strictEqual(await hostDoing(), null);
  });
  await check('a bad events body is refused; an old-shape body does nothing', async () => {
    assert.strictEqual((await agentCall('POST', 'activity', { events: 'nope' })).status, 400);
    seed();
    const r = await agentCall('POST', 'activity', { doing: { source: 'todo', text: 'Building the bar chart' } });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(await hostDoing(), null, 'the 1.14 pre-release shape is gone');
  });
  await check('a new B line ends the last: past tense from Claude, else Done:; the same line again is not a step', async () => {
    seed();
    await say({ doing: 'Scaffolding the site' });
    await say({ doing: 'Scaffolding the site' });
    assert.strictEqual(steps().length, 0);
    await say({ doing: 'Researching contrast rules', done: 'Scaffolded the site' });
    await say({ doing: 'Drafting the home page' });
    assert.deepStrictEqual(steps().map((s) => s.Text).sort(), ['Done: Researching contrast rules', 'Scaffolded the site']);
    assert.strictEqual((await hostDoing()).text, 'Drafting the home page');
  });
  await check('C1: done is the past tense of the line that JUST ENDED; the new line starts with no past', async () => {
    seed();
    await say({ doing: 'Scaffolding the site' });
    await say({ doing: 'Researching contrast rules', done: 'Scaffolded the site' });
    assert.deepStrictEqual(steps().map((s) => s.Text), ['Scaffolded the site'], 'the OLD line got the past form');
    assert.strictEqual(ACT().DoingB.past, undefined, 'the new line has none yet');
    assert.strictEqual((await hostDoing()).past, '');
    await say({ doing: 'Drafting the home page', done: 'Researched contrast rules' });
    assert.deepStrictEqual(steps().map((s) => s.Text).sort(), ['Researched contrast rules', 'Scaffolded the site']);
    seed();
    await say({ doing: 'Scaffolding the site', done: 'Scaffolded something' });
    assert.strictEqual(steps().length, 0, 'a done with no line before it ends nothing');
    assert.strictEqual((await hostDoing()).text, 'Scaffolding the site');
  });
  await check('done alone ends B (its text is the past form, 2 words is fine); no text means no timeline post', async () => {
    seed();
    assert.strictEqual((await agentCall('POST', 'log', { doing: 'Scaffolding the site' })).status, 200, 'a doing-only post is fine');
    const r = await agentCall('POST', 'log', { kind: 'progress', done: 'Scaffolded site' });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual(r.body.ok, true);
    assert.ok(!('doing' in r.body), 'no doing view for Claude (M3)');
    assert.deepStrictEqual(steps().map((s) => s.Text), ['Scaffolded site']);
    assert.strictEqual([...store.values()].filter((x) => x.Kind === 'progress').length, 0);
  });
  await check('Claude waiting for direction ends the line (one step), clears the helper, and the views go quiet', async () => {
    seed();
    await say({ doing: 'Scaffolding the site', helper: 'A helper is researching contrast rules' });
    assert.strictEqual((await hostDoing()).helper, 'A helper is researching contrast rules');
    const r = await listen();
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(steps().map((s) => s.Text), ['Done: Scaffolding the site']);
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
    await say({ doing: 'Scaffolding the site' });
    await agentCall('POST', 'log', { kind: 'progress', done: 'Scaffolded the site' });
    const h = (await hostCall('GET', 'state')).body.log.find((l) => l.kind === 'step');
    assert.strictEqual(h.text, 'Scaffolded the site');
    assert.deepStrictEqual(Object.keys(h.step).sort(), ['durationMs', 'endedAt', 'source', 'startedAt']);
    const p = (await playCall('GET', 'state', priya)).body.log.find((l) => l.kind === 'step');
    assert.strictEqual(p.text, 'Scaffolded the site');
    assert.deepStrictEqual(Object.keys(p.step).sort(), ['durationMs', 'endedAt', 'startedAt'], 'phones do not see where a step came from (M3)');
  });

  await check('the plugin\'s `at` times set a step\'s start and end; the helper is its own field', async () => {
    seed();
    const t0 = ago(10 * 60000);
    const t1 = ago(4 * 60000);
    await todo('Building the bar chart', t0);
    const r = await evs(
      { type: 'done', item: 'Build the bar chart', at: t1 },
      { type: 'doing', text: 'Writing the tests', at: t1 },
      { type: 'helper', text: 'A helper is researching contrast rules', at: t1 },
    );
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    const s = steps();
    assert.strictEqual(s.length, 1);
    assert.strictEqual(s[0].StartedAt, t0);
    assert.strictEqual(s[0].EndedAt, t1);
    assert.strictEqual(s[0].DurationMs, 6 * 60000);
    assert.strictEqual((await hostDoing()).text, 'Writing the tests');
    assert.strictEqual((await hostDoing()).startedAt, t1);
    assert.strictEqual((await hostDoing()).helper, 'A helper is researching contrast rules');
    await evs({ type: 'helper-end', at: t1 });
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
    const r = await evs({ type: 'helper', text: 'A helper is researching contrast rules' });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual((await hostDoing()).text, 'Building the bar chart', 'the line is untouched');
    assert.strictEqual((await hostDoing()).helper, 'A helper is researching contrast rules');
    assert.strictEqual((await pubDoing()).helper, 'A helper is researching contrast rules');
    await evs({ type: 'helper-end' });
    assert.strictEqual((await hostDoing()).helper, '');
    await evs({ type: 'helper', text: 'A helper is reading src/App.jsx' });
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
    assert.strictEqual((await hostCall('POST', 'activity', { events: [{ type: 'doing', text: 'Faking the line now' }] })).status, 403);
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

  console.log('\nfix round: revisions, helpers, waiting, durations, clamps');
  await check('I3: every write bumps DoingRev; a writer that lost the race re-reads, re-applies and writes the step once', async () => {
    seed();
    await todo('Building the bar chart');
    const rev0 = ACT().DoingRev;
    assert.ok(Number.isInteger(rev0) && rev0 >= 1, String(rev0));
    let raced = 0;
    hooks.beforePut = () => {
      if (raced++) return;
      // Another route (the host's log, markListening) wrote in between our read and our put.
      const row = ACT();
      row.DoingRev += 1;
      row.Helper = { text: 'A helper is researching contrast rules', at: new Date().toISOString() };
    };
    try {
      const r = await todoDone('Build the bar chart');
      assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    } finally { hooks.beforePut = null; }
    assert.strictEqual(raced, 2, 'one lost put, one retry');
    assert.deepStrictEqual(steps().map((s) => s.Text), ['Done: Build the bar chart'], 'the step is written once, after the winning put');
    assert.strictEqual((await hostDoing()).helper, 'A helper is researching contrast rules', 'the other writer\'s helper survived');
    assert.strictEqual(ACT().DoingRev, rev0 + 2);
  });
  await check('I3: after 3 lost races the post fails without writing any step', async () => {
    seed();
    await todo('Building the bar chart');
    let tries = 0;
    hooks.beforePut = () => { tries += 1; ACT().DoingRev += 1; };
    let r;
    try { r = await todoDone('Build the bar chart'); } finally { hooks.beforePut = null; }
    assert.strictEqual(tries, 3);
    assert.strictEqual(r.status, 409, JSON.stringify(r.body));
    assert.strictEqual(steps().length, 0);
    assert.strictEqual((await hostDoing()).text, 'Building the bar chart');
  });
  await check('I4: a helper is dropped when Claude has been quiet for 10 minutes, or when it is 30 minutes old', async () => {
    seed();
    await todo('Building the bar chart');
    await evs({ type: 'helper', text: 'A helper is researching contrast rules' });
    assert.strictEqual((await hostDoing()).helper, 'A helper is researching contrast rules');
    ACT().ActiveAt = ago(11 * 60000);
    ACT().Helper.at = ago(11 * 60000);
    assert.strictEqual((await hostDoing()).helper, '', 'quiet for 10 minutes: the view drops it');
    assert.strictEqual((await pubDoing()).helper, '');
    seed();
    await todo('Building the bar chart');
    await evs({ type: 'helper', text: 'A helper is researching contrast rules' });
    ACT().Helper.at = ago(31 * 60000);
    assert.strictEqual((await hostDoing()).helper, '', 'older than 30 minutes');
    await todo('Writing the tests');
    assert.ok(!ACT().Helper, 'the next write removes it from the row');
    seed();
    await todo('Building the bar chart');
    await evs({ type: 'helper', text: 'A helper is researching contrast rules' });
    ACT().ActiveAt = ago(9 * 60000);
    assert.strictEqual((await hostDoing()).helper, 'A helper is researching contrast rules', 'nine quiet minutes keeps it');
  });
  await check('I5: only a helper running gives a view with empty text, not null', async () => {
    seed();
    await evs({ type: 'helper', text: 'A helper is researching contrast rules' });
    const h = await hostDoing();
    assert.ok(h, 'a view');
    assert.deepStrictEqual([h.text, h.helper, h.stale], ['', 'A helper is researching contrast rules', false]);
    const p = await pubDoing();
    assert.deepStrictEqual([p.text, p.helper], ['', 'A helper is researching contrast rules']);
    await evs({ type: 'helper-end' });
    assert.strictEqual(await hostDoing(), null, 'nothing left: null again');
  });
  await check('I6: wait_for_room\'s poll (asks/{id}?waiting=1) ends the line like wait_for_direction does', async () => {
    seed();
    const c = await agentCall('POST', 'asks', { kind: 'suggest', prompt: 'What stops someone signing up?' });
    const askId = c.body.ask.askId;
    await todo('Building the bar chart');
    const poll = (qs) => handler({ routeKey: 'GET /games/{gameId}/build/{proxy+}', requestContext: { http: { method: 'GET' }, authorizer: { lambda: agentCtx() } }, pathParameters: { gameId: GAME, proxy: `asks/${askId}` }, queryStringParameters: qs }).then((r) => ({ status: r.statusCode, body: JSON.parse(r.body) }));
    assert.strictEqual((await poll(undefined)).status, 200);
    assert.strictEqual(steps().length, 0, 'a plain read ends nothing');
    const r = await poll({ waiting: '1' });
    assert.strictEqual(r.status, 200);
    assert.ok(r.body.ask);
    assert.deepStrictEqual(steps().map((s) => s.Text), ['Done: Building the bar chart']);
    assert.strictEqual(await hostDoing(), null);
    await poll({ waiting: '1' });
    assert.strictEqual(steps().length, 1, 'polling again adds nothing');
    // The host reading an ask never ends Claude's line.
    await todo('Writing the tests');
    await handler({ routeKey: 'GET /games/{gameId}/build/{proxy+}', requestContext: { http: { method: 'GET' }, authorizer: { lambda: HOST } }, pathParameters: { gameId: GAME, proxy: `asks/${askId}` }, queryStringParameters: { waiting: '1' } });
    assert.strictEqual((await hostDoing()).text, 'Writing the tests');
  });
  await check('I7: a stale line that then waits ends where the room last heard from Claude, not at the wait', async () => {
    seed();
    await todo('Building the bar chart');
    const started = ago(20 * 60000);
    const last = ago(10 * 60000);
    ACT().DoingA.startedAt = started;
    ACT().ActiveAt = last;
    await listen();
    const s = steps();
    assert.strictEqual(s.length, 1);
    assert.strictEqual(s[0].EndedAt, last);
    assert.strictEqual(s[0].DurationMs, Date.parse(last) - Date.parse(started));
    // A fresh line still ends now.
    seed();
    await todo('Building the bar chart');
    await listen();
    assert.ok(Date.now() - Date.parse(steps()[0].EndedAt) < 5000);
  });
  await check('M2: an event time is held between the line\'s start and now', async () => {
    seed();
    const t0 = ago(10 * 60000);
    await todo('Building the bar chart', t0);
    await evs({ type: 'done', item: 'Build the bar chart', at: ago(30 * 60000) });
    let s = steps();
    assert.strictEqual(s[0].EndedAt, t0, 'an end before the start is the start');
    assert.strictEqual(s[0].DurationMs, 0);
    seed();
    await todo('Building the bar chart', t0);
    await evs({ type: 'done', item: 'Build the bar chart', at: new Date(Date.now() + 3600000).toISOString() });
    s = steps();
    assert.ok(Date.parse(s[0].EndedAt) <= Date.now());
    // Events in one post never run backwards: the second `at` is held at the first.
    seed();
    const a = ago(5 * 60000);
    await evs({ type: 'doing', text: 'Building the bar chart', at: a }, { type: 'done', item: 'Build the bar chart', at: ago(8 * 60000) });
    assert.strictEqual(steps()[0].StartedAt, a);
    assert.ok(steps()[0].DurationMs >= 0 && steps()[0].EndedAt >= steps()[0].StartedAt);
  });
  await check('M4: a failure ending the line at wait_for_direction is logged, and the poll still answers', async () => {
    seed();
    await todo('Building the bar chart');
    const seen = [];
    const orig = console.error;
    console.error = (...a) => { seen.push(a.join(' ')); };
    hooks.beforePut = () => { throw new Error('table unavailable'); };
    let r;
    try { r = await listen(); } finally { hooks.beforePut = null; console.error = orig; }
    assert.strictEqual(r.status, 200);
    assert.ok(seen.some((m) => /doing/i.test(m) && /table unavailable/.test(m)), JSON.stringify(seen));
  });

  console.log('\na line that cannot go on screen (dev walk, 2026-10-10)');
  await check('a refused doing line leaves the current line alone and is refused in words', async () => {
    seed();
    await say({ doing: 'Mocking up three graph options' });
    const r = await hostCall('POST', 'log', { kind: 'progress', doing: 'Editing Header.jsx for the room' }, agentCtx());
    assert.strictEqual(r.status, 400);
    assert.match(String(r.body.error || r.body.message), /can't go on screen/);
    const st = (await hostCall('GET', 'state')).body;
    assert.strictEqual(st.doing.text, 'Mocking up three graph options');
    assert.strictEqual(steps().length, 0);
  });
  await check('an unsafe to-do line in the plugin\'s events is ignored, not taken as an end', async () => {
    seed();
    await hostCall('POST', 'activity', { items: [], events: [{ type: 'doing', text: 'Scaffolding the site', at: new Date().toISOString() }] }, agentCtx());
    await hostCall('POST', 'activity', { items: [], events: [{ type: 'doing', text: 'Fixing App.jsx layout now', at: new Date().toISOString() }] }, agentCtx());
    const st = (await hostCall('GET', 'state')).body;
    assert.strictEqual(st.doing.text, 'Scaffolding the site');
    assert.strictEqual(steps().length, 0);
  });

  console.log('\nttl and sealing');
  await check('every row written carries the session ttl', async () => {
    seed();
    await say({ doing: 'Scaffolding the site', helper: 'A helper is researching contrast rules' });
    await say({ doing: 'Drafting the home page', done: 'Scaffolded the site' });
    assert.ok(ACT().ttl > 0);
    assert.ok(steps().length === 1 && steps()[0].ttl > 0);
  });
  await check('in a team\'s room the line, the helper and the step are sealed at rest and still read', async () => {
    seed({ orgId: ORG });
    const HOST_ORG = { userId: 'user-1', groups: 'hosts', orgId: ORG, orgIds: ORG };
    const AGENT_ORG = { ...agentCtx(), orgId: ORG, orgIds: ORG };
    await hostCall('POST', 'log', { kind: 'progress', text: 'Hi', doing: 'Scaffolding the secret site', helper: 'A helper is researching secret contrast' }, AGENT_ORG);
    await hostCall('POST', 'log', { kind: 'progress', text: 'Hi', doing: 'Drafting the secret page', done: 'Scaffolded the secret site' }, AGENT_ORG);
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
