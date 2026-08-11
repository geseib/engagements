/**
 * Question-set DELETE regression tests — lambda-functions/admin/delete-question-set.js
 *
 * Runs the REAL handler against a stubbed DynamoDB document client that can
 * reproduce the three things the live table actually does to this code path:
 *
 *   1. cap a Query at 1 MB and hand back a LastEvaluatedKey (the biggest live
 *      set is 160 questions, comfortably able to spill a page)
 *   2. return UnprocessedItems from a BatchWrite under throttling
 *   3. fail partway through
 *
 * Stubbing follows tests/ai-prompt-resolution.js and tests/import-questions-flow.js:
 * hook Module._load BY MODULE NAME. The require.cache-by-resolved-path trick in
 * art-title-flow.js silently misses, because several @aws-sdk packages exist
 * only in the deployed bundle and cannot be resolved from the repo root.
 *
 * Key schema under test (see docs/handoff/admin-prompt-cleanup-plan.md §C):
 *   index/metadata row : PK 'SETS'         SK 'SET#<id>'
 *   question rows      : PK 'SET#<id>'     SK 'QUESTION#<cat>#<nnn>'
 *   category rows      : PK 'SET#<id>'     SK 'CATEGORY#<cat>'
 * Metadata lives in a DIFFERENT partition from its content, so "delete" is two
 * operations that must be ordered so a partial failure never leaves a
 * browsable set pointing at missing questions.
 */
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');

// ---- Stub the AWS SDK before the handler loads -----------------------------
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

// ---- fake single-table DynamoDB -------------------------------------------
const store = new Map();        // "PK|SK" -> Item
const log = [];                 // every command the handler issued

let queryPageSize = Infinity;   // items per Query page; smaller => forces pagination
let deferOnce = new Set();      // "PK|SK" returned as UnprocessedItems exactly once
let deferAlways = new Set();    // "PK|SK" returned as UnprocessedItems forever
let failWriteWhen = null;       // (key) => bool ; throw from the batch containing it

function resetDb() {
  store.clear();
  log.length = 0;
  queryPageSize = Infinity;
  deferOnce = new Set();
  deferAlways = new Set();
  failWriteWhen = null;
}
const k = (pk, sk) => `${pk}|${sk}`;
const put = (item) => store.set(k(item.PK, item.SK), item);

const fakeDoc = {
  send: async (cmd) => {
    const inp = cmd.input || {};
    log.push({ type: cmd.type, input: inp });

    if (cmd.type === 'get') {
      return { Item: store.get(k(inp.Key.PK, inp.Key.SK)) };
    }

    if (cmd.type === 'delete') {
      if (failWriteWhen && failWriteWhen(k(inp.Key.PK, inp.Key.SK))) {
        throw new Error('simulated Dynamo failure (delete)');
      }
      store.delete(k(inp.Key.PK, inp.Key.SK));
      return {};
    }

    if (cmd.type === 'query') {
      const v = inp.ExpressionAttributeValues || {};
      const pk = v[':setpk'] !== undefined ? v[':setpk'] : v[':pk'];
      let items = [...store.values()]
        .filter((i) => i.PK === pk)
        .sort((a, b) => String(a.SK).localeCompare(String(b.SK)));

      if (inp.ExclusiveStartKey) {
        // ExclusiveStartKey is a POSITION, not a lookup: DynamoDB resumes
        // after it whether or not that row still exists.
        const esk = inp.ExclusiveStartKey;
        items = items.filter((i) =>
          (String(i.PK).localeCompare(String(esk.PK)) || String(i.SK).localeCompare(String(esk.SK))) > 0);
      }

      const page = items.slice(0, queryPageSize);
      const more = items.length > page.length;
      const out = { Items: page.map((i) => ({ ...i })), Count: page.length };
      if (more) {
        const last = page[page.length - 1];
        out.LastEvaluatedKey = { PK: last.PK, SK: last.SK };   // 1 MB cap, exactly like the real thing
      }
      return out;
    }

    if (cmd.type === 'batchWrite') {
      const reqs = (inp.RequestItems && inp.RequestItems[TABLE]) || [];
      if (reqs.length > 25) {
        throw new Error(`BatchWrite over the 25-item DynamoDB limit: ${reqs.length}`);
      }
      if (reqs.length === 0) {
        throw new Error('BatchWrite with an empty request list is rejected by DynamoDB');
      }
      const unprocessed = [];
      for (const r of reqs) {
        const key = r.DeleteRequest
          ? k(r.DeleteRequest.Key.PK, r.DeleteRequest.Key.SK)
          : k(r.PutRequest.Item.PK, r.PutRequest.Item.SK);

        if (failWriteWhen && failWriteWhen(key)) {
          throw new Error('simulated Dynamo failure (batchWrite)');
        }
        if (deferAlways.has(key)) { unprocessed.push(r); continue; }
        if (deferOnce.has(key)) { deferOnce.delete(key); unprocessed.push(r); continue; }

        if (r.DeleteRequest) store.delete(key);
        else put(r.PutRequest.Item);
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
process.env.DELETE_RETRY_BASE_MS = '1';   // keep backoff out of the wall clock

const { handler } = require(path.join(REPO, 'lambda-functions', 'admin', 'delete-question-set.js'));

if (!process.env.DEBUG) { console.log = () => {}; console.error = () => {}; }
const say = (...a) => process.stdout.write(a.join(' ') + '\n');

// ---- helpers ---------------------------------------------------------------
const invoke = (setId) => handler({ pathParameters: setId === undefined ? {} : { setId } });
const parse = (res) => JSON.parse(res.body);

function seedSet(setId, { questions = 3, categories = 1, name = setId } = {}) {
  put({ PK: 'SETS', SK: `SET#${setId}`, id: setId, name, questionCount: questions });
  for (let c = 0; c < categories; c++) {
    put({ PK: `SET#${setId}`, SK: `CATEGORY#c${c}`, Name: `Category ${c}` });
  }
  for (let q = 0; q < questions; q++) {
    put({
      PK: `SET#${setId}`,
      SK: `QUESTION#c${q % Math.max(categories, 1)}#${String(q + 1).padStart(3, '0')}`,
      Title: `Q${q + 1}`, Active: true,
    });
  }
}

const rowsIn = (pk) => [...store.values()].filter((i) => i.PK === pk);
const indexRow = (setId) => store.get(k('SETS', `SET#${setId}`));
const cmds = (type) => log.filter((c) => c.type === type);
const batchSizes = () => cmds('batchWrite')
  .map((c) => ((c.input.RequestItems && c.input.RequestItems[TABLE]) || []).length);
// Every write the handler issued, in order, as "type:PK|SK" — for ordering proofs.
function writeOrder() {
  const out = [];
  for (const c of log) {
    if (c.type === 'delete') out.push(`delete:${k(c.input.Key.PK, c.input.Key.SK)}`);
    if (c.type === 'batchWrite') {
      for (const r of (c.input.RequestItems && c.input.RequestItems[TABLE]) || []) {
        if (r.DeleteRequest) out.push(`batch:${k(r.DeleteRequest.Key.PK, r.DeleteRequest.Key.SK)}`);
      }
    }
  }
  return out;
}

let pass = 0, fail = 0;
function check(label, fn) {
  try { fn(); say(`  PASS  ${label}`); pass++; }
  catch (e) { say(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

(async () => {
  say('delete-question-set: completeness, retry and ordering\n');

  // 1. Argument guard ---------------------------------------------------------
  resetDb();
  {
    const res = await invoke(undefined);
    check('a missing setId is a 400, not a crash', () =>
      assert.strictEqual(res.statusCode, 400, res.body));
  }

  // 2. Deleting something that is not there -----------------------------------
  resetDb();
  seedSet('other', { questions: 4 });
  {
    const res = await invoke('ghostset');
    check('a non-existent set returns a clean 404', () =>
      assert.strictEqual(res.statusCode, 404, res.body));
    check('a 404 issues no writes at all', () => {
      const writes = log.filter((c) => c.type !== 'get' && c.type !== 'query');
      assert.strictEqual(writes.length, 0,
        `${writes.length} write(s) issued for a set that does not exist: ${writes.map((w) => w.type).join(', ')}`);
    });
  }

  // 3. Small set, single Query page — the happy path ---------------------------
  resetDb();
  seedSet('smallset', { questions: 3, categories: 2, name: 'Small Set' });
  {
    const res = await invoke('smallset');
    check('a small set deletes with a 200', () =>
      assert.strictEqual(res.statusCode, 200, res.body));
    check('every question row is gone', () =>
      assert.strictEqual(rowsIn('SET#smallset').length, 0,
        `${rowsIn('SET#smallset').length} rows left in the SET# partition`));
    check('the index row is gone too', () =>
      assert.strictEqual(indexRow('smallset'), undefined,
        'SETS/SET#smallset survived — the set still lists in the admin UI'));
    check('the reported count matches what was actually removed', () =>
      assert.strictEqual(parse(res).itemsDeleted, 6,   // 3 questions + 2 categories + 1 metadata
        `reported ${parse(res).itemsDeleted}, expected 6`));
  }

  // 4. A set that spans several Query pages ------------------------------------
  //    DynamoDB caps a Query response at 1 MB. The biggest live set is 160
  //    questions, so this is the case that is about to be run in anger.
  resetDb();
  seedSet('bigset', { questions: 160, categories: 4, name: 'Big Set' });
  queryPageSize = 60;                     // 164 content rows => 3 pages
  {
    const before = rowsIn('SET#bigset').length;
    const res = await invoke('bigset');
    check('a multi-page set returns 200', () =>
      assert.strictEqual(res.statusCode, 200, res.body));
    check('the handler follows LastEvaluatedKey', () =>
      assert(cmds('query').length >= 3,
        `only ${cmds('query').length} Query call(s) for ${before} rows across ${Math.ceil(before / 60)} pages — pagination is missing`));
    check('a multi-page set leaves NO orphan rows behind', () =>
      assert.strictEqual(rowsIn('SET#bigset').length, 0,
        `${rowsIn('SET#bigset').length} of ${before} rows orphaned in the SET#bigset partition`));
    check('the index row for a multi-page set is gone', () =>
      assert.strictEqual(indexRow('bigset'), undefined));
    check('no BatchWrite exceeds the 25-item DynamoDB limit', () =>
      assert(batchSizes().every((n) => n > 0 && n <= 25),
        `batch sizes seen: ${batchSizes().join(', ')}`));
    check('the reported count matches the rows actually removed', () =>
      assert.strictEqual(parse(res).itemsDeleted, before + 1,
        `reported ${parse(res).itemsDeleted}, expected ${before + 1}`));
  }

  // 5. UnprocessedItems on the first attempt, fine on the retry ------------------
  resetDb();
  seedSet('throttled', { questions: 30, categories: 1 });
  queryPageSize = 25;
  {
    const before = rowsIn('SET#throttled').length;
    // Dynamo throttles three of the deletes on their first attempt.
    deferOnce = new Set([
      'SET#throttled|QUESTION#c0#001',
      'SET#throttled|QUESTION#c0#017',
      'SET#throttled|QUESTION#c0#030',
    ]);
    const res = await invoke('throttled');
    check('a throttled delete still reports 200 once it settles', () =>
      assert.strictEqual(res.statusCode, 200, res.body));
    check('UnprocessedItems are retried, not dropped', () =>
      assert.strictEqual(rowsIn('SET#throttled').length, 0,
        `${rowsIn('SET#throttled').length} of ${before} rows silently survived as UnprocessedItems`));
    check('the retry re-sent exactly the deferred keys', () => {
      const sent = writeOrder().filter((w) => w === 'batch:SET#throttled|QUESTION#c0#017');
      assert(sent.length >= 2, `key was sent ${sent.length} time(s); a retry means at least 2`);
    });
    check('the index row is gone after a throttled run', () =>
      assert.strictEqual(indexRow('throttled'), undefined));
  }

  // 6. UnprocessedItems that never clear — the retry limit -----------------------
  resetDb();
  seedSet('stuck', { questions: 10, categories: 1 });
  {
    deferAlways = new Set(['SET#stuck|QUESTION#c0#005']);
    const res = await invoke('stuck');
    check('an undeletable item fails loudly rather than reporting success', () =>
      assert.strictEqual(res.statusCode, 500, `got ${res.statusCode}: ${res.body}`));
    check('the retry limit is bounded (the handler terminates)', () =>
      assert(cmds('batchWrite').length < 50,
        `${cmds('batchWrite').length} BatchWrite calls — retries are not bounded`));
    check('the stuck row is still there and reported, not silently lost', () =>
      assert.strictEqual(rowsIn('SET#stuck').length, 1,
        `expected the single stuck row to remain, found ${rowsIn('SET#stuck').length}`));
    check('the index row SURVIVES a failed content delete', () =>
      assert(indexRow('stuck') !== undefined,
        'metadata was removed while questions remain — the set is now an invisible orphan partition'));
  }

  // 7. Mid-operation failure ----------------------------------------------------
  //    Ordering requirement: the index row must only go once the content is gone,
  //    so a half-finished delete leaves a re-deletable set, never a browsable set
  //    pointing at missing questions.
  resetDb();
  seedSet('boomset', { questions: 40, categories: 1 });
  queryPageSize = 15;
  {
    failWriteWhen = (key) => key === 'SET#boomset|QUESTION#c0#033';
    const res = await invoke('boomset');
    failWriteWhen = null;
    check('a mid-operation failure surfaces as a 500', () =>
      assert.strictEqual(res.statusCode, 500, res.body));
    check('a failed delete never removes the index row first', () =>
      assert(indexRow('boomset') !== undefined,
        'SETS/SET#boomset was deleted before the questions — orphaned rows are now invisible to get-question-sets'));
    check('the surviving set is still re-deletable (metadata + rows agree)', () => {
      const left = rowsIn('SET#boomset').length;
      assert(left > 0 && indexRow('boomset') !== undefined,
        `left=${left} indexRow=${indexRow('boomset') !== undefined}`);
    });
  }

  // 8. Ordering, proven on the happy path ---------------------------------------
  resetDb();
  seedSet('orderset', { questions: 5, categories: 1 });
  {
    await invoke('orderset');
    check('the index row is deleted LAST', () => {
      const order = writeOrder();
      const idxAt = order.indexOf('delete:SETS|SET#orderset');
      const lastContent = order.map((w, i) => (w.includes('|') && w.includes('SET#orderset|') ? i : -1))
        .reduce((a, b) => Math.max(a, b), -1);
      assert(idxAt !== -1, 'index row was never deleted');
      assert(idxAt > lastContent,
        `index row deleted at step ${idxAt}, but content deletes ran until step ${lastContent}`);
    });
  }

  // 9. Blast radius — a delete must never touch a neighbouring set ---------------
  resetDb();
  seedSet('victim', { questions: 20, categories: 2 });
  seedSet('bystander', { questions: 20, categories: 2, name: 'Bystander' });
  put({ PK: 'GAME#1234', SK: 'META', gameId: '1234' });
  queryPageSize = 7;
  {
    const res = await invoke('victim');
    check('the targeted set is fully removed', () =>
      assert(res.statusCode === 200 && rowsIn('SET#victim').length === 0 && indexRow('victim') === undefined,
        `status=${res.statusCode} left=${rowsIn('SET#victim').length}`));
    check('not one row of the neighbouring set is touched', () =>
      assert.strictEqual(rowsIn('SET#bystander').length, 22,
        `bystander lost rows: ${rowsIn('SET#bystander').length} of 22 remain`));
    check('the neighbouring index row is intact', () =>
      assert(indexRow('bystander') !== undefined, 'deleted the wrong index row'));
    check('unrelated partitions are untouched', () =>
      assert(store.get('GAME#1234|META') !== undefined, 'a GAME# row was collateral damage'));
    check('every delete issued targeted only the victim set', () => {
      const stray = writeOrder().filter((w) =>
        !w.endsWith('SETS|SET#victim') && !w.includes('SET#victim|'));
      assert.strictEqual(stray.length, 0, `stray deletes: ${stray.join(', ')}`);
    });
  }

  // 10. The 500 body must tell the truth about WHETHER anything was deleted ----
  //
  // `partial` is the operator's whole signal for "is the data half-gone?".
  // batchDeleteKeys attaches `deleted`/`remaining` to the error ONLY when it
  // gave up mid-flight; a failure before any row was accepted carries neither.
  // The handler computed that distinction and then discarded it, hardcoding
  // `partial: true`, so a clean no-op failure reported a half-deleted set.
  // delete-set-version.js:201-207 is the sibling that always had this right.
  //
  // rejects: re-hardcoding `partial: true` (or `partial: false`) in
  //          delete-question-set.js's catch block, in either direction.
  resetDb();
  seedSet('nothingdeleted', { questions: 8, categories: 1 });
  failWriteWhen = () => true;             // the very first batch throws, plainly
  {
    const res = await invoke('nothingdeleted');
    const body = JSON.parse(res.body);
    check('a failure before any row is deleted is a 500', () =>
      assert.strictEqual(res.statusCode, 500, res.body));
    check('...and does NOT claim to be partial', () =>
      assert.strictEqual(body.partial, false,
        `partial=${body.partial} — the set is fully intact, nothing was deleted`));
    check('...and reports no counts it does not have', () => {
      assert.strictEqual(body.itemsDeleted, undefined, `itemsDeleted=${body.itemsDeleted}`);
      assert.strictEqual(body.remaining, undefined, `remaining=${body.remaining}`);
    });
    check('...and the set really is still whole', () =>
      assert(rowsIn('SET#nothingdeleted').length === 9 && indexRow('nothingdeleted') !== undefined,
        `left ${rowsIn('SET#nothingdeleted').length} content rows`));
  }

  // The other half of the same branch: a genuine mid-flight give-up MUST still
  // report partial:true with its real counts, or the fix above would have just
  // moved the lie. deferAlways starves one key past the retry budget, which is
  // the only path that attaches `deleted`/`remaining`.
  //
  // rejects: a "fix" that hardcodes partial:false, or drops the counts.
  resetDb();
  seedSet('halfgone', { questions: 8, categories: 1 });
  {
    const victim = rowsIn('SET#halfgone')[0];
    deferAlways = new Set([k(victim.PK, victim.SK)]);
    const res = await invoke('halfgone');
    const body = JSON.parse(res.body);
    check('a mid-flight give-up is a 500', () =>
      assert.strictEqual(res.statusCode, 500, res.body));
    check('...and DOES report itself partial', () =>
      assert.strictEqual(body.partial, true, `partial=${body.partial}`));
    check('...and carries the real counts', () => {
      assert.strictEqual(typeof body.itemsDeleted, 'number', `itemsDeleted=${body.itemsDeleted}`);
      assert(body.remaining >= 1, `remaining=${body.remaining}`);
    });
    check('...and never removes the index row on a partial delete', () =>
      assert(indexRow('halfgone') !== undefined,
        'index row was dropped while content rows survived — the set is now unbrowsable'));
  }

  say(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { process.stdout.write(`harness error: ${e && e.stack}\n`); process.exit(1); });
