/**
 * THE METER, AND THE FOUR WAYS IT COULD OVERCHARGE OR UNDERCHARGE.
 *
 * Metering is the one part of this system where a duplicate write is a
 * duplicate CHARGE, and where a lost write is revenue nobody ever notices.
 * Both failures are invisible in production — the numbers still look like
 * numbers. So they are pinned here, against the real handlers, with a stubbed
 * DynamoDB that actually EVALUATES the condition expressions rather than
 * accepting every write (a stub that ignores `ConditionExpression` would make
 * every idempotency assertion in this file pass unconditionally, which is the
 * exact shape of test this repo has been bitten by before).
 *
 * rejects: billing a session on creation instead of on the first join; a
 * replayed / reconnected / retried join billing twice; dropping the conditional
 * put and checking-then-writing; incrementing the set peak from a stream record
 * instead of recomputing it (a redelivery then double-counts); letting the peak
 * fall when a set is deleted; letting a metering failure refuse a player's
 * join; the stream reacting to its own USAGE writes; the reconciler overwriting
 * a closed period's peak with today's set count; get-usage serving one org's
 * numbers to another; the two copies of usage.js drifting apart.
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');
const store = new Map();                 // "PK|SK" -> item
const key = (pk, sk) => `${pk}|${sk}`;
const calls = [];                        // every command the handlers issued

// ---- A DynamoDB stub that honours conditions -------------------------------
class PutCommand { constructor(i) { this.input = i; this.type = 'put'; } }
class GetCommand { constructor(i) { this.input = i; this.type = 'get'; } }
class QueryCommand { constructor(i) { this.input = i; this.type = 'query'; } }
class DeleteCommand { constructor(i) { this.input = i; this.type = 'delete'; } }
class UpdateCommand { constructor(i) { this.input = i; this.type = 'update'; } }
class BatchWriteCommand { constructor(i) { this.input = i; this.type = 'batchWrite'; } }

function conditionFailed() {
  const e = new Error('The conditional request failed');
  e.name = 'ConditionalCheckFailedException';
  return e;
}

/**
 * Evaluates ONLY the two condition forms the meter emits. Anything else throws
 * loudly rather than passing: a new, unevaluated condition slipping through as
 * "true" is how a stub starts lying about idempotency.
 */
function conditionHolds(expr, item, names, values) {
  const src = String(expr).trim();
  if (src === 'attribute_not_exists(SK)') return !item;
  if (src === 'attribute_not_exists(#peak) OR #peak < :c') {
    const attr = names['#peak'];
    const current = item ? item[attr] : undefined;
    return current === undefined || current < values[':c'];
  }
  throw new Error(`test stub: unevaluated ConditionExpression ${JSON.stringify(src)}`);
}

/** Applies ONLY the SET/ADD forms the meter emits. Same reasoning. */
function applyUpdate(item, expr, names, values) {
  const src = String(expr).trim();
  const add = /(?:^|\s)ADD\s+(.*?)(?=\s+SET\s+|$)/.exec(src);
  const set = /(?:^|\s)SET\s+(.*)$/.exec(src);
  if (!add && !set) throw new Error(`test stub: unparsed UpdateExpression ${JSON.stringify(src)}`);
  const next = { ...item };
  if (add) {
    for (const clause of add[1].split(',')) {
      const [name, value] = clause.trim().split(/\s+/);
      const attr = names[name] || name;
      next[attr] = (Number(next[attr]) || 0) + values[value];
    }
  }
  if (set) {
    for (const clause of set[1].split(',')) {
      const [name, value] = clause.split('=').map((s) => s.trim());
      const attr = names[name] || name;
      next[attr] = values[value];
    }
  }
  return next;
}

let updateFailure = null;   // set to an Error to simulate DynamoDB refusing writes

const fakeDoc = {
  send: async (cmd) => {
    const inp = cmd.input || {};
    calls.push({ type: cmd.type, input: inp });
    switch (cmd.type) {
      case 'put': {
        const existing = store.get(key(inp.Item.PK, inp.Item.SK));
        if (inp.ConditionExpression && !conditionHolds(inp.ConditionExpression, existing, {}, {})) {
          throw conditionFailed();
        }
        store.set(key(inp.Item.PK, inp.Item.SK), inp.Item);
        return {};
      }
      case 'get':
        return { Item: store.get(key(inp.Key.PK, inp.Key.SK)) };
      case 'delete':
        store.delete(key(inp.Key.PK, inp.Key.SK));
        return {};
      case 'update': {
        if (updateFailure) throw updateFailure;
        const k = key(inp.Key.PK, inp.Key.SK);
        const existing = store.get(k);
        const names = inp.ExpressionAttributeNames || {};
        const values = inp.ExpressionAttributeValues || {};
        if (inp.ConditionExpression && !conditionHolds(inp.ConditionExpression, existing, names, values)) {
          throw conditionFailed();
        }
        store.set(k, { ...applyUpdate(existing || { PK: inp.Key.PK, SK: inp.Key.SK }, inp.UpdateExpression, names, values), PK: inp.Key.PK, SK: inp.Key.SK });
        return {};
      }
      case 'query': {
        const pk = inp.ExpressionAttributeValues[':pk'];
        const prefix = inp.ExpressionAttributeValues[':sk'] ?? '';
        let items = [...store.values()]
          .filter((i) => i.PK === pk && String(i.SK).startsWith(String(prefix)))
          .sort((a, b) => String(a.SK).localeCompare(String(b.SK)));
        if (inp.ScanIndexForward === false) items.reverse();
        if (inp.Limit) items = items.slice(0, inp.Limit);
        return inp.Select === 'COUNT'
          ? { Count: items.length, Items: [] }
          : { Items: items, Count: items.length };
      }
      default:
        return {};
    }
  },
};

const STUB_PATHS = [
  REPO,
  path.join(REPO, 'lambda-functions'),
  path.join(REPO, 'lambda-functions', 'admin'),
  path.join(REPO, 'lambda-functions', 'game'),
  path.join(REPO, 'lambda-functions', 'websocket'),
];
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
  DynamoDBDocumentClient: { from: () => fakeDoc },
  PutCommand, GetCommand, QueryCommand, DeleteCommand, UpdateCommand, BatchWriteCommand,
});

process.env.TABLE_NAME = 'test-table';

const usage = require(path.join(REPO, 'lambda-functions/game/usage.js'));
const streamHandler = require(path.join(REPO, 'lambda-functions/admin/usage-stream.js'));
const reconcile = require(path.join(REPO, 'lambda-functions/admin/usage-reconcile.js'));
const getUsage = require(path.join(REPO, 'lambda-functions/admin/get-usage.js'));

let pass = 0, fail = 0;
const checks = [];
function check(label, fn) { checks.push({ label, fn }); }
async function run() {
  for (const { label, fn } of checks) {
    try { await fn(); console.log(`  ok - ${label}`); pass++; }
    catch (e) { console.log(`  FAIL - ${label}\n    ${e.message}`); fail++; }
  }
}

const ORG = 'org_nw';
const AUG = new Date('2026-08-22T10:00:00Z');
const SEP = new Date('2026-09-03T10:00:00Z');
const reset = () => { store.clear(); calls.length = 0; updateFailure = null; };
const usageRow = (org = ORG, period = '2026-08') => store.get(key(`ORG#${org}`, `USAGE#${period}`)) || {};
const ledgerRows = (org = ORG) => [...store.values()].filter((i) => String(i.SK).startsWith('LEDGER#') && i.PK === `ORG#${org}`);
const setRow = (org, id) => store.set(key(`ORG#${org}#SETS`, `SET#${id}`), { PK: `ORG#${org}#SETS`, SK: `SET#${id}` });
const streamRecord = (pk, sk) => ({ dynamodb: { Keys: { PK: { S: pk }, SK: { S: sk } } } });

// ============================================================================
console.log('\n1. a session is billed on the first join, exactly once, ever');

check('the first join writes one ledger row and one counter', async () => {
  reset();
  const result = await usage.recordBillableSession(ORG, '1234', { now: AUG });
  assert.strictEqual(result.billed, true);
  assert.strictEqual(ledgerRows().length, 1);
  assert.strictEqual(ledgerRows()[0].SK, 'LEDGER#2026-08#SESSION#1234');
  assert.strictEqual(usageRow().sessionsRun, 1);
});

// THE MOST IMPORTANT ASSERTION IN THIS FILE. Every player in the room calls
// this, every reconnect calls it again, and API Gateway retries call it again
// after that. All of them must add up to one charge.
check('twenty joins and a dozen retries of the same session bill ONCE', async () => {
  reset();
  for (let i = 0; i < 32; i++) await usage.recordBillableSession(ORG, '1234', { now: AUG });
  assert.strictEqual(ledgerRows().length, 1, 'more than one ledger row for one session');
  assert.strictEqual(usageRow().sessionsRun, 1, 'the counter counted a rejoin');
});

check('only the join that created the row reports billed:true', async () => {
  reset();
  const first = await usage.recordBillableSession(ORG, '1234', { now: AUG });
  const second = await usage.recordBillableSession(ORG, '1234', { now: AUG });
  assert.strictEqual(first.billed, true);
  assert.deepStrictEqual([second.billed, second.reason], [false, 'already']);
});

check('the guard is a conditional put, not a read-then-write', async () => {
  reset();
  await usage.recordBillableSession(ORG, '1234', { now: AUG });
  const put = calls.find((c) => c.type === 'put');
  assert.strictEqual(put.input.ConditionExpression, 'attribute_not_exists(SK)');
  assert.ok(!calls.some((c) => c.type === 'get'),
    'it read the row first — two joins can both read "absent" and both write');
});

check('different sessions are separate charges', async () => {
  reset();
  for (const id of ['1234', '5678', '9012']) {
    await usage.recordBillableSession(ORG, id, { now: AUG });
  }
  assert.strictEqual(usageRow().sessionsRun, 3);
});

check('two orgs are metered apart', async () => {
  reset();
  await usage.recordBillableSession('org_nw', '1234', { now: AUG });
  await usage.recordBillableSession('org_md', '1234', { now: AUG });
  assert.strictEqual(usageRow('org_nw').sessionsRun, 1);
  assert.strictEqual(usageRow('org_md').sessionsRun, 1);
});

// Game ids are four digits and ARE recycled, so the period has to be part of
// the ledger key: without it, September's game 1234 would silently reuse
// August's row and never be billed.
check('the same game id next month is a new charge, because ids recycle', async () => {
  reset();
  await usage.recordBillableSession(ORG, '1234', { now: AUG });
  await usage.recordBillableSession(ORG, '1234', { now: SEP });
  assert.strictEqual(usageRow(ORG, '2026-08').sessionsRun, 1);
  assert.strictEqual(usageRow(ORG, '2026-09').sessionsRun, 1);
});

check('a session with no organisation is not billed to anybody', async () => {
  reset();
  const result = await usage.recordBillableSession('', '1234', { now: AUG });
  assert.strictEqual(result.billed, false);
  assert.strictEqual(store.size, 0, 'it invented a partition for an unscoped session');
});

// "We do not block a session you are about to run in front of a room."
check('a broken meter never throws into the join path', async () => {
  reset();
  const brokenDb = { send: async () => { throw new Error('DynamoDB is having a day'); } };
  const result = await usage.recordBillableSession(ORG, '1234', { now: AUG, db: brokenDb });
  assert.strictEqual(result.billed, false);
  assert.strictEqual(result.reason, 'error');
});

check('a failed counter write still leaves the ledger row for the reconciler', async () => {
  reset();
  updateFailure = new Error('throttled');
  const result = await usage.recordBillableSession(ORG, '1234', { now: AUG });
  updateFailure = null;
  assert.strictEqual(result.billed, true);
  assert.strictEqual(ledgerRows().length, 1, 'the authority was lost with the counter');
  assert.strictEqual(usageRow().sessionsRun, undefined);
});

// ============================================================================
console.log('\n2. stored sets are the PEAK, recomputed, never incremented');

check('the stream re-counts the partition and records the count', async () => {
  reset();
  setRow(ORG, 'teamretro'); setRow(ORG, 'onboarding');
  await streamHandler.handler({ Records: [streamRecord(`ORG#${ORG}#SETS`, 'SET#teamretro')] });
  assert.strictEqual(usageRow().setsCurrent, 2);
  assert.strictEqual(usageRow().setsPeak, 2);
});

// STREAMS DELIVER AT LEAST ONCE. An `ADD :one` here would charge for a set
// that never existed.
check('a redelivered stream record does not inflate the peak', async () => {
  reset();
  setRow(ORG, 'teamretro'); setRow(ORG, 'onboarding');
  const record = streamRecord(`ORG#${ORG}#SETS`, 'SET#teamretro');
  for (let i = 0; i < 7; i++) await streamHandler.handler({ Records: [record] });
  assert.strictEqual(usageRow().setsPeak, 2, 'the peak drifted upward on redelivery');
  assert.strictEqual(usageRow().setsCurrent, 2);
});

check('it writes an absolute count, never a delta', async () => {
  reset();
  setRow(ORG, 'a');
  await streamHandler.handler({ Records: [streamRecord(`ORG#${ORG}#SETS`, 'SET#a')] });
  const update = calls.find((c) => c.type === 'update');
  assert.ok(!/\bADD\b/.test(update.input.UpdateExpression),
    'the peak is written with ADD, which double-counts on redelivery');
  assert.strictEqual(update.input.ConditionExpression,
    'attribute_not_exists(#peak) OR #peak < :c');
});

// "A set you created and deleted still counted" — printed on 04-billing.html.
check('the peak never falls when sets are deleted', async () => {
  reset();
  for (const id of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) setRow(ORG, id);
  await streamHandler.handler({ Records: [streamRecord(`ORG#${ORG}#SETS`, 'SET#g')] });
  assert.strictEqual(usageRow().setsPeak, 7);
  for (const id of ['c', 'd', 'e', 'f', 'g']) store.delete(key(`ORG#${ORG}#SETS`, `SET#${id}`));
  await streamHandler.handler({ Records: [streamRecord(`ORG#${ORG}#SETS`, 'SET#g')] });
  assert.strictEqual(usageRow().setsPeak, 7, 'a deletion lowered the peak');
  // …but the live counter DOES fall, or the screen's "2 of 5" meter would sit
  // at the high-water mark and read as a billing error.
  assert.strictEqual(usageRow().setsCurrent, 2);
});

check('a monotonic sweep up and down keeps the highest level held', async () => {
  reset();
  const record = streamRecord(`ORG#${ORG}#SETS`, 'SET#x');
  for (const n of [1, 2, 3, 9, 4, 2, 6, 1]) {
    for (const k of [...store.keys()]) if (k.startsWith(`ORG#${ORG}#SETS|`)) store.delete(k);
    for (let i = 0; i < n; i++) setRow(ORG, `s${i}`);
    await streamHandler.handler({ Records: [record] });
  }
  assert.strictEqual(usageRow().setsPeak, 9);
  assert.strictEqual(usageRow().setsCurrent, 1);
});

check('thirty records for one org produce ONE re-count', async () => {
  reset();
  setRow(ORG, 'a');
  const records = Array.from({ length: 30 }, (_, i) => streamRecord(`ORG#${ORG}#SETS`, `SET#s${i}`));
  await streamHandler.handler({ Records: records });
  assert.strictEqual(calls.filter((c) => c.type === 'query').length, 1);
});

// The handler's own USAGE writes appear on the same stream. Reacting to them
// would be an infinite loop that bills forever.
check('it ignores its own USAGE rows and every other partition', async () => {
  reset();
  await streamHandler.handler({
    Records: [
      streamRecord(`ORG#${ORG}`, 'USAGE#2026-08'),
      streamRecord(`ORG#${ORG}`, 'LEDGER#2026-08#SESSION#1234'),
      streamRecord('SETS', 'SET#80strivia'),
      streamRecord('GAME#1234', 'PLAYER#chris'),
      streamRecord(`ORG#${ORG}#SETS`, 'MEMBER#amara'),
    ],
  });
  assert.strictEqual(calls.length, 0, 'it reacted to a partition it does not meter');
});

// The PK guard on its own, because the SK guard above would hide a broken one.
// Only the METADATA partition holds one row per set; `ORG#<org>#SET#<id>` is
// the CONTENT partition (one row per question) and `ORG#<org>` is where the
// meter's own USAGE and LEDGER rows live. Counting either as "sets held" would
// bill an org for its questions, or for its own invoices.
check('only the set METADATA partition is a set count', () => {
  assert.strictEqual(streamHandler.orgOfSetsPartition(`ORG#${ORG}#SETS`), ORG);
  assert.strictEqual(streamHandler.orgOfSetsPartition(`ORG#${ORG}#SET#teamretro`), null);
  assert.strictEqual(streamHandler.orgOfSetsPartition(`ORG#${ORG}#SET#teamretro#v2`), null);
  assert.strictEqual(streamHandler.orgOfSetsPartition(`ORG#${ORG}`), null);
  assert.strictEqual(streamHandler.orgOfSetsPartition(`ORG#${ORG}#GAMES`), null);
  assert.strictEqual(streamHandler.orgOfSetsPartition('SETS'), null);
  assert.strictEqual(streamHandler.orgOfSetsPartition('PUBLIC#SETS'), null);
  assert.strictEqual(streamHandler.orgOfSetsPartition('GAME#1234'), null);
});

check('one org failing does not stop the rest of the batch', async () => {
  reset();
  setRow('org_md', 'a');
  const bad = { dynamodb: { Keys: { PK: { S: 'ORG##SETS' }, SK: { S: 'SET#x' } } } };
  await streamHandler.handler({ Records: [bad, streamRecord('ORG#org_md#SETS', 'SET#a')] });
  assert.strictEqual(usageRow('org_md').setsCurrent, 1);
});

// ============================================================================
console.log('\n3. the reconciler repairs the derived counter from the ledger');

check('a counter behind its ledger is corrected', async () => {
  reset();
  store.set(key('ORGS', `ORG#${ORG}`), { PK: 'ORGS', SK: `ORG#${ORG}`, orgId: ORG });
  updateFailure = new Error('throttled');
  for (const id of ['1111', '2222', '3333']) {
    await usage.recordBillableSession(ORG, id, { now: AUG });
  }
  updateFailure = null;
  assert.strictEqual(usageRow().sessionsRun, undefined);
  await reconcile.handler({ now: AUG.toISOString() });
  assert.strictEqual(usageRow().sessionsRun, 3, 'the ledger rows were not counted back');
});

check('running it twice changes nothing', async () => {
  await reconcile.handler({ now: AUG.toISOString() });
  assert.strictEqual(usageRow().sessionsRun, 3);
});

check('it closes out the previous period too', async () => {
  reset();
  store.set(key('ORGS', `ORG#${ORG}`), { PK: 'ORGS', SK: `ORG#${ORG}`, orgId: ORG });
  updateFailure = new Error('throttled');
  await usage.recordBillableSession(ORG, '9999', { now: new Date('2026-08-31T23:58:00Z') });
  updateFailure = null;
  await reconcile.handler({ now: SEP.toISOString() });
  assert.strictEqual(usageRow(ORG, '2026-08').sessionsRun, 1);
});

// A closed period's peak is FINAL. Today's set count is evidence about today.
check("today's set count never rewrites a closed period's peak", async () => {
  reset();
  store.set(key('ORGS', `ORG#${ORG}`), { PK: 'ORGS', SK: `ORG#${ORG}`, orgId: ORG });
  store.set(key(`ORG#${ORG}`, 'USAGE#2026-08'), {
    PK: `ORG#${ORG}`, SK: 'USAGE#2026-08', sessionsRun: 4, setsCurrent: 2, setsPeak: 2,
  });
  for (const id of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i']) setRow(ORG, id);
  await reconcile.handler({ now: SEP.toISOString() });
  assert.strictEqual(usageRow(ORG, '2026-08').setsPeak, 2, "August's invoice was revised upward");
  assert.strictEqual(usageRow(ORG, '2026-08').sessionsRun, 4, 'the empty ledger zeroed a closed month');
  assert.strictEqual(usageRow(ORG, '2026-09').setsPeak, 9);
});

// The ledger row is written BEFORE the counter, so "no rows, nonzero counter"
// is unreachable from this code — something else made it, and zeroing it
// destroys the only record of a month. An over-count IS recoverable; this is not.
check('an empty ledger never zeroes a counter', async () => {
  reset();
  store.set(key('ORGS', `ORG#${ORG}`), { PK: 'ORGS', SK: `ORG#${ORG}`, orgId: ORG });
  store.set(key(`ORG#${ORG}`, 'USAGE#2026-08'), {
    PK: `ORG#${ORG}`, SK: 'USAGE#2026-08', sessionsRun: 12, setsPeak: 3, setsCurrent: 3,
  });
  await reconcile.handler({ now: AUG.toISOString() });
  assert.strictEqual(usageRow().sessionsRun, 12);
});

// …but a counter that ran AHEAD of its ledger is still brought back down, or
// the repair only ever works in the direction that costs the customer money.
check('a counter ahead of a non-empty ledger is lowered', async () => {
  reset();
  store.set(key('ORGS', `ORG#${ORG}`), { PK: 'ORGS', SK: `ORG#${ORG}`, orgId: ORG });
  await usage.recordBillableSession(ORG, '1234', { now: AUG });
  store.set(key(`ORG#${ORG}`, 'USAGE#2026-08'), {
    ...usageRow(), sessionsRun: 9,
  });
  await reconcile.handler({ now: AUG.toISOString() });
  assert.strictEqual(usageRow().sessionsRun, 1);
});

check('December rolls the year back', () => {
  assert.strictEqual(reconcile.previousPeriod('2027-01'), '2026-12');
  assert.strictEqual(reconcile.previousPeriod('2026-08'), '2026-07');
});

// ============================================================================
console.log('\n4. GET /orgs/{orgId}/usage renders what 04-billing.html draws');

const evt = (orgId, pathOrg) => ({
  requestContext: { authorizer: { lambda: { orgId, orgRole: 'admin' } }, http: { method: 'GET' } },
  pathParameters: { orgId: pathOrg || orgId },
  queryStringParameters: { period: '2026-08' },
});

async function mockupFixture() {
  reset();
  setRow(ORG, 'teamretro'); setRow(ORG, 'onboarding');
  await streamHandler.handler({ Records: [streamRecord(`ORG#${ORG}#SETS`, 'SET#teamretro')] });
  for (let i = 0; i < 20; i++) {
    await usage.recordBillableSession(ORG, `10${String(i).padStart(2, '0')}`, { now: AUG });
  }
}

check('the mockup fixture — 2 sets, 20 sessions — totals 875 cents', async () => {
  await mockupFixture();
  const body = JSON.parse((await getUsage.handler(evt(ORG))).body);
  assert.strictEqual(body.usage.sessionsRun, 20);
  assert.strictEqual(body.usage.setsCurrent, 2);
  assert.strictEqual(body.usage.setsPeak, 2);
  assert.strictEqual(body.totalIfPeriodEndedTodayCents, 875);
  assert.strictEqual(body.totalIfPeriodEndedTodayDisplay, '$8.75');
});

check('it carries both allowances and both overages', async () => {
  const body = JSON.parse((await getUsage.handler(evt(ORG))).body);
  assert.deepStrictEqual(body.allowances, { sessions: 5, sets: 5 });
  assert.deepStrictEqual(body.overage, { sessions: 15, sets: 0 });
});

check('and the three lines the screen prints, worded as it words them', async () => {
  const body = JSON.parse((await getUsage.handler(evt(ORG))).body);
  assert.deepStrictEqual(
    body.lines.map((l) => [l.label, l.detail, l.amountDisplay]),
    [
      ['Team plan', 'the monthly subscription', '$5.00'],
      ['Question sets', '2 stored, 5 included', '$0.00'],
      ['Sessions', '15 over the included 5, at $0.25', '$3.75'],
    ]);
});

check('the period reads "1–31 August 2026", as drawn', async () => {
  const body = JSON.parse((await getUsage.handler(evt(ORG))).body);
  assert.strictEqual(body.period.label, '1–31 August 2026');
  assert.strictEqual(body.period.id, '2026-08');
});

check('a period nobody used is a zeroed $5.00, not a 404', async () => {
  reset();
  const response = await getUsage.handler(evt(ORG));
  assert.strictEqual(response.statusCode, 200);
  const body = JSON.parse(response.body);
  assert.strictEqual(body.usage.sessionsRun, 0);
  assert.strictEqual(body.totalIfPeriodEndedTodayCents, 500);
});

check('recent periods are listed newest first, priced by the same function', async () => {
  reset();
  for (const [p, sessions, peak] of [['2026-07', 11, 2], ['2026-06', 4, 1]]) {
    store.set(key(`ORG#${ORG}`, `USAGE#${p}`), {
      PK: `ORG#${ORG}`, SK: `USAGE#${p}`, sessionsRun: sessions, setsPeak: peak, setsCurrent: peak,
    });
  }
  const body = JSON.parse((await getUsage.handler(evt(ORG))).body);
  assert.deepStrictEqual(body.history.map((h) => [h.period, h.sessionsRun, h.setsHeld, h.chargedDisplay]),
    [['2026-07', 11, 2, '$6.50'], ['2026-06', 4, 1, '$5.00']]);
});

// Usage is a statement about how often a team meets. Reading it is reading them.
check("another org's usage is refused", async () => {
  const response = await getUsage.handler(evt('org_md', ORG));
  assert.strictEqual(response.statusCode, 403);
});
check('a caller acting for no org is refused', async () => {
  const response = await getUsage.handler(evt('', ORG));
  assert.strictEqual(response.statusCode, 403);
});
check('Engage staff get no special route to it', async () => {
  const staff = {
    requestContext: { authorizer: { lambda: { groups: 'admins' } }, http: { method: 'GET' } },
    pathParameters: { orgId: ORG },
  };
  assert.strictEqual((await getUsage.handler(staff)).statusCode, 403);
});
check('a junk period is refused rather than guessed at', async () => {
  const bad = { ...evt(ORG), queryStringParameters: { period: 'last-month' } };
  assert.strictEqual((await getUsage.handler(bad)).statusCode, 400);
});

// ============================================================================
console.log('\n5. no ttl on a financial record, and no drift between copies');

check('a LEDGER row carries no ttl — DynamoDB would delete the evidence', async () => {
  reset();
  await usage.recordBillableSession(ORG, '1234', { now: AUG });
  assert.strictEqual('ttl' in ledgerRows()[0], false);
});
check('nor does the USAGE counter row', async () => {
  assert.strictEqual('ttl' in usageRow(), false);
  assert.ok(!/\bttl\b\s*:/.test(fs.readFileSync(path.join(REPO, 'lambda-functions/game/usage.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')),
    'usage.js writes a ttl attribute');
});
check('admin/shared/usage.js matches game/usage.js', () => {
  const a = fs.readFileSync(path.join(REPO, 'lambda-functions/game/usage.js'), 'utf8');
  const b = fs.readFileSync(path.join(REPO, 'lambda-functions/admin/shared/usage.js'), 'utf8');
  assert.strictEqual(a, b, 'the copies have drifted — two bundles meter differently');
});

run().then(() => {
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
});
