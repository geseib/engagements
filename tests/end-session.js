/**
 * A HOST CAN END A TRIVIA, POLL, CALL & ANSWER OR WAVELENGTH SESSION.
 *
 * Task 4, 2026-09-26 bug sweep: before this, a non-survey session reached
 * ENDED only when next-question.js's pool-dry path ran out of questions to
 * serve. A host who wanted to stop after round 4 of 10 had no way to, and the
 * session stayed live until its ttl.
 *
 * POST /games/{gameId}/end is the new door: Cognito in front and
 * `callerMayDriveSession` on the session's own org behind it, the same pair
 * next-question.js and the comment-feature route (799c4ba6) pay. It writes
 * and broadcasts through session-end.js's shared `endSession` — the SAME
 * helper next-question.js's pool-dry path now calls, so this suite also
 * stands in for "the shared helper is not duplicated": if end-session.js ever
 * grew its own copy of the UpdateCommand, it would still pass on its own, but
 * `tests/lobby-start-ttl.js` and this file together would then be the only
 * two places that would need to agree on the wire shape by hand rather than
 * by construction — which is exactly the drift the brief calls out.
 *
 * Idempotent: a second call is a 200 no-op. A survey is refused, 400, and
 * pointed at survey/end, which this route never touches.
 *
 * Every expectation is constructed by hand, following tests/comment-feature.js.
 */
const suiteFinished = require('./helpers/finish-guard');
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');

class GetCommand { constructor(i) { this.input = i; this.type = 'get'; } }
class QueryCommand { constructor(i) { this.input = i; this.type = 'query'; } }
class DeleteCommand { constructor(i) { this.input = i; this.type = 'delete'; } }
class UpdateCommand { constructor(i) { this.input = i; this.type = 'update'; } }
class PutCommand { constructor(i) { this.input = i; this.type = 'put'; } }
class PostToConnectionCommand { constructor(i) { this.input = i; } }

const store = new Map();
const key = (pk, sk) => `${pk}|${sk}`;
let sent = [];
let updates = [];
let gets = [];

const fakeDoc = {
  send: async (cmd) => {
    const inp = cmd.input || {};
    switch (cmd.type) {
      case 'put': store.set(key(inp.Item.PK, inp.Item.SK), inp.Item); return {};
      case 'get': gets.push(inp.Key); return { Item: store.get(key(inp.Key.PK, inp.Key.SK)) };
      case 'delete': store.delete(key(inp.Key.PK, inp.Key.SK)); return {};
      case 'update': {
        updates.push(inp);
        const item = store.get(key(inp.Key.PK, inp.Key.SK));
        if (!item) {
          if (inp.ConditionExpression) { const e = new Error('cond'); e.name = 'ConditionalCheckFailedException'; throw e; }
          return {};
        }
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
stub('@aws-sdk/client-dynamodb', { DynamoDBClient: class {} });
stub('@aws-sdk/lib-dynamodb', {
  DynamoDBDocumentClient: { from: () => fakeDoc }, GetCommand, QueryCommand, DeleteCommand, UpdateCommand, PutCommand,
});
stub('@aws-sdk/client-apigatewaymanagementapi', { ApiGatewayManagementApiClient: FakeApiGatewayClient, PostToConnectionCommand });

process.env.TABLE_NAME = 'test-table';
process.env.WEBSOCKET_API_ENDPOINT = 'https://ws.test.invalid/dev';

const { handler } = require(path.join(REPO, 'lambda-functions/game/end-session.js'));

let pass = 0; let fail = 0;
function check(label, fn) {
  try { fn(); console.log(`  PASS  ${label}`); pass++; } catch (e) { console.log(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

const put = (item) => store.set(key(item.PK, item.SK), item);
const stateOf = (gameId) => store.get(key(`GAME#${gameId}`, 'STATE'));
const metaOf = (gameId) => store.get(key(`GAME#${gameId}`, 'METADATA'));

// A host of org "acme": the Cognito authorizer's claims, as tenant.js reads them.
const HOST = { jwt: { claims: { sub: 'host-sub', email: 'host@acme.test', 'cognito:groups': 'hosts', 'custom:orgId': 'acme' } } };
const OTHER_ORG_HOST = { jwt: { claims: { sub: 'x', email: 'x@other.test', 'cognito:groups': 'hosts', 'custom:orgId': 'other' } } };

const endSession = (gameId, { auth = HOST } = {}) => handler({
  requestContext: { http: { method: 'POST' }, routeKey: 'POST /games/{gameId}/end', ...(auth ? { authorizer: auth } : {}) },
  routeKey: 'POST /games/{gameId}/end',
  pathParameters: { gameId },
  body: '{}',
});

function seed(gameId, { orgId = 'acme', gameType = 'trivia', state = 'ASK#003' } = {}) {
  put({ PK: `GAME#${gameId}`, SK: 'METADATA', GameType: gameType, Title: 'Q3 offsite', ...(orgId ? { orgId } : {}) });
  put({ PK: `GAME#${gameId}`, SK: 'STATE', State: state, LessonNumber: 3 });
  put({ PK: `GAME#${gameId}`, SK: 'CONNECTION#host-1', ConnectionId: 'host-1', ConnectionType: 'HOST' });
  put({ PK: `GAME#${gameId}`, SK: 'CONNECTION#p-1', ConnectionId: 'p-1', ConnectionType: 'PLAYER', PlayerName: 'Ada' });
}

(async () => {
  console.log('\n1. the gates');
  seed('5101');
  gets = [];
  const anon = await endSession('5101', { auth: null });
  check('no caller identity: 404, like next-question.js', () => assert.strictEqual(anon.statusCode, 404, anon.body));
  check('nothing was written', () => assert.strictEqual(stateOf('5101').State, 'ASK#003'));
  // Fix round 1, item 4: the claims check moved above the two DynamoDB reads,
  // so an unidentified caller costs the table nothing at all.
  check('no read was even attempted — refused before touching the table', () => {
    assert.strictEqual(gets.length, 0, JSON.stringify(gets));
  });

  const other = await endSession('5101', { auth: OTHER_ORG_HOST });
  check("another organisation's host: 404, and nothing written", () => {
    assert.strictEqual(other.statusCode, 404, other.body);
    assert.strictEqual(stateOf('5101').State, 'ASK#003');
  });

  const missing = await endSession('no-such-game');
  check('an unknown game: 404', () => assert.strictEqual(missing.statusCode, 404, missing.body));

  console.log('\n2. the owner ends the session');
  sent = []; updates = [];
  const res = await endSession('5101');
  check('responds 200', () => assert.strictEqual(res.statusCode, 200, res.body));
  check('STATE reads ENDED', () => assert.strictEqual(stateOf('5101').State, 'ENDED'));
  check('the write is an UpdateCommand on STATE, never a PUT — METADATA is not rewritten', () => {
    assert.strictEqual(updates.length, 1);
    assert.strictEqual(updates[0].Key.SK, 'STATE');
    // METADATA is read for the gate (orgId, GameType) and never touched by the
    // write path: requirement 1 is "writes ENDED exactly as the pool-dry path
    // does", and next-question.js's own pool-dry ending never rewrites
    // METADATA either (session-start.js is the only writer of METADATA past
    // creation, and it never sets a State field there).
    assert.strictEqual(metaOf('5101').GameType, 'trivia');
  });
  check('the broadcast reaches every connection, the same frame the pool-dry path sends', () => {
    const frames = sent.filter((s) => s.message.type === 'hostMessage' && s.message.messageType === 'END');
    assert.deepStrictEqual(frames.map((f) => f.connectionId).sort(), ['host-1', 'p-1']);
    const m = frames[0].message;
    assert.strictEqual(m.gameId, '5101');
    assert.strictEqual(m.state, 'GAME#5101 ENDED');
  });
  check('the response says it changed', () => {
    assert.strictEqual(JSON.parse(res.body).state, 'ENDED');
    assert.strictEqual(JSON.parse(res.body).changed, true);
  });

  console.log('\n3. a second call is a no-op');
  sent = []; updates = [];
  const again = await endSession('5101');
  check('still 200', () => assert.strictEqual(again.statusCode, 200, again.body));
  check('nothing is written the second time', () => assert.strictEqual(updates.length, 0));
  check('nothing is broadcast the second time', () => assert.strictEqual(sent.length, 0));
  check('the response says nothing changed', () => assert.strictEqual(JSON.parse(again.body).changed, false));

  console.log('\n4. every non-survey type reaches ENDED the same way');
  for (const gameType of ['poll', 'call-and-answer', 'wavelength']) {
    const gameId = `52${gameType.length}${gameType.charCodeAt(0) % 10}`;
    seed(gameId, { gameType, state: 'VOTE#001' });
    // eslint-disable-next-line no-await-in-loop
    const r = await endSession(gameId);
    check(`${gameType}: ends`, () => {
      assert.strictEqual(r.statusCode, 200, r.body);
      assert.strictEqual(stateOf(gameId).State, 'ENDED');
    });
  }

  console.log('\n5. a survey is refused, and pointed at survey/end');
  seed('5301', { gameType: 'survey', state: 'SURVEY#OPEN' });
  const survey = await endSession('5301');
  check('400, not ended', () => {
    assert.strictEqual(survey.statusCode, 400, survey.body);
    assert.strictEqual(stateOf('5301').State, 'SURVEY#OPEN');
  });
  check('names survey/end by name (fix round 1, item 8)', () => {
    const body = JSON.parse(survey.body);
    assert.ok(/survey\/end/i.test(`${body.error} ${body.message}`), JSON.stringify(body));
  });

  /*
    FIX ROUND 1, ITEM 3 — a CREATED session is one the UI never offers to end
    (`canEndSession` refuses the lobby), and this route must refuse it too:
    ending it would leave `Started` unset and the 90-day ttl in place, with
    STATE reading ENDED for a session that never opened.
  */
  console.log('\n6. a CREATED session has not started — refused, not ended');
  seed('5401', { state: 'CREATED' });
  gets = []; updates = []; sent = [];
  const created = await endSession('5401');
  check('409, not ended', () => {
    assert.strictEqual(created.statusCode, 409, created.body);
    assert.strictEqual(stateOf('5401').State, 'CREATED');
  });
  check('says plainly that it has not started', () => {
    const body = JSON.parse(created.body);
    assert.ok(/has not started yet/i.test(`${body.error} ${body.message}`), JSON.stringify(body));
  });
  check('nothing written, nothing broadcast', () => {
    assert.strictEqual(updates.length, 0);
    assert.strictEqual(sent.length, 0);
  });

  /*
    FIX ROUND 1, ITEM 6 — THE NO-DUPLICATION REQUIREMENT, PINNED DIRECTLY.
    next-question.js's pool-dry path must call the shared helper rather than
    carry its own copy of the ENDED write — the whole point of extracting
    session-end.js. A source scan, not a behavioural test: the behaviour is
    already covered above (§2-4), and what could silently regress is someone
    re-inlining the UpdateCommand beside the call rather than instead of it.
  */
  console.log('\n7. the shared helper is not duplicated');
  const nextQuestionSrc = require('fs').readFileSync(
    path.join(REPO, 'lambda-functions/game/next-question.js'), 'utf8',
  );
  check('next-question.js calls the shared helper for its pool-dry ending', () => {
    assert.ok(/endSession\(db, process\.env\.TABLE_NAME, gameId/.test(nextQuestionSrc),
      'endSession(db, process.env.TABLE_NAME, gameId, ...) call not found');
  });
  check('next-question.js carries no ENDED UpdateCommand of its own', () => {
    assert.ok(!nextQuestionSrc.includes("':state': 'ENDED'"),
      "a literal STATE->ENDED UpdateCommand still exists in next-question.js, outside session-end.js");
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail ? 1 : 0);
})();
