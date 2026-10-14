/**
 * THE HOST TYPES WHAT WAS SAID IN THE ROOM (owner, 2026-10-13: "the host should
 * get to type things in as well, because things might be said in the room").
 *
 * POST /games/{gameId}/comments/host: Cognito in front, callerMayDriveSession
 * behind, 404 on anyone else (the feature route's pair). The comment is written
 * like a player's, under the round's results gate, with the room as its author
 * ("Said in the room"), FromHost on the row, and no seat to prove.
 *
 * Every expectation is constructed by hand.
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
let updates = [];

const fakeDoc = {
  send: async (cmd) => {
    const inp = cmd.input || {};
    switch (cmd.type) {
      case 'put': store.set(key(inp.Item.PK, inp.Item.SK), inp.Item); return {};
      case 'get': return { Item: store.get(key(inp.Key.PK, inp.Key.SK)) };
      case 'delete': store.delete(key(inp.Key.PK, inp.Key.SK)); return {};
      case 'update': {
        updates.push(inp);
        const item = store.get(key(inp.Key.PK, inp.Key.SK));
        if (!item) {
          if (inp.ConditionExpression) { const e = new Error('cond'); e.name = 'ConditionalCheckFailedException'; throw e; }
          return {};
        }
        // Apply `SET #a = :a, #b = :b` literally, enough for this handler.
        const sets = String(inp.UpdateExpression).replace(/^SET\s+/i, '').split(',');
        for (const s of sets) {
          const [lhs, rhs] = s.split('=').map((x) => x.trim());
          const name = inp.ExpressionAttributeNames[lhs];
          item[name] = inp.ExpressionAttributeValues[rhs];
        }
        return { Attributes: item };
      }
      case 'query': {
        const pk = inp.ExpressionAttributeValues[':pk'];
        const prefix = inp.ExpressionAttributeValues[':sk'] ?? '';
        const items = [...store.values()]
          .filter((i) => i.PK === pk && String(i.SK).startsWith(String(prefix)))
          .sort((a, b) => String(a.SK).localeCompare(String(b.SK)));
        return { Items: items, Count: items.length };
      }
      default: return {};
    }
  },
};

class FakeApiGatewayClient {
  async send(cmd) {
    sent.push({ connectionId: cmd.input.ConnectionId, message: JSON.parse(cmd.input.Data) });
    return {};
  }
}

const STUB_PATHS = [REPO, path.join(REPO, 'lambda-functions'), path.join(REPO, 'lambda-functions', 'game'), path.join(REPO, 'lambda-functions', 'websocket')];
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
stub('@aws-sdk/client-dynamodb', { DynamoDBClient: class {} });
stub('@aws-sdk/lib-dynamodb', { DynamoDBDocumentClient: { from: () => fakeDoc }, PutCommand, GetCommand, QueryCommand, DeleteCommand, UpdateCommand });
stub('@aws-sdk/client-apigatewaymanagementapi', { ApiGatewayManagementApiClient: FakeApiGatewayClient, PostToConnectionCommand });

process.env.TABLE_NAME = 'test-table';
process.env.WEBSOCKET_API_ENDPOINT = 'https://ws.test.invalid/dev';

const { handler } = require(path.join(REPO, 'lambda-functions/game/comments.js'));

let pass = 0; let fail = 0;
function check(label, fn) {
  try { fn(); console.log(`  PASS  ${label}`); pass++; } catch (e) { console.log(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}
const put = (item) => store.set(key(item.PK, item.SK), item);
const rows = (gameId, prefix) => [...store.values()].filter((i) => i.PK === `GAME#${gameId}` && String(i.SK).startsWith(prefix));

// A host of org "acme": the Cognito authorizer's claims, as tenant.js reads them.
const HOST = { jwt: { claims: { sub: 'host-sub', email: 'host@acme.test', 'cognito:groups': 'hosts', 'custom:orgId': 'acme' } } };

const hostSay = (gameId, body, { auth = HOST } = {}) => handler({
  requestContext: { http: { method: 'POST' }, routeKey: 'POST /games/{gameId}/comments/host', ...(auth ? { authorizer: auth } : {}) },
  routeKey: 'POST /games/{gameId}/comments/host',
  pathParameters: { gameId },
  body: JSON.stringify(body),
});
const playerSay = (gameId, body) => handler({
  requestContext: { http: { method: 'POST' }, routeKey: 'POST /games/{gameId}/comments' },
  routeKey: 'POST /games/{gameId}/comments',
  pathParameters: { gameId },
  body: JSON.stringify(body),
});

function seed(gameId, { orgId = null, state = 'RESULTS#003' } = {}) {
  store.clear(); sent = []; updates = [];
  put({ PK: `GAME#${gameId}`, SK: 'METADATA', GameType: 'call-and-answer', Title: 'Q3 offsite', ...(orgId ? { orgId } : {}) });
  put({ PK: `GAME#${gameId}`, SK: 'STATE', State: state, LessonNumber: 3 });
  put({ PK: `GAME#${gameId}`, SK: 'ROUND#003', QuestionNumber: '003', StageBeat: 'feedback' });
  put({ PK: `GAME#${gameId}`, SK: 'CONNECTION#host-1', ConnectionId: 'host-1', ConnectionType: 'HOST' });
}

const SAY = { questionNumber: 3, anchorKind: 'results', text: 'Someone at the back: we tried this in 2024.' };

(async () => {
  console.log('\n1. the host writes one');
  seed('4201');
  const res = await hostSay('4201', SAY);
  check('responds 201', () => assert.strictEqual(res.statusCode, 201, `got ${res.statusCode}: ${res.body}`));
  check('the row is the room\'s, marked FromHost, with the text as typed', () => {
    const [row] = rows('4201', 'COMMENT#003#');
    assert.ok(row, 'no comment row written');
    assert.strictEqual(row.playerName, 'Said in the room');
    assert.strictEqual(row.FromHost, true);
    assert.strictEqual(row.Text, SAY.text);
  });
  check('the wire says fromHost', () => assert.strictEqual(JSON.parse(res.body).comment.fromHost, true));
  check('every screen hears commentPosted', () => assert.ok(sent.some((s) => s.message.type === 'commentPosted')));

  console.log('\n2. a player cannot claim the room');
  seed('4202');
  const claim = await playerSay('4202', { ...SAY, playerName: 'Said in the room' });
  check('the public route still needs a seat: 409', () => assert.strictEqual(claim.statusCode, 409, claim.body));

  console.log('\n3. the gates');
  seed('4203', { orgId: 'acme' });
  const anon = await hostSay('4203', SAY, { auth: null });
  check('no caller identity: 404', () => assert.strictEqual(anon.statusCode, 404, anon.body));
  const other = await hostSay('4203', SAY, { auth: { jwt: { claims: { sub: 'x', email: 'x@other.test', 'cognito:groups': 'hosts', 'custom:orgId': 'other' } } } });
  check("another organisation's host: 404, nothing written", () => {
    assert.strictEqual(other.statusCode, 404, other.body);
    assert.strictEqual(rows('4203', 'COMMENT#').length, 0);
  });
  seed('4204', { state: 'VOTE#003' });
  const early = await hostSay('4204', SAY);
  check('only while this round shows its results: 409', () => assert.strictEqual(early.statusCode, 409, early.body));
  seed('4205');
  const empty = await hostSay('4205', { ...SAY, text: '   ' });
  check('an empty comment: 400', () => assert.strictEqual(empty.statusCode, 400, empty.body));

  console.log('\n4. the template routes it behind Cognito');
  const yaml = require('fs').readFileSync(path.join(REPO, 'template-clean.yaml'), 'utf8');
  check('POST /games/{gameId}/comments/host carries the CognitoAuthorizer', () => {
    const at = yaml.indexOf('Path: /games/{gameId}/comments/host');
    assert.ok(at > 0, 'route missing');
    assert.ok(/Authorizer: CognitoAuthorizer/.test(yaml.slice(at, at + 200)), 'route is public');
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail ? 1 : 0);
})();
