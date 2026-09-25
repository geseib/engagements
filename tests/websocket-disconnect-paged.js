/**
 * A disconnect must find its CONNECTION# row wherever the Scan pages put it.
 *
 * $disconnect carries only the connection id — no gameId — so disconnect.js
 * Scans the table for `SK = CONNECTION#<id>`. It read ONE page. A Scan reads
 * 1 MB and filters afterwards, and on dev (6,083 rows, 1,987 on the first page)
 * most connection rows live past it, so the handler logged "not found" and the
 * row stayed until its TTL: every broadcast kept posting to a dead socket.
 *
 * The fake (tests/helpers/paged-table.js) cuts each page before filtering, so
 * a page can be empty with more to come — exactly what the handler must page
 * through.
 */
const suiteFinished = require('./helpers/finish-guard');
const path = require('path');
const assert = require('assert');
const Module = require('module');
const { createPagedTable, commands } = require('./helpers/paged-table');

const REPO = path.join(__dirname, '..');

const stubs = new Map();
const realLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (stubs.has(request)) return stubs.get(request);
  return realLoad.call(this, request, parent, isMain);
};

const table = createPagedTable({ pageSize: 3 });
stubs.set('@aws-sdk/client-dynamodb', { DynamoDBClient: class {} });
stubs.set('@aws-sdk/lib-dynamodb', { DynamoDBDocumentClient: { from: () => table }, ...commands });

process.env.TABLE_NAME = 'test-table';

// Scan order is PK then SK. Pages of three:
//   page 1  GAME#1000 METADATA · GAME#1000 QUESTION#01 · GAME#1000 QUESTION#02
//   page 2  GAME#2000 CONNECTION#other · GAME#2000 CONNECTION#target · GAME#2000 METADATA
//   page 3+ GAME#3000 …
const seed = () => {
  table.store.clear();
  table.log.length = 0;
  table.put({ PK: 'GAME#1000', SK: 'METADATA' });
  table.put({ PK: 'GAME#1000', SK: 'QUESTION#01' });
  table.put({ PK: 'GAME#1000', SK: 'QUESTION#02' });
  table.put({ PK: 'GAME#2000', SK: 'CONNECTION#other', ConnectionId: 'other', ConnectionType: 'PLAYER' });
  table.put({ PK: 'GAME#2000', SK: 'CONNECTION#target', ConnectionId: 'target', ConnectionType: 'PLAYER' });
  table.put({ PK: 'GAME#2000', SK: 'METADATA' });
  for (let n = 0; n < 6; n++) table.put({ PK: 'GAME#3000', SK: `QUESTION#0${n}` });
};

const { handler } = require(path.join(REPO, 'lambda-functions', 'websocket', 'disconnect.js'));
const disconnect = (connectionId) => handler({ requestContext: { connectionId } });

let pass = 0, fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  PASS  ${label}`); pass++; }
  catch (e) { console.log(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

(async () => {
  console.log('disconnect.js: the connection row is found and deleted past the first Scan page\n');

  seed();
  const res = await disconnect('target');

  await check('answers 200', () => assert.strictEqual(res.statusCode, 200));

  await check('a CONNECTION# row on page 2 is deleted', () =>
    assert.strictEqual(table.has('GAME#2000', 'CONNECTION#target'), false,
      'the row is still there — the handler read one page and reported "not found"'));

  await check('only that connection\'s row is deleted', () => {
    assert.strictEqual(table.has('GAME#2000', 'CONNECTION#other'), true);
    assert.strictEqual(table.calls('delete').length, 1);
  });

  await check('it stops paging at the first match', () => {
    const scans = table.calls('scan');
    assert.strictEqual(scans.length, 2, `read ${scans.length} page(s); the row is on page 2`);
  });

  seed();
  const missing = await disconnect('never-seen');
  await check('an unknown connection id reads every page, deletes nothing, still answers 200', () => {
    assert.strictEqual(missing.statusCode, 200);
    assert.strictEqual(table.calls('delete').length, 0);
    const scans = table.calls('scan');
    assert.strictEqual(scans[scans.length - 1].more, false, 'gave up with pages still unread');
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('harness error:', e); process.exit(1); });
