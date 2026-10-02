// Local Build Room harness: serves src/dist and a fake API backed by the REAL
// build-room.js handler over an in-memory table. Not committed.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const REPO = path.join(__dirname, '..', '..');
const DIST = path.join(REPO, 'src', 'dist');
const PORT = Number(process.env.PORT || 8790);

class C { constructor(i) { this.input = i; } }
class PutCommand extends C { get type() { return 'put'; } }
class GetCommand extends C { get type() { return 'get'; } }
class QueryCommand extends C { get type() { return 'query'; } }
class DeleteCommand extends C { get type() { return 'delete'; } }
class UpdateCommand extends C { get type() { return 'update'; } }
const store = new Map();
const k = (pk, sk) => `${pk}|${sk}`;
function applyUpdate(inp) {
  const key = k(inp.Key.PK, inp.Key.SK); const cur = store.get(key);
  const cond = inp.ConditionExpression || '';
  const fail = () => { const e = new Error('cond'); e.name = 'ConditionalCheckFailedException'; throw e; };
  if (cond === 'attribute_exists(PK)' && !cur) fail();
  if (cond === 'attribute_not_exists(DeliveredAt)' && cur && cur.DeliveredAt) fail();
  const item = { ...(cur || { PK: inp.Key.PK, SK: inp.Key.SK }) };
  const names = inp.ExpressionAttributeNames || {}; const vals = inp.ExpressionAttributeValues || {};
  const n = (x) => names[x] || x; const e = inp.UpdateExpression;
  const setP = (/SET (.*?)(?: ADD |$)/.exec(e) || [])[1]; const addP = (/ADD (.*)$/.exec(e) || [])[1];
  if (setP) for (const c of setP.split(',')) { const [l, r] = c.split('=').map((s) => s.trim()); item[n(l)] = vals[r]; }
  if (addP) for (const c of addP.split(',')) { const [l, r] = c.trim().split(/\s+/); item[n(l)] = (Number(item[n(l)]) || 0) + Number(vals[r]); }
  store.set(key, item); return { Attributes: inp.ReturnValues === 'UPDATED_OLD' ? (cur || {}) : item };
}
const doc = { send: async (cmd) => {
  const i = cmd.input || {};
  switch (cmd.type) {
    case 'put': store.set(k(i.Item.PK, i.Item.SK), JSON.parse(JSON.stringify(i.Item))); return {};
    case 'get': return { Item: store.get(k(i.Key.PK, i.Key.SK)) };
    case 'delete': store.delete(k(i.Key.PK, i.Key.SK)); return {};
    case 'update': return applyUpdate(i);
    case 'query': { const pk = i.ExpressionAttributeValues[':pk']; const p = i.ExpressionAttributeValues[':sk'] || '';
      let items = [...store.values()].filter((r) => r.PK === pk && String(r.SK).startsWith(p)).sort((a, b) => String(a.SK).localeCompare(String(b.SK)));
      if (i.ExpressionAttributeValues[':type']) items = items.filter((r) => r.ConnectionType === i.ExpressionAttributeValues[':type']);
      return { Items: items }; }
    default: return {};
  }
} };
function stub(name, exports) {
  for (const base of [REPO, path.join(REPO, 'lambda-functions'), path.join(REPO, 'lambda-functions/game')]) {
    try { const p = require.resolve(name, { paths: [base] }); require.cache[p] = { id: p, filename: p, loaded: true, exports }; } catch (e) { /* */ }
  }
}
stub('@aws-sdk/client-dynamodb', { DynamoDBClient: class {} });
stub('@aws-sdk/lib-dynamodb', { DynamoDBDocumentClient: { from: () => doc }, PutCommand, GetCommand, QueryCommand, DeleteCommand, UpdateCommand });
stub('@aws-sdk/client-apigatewaymanagementapi', { ApiGatewayManagementApiClient: class { async send() { return {}; } }, PostToConnectionCommand: C });
process.env.TABLE_NAME = 't';
const { handler } = require(path.join(REPO, 'lambda-functions/game/build-room.js'));

const HOST = { userId: 'host-1', groups: 'hosts', orgId: '', orgIds: '' };
const json = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' }); res.end(JSON.stringify(body)); };
let nextGame = 4821;

async function api(req, res, url, body) {
  const p = url.pathname.replace(/^\/api\//, '');
  let m;
  if (req.method === 'POST' && p === 'games') {
    const id = String(nextGame++); const b = JSON.parse(body || '{}');
    store.set(k(`GAME#${id}`, 'METADATA'), { PK: `GAME#${id}`, SK: 'METADATA', GameType: b.gameType || 'call-and-answer', Title: b.eventTitle, Details: b.engagementInfo, ttl: 2000000000, CreatedAt: new Date().toISOString() });
    store.set(k(`GAME#${id}`, 'STATE'), { PK: `GAME#${id}`, SK: 'STATE', State: 'CREATED' });
    return json(res, 200, { success: true, gameId: id, gameData: { gameId: id } });
  }
  if ((m = /^games\/(\d{4})\/start$/.exec(p))) { store.get(k(`GAME#${m[1]}`, 'STATE')).State = 'STARTED'; store.get(k(`GAME#${m[1]}`, 'METADATA')).Started = true; return json(res, 200, { success: true, gameId: m[1] }); }
  if ((m = /^games\/(\d{4})\/end$/.exec(p))) { store.get(k(`GAME#${m[1]}`, 'STATE')).State = 'ENDED'; return json(res, 200, { success: true }); }
  if ((m = /^games\/(\d{4})\/host-ticket$/.exec(p))) return json(res, 200, { ticket: 'a'.repeat(64), expiresInSeconds: 60 });
  if ((m = /^games\/(\d{4})\/(build|build-play)\/(.+)$/.exec(p))) {
    const auth = String(req.headers.authorization || '').replace(/^Bearer /, '');
    let lambda = HOST;
    if (auth.startsWith('eng_')) {
      const hash = crypto.createHash('sha256').update(auth).digest('hex');
      const row = store.get(k(`GAME#${m[1]}`, `BUILD#KEY#${hash}`));
      if (!row || row.RevokedAt) return json(res, 403, { message: 'Forbidden' });
      lambda = { agent: 'build', agentGameId: m[1], agentKeyHash: hash, groups: '' };
    }
    const r = await handler({ routeKey: `${req.method} /games/{gameId}/${m[2]}/{proxy+}`, requestContext: { http: { method: req.method }, authorizer: m[2] === 'build' ? { lambda } : undefined }, pathParameters: { gameId: m[1], proxy: m[3] }, queryStringParameters: Object.fromEntries(url.searchParams), body });
    res.writeHead(r.statusCode, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); return res.end(r.body);
  }
  if ((m = /^games\/(\d{4})$/.exec(p)) && req.method === 'GET') {
    const meta = store.get(k(`GAME#${m[1]}`, 'METADATA')); if (!meta) return json(res, 404, { error: 'Game not found' });
    const st = store.get(k(`GAME#${m[1]}`, 'STATE'));
    return json(res, 200, { gameId: m[1], title: meta.Title, gameType: meta.GameType, started: st.State !== 'CREATED', state: st.State, visibility: 'public', exists: true, hostName: 'George' });
  }
  if ((m = /^games\/(\d{4})\/players$/.exec(p))) {
    if (req.method === 'POST') {
      const b = JSON.parse(body || '{}'); const name = b.playerName;
      store.set(k(`GAME#${m[1]}`, `PLAYER#${name}`), { PK: `GAME#${m[1]}`, SK: `PLAYER#${name}`, PlayerName: name, ClientId: b.clientId, JoinedAt: new Date().toISOString() });
      return json(res, 200, { success: true, playerId: name, playerName: name, totalScore: 0 });
    }
    const players = [...store.values()].filter((r) => r.PK === `GAME#${m[1]}` && /^PLAYER#[^#]+$/.test(r.SK)).map((r) => ({ playerName: r.PlayerName, name: r.PlayerName, score: 0 }));
    return json(res, 200, { players, count: players.length });
  }
  if ((m = /^games\/(\d{4})\/state(\/.*)?$/.exec(p))) {
    const meta = store.get(k(`GAME#${m[1]}`, 'METADATA')); const st = store.get(k(`GAME#${m[1]}`, 'STATE'));
    if (!meta) return json(res, 404, { error: 'Game not found' });
    return json(res, 200, { gameId: m[1], state: st.State, gameState: st.State, gameType: meta.GameType, started: true, title: meta.Title, currentQuestion: null, players: [] });
  }
  if (p === '__seed' && req.method === 'POST') { const rows = JSON.parse(body); for (const r of rows) store.set(k(r.PK, r.SK), r); return json(res, 200, { ok: true }); }
  console.log('unhandled', req.method, p);
  return json(res, 404, { error: 'not in harness' });
}

http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  let body = ''; req.on('data', (c) => { body += c; });
  req.on('end', async () => {
    if (req.method === 'OPTIONS') return json(res, 204, {});
    if (url.pathname.startsWith('/api/')) { try { return await api(req, res, url, body); } catch (e) { console.error(e); return json(res, 500, { error: e.message }); } }
    if (url.pathname === '/config.js') { res.writeHead(200, { 'Content-Type': 'application/javascript' }); return res.end(`window.API_BASE="http://localhost:${PORT}/api/";window.WS_URL="ws://localhost:1";window.USER_POOL_ID="us-east-1_TEST";window.USER_POOL_CLIENT_ID="testclient";window.COGNITO_DOMAIN="x";window.ENV="development";`); }
    let f = path.join(DIST, decodeURIComponent(url.pathname));
    if (!f.startsWith(DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(DIST, 'index.html');
    const ext = path.extname(f); const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.mjs': 'application/javascript', '.svg': 'image/svg+xml', '.png': 'image/png' };
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
  });
}).listen(PORT, () => console.log(`harness on ${PORT}`));
