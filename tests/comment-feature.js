/**
 * FEATURING A COMMENT ON THE WALL — the host's write, and what the report
 * carries.
 *
 * The owner (2026-09-22): after results on Call & Answer *"there needs to be a
 * way to get that info up on the screen … click on those would allow everyone
 * to see them. this feedback needs to be captured for the reports as well."*
 *
 * POST /games/{gameId}/comments/{commentId}/feature is the host's route: Cognito
 * in front, and `callerMayDriveSession` on the session's own org behind, the
 * same two gates stage-beat.js pays. It sets `Featured`/`FeaturedAt` on the one
 * row and broadcasts `commentFeatured` so every projector and phone refetches.
 * A public caller — a phone — can never reach it (404, like the beat).
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

const feature = (gameId, commentId, body, { auth = HOST } = {}) => handler({
  requestContext: { http: { method: 'POST' }, routeKey: 'POST /games/{gameId}/comments/{commentId}/feature', ...(auth ? { authorizer: auth } : {}) },
  routeKey: 'POST /games/{gameId}/comments/{commentId}/feature',
  pathParameters: { gameId, commentId },
  body: JSON.stringify(body),
});
const get = (gameId, qs) => handler({
  requestContext: { http: { method: 'GET' }, routeKey: 'GET /games/{gameId}/comments' },
  routeKey: 'GET /games/{gameId}/comments',
  pathParameters: { gameId },
  queryStringParameters: qs || {},
});

function seed(gameId, { orgId = 'acme' } = {}) {
  store.clear(); sent = []; updates = [];
  put({ PK: `GAME#${gameId}`, SK: 'METADATA', GameType: 'call-and-answer', Title: 'Q3 offsite', ...(orgId ? { orgId } : {}) });
  put({ PK: `GAME#${gameId}`, SK: 'STATE', State: 'RESULTS#003', LessonNumber: 3 });
  put({ PK: `GAME#${gameId}`, SK: 'ROUND#003', QuestionNumber: '003', AuthorsRevealed: true, StageBeat: 'feedback' });
  put({ PK: `GAME#${gameId}`, SK: 'CONNECTION#host-1', ConnectionId: 'host-1', ConnectionType: 'HOST' });
  put({ PK: `GAME#${gameId}`, SK: 'CONNECTION#p-1', ConnectionId: 'p-1', ConnectionType: 'PLAYER', PlayerName: 'Ada' });
  put({ PK: `GAME#${gameId}`, SK: 'COMMENT#003#summary##100000000000001-aaaa', GameId: gameId, QuestionNumber: '003', AnchorKind: 'summary', AnchorRef: '', AnchorLabel: 'the summary', AnchorExcerpt: '', Text: 'Sharp.', playerName: 'Ada', name: 'Ada', SubmittedAt: '2026-09-22T10:00:00.000Z' });
  put({ PK: `GAME#${gameId}`, SK: 'COMMENT#003#response#1#100000000000002-bbbb', GameId: gameId, QuestionNumber: '003', AnchorKind: 'response', AnchorRef: '1', AnchorLabel: 'Response 2 — Sam', AnchorExcerpt: 'Re-price it.', Text: 'Only this one touches the customer.', playerName: 'Bea', name: 'Bea', SubmittedAt: '2026-09-22T10:01:00.000Z' });
}

(async () => {
  console.log('\n1. the host features one comment');
  seed('4101');
  const res = await feature('4101', '100000000000002-bbbb', { questionNumber: 3, featured: true });
  check('responds 200', () => assert.strictEqual(res.statusCode, 200, `got ${res.statusCode}: ${res.body}`));
  check('the one row is stamped Featured with a time; the other is untouched', () => {
    const a = rows('4101', 'COMMENT#').find((r) => r.SK.endsWith('aaaa'));
    const b = rows('4101', 'COMMENT#').find((r) => r.SK.endsWith('bbbb'));
    assert.strictEqual(a.Featured, undefined);
    assert.strictEqual(b.Featured, true);
    assert.ok(/^\d{4}-\d{2}-\d{2}T/.test(String(b.FeaturedAt)), `FeaturedAt was ${b.FeaturedAt}`);
  });
  check('UPDATE, never PUT — the prose is not rewritten', () => {
    assert.strictEqual(updates.length, 1);
    assert.ok(!/Text/.test(updates[0].UpdateExpression + JSON.stringify(updates[0].ExpressionAttributeNames)));
  });
  check('the response carries the comment on the wire with featured on it', () => {
    const body = JSON.parse(res.body);
    assert.strictEqual(body.comment.commentId, '100000000000002-bbbb');
    assert.strictEqual(body.comment.featured, true);
    assert.strictEqual(body.comment.text, 'Only this one touches the customer.');
  });
  check('every connection hears commentFeatured, with where and never the prose', () => {
    const frames = sent.filter((s) => s.message.type === 'commentFeatured');
    assert.deepStrictEqual(frames.map((f) => f.connectionId).sort(), ['host-1', 'p-1']);
    const m = frames[0].message;
    assert.strictEqual(m.gameId, '4101');
    assert.strictEqual(m.questionNumber, '003');
    assert.strictEqual(m.commentId, '100000000000002-bbbb');
    assert.strictEqual(m.featured, true);
    assert.strictEqual(m.text, undefined);
  });

  console.log('\n2. GET carries the flag back');
  const list = await get('4101', { questionNumber: '3' });
  check('the read shows featured on exactly the featured one', () => {
    const comments = JSON.parse(list.body).comments;
    assert.deepStrictEqual(comments.map((c) => [c.commentId, c.featured === true]),
      [['100000000000001-aaaa', false], ['100000000000002-bbbb', true]]);
    assert.strictEqual(comments[1].featuredAt.slice(0, 4), String(new Date().getFullYear()));
  });

  console.log('\n3. un-featuring');
  const off = await feature('4101', '100000000000002-bbbb', { questionNumber: 3, featured: false });
  check('responds 200 and clears the flag', () => {
    assert.strictEqual(off.statusCode, 200, off.body);
    const b = rows('4101', 'COMMENT#').find((r) => r.SK.endsWith('bbbb'));
    assert.strictEqual(b.Featured, false);
  });

  console.log('\n4. the gates');
  seed('4102');
  const anon = await feature('4102', '100000000000002-bbbb', { questionNumber: 3, featured: true }, { auth: null });
  check('no caller identity: 404, like the beat', () => assert.strictEqual(anon.statusCode, 404, anon.body));
  const other = await feature('4102', '100000000000002-bbbb', { questionNumber: 3, featured: true },
    { auth: { jwt: { claims: { sub: 'x', email: 'x@other.test', 'cognito:groups': 'hosts', 'custom:orgId': 'other' } } } });
  check("another organisation's host: 404, and nothing written", () => {
    assert.strictEqual(other.statusCode, 404, other.body);
    assert.strictEqual(rows('4102', 'COMMENT#').some((r) => r.Featured), false);
  });
  const missing = await feature('4102', 'no-such-id', { questionNumber: 3, featured: true });
  check('an unknown comment: 404', () => assert.strictEqual(missing.statusCode, 404, missing.body));
  const badBody = await feature('4102', '100000000000002-bbbb', { questionNumber: 3, featured: 'yes' });
  check('featured must be a boolean: 400', () => assert.strictEqual(badBody.statusCode, 400, badBody.body));
  const noRound = await feature('4102', '100000000000002-bbbb', { featured: true });
  check('questionNumber is required: 400', () => assert.strictEqual(noRound.statusCode, 400, noRound.body));

  console.log('\n5. the report carries it');
  // create-report.js maps rows to the report shape; hold the mapping by source.
  const src = require('fs').readFileSync(path.join(REPO, 'lambda-functions/game/create-report.js'), 'utf8');
  check('create-report.js emits featured and featuredAt on each comment', () => {
    assert.ok(/featured:\s*row\.Featured === true/.test(src), 'featured not mapped');
    assert.ok(/featuredAt:\s*row\.FeaturedAt/.test(src), 'featuredAt not mapped');
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail ? 1 : 0);
})();
