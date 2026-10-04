/**
 * BUILD ROOM — the handler end to end against a fake table
 * (docs/design/build-room/PLAN.md §6).
 *
 * The loop the feature exists for: Claude (session key) asks, the host reviews
 * and opens, phones answer and vote, the host decides and edits the direction,
 * and Claude receives that direction exactly once on its next call. Plus the
 * walls around it: who may do what, what a phone may see, what Claude may not
 * see, and that an org session's prose is sealed at rest.
 *
 * Expectations are written by hand, never read back off the handler's own
 * output.
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

(async () => {
  console.log('\nbuild-store: validation');
  await check('a choice gets letters A, B in order, and drops a javascript: url', () => {
    const r = S.normalizeAsk({ kind: 'choice', question: 'Which header?', options: [{ title: 'Bold', url: 'javascript:alert(1)' }, { title: 'Calm', url: 'http://localhost:5173/b' }] });
    assert.deepStrictEqual(r.value.options, [
      { label: 'A', title: 'Bold', detail: '', url: '' },
      { label: 'B', title: 'Calm', detail: '', url: 'http://localhost:5173/b' },
    ]);
    assert.strictEqual(r.value.maxPicks, 1);
  });
  await check('a choice needs two options; an unknown kind is refused', () => {
    assert.ok(S.normalizeAsk({ kind: 'choice', prompt: 'x', options: ['one'] }).error);
    assert.ok(S.normalizeAsk({ kind: 'essay', prompt: 'x' }).error);
    assert.ok(S.normalizeAsk({ kind: 'suggest', prompt: '   ' }).error);
  });
  await check('vote is Ideas-only; close needs live or voting', () => {
    assert.ok(S.transition({ Kind: 'choice', Status: 'live' }, 'vote').error);
    assert.strictEqual(S.transition({ Kind: 'suggest', Status: 'live' }, 'vote').to, 'voting');
    assert.ok(S.transition({ Kind: 'suggest', Status: 'proposed' }, 'close').conflict);
  });
  await check('session keys: format, game, and hash', () => {
    const { key: k, hash } = S.mintKey(GAME);
    assert.ok(/^eng_4821_[A-Za-z0-9_-]{43}$/.test(k));
    assert.deepStrictEqual(S.parseKey(k), { gameId: GAME });
    assert.strictEqual(hash, require('crypto').createHash('sha256').update(k).digest('hex'));
    assert.strictEqual(S.parseKey('eng_12_abc'), null);
  });

  console.log('\nthe loop: Claude asks, the room answers, the host decides, Claude hears');
  seed();
  let askId;
  await check('Claude\'s ask arrives PROPOSED (review is on by default) and phones cannot see it', async () => {
    const r = await agentCall('POST', 'asks', { kind: 'choice', prompt: 'Which header should volunteers see first?', options: [{ title: 'Bold banner' }, { title: 'Calm photo' }] });
    assert.strictEqual(r.status, 201);
    assert.strictEqual(r.body.ask.status, 'proposed');
    assert.strictEqual(r.body.ask.source, 'agent');
    assert.deepStrictEqual(r.body.ask.options.map((o) => o.label), ['A', 'B']);
    assert.deepStrictEqual(r.body.inbox, []);
    askId = r.body.ask.askId;
    assert.strictEqual(askId, '001');
    const p = await playCall('GET', 'state', priya);
    assert.strictEqual(p.status, 200);
    assert.strictEqual(p.body.current, null);
  });
  await check('every write tells every connection buildChanged', () => {
    const types = new Set(sent.map((s) => s.message.type));
    assert.deepStrictEqual([...types], ['buildChanged']);
    assert.ok(sent.some((s) => s.connectionId === 'p-1'));
  });
  await check('Claude cannot open its own ask; the host can, after editing it', async () => {
    const a = await agentCall('POST', `asks/${askId}`, { action: 'open' });
    assert.strictEqual(a.status, 403);
    const e = await hostCall('POST', `asks/${askId}`, { action: 'edit', prompt: 'Which header first?' });
    assert.strictEqual(e.body.ask.prompt, 'Which header first?');
    const o = await hostCall('POST', `asks/${askId}`, { action: 'open' });
    assert.strictEqual(o.body.ask.status, 'live');
  });
  await check('a phone picks B with a why; the host sees names, the phone does not see results yet', async () => {
    const r = await playCall('POST', 'respond', { ...priya, askId, choice: ['B'], why: 'Dates first' });
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(r.body.mine.answer, { choice: ['B'], rating: null, why: 'Dates first' });
    await playCall('POST', 'respond', { ...marcus, askId, choice: 'A' });
    const p = await playCall('GET', 'state', marcus);
    assert.strictEqual(p.body.current.results, null);
    const h = await hostCall('GET', 'state');
    const ask = h.body.asks[0];
    assert.deepStrictEqual(ask.results.options.map((o) => [o.label, o.count, o.voters]), [['A', 1, ['Marcus']], ['B', 1, ['Priya']]]);
    assert.deepStrictEqual(ask.results.whys, [{ label: 'B', text: 'Dates first', playerName: 'Priya' }]);
  });
  await check('options freeze once anyone has answered', async () => {
    const r = await hostCall('POST', `asks/${askId}`, { action: 'edit', options: ['X', 'Y', 'Z'] });
    assert.strictEqual(r.status, 400);
  });
  await check('a picker outside the options, or a stranger, is refused', async () => {
    assert.strictEqual((await playCall('POST', 'respond', { ...priya, askId, choice: ['C'] })).status, 400);
    assert.strictEqual((await playCall('POST', 'respond', { playerName: 'Priya', clientId: 'someone-else', askId, choice: ['A'] })).status, 403);
    assert.strictEqual((await playCall('GET', 'state', { playerName: 'Nobody', clientId: 'x' })).status, 403);
  });
  await check('close, then decide with the host\'s own words; the phone sees it as decided', async () => {
    await hostCall('POST', `asks/${askId}`, { action: 'close' });
    const d = await hostCall('POST', `asks/${askId}`, { action: 'decide', direction: 'Use B, but keep A\'s logo', chosen: ['B'], note: 'Someone said: bigger button' });
    assert.strictEqual(d.body.ask.status, 'decided');
    assert.strictEqual(d.body.ask.decision.direction, 'Use B, but keep A\'s logo');
    const p = await playCall('GET', 'state', priya);
    assert.deepStrictEqual(p.body.decisions.map((x) => x.direction), ['Use B, but keep A\'s logo']);
    assert.strictEqual(p.body.current.decision.note, undefined);
  });
  await check('Claude hears the direction on its next call — once', async () => {
    const r = await agentCall('GET', `asks/${askId}`);
    assert.strictEqual(r.body.ask.status, 'decided');
    assert.strictEqual(r.body.inbox.length, 1);
    assert.strictEqual(r.body.inbox[0].text, 'Use B, but keep A\'s logo\n\nAlso from the room: Someone said: bigger button');
    assert.strictEqual(r.body.inbox[0].askId, askId);
    const again = await agentCall('GET', 'state');
    assert.deepStrictEqual(again.body.inbox, []);
    const h = await hostCall('GET', 'state');
    assert.ok(h.body.asks[0].decision.deliveredAt);
    assert.strictEqual(h.body.agent.connected, true);
  });

  await check('a phone never sees the host\'s decision note: no direction entries, no decision detail', async () => {
    const p = await playCall('GET', 'state', priya);
    assert.ok(!JSON.stringify(p.body).includes('bigger button'));
    // one entry per decision on the host's timeline, flagged for Claude and delivered
    const h = await hostCall('GET', 'state');
    const decisions = h.body.log.filter((l) => l.askId === askId && ['decision', 'direction'].includes(l.kind));
    assert.deepStrictEqual(decisions.map((l) => [l.kind, l.forAgent, Boolean(l.deliveredAt)]), [['decision', true, true]]);
    assert.strictEqual(p.body.current.decision.sentToAgent, true);
  });

  console.log('\nIdeas: suggest, vote, rank');
  let ideasId;
  await check('with review off, Claude\'s Ideas ask goes straight to the room', async () => {
    await hostCall('POST', 'settings', { reviewAgentAsks: false });
    const r = await agentCall('POST', 'asks', { kind: 'suggest', prompt: 'What stops someone signing up?' });
    assert.strictEqual(r.body.ask.status, 'live');
    ideasId = r.body.ask.askId;
    const h = await hostCall('GET', 'state');
    assert.strictEqual(h.body.currentAskId, ideasId);
  });
  let mine, theirs, verbal;
  await check('phones suggest (up to 3 each); the host adds what was said out loud', async () => {
    mine = (await playCall('POST', 'respond', { ...priya, askId: ideasId, text: 'Making an account first' })).body.mine.responses[0].respId;
    await playCall('POST', 'respond', { ...priya, askId: ideasId, text: 'two' });
    await playCall('POST', 'respond', { ...priya, askId: ideasId, text: 'three' });
    assert.strictEqual((await playCall('POST', 'respond', { ...priya, askId: ideasId, text: 'four' })).status, 409);
    theirs = (await playCall('POST', 'respond', { ...marcus, askId: ideasId, text: 'No idea where to park' })).body.mine.responses[0].respId;
    const v = await hostCall('POST', `asks/${ideasId}/responses`, { text: 'Not sure teens can come' });
    verbal = v.body.ask.responses.find((r) => r.source === 'host').respId;
  });
  await check('during voting phones see the ballot anonymously, own ideas flagged, and cannot vote for them', async () => {
    await hostCall('POST', `asks/${ideasId}`, { action: 'vote' });
    const p = await playCall('GET', 'state', priya);
    const ballot = p.body.current.responses;
    assert.strictEqual(ballot.length, 5);
    assert.ok(ballot.every((r) => r.playerName === undefined && r.votes === undefined));
    assert.strictEqual(ballot.find((r) => r.respId === mine).mine, true);
    assert.strictEqual((await playCall('POST', 'vote', { ...priya, askId: ideasId, respIds: [mine] })).status, 400);
    assert.strictEqual((await playCall('POST', 'vote', { ...priya, askId: ideasId, respIds: [theirs, verbal] })).status, 200);
    assert.strictEqual((await playCall('POST', 'vote', { ...marcus, askId: ideasId, respIds: [verbal] })).status, 200);
  });
  await check('the host hides one; results rank by votes; the default direction names the winner', async () => {
    const two = (await hostCall('GET', 'state')).body.asks[1].responses.find((r) => r.text === 'two').respId;
    await hostCall('POST', `asks/${ideasId}/responses/${two}`, { action: 'hide' });
    await hostCall('POST', `asks/${ideasId}`, { action: 'close' });
    const p = await playCall('GET', 'state', marcus);
    assert.deepStrictEqual(p.body.current.results.ranked.slice(0, 2).map((r) => [r.text, r.votes]), [['Not sure teens can come', 2], ['No idea where to park', 1]]);
    assert.ok(!p.body.current.results.ranked.some((r) => r.text === 'two'));
    const d = await hostCall('POST', `asks/${ideasId}`, { action: 'decide' });
    assert.strictEqual(d.body.ask.decision.direction, 'The room\'s top idea: Not sure teens can come');
  });

  console.log('\ntimeline, ideas inbox, wrap-up');
  await check('Claude posts progress; a host note never reaches Claude or a phone', async () => {
    assert.strictEqual((await agentCall('POST', 'log', { kind: 'showing', text: 'Mockups at localhost:5173', link: 'http://localhost:5173' })).status, 201);
    assert.strictEqual((await agentCall('POST', 'log', { kind: 'decision', text: 'I decided' })).status, 400);
    await hostCall('POST', 'log', { kind: 'note', text: 'Marcus seems bored' });
    const a = await agentCall('GET', 'state');
    assert.ok(!a.body.log.some((l) => l.kind === 'note'));
    assert.deepStrictEqual(a.body.ideas, []);
    const p = await playCall('GET', 'state', priya);
    assert.ok(!p.body.log.some((l) => l.kind === 'note'));
    assert.ok(p.body.log.some((l) => l.kind === 'showing' && l.link === ''), 'a phone cannot open the laptop\'s localhost');
  });
  await check('a verbal note sent to Claude rides along on Claude\'s next call', async () => {
    await agentCall('GET', 'state'); // drain the Ideas decision
    await hostCall('POST', 'log', { kind: 'verbal', text: 'The room says the colours are too dark', forAgent: true });
    const a = await agentCall('POST', 'log', { text: 'Footer done' });
    assert.deepStrictEqual(a.body.inbox.map((i) => i.text), ['The room said: The room says the colours are too dark']);
  });
  await check('a phone\'s idea lands in the host\'s inbox and can be sent to Claude', async () => {
    assert.strictEqual((await playCall('POST', 'idea', { ...marcus, text: 'Add a map of the parking' })).status, 201);
    const h = await hostCall('GET', 'state');
    const idea = h.body.ideas[0];
    assert.deepStrictEqual([idea.text, idea.playerName, idea.status], ['Add a map of the parking', 'Marcus', 'new']);
    const r = await hostCall('POST', `ideas/${idea.ideaId}`, { action: 'direct' });
    assert.strictEqual(r.body.idea.status, 'promoted');
    const a = await agentCall('GET', 'state');
    assert.deepStrictEqual(a.body.inbox.map((i) => i.text), ['An idea from the room: Add a map of the parking']);
    const p = await playCall('GET', 'state', marcus);
    assert.deepStrictEqual(p.body.myIdeas.map((i) => i.status), ['promoted']);
  });
  await check('an idea added to an Ideas ask is not its author\'s own suggestion, and its author stays anonymous on phones', async () => {
    const ask = (await hostCall('POST', 'asks', { kind: 'suggest', prompt: 'Anything else?' })).body.ask;
    await playCall('POST', 'idea', { ...priya, text: 'A big friendly map' });
    const idea = (await hostCall('GET', 'state')).body.ideas.find((i) => i.text === 'A big friendly map');
    assert.strictEqual((await hostCall('POST', `ideas/${idea.ideaId}`, { action: 'suggest' })).status, 200);
    for (const t of ['one', 'two', 'three']) assert.strictEqual((await playCall('POST', 'respond', { ...priya, askId: ask.askId, text: t })).status, 200);
    await hostCall('POST', `asks/${ask.askId}`, { action: 'vote' });
    const p = await playCall('GET', 'state', priya);
    const promoted = p.body.current.responses.find((r) => r.text === 'A big friendly map');
    assert.strictEqual(promoted.mine, false);
    assert.strictEqual((await playCall('POST', 'vote', { ...priya, askId: ask.askId, respIds: [promoted.respId] })).status, 200);
    const ideaEntry = p.body.log.find((l) => l.kind === 'idea');
    assert.strictEqual(ideaEntry.detail, '');
    await hostCall('POST', `asks/${ask.askId}`, { action: 'discard' });
  });
  await check('Claude wraps up; links are http(s) only; the host can rewrite it', async () => {
    const r = await agentCall('POST', 'outcome', { summary: 'A sign-up site with shifts', built: ['Shift calendar'], links: [{ label: 'Repo', url: 'https://github.com/x/y' }, { label: 'bad', url: 'ftp://x' }] });
    assert.deepStrictEqual(r.body.outcome.links, [{ label: 'Repo', url: 'https://github.com/x/y' }]);
    await hostCall('POST', 'outcome', { summary: 'A sign-up site, edited' });
    const p = await playCall('GET', 'state', priya);
    assert.strictEqual(p.body.outcome.summary, 'A sign-up site, edited');
  });

  await check('local links reach the host (who can open them) but never a phone (which cannot)', async () => {
    const ask = (await agentCall('POST', 'asks', { kind: 'choice', prompt: 'Which footer?', options: [{ title: 'Plain', url: 'http://localhost:5173/a' }, { title: 'Map', url: 'https://preview.example.com/b' }] })).body.ask;
    await hostCall('POST', `asks/${ask.askId}`, { action: 'open' });
    await agentCall('POST', 'log', { kind: 'showing', text: 'Demo is up', link: 'http://127.0.0.1:3000/' });
    await agentCall('POST', 'outcome', { summary: 'Done', links: [{ label: 'Demo', url: 'http://localhost:5173/' }, { label: 'Repo', url: 'https://github.com/x/y' }] });
    const h = await hostCall('GET', 'state');
    assert.strictEqual(h.body.asks.find((a) => a.askId === ask.askId).options[0].url, 'http://localhost:5173/a');
    assert.deepStrictEqual(h.body.outcome.links.map((l) => l.label), ['Demo', 'Repo']);
    const p = await playCall('GET', 'state', priya);
    assert.deepStrictEqual(p.body.current.options.map((o) => o.url), ['', 'https://preview.example.com/b']);
    assert.ok(!JSON.stringify(p.body).includes('127.0.0.1'));
    assert.deepStrictEqual(p.body.outcome.links.map((l) => l.label), ['Repo']);
    await hostCall('POST', `asks/${ask.askId}`, { action: 'discard' });
  });
  await check('Claude waiting on its inbox shows as listening, and only the start of listening is announced', async () => {
    sent = [];
    const r = await agentCall('GET', 'inbox?listening=1'.split('?')[0], null);
    assert.strictEqual(r.status, 200);
    const listen = () => handler({
      routeKey: 'GET /games/{gameId}/build/{proxy+}',
      requestContext: { http: { method: 'GET' }, authorizer: { lambda: agentCtx() } },
      pathParameters: { gameId: GAME, proxy: 'inbox' },
      queryStringParameters: { listening: '1' },
    });
    await listen();
    const announced = sent.length;
    assert.ok(announced > 0, 'the start of listening is announced');
    await listen();
    assert.strictEqual(sent.length, announced, 'a second poll inside the window announces nothing');
    const h = await hostCall('GET', 'state');
    assert.strictEqual(h.body.agent.listening, true);
    assert.strictEqual((await hostCall('GET', 'inbox')).status, 403);
  });

  console.log('\nscreenshots');
  const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from('a tiny but real-enough png body')]);
  await check('Claude sends a screenshot of Choice A: the host and the phones both see it on the option', async () => {
    const ask = (await agentCall('POST', 'asks', { kind: 'choice', prompt: 'Which hero?', options: ['Bold', 'Calm'] })).body.ask;
    await hostCall('POST', `asks/${ask.askId}`, { action: 'open' });
    const up = await agentCall('POST', 'images', { data: PNG.toString('base64'), caption: 'Choice A, the bold hero', kind: 'mockup', askId: ask.askId, label: 'a' });
    assert.strictEqual(up.status, 201);
    assert.strictEqual(up.body.image.contentType, 'image/png');
    const id = up.body.image.imageId;
    const h = await hostCall('GET', 'state');
    assert.strictEqual(h.body.asks.find((a) => a.askId === ask.askId).options[0].imageId, id);
    assert.strictEqual(h.body.asks.find((a) => a.askId === ask.askId).options[1].imageId, null);
    assert.ok(h.body.log.some((l) => l.kind === 'image' && l.text === 'Choice A, the bold hero'));
    const p = await playCall('GET', 'state', priya);
    assert.strictEqual(p.body.current.options[0].imageId, id);
    const img = await handler({
      routeKey: 'GET /games/{gameId}/build-play/{proxy+}', requestContext: { http: { method: 'GET' } },
      pathParameters: { gameId: GAME, proxy: `images/${id}` }, queryStringParameters: priya,
    });
    assert.strictEqual(img.statusCode, 200);
    assert.strictEqual(img.isBase64Encoded, true);
    assert.strictEqual(img.headers['Content-Type'], 'image/png');
    assert.ok(Buffer.from(img.body, 'base64').equals(PNG));
    assert.strictEqual((await handler({
      routeKey: 'GET /games/{gameId}/build-play/{proxy+}', requestContext: { http: { method: 'GET' } },
      pathParameters: { gameId: GAME, proxy: `images/${id}` }, queryStringParameters: { playerName: 'Nobody', clientId: 'x' },
    })).statusCode, 403);
    await hostCall('POST', `asks/${ask.askId}`, { action: 'discard' });
  });
  await check('an image is checked by its bytes, its size and its ask', async () => {
    assert.strictEqual((await agentCall('POST', 'images', { data: Buffer.from('<svg onload=alert(1)>').toString('base64') })).status, 415);
    assert.strictEqual((await agentCall('POST', 'images', { data: Buffer.concat([PNG, Buffer.alloc(3 * 1024 * 1024)]).toString('base64') })).status, 413);
    assert.strictEqual((await agentCall('POST', 'images', { data: PNG.toString('base64'), askId: '999' })).status, 404);
    assert.strictEqual((await agentCall('POST', 'images', { data: '' })).status, 400);
  });
  await check('the host can delete a screenshot; it leaves the bucket and the timeline', async () => {
    // A room in an organisation, made by this host: a delete is the creator's,
    // an org admin's or staff's with a reason, and leaves an audit entry
    // (2026-10-04; tests/delete-authorization.js has every role).
    seed({ orgId: ORG, createdBy: 'user-1' });
    const ownHost = { ...HOST, orgId: ORG, orgIds: ORG, orgRole: 'member' };
    const id = (await agentCall('POST', 'images', { data: PNG.toString('base64'), kind: 'final', caption: 'Final' })).body.image.imageId;
    assert.ok([...bucket.keys()].some((k) => k.endsWith(id)));
    assert.strictEqual((await agentCall('POST', `images/${id}`, { action: 'delete' })).status, 403);
    assert.strictEqual((await hostCall('POST', `images/${id}`, { action: 'delete' }, ownHost)).status, 200);
    assert.ok([...store.values()].some((r) => r.PK === `ORG#${ORG}#AUDIT` && r.Action === 'buildroom-artifact.delete'));
    assert.ok(![...bucket.keys()].some((k) => k.endsWith(id)));
    const h = await hostCall('GET', 'state', null, ownHost);
    assert.ok(!h.body.images.some((i) => i.imageId === id));
    assert.ok(!h.body.log.some((l) => l.kind === 'image' && l.detail === id));
  });

  console.log('\nwho may do what');
  await check('a key for another session gets nothing', async () => {
    assert.strictEqual((await agentCall('GET', 'state', null, '9999')).status, 404);
  });
  await check('Claude cannot mint keys, change settings or send directions', async () => {
    assert.strictEqual((await agentCall('POST', 'keys', {})).status, 403);
    assert.strictEqual((await agentCall('POST', 'settings', { reviewAgentAsks: true })).status, 403);
    assert.strictEqual((await agentCall('POST', 'directions', { text: 'x' })).status, 403);
  });
  await check('a host of another org gets 404; a caller with no identity gets 404', async () => {
    store.get(key(`GAME#${GAME}`, 'METADATA')).orgId = 'org_Other';
    assert.strictEqual((await hostCall('GET', 'state', null, { userId: 'u2', groups: 'hosts', orgId: 'org_Mine', orgIds: 'org_Mine' })).status, 404);
    delete store.get(key(`GAME#${GAME}`, 'METADATA')).orgId;
    assert.strictEqual((await hostCall('GET', 'state', null, { groups: '' })).status, 404);
  });
  await check('not a build session → 404', async () => {
    store.get(key(`GAME#${GAME}`, 'METADATA')).GameType = 'call-and-answer';
    assert.strictEqual((await hostCall('GET', 'state')).status, 404);
    store.get(key(`GAME#${GAME}`, 'METADATA')).GameType = 'build';
  });
  await check('minting a key retires the last one; only its hash is stored', async () => {
    const one = await hostCall('POST', 'keys', { label: 'Laptop' });
    const two = await hostCall('POST', 'keys', {});
    assert.notStrictEqual(one.body.key, two.body.key);
    const rows = [...store.values()].filter((r) => String(r.SK).startsWith('BUILD#KEY#'));
    assert.strictEqual(rows.filter((r) => !r.RevokedAt).length, 1);
    assert.ok(!JSON.stringify(rows).includes(two.body.key));
    const h = await hostCall('GET', 'state');
    assert.strictEqual(h.body.agent.key.keyId, two.body.keyId);
  });
  await check('an ended session refuses new asks and answers', async () => {
    store.get(key(`GAME#${GAME}`, 'STATE')).State = 'ENDED';
    assert.strictEqual((await agentCall('POST', 'asks', { kind: 'suggest', prompt: 'x' })).status, 409);
    assert.strictEqual((await playCall('POST', 'idea', { ...priya, text: 'late idea' })).status, 409);
  });

  console.log('\nan org session is sealed at rest');
  seed({ orgId: ORG });
  await check('prompt, options, suggestions, timeline and wrap-up are ciphertext in the table and plaintext through the API', async () => {
    const HOST_ORG = { userId: 'user-1', groups: 'hosts', orgId: ORG, orgIds: ORG };
    const r = await hostCall('POST', 'asks', { kind: 'suggest', prompt: 'Secret question' }, HOST_ORG);
    assert.strictEqual(r.status, 201);
    await playCall('POST', 'respond', { ...priya, askId: r.body.ask.askId, text: 'Secret answer' });
    await hostCall('POST', 'log', { kind: 'verbal', text: 'Secret verbal' }, HOST_ORG);
    await hostCall('POST', 'outcome', { summary: 'Secret outcome' }, HOST_ORG);
    const raw = JSON.stringify([...store.values()].filter((x) => String(x.SK).startsWith('BUILD#')));
    for (const s of ['Secret question', 'Secret answer', 'Secret verbal', 'Secret outcome']) assert.ok(!raw.includes(s), `${s} is plaintext at rest`);
    // and a screenshot is ciphertext in the bucket, plaintext through the API
    const PNG2 = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from('secret mockup pixels')]);
    const up = await hostCall('POST', 'images', { data: PNG2.toString('base64'), caption: 'Secret caption' }, HOST_ORG);
    assert.strictEqual(up.status, 201);
    const obj = [...bucket.entries()].find(([k]) => k.endsWith(up.body.image.imageId))[1];
    assert.ok(!obj.Body.includes(Buffer.from('secret mockup pixels')), 'image bytes are plaintext at rest');
    assert.ok(!JSON.stringify([...store.values()]).includes('Secret caption'));
    const img = await handler({
      routeKey: 'GET /games/{gameId}/build/{proxy+}', requestContext: { http: { method: 'GET' }, authorizer: { lambda: HOST_ORG } },
      pathParameters: { gameId: GAME, proxy: `images/${up.body.image.imageId}` },
    });
    assert.ok(Buffer.from(img.body, 'base64').equals(PNG2));
    const h = await hostCall('GET', 'state', null, HOST_ORG);
    assert.strictEqual(h.body.asks[0].prompt, 'Secret question');
    assert.strictEqual(h.body.asks[0].responses[0].text, 'Secret answer');
    assert.strictEqual(h.body.outcome.summary, 'Secret outcome');
    assert.ok(h.body.log.some((l) => l.text === 'Secret verbal'));
  });

  console.log(`\n${pass} passed, ${failed} failed`);
  suiteFinished();
  process.exit(failed ? 1 : 0);
})();
