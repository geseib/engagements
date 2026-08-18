/**
 * PUT /games/{gameId} — editing a session BEFORE it starts, against the REAL
 * handlers.
 *
 * The traps these tests exist to catch, each named at the assertion that
 * would fire:
 *
 *   1. THE Put LANDMINE. update-game-persona.js's header records that a
 *      whole-item Put on METADATA (websocket/save-game-context.js) silently
 *      destroyed ScoringConfig, Details, Visibility, AccessCode, Started and
 *      LastPlayedAt. Every edit here must be an UpdateCommand naming only the
 *      edited attributes — the command log below is how that is proven rather
 *      than assumed.
 *   2. THE STALE INDEX ROW. PK='GAMES' SK='GAME#{id}' duplicates Title and
 *      Visibility (schema-compliant-manager.js:44-64); an edit that forgets
 *      the mirror leaves every session list showing the old values.
 *   3. MASS ASSIGNMENT. gameType/questionSetId pin derived rows
 *      (QuestionSetVersion, CATEGORY#*#ORDER, STATE#CATS) and accessCode was
 *      deliberately kept off unauthenticated surfaces — a handler that loops
 *      over body keys writes all of them.
 *   4. EDITING A LIVE ROOM. start-game.js:22-45's predicate — STATE row
 *      exists and State === 'CREATED' — is the gate, and it must hold BEFORE
 *      any write.
 *
 * Fixtures are not invented: game rows come from the real
 * websocket/create-game.js, the started state from the real game/start-game.js,
 * and the event shape (pathParameters + JSON body) is how API Gateway invokes
 * update-game-persona.js today.
 *
 * Stubbing note (same as tests/persona-controls.js): intercept Module._load by
 * request name — poisoning require.cache by resolved path silently misses.
 */
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');

const Module = require('module');
const stubs = new Map();
const realLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (stubs.has(request)) return stubs.get(request);
  return realLoad.call(this, request, parent, isMain);
};
function stub(name, exports) { stubs.set(name, exports); }

// ---- in-memory table -------------------------------------------------------
const store = new Map();
const key = (pk, sk) => `${pk}|${sk}`;

/** Every command the handlers send, so a test can assert what did NOT happen. */
const sent = [];
const mark = () => sent.length;
const sentSince = (m) => sent.slice(m);

class GetCommand { constructor(i) { this.input = i; this.type = 'get'; } }
class PutCommand { constructor(i) { this.input = i; this.type = 'put'; } }
class QueryCommand { constructor(i) { this.input = i; this.type = 'query'; } }
class UpdateCommand { constructor(i) { this.input = i; this.type = 'update'; } }
class DeleteCommand { constructor(i) { this.input = i; this.type = 'delete'; } }
class ScanCommand { constructor(i) { this.input = i; this.type = 'scan'; } }
class TransactWriteCommand { constructor(i) { this.input = i; this.type = 'transact'; } }
class BatchWriteCommand { constructor(i) { this.input = i; this.type = 'batchWrite'; } }

const conditionalFailure = () => {
  const e = new Error('The conditional request failed');
  e.name = 'ConditionalCheckFailedException';
  return e;
};

/** Split "a = :a, b = if_not_exists(#p, :q)" on top-level commas only. */
function splitClauses(part) {
  const out = [];
  let depth = 0, cur = '';
  for (const ch of part) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out.map((c) => c.trim());
}

const fakeDoc = {
  send: async (cmd) => {
    const inp = cmd.input || {};
    sent.push({ type: cmd.type, key: inp.Key || (inp.Item && { PK: inp.Item.PK, SK: inp.Item.SK }), input: inp });
    switch (cmd.type) {
      case 'put':
        store.set(key(inp.Item.PK, inp.Item.SK), inp.Item);
        return {};
      case 'get':
        return { Item: store.get(key(inp.Key.PK, inp.Key.SK)) };
      case 'delete':
        store.delete(key(inp.Key.PK, inp.Key.SK));
        return {};
      case 'update': {
        const k = key(inp.Key.PK, inp.Key.SK);
        let item = store.get(k);

        // attribute_exists(PK) is what stops an Update on a missing key from
        // CREATING the item — honour it, or the 404 tests test nothing.
        if (/attribute_exists\(PK\)/.test(inp.ConditionExpression || '') && !item) {
          throw conditionalFailure();
        }
        if (!item) { item = { PK: inp.Key.PK, SK: inp.Key.SK }; store.set(k, item); }

        const expr = inp.UpdateExpression || '';
        const names = inp.ExpressionAttributeNames || {};
        const values = inp.ExpressionAttributeValues || {};
        const resolveSeg = (s) => (s.startsWith('#') ? names[s] : s);
        // "#hp.#aur" is a DOCUMENT PATH — resolve each segment, so a nested
        // write lands nested. Flattening it to one attribute name here would
        // make the "not top-level" test below pass against a broken handler.
        const pathOf = (t) => t.trim().split('.').map(resolveSeg);
        const getPath = (obj, p) => p.reduce((o, seg) => (o == null ? undefined : o[seg]), obj);
        const setPath = (obj, p, value) => {
          let o = obj;
          for (let i = 0; i < p.length - 1; i++) {
            if (o[p[i]] === null || typeof o[p[i]] !== 'object') {
              // Real DynamoDB refuses a nested SET into a missing map. The
              // legacy-row test relies on this being emulated faithfully.
              const e = new Error('The document path provided in the update expression is invalid for update');
              e.name = 'ValidationException';
              throw e;
            }
            o = o[p[i]];
          }
          o[p[p.length - 1]] = value;
        };

        const setPart = (expr.match(/SET\s+(.*?)(?=\s*REMOVE\b|$)/is) || [])[1];
        if (setPart) {
          for (const clause of splitClauses(setPart)) {
            const eq = clause.indexOf('=');
            const lhs = clause.slice(0, eq).trim();
            const rhs = clause.slice(eq + 1).trim();
            const ifne = rhs.match(/^if_not_exists\(([^,]+),\s*(:[\w]+)\)$/);
            let value;
            if (ifne) {
              const existing = getPath(item, pathOf(ifne[1]));
              value = existing !== undefined ? existing : values[ifne[2]];
            } else {
              value = values[rhs];
            }
            setPath(item, pathOf(lhs), value);
          }
        }
        const removePart = (expr.match(/REMOVE\s+(.+)$/i) || [])[1];
        if (removePart) {
          for (const t of removePart.split(',')) {
            const p = pathOf(t);
            const parent = p.length > 1 ? getPath(item, p.slice(0, -1)) : item;
            if (parent && typeof parent === 'object') delete parent[p[p.length - 1]];
          }
        }
        return {};
      }
      case 'query': {
        const v = inp.ExpressionAttributeValues || {};
        const pk = v[':pk'] ?? v[':PK'];
        const prefix = v[':sk'] ?? v[':prefix'] ?? '';
        const items = [...store.values()].filter(
          (i) => i.PK === pk && String(i.SK).startsWith(String(prefix))
        );
        return { Items: items, Count: items.length };
      }
      case 'batchWrite': {
        for (const [, requests] of Object.entries(inp.RequestItems || {})) {
          for (const r of requests) {
            if (r.PutRequest) store.set(key(r.PutRequest.Item.PK, r.PutRequest.Item.SK), r.PutRequest.Item);
            if (r.DeleteRequest) store.delete(key(r.DeleteRequest.Key.PK, r.DeleteRequest.Key.SK));
          }
        }
        return { UnprocessedItems: {} };
      }
      default:
        return { Items: [], Count: 0 };
    }
  },
};

stub('@aws-sdk/client-dynamodb', { DynamoDBClient: class {} });
stub('@aws-sdk/lib-dynamodb', {
  DynamoDBDocumentClient: { from: () => fakeDoc },
  GetCommand, PutCommand, QueryCommand, UpdateCommand, DeleteCommand, ScanCommand,
  TransactWriteCommand, BatchWriteCommand,
});
stub('@aws-sdk/client-apigatewaymanagementapi', {
  ApiGatewayManagementApiClient: class { async send() { return {}; } },
  PostToConnectionCommand: class { constructor(i) { this.input = i; } },
});

process.env.TABLE_NAME = 'test-table';

const createGameHandler = require(path.join(REPO, 'lambda-functions', 'websocket', 'create-game.js')).handler;
const startGameHandler = require(path.join(REPO, 'lambda-functions', 'game', 'start-game.js')).handler;
const updateGameHandler = require(path.join(REPO, 'lambda-functions', 'game', 'update-game.js')).handler;
const getGameHandler = require(path.join(REPO, 'lambda-functions', 'game', 'get-game.js')).handler;

let pass = 0, fail = 0;
async function acheck(label, fn) {
  try { await fn(); console.log(`  PASS  ${label}`); pass++; }
  catch (e) { console.log(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

// The exact invocation shapes API Gateway delivers — the same reading
// update-game-persona.js does of pathParameters/body.
const createGame = async (body) => {
  const res = await createGameHandler({ body: JSON.stringify(body) });
  return { status: res.statusCode, body: JSON.parse(res.body) };
};
const putGame = async (gameId, body) => {
  const res = await updateGameHandler({
    pathParameters: { gameId },
    body: JSON.stringify(body),
  });
  return { status: res.statusCode, body: JSON.parse(res.body) };
};

const metadataOf = (gameId) => store.get(key(`GAME#${gameId}`, 'METADATA'));
const listRowOf = (gameId) => store.get(key('GAMES', `GAME#${gameId}`));
const writesIn = (cmds) => cmds.filter((c) => ['put', 'update', 'delete', 'batchWrite', 'transact'].includes(c.type));

(async () => {
  const realLog = console.log;
  const realWarn = console.warn;
  const quiet = () => { console.log = () => {}; console.warn = () => {}; };
  const loud = () => { console.log = realLog; console.warn = realWarn; };

  loud();
  console.log('the gate: only a CREATED session is editable\n');

  quiet();
  const created = await createGame({
    eventTitle: 'Editable session', gameType: 'call-and-answer', questionSetId: 'set-a',
    engagementInfo: 'Original details', aiContext: 'Original context',
    visibility: 'private', accessCode: '4242',
  });
  const started = await createGame({
    eventTitle: 'Live session', gameType: 'call-and-answer', questionSetId: 'set-a',
  });
  await startGameHandler({ pathParameters: { gameId: started.body.gameId } });
  loud();

  await acheck('a started session is refused, and NO write happens', async () => {
    // rejects: a handler that writes first and checks afterwards, and one that
    // reads Started off METADATA instead of the STATE row start-game maintains.
    const gameId = started.body.gameId;
    const before = structuredClone(metadataOf(gameId));
    const m = mark();
    quiet();
    const res = await putGame(gameId, { eventTitle: 'Renamed under the room' });
    loud();
    assert.strictEqual(res.status, 400, `expected 400, got ${res.status}`);
    assert(/STARTED/.test(res.body.message || ''), 'the refusal must name the state, as start-game does');
    assert.deepStrictEqual(writesIn(sentSince(m)), [], 'a refused edit must not have written anything');
    assert.deepStrictEqual(metadataOf(gameId), before, 'METADATA changed despite the refusal');
  });

  await acheck('a missing game 404s, writes nothing, and conjures no METADATA', async () => {
    // rejects: skipping the STATE read, and an Update without
    // attribute_exists(PK) — which CREATES the row it meant to edit.
    const m = mark();
    quiet();
    const res = await putGame('0000', { eventTitle: 'Ghost' });
    loud();
    assert.strictEqual(res.status, 404);
    assert.deepStrictEqual(writesIn(sentSince(m)), [], 'a 404 must not write');
    assert.strictEqual(metadataOf('0000'), undefined, 'an edit of a missing game conjured a METADATA row');
  });

  console.log('\nthe edit itself: narrow Update, mirrored where it must be\n');

  await acheck('a title edit is an UpdateCommand naming ONLY Title — never a Put', async () => {
    // rejects: the save-game-context revival — a whole-item Put that would
    // destroy ScoringConfig, AccessCode, Started, HostPreferences and the pin.
    const gameId = created.body.gameId;
    const before = structuredClone(metadataOf(gameId));
    const m = mark();
    quiet();
    const res = await putGame(gameId, { eventTitle: 'Renamed session' });
    loud();
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));

    const writes = writesIn(sentSince(m));
    assert(writes.every((w) => w.type === 'update'),
      `every write must be an Update, saw: ${writes.map((w) => w.type).join(', ')}`);

    const metadataWrite = writes.find((w) => w.key.PK === `GAME#${gameId}` && w.key.SK === 'METADATA');
    assert(metadataWrite, 'no UpdateCommand reached METADATA');
    assert.deepStrictEqual(
      Object.values(metadataWrite.input.ExpressionAttributeNames).sort(), ['Title'],
      'the expression must name ONLY the edited field');

    const after = metadataOf(gameId);
    assert.strictEqual(after.Title, 'Renamed session');
    assert.deepStrictEqual(after.ScoringConfig, before.ScoringConfig, 'ScoringConfig was clobbered');
    assert.strictEqual(after.AccessCode, before.AccessCode, 'AccessCode was clobbered');
    assert.strictEqual(after.Started, before.Started, 'Started was clobbered');
    assert.deepStrictEqual(after.HostPreferences, before.HostPreferences, 'HostPreferences was clobbered');
    assert.strictEqual(after.Details, before.Details, 'Details was clobbered');
  });

  await acheck('…and the Title is mirrored onto the GAMES index row', async () => {
    // rejects: forgetting the duplicate row — every session list would keep
    // showing the old title until the row's 90-day ttl deleted it.
    const gameId = created.body.gameId;
    const row = listRowOf(gameId);
    assert(row, 'the GAMES index row is missing entirely');
    assert.strictEqual(row.Title, 'Renamed session', 'the GAMES row still carries the old title');
    assert.strictEqual(row.Started, false, 'the mirror disturbed the rest of the index row');
  });

  await acheck('an edit that touches neither Title nor Visibility leaves the GAMES row alone', async () => {
    // rejects: an unconditional mirror — a second write per edit for fields
    // the index row does not carry.
    const gameId = created.body.gameId;
    const m = mark();
    quiet();
    const res = await putGame(gameId, { aiContext: 'Sharper context' });
    loud();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(metadataOf(gameId).AIContext, 'Sharper context');
    const gamesWrites = writesIn(sentSince(m)).filter((w) => w.key.PK === 'GAMES');
    assert.deepStrictEqual(gamesWrites, [], 'the GAMES row was written for a field it does not carry');
  });

  await acheck('a visibility edit is validated, applied, and mirrored', async () => {
    // rejects: free-form visibility (a typo silently unlists the session), and
    // a mirror that only knows about Title.
    const gameId = created.body.gameId;
    quiet();
    const bad = await putGame(gameId, { visibility: 'friends-only' });
    const good = await putGame(gameId, { visibility: 'public' });
    loud();
    assert.strictEqual(bad.status, 400, 'an unknown visibility must be refused');
    assert.strictEqual(good.status, 200);
    assert.strictEqual(metadataOf(gameId).Visibility, 'public');
    assert.strictEqual(listRowOf(gameId).Visibility, 'public', 'Visibility was not mirrored onto the GAMES row');
  });

  console.log('\nthe whitelist\n');

  await acheck('fields off the whitelist are ignored even when sent', async () => {
    // rejects: mass assignment — a handler that loops over body keys would
    // move QuestionSetId off the rows its CATEGORY#*#ORDER shuffles and
    // STATE#CATS were built from, rotate the AccessCode players already hold,
    // and flip Started without touching the STATE row.
    const gameId = created.body.gameId;
    const before = structuredClone(metadataOf(gameId));
    const m = mark();
    quiet();
    const res = await putGame(gameId, {
      eventTitle: 'Still just a rename',
      questionSetId: 'some-other-set',
      accessCode: '9999',
      started: true,
      gameType: 'poll',
      randomizeQuestions: false,
      ttl: 1,
    });
    loud();
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(Object.keys(res.body.updated), ['eventTitle'],
      'only the whitelisted field may be reported as applied');

    const after = metadataOf(gameId);
    assert.strictEqual(after.QuestionSetId, before.QuestionSetId, 'questionSetId leaked through');
    assert.strictEqual(after.AccessCode, before.AccessCode, 'accessCode leaked through');
    assert.strictEqual(after.Started, before.Started, 'started leaked through');
    assert.strictEqual(after.GameType, before.GameType, 'gameType leaked through');
    assert.deepStrictEqual(after.HostPreferences, before.HostPreferences, 'randomizeQuestions leaked through');
    assert.strictEqual(after.ttl, before.ttl, 'ttl leaked through');

    const metadataWrite = writesIn(sentSince(m)).find((w) => w.key.SK === 'METADATA');
    assert.deepStrictEqual(
      Object.values(metadataWrite.input.ExpressionAttributeNames).sort(), ['Title'],
      'the expression itself must not name unwhitelisted attributes');
  });

  await acheck('a body with nothing editable is a 400, not a silent no-op', async () => {
    // rejects: 200-ing an empty Update — the dialog would say "saved" about a
    // request that changed nothing — and issuing a fieldless UpdateCommand,
    // which real DynamoDB rejects.
    const gameId = created.body.gameId;
    const m = mark();
    quiet();
    const empty = await putGame(gameId, {});
    const unknownOnly = await putGame(gameId, { questionSetId: 'other', started: true });
    loud();
    assert.strictEqual(empty.status, 400);
    assert.strictEqual(unknownOnly.status, 400);
    assert.deepStrictEqual(writesIn(sentSince(m)), [], 'a rejected body must not write');
  });

  await acheck('a blank title is refused — every list and the live screen are named by it', async () => {
    quiet();
    const res = await putGame(created.body.gameId, { eventTitle: '   ' });
    loud();
    assert.strictEqual(res.status, 400);
    assert.strictEqual(metadataOf(created.body.gameId).Title, 'Still just a rename');
  });

  console.log('\nthe nested flag\n');

  await acheck('anonymousUntilReveal lands INSIDE HostPreferences, not top-level', async () => {
    // rejects: `SET AnonymousUntilReveal = :v` — a top-level attribute the
    // anonymity gate (game/anonymity.js) would never read, so the edit would
    // "save" and change nothing. Also rejects overwriting the whole map, which
    // would drop randomizeQuestions.
    const gameId = created.body.gameId;
    const before = structuredClone(metadataOf(gameId));
    quiet();
    const res = await putGame(gameId, { anonymousUntilReveal: false });
    loud();
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));

    const after = metadataOf(gameId);
    assert.strictEqual(after.HostPreferences.anonymousUntilReveal, false,
      'the flag did not reach HostPreferences.anonymousUntilReveal');
    assert.strictEqual(after.HostPreferences.randomizeQuestions,
      before.HostPreferences.randomizeQuestions, 'randomizeQuestions was dropped from the map');
    assert(!('anonymousUntilReveal' in after) && !('AnonymousUntilReveal' in after),
      'the flag was written top-level, where no reader looks');
  });

  await acheck('a non-boolean anonymousUntilReveal is refused', async () => {
    // rejects: coercion — the backend gate treats anything but explicit false
    // as ON, so "false" (a string) would silently mean on.
    quiet();
    const res = await putGame(created.body.gameId, { anonymousUntilReveal: 'false' });
    loud();
    assert.strictEqual(res.status, 400);
    assert.strictEqual(metadataOf(created.body.gameId).HostPreferences.anonymousUntilReveal, false);
  });

  await acheck('a legacy METADATA row with no HostPreferences map still takes the edit', async () => {
    // rejects: dropping the ensure-map step. Real DynamoDB refuses a nested
    // SET into a missing document path, so on any game created before
    // HostPreferences existed the edit would 500. The fake table emulates
    // that refusal (ValidationException) faithfully.
    quiet();
    const legacy = await createGame({ eventTitle: 'Legacy game', gameType: 'call-and-answer', questionSetId: 'set-a' });
    loud();
    const gameId = legacy.body.gameId;
    delete metadataOf(gameId).HostPreferences;

    quiet();
    const res = await putGame(gameId, { anonymousUntilReveal: false });
    loud();
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.deepStrictEqual(metadataOf(gameId).HostPreferences, { anonymousUntilReveal: false });
  });

  console.log('\npersona, matching the dedicated route\'s clear semantics\n');

  await acheck('a personaId is set, and \'\' removes the attribute rather than writing one', async () => {
    // rejects: writing PersonaId = '' on clear — "absent means adapt to the
    // session" is the convention every reader and the persona route share.
    const gameId = created.body.gameId;
    quiet();
    const set = await putGame(gameId, { personaId: 'comedian' });
    loud();
    assert.strictEqual(set.status, 200);
    assert.strictEqual(metadataOf(gameId).PersonaId, 'comedian');

    quiet();
    const clear = await putGame(gameId, { personaId: '' });
    loud();
    assert.strictEqual(clear.status, 200);
    assert(!('PersonaId' in metadataOf(gameId)), 'clearing left an empty PersonaId attribute behind');
  });

  console.log('\nwhat the edit dialog can prefill from GET ?role=host\n');

  await acheck('the host branch carries every prefill field, and still no accessCode', async () => {
    // rejects: an edit dialog that cannot seed its own form — and re-adding
    // accessCode to the public read path, whose removal get-game.js:79-92
    // documents as THE private-game control.
    const gameId = created.body.gameId;
    quiet();
    const res = await getGameHandler({
      pathParameters: { gameId },
      queryStringParameters: { role: 'host' },
    });
    loud();
    assert.strictEqual(res.statusCode, 200);
    const info = JSON.parse(res.body);
    assert.strictEqual(info.personaId, '', 'personaId missing from the host branch');
    assert.strictEqual(info.randomizeQuestions, true, 'randomizeQuestions missing from the host branch');
    assert.strictEqual(info.visibility, 'public');
    assert.strictEqual(info.anonymousUntilReveal, false);
    assert.strictEqual(info.details, 'Original details');
    assert.strictEqual(info.aiContext, 'Sharper context');
    assert(!('accessCode' in info), 'accessCode came back — get-game.js:79-92 records why it must not');
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('harness error:', e); process.exit(1); });
