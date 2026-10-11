/**
 * BUILD ROOM USAGE STATS — game/build-room.js (usage-stats SPEC §4, §5 E2,
 * E6–E8; owner 2026-10-11: a Build Room "question" is an ask put to the room).
 *
 * Driven through the real handler over player-table.js, which EVALUATES the
 * once-only guards (`NOT contains(StatsAsks, :id)`, `attribute_not_exists`),
 * so a guard that does nothing fails here:
 *
 *   open, close, reopen one ask      1 question
 *   reask (a new live ask)           2
 *   wheel revote (a new live ask)    2
 *   decide twice                     1 decision
 *   kickoff twice                    started 1
 *   a crew task                      1 task
 *   and no sealed field (Title, Details, a prompt) reaches a stats row.
 *
 * Every check carries a `// rejects:` line naming the change it catches.
 */
const suiteFinished = require('./helpers/finish-guard');
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');
const { createTable, installStubs } = require('./helpers/player-table');

const table = createTable();
const store = table.store;
const sent = [];
installStubs({ table, sent });
process.env.TABLE_NAME = 'test-table';
process.env.WEBSOCKET_API_ENDPOINT = 'https://ws.test.invalid/dev';

const { handler } = require(path.join(REPO, 'lambda-functions/game/build-room.js'));
const M = require(path.join(REPO, 'lambda-functions/game/platform-metrics.js'));

if (!process.env.DEBUG) { console.log = () => {}; console.warn = () => {}; console.error = () => {}; }
const say = (...a) => process.stdout.write(`${a.join(' ')}\n`);
let pass = 0; let fail = 0;
async function check(label, fn) {
  try { await fn(); say(`  PASS  ${label}`); pass += 1; } catch (e) { say(`  FAIL  ${label}\n        ${e.message}`); fail += 1; }
}

const GAME = '4821';
const SECRET = 'Food bank sign-up';
function seed() {
  table.clear();
  const PK = `GAME#${GAME}`;
  table.put({ PK, SK: 'METADATA', GameType: 'build', Title: SECRET, Details: 'Build a volunteer sign-up site', ttl: 2000000000, CreatedBy: 'u-host' });
  table.put({ PK, SK: 'STATE', State: 'STARTED' });
  table.put({ PK, SK: 'PLAYER#Priya', PlayerName: 'Priya', ClientId: 'c-priya' });
  table.put({ PK, SK: 'PLAYER#Marcus', PlayerName: 'Marcus', ClientId: 'c-marcus' });
}

const HOST = { userId: 'user-1', groups: 'hosts', orgId: '', orgIds: '' };
const AGENT = { agent: 'build', agentGameId: GAME, agentKeyHash: 'h', groups: '', orgId: '', orgIds: '' };
const call = (method, proxy, body, auth = HOST, query) => handler({
  routeKey: `${method} /games/{gameId}/build/{proxy+}`,
  requestContext: { http: { method }, authorizer: { lambda: auth } },
  pathParameters: { gameId: GAME, proxy },
  ...(body ? { body: JSON.stringify(body) } : {}),
  ...(query ? { queryStringParameters: query } : {}),
}).then((r) => ({ status: r.statusCode, body: JSON.parse(r.body) }));
const play = (proxy, input) => handler({
  routeKey: `POST /games/{gameId}/build-play/{proxy+}`,
  requestContext: { http: { method: 'POST' } },
  pathParameters: { gameId: GAME, proxy },
  body: JSON.stringify(input),
}).then((r) => ({ status: r.statusCode, body: JSON.parse(r.body) }));

const period = () => M.periodOf(new Date());
const buildRow = () => store.get(table.keyOf('USER#u-host', `STATS#${period()}#TYPE#build#ORG#-`)) || {};

(async () => {
  say('\nbuild room: usage stats\n');

  seed();
  let id;
  // rejects: counting every open — a reopened ask would count twice.
  await check('open, close and reopen one ask: one question', async () => {
    const c = await call('POST', 'asks', { kind: 'choice', prompt: 'Which header?', options: ['Bold', 'Calm'] }, AGENT);
    assert.strictEqual(c.status, 201, JSON.stringify(c.body));
    id = c.body.ask.askId;
    assert.strictEqual(buildRow().questions, undefined, 'a proposed ask is not yet put to the room');
    assert.strictEqual((await call('POST', `asks/${id}`, { action: 'open' })).status, 200);
    assert.strictEqual(buildRow().questions, 1);
    await call('POST', `asks/${id}`, { action: 'close' });
    const re = await call('POST', `asks/${id}`, { action: 'reopen' });
    assert.ok([200, 409].includes(re.status), JSON.stringify(re.body));
    assert.strictEqual(buildRow().questions, 1);
  });
  // rejects: decisions counted per press.
  await check('decide twice: one decision', async () => {
    await call('POST', `asks/${id}`, { action: 'close' });
    const d1 = await call('POST', `asks/${id}`, { action: 'decide', direction: 'Use the calm one', chosen: ['B'] });
    assert.strictEqual(d1.status, 200, JSON.stringify(d1.body));
    await call('POST', `asks/${id}`, { action: 'decide', direction: 'Use the calm one, bigger', chosen: ['B'] });
    assert.strictEqual(buildRow().decisions, 1);
  });

  seed();
  // rejects: a re-ask left uncounted — it writes its own live ask, not through makeCurrent.
  await check('reask: two questions', async () => {
    const c = await call('POST', 'asks', { kind: 'choice', prompt: 'Which colour?', options: ['Red', 'Green'] });
    assert.strictEqual(c.status, 201, JSON.stringify(c.body));
    const r = await call('POST', `asks/${c.body.ask.askId}`, { action: 'reask', prompt: 'Which colour, really?', options: ['Red', 'Blue'] });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual(buildRow().questions, 2);
  });

  seed();
  // rejects: a revote (a new ask) not counted.
  await check('wheel revote: two questions', async () => {
    const c = await call('POST', 'asks', { kind: 'choice', prompt: 'What should we build?', options: ['Sign-up page', 'Shift map', 'Reminder texts'] });
    const tieId = c.body.ask.askId;
    await play('respond', { playerName: 'Priya', clientId: 'c-priya', askId: tieId, choice: ['A'] });
    await play('respond', { playerName: 'Marcus', clientId: 'c-marcus', askId: tieId, choice: ['B'] });
    await call('POST', `asks/${tieId}`, { action: 'close' });
    const r = await call('POST', `asks/${tieId}`, { action: 'revote' });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual(buildRow().questions, 2);
  });

  // rejects: a kickoff that does not mark the room started, or marks it twice.
  await check('kickoff twice: started 1', async () => {
    assert.strictEqual((await call('GET', 'state', null, AGENT, { kickoff: '1' })).status, 200);
    await call('GET', 'state', null, AGENT, { kickoff: '1' });
    assert.strictEqual(buildRow().started, 1);
  });

  // rejects: crew tasks not counted.
  await check('a crew task: one task', async () => {
    const on = await call('POST', 'crew/settings', { enabled: true, modes: ['fork', 'patch'] });
    assert.strictEqual(on.status, 200, JSON.stringify(on.body));
    const t = await call('POST', 'crew/tasks', { text: 'Parking map' }, AGENT);
    assert.strictEqual(t.status, 201, JSON.stringify(t.body));
    assert.strictEqual(buildRow().tasks, 1);
  });

  // rejects: a sealed field (the title, an ask's words) carried into a stats row.
  await check('no stats row carries the title or an ask\'s words', () => {
    const rows = [...store.values()].filter((r) => /^(STATS|MONTH)#/.test(String(r.SK)));
    assert.ok(rows.length >= 2);
    const text = JSON.stringify(rows);
    for (const s of [SECRET, 'What should we build', 'Sign-up page', 'Parking map']) assert.ok(!text.includes(s), s);
  });

  suiteFinished();
  say(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { say(e.stack); process.exit(1); });
