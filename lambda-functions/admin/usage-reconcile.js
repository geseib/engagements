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
 */
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { ORGS_INDEX_PK } = require('./shared/tenant');
const {
  countSets, countBilledSessions, recordSetCount, setSessionsRun, readUsage, periodOf,
} = require('./shared/usage');

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
 * Every organisation, from the platform's index.
 *
 * Tolerant about the row shape on purpose: it reads `orgId` if the row carries
 * one and otherwise strips the `ORG#` prefix off the sort key. The index is
 * owned elsewhere, and a reconciler that silently reconciles NOBODY because a
 * sort key gained a prefix is worse than one that copes with both spellings.
 * A run that finds no organisations at all is logged as a warning for exactly
 * that reason.
 */
async function listOrgIds() {
  const ids = [];
  let ExclusiveStartKey;
  do {
    const page = await db.send(new QueryCommand({
      TableName: process.env.TABLE_NAME,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': ORGS_INDEX_PK },
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

exports.handler = async (event = {}) => {
  // `event.now` is a test/manual-run hook only; a scheduled invocation carries
  // no such field and the real clock is used.
  const now = event.now ? new Date(event.now) : new Date();
  const period = periodOf(now);
  const previous = previousPeriod(period);

  const orgIds = await listOrgIds();
  if (!orgIds.length) console.warn('⚠️ usage-reconcile: the ORGS index returned nothing');

  const repaired = [];
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
    } catch (error) {
      // One org's failure must not stop the rest; the next run tries again.
      console.error(`⚠️ usage-reconcile: ${orgId} failed:`, error);
    }
  }

  console.log(`✅ usage-reconcile: ${orgIds.length} orgs, ${repaired.length} counters repaired`);
  return { orgs: orgIds.length, repaired };
};

module.exports.previousPeriod = previousPeriod;
