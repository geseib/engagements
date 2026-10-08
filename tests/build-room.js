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

  await check('the Stop hook\'s checkpoint never takes a direction; the checkpoint tool does', async () => {
    await agentCall('GET', 'state'); // drain anything earlier checks left
    const said = await hostCall('POST', 'log', { kind: 'verbal', text: 'Make the board bigger', forAgent: true });
    assert.strictEqual(said.status, 201, JSON.stringify(said.body));
    // Claude Code has stopped; its plugin's Stop hook checkpoints the turn and drops the answer.
    const hook = await agentCall('POST', 'log', { kind: 'checkpoint', text: 'Work in progress', detail: 'commit abc123 · 2 files' });
    assert.strictEqual(hook.status, 201, JSON.stringify(hook.body));
    assert.deepStrictEqual(hook.body.inbox, undefined, 'the hook is handed nothing');
    let h = await hostCall('GET', 'state');
    const entry = () => h.body.log.find((l) => l.text === 'Make the board bigger');
    assert.strictEqual(entry().deliveredAt, null, 'still waiting for Claude, not "Claude has it"');
    // Claude's own checkpoint tool reads its answer, so it may carry it.
    const tool = await agentCall('POST', 'log', { kind: 'checkpoint', text: 'Saved', detail: 'commit def456 · 1 file', fromTool: true });
    assert.ok(tool.body.inbox.some((d) => /Make the board bigger/.test(d.text)), JSON.stringify(tool.body));
    h = await hostCall('GET', 'state');
    assert.ok(entry().deliveredAt);
  });

  await check('the host answers FOR the room: a proposed ask decided out loud, never opened to phones', async () => {
    const c = await agentCall('POST', 'asks', { kind: 'rating', prompt: 'How close is this?', lowLabel: 'Far', highLabel: 'There' });
    const id = c.body.ask.askId;
    assert.strictEqual(c.body.ask.status, 'proposed');
    // One fixed scale (owner, 2026-10-06): labels sent by Claude are ignored.
    assert.deepStrictEqual(c.body.ask.scale, { min: 1, max: 5, lowLabel: 'Needs work', highLabel: 'Great' });
    // With nobody answering, a direction is still required.
    assert.strictEqual((await hostCall('POST', `asks/${id}`, { action: 'decide', chosen: ['4'], spoken: true })).status, 400);
    const d = await hostCall('POST', `asks/${id}`, {
      action: 'decide', direction: 'How close is this: 4 out of 5', chosen: ['4'], note: 'Wants the dates bigger', spoken: true,
    });
    assert.strictEqual(d.status, 200, JSON.stringify(d.body));
    assert.strictEqual(d.body.ask.status, 'decided');
    assert.strictEqual(d.body.ask.decision.spoken, true);
    assert.strictEqual(d.body.ask.decision.method, 'spoken');
    assert.ok(!d.body.ask.openedAt, 'it never opened to the phones');
    const r = await agentCall('GET', `asks/${id}`);
    assert.strictEqual(r.body.ask.decision.spoken, true);
    const mine = r.body.inbox.filter((x) => x.askId === id);
    assert.strictEqual(mine.length, 1);
    // Claude gets the question and the answer (and the host's note); how it
    // was decided is the record's, not Claude's (owner, 2026-10-06).
    // A rating says what its number means, even when the host wrote the words.
    assert.strictEqual(mine[0].text, 'How close is this: 4 out of 5 (5 is great, 1 needs work)\n\nAlso from the room: Wants the dates bigger');
    assert.strictEqual(d.body.ask.decision.direction, 'How close is this: 4 out of 5 (5 is great, 1 needs work)');
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
  const QIDEAS = 'What stops someone signing up';
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
  await check('during voting phones see the ballot anonymously, own ideas flagged, and may vote for them (owner, 2026-10-06)', async () => {
    await hostCall('POST', `asks/${ideasId}`, { action: 'vote' });
    const p = await playCall('GET', 'state', priya);
    const ballot = p.body.current.responses;
    assert.strictEqual(ballot.length, 5);
    assert.ok(ballot.every((r) => r.playerName === undefined && r.votes === undefined));
    assert.strictEqual(ballot.find((r) => r.respId === mine).mine, true);
    // Your own counts: with two people, each could otherwise only vote for the other's.
    assert.strictEqual((await playCall('POST', 'vote', { ...priya, askId: ideasId, respIds: [mine] })).status, 200);
    assert.strictEqual((await playCall('POST', 'vote', { ...priya, askId: ideasId, respIds: [theirs, verbal] })).status, 200);
    assert.strictEqual((await playCall('POST', 'vote', { ...marcus, askId: ideasId, respIds: [verbal] })).status, 200);
  });
  await check('the host hides one; results rank by votes; the default direction names the winner', async () => {
    const two = (await hostCall('GET', 'state')).body.asks.find((a) => a.askId === ideasId).responses.find((r) => r.text === 'two').respId;
    await hostCall('POST', `asks/${ideasId}/responses/${two}`, { action: 'hide' });
    await hostCall('POST', `asks/${ideasId}`, { action: 'close' });
    const p = await playCall('GET', 'state', marcus);
    assert.deepStrictEqual(p.body.current.results.ranked.slice(0, 2).map((r) => [r.text, r.votes]), [['Not sure teens can come', 2], ['No idea where to park', 1]]);
    assert.ok(!p.body.current.results.ranked.some((r) => r.text === 'two'));
    const d = await hostCall('POST', `asks/${ideasId}`, { action: 'decide' });
    assert.strictEqual(d.body.ask.decision.direction, `${QIDEAS}: Not sure teens can come`);
    assert.strictEqual(d.body.ask.decision.method, 'vote');
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

  console.log('\nwhat Claude Code is doing (owner, 2026-10-04)');
  seed();
  await check('activity lines reach the HOST\'s screen only, cleaned, the latest twelve kept', async () => {
    sent = [];
    const r = await agentCall('POST', 'activity', { items: [
      { at: new Date().toISOString(), kind: 'edit', text: 'Edited Header.jsx' },
      { kind: 'bogus', text: '  Ran   npm test  ' },
      { kind: 'edit', text: '' },
    ] });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.deepStrictEqual(r.body.activity.map((a) => [a.kind, a.text]), [['edit', 'Edited Header.jsx'], ['other', 'Ran npm test']]);
    assert.ok(sent.length > 0 && sent.every((x) => x.connectionId === 'host-1' && x.message.type === 'buildActivity'), JSON.stringify(sent));
    assert.deepStrictEqual(sent[0].message.items.map((a) => a.text), ['Edited Header.jsx', 'Ran npm test']);
    const h = await hostCall('GET', 'state');
    assert.deepStrictEqual(h.body.activity.map((a) => a.text), ['Edited Header.jsx', 'Ran npm test']);
    const p = await playCall('GET', 'state', priya);
    assert.strictEqual(p.body.activity, undefined, 'a phone never sees it');
    for (let i = 1; i <= 20; i += 1) {
      await agentCall('POST', 'activity', { items: [{ at: new Date(Date.now() + i).toISOString(), kind: 'run', text: `Step ${i}` }] });
    }
    const after = (await hostCall('GET', 'state')).body.activity;
    assert.strictEqual(after.length, S.ACTIVITY_KEEP);
    assert.strictEqual(after[after.length - 1].text, 'Step 20');
  });
  await check('an activity post never takes Claude\'s inbox: a direction waits for a call Claude reads', async () => {
    assert.strictEqual((await hostCall('POST', 'directions', { text: 'Make the header bigger' })).status, 201);
    const a = await agentCall('POST', 'activity', { items: [{ kind: 'edit', text: 'Edited Header.jsx' }] });
    assert.strictEqual(a.body.inbox, undefined, 'the pump would throw it away');
    const r = await agentCall('GET', 'inbox');
    assert.deepStrictEqual(r.body.inbox.map((d) => d.text), ['Make the header bigger']);
  });
  await check('only Claude reports activity, and a laptop clock in the future is pulled back to now', async () => {
    assert.strictEqual((await hostCall('POST', 'activity', { items: [{ kind: 'edit', text: 'x' }] })).status, 403);
    const r = await agentCall('POST', 'activity', { items: [{ at: '2099-01-01T00:00:00.000Z', kind: 'read', text: 'Read App.jsx' }] });
    const mine = r.body.activity.find((a) => a.text === 'Read App.jsx');
    assert.ok(Date.parse(mine.at) <= Date.now(), mine.at);
    assert.strictEqual((await agentCall('POST', 'activity', { items: 'nope' })).status, 400);
  });

  console.log('\nfeedback on a preview (owner, 2026-10-04)');
  seed();
  await check('a phone says "Looks good" or "Needs a change" on what Claude is showing; once per preview', async () => {
    const shown = await agentCall('POST', 'log', { kind: 'showing', text: 'Header B is live', link: 'http://localhost:5173/' });
    assert.strictEqual(shown.status, 201, JSON.stringify(shown.body));
    const logId = shown.body.entry.logId;
    const p = await playCall('GET', 'state', priya);
    assert.ok(p.body.log.some((e) => e.logId === logId && e.kind === 'showing'), 'the phone sees the preview');
    assert.strictEqual((await playCall('POST', 'idea', { ...priya, aboutLogId: logId, verdict: 'change' })).status, 400, 'a change needs words');
    assert.strictEqual((await playCall('POST', 'idea', { ...priya, aboutLogId: logId, verdict: 'meh' })).status, 400);
    assert.strictEqual((await playCall('POST', 'idea', { ...priya, aboutLogId: logId, verdict: 'change', text: 'Bigger button' })).status, 201);
    assert.strictEqual((await playCall('POST', 'idea', { ...priya, aboutLogId: logId, verdict: 'good' })).status, 409, 'once per preview');
    assert.strictEqual((await playCall('POST', 'idea', { ...marcus, aboutLogId: logId, verdict: 'good' })).status, 201);
    assert.strictEqual((await playCall('POST', 'idea', { ...marcus, aboutLogId: 'nope', verdict: 'good' })).status, 409);
    const h = await hostCall('GET', 'state');
    // Sorted by name: two ideas inside one millisecond have no stable order.
    assert.deepStrictEqual(h.body.ideas.map((i) => [i.playerName, i.text, i.aboutLogId]).sort(), [
      ['Marcus', 'On the preview "Header B is live": Looks good', logId],
      ['Priya', 'On the preview "Header B is live": Needs a change: Bigger button', logId],
    ]);
    const mine = (await playCall('GET', 'state', priya)).body.myIdeas;
    assert.deepStrictEqual(mine.map((i) => i.aboutLogId), [logId]);
  });

  console.log('\nan org session is sealed at rest');
  seed({ orgId: ORG });
  await check('Claude\'s activity is ciphertext at rest in an org session, and plain through the API', async () => {
    const r = await agentCall('POST', 'activity', { items: [{ kind: 'edit', text: 'Edited payroll.js' }] });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.ok(!JSON.stringify([...store.values()]).includes('payroll.js'), 'activity is plaintext at rest');
    const h = await hostCall('GET', 'state', undefined, { userId: 'user-1', groups: 'hosts', orgId: ORG, orgIds: ORG });
    assert.ok(h.body.activity.some((a) => a.text === 'Edited payroll.js'), JSON.stringify(h.body.activity));
  });
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

  console.log('\nthe wheel and the revote (owner, 2026-10-05)');
  const tie = async (auth) => {
    const c = await hostCall('POST', 'asks', { kind: 'choice', prompt: 'What should we build?', options: ['Sign-up page', 'Shift map', 'Reminder texts'] }, auth);
    const id = c.body.ask.askId;
    await playCall('POST', 'respond', { ...priya, askId: id, choice: ['A'] });
    await playCall('POST', 'respond', { ...marcus, askId: id, choice: ['B'] });
    await hostCall('POST', `asks/${id}`, { action: 'close' }, auth);
    return id;
  };
  seed();
  let wid;
  await check('a tie is named in the results, for the host and for phones', async () => {
    wid = await tie();
    const h = await hostCall('GET', 'state');
    assert.deepStrictEqual(h.body.asks.find((a) => a.askId === wid).results.tied, ['A', 'B']);
    const p = await playCall('GET', 'state', priya);
    assert.deepStrictEqual(p.body.current.results.tied, ['A', 'B']);
  });
  await check('only the host sets up the wheel; it holds the tied options and a random person from the room spins', async () => {
    assert.strictEqual((await agentCall('POST', `asks/${wid}`, { action: 'wheel' })).status, 403);
    const r = await hostCall('POST', `asks/${wid}`, { action: 'wheel' });
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(r.body.ask.wheel.slices, [{ id: 'A', label: 'A', text: 'Sign-up page' }, { id: 'B', label: 'B', text: 'Shift map' }]);
    assert.ok(['Priya', 'Marcus'].includes(r.body.ask.wheel.spinner));
    assert.strictEqual(r.body.ask.wheel.armed, true);
    assert.strictEqual(r.body.ask.wheel.landed, null);
  });
  await check('the spinner\'s phone gets the turn; the other phone cannot spin', async () => {
    const h = await hostCall('GET', 'state');
    const spinner = h.body.asks.find((a) => a.askId === wid).wheel.spinner;
    const me = spinner === 'Priya' ? priya : marcus;
    const other = spinner === 'Priya' ? marcus : priya;
    assert.strictEqual((await playCall('GET', 'state', me)).body.current.wheel.mine, true);
    assert.strictEqual((await playCall('GET', 'state', other)).body.current.wheel.mine, false);
    assert.strictEqual((await playCall('POST', 'spin', { ...other, askId: wid })).status, 403);
    assert.strictEqual((await playCall('POST', 'spin', { ...me, askId: wid })).status, 200);
    // One spin per turn: the same phone cannot spin again.
    assert.strictEqual((await playCall('POST', 'spin', { ...me, askId: wid })).status, 403);
    const after = (await hostCall('GET', 'state')).body.asks.find((a) => a.askId === wid).wheel;
    assert.ok(['A', 'B'].includes(after.landed));
    assert.strictEqual(after.spins.length, 1);
    assert.strictEqual(after.spins[0].by, spinner);
    assert.ok(after.spins[0].turns >= 5 && after.spins[0].turns <= 7);
    assert.strictEqual(after.armed, false);
  });
  await check('the host can always spin again; the room hears where it landed', async () => {
    const r = await hostCall('POST', `asks/${wid}`, { action: 'spin' });
    assert.strictEqual(r.body.ask.wheel.spins.length, 2);
    assert.strictEqual(r.body.ask.wheel.spins[1].by, 'host');
    const log = (await hostCall('GET', 'state')).body.log;
    assert.ok(log.some((l) => /^The wheel landed on [AB]: /.test(l.text)));
  });
  await check('a respin by someone else picks another person and gives them the turn', async () => {
    const before = (await hostCall('GET', 'state')).body.asks.find((a) => a.askId === wid).wheel.spinner;
    const r = await hostCall('POST', `asks/${wid}`, { action: 'pass' });
    assert.notStrictEqual(r.body.ask.wheel.spinner, before);
    assert.strictEqual(r.body.ask.wheel.armed, true);
  });
  await check('deciding without words sends what the wheel picked', async () => {
    const landed = (await hostCall('GET', 'state')).body.asks.find((a) => a.askId === wid).wheel;
    const slice = landed.slices.find((x) => x.id === landed.landed);
    const d = await hostCall('POST', `asks/${wid}`, { action: 'decide' });
    assert.strictEqual(d.body.ask.decision.direction, `What should we build: ${slice.text}`);
    assert.strictEqual(d.body.ask.decision.method, 'wheel');
    // Decided: no more spinning.
    assert.strictEqual((await hostCall('POST', `asks/${wid}`, { action: 'spin' })).status, 409);
    // The host's own pick is recorded as theirs.
    seed();
    const id2 = await tie();
    const h = await hostCall('POST', `asks/${id2}`, { action: 'decide', direction: 'What should we build: Reminder texts', chosen: ['C'], method: 'host' });
    assert.strictEqual(h.body.ask.decision.method, 'host');
    const inbox = (await agentCall('GET', 'inbox')).body.inbox;
    assert.deepStrictEqual(inbox.map((x) => x.text), ['What should we build: Reminder texts']);
  });
  await check('the wheel instead of a vote: an open ask closes and the wheel holds every option', async () => {
    seed();
    const c = await hostCall('POST', 'asks', { kind: 'choice', prompt: 'What should we build?', options: ['One', 'Two', 'Three'] });
    await playCall('POST', 'respond', { ...priya, askId: c.body.ask.askId, choice: ['A'] });
    const w = await hostCall('POST', `asks/${c.body.ask.askId}`, { action: 'wheel' });
    assert.strictEqual(w.status, 200);
    assert.strictEqual(w.body.ask.status, 'results');
    assert.deepStrictEqual(w.body.ask.wheel.slices.map((x) => x.id), ['A', 'B', 'C']);
    // Answers are closed now.
    assert.strictEqual((await playCall('POST', 'respond', { ...marcus, askId: c.body.ask.askId, choice: ['B'] })).status, 409);
    // An Ideas ask still collecting, or voting, can go to the wheel too.
    const i = await hostCall('POST', 'asks', { kind: 'suggest', prompt: 'Ideas?' });
    await playCall('POST', 'respond', { ...priya, askId: i.body.ask.askId, text: 'A map' });
    await playCall('POST', 'respond', { ...marcus, askId: i.body.ask.askId, text: 'Texts' });
    const iw = await hostCall('POST', `asks/${i.body.ask.askId}`, { action: 'wheel' });
    assert.deepStrictEqual(iw.body.ask.wheel.slices.map((x) => x.text).sort(), ['A map', 'Texts']);
    // Spin, pass and revote still wait for the results; a proposed ask has no wheel.
    const p = await hostCall('POST', 'asks', { kind: 'choice', prompt: 'Later?', options: ['X', 'Y'], draft: true });
    assert.strictEqual((await hostCall('POST', `asks/${p.body.ask.askId}`, { action: 'wheel' })).status, 409);
  });
  await check('no tie, the wheel holds every option; a rating has no wheel', async () => {
    seed();
    const c = await hostCall('POST', 'asks', { kind: 'choice', prompt: 'Which?', options: ['One', 'Two', 'Three'] });
    const id = c.body.ask.askId;
    await hostCall('POST', `asks/${id}`, { action: 'close' });
    const w = await hostCall('POST', `asks/${id}`, { action: 'wheel', spinner: 'host' });
    assert.deepStrictEqual(w.body.ask.wheel.slices.map((x) => x.id), ['A', 'B', 'C']);
    assert.strictEqual(w.body.ask.wheel.spinner, null);
    const r = await hostCall('POST', 'asks', { kind: 'rating', prompt: 'How close?' });
    await hostCall('POST', `asks/${r.body.ask.askId}`, { action: 'close' });
    assert.strictEqual((await hostCall('POST', `asks/${r.body.ask.askId}`, { action: 'wheel' })).status, 400);
  });
  await check('a revote opens a new ask with only the tied options, letters and mockups kept', async () => {
    seed();
    const id = await tie();
    const shot = await hostCall('POST', 'images', { askId: id, label: 'B', kind: 'mockup', data: PNG.toString('base64'), contentType: 'image/png' });
    assert.strictEqual(shot.status, 201);
    const r = await hostCall('POST', `asks/${id}`, { action: 'revote' });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.ask.status, 'live');
    assert.strictEqual(r.body.ask.revoteOf, id);
    assert.deepStrictEqual(r.body.ask.options.map((o) => [o.label, o.title]), [['A', 'Sign-up page'], ['B', 'Shift map']]);
    assert.strictEqual(r.body.ask.options[1].imageId, shot.body.image.imageId);
    const h = await hostCall('GET', 'state');
    assert.strictEqual(h.body.currentAskId, r.body.ask.askId);
    assert.strictEqual(h.body.asks.find((a) => a.askId === id).revotedAs, r.body.ask.askId);
    // A phone votes on the revote by its original letter.
    assert.strictEqual((await playCall('POST', 'respond', { ...priya, askId: r.body.ask.askId, choice: ['B'] })).status, 200);
  });
  await check('an Ideas revote goes straight to voting on the tied suggestions, still anonymous, own ones still marked', async () => {
    seed();
    const c = await hostCall('POST', 'asks', { kind: 'suggest', prompt: 'What should we build?' });
    const id = c.body.ask.askId;
    await playCall('POST', 'respond', { ...priya, askId: id, text: 'A shift map' });
    await playCall('POST', 'respond', { ...marcus, askId: id, text: 'Reminder texts' });
    await hostCall('POST', `asks/${id}`, { action: 'vote' });
    const p = (await playCall('GET', 'state', priya)).body.current.responses;
    const m = (await playCall('GET', 'state', marcus)).body.current.responses;
    await playCall('POST', 'vote', { ...priya, askId: id, respIds: [p.find((x) => !x.mine).respId] });
    await playCall('POST', 'vote', { ...marcus, askId: id, respIds: [m.find((x) => !x.mine).respId] });
    await hostCall('POST', `asks/${id}`, { action: 'close' });
    const r = await hostCall('POST', `asks/${id}`, { action: 'revote' });
    assert.strictEqual(r.body.ask.status, 'voting');
    assert.deepStrictEqual(r.body.ask.responses.map((x) => x.text).sort(), ['A shift map', 'Reminder texts']);
    const mine = (await playCall('GET', 'state', priya)).body.current.responses.find((x) => x.mine);
    assert.strictEqual(mine.text, 'A shift map');
    assert.strictEqual((await playCall('POST', 'vote', { ...priya, askId: r.body.ask.askId, respIds: [mine.respId] })).status, 200);
  });
  await check('in a team\'s room the wheel\'s words are sealed at rest', async () => {
    seed({ orgId: ORG });
    const HOST_TEAM = { userId: 'user-1', groups: 'hosts', orgId: ORG, orgIds: ORG };
    const id = await tie(HOST_TEAM);
    const w = await hostCall('POST', `asks/${id}`, { action: 'wheel' }, HOST_TEAM);
    assert.strictEqual(w.status, 200);
    assert.strictEqual(w.body.ask.wheel.slices[0].text, 'Sign-up page');
    assert.ok(!JSON.stringify([...store.values()]).includes('Shift map'), 'the wheel\'s slices are plaintext at rest');
  });

  console.log('\nacknowledge, and a comment on the wall (owner, 2026-10-05)');
  const sendIdea = async (who, text) => { await playCall('POST', 'idea', { ...who, text }); };
  const ideaOf = async (text) => (await hostCall('GET', 'state')).body.ideas.find((i) => i.text === text);
  await check('Acknowledge takes it off the list, tells Claude nothing, and the phone sees it was seen', async () => {
    seed();
    await sendIdea(priya, 'I like the look of the new buttons');
    const idea = await ideaOf('I like the look of the new buttons');
    const logsBefore = (await hostCall('GET', 'state')).body.log.length;
    const r = await hostCall('POST', `ideas/${idea.ideaId}`, { action: 'acknowledge' });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.idea.status, 'acknowledged');
    const h = await hostCall('GET', 'state');
    assert.strictEqual(h.body.log.length, logsBefore, 'an acknowledged comment is not a record');
    const inbox = await agentCall('GET', 'inbox');
    assert.strictEqual(inbox.status, 200);
    assert.ok(Array.isArray(inbox.body.inbox));
    assert.ok(!JSON.stringify(inbox.body).includes('new buttons'), 'Claude was told about it');
    const p = await playCall('GET', 'state', priya);
    assert.deepStrictEqual(p.body.myIdeas.map((i) => [i.text, i.status, i.walled]), [['I like the look of the new buttons', 'acknowledged', false]]);
  });
  await check('Show on the wall acknowledges it and puts it, without a name, on the host\'s wall for a short while', async () => {
    seed();
    await sendIdea(marcus, 'The calendar reads really well');
    const idea = await ideaOf('The calendar reads really well');
    const r = await hostCall('POST', `ideas/${idea.ideaId}`, { action: 'wall' });
    assert.strictEqual(r.body.idea.status, 'acknowledged');
    assert.strictEqual(r.body.idea.walled, true);
    const h = await hostCall('GET', 'state');
    assert.strictEqual(h.body.wallComment.text, 'The calendar reads really well');
    assert.strictEqual(h.body.wallComment.ideaId, idea.ideaId);
    assert.ok(!('playerName' in h.body.wallComment));
    assert.strictEqual(S.WALL_COMMENT_MS, 20000);
    // Claude and phones never get it.
    const a = await agentCall('GET', 'state');
    assert.strictEqual(a.body.wallComment, null);
    const p = await playCall('GET', 'state', priya);
    assert.ok(!('wallComment' in p.body));
    assert.strictEqual((await playCall('GET', 'state', marcus)).body.myIdeas[0].walled, true);
  });
  await check('the host can take it down early', async () => {
    const c = await hostCall('POST', 'ideas/wall/clear', {});
    assert.strictEqual(c.status, 200);
    assert.strictEqual((await hostCall('GET', 'state')).body.wallComment, null);
  });
  await check('Acknowledge all clears every new one at once, and restore brings one back', async () => {
    seed();
    await sendIdea(priya, 'Nice colours');
    await sendIdea(marcus, 'Love the map');
    const r = await hostCall('POST', 'ideas/acknowledge-all', {});
    assert.strictEqual(r.body.acknowledged, 2);
    const ideas = (await hostCall('GET', 'state')).body.ideas;
    assert.deepStrictEqual(ideas.map((i) => i.status), ['acknowledged', 'acknowledged']);
    const back = await hostCall('POST', `ideas/${ideas[0].ideaId}`, { action: 'restore' });
    assert.strictEqual(back.body.idea.status, 'new');
    assert.strictEqual((await agentCall('POST', 'ideas/acknowledge-all', {})).status, 403);
  });
  await check('in a team\'s room the comment on the wall is sealed at rest', async () => {
    seed({ orgId: ORG });
    const HOST_TEAM = { userId: 'user-1', groups: 'hosts', orgId: ORG, orgIds: ORG };
    await sendIdea(priya, 'A secret compliment');
    const idea = (await hostCall('GET', 'state', null, HOST_TEAM)).body.ideas[0];
    await hostCall('POST', `ideas/${idea.ideaId}`, { action: 'wall' }, HOST_TEAM);
    assert.strictEqual((await hostCall('GET', 'state', null, HOST_TEAM)).body.wallComment.text, 'A secret compliment');
    assert.ok(!JSON.stringify([...store.values()]).includes('A secret compliment'), 'the wall comment is plaintext at rest');
  });

  console.log('\nthe queue: later, queue it, ideas to a vote, mockups first, open next (step 4)');
  const state = async () => (await hostCall('GET', 'state')).body;
  const threeIdeas = async () => {
    await sendIdea(priya, 'Text a reminder the day before');
    await sendIdea(marcus, 'Put the address and a map link at the top');
    await sendIdea(priya, 'Let people sign up as a pair');
    // In the order they were sent (ideas sent in one millisecond sort by their random suffix).
    const ideas = (await state()).ideas;
    return ['Text a reminder the day before', 'Put the address and a map link at the top', 'Let people sign up as a pair']
      .map((t) => ideas.find((i) => i.text === t).ideaId);
  };
  await check('a used idea says how: sent to Claude, or added to the room\'s ideas (step 7)', async () => {
    seed();
    await sendIdea(priya, 'Bigger dates');
    const idea = await ideaOf('Bigger dates');
    await hostCall('POST', `ideas/${idea.ideaId}`, { action: 'direct' });
    const mine = (await playCall('GET', 'state', priya)).body.myIdeas.find((i) => i.text === 'Bigger dates');
    assert.deepStrictEqual([mine.status, mine.promotedVia], ['promoted', 'claude']);
  });
  await check('Later parks an idea; Restore brings it back', async () => {
    seed();
    await sendIdea(priya, 'Dark mode');
    const idea = await ideaOf('Dark mode');
    assert.strictEqual((await hostCall('POST', `ideas/${idea.ideaId}`, { action: 'later' })).body.idea.status, 'later');
    assert.strictEqual((await hostCall('POST', `ideas/${idea.ideaId}`, { action: 'restore' })).body.idea.status, 'new');
  });
  await check('Queue it: the host\'s own idea waits in the queue and never shows on a phone', async () => {
    seed();
    const r = await hostCall('POST', 'ideas', { text: 'Check it on a small phone' });
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    assert.strictEqual(r.body.idea.source, 'host');
    assert.strictEqual((await hostCall('POST', 'ideas', { text: '  ' })).status, 400);
    assert.strictEqual((await agentCall('POST', 'ideas', { text: 'Claude cannot queue' })).status, 403);
    const p = await playCall('GET', 'state', { playerName: 'Host', clientId: 'c-host-named' });
    assert.ok(!JSON.stringify(p.body).includes('Check it on a small phone'));
  });
  await check('ideas to a vote: Pick one by default, opens at once, the ideas are used', async () => {
    seed();
    const ids = await threeIdeas();
    const r = await hostCall('POST', 'asks-from-ideas', { ideaIds: ids });
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    const ask = r.body.ask;
    assert.deepStrictEqual([ask.kind, ask.status, ask.maxPicks, ask.prompt], ['choice', 'live', 1, 'Which should Claude build next?'], JSON.stringify(ask));
    assert.deepStrictEqual(ask.options.map((o) => [o.label, o.title]), [['A', 'Text a reminder the day before'], ['B', 'Put the address and a map link at the top'], ['C', 'Let people sign up as a pair']]);
    assert.deepStrictEqual(ask.fromIdeas, ids);
    const st = await state();
    assert.strictEqual(st.currentAskId || st.current?.askId, ask.askId);
    assert.ok(st.ideas.every((i) => i.status === 'promoted' && i.promotedTo === ask.askId));
    // Used once: a second vote from the same ideas is refused.
    assert.strictEqual((await hostCall('POST', 'asks-from-ideas', { ideaIds: ids })).status, 409);
  });
  await check('ideas to a vote: needs 2 to 6, the host only, and real ideas', async () => {
    seed();
    const ids = await threeIdeas();
    assert.strictEqual((await hostCall('POST', 'asks-from-ideas', { ideaIds: [ids[0]] })).status, 400);
    assert.strictEqual((await hostCall('POST', 'asks-from-ideas', { ideaIds: [ids[0], 'nope'] })).status, 404);
    assert.strictEqual((await agentCall('POST', 'asks-from-ideas', { ideaIds: ids })).status, 403);
    const pick2 = await hostCall('POST', 'asks-from-ideas', { ideaIds: ids, maxPicks: 2, prompt: 'Which two first?', open: false });
    assert.deepStrictEqual([pick2.body.ask.status, pick2.body.ask.maxPicks, pick2.body.ask.prompt], ['proposed', 2, 'Which two first?']);
  });
  await check('mockups first: the vote waits hidden, Claude is asked, Ready when every option has a picture', async () => {
    seed();
    const ids = await threeIdeas();
    const r = await hostCall('POST', 'asks-from-ideas', { ideaIds: ids, askForMockups: true });
    const id = r.body.ask.askId;
    assert.strictEqual(r.body.ask.status, 'proposed');
    assert.deepStrictEqual(r.body.ask.mockups, { asked: true, have: 0, total: 3, ready: false });
    const p = await playCall('GET', 'state', priya);
    assert.ok(!JSON.stringify(p.body).includes('Which should Claude build next'), `the room cannot see it yet: ${JSON.stringify(p.body)}`);
    const inbox = (await agentCall('GET', 'inbox')).body.inbox;
    assert.ok(inbox.some((d) => /make a quick mockup of options A, B, C/.test(d.text) && d.askId === id), JSON.stringify(inbox));
    for (const label of ['A', 'B']) await agentCall('POST', 'images', { data: PNG.toString('base64'), kind: 'mockup', askId: id, label });
    let ask = (await state()).asks.find((a) => a.askId === id);
    assert.deepStrictEqual(ask.mockups, { asked: true, have: 2, total: 3, ready: false });
    await agentCall('POST', 'images', { data: PNG.toString('base64'), kind: 'mockup', askId: id, label: 'C' });
    ask = (await state()).asks.find((a) => a.askId === id);
    assert.strictEqual(ask.mockups.ready, true);
    assert.strictEqual(ask.status, 'proposed', 'Ready never opens by itself');
  });
  await check('Open next: lined up behind the open ask, opens when it closes', async () => {
    seed();
    const ids = await threeIdeas();
    const now = await hostCall('POST', 'asks', { kind: 'rating', prompt: 'How close is this?' });
    const openId = now.body.ask.askId;
    const waiting = (await hostCall('POST', 'asks-from-ideas', { ideaIds: ids, askForMockups: true })).body.ask.askId;
    const q = await hostCall('POST', `asks/${waiting}`, { action: 'openNext' });
    assert.strictEqual(q.status, 200, JSON.stringify(q.body));
    assert.strictEqual(q.body.ask.next, true);
    assert.strictEqual(q.body.ask.status, 'proposed');
    await hostCall('POST', `asks/${openId}`, { action: 'close' });
    const st = await state();
    assert.strictEqual(st.asks.find((a) => a.askId === waiting).status, 'live');
    assert.ok(st.log.some((l) => /Opened ask \d+ next/.test(l.text)));
    // Only a waiting ask can be lined up.
    assert.strictEqual((await hostCall('POST', `asks/${openId}`, { action: 'openNext' })).status, 409);
  });
  await check('Open next with nothing open opens it now; Not next takes it out of line', async () => {
    seed();
    const ids = await threeIdeas();
    const waiting = (await hostCall('POST', 'asks-from-ideas', { ideaIds: ids, open: false })).body.ask.askId;
    assert.strictEqual((await hostCall('POST', `asks/${waiting}`, { action: 'openNext' })).body.ask.status, 'live');
    seed();
    const ids2 = await threeIdeas();
    const open = (await hostCall('POST', 'asks', { kind: 'rating', prompt: 'How close?' })).body.ask.askId;
    const w2 = (await hostCall('POST', 'asks-from-ideas', { ideaIds: ids2, open: false })).body.ask.askId;
    await hostCall('POST', `asks/${w2}`, { action: 'openNext' });
    assert.strictEqual((await hostCall('POST', `asks/${w2}`, { action: 'notNext' })).body.ask.next, undefined);
    await hostCall('POST', `asks/${open}`, { action: 'close' });
    assert.strictEqual((await state()).asks.find((a) => a.askId === w2).status, 'proposed');
  });
  await check('Cancel the vote: the ideas go back to the queue', async () => {
    seed();
    const ids = await threeIdeas();
    const id = (await hostCall('POST', 'asks-from-ideas', { ideaIds: ids, askForMockups: true })).body.ask.askId;
    assert.strictEqual((await hostCall('POST', `asks/${id}`, { action: 'discard' })).status, 200);
    const st = await state();
    assert.ok(st.ideas.every((i) => i.status === 'new' && !i.promotedTo), JSON.stringify(st.ideas));
  });

  console.log('\nwhat Claude gets: four kinds, and the room brief (step 7c)');
  await check('Keep in mind reaches Claude and the brief; For Claude, later is held until the host sends it', async () => {
    seed();
    await hostCall('POST', 'directions', { text: 'Has to work on old phones', as: 'keep' });
    await hostCall('POST', 'directions', { text: 'Let people sign up as a pair', as: 'later' });
    await hostCall('POST', 'directions', { text: 'How long would reminder texts take?', as: 'ask' });
    await hostCall('POST', 'directions', { text: 'Make the 13:00 row say full' });
    let st = await state();
    assert.deepStrictEqual(st.brief.keep.map((i) => i.text), ['Has to work on old phones']);
    assert.deepStrictEqual(st.brief.later.map((i) => i.text), ['Let people sign up as a pair']);
    // (Entries written in one millisecond sort by their random suffix, so compare by text.)
    const kindOf = (list) => Object.fromEntries(list.map((x) => [x.text.replace(/^.*: /, ''), x.as]));
    assert.deepStrictEqual(kindOf(st.log.filter((l) => l.kind === 'direction')), {
      'Has to work on old phones': 'keep', 'Let people sign up as a pair': 'later', 'How long would reminder texts take?': 'ask', 'Make the 13:00 row say full': 'do-now',
    });
    const heldEntry = st.log.find((l) => l.text === 'Let people sign up as a pair');
    assert.strictEqual(heldEntry.held, true);
    // Owner, 2026-10-06: "only when I send it". Claude's inbox and brief carry no Later item.
    const r = await agentCall('GET', 'inbox');
    assert.deepStrictEqual(kindOf(r.body.inbox), { 'Has to work on old phones': 'keep', 'How long would reminder texts take?': 'ask', 'Make the 13:00 row say full': 'do-now' });
    assert.deepStrictEqual(r.body.brief.keep.map((i) => i.text), ['Has to work on old phones'], 'the brief rides along');
    assert.deepStrictEqual(r.body.brief.later, [], 'never the Later list');
    assert.deepStrictEqual((await agentCall('GET', 'state')).body.brief.later, []);
    // Send now: it goes to Claude as Do now and leaves the list.
    const id = st.brief.later[0].id;
    assert.strictEqual((await agentCall('POST', `brief/later/${id}/send`, {})).status, 403);
    const sent = await hostCall('POST', `brief/later/${id}/send`, {});
    assert.strictEqual(sent.status, 201, JSON.stringify(sent.body));
    const got = (await agentCall('GET', 'inbox')).body.inbox;
    assert.deepStrictEqual(got.map((d) => [d.text, d.as]), [['Let people sign up as a pair', 'do-now']]);
    st = await state();
    assert.deepStrictEqual(st.brief.later, []);
    assert.strictEqual((await hostCall('POST', `brief/later/${id}/send`, {})).status, 404);
    // An unknown kind is Do now.
    await hostCall('POST', 'directions', { text: 'Bigger buttons', as: 'whenever' });
    assert.strictEqual((await agentCall('GET', 'inbox')).body.inbox[0].as, 'do-now');
  });
  await check('a ready question carries what Claude gets and its note; the decision goes as that kind', async () => {
    seed();
    const c = await hostCall('POST', 'asks', { kind: 'suggest', prompt: 'Who is this for, in one sentence?', claudeGets: 'keep', claudeNote: 'Treat the winning answer as the audience.' });
    assert.deepStrictEqual([c.body.ask.claudeGets, c.body.ask.claudeNote], ['keep', 'Treat the winning answer as the audience.']);
    // No fromQuestion sent: none recorded. A ready question records where it came from.
    assert.strictEqual(c.body.ask.fromQuestion, undefined);
    const r2 = await hostCall('POST', 'asks', { kind: 'suggest', prompt: 'What should we cut?', fromQuestion: 'platform:buildroomstarters:c004#001' });
    assert.strictEqual(r2.body.ask.fromQuestion, 'platform:buildroomstarters:c004#001');
    assert.ok(!JSON.stringify((await playCall('GET', 'state', priya)).body).includes('buildroomstarters'), 'phones never see it');
    await hostCall('POST', `asks/${r2.body.ask.askId}`, { action: 'discard' });
    const p = await playCall('GET', 'state', priya);
    assert.ok(!JSON.stringify(p.body).includes('Treat the winning answer'), 'the note is never shown to the room');
    const d = await hostCall('POST', `asks/${c.body.ask.askId}`, { action: 'decide', direction: 'Who is this for: busy volunteers on an old phone' });
    assert.strictEqual(d.body.ask.decision.as, undefined, 'the kind is the record\'s; the view does not need it');
    const inbox = (await agentCall('GET', 'inbox')).body.inbox;
    assert.strictEqual(inbox[0].as, 'keep');
    assert.strictEqual(inbox[0].text, 'Who is this for: busy volunteers on an old phone\n\nHow to use it: Treat the winning answer as the audience.');
    assert.deepStrictEqual((await state()).brief.keep.map((i) => i.text), ['Who is this for: busy volunteers on an old phone']);
  });
  await check('the host may send a decision as another kind', async () => {
    seed();
    const c = await hostCall('POST', 'asks', { kind: 'rating', prompt: 'How clear is it?', claudeGets: 'keep' });
    await hostCall('POST', `asks/${c.body.ask.askId}`, { action: 'decide', direction: 'How clear is it: 2 out of 5', as: 'do-now' });
    // Words without a score are a direction, and get no bracket about the scale.
    const c2 = await hostCall('POST', 'asks', { kind: 'rating', prompt: 'How is the colour?' });
    const d2 = await hostCall('POST', `asks/${c2.body.ask.askId}`, { action: 'decide', direction: 'add dark mode' });
    assert.strictEqual(d2.body.ask.decision.direction, 'add dark mode');
    assert.strictEqual((await agentCall('GET', 'inbox')).body.inbox[0].as, 'do-now');
    assert.deepStrictEqual((await state()).brief.keep, []);
  });
  await check('a decision sent For Claude, later is recorded, held and on the list; Claude hears nothing', async () => {
    seed();
    const c = await hostCall('POST', 'asks', { kind: 'rating', prompt: 'How is it?' });
    const d = await hostCall('POST', `asks/${c.body.ask.askId}`, { action: 'decide', direction: 'Add dark mode', as: 'later' });
    assert.strictEqual(d.body.ask.decision.heldForLater, true);
    assert.deepStrictEqual((await agentCall('GET', 'inbox')).body.inbox, []);
    assert.deepStrictEqual((await state()).brief.later.map((i) => i.text), ['Add dark mode']);
  });
  await check('the host edits the brief, and puts Later to a vote', async () => {
    seed();
    await hostCall('POST', 'directions', { text: 'Car park map', as: 'later' });
    await hostCall('POST', 'directions', { text: 'Sign up as a pair', as: 'later' });
    const e = await hostCall('POST', 'brief', { forWhom: 'Busy volunteers, often on an old phone', keep: ['No account needed'] });
    assert.strictEqual(e.status, 200, JSON.stringify(e.body));
    const st = await state();
    assert.strictEqual(st.brief.forWhom, 'Busy volunteers, often on an old phone');
    assert.deepStrictEqual(st.brief.keep.map((i) => i.text), ['No account needed']);
    assert.strictEqual(st.brief.later.length, 2, 'a list left out stays as it was');
    assert.strictEqual((await agentCall('POST', 'brief', { forWhom: 'x' })).status, 403);
    const v = await hostCall('POST', 'brief/vote', {});
    assert.strictEqual(v.status, 201, JSON.stringify(v.body));
    assert.deepStrictEqual([v.body.ask.status, v.body.ask.maxPicks], ['live', 1]);
    assert.deepStrictEqual(v.body.ask.options.map((o) => o.title).sort(), ['Car park map', 'Sign up as a pair']);
    seed();
    assert.strictEqual((await hostCall('POST', 'brief/vote', {})).status, 400, 'nothing on the Later list');
  });
  await check('one Later list: a held direction and an idea share one vote, and the direction leaves the list', async () => {
    seed();
    const ids = await threeIdeas();
    await hostCall('POST', 'directions', { text: 'Car park map', as: 'later' });
    const laterId = (await state()).brief.later[0].id;
    const r = await hostCall('POST', 'asks-from-ideas', { ideaIds: [ids[0]], laterIds: [laterId] });
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    assert.deepStrictEqual(r.body.ask.options.map((o) => o.title), ['Text a reminder the day before', 'Car park map']);
    const st = await state();
    assert.deepStrictEqual(st.brief.later, [], 'the direction left Later');
    assert.strictEqual(st.ideas.find((i) => i.ideaId === ids[0]).status, 'promoted');
    assert.strictEqual((await hostCall('POST', 'asks-from-ideas', { ideaIds: [ids[1]], laterIds: ['gone'] })).status, 404);
    assert.strictEqual((await hostCall('POST', 'asks-from-ideas', { ideaIds: [ids[1]] })).status, 400, 'one option is not a vote');
  });
  await check('Later vote: directions only, unticked items survive, duplicates count once, 7 is too many, Claude cannot', async () => {
    seed();
    for (const t of ['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven']) await hostCall('POST', 'directions', { text: t, as: 'later' });
    const later = (await state()).brief.later;
    const id = (t) => later.find((i) => i.text === t).id;
    assert.strictEqual((await hostCall('POST', 'asks-from-ideas', { laterIds: later.map((i) => i.id) })).status, 400, 'seven is too many');
    assert.strictEqual((await hostCall('POST', 'asks-from-ideas', { laterIds: [id('One'), id('One')] })).status, 400, 'a duplicate is one option');
    assert.strictEqual((await agentCall('POST', 'asks-from-ideas', { laterIds: [id('One'), id('Two')] })).status, 403);
    assert.strictEqual((await state()).brief.later.length, 7, 'refused votes take nothing');
    const r = await hostCall('POST', 'asks-from-ideas', { laterIds: [id('One'), id('Two'), id('One')] });
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    assert.deepStrictEqual(r.body.ask.options.map((o) => o.title), ['One', 'Two']);
    assert.deepStrictEqual((await state()).brief.later.map((i) => i.text), ['Three', 'Four', 'Five', 'Six', 'Seven'], 'unticked items survive');
  });
  await check('Later vote: 7 ideas and directions combined is a 400', async () => {
    seed();
    const ids = await threeIdeas();
    for (const t of ['One', 'Two', 'Three', 'Four', 'Five']) await hostCall('POST', 'directions', { text: t, as: 'later' });
    const laterIds = (await state()).brief.later.map((i) => i.id);
    assert.strictEqual((await hostCall('POST', 'asks-from-ideas', { ideaIds: ids, laterIds })).status, 400);
    assert.strictEqual((await state()).brief.later.length, 5);
  });
  await check('Cancel a Later vote: the direction goes back on the list and a Later idea back to Later', async () => {
    seed();
    const ids = await threeIdeas();
    await hostCall('POST', `ideas/${ids[0]}`, { action: 'later' });
    await hostCall('POST', 'directions', { text: 'Car park map', as: 'later', });
    const held = (await state()).brief.later[0];
    const v = await hostCall('POST', 'asks-from-ideas', { ideaIds: [ids[0], ids[1]], laterIds: [held.id], open: false });
    assert.strictEqual(v.status, 201, JSON.stringify(v.body));
    let st = await state();
    assert.deepStrictEqual(st.brief.later, []);
    // Something else lands on the list meanwhile; the restore keeps it.
    await hostCall('POST', 'directions', { text: 'Added meanwhile', as: 'later' });
    assert.strictEqual((await hostCall('POST', `asks/${v.body.ask.askId}`, { action: 'discard' })).status, 200);
    st = await state();
    assert.deepStrictEqual(st.brief.later.map((i) => i.text).sort(), ['Added meanwhile', 'Car park map']);
    assert.strictEqual(st.brief.later.find((i) => i.text === 'Car park map').id, held.id);
    assert.strictEqual(st.ideas.find((i) => i.ideaId === ids[0]).status, 'later', 'a Later idea returns to Later');
    assert.strictEqual(st.ideas.find((i) => i.ideaId === ids[1]).status, 'new', 'a queued idea returns to the queue');
    // Sent from Later while the vote waited: it is not put back twice.
    const v2 = await hostCall('POST', 'asks-from-ideas', { laterIds: [held.id, st.brief.later.find((i) => i.text === 'Added meanwhile').id], open: false });
    await hostCall('POST', 'directions', { text: 'Car park map', as: 'later' });
    const dup = (await state()).brief.later.find((i) => i.text === 'Car park map');
    assert.ok(dup && dup.id !== held.id);
    await hostCall('POST', `asks/${v2.body.ask.askId}`, { action: 'discard' });
    assert.strictEqual((await state()).brief.later.filter((i) => i.id === held.id).length, 1);
  });
  await check('the brief Claude reads has no Later list', async () => {
    seed();
    await hostCall('POST', 'directions', { text: 'Secret later thing', as: 'later' });
    assert.strictEqual(S.briefText(S.briefView({ Brief: { later: [{ id: 'x', text: 'Secret later thing' }] } })), '');
    const s = await hostCall('POST', 'opening/start', {});
    assert.ok(!JSON.stringify((await agentCall('GET', 'inbox')).body).includes('Secret later thing'));
    assert.ok(s.status < 300, JSON.stringify(s.body));
  });
  await check('Claude may answer an Ask Claude on the timeline', async () => {
    seed();
    const r = await agentCall('POST', 'log', { kind: 'answer', text: 'Reminder texts: about an hour, with a provider account.' });
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    assert.strictEqual(r.body.entry.kind, 'answer');
  });
  await check('in a team\'s room the brief and a ready question\'s note are sealed at rest', async () => {
    seed({ orgId: ORG });
    const HOST_TEAM = { userId: 'user-1', groups: 'hosts', orgId: ORG, orgIds: ORG };
    await hostCall('POST', 'directions', { text: 'Secret rule about payroll', as: 'keep' }, HOST_TEAM);
    await hostCall('POST', 'asks', { kind: 'suggest', prompt: 'Q?', claudeNote: 'Secret note for Claude' }, HOST_TEAM);
    const st = (await hostCall('GET', 'state', null, HOST_TEAM)).body;
    assert.strictEqual(st.brief.keep[0].text, 'Secret rule about payroll');
    const raw = JSON.stringify([...store.values()]);
    assert.ok(!raw.includes('Secret rule about payroll'), 'the brief is plaintext at rest');
    assert.ok(!raw.includes('Secret note for Claude'), 'the note is plaintext at rest');
  });

  console.log('\nthe opening: frame the build with the room, then build (owner, 2026-10-06)');
  await check('a new room starts in the opening; step 1 is What are we making?, with six kinds', async () => {
    seed();
    const st = await state();
    assert.strictEqual(st.opening.phase, 'opening');
    assert.strictEqual(st.opening.current, 'kind');
    assert.deepStrictEqual(st.opening.steps.map((x) => x.key), ['kind', 'forWhom', 'problem', 'good', 'proof', 'never', 'firstBuild', 'tools', 'look']);
    assert.strictEqual(st.opening.kinds.length, 6);
    assert.strictEqual(st.opening.steps.find((x) => x.key === 'tools').host, true);
    assert.strictEqual((await agentCall('GET', 'state')).body.opening.phase, 'opening', 'Claude sees the phase');
  });
  await check('deciding an opening step fills its brief line; a probe adds to it; Claude gets it as Keep in mind', async () => {
    seed();
    const kinds = (await state()).opening.kinds.map((k) => ({ title: k.title }));
    const k = await hostCall('POST', 'asks', { kind: 'choice', prompt: 'What are we making?', options: kinds, openingStep: 'kind' });
    assert.strictEqual(k.body.ask.openingStep, 'kind');
    assert.deepStrictEqual([k.body.ask.openingIndex, k.body.ask.openingOf], [1, 9]);
    assert.strictEqual((await state()).opening.steps[0].status, 'asking');
    await hostCall('POST', `asks/${k.body.ask.askId}`, { action: 'decide', direction: 'What are we making: A game', chosen: ['C'] });
    let st = await state();
    assert.strictEqual(st.brief.lines.kind, 'A game');
    assert.strictEqual(st.opening.steps[0].status, 'done');
    assert.strictEqual(st.opening.current, 'forWhom');
    assert.deepStrictEqual(st.brief.keep, [], 'an opening answer fills its own line, not Keep in mind');
    const inbox = (await agentCall('GET', 'inbox')).body.inbox;
    assert.deepStrictEqual(inbox.map((d) => d.as), ['keep']);
    // Who it is for, then a probe that adds to it.
    const w = await hostCall('POST', 'asks', { kind: 'suggest', prompt: 'Who is it for?', openingStep: 'forWhom' });
    await hostCall('POST', `asks/${w.body.ask.askId}`, { action: 'decide', direction: 'Who is it for: two friends, one laptop' });
    const p = await hostCall('POST', 'asks', { kind: 'suggest', prompt: 'Who is it not for?', openingStep: 'forWhom', probe: true });
    assert.strictEqual(p.body.ask.probe, true);
    await hostCall('POST', `asks/${p.body.ask.askId}`, { action: 'decide', direction: 'Who is it not for: strangers online' });
    st = await state();
    assert.strictEqual(st.brief.forWhom, 'two friends, one laptop. Who is it not for: strangers online');
  });
  await check('the host answers a step, skips one, opens it again; Never becomes a Keep in mind rule', async () => {
    seed();
    const a = await hostCall('POST', 'opening/answer', { step: 'tools', text: 'Plain HTML and JavaScript, no framework' });
    assert.strictEqual(a.status, 200, JSON.stringify(a.body));
    assert.strictEqual(a.body.brief.lines.tools, 'Plain HTML and JavaScript, no framework');
    assert.strictEqual((await agentCall('GET', 'inbox')).body.inbox[0].text, 'Any tools, frameworks, libraries or styles to use, or to avoid: Plain HTML and JavaScript, no framework');
    await hostCall('POST', 'opening/answer', { step: 'never', text: 'Ask for an account' });
    assert.deepStrictEqual((await state()).brief.keep.map((i) => i.text), ['Ask for an account']);
    assert.strictEqual((await hostCall('POST', 'opening/skip', { step: 'kind' })).body.opening.steps[0].status, 'skipped');
    assert.strictEqual((await hostCall('POST', 'opening/reopen', { step: 'kind' })).body.opening.steps[0].status, 'next');
    assert.strictEqual((await hostCall('POST', 'opening/skip', { step: 'nope' })).status, 400);
    assert.strictEqual((await agentCall('POST', 'opening/skip', { step: 'kind' })).status, 403);
  });
  await check('Start building ends the opening and sends Claude the whole brief as Do now', async () => {
    seed();
    await hostCall('POST', 'opening/answer', { step: 'problem', text: 'Board games take setup' });
    await agentCall('GET', 'inbox');
    const r = await hostCall('POST', 'opening/start', {});
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual(r.body.opening.phase, 'building');
    const d = (await agentCall('GET', 'inbox')).body.inbox[0];
    assert.strictEqual(d.as, 'do-now');
    assert.ok(/^The room has framed the build\. Plan 3 to 6 steps/.test(d.text) && /The problem today: Board games take setup/.test(d.text), d.text);
  });
  await check('Claude drafts the brief once who, the problem and good are known; the host edits it and uses it', async () => {
    seed();
    assert.strictEqual((await state()).opening.readyForDraft, false);
    await hostCall('POST', 'opening/answer', { step: 'forWhom', text: 'Two friends, one laptop' });
    await hostCall('POST', 'opening/answer', { step: 'problem', text: 'Board games take setup' });
    await hostCall('POST', 'opening/answer', { step: 'good', text: 'Play in one tap' });
    assert.strictEqual((await state()).opening.readyForDraft, true);
    await agentCall('GET', 'inbox');
    assert.strictEqual((await agentCall('POST', 'brief/draft', { summary: 'no headline' })).status, 400);
    assert.strictEqual((await hostCall('POST', 'brief/draft', { headline: 'x' })).status, 403, 'only Claude drafts');
    const d = await agentCall('POST', 'brief/draft', { headline: 'Connect four for two friends', summary: 'A quick game on one laptop, no accounts.', lines: { problem: 'Board games take setup, and online games want accounts.' } });
    assert.strictEqual(d.status, 201, JSON.stringify(d.body));
    let st = await state();
    assert.strictEqual(st.briefDraft.headline, 'Connect four for two friends');
    assert.strictEqual((await agentCall('GET', 'state')).body.briefDraft, null, 'Claude does not need its own draft back');
    const u = await hostCall('POST', 'opening/draft/accept', { headline: 'Connect four, for two friends on one laptop', summary: 'A quick game on one laptop, no accounts.', lines: { problem: 'Board games take setup, and online games want accounts.' } });
    assert.strictEqual(u.status, 200, JSON.stringify(u.body));
    st = await state();
    assert.strictEqual(st.brief.headline, 'Connect four, for two friends on one laptop');
    assert.strictEqual(st.brief.lines.problem, 'Board games take setup, and online games want accounts.');
    assert.strictEqual(st.briefDraft, null);
    assert.strictEqual(st.opening.drafted, true);
    const heard = (await agentCall('GET', 'inbox')).body.inbox;
    assert.ok(heard.some((x) => /^The build brief's headline: Connect four, for two friends on one laptop/.test(x.text) && x.as === 'keep'), JSON.stringify(heard));
    // The brief Claude builds from carries the headline.
    await hostCall('POST', 'opening/start', {});
    assert.ok(/Headline: Connect four, for two friends on one laptop/.test((await agentCall('GET', 'inbox')).body.inbox[0].text));
  });
  await check('the host may dismiss a draft; with none waiting there is nothing to settle', async () => {
    seed();
    await agentCall('POST', 'brief/draft', { headline: 'A draft' });
    assert.strictEqual((await hostCall('POST', 'opening/draft/dismiss', {})).status, 200);
    assert.strictEqual((await state()).briefDraft, null);
    assert.strictEqual((await state()).brief.headline, '');
    assert.strictEqual((await hostCall('POST', 'opening/draft/dismiss', {})).status, 404);
  });
  await check('in a team\'s room the draft is sealed at rest', async () => {
    seed({ orgId: ORG });
    await agentCall('POST', 'brief/draft', { headline: 'Secret headline about payroll' });
    const HOST_TEAM = { userId: 'user-1', groups: 'hosts', orgId: ORG, orgIds: ORG };
    assert.strictEqual((await hostCall('GET', 'state', null, HOST_TEAM)).body.briefDraft.headline, 'Secret headline about payroll');
    assert.ok(!JSON.stringify([...store.values()]).includes('Secret headline about payroll'));
  });
  await check('Back to the opening after Start building: nothing is lost, and Claude is told to pause', async () => {
    seed();
    await hostCall('POST', 'opening/answer', { step: 'problem', text: 'Board games take setup' });
    await hostCall('POST', 'opening/start', {});
    await agentCall('GET', 'inbox');
    assert.strictEqual((await state()).opening.phase, 'building');
    const r = await hostCall('POST', 'opening/resume', {});
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    const st = await state();
    assert.strictEqual(st.opening.phase, 'opening');
    assert.strictEqual(st.brief.lines.problem, 'Board games take setup');
    assert.strictEqual(st.opening.steps.find((x) => x.key === 'problem').status, 'done');
    const d = (await agentCall('GET', 'inbox')).body.inbox[0];
    assert.ok(/^The host has gone back to the opening/.test(d.text) && d.as === 'do-now', d.text);
    assert.strictEqual((await agentCall('POST', 'opening/resume', {})).status, 403);
  });
  await check('a room that already has asks is building (rooms made before the opening)', async () => {
    seed();
    await hostCall('POST', 'asks', { kind: 'rating', prompt: 'How is it?' });
    assert.strictEqual((await state()).opening.phase, 'building');
  });

  console.log('\nKick off (owner, 2026-10-07: step 4 of Connect turns green once kickoff has run)');
  const agentState = (query) => handler({
    routeKey: 'GET /games/{gameId}/build/{proxy+}',
    requestContext: { http: { method: 'GET' }, authorizer: { lambda: agentCtx() } },
    pathParameters: { gameId: GAME, proxy: 'state' },
    queryStringParameters: query,
  }).then((r) => ({ status: r.statusCode, body: JSON.parse(r.body) }));
  await check('room_status with kickoff records when Claude kicked off, once, and the host sees it', async () => {
    seed();
    assert.strictEqual((await hostCall('GET', 'state')).body.agent.kickedOffAt, null);
    await agentState({});
    assert.strictEqual((await hostCall('GET', 'state')).body.agent.kickedOffAt, null, 'an ordinary room_status is not a kickoff');
    sent = [];
    assert.strictEqual((await agentState({ kickoff: '1' })).status, 200);
    const first = (await hostCall('GET', 'state')).body.agent.kickedOffAt;
    assert.ok(first, 'kickedOffAt is set');
    assert.ok(sent.some((m) => m.message.type === 'buildChanged'), 'the host is told');
    await agentState({ kickoff: '1' });
    assert.strictEqual((await hostCall('GET', 'state')).body.agent.kickedOffAt, first, 'the first kickoff time is kept');
  });
  await check('only Claude can record a kickoff: the host\'s own state read ignores the flag', async () => {
    seed();
    await handler({
      routeKey: 'GET /games/{gameId}/build/{proxy+}',
      requestContext: { http: { method: 'GET' }, authorizer: { lambda: HOST } },
      pathParameters: { gameId: GAME, proxy: 'state' },
      queryStringParameters: { kickoff: '1' },
    });
    assert.strictEqual((await hostCall('GET', 'state')).body.agent.kickedOffAt, null);
  });
  await check('the host sees when Claude last listened, for older plugins that never send kickoff', async () => {
    seed();
    assert.strictEqual((await hostCall('GET', 'state')).body.agent.listenedAt, null);
    await handler({
      routeKey: 'GET /games/{gameId}/build/{proxy+}',
      requestContext: { http: { method: 'GET' }, authorizer: { lambda: agentCtx() } },
      pathParameters: { gameId: GAME, proxy: 'inbox' },
      queryStringParameters: { listening: '1' },
    });
    assert.ok((await hostCall('GET', 'state')).body.agent.listenedAt);
  });

  console.log('\nWi-Fi share (docs/design/build-room-lan-share/PLAN.md §3)');
  const report = (body) => agentCall('POST', 'share/report', body);
  const LIVE = (over = {}) => ({ status: 'live', key: 'abcdefghijklmnopqrstuv', open: 2, map: [{ local: 'http://localhost:5173', lan: 'http://192.168.1.20:4900' }], ...over });

  await check('off by default: the plugin is told not wanted and given no addresses (nothing to open)', async () => {
    seed();
    await agentCall('POST', 'log', { kind: 'showing', text: 'The first board', link: 'http://localhost:5173/' });
    const r = await report({ status: 'off' });
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(r.body, { wanted: false, targets: [] });
  });
  await check('once the host wants it, the plugin is given the local addresses Claude showed', async () => {
    seed();
    await agentCall('POST', 'log', { kind: 'showing', text: 'The first board', link: 'http://localhost:5173/' });
    await hostCall('POST', 'share', { on: true });
    const r = await report({ status: 'off' });
    assert.deepStrictEqual(r.body, { wanted: true, targets: ['http://localhost:5173'] });
  });
  await check('off then quickly on: participants are never handed the old key', async () => {
    seed();
    await agentCall('POST', 'log', { kind: 'showing', text: 'x', link: 'http://localhost:5173/' });
    await hostCall('POST', 'share', { on: true });
    await report(LIVE());
    await hostCall('POST', 'share', { on: false });
    await hostCall('POST', 'share', { on: true });
    let v = (await playCall('GET', 'state', priya)).body;
    assert.strictEqual(v.lan, null);
    assert.ok(!JSON.stringify(v).includes('abcdefghijklmnopqrstuv'));
    assert.strictEqual((await hostCall('GET', 'state')).body.lan.status, 'starting');
    await report(LIVE({ key: 'bbbbbbbbbbbbbbbbbbbbbb' }));
    v = (await playCall('GET', 'state', priya)).body;
    assert.strictEqual(v.lan.open, 'http://192.168.1.20:4900/?k=bbbbbbbbbbbbbbbbbbbbbb');
  });
  await check('a report never takes Claude\'s inbox and never marks Claude as seen', async () => {
    seed();
    await hostCall('POST', 'directions', { text: 'Make the counters bigger' });
    const r = await report({ status: 'off' });
    assert.strictEqual(r.body.inbox, undefined);
    const st = store.get(key(`GAME#${GAME}`, 'BUILD#STATE')) || {};
    assert.strictEqual(st.AgentSeenAt, undefined);
    const next = await agentCall('GET', 'inbox');
    assert.ok(next.body.inbox.some((d) => /bigger/.test(d.text)), 'the direction is still waiting for Claude');
  });
  await check('only the host turns it on; Claude cannot, and a participant cannot', async () => {
    seed();
    assert.strictEqual((await agentCall('POST', 'share', { on: true })).status, 403);
    const r = await hostCall('POST', 'share', { on: true });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.lan.status, 'starting');
    assert.strictEqual((await report({ status: 'off' })).body.wanted, true);
  });
  await check('live: participants get the Wi-Fi link with the key; off: they get nothing, at once', async () => {
    seed();
    await agentCall('POST', 'log', { kind: 'showing', text: 'The first board', link: 'http://localhost:5173/b' });
    await hostCall('POST', 'share', { on: true });
    await report(LIVE());
    let v = (await playCall('GET', 'state', priya)).body;
    assert.strictEqual(v.lan.open, 'http://192.168.1.20:4900/b?k=abcdefghijklmnopqrstuv');
    assert.ok(v.log.some((l) => l.link === 'http://192.168.1.20:4900/b?k=abcdefghijklmnopqrstuv'));
    await hostCall('POST', 'share', { on: false });
    v = (await playCall('GET', 'state', priya)).body;
    assert.strictEqual(v.lan, null);
    assert.ok(!JSON.stringify(v).includes('192.168.1.20'));
  });
  await check('the host sees each address with its link and the count; Claude sees no key', async () => {
    seed();
    await hostCall('POST', 'share', { on: true });
    await report(LIVE());
    const host = (await hostCall('GET', 'state')).body.lan;
    assert.strictEqual(host.status, 'live');
    assert.strictEqual(host.open, 2);
    assert.ok(host.map[0].link.includes('k=abcdefghijklmnopqrstuv'));
    const agent = (await agentCall('GET', 'state')).body;
    assert.ok(!JSON.stringify(agent.lan).includes('abcdefghijklmnopqrstuv'));
  });
  await check('a stale report counts as off for participants', async () => {
    seed();
    await agentCall('POST', 'log', { kind: 'showing', text: 'x', link: 'http://localhost:5173/' });
    await hostCall('POST', 'share', { on: true });
    await report(LIVE());
    const k = key(`GAME#${GAME}`, 'BUILD#LAN');
    store.set(k, { ...store.get(k), ReportedAt: new Date(Date.now() - 60000).toISOString() });
    assert.strictEqual((await playCall('GET', 'state', priya)).body.lan, null);
  });
  await check('map key order in storage does not make a repeat report look changed', async () => {
    seed();
    await hostCall('POST', 'share', { on: true });
    await report(LIVE());
    const k = key(`GAME#${GAME}`, 'BUILD#LAN');
    const row = store.get(k);
    store.set(k, { ...row, Map: row.Map.map((m) => ({ lan: m.lan, local: m.local })) });
    sent = [];
    await report(LIVE());
    assert.ok(!sent.some((m) => m.message.type === 'buildChanged'));
  });
  await check('an ended session is never wanted, and cannot be turned on', async () => {
    seed();
    await hostCall('POST', 'share', { on: true });
    put({ PK: `GAME#${GAME}`, SK: 'STATE', State: 'ENDED' });
    assert.strictEqual((await report({ status: 'off' })).body.wanted, false);
    assert.strictEqual((await hostCall('POST', 'share', { on: true })).status, 409);
  });
  await check('dismissing the offer is remembered', async () => {
    seed();
    await hostCall('POST', 'share', { dismissOffer: true });
    assert.strictEqual((await hostCall('GET', 'state')).body.lan.offerDismissed, true);
  });
  await check('a team room seals the map, the key and the error at rest, and still hands out a working link', async () => {
    seed({ orgId: ORG });
    await agentCall('POST', 'log', { kind: 'showing', text: 'x', link: 'http://localhost:5173/' });
    const on = await hostCall('POST', 'share', { on: true }, { userId: 'user-1', groups: 'hosts', orgId: ORG, orgIds: ORG });
    assert.strictEqual(on.status, 200, JSON.stringify(on.body));
    await report(LIVE());
    const raw = store.get(key(`GAME#${GAME}`, 'BUILD#LAN'));
    assert.ok(!JSON.stringify(raw).includes('abcdefghijklmnopqrstuv'), 'the key is sealed');
    assert.ok(!JSON.stringify(raw).includes('192.168.1.20'), 'the map is sealed');
    const v = (await playCall('GET', 'state', priya)).body;
    assert.strictEqual(v.lan.open, 'http://192.168.1.20:4900/?k=abcdefghijklmnopqrstuv');
  });
  await check('a change in what the plugin reports is announced; the same report again is not', async () => {
    seed();
    await hostCall('POST', 'share', { on: true });
    sent = [];
    await report(LIVE());
    assert.ok(sent.some((m) => m.message.type === 'buildChanged'));
    sent = [];
    await report(LIVE());
    assert.ok(!sent.some((m) => m.message.type === 'buildChanged'));
  });

  console.log('\nre-asking an ask with edits');
  await check('reask a closed choice ask: a new live ask with the edits, images kept, the old one points at it', async () => {
    seed();
    const id = await tie();
    const shotA = await hostCall('POST', 'images', { askId: id, label: 'A', kind: 'mockup', data: PNG.toString('base64'), contentType: 'image/png' });
    const shotB = await hostCall('POST', 'images', { askId: id, label: 'B', kind: 'mockup', data: PNG.toString('base64'), contentType: 'image/png' });
    const r = await hostCall('POST', `asks/${id}`, {
      action: 'reask', prompt: 'What should we build first?', detail: 'Pick one',
      options: ['Sign-up page', 'Shift map', 'Pick-up list'],
    });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual(r.body.ask.status, 'live');
    assert.strictEqual(r.body.ask.prompt, 'What should we build first?');
    assert.deepStrictEqual(r.body.ask.options.map((o) => [o.label, o.title]), [['A', 'Sign-up page'], ['B', 'Shift map'], ['C', 'Pick-up list']]);
    assert.strictEqual(r.body.ask.options[0].imageId, shotA.body.image.imageId);
    assert.strictEqual(r.body.ask.options[1].imageId, shotB.body.image.imageId);
    const h = await hostCall('GET', 'state');
    assert.strictEqual(h.body.currentAskId, r.body.ask.askId);
    assert.strictEqual(h.body.asks.find((a) => a.askId === id).revotedAs, r.body.ask.askId);
    assert.ok(h.body.log.some((l) => l.text === 'Asked again: What should we build first?'));
  });
  await check('reask a live ask: the old one closes and only the new one is open', async () => {
    seed();
    const c = await hostCall('POST', 'asks', { kind: 'choice', prompt: 'Which one?', options: ['Red', 'Blue'] });
    const id = c.body.ask.askId;
    const r = await hostCall('POST', `asks/${id}`, { action: 'reask', prompt: 'Which colour?', options: ['Red', 'Blue'] });
    assert.strictEqual(r.status, 200);
    const h = await hostCall('GET', 'state');
    assert.strictEqual(h.body.asks.find((a) => a.askId === id).status, 'results');
    assert.deepStrictEqual(h.body.asks.filter((a) => ['live', 'voting'].includes(a.status)).map((a) => a.askId), [r.body.ask.askId]);
  });
  await check('a decided ask cannot be asked again; Claude cannot reask', async () => {
    seed();
    const c = await hostCall('POST', 'asks', { kind: 'choice', prompt: 'Which one?', options: ['Red', 'Blue'] });
    const id = c.body.ask.askId;
    assert.strictEqual((await agentCall('POST', `asks/${id}`, { action: 'reask', prompt: 'x', options: ['Red', 'Blue'] })).status, 403);
    await hostCall('POST', `asks/${id}`, { action: 'close' });
    await hostCall('POST', `asks/${id}`, { action: 'decide', direction: 'Red' });
    const r = await hostCall('POST', `asks/${id}`, { action: 'reask', prompt: 'Which colour?', options: ['Red', 'Blue'] });
    assert.strictEqual(r.status, 409);
    assert.ok(r.body.error && r.body.error.length > 10);
  });

  await check('reask: a typo fix keeps the mockup; a deleted A moves B\'s mockup with B; a new option gets none', async () => {
    seed();
    const c = await hostCall('POST', 'asks', { kind: 'choice', prompt: 'Which?', options: ['Sign up', 'Shift map', 'Texts'] });
    const id = c.body.ask.askId;
    const img = async (label) => (await hostCall('POST', 'images', { askId: id, label, kind: 'mockup', data: PNG.toString('base64'), contentType: 'image/png' })).body.image.imageId;
    const ia = await img('A'); const ib = await img('B');
    const typo = await hostCall('POST', `asks/${id}`, { action: 'reask', options: ['Sign-up', 'Shift map', 'Texts', 'Rota'] });
    assert.strictEqual(typo.body.ask.options[0].imageId, ia, 'typo fix keeps A');
    assert.strictEqual(typo.body.ask.options[1].imageId, ib);
    assert.ok(!typo.body.ask.options[3].imageId, 'a new option has none');
    const del = await hostCall('POST', `asks/${id}`, { action: 'reask', options: ['Shift map', 'Texts'] });
    assert.strictEqual(del.body.ask.options[0].title, 'Shift map');
    assert.strictEqual(del.body.ask.options[0].imageId, ib, 'B\'s mockup moves with B');
    assert.ok(!del.body.ask.options[1].imageId, 'Texts had none');
  });
  await check('reask while the wheel is armed: the old ask\'s wheel is disarmed and a phone cannot spin it', async () => {
    seed();
    const id = await tie();
    const w = await hostCall('POST', `asks/${id}`, { action: 'wheel' });
    const spinner = w.body.ask.wheel.spinner;
    const me = spinner === 'Priya' ? priya : marcus;
    assert.strictEqual((await hostCall('POST', `asks/${id}`, { action: 'reask', prompt: 'Again?' })).status, 200);
    const h = await hostCall('GET', 'state');
    assert.strictEqual(h.body.asks.find((a) => a.askId === id).wheel.armed, false);
    assert.strictEqual((await playCall('POST', 'spin', { ...me, askId: id })).status, 409);
  });
  await check('reask drops a revote\'s tie line, keeps the opening step, and leaves a proposed ask proposed', async () => {
    seed();
    const id = await tie();
    const rv = await hostCall('POST', `asks/${id}`, { action: 'revote' });
    assert.ok(/^A tie/.test(rv.body.ask.detail));
    const again = await hostCall('POST', `asks/${rv.body.ask.askId}`, { action: 'reask' });
    assert.strictEqual(again.body.ask.detail, '', 'the tie line is not carried on');
    seed();
    const c = await hostCall('POST', 'asks', { kind: 'choice', prompt: 'Which?', options: ['X', 'Y'] });
    const p2 = await hostCall('POST', 'asks', { kind: 'suggest', prompt: 'Held', draft: true });
    const r = await hostCall('POST', `asks/${c.body.ask.askId}`, { action: 'reask', prompt: 'Which now?' });
    assert.strictEqual(r.status, 200);
    const h = await hostCall('GET', 'state');
    assert.strictEqual(h.body.asks.find((a) => a.askId === p2.body.ask.askId).status, 'proposed');
  });
  await check('reask in a team room: the new ask is sealed at rest and readable through the API', async () => {
    seed({ orgId: ORG });
    const T = { userId: 'user-1', groups: 'hosts', orgId: ORG, orgIds: ORG };
    const c = await hostCall('POST', 'asks', { kind: 'choice', prompt: 'Old words', options: ['One', 'Two'] }, T);
    const r = await hostCall('POST', `asks/${c.body.ask.askId}`, { action: 'reask', prompt: 'Sealed reask words', options: ['Alpha', 'Beta'] }, T);
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual(r.body.ask.prompt, 'Sealed reask words');
    const raw = JSON.stringify([...store.values()]);
    assert.ok(!raw.includes('Sealed reask words') && !raw.includes('Alpha'), 'plaintext at rest');
  });
  await check('a Later vote in a team room: Brief and FromLater are ciphertext at rest, and read back; discard restores', async () => {
    seed({ orgId: ORG });
    const HOST_ORG = { userId: 'user-1', groups: 'hosts', orgId: ORG, orgIds: ORG };
    for (const t of ['Secret later alpha', 'Secret later beta']) await hostCall('POST', 'directions', { text: t, as: 'later' }, HOST_ORG);
    let st = (await hostCall('GET', 'state', undefined, HOST_ORG)).body;
    assert.deepStrictEqual(st.brief.later.map((i) => i.text), ['Secret later alpha', 'Secret later beta']);
    const rawOf = () => JSON.stringify([...store.values()].filter((x) => String(x.SK).startsWith('BUILD#')));
    assert.ok(!rawOf().includes('Secret later alpha'), 'Brief is plaintext at rest');
    const v = await hostCall('POST', 'asks-from-ideas', { laterIds: st.brief.later.map((i) => i.id), open: false }, HOST_ORG);
    assert.strictEqual(v.status, 201, JSON.stringify(v.body));
    const askRow = [...store.values()].find((x) => String(x.SK).startsWith('BUILD#ASK#'));
    assert.ok(askRow.FromLater, 'the ask keeps what it took');
    assert.ok(!rawOf().includes('Secret later'), 'FromLater and the Brief are plaintext at rest');
    st = (await hostCall('GET', 'state', undefined, HOST_ORG)).body;
    assert.deepStrictEqual(st.brief.later, []);
    assert.strictEqual((await hostCall('POST', `asks/${v.body.ask.askId}`, { action: 'discard' }, HOST_ORG)).status, 200);
    st = (await hostCall('GET', 'state', undefined, HOST_ORG)).body;
    assert.deepStrictEqual(st.brief.later.map((i) => i.text), ['Secret later alpha', 'Secret later beta']);
    assert.ok(!rawOf().includes('Secret later'), 'the restored Brief is sealed again');
  });

  console.log(`\n${pass} passed, ${failed} failed`);
  suiteFinished();
  process.exit(failed ? 1 : 0);
})();
