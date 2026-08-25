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
        // attribute_not_exists(PK) is the id-reservation lock (issue #26) —
        // honour it, or the collision tests test a fake that cannot collide.
        if (/attribute_not_exists\(PK\)/.test(inp.ConditionExpression || '')
            && store.has(key(inp.Item.PK, inp.Item.SK))) {
          throw conditionalFailure();
        }
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
      case 'transact': {
        /*
          Item-by-item through the same engine. Atomicity is NOT emulated —
          these tests assert final state, never isolation — but the items must
          actually APPLY: this case was missing, the default arm returned {}
          for every TransactWriteCommand, and toggle-category's whole write
          (two Updates in one transaction) vanished silently. A handler under
          test 200'd without changing a single row, and the first assertion
          about its effect is what caught it.
        */
        for (const t of inp.TransactItems || []) {
          if (t.Put) await fakeDoc.send({ type: 'put', input: t.Put });
          if (t.Update) await fakeDoc.send({ type: 'update', input: t.Update });
          if (t.Delete) await fakeDoc.send({ type: 'delete', input: t.Delete });
        }
        return {};
      }
      default:
        return { Items: [], Count: 0 };
    }
  },
};

// ── TENANT CRYPTO ──────────────────────────────────────────────────────────
// The handlers this suite drives now encrypt org content, and tenant-crypto
// THROWS on an org with no data key rather than quietly writing plaintext. The
// shared stub refuses a Decrypt with a missing or mismatched encryption context,
// exactly as the key policy will, so this does not weaken anything here.
// Org rows are envelopes at rest since tenancy. `plainRow` unwraps them with
// the real cipher so the assertions below stay about CONTENT — and it is
// synchronous, so a suite that is not about encryption needs no new awaits.
const { makeKmsStub, installTestKeyLoader, plainRow } = require('./helpers/tenant-crypto-stub');
const kmsStub = makeKmsStub();
stub('@aws-sdk/client-kms', kmsStub.exports);
// Every org gets a deterministic data key, no ORG#<id>/METADATA row needed —
// otherwise every reset() in this file would have to re-seed one.
installTestKeyLoader();
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
// ── TENANCY: a session belongs to an organisation ──────────────────────────
//
// `POST /games` now carries the Cognito authorizer and `createGame` reads the
// caller's org from the context, so every fixture here creates its session AS
// somebody. Without a context the session is created unowned, no org index row
// is written, and every mirror assertion below has nothing to look at.
//
// One org for the whole file: this suite is about editing a session, not about
// tenancy, and giving every row the same org keeps it that way.
const ORG = 'org_nw';
const asOrg = (extra = {}) => ({
  ...extra,
  requestContext: { authorizer: { lambda: { orgId: ORG, orgRole: 'admin', groups: 'hosts' } } },
});

const createGame = async (body) => {
  const res = await createGameHandler(asOrg({ body: JSON.stringify(body) }));
  return { status: res.statusCode, body: JSON.parse(res.body) };
};
const putGame = async (gameId, body) => {
  const res = await updateGameHandler(asOrg({
    pathParameters: { gameId },
    body: JSON.stringify(body),
  }));
  return { status: res.statusCode, body: JSON.parse(res.body) };
};

// DECRYPTED. A session's Title / HostName / Details / AIContext are envelopes
// at rest — the same two strings the report row already encrypted, which is why
// they were added to the boundary.
const metadataOf = (gameId) => plainRow(ORG, store.get(key(`GAME#${gameId}`, 'METADATA')));
// THE RAW ROW, for the two tests that MUTATE a fixture rather than read it.
// `metadataOf` decrypts, and decrypting builds a new object — so
// `delete metadataOf(id).HostPreferences` edits a copy and the store never
// changes. That silently turned a "legacy row with no map" fixture into an
// ordinary one, and the test failed on the map it was trying to remove.
const rawMetadataOf = (gameId) => store.get(key(`GAME#${gameId}`, 'METADATA'));
// The row a host LISTS. It moved out of the single global `GAMES` partition and
// into the org's own, so that `GET /games` cannot Query another team's sessions
// at all — the isolation is the shape of the query, not a filter after it.
const listRowOf = (gameId) => plainRow(ORG, store.get(key(`ORG#${ORG}#GAMES`, `GAME#${gameId}`)));
// What is LEFT in the global partition: the code reservation, and nothing else.
// It is the uniqueness lock for the 4-digit code a participant types with no
// idea which organisation it belongs to.
const reservationOf = (gameId) => store.get(key('GAMES', `GAME#${gameId}`));
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
    delete rawMetadataOf(gameId).HostPreferences;

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

  loud();
  console.log('\ncategories: the enabled subset is editable; the set is not\n');

  /*
    A REAL SET WITH REAL MASKS. The categories live in the SET# partition (in
    SK order — that order IS the bit-position convention), and the game is
    created through the real create handler so its STATE#CATS row is the one
    schema-compliant-manager actually writes. A hand-built mask fixture here
    would test my idea of the convention against my idea of the convention.
  */
  quiet();
  const CATS = ['Alpha', 'Bravo', 'Charlie', 'Delta'];
  CATS.forEach((name, i) => {
    store.set(key('SET#set-cats', `CATEGORY#c00${i + 1}`), {
      PK: 'SET#set-cats', SK: `CATEGORY#c00${i + 1}`, Name: name, QuestionCount: 5,
    });
    /*
      REAL QUESTION ROWS, not just a QuestionCount attribute. create's counts
      row is built from a per-category Query over these — an earlier version of
      this fixture carried only the attribute, create wrote all-zero counts,
      and the edit-then-start tests below reported "no questions left" against
      a healthy write path. The fixture was reproducing the symptom the tests
      exist to catch, from the other side.
    */
    for (let q = 1; q <= 5; q += 1) {
      store.set(key('SET#set-cats', `QUESTION#c00${i + 1}#00${q}`), {
        PK: 'SET#set-cats', SK: `QUESTION#c00${i + 1}#00${q}`,
        Category: name, Title: `${name} ${q}`,
      });
    }
  });
  const catGame = await createGame({
    eventTitle: 'Category session', gameType: 'call-and-answer',
    questionSetId: 'set-cats', selectedCategories: ['c001', 'c002', 'c003', 'c004'],
  });
  const CG = catGame.body.gameId;
  loud();

  const catsRowOf = (id) => store.get(key(`GAME#${id}`, 'STATE#CATS'));

  await acheck('the fixture is honest: create wrote all-enabled masks', async () => {
    // If this fails, the test environment diverged from create's real output
    // and every assertion below would be exercising a fiction.
    assert.strictEqual(catsRowOf(CG)['HostMask1-8'], '11110000');
  });

  await acheck('deselecting categories rewrites the HostMask bits', async () => {
    const res = await putGame(CG, { categoryIds: ['c001', 'c003'] });
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    // Bits are POSITIONAL in SK order: c001 -> bit 1, c003 -> bit 3.
    assert.strictEqual(catsRowOf(CG)['HostMask1-8'], '10100000');
  });

  await acheck('…and SelectedCategories on METADATA agrees with the masks', async () => {
    // Two representations of one fact; an edit that moves only one of them
    // leaves the next reader to discover which is lying.
    assert.deepStrictEqual(metadataOf(CG).SelectedCategories, ['c001', 'c003']);
  });

  await acheck('category NAMES are accepted and normalised to ids', async () => {
    // Both spellings are live in stored sessions — create itself matches
    // id-or-name — so the edit path must too, and must store ONE of them.
    const res = await putGame(CG, { categoryIds: ['Bravo', 'Delta'] });
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(catsRowOf(CG)['HostMask1-8'], '01010000');
    assert.deepStrictEqual(metadataOf(CG).SelectedCategories, ['c002', 'c004']);
  });

  await acheck('an empty list is refused — a session with no questions is not a thing to save', async () => {
    const before = catsRowOf(CG)['HostMask1-8'];
    const res = await putGame(CG, { categoryIds: [] });
    assert.strictEqual(res.status, 400, JSON.stringify(res.body));
    assert.strictEqual(catsRowOf(CG)['HostMask1-8'], before, 'the refusal still wrote');
  });

  await acheck('a list that misses the set entirely is refused, not saved as nothing-enabled', async () => {
    // A stale tab holding another set's ids. The open-enum failure would be a
    // 200 with every bit cleared and a session that silently has no questions.
    const before = catsRowOf(CG)['HostMask1-8'];
    const res = await putGame(CG, { categoryIds: ['zulu-1', 'zulu-2'] });
    assert.strictEqual(res.status, 400, JSON.stringify(res.body));
    assert.strictEqual(catsRowOf(CG)['HostMask1-8'], before);
  });

  await acheck('categories combine with ordinary fields in one PUT', async () => {
    const res = await putGame(CG, { eventTitle: 'Renamed with cats', categoryIds: ['c001'] });
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(metadataOf(CG).Title, 'Renamed with cats');
    assert.strictEqual(catsRowOf(CG)['HostMask1-8'], '10000000');
  });

  await acheck('a set with no categories at all refuses every id as unknown', async () => {
    // 'set-none' has no CATEGORY# rows, so any id misses and the no-match 400
    // fires before the mask write is even staged. (A first draft of this test
    // claimed to cover the missing-STATE#CATS 409 and actually covered this —
    // the 400 arrives earlier in the handler, so the 409 needs the NEXT test,
    // where the set is real and only the game's row is missing.)
    quiet();
    const legacy = await createGame({
      eventTitle: 'Legacy session', gameType: 'call-and-answer', questionSetId: 'set-none',
    });
    loud();
    const res = await putGame(legacy.body.gameId, { categoryIds: ['c001'] });
    assert.strictEqual(res.status, 400, JSON.stringify(res.body));
  });

  await acheck('a session whose STATE#CATS row is missing is a 409, not a conjured row', async () => {
    // The true legacy shape: the SET is fine, the GAME predates category
    // state. The masks write is conditioned on the row existing — refusing
    // beats creating a bare item without the counts every reader expects.
    quiet();
    const preCats = await createGame({
      eventTitle: 'Pre-cats session', gameType: 'call-and-answer',
      questionSetId: 'set-cats', selectedCategories: ['c001'],
    });
    loud();
    const preId = preCats.body.gameId;
    store.delete(key(`GAME#${preId}`, 'STATE#CATS'));

    const res = await putGame(preId, { categoryIds: ['c001'] });
    assert.strictEqual(res.status, 409, JSON.stringify(res.body));
    assert.strictEqual(store.get(key(`GAME#${preId}`, 'STATE#CATS')), undefined,
      'the refusal conjured a STATE#CATS row');
  });

  loud();
  console.log('\ntoggle-category: CREATED is a state a host can set up in\n');

  const toggleHandler = require(path.join(REPO, 'lambda-functions', 'game', 'toggle-category.js')).handler;
  const toggle = async (gameId, body) => {
    const res = await toggleHandler({ pathParameters: { gameId }, body: JSON.stringify(body) });
    return { status: res.statusCode, body: JSON.parse(res.body) };
  };

  await acheck('a CREATED session takes a category toggle', async () => {
    /*
      Reported: "going to the session/questions tab appears to let you edit
      categories but it says you cannot. I think you should be able to."
      The gate listed STARTED/ASK/VOTE/RESULTS and simply never considered
      pre-start. Nothing downstream cares — the toggle flips HostMask bits on
      STATE#CATS, which exists from create time, and start does not rebuild it.
    */
    quiet();
    const fresh = await createGame({
      eventTitle: 'Pre-start toggling', gameType: 'call-and-answer',
      questionSetId: 'set-cats', selectedCategories: ['c001', 'c002', 'c003', 'c004'],
    });
    loud();
    const freshId = fresh.body.gameId;
    assert.strictEqual(store.get(key(`GAME#${freshId}`, 'STATE')).State, 'CREATED',
      'fixture is not in CREATED — the test would prove nothing');

    quiet();
    const res = await toggle(freshId, { categoryId: '2', categoryName: 'Bravo', enabled: false });
    loud();
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(catsRowOf(freshId)['HostMask1-8'], '10110000',
      `bit 2 should be the one that cleared, got ${JSON.stringify(catsRowOf(freshId))}`);
  });

  await acheck('an ENDED session still refuses one', async () => {
    // The masks of a finished session are part of its record.
    quiet();
    const done = await createGame({
      eventTitle: 'Finished', gameType: 'call-and-answer',
      questionSetId: 'set-cats', selectedCategories: ['c001'],
    });
    loud();
    const doneId = done.body.gameId;
    const stateRow = store.get(key(`GAME#${doneId}`, 'STATE'));
    stateRow.State = 'ENDED';
    quiet();
    const res = await toggle(doneId, { categoryId: '1', categoryName: 'Alpha', enabled: false });
    loud();
    assert.strictEqual(res.status, 400, JSON.stringify(res.body));
  });

  loud();
  console.log('\nthe reported corruption: edit, then start, then count what is left\n');

  /*
    Reported: "if you attempt to edit the session, it appears to mess up the
    questions/categories for that session, so when you start there are no
    categories, and no questions left."

    These pin the SERVER's half of that journey — create with a real set, edit
    (title-only, then categories), start, and then read back everything the
    stage reads: the HostMasks, SelectedCategories, and the counts row the
    "questions left" number comes from. If these stay green the corruption is
    not in the write path, and the bug hunt moves to the client.
  */
  await acheck('edit title only, then start: masks, selection and counts all survive', async () => {
    quiet();
    const g = await createGame({
      eventTitle: 'Edit-then-start', gameType: 'call-and-answer',
      questionSetId: 'set-cats', selectedCategories: ['c001', 'c003'],
    });
    const id = g.body.gameId;
    await putGame(id, { eventTitle: 'Renamed before start' });
    await startGameHandler({ pathParameters: { gameId: id } });
    loud();

    assert.strictEqual(store.get(key(`GAME#${id}`, 'STATE')).State, 'STARTED');
    assert.strictEqual(catsRowOf(id)['HostMask1-8'], '10100000',
      'the masks the host chose at create did not survive an unrelated edit');
    const counts = store.get(key(`GAME#${id}`, 'STATE#CATS#COUNTS'));
    assert.ok(counts && counts.TotalRemaining > 0,
      `no questions left after an edit: ${JSON.stringify(counts)}`);
  });

  await acheck('edit CATEGORIES, then start: the new masks hold and questions remain', async () => {
    quiet();
    const g = await createGame({
      eventTitle: 'Recategorised', gameType: 'call-and-answer',
      questionSetId: 'set-cats', selectedCategories: ['c001', 'c002', 'c003', 'c004'],
    });
    const id = g.body.gameId;
    // The dialog sends NAMES (its grid keys on them); the round trip must
    // normalise and land without touching the counts.
    await putGame(id, { eventTitle: 'Renamed too', categoryIds: ['Alpha', 'Charlie'] });
    await startGameHandler({ pathParameters: { gameId: id } });
    loud();

    assert.strictEqual(catsRowOf(id)['HostMask1-8'], '10100000');
    assert.deepStrictEqual(metadataOf(id).SelectedCategories, ['c001', 'c003']);
    const counts = store.get(key(`GAME#${id}`, 'STATE#CATS#COUNTS'));
    assert.ok(counts && counts.TotalRemaining > 0,
      `no questions left after a category edit: ${JSON.stringify(counts)}`);
    // AvailMask is "which categories HAVE questions" and no edit may touch it.
    assert.strictEqual(catsRowOf(id)['AvailMask1-8'], '11110000');
  });

  loud();
  console.log('\nthe 4-digit id cannot silently take over a living session (issue #26)\n');

  /*
    THE REPORTED LOSS, END TO END. "if you attempt to edit the session, it
    appears to mess up the questions/categories... when you start there are no
    categories, and no questions left" — and, the clincher — "it appears to be
    missing from history now."

    The mechanism was never the edit: create drew a random 4-digit id with NO
    uniqueness check and nine blind Puts, so a later create that drew a living
    session's id overwrote it row by row — new set, new masks, and a new title
    on the GAMES index row, which is exactly "missing from history". The edit
    correlated only because heavy edit-and-test days are heavy CREATE days.
  */
  const purge = (id) => {
    for (const k of [...store.keys()]) {
      // BOTH pointer rows. Since tenancy a session has two: the global 4-digit
      // code reservation, and the brief in its org's own index. Purging only
      // the first leaves a stale brief behind and the next draw inherits it.
      if (k.startsWith(`GAME#${id}|`)
        || k === key('GAMES', `GAME#${id}`)
        || k === key(`ORG#${ORG}#GAMES`, `GAME#${id}`)) store.delete(k);
    }
  };
  const realRandom = Math.random;

  await acheck('a colliding draw retries, and BOTH sessions survive intact', async () => {
    purge('1900'); purge('5500');
    // 0.1 -> id 1900 twice (the collision), then 0.5 -> 5500. The fixed tail
    // keeps any further draw deterministic.
    const seq = [0.1, 0.1, 0.5];
    let call = 0;
    Math.random = () => seq[Math.min(call++, seq.length - 1)];
    try {
      quiet();
      const original = await createGame({
        eventTitle: 'The original', gameType: 'call-and-answer',
        questionSetId: 'set-cats', selectedCategories: ['c001'],
      });
      const newcomer = await createGame({
        eventTitle: 'The newcomer', gameType: 'call-and-answer',
        questionSetId: 'set-cats', selectedCategories: ['c002'],
      });
      loud();

      assert.strictEqual(original.body.gameId, '1900');
      assert.strictEqual(newcomer.status, 201, JSON.stringify(newcomer.body));
      assert.notStrictEqual(newcomer.body.gameId, '1900',
        'the collision was not detected — the newcomer took the living id');

      // The original is UNTOUCHED — this is the exact loss that was reported.
      //
      // Checked on the ORG INDEX row, which is where the brief lives since
      // tenancy; the global `GAMES` row is now the code reservation and carries
      // {orgId, ttl} only. Both halves are asserted, because the failure this
      // test was written for could now happen in two places: the lock could
      // fail to hold the code, or the brief could be overwritten.
      assert.strictEqual(listRowOf('1900').Title, 'The original',
        'the history row now belongs to the newcomer: "missing from history"');
      assert.ok(reservationOf('1900'), 'the code reservation was released by the collision');
      assert.strictEqual(reservationOf('1900').orgId, ORG,
        'the reservation stopped naming the org that holds the code');
      assert.strictEqual(catsRowOf('1900')['HostMask1-8'], '10000000',
        'the original\'s category masks were overwritten');
      assert.strictEqual(metadataOf('1900').Title, 'The original');
    } finally {
      Math.random = realRandom;
    }
  });

  await acheck('an exhausted id space is an honest 503, never a lucky overwrite', async () => {
    // Every draw lands on the id the previous test left living.
    Math.random = () => 0.1;
    try {
      quiet();
      const res = await createGame({
        eventTitle: 'Cannot fit', gameType: 'call-and-answer', questionSetId: 'set-cats',
      });
      loud();
      assert.strictEqual(res.status, 503, JSON.stringify(res.body));
      assert.strictEqual(listRowOf('1900').Title, 'The original',
        'the give-up path still overwrote the living session');
    } finally {
      Math.random = realRandom;
    }
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('harness error:', e); process.exit(1); });
