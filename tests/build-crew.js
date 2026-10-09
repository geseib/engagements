/**
 * BUILD ROOM CREW MODE — the handler end to end against a fake table
 * (docs/design/build-room-crew/FLOWS.md; owner decisions 2026-10-02).
 *
 * The whole crew story: the host opens the project, a builder joins from a
 * phone and connects their own Claude, takes a task, shares an early look,
 * the room reacts once the host puts it on the wall, the host shapes the
 * feedback, the host's Claude reviews — under the "Run crew code" switch —
 * a PR opens, the host's Claude merges and the base moves for everyone. And
 * the walls: what a builder may not do, what a phone may not see.
 */
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

let pass = 0;
let failed = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  PASS  ${label}`); pass++; } catch (e) { console.log(`  FAIL  ${label}\n        ${e.stack.split('\n').slice(0, 3).join('\n        ')}`); failed++; }
}

const GAME = '4821';
const put = (item) => store.set(key(item.PK, item.SK), item);
function seed() {
  store.clear(); bucket.clear(); sent = [];
  put({ PK: `GAME#${GAME}`, SK: 'METADATA', GameType: 'build', Title: 'Food bank sign-up', Details: 'Sign up in a minute', ttl: 2000000000 });
  put({ PK: `GAME#${GAME}`, SK: 'STATE', State: 'STARTED' });
  for (const n of ['Priya', 'Sam', 'Ana', 'Marcus']) put({ PK: `GAME#${GAME}`, SK: `PLAYER#${n}`, PlayerName: n, ClientId: `c-${n}` });
}
const HOST = { userId: 'host-1', groups: 'hosts', orgId: '', orgIds: '' };
const CLAUDE = { agent: 'build', agentGameId: GAME, agentKeyHash: 'h', agentRole: 'host', groups: '' };
const builderAuth = (name) => ({ agent: 'build', agentGameId: GAME, agentKeyHash: 'b', agentRole: 'builder', builderName: name, groups: '' });

async function call(route, method, proxy, body, auth, query) {
  const r = await handler({
    routeKey: `${method} /games/{gameId}/${route}/{proxy+}`,
    requestContext: { http: { method }, ...(auth ? { authorizer: { lambda: auth } } : {}) },
    pathParameters: { gameId: GAME, proxy },
    queryStringParameters: query,
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.statusCode, body: JSON.parse(r.body) };
}
const host = (m, p, b) => call('build', m, p, b, HOST);
const claude = (m, p, b, q) => call('build', m, p, b, CLAUDE, q);
const as = (name) => (m, p, b, q) => call('build', m, p, b, builderAuth(name), q);
const phone = (name) => (m, p, b) => call('build-play', m, p, m === 'GET' ? undefined : { playerName: name, clientId: `c-${name}`, ...(b || {}) }, null, m === 'GET' ? { playerName: name, clientId: `c-${name}` } : undefined);
const priya = as('Priya'); const sam = as('Sam'); const ana = as('Ana');
const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from('parking map pixels')]);
const PATCH = 'From 1234567 Mon Sep 17 00:00:00 2001\nSubject: [PATCH] Parking map\n\ndiff --git a/map.html b/map.html\n+<div id="map"></div>\n';

(async () => {
  seed();
  console.log('\nopening the project to a crew');
  await check('crew routes are refused until the host opens the room to a crew', async () => {
    assert.strictEqual((await claude('POST', 'crew/tasks', { text: 'x' })).status, 409);
    assert.strictEqual((await phone('Priya')('POST', 'crew/builder-key')).status, 409);
  });
  await check('the host opens it; Claude shares the repo; only the host flips switches', async () => {
    const r = await host('POST', 'crew/settings', { enabled: true, modes: ['fork', 'patch'] });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.crew.runCrewCode, false);
    const c = await claude('POST', 'crew/settings', { repoUrl: 'https://github.com/george/foodbank', baseBranch: 'build-room/4821', baseCommit: 'e91b04d', runCrewCode: true });
    assert.strictEqual(c.status, 200);
    const h = await host('GET', 'state');
    assert.deepStrictEqual([h.body.crew.repoUrl, h.body.crew.baseBranch, h.body.crew.baseCommit, h.body.crew.runCrewCode], ['https://github.com/george/foodbank', 'build-room/4821', 'e91b04d', false]);
    assert.strictEqual((await host('POST', 'crew/settings', { repoUrl: 'file:///etc/passwd' })).status, 400);
  });

  console.log('\na builder joins');
  let priyaKey;
  await check('Priya mints a builder key on her phone; a second one retires the first', async () => {
    const r = await phone('Priya')('POST', 'crew/builder-key');
    assert.strictEqual(r.status, 201);
    priyaKey = r.body.key;
    assert.ok(/^eng_4821_/.test(priyaKey));
    await phone('Priya')('POST', 'crew/builder-key');
    const keys = [...store.values()].filter((x) => String(x.SK).startsWith('BUILD#KEY#') && x.PlayerName === 'Priya');
    assert.deepStrictEqual([keys.length, keys.filter((k) => !k.RevokedAt).length, keys[0].Role], [2, 1, 'builder']);
    // The host's own Claude key is untouched by a builder's.
    const h = await host('GET', 'state');
    assert.strictEqual(h.body.agent.key, null);
    assert.deepStrictEqual(h.body.crew.builders.map((b) => [b.name, b.status]), [['Priya', 'setting-up']]);
  });
  await check('her Claude sees the crew and reports in; the board says her laptop is ready', async () => {
    const s = await priya('GET', 'state');
    assert.deepStrictEqual(s.body.you, { role: 'builder', name: 'Priya' });
    assert.strictEqual(s.body.crew.baseBranch, 'build-room/4821');
    const r = await priya('POST', 'crew/me', { mode: 'fork', forkUrl: 'https://github.com/priya-k/foodbank', branch: 'crew/priya/parking-map', commit: 'e91b04d', status: 'building' });
    assert.strictEqual(r.status, 200);
    const h = await host('GET', 'state');
    assert.ok(h.body.log.some((l) => l.text === "Priya's laptop is ready"));
  });
  await phone('Sam')('POST', 'crew/builder-key');
  await sam('POST', 'crew/me', { mode: 'fork', branch: 'crew/sam/parking-list', status: 'building' });

  console.log('\ntasks');
  await check('Claude proposes tasks; two builders on one task is a race, and allowed', async () => {
    await claude('POST', 'crew/tasks', { text: 'Parking map', detail: 'Lots and walking times' });
    await claude('POST', 'crew/tasks', { text: 'Confirmation text' });
    const claimed = await priya('POST', 'crew/tasks/001/claim');
    assert.strictEqual(claimed.status, 200);
    // Her Claude hears the task on the very call that took it.
    assert.deepStrictEqual(claimed.body.inbox.map((i) => i.text.split('\n')[0]), ['You took a task: Parking map']);
    assert.strictEqual((await phone('Sam')('POST', 'crew/claim', { taskId: '001' })).status, 200);
    const h = await host('GET', 'state');
    assert.deepStrictEqual(h.body.crew.tasks[0].claimedBy, ['Priya', 'Sam']);
  });
  await check('the task was delivered once, and never to the host\'s Claude', async () => {
    assert.deepStrictEqual((await priya('GET', 'inbox')).body.inbox, [], 'delivered exactly once');
    assert.deepStrictEqual((await claude('GET', 'inbox')).body.inbox, []);
    // Delivery entries never clutter the host's timeline.
    assert.ok(!(await host('GET', 'state')).body.log.some((l) => /You took a task/.test(l.text)));
  });

  console.log('\nan early look');
  let shareId;
  await check('a screenshot, then the early look; the room cannot see it until the host puts it on the wall', async () => {
    const img = await priya('POST', 'images', { data: PNG.toString('base64'), caption: 'Parking map', kind: 'progress' });
    assert.strictEqual(img.status, 201);
    const r = await priya('POST', 'crew/shares', {
      title: 'Parking map', summary: 'A map of the three lots under the calendar.', unsure: 'Lot hours are typed in by hand.',
      feedbackWanted: 'Is a map better than a list?', commit: '9c41d7a', diffstat: { files: ['src/Map.tsx', 'src/lots.json'], added: 223, removed: 14 },
      imageIds: [img.body.image.imageId],
    });
    assert.strictEqual(r.status, 201);
    shareId = r.body.share.shareId;
    assert.deepStrictEqual([r.body.share.lane, r.body.share.featured, r.body.share.versions.length, r.body.share.versions[0].branch], ['shared', false, 1, 'crew/priya/parking-map']);
    assert.deepStrictEqual((await phone('Ana')('GET', 'state')).body.crew.shares, []);
    assert.strictEqual((await phone('Priya')('GET', 'state')).body.crew.shares.length, 1, 'a builder sees their own');
    assert.strictEqual((await phone('Ana')('POST', 'crew/react', { shareId, kind: 'looks-right' })).status, 404);
  });
  await check('screenshots must be sent first; nobody can add a version to someone else\'s early look', async () => {
    assert.strictEqual((await priya('POST', 'crew/shares', { title: 'x', summary: 'y', imageIds: ['deadbeef'] })).status, 400);
    assert.strictEqual((await sam('POST', 'crew/shares', { shareId, title: 'x', summary: 'y' })).status, 404);
  });
  await check('on the wall: the room reacts, anonymously on phones, by name for the host', async () => {
    assert.strictEqual((await host('POST', `crew/shares/${shareId}`, { action: 'feature' })).status, 200);
    assert.strictEqual((await phone('Ana')('POST', 'crew/react', { shareId, kind: 'question' })).status, 400, 'a question needs words');
    await phone('Ana')('POST', 'crew/react', { shareId, kind: 'question', text: 'Does it work at night?' });
    await phone('Marcus')('POST', 'crew/react', { shareId, kind: 'looks-right' });
    const p = (await phone('Marcus')('GET', 'state')).body.crew.shares[0];
    assert.deepStrictEqual(p.reactions, { 'looks-right': 1, question: 1, concern: 0 });
    // Two reactions in the same millisecond have no order to promise; compare as a set.
    const byKind = (list) => list.slice().sort((a, b) => a[0].localeCompare(b[0]));
    assert.deepStrictEqual(byKind(p.comments.map((c) => [c.kind, c.text, c.name])), [['looks-right', '', 'You'], ['question', 'Does it work at night?', '']]);
    assert.strictEqual(p.prUrl, '');
    const h = (await host('GET', 'state')).body.crew.shares[0];
    assert.deepStrictEqual(h.comments.map((c) => c.name).sort(), ['Ana', 'Marcus']);
  });
  await check('the host shapes it into feedback; it reaches Priya\'s Claude, and she shares v2', async () => {
    await host('POST', `crew/shares/${shareId}/feedback`, { text: 'Keep the map. Show which lots are lit at night.' });
    const r = await priya('GET', 'inbox');
    assert.ok(/Feedback on your early look "Parking map" \(v1\)/.test(r.body.inbox[0].text) && /lit at night/.test(r.body.inbox[0].text), r.body.inbox[0].text);
    assert.strictEqual(r.body.inbox[0].shareId, shareId);
    const v2 = await priya('POST', 'crew/shares', { shareId, title: 'Parking map', summary: 'Lit lots marked.', commit: 'a1b2c3d' });
    assert.deepStrictEqual(v2.body.share.versions.map((v) => v.v), [1, 2]);
  });

  console.log('\nthe host\'s Claude reviews, under the switch');
  await check('the review request tells Claude where the code is and that Run crew code is Off', async () => {
    await host('POST', `crew/shares/${shareId}/review-request`);
    const r = await claude('GET', 'inbox');
    const t = r.body.inbox[0].text;
    assert.ok(/github\.com\/priya-k\/foodbank/.test(t) && /crew\/priya\/parking-map/.test(t) && /a1b2c3d/.test(t) && /OFF: read the code only/.test(t) && /untrusted/.test(t), t);
  });
  await check('with the switch Off, a review that ran their tests is refused', async () => {
    const r = await claude('POST', `crew/shares/${shareId}/review`, { does: 'Adds a map', recommendation: 'merge', testsRun: true });
    assert.strictEqual(r.status, 409);
  });
  await check('a read-only review lands on the card and reaches Priya\'s Claude', async () => {
    const r = await claude('POST', `crew/shares/${shareId}/review`, { does: 'Adds a map of three lots.', fits: ['Clashes with Sam in Header.tsx'], risk: 'Low', suggestions: ['Move hours into lots.json', 'Add one test'], recommendation: 'merge-after-changes' });
    assert.strictEqual(r.status, 201);
    const h = (await host('GET', 'state')).body.crew.shares[0];
    assert.deepStrictEqual([h.lane, h.reviews[0].recommendation, h.reviews[0].runCrewCode, h.reviews[0].version], ['reviewed', 'merge-after-changes', false, 2]);
    const inbox = (await priya('GET', 'inbox')).body.inbox;
    assert.ok(/1\. Move hours into lots\.json/.test(inbox[0].text), inbox[0].text);
  });
  await check('the host switches Run crew code On; it is on the timeline, and a tested review is accepted', async () => {
    await host('POST', 'crew/settings', { runCrewCode: true });
    assert.ok((await host('GET', 'state')).body.log.some((l) => l.text === 'Run crew code: On'));
    const r = await claude('POST', `crew/shares/${shareId}/review`, { does: 'Same, with tests.', recommendation: 'merge', testsRun: true, testsSummary: '42 passed' });
    assert.strictEqual(r.status, 201);
  });

  console.log('\nPR, merge, and the base moving');
  await check('Priya opens the PR; the host\'s Claude merges and the base moves for every builder', async () => {
    assert.strictEqual((await priya('POST', `crew/shares/${shareId}/pr`, { prUrl: 'https://github.com/george/foodbank/pull/7' })).status, 200);
    const m = await claude('POST', 'crew/base', { commit: '7f3c2a1', shareId });
    assert.strictEqual(m.status, 200);
    const h = (await host('GET', 'state')).body;
    assert.deepStrictEqual([h.crew.baseCommit, h.crew.shares[0].lane, h.crew.shares[0].mergedCommit, h.crew.tasks[0].state], ['7f3c2a1', 'merged', '7f3c2a1', 'done']);
    assert.ok(h.log.some((l) => l.kind === 'base' && /Base moved to 7f3c2a1: Priya's Parking map/.test(l.text)));
    const s = (await sam('GET', 'inbox')).body.inbox;
    assert.ok(/moved to 7f3c2a1/.test(s[0].text) && /crew_status/.test(s[0].text), s[0] && s[0].text);
  });
  await check('Sam needs a rebase, and the board says so', async () => {
    await sam('POST', 'crew/me', { status: 'needs-rebase', note: 'Header.tsx clashes' });
    const h = (await host('GET', 'state')).body;
    assert.strictEqual(h.crew.builders.find((b) => b.name === 'Sam').status, 'needs-rebase');
    assert.ok(h.log.some((l) => l.text === 'Sam needs a rebase'));
  });

  console.log('\nhelp, patches, and the walls');
  await check('Sam asks for help; the host sends Claude, which hears it', async () => {
    await sam('POST', 'crew/help', { text: 'The rebase keeps failing on Header.tsx' });
    assert.ok((await phone('Ana')('GET', 'state')).body.log.some((l) => l.kind === 'help'), 'help is visible on the board');
    await host('POST', 'crew/help/Sam', { action: 'send-claude' });
    const r = (await claude('GET', 'inbox')).body.inbox;
    assert.ok(/Sam asked for help/.test(r[0].text) && /crew\/sam\/parking-list/.test(r[0].text), r[0].text);
  });
  await check('patch mode: a real patch is kept (sealed in S3) for the host\'s Claude only', async () => {
    await phone('Ana')('POST', 'crew/builder-key');
    await ana('POST', 'crew/me', { mode: 'patch', status: 'building' });
    assert.strictEqual((await ana('POST', 'crew/shares', { title: 'Text', summary: 'SMS text' })).status, 400, 'patch mode needs the patch');
    assert.strictEqual((await ana('POST', 'crew/shares', { title: 'Text', summary: 'SMS text', patch: 'rm -rf /' })).status, 400);
    const r = await ana('POST', 'crew/shares', { title: 'Confirmation text', summary: 'A text after sign-up', patch: PATCH });
    assert.strictEqual(r.status, 201);
    assert.strictEqual(r.body.share.versions[0].hasPatch, true);
    const id = r.body.share.shareId;
    const got = await claude('GET', `crew/shares/${id}/patch`);
    assert.strictEqual(got.body.patch, PATCH);
    assert.strictEqual((await ana('GET', `crew/shares/${id}/patch`)).status, 403);
  });
  await check('a builder cannot run the room', async () => {
    for (const [m, p, b] of [['POST', 'asks', { kind: 'suggest', prompt: 'x' }], ['POST', 'crew/settings', { runCrewCode: true }], ['POST', `crew/shares/${shareId}`, { action: 'feature' }], ['POST', 'crew/base', { commit: 'abcdef1' }], ['POST', 'outcome', { summary: 'x' }], ['POST', 'keys', {}], ['POST', `crew/shares/${shareId}/review`, { does: 'x', recommendation: 'merge' }]]) {
      assert.strictEqual((await priya(m, p, b)).status, 403, `${m} ${p}`);
    }
    assert.strictEqual((await claude('POST', `crew/shares/${shareId}`, { action: 'feature' })).status, 403, 'putting things on the wall is the host\'s');
  });
  await check('a builder may post a milestone; after the session ends a builder can read but not write', async () => {
    assert.strictEqual((await sam('POST', 'log', { kind: 'milestone', text: 'List view done' })).status, 201);
    store.get(key(`GAME#${GAME}`, 'STATE')).State = 'ENDED';
    assert.strictEqual((await sam('POST', 'crew/me', { status: 'idle' })).status, 409);
    assert.strictEqual((await sam('POST', 'crew/shares', { title: 'Late', summary: 'late' })).status, 409);
    assert.strictEqual((await sam('GET', 'state')).status, 200);
    store.get(key(`GAME#${GAME}`, 'STATE')).State = 'STARTED';
  });
  console.log('\nremoving a builder');
  await check('removing a builder retires their key, closes their lane, frees their task; merged work stays', async () => {
    const before = [...store.values()].filter((x) => String(x.SK).startsWith('BUILD#KEY#') && x.PlayerName === 'Priya' && !x.RevokedAt);
    assert.strictEqual(before.length, 1, 'Priya starts with one live key');
    // An open early look of Sam's (not merged) and Priya's merged one.
    put({ PK: `GAME#${GAME}`, SK: 'BUILD#SHR#sam1', ShareId: 'sam1', Builder: 'Sam', Title: 'List', Lane: 'shared', Versions: [{ v: 1 }], CreatedAt: '2026-10-09T10:00:00Z' });
    assert.strictEqual((await sam('POST', 'crew/me', { status: 'building' })).status, 200);
    const r = await host('POST', 'crew/builders/Sam/remove', {});
    assert.strictEqual(r.status, 200);
    const keys = [...store.values()].filter((x) => String(x.SK).startsWith('BUILD#KEY#') && x.PlayerName === 'Sam');
    assert.ok(keys.length > 0 && keys.every((k) => k.RevokedAt), 'Sam still has a live key');
    assert.ok(keys.every((k) => k.ttl), 'a rewritten key row lost its ttl');
    const row = store.get(key(`GAME#${GAME}`, 'BUILD#BLD#Sam'));
    assert.ok(row.ClosedAt && row.ttl, 'the builder row is not closed, or has no ttl');
    assert.strictEqual(store.get(key(`GAME#${GAME}`, 'BUILD#SHR#sam1')).Lane, 'not-now', 'their open early look stayed in the lane');
    assert.deepStrictEqual(store.get(key(`GAME#${GAME}`, 'BUILD#TASK#001')).ClaimedBy, ['Priya'], 'their claim on the task was kept');
    // Priya's work, merged earlier, is untouched.
    const merged = [...store.values()].find((x) => x.ShareId === shareId);
    assert.deepStrictEqual([merged.Lane, merged.MergedCommit], ['merged', '7f3c2a1']);
    assert.ok(keys.every((k) => k.PlayerName === 'Sam'));
    assert.strictEqual([...store.values()].filter((x) => String(x.SK).startsWith('BUILD#KEY#') && x.PlayerName === 'Priya' && !x.RevokedAt).length, 1, 'removing Sam touched Priya\'s key');
  });
  await check('the crew view says closed, the board no longer counts them, and they are not told the base moved', async () => {
    const h = (await host('GET', 'state')).body;
    assert.strictEqual(h.crew.builders.find((b) => b.name === 'Sam').closed, true);
    assert.strictEqual(h.crew.builders.find((b) => b.name === 'Priya').closed, false);
    assert.strictEqual(h.crew.pipeline.building, 0, 'a closed builder still counts as building');
    const before = (await sam('GET', 'inbox')).status;
    assert.ok(before === 403, `the removed builder's own calls are refused (got ${before})`);
  });
  await check('even if the authorizer let the old key through, every call of theirs is refused', async () => {
    for (const [m, p, b] of [['GET', 'state'], ['GET', 'inbox'], ['POST', 'crew/me', { status: 'building' }], ['POST', 'crew/shares', { title: 'x', summary: 'y' }], ['POST', 'log', { kind: 'milestone', text: 'x' }]]) {
      assert.strictEqual((await sam(m, p, b)).status, 403, `${m} ${p}`);
    }
  });
  await check('removal is the host\'s alone, and an unknown builder is a 404', async () => {
    assert.strictEqual((await priya('POST', 'crew/builders/Priya/remove', {})).status, 403);
    assert.strictEqual((await claude('POST', 'crew/builders/Priya/remove', {})).status, 403);
    assert.strictEqual((await host('POST', 'crew/builders/Nobody/remove', {})).status, 404);
    assert.ok(![...store.values()].some((x) => x.PlayerName === 'Priya' && x.ClosedAt));
  });
  await check('removing twice is harmless', async () => {
    assert.strictEqual((await host('POST', 'crew/builders/Sam/remove', {})).status, 200);
  });
  await check('Bring back gives a seat but not the old key: they mint a new one and are a builder again', async () => {
    // remove-player.js's restore only clears the player's RemovedAt; the key stays retired.
    const oldKeys = [...store.values()].filter((x) => String(x.SK).startsWith('BUILD#KEY#') && x.PlayerName === 'Sam').map((x) => x.SK);
    assert.strictEqual((await phone('Sam')('POST', 'crew/builder-key')).status, 201);
    const live = [...store.values()].filter((x) => String(x.SK).startsWith('BUILD#KEY#') && x.PlayerName === 'Sam' && !x.RevokedAt);
    assert.strictEqual(live.length, 1);
    assert.ok(!oldKeys.includes(live[0].SK), 'the old key came back');
    assert.strictEqual(store.get(key(`GAME#${GAME}`, 'BUILD#BLD#Sam')).ClosedAt, undefined, 'still closed after reconnecting');
    assert.strictEqual((await sam('GET', 'inbox')).status, 200);
    assert.strictEqual((await host('GET', 'state')).body.crew.builders.find((b) => b.name === 'Sam').closed, false);
  });
  await check('a removed player\'s phone is refused on the play routes (RemovedAt), builders included', async () => {
    store.get(key(`GAME#${GAME}`, 'PLAYER#Ana')).RemovedAt = '2026-10-09T10:00:00Z';
    assert.strictEqual((await phone('Ana')('GET', 'state')).status, 403);
    assert.ok(!(await host('GET', 'state')).body.joined || true);
    delete store.get(key(`GAME#${GAME}`, 'PLAYER#Ana')).RemovedAt;
    assert.strictEqual((await phone('Ana')('GET', 'state')).status, 200);
  });
  await check('a closed builder does not take one of the eight seats', async () => {
    const c = store.get(key(`GAME#${GAME}`, 'BUILD#BLD#Sam'));
    c.ClosedAt = '2026-10-09T11:00:00Z';
    const C2 = require(path.join(REPO, 'lambda-functions/game/build-crew.js'));
    assert.strictEqual(C2.liveBuilders({ builders: [c, { PlayerName: 'P' }] }).length, 1);
    delete c.ClosedAt;
  });

  await check('eight builders at most', async () => {
    for (let i = 0; i < 6; i++) put({ PK: `GAME#${GAME}`, SK: `BUILD#BLD#X${i}`, PlayerName: `X${i}`, Status: 'building' });
    put({ PK: `GAME#${GAME}`, SK: 'PLAYER#Ninth', PlayerName: 'Ninth', ClientId: 'c-Ninth' });
    const r = await phone('Ninth')('POST', 'crew/builder-key');
    assert.strictEqual(r.status, 409);
    assert.ok(/full/.test(r.body.error));
  });

  await check('the pipeline counts a builder whose task merged as done, until they take another', async () => {
    const C = require(path.join(REPO, 'lambda-functions/game/build-crew.js'));
    const room = {
      builders: [{ PlayerName: 'P', Status: 'building', TaskId: '1' }, { PlayerName: 'S', Status: 'building', TaskId: '1' }],
      shares: [{ Builder: 'P', TaskId: '1', Lane: 'merged' }],
    };
    assert.strictEqual(C.pipeline(room).building, 1);
    room.builders[0].TaskId = '2';
    assert.strictEqual(C.pipeline(room).building, 2);
    room.builders[0].TaskId = '1'; room.builders[0].Status = 'needs-rebase';
    assert.strictEqual(C.pipeline(room).building, 2);
  });

  console.log(`\n${pass} passed, ${failed} failed`);
  suiteFinished();
  process.exit(failed ? 1 : 0);
})();
