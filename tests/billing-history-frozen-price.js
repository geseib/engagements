/**
 * A CLOSED MONTH'S HISTORY ROW READS THE INVOICE, NOT TODAY'S PLAN.
 *
 * invoices.js is explicit that a written INVOICE# row is frozen and never
 * backfilled — "it reads the same in a year whatever the ledger does after".
 * get-usage.js's "Recent periods" table did not honour that: `recentPeriods`
 * priced every past period with `projectInvoice(plan, usage)`, where `plan` is
 * the organisation's PLAN RIGHT NOW. A plan change after a month closed — a
 * downgrade, an upgrade, a rate change — silently re-prices every history row
 * for that period, even one with a closed invoice sitting right next to it
 * that says something else.
 *
 * A period with NO invoice (nothing has closed it yet) must keep the old
 * behaviour: priced live, at today's plan — there is nothing frozen to read.
 */
const suiteFinished = require('./helpers/finish-guard');
const path = require('path');
const assert = require('assert');
const Module = require('module');

const REPO = path.join(__dirname, '..');
const LF = path.join(REPO, 'lambda-functions');

// ── a small, honest DynamoDB stub: Get/Put/Query over one Map, one page ────
const store = new Map();
const key = (pk, sk) => `${pk}|${sk}`;

class GetCommand { constructor(i) { this.input = i; this.type = 'get'; } }
class PutCommand { constructor(i) { this.input = i; this.type = 'put'; } }
class QueryCommand { constructor(i) { this.input = i; this.type = 'query'; } }

const fakeDb = {
  send: async (cmd) => {
    const inp = cmd.input || {};
    switch (cmd.type) {
      case 'get':
        return { Item: store.get(key(inp.Key.PK, inp.Key.SK)) };
      case 'put':
        store.set(key(inp.Item.PK, inp.Item.SK), inp.Item);
        return {};
      case 'query': {
        const pk = inp.ExpressionAttributeValues[':pk'];
        const prefix = inp.ExpressionAttributeValues[':sk'] ?? '';
        const items = [...store.values()].filter(
          (i) => i.PK === pk && String(i.SK).startsWith(String(prefix)),
        );
        return { Items: items, Count: items.length };
      }
      default:
        throw new Error(`test stub: unsupported command ${cmd.type}`);
    }
  },
};

const stubs = new Map();
const realLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (stubs.has(request)) return stubs.get(request);
  return realLoad.call(this, request, parent, isMain);
};
const stub = (name, exports) => stubs.set(name, exports);

stub('@aws-sdk/client-dynamodb', { DynamoDBClient: class {} });
stub('@aws-sdk/lib-dynamodb', { DynamoDBDocumentClient: { from: () => fakeDb }, GetCommand, PutCommand, QueryCommand });

process.env.TABLE_NAME = 'test-table';

const getUsage = require(path.join(LF, 'admin', 'get-usage.js'));

const ORG = 'org_frozenhist';
const CLOSED_PERIOD = '2026-07';
const OPEN_PERIOD = '2026-06';

const setPlan = (plan) => store.set(key(`ORG#${ORG}`, 'METADATA'), { PK: `ORG#${ORG}`, SK: 'METADATA', orgId: ORG, plan });
const setUsage = (period, sessionsRun, setsPeak) => store.set(key(`ORG#${ORG}`, `USAGE#${period}`), {
  PK: `ORG#${ORG}`, SK: `USAGE#${period}`, sessionsRun, setsPeak, setsCurrent: setsPeak,
});

const evt = () => ({
  requestContext: { authorizer: { lambda: { orgId: ORG, orgRole: 'admin' } }, http: { method: 'GET' } },
  pathParameters: { orgId: ORG },
  queryStringParameters: { period: '2026-08' }, // the CURRENT period the screen is open to
});

let pass = 0, fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  PASS  ${label}`); pass++; }
  catch (e) { console.log(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}
const historyRow = (body, period) => body.history.find((h) => h.period === period);

(async () => {
  console.log('a closed period\'s history line reads its invoice, not today\'s plan\n');

  store.clear();
  setPlan('team');
  // July closed while the org was on Team: 11 sessions, 2 sets — the same
  // numbers the mockup fixture uses, at $6.50 (500 + 0 + 6*25).
  setUsage(CLOSED_PERIOD, 11, 2);
  // June never closed — nothing wrote an INVOICE# row for it.
  setUsage(OPEN_PERIOD, 4, 1);
  // The invoice for July, FROZEN at the price the org was actually billed —
  // written the way invoices.js's closeInvoice would have written it.
  store.set(key(`ORG#${ORG}`, `INVOICE#${CLOSED_PERIOD}`), {
    PK: `ORG#${ORG}`, SK: `INVOICE#${CLOSED_PERIOD}`, RecordType: 'INVOICE',
    orgId: ORG, period: CLOSED_PERIOD, status: 'closed', simulated: true,
    usage: { sessionsRun: 11, setsPeak: 2, setsCurrent: 2 },
    totalCents: 650, totalDisplay: '$6.50',
  });

  // The plan changes AFTER July closed — a downgrade to Personal (free).
  setPlan('free');

  const body = JSON.parse((await getUsage.handler(evt())).body);

  await check('July (closed, invoiced) still shows the $6.50 it was actually billed', () => {
    const row = historyRow(body, CLOSED_PERIOD);
    assert(row, `no history row for ${CLOSED_PERIOD}`);
    assert.strictEqual(row.chargedCents, 650,
      `got ${row.chargedCents} — repriced at today's plan instead of reading the frozen invoice`);
    assert.strictEqual(row.chargedDisplay, '$6.50');
  });

  await check('June (never closed) is still priced live, at today\'s plan — $0.00 on Personal', () => {
    const row = historyRow(body, OPEN_PERIOD);
    assert(row, `no history row for ${OPEN_PERIOD}`);
    assert.strictEqual(row.chargedCents, 0, `got ${row.chargedCents}`);
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('harness error:', e); process.exit(1); });
