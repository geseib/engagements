/**
 * THE METER. What a team used, counted once each.
 *
 * Two numbers are billable (04-billing.html), and they are measured by two
 * different rules because they are two different kinds of thing:
 *
 *   SESSIONS  an EVENT. It happened, it is counted, it never un-happens.
 *   SETS      a LEVEL. It is held for a while, and what is charged is the
 *             HIGHEST level held during the period, not the level at the end.
 *
 * ── THE ROWS ───────────────────────────────────────────────────────────────
 *
 *   PK: ORG#<org>  SK: USAGE#<yyyy-mm>                  the counters
 *   PK: ORG#<org>  SK: LEDGER#<yyyy-mm>#<kind>#<id>     one per billable event
 *
 * The counter row is DERIVED. The ledger is the authority — one row per thing
 * charged, named by the thing itself, so a total can always be recomputed from
 * the rows that produced it. usage-reconcile.js does exactly that daily, which
 * is only possible because the ledger exists.
 *
 * ── WHY A SESSION IS BILLED ON THE FIRST JOIN, NOT ON CREATION ─────────────
 *
 * A host who creates a session and abandons it has used nothing, and charging
 * for it teaches them not to experiment. A session somebody actually joined ran
 * in front of a room. So the billable moment is the first successful player
 * join — see the call site note in usage-metering.js / the handoff.
 *
 * "First" is not something the caller has to work out. `recordBillableSession`
 * is a CONDITIONAL PUT on `LEDGER#<period>#SESSION#<gameId>` guarded by
 * `attribute_not_exists(SK)`: the second, tenth and hundredth player to join
 * the same session all attempt the same write and all but one bounce off the
 * condition. Idempotency is a property of the key, not of a check-then-write
 * the caller could race. Retries, WebSocket reconnects, Lambda's own at-least-
 * once redelivery and a player refreshing their phone are all the same case.
 *
 * ── WHY THE PEAK IS RECOMPUTED AND NEVER INCREMENTED ───────────────────────
 *
 * `recordSetCount` is fed by a DynamoDB stream, and streams deliver AT LEAST
 * ONCE. `ADD setsPeak :one` on a redelivered record charges twice for one set.
 * An absolute `SET setsPeak = :c` from a fresh COUNT of the partition cannot:
 * replay it as often as you like and the answer is the same. The condition
 * `attribute_not_exists(setsPeak) OR setsPeak < :c` is what makes it a peak
 * rather than a running value — it only ever ratchets up, so a set created and
 * deleted mid-month still counted, exactly as the screen promises.
 *
 * ── ttl: DELIBERATELY ABSENT FROM BOTH ROW KINDS ───────────────────────────
 *
 * This table's TTL is per-item opt-in and these items do not opt in.
 *
 * A LEDGER row is a FINANCIAL RECORD, not session data. It is the evidence for
 * a charge; a customer questioning an invoice six months later must be able to
 * be shown the rows it was built from, and the reconciler must be able to
 * rebuild a counter from them at any time. A USAGE row is the same argument one
 * step derived. Session CONTENT expires (players 7d, the session itself 90d) —
 * the FACT that a session ran is not content, it is an accounting entry, and it
 * outlives everything it refers to on purpose.
 *
 * This is the same mistake `template-clean.yaml` records against AI prompts,
 * which were stamped now+365d by every writer and began silently disappearing
 * a year later. Do not stamp a `ttl` on a USAGE# or LEDGER# item.
 *
 * DUPLICATED at lambda-functions/admin/shared/usage.js AND
 * lambda-functions/websocket/usage.js, byte for byte — CodeUri is per-directory
 * and there are no layers, and all three bundles now need the meter: game/ runs
 * the joins, admin/ runs the reconciler and the set gate, websocket/ runs
 * create-game.js and the session gate. tests/usage-metering.js pins the first
 * two against each other and tests/plan-gating.js pins all three.
 */
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient, PutCommand, UpdateCommand, GetCommand, QueryCommand,
} = require('@aws-sdk/lib-dynamodb');
const { orgPk, setsMetadataPk, ORG } = require('./tenant');
const { planFor, allowanceState, TEAM_PLAN } = require('./pricing');

const client = new DynamoDBClient({});
const defaultDb = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true },
});

/** Every function takes the same escape hatch, so tests can inject a stub and
 *  a fixed clock without the module reaching for process.env at require time
 *  (TABLE_NAME is read per call, not captured — a warm container that was
 *  deployed before the variable existed would otherwise hold `undefined`). */
function ctx(opts = {}) {
  return {
    db: opts.db || defaultDb,
    tableName: opts.tableName || process.env.TABLE_NAME,
    now: opts.now instanceof Date ? opts.now : new Date(),
  };
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

/**
 * The billing period a moment falls in, as `yyyy-mm`, in UTC.
 *
 * UTC and not local time, because the answer must not depend on which region a
 * Lambda happened to run in. A session at 23:30 on 31 August in Sydney is an
 * August session for one container and a September session for another if this
 * reads a local clock, and the two would then disagree about which period's
 * ledger row already exists — which quietly breaks the idempotency above.
 */
function periodOf(date) {
  const d = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** `2026-08` -> the dates, the label the screen prints, and the days left. */
function periodBounds(period, now) {
  const [y, m] = String(period).split('-').map(Number);
  const year = Number.isFinite(y) ? y : new Date().getUTCFullYear();
  const month = Number.isFinite(m) ? m : new Date().getUTCMonth() + 1;
  // Day 0 of the NEXT month is the last day of this one, which is how February
  // and leap years get handled without a table of month lengths.
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const today = now instanceof Date ? now : new Date();
  const inThisPeriod = periodOf(today) === `${year}-${String(month).padStart(2, '0')}`;
  return {
    id: `${year}-${String(month).padStart(2, '0')}`,
    start: `${year}-${String(month).padStart(2, '0')}-01`,
    end: `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`,
    // "1–31 August 2026", en dash, as drawn on 04-billing.html.
    label: `1–${lastDay} ${MONTHS[month - 1]} ${year}`,
    daysLeft: inThisPeriod ? Math.max(0, lastDay - today.getUTCDate()) : 0,
  };
}

const usageSk = (period) => `USAGE#${period}`;
const ledgerSk = (period, kind, id) => `LEDGER#${period}#${kind}#${id}`;
/** Every ledger row for a period, whatever kind — the reconciler's query. */
const ledgerPrefix = (period, kind) => (kind ? `LEDGER#${period}#${kind}#` : `LEDGER#${period}#`);

const ZERO = Object.freeze({ sessionsRun: 0, setsCurrent: 0, setsPeak: 0 });

/**
 * Bill one session, once, ever.
 *
 * Call it on EVERY successful new-player join; the condition decides which one
 * was the first. Returns `{ billed }` — true only for the join that actually
 * created the ledger row.
 *
 * IT NEVER THROWS. The one product promise on 04-billing.html that has no
 * exceptions is "we do not block a session you are about to run in front of a
 * room", and a meter that can reject a join is a hard limit wearing a
 * disguise. A failure here is logged, left for the daily reconciler, and the
 * player joins. Losing a quarter is strictly better than losing the room.
 */
async function recordBillableSession(orgId, gameId, opts = {}) {
  const { db, tableName, now } = ctx(opts);
  const org = String(orgId || '').trim();
  const game = String(gameId || '').trim();
  // No org means an ungoverned session (a platform demo, or a row written
  // before tenancy). Nothing to bill it to, and inventing a partition would put
  // several customers' sessions in one bucket. Count nothing, say so.
  if (!org || !game) return { billed: false, reason: 'unscoped', period: periodOf(now) };

  const period = periodOf(now);
  try {
    await db.send(new PutCommand({
      TableName: tableName,
      Item: {
        PK: orgPk(org),
        SK: ledgerSk(period, 'SESSION', game),
        RecordType: 'LEDGER',
        kind: 'SESSION',
        orgId: org,
        period,
        gameId: game,
        unitCents: 1,          // one billable unit; the price is applied by pricing.js
        createdAt: now.toISOString(),
        // NO ttl. This is a financial record — see the header.
      },
      ConditionExpression: 'attribute_not_exists(SK)',
    }));
  } catch (error) {
    if (error && error.name === 'ConditionalCheckFailedException') {
      // The expected, common case: somebody already joined this session.
      return { billed: false, reason: 'already', period };
    }
    console.error(`⚠️ usage: could not write session ledger row for ${org}/${game}:`, error);
    return { billed: false, reason: 'error', period };
  }

  // The counter is derived from the ledger, so a failure here is recoverable:
  // usage-reconcile.js recounts the rows and repairs it. That is the ONLY
  // reason an ADD is acceptable on this attribute — it is guarded by a
  // conditional put that has already established this is the first time.
  try {
    await db.send(new UpdateCommand({
      TableName: tableName,
      Key: { PK: orgPk(org), SK: usageSk(period) },
      UpdateExpression: 'ADD #run :one SET #org = :org, #period = :p, #updated = :t',
      ExpressionAttributeNames: {
        '#run': 'sessionsRun', '#org': 'orgId', '#period': 'period', '#updated': 'updatedAt',
      },
      ExpressionAttributeValues: {
        ':one': 1, ':org': org, ':p': period, ':t': now.toISOString(),
      },
    }));
  } catch (error) {
    console.error(`⚠️ usage: session ${game} billed but counter not raised for ${org}:`, error);
  }
  return { billed: true, reason: 'first', period };
}

/**
 * Record how many sets an org holds right now, and ratchet the period's peak.
 *
 * `count` must be a FRESH COUNT of the partition, never a delta — see the
 * header. Two writes rather than one, and only when the count did not rise:
 *
 *   1. `SET setsCurrent = :c, setsPeak = :c` if the peak is absent or lower.
 *   2. on a failed condition, `SET setsCurrent = :c` alone.
 *
 * Without (2) a DELETION would never reach `setsCurrent`, and the screen's
 * "2 of 5" counter would sit at the high-water mark forever while the invoice
 * line correctly showed the peak — two numbers on one screen disagreeing about
 * the same thing, which is worse than either being wrong.
 */
async function recordSetCount(orgId, count, opts = {}) {
  const { db, tableName, now } = ctx(opts);
  const org = String(orgId || '').trim();
  if (!org) return { raised: false, reason: 'unscoped' };
  const c = Number.isFinite(Number(count)) ? Math.max(0, Math.trunc(Number(count))) : 0;
  const period = periodOf(now);
  const Key = { PK: orgPk(org), SK: usageSk(period) };
  const names = {
    '#cur': 'setsCurrent', '#peak': 'setsPeak',
    '#org': 'orgId', '#period': 'period', '#updated': 'updatedAt',
  };
  const values = { ':c': c, ':org': org, ':p': period, ':t': now.toISOString() };

  try {
    await db.send(new UpdateCommand({
      TableName: tableName,
      Key,
      UpdateExpression: 'SET #cur = :c, #peak = :c, #org = :org, #period = :p, #updated = :t',
      ConditionExpression: 'attribute_not_exists(#peak) OR #peak < :c',
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
    }));
    return { raised: true, period, setsCurrent: c };
  } catch (error) {
    if (!error || error.name !== 'ConditionalCheckFailedException') {
      console.error(`⚠️ usage: could not record set count for ${org}:`, error);
      return { raised: false, reason: 'error', period };
    }
  }

  try {
    await db.send(new UpdateCommand({
      TableName: tableName,
      Key,
      UpdateExpression: 'SET #cur = :c, #org = :org, #period = :p, #updated = :t',
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
    }));
  } catch (error) {
    console.error(`⚠️ usage: could not record current set count for ${org}:`, error);
    return { raised: false, reason: 'error', period };
  }
  return { raised: false, reason: 'not-a-peak', period, setsCurrent: c };
}

/** How many sets this org holds, counted from the rows. Paginates: an org with
 *  more than one page of sets is exactly the org whose peak matters. */
async function countSets(orgId, opts = {}) {
  const { db, tableName } = ctx(opts);
  const org = String(orgId || '').trim();
  if (!org) return 0;
  let total = 0;
  let ExclusiveStartKey;
  do {
    const page = await db.send(new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: { ':pk': setsMetadataPk(ORG, org), ':sk': 'SET#' },
      Select: 'COUNT',
      ExclusiveStartKey,
    }));
    total += page.Count || 0;
    ExclusiveStartKey = page.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return total;
}

/** How many sessions the LEDGER says were billed in a period. The authority. */
async function countBilledSessions(orgId, period, opts = {}) {
  const { db, tableName } = ctx(opts);
  const org = String(orgId || '').trim();
  if (!org) return 0;
  let total = 0;
  let ExclusiveStartKey;
  do {
    const page = await db.send(new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: { ':pk': orgPk(org), ':sk': ledgerPrefix(period, 'SESSION') },
      Select: 'COUNT',
      ExclusiveStartKey,
    }));
    total += page.Count || 0;
    ExclusiveStartKey = page.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return total;
}

/**
 * Repair the counter from the ledger. Absolute, never a delta — the ledger is
 * the authority and this write is the derived value catching up to it.
 * Only the reconciler calls this.
 */
async function setSessionsRun(orgId, period, count, opts = {}) {
  const { db, tableName, now } = ctx(opts);
  const org = String(orgId || '').trim();
  if (!org) return { written: false };
  await db.send(new UpdateCommand({
    TableName: tableName,
    Key: { PK: orgPk(org), SK: usageSk(period) },
    UpdateExpression: 'SET #run = :n, #org = :org, #period = :p, #updated = :t',
    ExpressionAttributeNames: {
      '#run': 'sessionsRun', '#org': 'orgId', '#period': 'period', '#updated': 'updatedAt',
    },
    ExpressionAttributeValues: {
      ':n': Math.max(0, Math.trunc(Number(count) || 0)),
      ':org': org, ':p': period, ':t': now.toISOString(),
    },
  }));
  return { written: true };
}

/**
 * The counters for a period. A period nobody used has no row, and that is a
 * zeroed period rather than an error — a new org opening the billing screen on
 * the 1st must see "$5.00 so far", not a 404.
 */
async function readUsage(orgId, period, opts = {}) {
  const { db, tableName, now } = ctx(opts);
  const org = String(orgId || '').trim();
  const p = period || periodOf(now);
  if (!org) return { orgId: '', period: p, ...ZERO };
  const found = await db.send(new GetCommand({
    TableName: tableName,
    Key: { PK: orgPk(org), SK: usageSk(p) },
  }));
  const item = found.Item || {};
  const int = (v) => (Number.isFinite(Number(v)) ? Math.max(0, Math.trunc(Number(v))) : 0);
  return {
    orgId: org,
    period: p,
    sessionsRun: int(item.sessionsRun),
    setsCurrent: int(item.setsCurrent),
    // A period that has only ever seen a current count and no peak (impossible
    // through recordSetCount, possible through a hand-edited row) still bills
    // on at least what is held now.
    setsPeak: Math.max(int(item.setsPeak), int(item.setsCurrent)),
    updatedAt: item.updatedAt || null,
  };
}

/**
 * WHAT THIS ORGANISATION MAY STILL DO — the read behind the two gates.
 *
 * One Get for the organisation's plan, one Get for the period's counters, and
 * `allowanceState` does the arithmetic. It lives here rather than in pricing.js
 * because it touches DynamoDB and pricing.js must stay importable by the React
 * console (tests/pricing.js fails the build on a `require` in that file).
 *
 * ── IT FAILS OPEN, ON PURPOSE, AND THAT IS NOT A SECURITY HOLE ─────────────
 *
 * If either read throws, this returns an UNGATED state and logs. The gate is a
 * COMMERCIAL limit, not an authorisation boundary — nothing here decides who
 * may see whose data, only whether a free account has had its five. A DynamoDB
 * blip must not stop a paying customer starting a session, and the worst case
 * of failing open is a handful of unbilled sessions that the ledger still
 * records and the reconciler still counts. Failing closed would turn a
 * transient error into "the product stopped working", which is the failure
 * RATIONALE.md §3 is written against.
 *
 * ── AND AN ORG WITH NO METADATA ROW IS NOT GATED EITHER ────────────────────
 *
 * A missing METADATA row is a half-deleted tenant or a row that predates
 * organisations. Neither is a free-tier customer who has had their five, and
 * refusing them would be refusing somebody we cannot even name.
 */
async function readAllowance(orgId, opts = {}) {
  const { db, tableName, now } = ctx(opts);
  const org = String(orgId || '').trim();
  const period = periodOf(now);

  // Unmetered and ungated, spelled once so every escape below returns the same
  // shape as the success path. `planId: 'unknown'` rather than 'team': nothing
  // downstream should be able to read this state and conclude somebody is a
  // paying customer.
  const ungated = (reason) => ({
    orgId: org,
    period,
    org: null,
    ...allowanceState({ ...TEAM_PLAN, id: 'unknown', name: 'Unknown plan' }, {}),
    reason,
  });

  // No organisation to gate. `recordBillableSession` treats the same case the
  // same way — an unscoped session is counted against nobody, so there is no
  // allowance it can exceed.
  if (!org) return ungated('unscoped');

  let orgRow = null;
  try {
    const found = await db.send(new GetCommand({
      TableName: tableName,
      Key: { PK: orgPk(org), SK: 'METADATA' },
    }));
    orgRow = found.Item || null;
  } catch (error) {
    console.error(`⚠️ usage: could not read the plan for ${org}; not gating:`, error);
    return ungated('plan-unreadable');
  }
  if (!orgRow) return ungated('no-such-org');

  let usage;
  try {
    usage = await readUsage(org, period, opts);
  } catch (error) {
    console.error(`⚠️ usage: could not read the counters for ${org}; not gating:`, error);
    return ungated('usage-unreadable');
  }

  return {
    orgId: org,
    period,
    org: orgRow,
    ...allowanceState(planFor(orgRow), usage),
  };
}

module.exports = {
  recordBillableSession, recordSetCount, readUsage, readAllowance,
  countSets, countBilledSessions, setSessionsRun,
  periodOf, periodBounds, usageSk, ledgerSk, ledgerPrefix,
};
