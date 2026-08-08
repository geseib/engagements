/**
 * Bulk-delete regression tests for the OTHER two admin lambdas that share the
 * defect class fixed in delete-question-set.js:
 *
 *   lambda-functions/admin/delete-game.js       — un-paginated Query + dropped UnprocessedItems
 *   lambda-functions/admin/clear-all-games.js   — paginated Scan, but dropped UnprocessedItems
 *
 * Both now route through lambda-functions/admin/shared/ddb-delete.js.
 * See tests/delete-question-set-flow.js for the primary suite.
 *
 * Stubbing follows tests/ai-prompt-resolution.js: hook Module._load BY MODULE
 * NAME, never require.cache by resolved path.
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

class GetCommand { constructor(i) { this.input = i; this.type = 'get'; } }
class PutCommand { constructor(i) { this.input = i; this.type = 'put'; } }
class DeleteCommand { constructor(i) { this.input = i; this.type = 'delete'; } }
class QueryCommand { constructor(i) { this.input = i; this.type = 'query'; } }
class ScanCommand { constructor(i) { this.input = i; this.type = 'scan'; } }
class UpdateCommand { constructor(i) { this.input = i; this.type = 'update'; } }
class BatchWriteCommand { constructor(i) { this.input = i; this.type = 'batchWrite'; } }

const TABLE = 'test-table';

const store = new Map();
const log = [];
let queryPageSize = Infinity;
let deferOnce = new Set();

function resetDb() {
  store.clear(); log.length = 0; queryPageSize = Infinity; deferOnce = new Set();
}
const k = (pk, sk) => `${pk}|${sk}`;
const put = (item) => store.set(k(item.PK, item.SK), item);

// Stable ordering for both Query and Scan paging.
const sorted = (items) => items.sort((a, b) =>
  String(a.PK).localeCompare(String(b.PK)) || String(a.SK).localeCompare(String(b.SK)));

const cmp = (a, b) =>
  String(a.PK).localeCompare(String(b.PK)) || String(a.SK).localeCompare(String(b.SK));

function page(items, exclusiveStartKey, limit) {
  let rest = items;
  if (exclusiveStartKey) {
    // ExclusiveStartKey is a POSITION, not a lookup: DynamoDB resumes after it
    // whether or not that row still exists. clear-all-games deletes as it
    // scans, so the cursor row is routinely already gone.
    rest = rest.filter((i) => cmp(i, exclusiveStartKey) > 0);
  }
  const out = rest.slice(0, limit);
  const more = rest.length > out.length;
  const res = { Items: out.map((i) => ({ ...i })), Count: out.length };
  if (more) {
    const last = out[out.length - 1];
    res.LastEvaluatedKey = { PK: last.PK, SK: last.SK };
  }
  return res;
}

const fakeDoc = {
  send: async (cmd) => {
    const inp = cmd.input || {};
    log.push({ type: cmd.type, input: inp });

    if (cmd.type === 'get') return { Item: store.get(k(inp.Key.PK, inp.Key.SK)) };
    if (cmd.type === 'delete') { store.delete(k(inp.Key.PK, inp.Key.SK)); return {}; }

    if (cmd.type === 'query') {
      const v = inp.ExpressionAttributeValues || {};
      const pk = v[':setpk'] !== undefined ? v[':setpk'] : v[':pk'];
      const items = sorted([...store.values()].filter((i) => i.PK === pk));
      return page(items, inp.ExclusiveStartKey, queryPageSize);
    }

    if (cmd.type === 'scan') {
      const items = sorted([...store.values()]);
      return page(items, inp.ExclusiveStartKey, inp.Limit || queryPageSize);
    }

    if (cmd.type === 'batchWrite') {
      const reqs = (inp.RequestItems && inp.RequestItems[TABLE]) || [];
      if (reqs.length > 25) throw new Error(`BatchWrite over the 25-item limit: ${reqs.length}`);
      if (reqs.length === 0) throw new Error('BatchWrite with an empty request list is rejected');
      const unprocessed = [];
      for (const r of reqs) {
        const key = k(r.DeleteRequest.Key.PK, r.DeleteRequest.Key.SK);
        if (deferOnce.has(key)) { deferOnce.delete(key); unprocessed.push(r); continue; }
        store.delete(key);
      }
      return unprocessed.length
        ? { UnprocessedItems: { [TABLE]: unprocessed } }
        : { UnprocessedItems: {} };
    }
    return { Items: [], Count: 0 };
  },
};

stub('@aws-sdk/client-dynamodb', { DynamoDBClient: class {} });
stub('@aws-sdk/lib-dynamodb', {
  DynamoDBDocumentClient: { from: () => fakeDoc },
  GetCommand, PutCommand, DeleteCommand, QueryCommand,
  ScanCommand, UpdateCommand, BatchWriteCommand,
});

process.env.TABLE_NAME = TABLE;
process.env.DELETE_RETRY_BASE_MS = '1';

const deleteGame = require(path.join(REPO, 'lambda-functions', 'admin', 'delete-game.js'));
const clearAll = require(path.join(REPO, 'lambda-functions', 'admin', 'clear-all-games.js'));

if (!process.env.DEBUG) { console.log = () => {}; console.error = () => {}; }
const say = (...a) => process.stdout.write(a.join(' ') + '\n');

const rowsIn = (pk) => [...store.values()].filter((i) => i.PK === pk);
const parse = (res) => JSON.parse(res.body);

function seedGame(gameId, { players = 10, responses = 30 } = {}) {
  put({ PK: 'GAMES', SK: `GAME#${gameId}`, gameId });
  put({ PK: `GAME#${gameId}`, SK: 'META', gameId });
  for (let p = 0; p < players; p++) put({ PK: `GAME#${gameId}`, SK: `PLAYER#${p}` });
  for (let r = 0; r < responses; r++) {
    put({ PK: `GAME#${gameId}`, SK: `RESPONSE#${String(r).padStart(3, '0')}` });
  }
}

let pass = 0, fail = 0;
function check(label, fn) {
  try { fn(); say(`  PASS  ${label}`); pass++; }
  catch (e) { say(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

(async () => {
  say('admin bulk delete: delete-game.js and clear-all-games.js\n');

  // --- delete-game.js -------------------------------------------------------
  resetDb();
  seedGame('4242', { players: 40, responses: 120 });
  seedGame('9999', { players: 5, responses: 5 });
  queryPageSize = 50;                       // 161 rows => 4 pages
  {
    const before = rowsIn('GAME#4242').length;
    const res = await deleteGame.handler({ pathParameters: { gameId: '4242' } });
    check('delete-game returns 200', () => assert.strictEqual(res.statusCode, 200, res.body));
    check('delete-game follows LastEvaluatedKey', () =>
      assert(log.filter((c) => c.type === 'query').length >= 4,
        `only ${log.filter((c) => c.type === 'query').length} Query call(s) for ${before} rows`));
    check('delete-game leaves no orphan rows', () =>
      assert.strictEqual(rowsIn('GAME#4242').length, 0,
        `${rowsIn('GAME#4242').length} of ${before} rows orphaned`));
    check('delete-game removes the GAMES index row', () =>
      assert.strictEqual(store.get('GAMES|GAME#4242'), undefined));
    check('delete-game reports the confirmed count', () =>
      assert.strictEqual(parse(res).itemsDeleted, before + 1,
        `reported ${parse(res).itemsDeleted}, expected ${before + 1}`));
    check('delete-game does not touch a neighbouring game', () =>
      assert.strictEqual(rowsIn('GAME#9999').length, 11,
        `neighbour lost rows: ${rowsIn('GAME#9999').length} of 11`));
  }

  resetDb();
  seedGame('7777', { players: 10, responses: 40 });
  {
    deferOnce = new Set(['GAME#7777|RESPONSE#012', 'GAME#7777|PLAYER#3']);
    const res = await deleteGame.handler({ pathParameters: { gameId: '7777' } });
    check('delete-game retries UnprocessedItems rather than dropping them', () =>
      assert(res.statusCode === 200 && rowsIn('GAME#7777').length === 0,
        `status=${res.statusCode} left=${rowsIn('GAME#7777').length}`));
  }

  // --- clear-all-games.js ---------------------------------------------------
  resetDb();
  seedGame('1111', { players: 8, responses: 20 });
  seedGame('2222', { players: 8, responses: 20 });
  // Question sets must survive a game wipe.
  put({ PK: 'SETS', SK: 'SET#keepme', name: 'Keep Me' });
  put({ PK: 'SET#keepme', SK: 'QUESTION#c0#001', Title: 'Q1' });
  {
    deferOnce = new Set(['GAME#1111|RESPONSE#005', 'GAME#2222|PLAYER#2']);
    const res = await clearAll.handler({});
    check('clear-all-games returns 200', () => assert.strictEqual(res.statusCode, 200, res.body));
    check('clear-all-games retries UnprocessedItems rather than dropping them', () => {
      const left = rowsIn('GAME#1111').length + rowsIn('GAME#2222').length;
      assert.strictEqual(left, 0, `${left} game rows silently survived as UnprocessedItems`);
    });
    check('clear-all-games clears the GAMES index', () =>
      assert.strictEqual(rowsIn('GAMES').length, 0));
    check('clear-all-games preserves question sets', () => {
      assert(store.get('SETS|SET#keepme'), 'set metadata was wiped');
      assert(store.get('SET#keepme|QUESTION#c0#001'), 'set questions were wiped');
    });
    check('the reported count is confirmed deletes only', () =>
      assert.strictEqual(parse(res).itemsDeleted, 60,   // 2 games x (1 meta + 8 players + 20 responses) + 2 index rows
        `reported ${parse(res).itemsDeleted}, expected 60`));
  }

  say(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { process.stdout.write(`harness error: ${e && e.stack}\n`); process.exit(1); });
