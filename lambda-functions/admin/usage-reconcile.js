/**
 * THE BACKSTOP. Runs daily; recomputes what the live meters derive.
 *
 * Everything here is also done in real time by usage.js and usage-stream.js.
 * This exists because both of those can miss:
 *
 *   - a stream shard can drop a notification, or its consumer can be throttled,
 *     or a batch can fail after this month's peak has already gone up;
 *   - `recordBillableSession` writes the LEDGER row and the COUNTER as two
 *     writes, deliberately (a transaction there would let a metering failure
 *     refuse a player's join, which the product promises never to do). So the
 *     counter can be one behind the ledger.
 *
 * Both gaps are repairable because in both cases the meter's answer is DERIVED
 * from rows that are still there: sets from the org's SETS partition, sessions
 * from the org's LEDGER rows. This handler recomputes both and writes the
 * result absolutely. Running it twice in a row changes nothing.
 *
 * ── THE ONE ASYMMETRY, AND IT MATTERS ──────────────────────────────────────
 *
 * SESSIONS are reconciled for the current period AND the previous one. Ledger
 * rows carry the period in their own key, so counting August's rows in
 * September is exact, and it is the only way a session billed in the last hour
 * of a month gets its counter repaired at all.
 *
 * SETS are reconciled for the CURRENT period ONLY. Today's set count is
 * evidence about today and about nothing else: writing it into last month's
 * peak would overwrite a closed measurement with an unrelated number — and
 * since the peak only ratchets upward, an org that grew since the 1st would
 * have last month's invoice silently revised upward. A closed period's peak is
 * final.
 *
 * ── THE GAP THIS DOES NOT CLOSE ────────────────────────────────────────────
 *
 * Between midnight UTC on the 1st and this handler's first run, a new period
 * has no peak, so a set DELETED in that window before any other stream event
 * would never be counted for the month it was held in. A daily schedule makes
 * that window hours wide; `rate(1 hour)` would make it minutes. The cost of the
 * job is one query per org, so raising the frequency is cheap if it ever
 * matters.
 *
 * ── THE USAGE STATS' TWO LEVELS (usage-stats SPEC §6.2) ────────────────────
 *
 * Sessions still kept and sets held are LEVELS, not events, so counters
 * cannot keep them. This run writes them as absolute snapshots for each org —
 * the team row and one per account — then the platform's sum, last. One paged
 * Query of the org's session index and one of its set index, both plaintext
 * attributes only; `SET`, never `ADD`, so a rerun changes nothing. On the 1st
 * the same snapshot also closes the month just ended (its month-end figure).
 * A failure here is logged and costs that org's gauges only: the meter and
 * the invoice above it are not held up by a dashboard.
 *
 * ── EVERY 3 HOURS, ONCE A DAY (the report sweep, 2026-10-31) ───────────────
 *
 * The stack is near CloudFormation's 500-resource ceiling, so the automatic
 * report sweep rides THIS function's one schedule rather than a rule of its
 * own. The rule fires every 3 hours (template-clean.yaml, rate(3 hours)).
 *
 * The usage job still runs ONCE A DAY: the first scheduled run of each UTC
 * day takes `SCHEDULE#usage-reconcile / DAY#<yyyy-mm-dd>` with a conditional
 * put and runs; every later run that day finds it and skips. A rate schedule
 * fires every 3h from whenever the rule was created, so "when the hour is 0"
 * could miss every day; the first-run-of-the-day claim cannot, and it lands
 * within 3h of midnight — the 1st of the month is still the 1st. If the run
 * fails outright the claim is released so the next run tries again. (The job
 * is idempotent anyway, so a duplicate delivery could not double-count.)
 * A manual or test invocation (no `source: 'aws.events'`) runs it at once.
 *
 * The SWEEP runs on every scheduled run: an asynchronous invoke of
 * CreateReportFunction with `{ __reportSweep: true }`
 * (game/report-sweep.js). It lives in game/ because it builds through
 * create-report.js, and the bundler confines each function to its own folder.
 */
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient, QueryCommand, PutCommand, DeleteCommand,
} = require('@aws-sdk/lib-dynamodb');
const { ORGS_INDEX_PK } = require('./shared/tenant');
const { closeInvoice } = require('./shared/invoices');
const {
  countSets, countBilledSessions, recordSetCount, setSessionsRun, readUsage, periodOf,
} = require('./shared/usage');
const { snapshotOrgGauges, writePlatformGauge } = require('./shared/platform-metrics');

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

/** The period before `yyyy-mm`. December rolls the year back. */
function previousPeriod(period) {
  const [y, m] = String(period).split('-').map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m)) return period;
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

/**
 * Every organisation, from the platform's index: its `ORG#` rows ONLY.
 *
 * The partition also holds promo codes (CODE#), invoice pointers
 * (INVOICE#<period>#<orgId>) and the plan-request queue (PLANREQ#). Read them
 * as organisations and a code gets reconciled and invoiced — dev closed
 * INVOICE#2026-08#CODE#WELCOME26 that way — and every org with an invoice or a
 * request is handed to closeInvoice more than once. tests/orgs-index-readers.js.
 *
 * Within an ORG# row it reads `orgId` if the row carries one and otherwise
 * strips the prefix off the sort key. A run that finds no organisations at all
 * is logged as a warning: reconciling NOBODY is the silent failure.
 */
async function listOrgIds() {
  const ids = [];
  let ExclusiveStartKey;
  do {
    const page = await db.send(new QueryCommand({
      TableName: process.env.TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: { ':pk': ORGS_INDEX_PK, ':sk': 'ORG#' },
      ExclusiveStartKey,
    }));
    for (const item of page.Items || []) {
      const id = String(item.orgId || String(item.SK || '').replace(/^ORG#/, '') || '').trim();
      if (id) ids.push(id);
    }
    ExclusiveStartKey = page.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return ids;
}

/** EventBridge's scheduled event; anything else is a manual or test run. */
const isScheduled = (event) => !!event && (event.source === 'aws.events' || event['detail-type'] === 'Scheduled Event');

const USAGE_DAY_PK = 'SCHEDULE#usage-reconcile';
const usageDayKey = (now) => ({ PK: USAGE_DAY_PK, SK: `DAY#${now.toISOString().slice(0, 10)}` });

/** Take today's usage run. True when this run is the day's first. */
async function claimUsageDay(now) {
  try {
    await db.send(new PutCommand({
      TableName: process.env.TABLE_NAME,
      Item: { ...usageDayKey(now), startedAt: now.toISOString(), ttl: Math.floor(now.getTime() / 1000) + 8 * 86400 },
      ConditionExpression: 'attribute_not_exists(PK)',
    }));
    return true;
  } catch (error) {
    if (error && error.name === 'ConditionalCheckFailedException') return false;
    throw error;
  }
}

async function releaseUsageDay(now) {
  try {
    await db.send(new DeleteCommand({ TableName: process.env.TABLE_NAME, Key: usageDayKey(now) }));
  } catch (error) {
    console.error('⚠️ usage-reconcile: could not release today\'s claim:', error && error.message);
  }
}

/**
 * Start the automatic report sweep (game/report-sweep.js) on
 * CreateReportFunction, asynchronously. Never throws: the usage job is not
 * held up by a report.
 */
async function startReportSweep(now) {
  const functionName = process.env.REPORT_SWEEP_FUNCTION_NAME;
  if (!functionName) return { started: false, reason: 'no REPORT_SWEEP_FUNCTION_NAME' };
  try {
    const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda');
    await new LambdaClient({}).send(new InvokeCommand({
      FunctionName: functionName,
      InvocationType: 'Event',
      Payload: Buffer.from(JSON.stringify({ __reportSweep: true, now: now.toISOString() })),
    }));
    console.log('🧾 usage-reconcile: report sweep started');
    return { started: true };
  } catch (error) {
    console.error('⚠️ usage-reconcile: the report sweep was not started:', error && error.message);
    return { started: false, reason: error && error.message };
  }
}

exports.handler = async (event = {}) => {
  // `event.now` is a test/manual-run hook only; a scheduled invocation carries
  // no such field and the real clock is used.
  const now = event.now ? new Date(event.now) : new Date();
  if (!isScheduled(event)) return reconcileUsage(now);

  // Every 3 hours: the report sweep; once a day: the usage job.
  const reportSweep = await startReportSweep(now);
  if (!(await claimUsageDay(now))) {
    console.log('ℹ️ usage-reconcile: already ran today; report sweep only');
    return { usage: 'already-ran-today', reportSweep };
  }
  try {
    return { ...(await reconcileUsage(now)), reportSweep };
  } catch (error) {
    await releaseUsageDay(now);
    throw error;
  }
};

/** The daily usage job, exactly as it ran nightly before the sweep. */
async function reconcileUsage(now) {
  const period = periodOf(now);
  const previous = previousPeriod(period);

  const orgIds = await listOrgIds();
  if (!orgIds.length) console.warn('⚠️ usage-reconcile: the ORGS index returned nothing');

  const repaired = [];
  // The gauges: this month's, and on the 1st the closing figure of the last.
  const gaugePeriods = now.getUTCDate() === 1 ? [previous, period] : [period];
  const platform = { existing: {}, setsHeld: 0, teams: 0 };
  for (const orgId of orgIds) {
    try {
      // Sets: current period only. See the header.
      const sets = await countSets(orgId, { db });
      await recordSetCount(orgId, sets, { db, now });

      // Sessions: this period and the last, from the ledger, absolutely.
      for (const p of [period, previous]) {
        const billed = await countBilledSessions(orgId, p, { db });
        const counted = await readUsage(orgId, p, { db, now });
        if (billed === counted.sessionsRun) continue;
        // A period with no ledger rows and no counter is simply a quiet month;
        // writing a zero row for every org every day would be noise.
        if (!billed && !counted.sessionsRun) continue;
        // AN EMPTY LEDGER NEVER ZEROES A COUNTER. The ledger row is written
        // BEFORE the counter is raised, so "no rows at all, but a counter above
        // zero" is a state this code cannot produce — which means something
        // else produced it (a migration, a hand-edit, a partition this run
        // could not see). Trusting the empty answer would delete the only
        // record of a month's activity, and unlike an over-count that is not
        // recoverable. Shout, and leave the number alone.
        if (!billed && counted.sessionsRun > 0) {
          console.error(`🚨 usage-reconcile: ${orgId} ${p} counts ${counted.sessionsRun} sessions with NO ledger rows — leaving it alone`);
          continue;
        }
        await setSessionsRun(orgId, p, billed, { db, now });
        repaired.push({ orgId, period: p, was: counted.sessionsRun, now: billed });
        console.warn(`🔧 usage-reconcile: ${orgId} ${p} sessionsRun ${counted.sessionsRun} -> ${billed}`);
      }
      // THE PREVIOUS MONTH'S INVOICE, closed once (shared/invoices.js). Runs
      // AFTER the counters above are reconciled, so it freezes the repaired
      // numbers; a conditional put makes every later night a no-op.
      const closed = await closeInvoice({ db, tableName: process.env.TABLE_NAME, orgId, period: previous, now });
      if (closed.written) console.log(`🧾 usage-reconcile: ${orgId} ${previous} invoice ${closed.doc.number} closed at ${closed.doc.totalDisplay}`);
    } catch (error) {
      // One org's failure must not stop the rest; the next run tries again.
      console.error(`⚠️ usage-reconcile: ${orgId} failed:`, error);
    }
    try {
      const levels = await snapshotOrgGauges(orgId, { periods: gaugePeriods }, { db, now });
      let kept = 0;
      for (const [type, n] of Object.entries(levels.existing)) {
        platform.existing[type] = (platform.existing[type] || 0) + n;
        kept += n;
      }
      platform.setsHeld += levels.setsHeld;
      if (kept > 0) platform.teams += 1;
    } catch (error) {
      console.error(`⚠️ usage-reconcile: ${orgId} usage-stats gauges not written:`, error);
    }
  }

  try {
    await writePlatformGauge({ periods: gaugePeriods, ...platform }, { db, now });
  } catch (error) {
    console.error('⚠️ usage-reconcile: the platform usage-stats gauge was not written:', error);
  }

  console.log(`✅ usage-reconcile: ${orgIds.length} orgs, ${repaired.length} counters repaired`);
  return { orgs: orgIds.length, repaired };
}

module.exports.previousPeriod = previousPeriod;
module.exports.isScheduled = isScheduled;
module.exports.USAGE_DAY_PK = USAGE_DAY_PK;
