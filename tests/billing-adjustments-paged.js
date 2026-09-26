/**
 * THE ADJUSTMENTS LEDGER, READ PAST ITS FIRST PAGE.
 *
 * `get-usage.js`'s usage route, `invoices.js`'s `buildInvoice`, and
 * `admin/orgs/adjustments.js`'s `listAdjustments` (the staff and org-admin
 * ledger screen) each ran ONE Query for `ORG#<org>` / `ADJ#…`, took `.Items`
 * as the whole ledger, and never looked at `LastEvaluatedKey`. A Query stops
 * at 1 MB and hands back what it read; an org old enough to have collected a
 * page of revoked or expired adjustment rows ahead of a live one has that
 * live credit or rate override silently invisible to the usage screen, every
 * invoice closed after it, AND the ledger screen staff use to grant and
 * revoke — the exact shape usage.js's OWN `readAdjustments` (used by the
 * session gate) already guards against by following `ExclusiveStartKey` to
 * the end.
 *
 * tests/helpers/paged-table.js cuts pages of 3 BEFORE any filtering, exactly
 * as DynamoDB does, so a fixture with one real adjustment sitting behind nine
 * inert ones puts that adjustment on the fourth page.
 */
const suiteFinished = require('./helpers/finish-guard');
const path = require('path');
const assert = require('assert');
const Module = require('module');
const { createPagedTable, commands } = require('./helpers/paged-table');

const REPO = path.join(__dirname, '..');
const LF = path.join(REPO, 'lambda-functions');

const stubs = new Map();
const realLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (stubs.has(request)) return stubs.get(request);
  return realLoad.call(this, request, parent, isMain);
};
const stub = (name, exports) => stubs.set(name, exports);

const table = createPagedTable({ pageSize: 3 });
stub('@aws-sdk/client-dynamodb', { DynamoDBClient: class {} });
stub('@aws-sdk/lib-dynamodb', { DynamoDBDocumentClient: { from: () => table }, ...commands });

process.env.TABLE_NAME = 'test-table';

const getUsage = require(path.join(LF, 'admin', 'get-usage.js'));
const { buildInvoice } = require(path.join(LF, 'admin', 'shared', 'invoices.js'));
const { listAdjustments } = require(path.join(LF, 'admin', 'orgs', 'adjustments.js'));

const ORG = 'org_billpage';
const PERIOD = '2026-08';

let pass = 0, fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  PASS  ${label}`); pass++; }
  catch (e) { console.log(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

/**
 * Nine revoked (so always inactive, whatever the period) filler rows sorted
 * ahead of one live $2.00 credit — ten rows over pageSize 3 puts the real one
 * on page four, exactly where the dev-shaped truncation would drop it.
 */
function seedLedger() {
  table.store.clear();
  table.log.length = 0;
  table.put({ PK: `ORG#${ORG}`, SK: 'METADATA', orgId: ORG, plan: 'team' });
  for (let n = 1; n <= 9; n++) {
    const day = String(n).padStart(2, '0');
    table.put({
      PK: `ORG#${ORG}`,
      SK: `ADJ#2020-01-${day}T00:00:00.000Z#filler${n}`,
      adjId: `filler${n}`,
      kind: 'CREDIT_CENTS',
      amountCents: 100000,
      remainingCents: 100000,
      createdAt: `2020-01-${day}T00:00:00.000Z`,
      revokedAt: '2020-02-01T00:00:00.000Z', // inert on every page: isActive() excludes it regardless
    });
  }
  table.put({
    PK: `ORG#${ORG}`,
    SK: 'ADJ#2099-01-01T00:00:00.000Z#realcredit',
    adjId: 'realcredit',
    kind: 'CREDIT_CENTS',
    amountCents: 200,
    remainingCents: 200,
    createdAt: '2099-01-01T00:00:00.000Z',
  });
}

const adjQueries = () => table.log.filter((e) => e.kind === 'query'
  && e.input.ExpressionAttributeValues && e.input.ExpressionAttributeValues[':sk'] === 'ADJ#');

(async () => {
  console.log('the ADJ# ledger is read to its last page, in both readers\n');

  // ── get-usage.js: GET /orgs/{orgId}/usage ───────────────────────────────
  seedLedger();
  const evt = {
    requestContext: { authorizer: { lambda: { orgId: ORG, orgRole: 'admin' } }, http: { method: 'GET' } },
    pathParameters: { orgId: ORG },
    queryStringParameters: { period: PERIOD },
  };
  const res = await getUsage.handler(evt);
  await check('get-usage answers 200', () => assert.strictEqual(res.statusCode, 200, res.body));
  const body = JSON.parse(res.body);

  await check('the credit on page four is applied — $5.00 list less the $2.00 credit', () => {
    assert.strictEqual(body.adjusted.credits.length, 1,
      `no credit found; adjustments truncated at the first page. adjusted=${JSON.stringify(body.adjusted)}`);
    assert.strictEqual(body.adjusted.credits[0].appliedCents, 200);
    assert.strictEqual(body.adjusted.totalCents, 300, `got ${body.adjusted.totalCents}`);
  });

  await check('the ADJ# query followed LastEvaluatedKey across all ten rows', () => {
    const queries = adjQueries();
    assert(queries.length >= 4, `only ${queries.length} ADJ# page(s) read — ten rows at pageSize 3 need four`);
    assert.strictEqual(queries[queries.length - 1].more, false, 'stopped with pages still unread');
    queries.slice(1).forEach((q) => assert(q.input.ExclusiveStartKey, 'a later page was read without a start key'));
  });

  // ── invoices.js: buildInvoice (closeInvoice's own document builder) ────
  seedLedger();
  const { doc } = await buildInvoice({
    db: table, tableName: 'test-table', orgId: ORG, period: PERIOD, now: new Date('2026-08-15T00:00:00.000Z'),
  });

  await check('the invoice document carries all ten adjustment rows, not the first page\'s three', () => {
    assert.strictEqual(doc.adjustmentSnapshot.length, 10, `got ${doc.adjustmentSnapshot.length}`);
  });

  await check('and the credit on page four is spent against the invoice total', () => {
    assert.strictEqual(doc.credits.length, 1);
    assert.strictEqual(doc.credits[0].appliedCents, 200);
    assert.strictEqual(doc.totalCents, 300, `got ${doc.totalCents}`);
  });

  await check('invoices.js also followed LastEvaluatedKey across all ten rows', () => {
    const queries = adjQueries();
    assert(queries.length >= 4, `only ${queries.length} ADJ# page(s) read`);
    assert.strictEqual(queries[queries.length - 1].more, false, 'stopped with pages still unread');
  });

  // ── admin/orgs/adjustments.js: listAdjustments (the staff/org-admin ledger) ─
  seedLedger();
  const rows = await listAdjustments(ORG);

  await check('listAdjustments returns all ten adjustment rows, not the first page\'s three', () => {
    assert.strictEqual(rows.length, 10, `got ${rows.length}`);
  });

  await check('listAdjustments also followed LastEvaluatedKey across all ten rows', () => {
    const queries = adjQueries();
    assert(queries.length >= 4, `only ${queries.length} ADJ# page(s) read`);
    assert.strictEqual(queries[queries.length - 1].more, false, 'stopped with pages still unread');
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('harness error:', e); process.exit(1); });
