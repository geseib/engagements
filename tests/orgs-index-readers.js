/**
 * The ORGS partition is not a list of organisations. Its readers must make it one.
 *
 * `tenant.ORGS_INDEX_PK` holds the platform's index of organisations
 * (`SK = ORG#<id>`), and three other row types that share it:
 *
 *   CODE#<code>                     promo codes           admin/orgs/adjustments.js
 *   INVOICE#<period>#<orgId>        invoice pointers      admin/shared/invoices.js
 *   PLANREQ#<status>#<at>#<orgId>   the plan-request queue admin/orgs/plan-requests.js
 *
 * Three readers queried the WHOLE partition and took every row for an
 * organisation, deriving its id as `row.orgId || SK minus "ORG#"`:
 *
 *   admin/orgs/platform-orgs.js          the staff Organisations list
 *   admin/usage-reconcile.js             the nightly meter repair + invoice close
 *   admin/orgs/platform-observability.js the staff usage dashboard's org count
 *
 * So an INVOICE or PLANREQ row (which carries a real `orgId`) listed its org a
 * second time, and a CODE row (which carries none) became an organisation
 * called `CODE#WELCOME26`. On dev, 2026-09-25, the partition held 12 ORG rows
 * and 15 others — and the reconciler had already closed an August invoice for
 * the promo code: `INVOICE#2026-08#CODE#WELCOME26`. The fixture below is that
 * partition in miniature.
 *
 * The fake (tests/helpers/paged-table.js) cuts 3-row pages, so the four ORG
 * rows still cross a page boundary once the stray rows are gone: every check
 * here also proves the reader follows LastEvaluatedKey (18f307d0).
 *
 * Every check carries a `// rejects:` line naming the change it catches.
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
stub('@aws-sdk/lib-dynamodb', {
  DynamoDBDocumentClient: { from: () => table },
  ...commands,
  TransactWriteCommand: class { constructor(i) { this.input = i; this.type = 'transact'; } },
});
stub('@aws-sdk/client-kms', {
  KMSClient: class { async send() { throw new Error('no KMS in this suite'); } },
  GenerateDataKeyCommand: class {}, DecryptCommand: class {},
});
// An empty user pool: the dashboard's account tile is not under test here.
stub('@aws-sdk/client-cognito-identity-provider', {
  CognitoIdentityProviderClient: class { async send() { return { Users: [] }; } },
  ListUsersCommand: class { constructor(i) { this.input = i; } },
});

process.env.TABLE_NAME = 'test-table';
process.env.USER_POOL_ID = 'us-east-1_test';

/*
  THE RECONCILER'S WRITERS, replaced one level down. closeInvoice commits with
  a TransactWrite and the usage writers use conditional updates, neither of
  which the paged fake models. What this suite needs from them is the one thing
  that went wrong on dev: WHICH ids the reconciler hands them. closeInvoice
  writing `INVOICE#…#CODE#WELCOME26` is the harm, so the id it receives is the
  assertion. The periodOf clock stays real.
*/
const touched = { closeInvoice: [] };
const usagePath = require.resolve(path.join(LF, 'admin/shared/usage.js'));
const realUsage = require(usagePath);
require.cache[usagePath].exports = {
  ...realUsage,
  countSets: async () => 0,
  recordSetCount: async () => {},
  countBilledSessions: async () => 0,
  setSessionsRun: async () => {},
  readUsage: async (_orgId, period) => ({ period: period || '2026-09', sessionsRun: 0, setsCurrent: 0, setsPeak: 0 }),
};
const invoicesPath = require.resolve(path.join(LF, 'admin/shared/invoices.js'));
require.cache[invoicesPath] = {
  id: invoicesPath, filename: invoicesPath, loaded: true,
  exports: { closeInvoice: async ({ orgId }) => { touched.closeInvoice.push(orgId); return { written: false, reason: 'already-closed' }; } },
};

// Engage staff with no active organisation.
const STAFF = (method) => ({
  requestContext: {
    http: { method },
    authorizer: { lambda: { userId: 'sub-g', username: 'g', groups: 'admins', status: 'enabled' } },
  },
});

const load = (rel) => require(path.join(LF, rel));
const body = (res) => JSON.parse(res.body);

let pass = 0, fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  PASS  ${label}`); pass++; }
  catch (e) { console.log(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

/* The ORGS partition, as dev holds it, in miniature. In SK order: the CODE and
   INVOICE rows sort BEFORE the organisations, the PLANREQ rows AFTER them. */
function seed() {
  table.store.clear();
  table.log.length = 0;
  touched.closeInvoice.length = 0;
  const at = '2026-08-01T00:00:00.000Z';
  table.put({ PK: 'ORGS', SK: 'CODE#WELCOME26', RecordType: 'CODE', code: 'WELCOME26', maxUses: 10, uses: 1, validUntil: '', months: 3, note: 'launch', percentOff: 50, createdAt: at, createdBy: 'sub-g', createdByEmail: 'g@example.com' });
  table.put({ PK: 'ORGS', SK: 'INVOICE#2026-08#CODE#WELCOME26', RecordType: 'INVOICE_INDEX', orgId: 'CODE#WELCOME26', period: '2026-08', number: 'SIM-CODE#WEL-2026-08', totalCents: 0, listCents: 0, planId: 'free', closedAt: '2026-09-01T03:00:00.000Z' });
  table.put({ PK: 'ORGS', SK: 'INVOICE#2026-08#org_a', RecordType: 'INVOICE_INDEX', orgId: 'org_a', period: '2026-08', number: 'SIM-A-2026-08', totalCents: 1900, listCents: 1900, planId: 'team', closedAt: '2026-09-01T03:00:00.000Z' });
  table.put({ PK: 'ORGS', SK: 'INVOICE#2026-08#org_b', RecordType: 'INVOICE_INDEX', orgId: 'org_b', period: '2026-08', number: 'SIM-B-2026-08', totalCents: 0, listCents: 0, planId: 'free', closedAt: '2026-09-01T03:00:00.000Z' });
  table.put({ PK: 'ORGS', SK: 'ORG#org_a', orgId: 'org_a', name: 'Acme', plan: 'team', type: 'team', status: 'active', createdAt: '2026-08-02T00:00:00.000Z' });
  table.put({ PK: 'ORGS', SK: 'ORG#org_b', orgId: 'org_b', name: 'Bravo', plan: 'free', type: 'team', status: 'active', createdAt: '2026-08-03T00:00:00.000Z' });
  table.put({ PK: 'ORGS', SK: 'ORG#org_c', orgId: 'org_c', name: 'Casey', plan: 'free', type: 'personal', status: 'active', createdAt: '2026-08-04T00:00:00.000Z' });
  table.put({ PK: 'ORGS', SK: 'ORG#org_d', orgId: 'org_d', name: 'Delta', plan: 'free', type: 'team', status: 'active', createdAt: '2026-08-05T00:00:00.000Z' });
  table.put({ PK: 'ORGS', SK: 'PLANREQ#approved#2026-09-22T22:52:33.373Z#org_a', RecordType: 'PLANREQ_QUEUE', orgId: 'org_a', reqId: 'req_1', orgName: 'Acme', toPlan: 'team', code: '', requestedAt: '2026-09-22T22:52:33.373Z', decidedAt: '2026-09-22T23:00:00.000Z' });
  table.put({ PK: 'ORGS', SK: 'PLANREQ#requested#2026-09-24T10:00:00.000Z#org_d', RecordType: 'PLANREQ_QUEUE', orgId: 'org_d', reqId: 'req_2', orgName: 'Delta', toPlan: 'team', code: 'WELCOME26', requestedAt: '2026-09-24T10:00:00.000Z' });
}

const ORG_IDS = ['org_a', 'org_b', 'org_c', 'org_d'];

/** Rows the reader READ out of the ORGS partition, across every page. */
const indexRowsRead = () => table.calls('query')
  .filter((c) => c.input.ExpressionAttributeValues[':pk'] === 'ORGS')
  .reduce((n, c) => n + c.read, 0);

(async () => {
  // ── the staff Organisations list ──────────────────────────────────────────
  seed();
  const listed = await load('admin/orgs/platform-orgs.js').handler(STAFF('GET'));
  await check('platform-orgs lists each organisation once, and nothing that is not one', () => {
    // rejects: taking every ORGS row for an org — the list gains CODE#WELCOME26
    // and shows Acme three times (its ORG, INVOICE and PLANREQ rows).
    assert.strictEqual(listed.statusCode, 200, listed.body);
    assert.deepStrictEqual(body(listed).orgs.map((o) => o.orgId).sort(), ORG_IDS);
  });
  await check('platform-orgs counts three teams and one personal space', () => {
    // rejects: the same — every stray row defaults to type "team", so the
    // landing page's "teams" figure counted invoices and promo codes.
    assert.deepStrictEqual(
      { teams: body(listed).counts.teams, personal: body(listed).counts.personal },
      { teams: 3, personal: 1 },
    );
  });
  await check('platform-orgs reads only ORG# rows from the index', () => {
    // rejects: fetching the whole partition and dropping strays afterwards (or
    // with a FilterExpression). Invoice pointers grow by one per org per month,
    // so that reader pays for — and pages through — a pile that never shrinks.
    assert.strictEqual(indexRowsRead(), ORG_IDS.length);
  });

  // ── the nightly reconciler ────────────────────────────────────────────────
  seed();
  const reconciled = await load('admin/usage-reconcile.js').handler({ now: '2026-09-25T03:00:00.000Z' });
  await check('usage-reconcile closes last month\'s invoice for each organisation exactly once', () => {
    // rejects: listOrgIds over the whole partition — dev's reconciler closed
    // INVOICE#2026-08#CODE#WELCOME26 for a promo code, and handed Acme to
    // closeInvoice three times a night.
    assert.deepStrictEqual(touched.closeInvoice.slice().sort(), ORG_IDS);
  });
  await check('usage-reconcile reports four organisations reconciled', () => {
    // rejects: the same; the run's own summary counted ten.
    assert.strictEqual(reconciled.orgs, ORG_IDS.length);
  });
  await check('usage-reconcile reads only ORG# rows from the index', () => {
    // rejects: a whole-partition read filtered afterwards (see platform-orgs).
    assert.strictEqual(indexRowsRead(), ORG_IDS.length);
  });

  // ── the staff usage dashboard ─────────────────────────────────────────────
  seed();
  const observed = await load('admin/orgs/platform-observability.js').handler(STAFF('GET'));
  await check('platform-observability counts three teams and one personal space', () => {
    // rejects: listOrganisations over the whole partition — six stray rows,
    // each defaulting to "team", made nine teams.
    assert.strictEqual(observed.statusCode, 200, observed.body);
    const b = body(observed);
    assert.deepStrictEqual(b.unavailable.filter((u) => u.part === 'organisations'), []);
    assert.deepStrictEqual(b.now.organisations, { teams: 3, personal: 1 });
  });
  await check('platform-observability opens no partition for an id that is not an organisation', () => {
    // rejects: the same — counting sets and reports under ORG#CODE#WELCOME26.
    const pks = new Set(table.calls('query').map((c) => c.input.ExpressionAttributeValues[':pk']));
    const strays = [...pks].filter((pk) => /CODE#|INVOICE#|PLANREQ#/.test(pk));
    assert.deepStrictEqual(strays, []);
  });
  await check('platform-observability reads only ORG# rows from the index', () => {
    // rejects: a whole-partition read filtered afterwards (see platform-orgs).
    assert.strictEqual(indexRowsRead(), ORG_IDS.length);
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('harness error:', e); process.exit(1); });
