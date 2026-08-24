/**
 * GET /orgs/{orgId}/usage — the numbers behind 04-billing.html.
 *
 * The screen shows an invoice as arithmetic: four lines that add up, each
 * naming the quantity it came from. So this endpoint returns the quantities AND
 * the lines, computed by the same `projectInvoice` the console imports. Two
 * implementations of one sum is how a screen and a bill start disagreeing, and
 * the customer only ever finds out from the one that took their money.
 *
 * Nothing here is a forecast — the words on the screen are "Updated as sessions
 * run. Nothing here is a forecast." `total` is what the period costs IF IT
 * ENDED NOW, and the field is named `totalIfPeriodEndedToday` so nobody renders
 * it under a heading that promises otherwise.
 *
 * ── WHO MAY READ IT ────────────────────────────────────────────────────────
 *
 * A member of the organisation, and only while acting for it. Not Engage staff:
 * `readableScopes` in tenant.js deliberately gives a platform admin no extra
 * scope, and usage is a statement about a customer's activity — how often they
 * meet, how much they store. Reading it is reading them. There is no
 * `?orgId=anything` route in here for support to use; that access is the
 * written-reason, four-hour, logged request drawn on 10-platform-orgs.html.
 */
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { callerOrgId } = require('./shared/tenant');
const { readUsage, periodOf, periodBounds, usageSk } = require('./shared/usage');
const { TEAM_PLAN, projectInvoice } = require('./shared/pricing');

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
};

const respond = (statusCode, body) => ({
  statusCode,
  headers: cors,
  body: JSON.stringify(body),
});

/**
 * The closed periods, newest first, for the "Recent periods" table.
 * Descending by sort key, which for `USAGE#yyyy-mm` is descending by date —
 * that is the whole reason the period is zero-padded in the key.
 */
async function recentPeriods(orgId, currentPeriod, limit = 12) {
  const page = await db.send(new QueryCommand({
    TableName: process.env.TABLE_NAME,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
    ExpressionAttributeValues: { ':pk': `ORG#${orgId}`, ':sk': 'USAGE#' },
    ScanIndexForward: false,
    Limit: limit + 1,
  }));
  return (page.Items || [])
    .filter((item) => item.SK !== usageSk(currentPeriod))
    .slice(0, limit)
    .map((item) => {
      const usage = {
        sessionsRun: Math.max(0, Math.trunc(Number(item.sessionsRun) || 0)),
        setsPeak: Math.max(0, Math.trunc(Number(item.setsPeak) || 0)),
      };
      const invoice = projectInvoice(TEAM_PLAN, usage);
      return {
        period: String(item.SK).replace(/^USAGE#/, ''),
        sessionsRun: usage.sessionsRun,
        // The column is headed "Sets held", not "sets stored", because what was
        // charged is the peak — same word as the sentence under the invoice.
        setsHeld: usage.setsPeak,
        chargedCents: invoice.totalCents,
        chargedDisplay: invoice.totalDisplay,
      };
    });
}

exports.handler = async (event) => {
  try {
    if (event?.requestContext?.http?.method === 'OPTIONS') {
      return {
        statusCode: 200,
        headers: { ...cors, 'Access-Control-Allow-Headers': 'Content-Type,Authorization', 'Access-Control-Allow-Methods': 'GET, OPTIONS' },
        body: '',
      };
    }

    const wanted = String(event?.pathParameters?.orgId || '').trim();
    const acting = callerOrgId(event);
    if (!wanted) return respond(400, { error: 'Which organisation?' });
    // Same shape as tenant.js's guards: a caller acting for another org, or for
    // none, is refused identically. No membership-vs-existence distinction is
    // leaked — "not yours" and "not there" answer the same.
    if (!acting || acting !== wanted) {
      return respond(403, { error: 'Only a member of this organisation can see its usage.' });
    }

    const now = new Date();
    const period = String(event?.queryStringParameters?.period || '').trim() || periodOf(now);
    if (!/^\d{4}-\d{2}$/.test(period)) return respond(400, { error: 'period must look like 2026-08' });

    const usage = await readUsage(wanted, period, { db, now });
    const invoice = projectInvoice(TEAM_PLAN, usage);
    const bounds = periodBounds(period, now);

    return respond(200, {
      orgId: wanted,
      plan: {
        id: TEAM_PLAN.id,
        name: TEAM_PLAN.name,
        currency: TEAM_PLAN.currency,
        baseCents: TEAM_PLAN.base,
        perSessionCents: TEAM_PLAN.perSession,
        perSetCents: TEAM_PLAN.perSet,
      },
      period: bounds,
      // Both counters. `setsCurrent` is what the "2 of 5" meter shows; setsPeak
      // is what the invoice line bills. They are usually equal and the screen
      // must not assume it — that assumption is what makes a deleted set look
      // like a billing error.
      usage: {
        sessionsRun: usage.sessionsRun,
        setsCurrent: usage.setsCurrent,
        setsPeak: usage.setsPeak,
        updatedAt: usage.updatedAt,
      },
      allowances: {
        sessions: TEAM_PLAN.includedSessions,
        sets: TEAM_PLAN.includedSets,
      },
      overage: {
        sessions: Math.max(0, usage.sessionsRun - TEAM_PLAN.includedSessions),
        sets: Math.max(0, usage.setsPeak - TEAM_PLAN.includedSets),
      },
      lines: invoice.lines,
      totalIfPeriodEndedTodayCents: invoice.totalCents,
      totalIfPeriodEndedTodayDisplay: invoice.totalDisplay,
      // "Storage is charged on the highest number of sets you held at once this
      // period, not the number at the end." Shipped with the numbers rather
      // than hardcoded in the console, so the rule and the arithmetic that
      // implements it can never be changed independently of one another.
      storageRule: 'peak',
      history: await recentPeriods(wanted, period),
    });
  } catch (error) {
    console.error('get-usage failed:', error);
    return respond(500, { error: 'Could not read usage' });
  }
};
