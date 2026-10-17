/**
 * BUILD ROOM — provenance: what the room gave, and what reached Claude
 * (docs/design/parity/PLAN.md §2.8, task H1; owner, 16 Oct 2026: "history needs
 * to include user contributions that are used. same for any asks. we need to
 * mark them if we send some version to claude").
 *
 * The server stamps where a thing came from AT THE MOMENT IT IS SENT, never
 * guessed from text later: a sent idea names its idea and says it went as
 * written; a suggestion and a vote option name the idea they were made from; a
 * direction the host writes names the asks or ideas it was filled from; a
 * decision says whether the host changed the words the server would have sent.
 * Any change counts as reworded, a fixed typo included (owner, Q14).
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

// ── The cases ────────────────────────────────────────────────────────────────

const state = async () => (await hostCall('GET', 'state')).body;
const sendIdea = async (who, text) => {
  const r = await playCall('POST', 'idea', { ...who, text });
  assert.strictEqual(r.status, 201, JSON.stringify(r.body));
};
const ideaByText = async (text) => (await state()).ideas.find((i) => i.text === text);
const rows = (prefix) => [...store.values()].filter((i) => i.PK === `GAME#${GAME}` && String(i.SK).startsWith(prefix));

/** A choice ask opened, answered by both phones, closed: ready to decide. */
async function closedChoice(prompt, options, picks) {
  const ask = (await hostCall('POST', 'asks', { kind: 'choice', prompt, options })).body.ask;
  await hostCall('POST', `asks/${ask.askId}`, { action: 'open' });
  await playCall('POST', 'respond', { ...priya, askId: ask.askId, choice: [picks[0]] });
  await playCall('POST', 'respond', { ...marcus, askId: ask.askId, choice: [picks[1]] });
  await hostCall('POST', `asks/${ask.askId}`, { action: 'close' });
  return ask.askId;
}

(async () => {
  console.log('\nprovenance: an idea sent to Claude as written');
  seed();
  await check('Send on an idea stamps its log entry with the idea and "as written"', async () => {
    await sendIdea(marcus, 'Add a map of the parking');
    const idea = await ideaByText('Add a map of the parking');
    assert.strictEqual((await hostCall('POST', `ideas/${idea.ideaId}`, { action: 'direct' })).status, 200);
    const entry = (await state()).log.find((l) => l.kind === 'idea');
    assert.strictEqual(entry.ideaId, idea.ideaId);
    assert.strictEqual(entry.asWritten, true);
    // On the row too, so a reader that skips the view still has it.
    const row = rows('BUILD#LOG#').find((r) => r.Kind === 'idea');
    assert.deepStrictEqual([row.IdeaId, row.AsWritten], [idea.ideaId, true]);
  });
  await check('an idea saved for later still names its idea (held, not sent)', async () => {
    await sendIdea(priya, 'Let people sign up as a pair');
    const idea = await ideaByText('Let people sign up as a pair');
    await hostCall('POST', `ideas/${idea.ideaId}`, { action: 'direct', as: 'later' });
    const entry = (await state()).log.find((l) => l.kind === 'idea' && l.ideaId === idea.ideaId);
    assert.strictEqual(entry.held, true);
    assert.strictEqual(entry.asWritten, true);
  });

  console.log('\nprovenance: an idea added to the open Ideas ask');
  seed();
  await check('the suggestion it becomes leads back to the idea (host view only)', async () => {
    const ask = (await hostCall('POST', 'asks', { kind: 'suggest', prompt: 'What should the page say first?' })).body.ask;
    await hostCall('POST', `asks/${ask.askId}`, { action: 'open' });
    await sendIdea(priya, 'The date and the address');
    const idea = await ideaByText('The date and the address');
    assert.strictEqual((await hostCall('POST', `ideas/${idea.ideaId}`, { action: 'suggest' })).status, 200);
    const live = (await state()).asks.find((a) => a.askId === ask.askId);
    const resp = live.responses.find((r) => r.text === 'The date and the address');
    assert.strictEqual(resp.ideaId, idea.ideaId);
    // A phone never learns which suggestion came from someone's idea.
    await hostCall('POST', `asks/${ask.askId}`, { action: 'vote' });
    const p = await playCall('GET', 'state', marcus);
    assert.ok(p.body.current.responses.every((r) => !('ideaId' in r)), JSON.stringify(p.body.current.responses));
  });

  console.log('\nprovenance: a vote made from ideas');
  seed();
  await check('each option names the idea it was made from, in order; phones are not told', async () => {
    await sendIdea(priya, 'Text a reminder the day before');
    await sendIdea(marcus, 'Put the address and a map link at the top');
    const ideas = (await state()).ideas;
    const ids = ['Text a reminder the day before', 'Put the address and a map link at the top'].map((t) => ideas.find((i) => i.text === t).ideaId);
    const r = await hostCall('POST', 'asks-from-ideas', { ideaIds: ids });
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    assert.deepStrictEqual(r.body.ask.options.map((o) => [o.label, o.ideaId]), [['A', ids[0]], ['B', ids[1]]]);
    const p = await playCall('GET', 'state', priya);
    assert.ok(p.body.current.options.every((o) => !('ideaId' in o)), JSON.stringify(p.body.current.options));
  });
  await check('a direction held on the Later list in the same vote carries no idea id', async () => {
    seed();
    await sendIdea(priya, 'Text a reminder the day before');
    await sendIdea(marcus, 'Put the address and a map link at the top');
    await hostCall('POST', 'directions', { text: 'Big buttons for old phones', as: 'later' });
    const st = await state();
    const laterId = st.brief.later[0].id;
    const r = await hostCall('POST', 'asks-from-ideas', { ideaIds: st.ideas.map((i) => i.ideaId), laterIds: [laterId] });
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    const opts = r.body.ask.options;
    assert.strictEqual(opts.length, 3);
    assert.ok(opts[0].ideaId && opts[1].ideaId);
    assert.ok(!opts[2].ideaId);
  });

  console.log('\nprovenance: a direction the host writes from asks or ideas');
  seed();
  await check('Combine sends the asks it was made from; a combined direction is never "as written"', async () => {
    const a1 = await closedChoice('Which header first?', ['Bold banner', 'Calm photo'], ['B', 'B']);
    await hostCall('POST', `asks/${a1}`, { action: 'decide' });
    const a2 = await closedChoice('Which colour?', ['Green', 'Blue'], ['A', 'A']);
    await hostCall('POST', `asks/${a2}`, { action: 'decide' });
    const r = await hostCall('POST', 'directions', { text: 'Which header first? Calm photo\nWhich colour? Green', fromAskIds: [a1, a2] });
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    assert.deepStrictEqual(r.body.entry.from, { askIds: [a1, a2], ideaIds: [] });
    assert.strictEqual(r.body.entry.asWritten, false);
  });
  await check('a direction from one idea is "as written" only when its words are the idea\'s', async () => {
    await sendIdea(marcus, 'Show the shifts as a calendar');
    const idea = await ideaByText('Show the shifts as a calendar');
    const same = await hostCall('POST', 'directions', { text: 'Show the shifts as a calendar', fromIdeaIds: [idea.ideaId] });
    assert.strictEqual(same.body.entry.asWritten, true);
    const changed = await hostCall('POST', 'directions', { text: 'Show the shifts as a weekly calendar', fromIdeaIds: [idea.ideaId] });
    assert.strictEqual(changed.body.entry.asWritten, false);
    assert.deepStrictEqual(changed.body.entry.from, { askIds: [], ideaIds: [idea.ideaId] });
  });
  await check('a forged or undecided source is refused (400) and nothing is sent', async () => {
    const open = (await hostCall('POST', 'asks', { kind: 'suggest', prompt: 'Anything else?' })).body.ask;
    const before = rows('BUILD#LOG#').length;
    assert.strictEqual((await hostCall('POST', 'directions', { text: 'x', fromIdeaIds: ['nope'] })).status, 400);
    assert.strictEqual((await hostCall('POST', 'directions', { text: 'x', fromAskIds: ['999'] })).status, 400);
    assert.strictEqual((await hostCall('POST', 'directions', { text: 'x', fromAskIds: [open.askId] })).status, 400);
    assert.strictEqual((await hostCall('POST', 'directions', { text: 'x', fromAskIds: 'not-a-list' })).status, 400);
    assert.strictEqual(rows('BUILD#LOG#').length, before);
  });
  await check('a direction with no sources carries none (unchanged behaviour)', async () => {
    const r = await hostCall('POST', 'directions', { text: 'Make the header bigger' });
    assert.strictEqual(r.status, 201);
    assert.strictEqual(r.body.entry.from, null);
    assert.strictEqual(r.body.entry.asWritten, null);
  });

  console.log('\nprovenance: a decision the host reworded');
  seed();
  await check('the room\'s pick sent in its default words is not reworded', async () => {
    const id = await closedChoice('Which header first?', ['Bold banner', 'Calm photo'], ['B', 'B']);
    const d = await hostCall('POST', `asks/${id}`, { action: 'decide', direction: 'Which header first: Calm photo', chosen: ['B'] });
    assert.strictEqual(d.status, 200, JSON.stringify(d.body));
    assert.strictEqual(d.body.ask.decision.reworded, false);
  });
  await check('an option with a detail: "title (detail)" is the default too (the client\'s words)', async () => {
    const ask = (await hostCall('POST', 'asks', { kind: 'choice', prompt: 'Which layout?', options: [{ title: 'Cards', detail: 'one shift per card' }, { title: 'Table' }] })).body.ask;
    await hostCall('POST', `asks/${ask.askId}`, { action: 'open' });
    await playCall('POST', 'respond', { ...priya, askId: ask.askId, choice: ['A'] });
    await hostCall('POST', `asks/${ask.askId}`, { action: 'close' });
    const d = await hostCall('POST', `asks/${ask.askId}`, { action: 'decide', direction: 'Which layout: Cards (one shift per card)', chosen: ['A'] });
    assert.strictEqual(d.body.ask.decision.reworded, false);
  });
  await check('no words sent at all: the server\'s own default, not reworded', async () => {
    const id = await closedChoice('Which colour?', ['Green', 'Blue'], ['A', 'A']);
    const d = await hostCall('POST', `asks/${id}`, { action: 'decide' });
    assert.strictEqual(d.body.ask.decision.reworded, false);
  });
  await check('the host picks another option: its default words are not reworded', async () => {
    const id = await closedChoice('Which font?', ['Serif', 'Sans'], ['A', 'A']);
    const d = await hostCall('POST', `asks/${id}`, { action: 'decide', direction: 'Which font: Sans', chosen: ['B'], method: 'host' });
    assert.strictEqual(d.body.ask.decision.reworded, false);
  });
  await check('any change to the words is reworded, a fixed typo included (Q14)', async () => {
    const id = await closedChoice('Which icon?', ['Star', 'Heart'], ['A', 'A']);
    const d = await hostCall('POST', `asks/${id}`, { action: 'decide', direction: 'Which icon: Star, but make it gold', chosen: ['A'] });
    assert.strictEqual(d.body.ask.decision.reworded, true);
    const id2 = await closedChoice('Which logo?', ['Round', 'Square'], ['A', 'A']);
    const d2 = await hostCall('POST', `asks/${id2}`, { action: 'decide', direction: 'Which logo: round', chosen: ['A'] });
    assert.strictEqual(d2.body.ask.decision.reworded, true);
  });
  await check('an Ideas ask: the winning suggestion\'s own words are not reworded; other words are', async () => {
    const ask = (await hostCall('POST', 'asks', { kind: 'suggest', prompt: 'What goes first?' })).body.ask;
    await hostCall('POST', `asks/${ask.askId}`, { action: 'open' });
    await playCall('POST', 'respond', { ...priya, askId: ask.askId, text: 'The address' });
    await hostCall('POST', `asks/${ask.askId}`, { action: 'vote' });
    const resp = (await state()).asks.find((a) => a.askId === ask.askId).responses[0];
    await playCall('POST', 'vote', { ...marcus, askId: ask.askId, respIds: [resp.respId] });
    await hostCall('POST', `asks/${ask.askId}`, { action: 'close' });
    const d = await hostCall('POST', `asks/${ask.askId}`, { action: 'decide', direction: 'What goes first: The address', chosen: [resp.respId] });
    assert.strictEqual(d.body.ask.decision.reworded, false);
  });
  await check('a rating sent as its average is not reworded', async () => {
    const ask = (await hostCall('POST', 'asks', { kind: 'rating', prompt: 'How close is this?' })).body.ask;
    await hostCall('POST', `asks/${ask.askId}`, { action: 'open' });
    await playCall('POST', 'respond', { ...priya, askId: ask.askId, rating: 4 });
    await hostCall('POST', `asks/${ask.askId}`, { action: 'close' });
    const d = await hostCall('POST', `asks/${ask.askId}`, { action: 'decide', direction: 'How close is this: 4 out of 5 (5 is great, 1 needs work)', chosen: [] });
    assert.strictEqual(d.body.ask.decision.reworded, false);
  });
  await check('the live ask on a phone is as before (the marks travel in history, H5); the row keeps the mark', async () => {
    const id = await closedChoice('Which sign-up button?', ['Big', 'Small'], ['A', 'A']);
    await hostCall('POST', `asks/${id}`, { action: 'decide', direction: 'Which sign-up button: Big and orange', chosen: ['A'] });
    const p = await playCall('GET', 'state', priya);
    assert.strictEqual(p.body.current.askId, id);
    assert.ok(p.body.current.decision, JSON.stringify(p.body.current));
    assert.ok(!('reworded' in p.body.current.decision));
    const row = rows('BUILD#ASK#').find((r) => r.AskId === id);
    assert.strictEqual(row.Decision.reworded, true);
  });

  console.log('\nH5: the room\'s own History carries the marks, never a name');
  seed();
  const history = async (who = priya) => (await playCall('GET', 'state', who)).body.history;
  await check('a phone gets the used ideas, the asks the room saw, and the sent entries, stamped', async () => {
    // A sent idea, a vote from two ideas (B wins, the host rewords it), a waiting ask, an unused idea.
    await sendIdea(marcus, 'Add a map of the parking');
    await sendIdea(priya, 'Text a reminder the day before');
    await sendIdea(marcus, 'Put the address at the top');
    await sendIdea(priya, 'Nice buttons');
    const ideas = (await state()).ideas;
    const id = (t) => ideas.find((i) => i.text === t).ideaId;
    await hostCall('POST', `ideas/${id('Add a map of the parking')}`, { action: 'direct' });
    const vote = (await hostCall('POST', 'asks-from-ideas', { ideaIds: [id('Text a reminder the day before'), id('Put the address at the top')] })).body.ask;
    await playCall('POST', 'respond', { ...priya, askId: vote.askId, choice: ['B'] });
    await hostCall('POST', `asks/${vote.askId}`, { action: 'close' });
    await hostCall('POST', `asks/${vote.askId}`, { action: 'decide', direction: 'The address, big, at the very top', chosen: ['B'] });
    const waiting = await hostCall('POST', 'asks', { kind: 'suggest', prompt: 'Waiting, never opened', draft: true });
    assert.strictEqual(waiting.body.ask.status, 'proposed', JSON.stringify(waiting.body));
    await hostCall('POST', 'directions', { text: 'Make the address bold and orange', fromAskIds: [vote.askId] });

    const h = await history();
    assert.ok(h, 'history is on the phone view');
    assert.deepStrictEqual(h.ideas.map((i) => i.text).sort(), ['Add a map of the parking', 'Put the address at the top', 'Text a reminder the day before']);
    const a = h.asks.find((x) => x.askId === vote.askId);
    assert.deepStrictEqual(a.options.map((o) => [o.label, o.ideaId]), [['A', id('Text a reminder the day before')], ['B', id('Put the address at the top')]]);
    assert.strictEqual(a.decision.reworded, true);
    assert.ok(!h.asks.some((x) => x.prompt === 'Waiting, never opened'), 'an ask the room never saw is not there');
    const sent = h.sent.find((l) => l.kind === 'idea');
    assert.deepStrictEqual([sent.ideaId, sent.asWritten, sent.forAgent], [id('Add a map of the parking'), true, true]);
    const dir = h.sent.find((l) => l.kind === 'direction');
    assert.deepStrictEqual(dir.from, { askIds: [vote.askId], ideaIds: [] });
    assert.strictEqual(dir.text, '', 'a direction is the host\'s words: never on a phone');
  });
  await check('no name, no note, no direction\'s words, no idea that was not used', async () => {
    const body = JSON.stringify(await history(marcus));
    for (const s of ['Priya', 'Marcus', 'Make the address bold and orange', 'Nice buttons', 'from ']) assert.ok(!body.includes(s), `history carries "${s}"`);
    assert.ok(!/playerName|voters|note"/.test(body), body);
  });
  await check('the room\'s timeline entries for a sent idea carry its stamp too', async () => {
    const p = await playCall('GET', 'state', priya);
    const entry = p.body.log.find((l) => l.kind === 'idea');
    assert.strictEqual(entry.asWritten, true);
    assert.ok(entry.ideaId);
    assert.strictEqual(entry.detail, '', 'the author stays off the phone');
  });

  console.log(`\n${pass} passed, ${failed} failed`);
  suiteFinished();
  process.exit(failed ? 1 : 0);
})();
