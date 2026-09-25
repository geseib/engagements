/**
 * HOW ENGAGE IS USED, IN NUMBERS — the platform console's Observability page.
 *
 * GET /platform/observability. Engage staff only: the Cognito `admins` group,
 * which is the PLATFORM group and never an org role (tenant.isPlatformAdmin).
 * The nav showing this page only in platform mode is a view; this check is the
 * permission, and authorizer.js names the route staff-only as well.
 *
 * ── AGGREGATES, AND NOTHING THAT BELONGS TO A CUSTOMER ─────────────────────
 *
 * This is the one staff route that looks across every organisation at once,
 * so it is built so that it CANNOT hand back their content, rather than so
 * that it promises not to:
 *
 *   - a tenant's SETS and REPORTS partitions are COUNTED (`Select: 'COUNT'`),
 *     which returns a number and no items — no set title or report title of
 *     theirs ever enters this Lambda;
 *   - an organisation's own partition is read only under `USAGE#`, projected
 *     to the period and the sessions counter;
 *   - the ORGS index is read for its TYPE (team or personal) only — the name
 *     it denormalises is never copied into the response;
 *   - no session partition, no set content partition and no answer is read;
 *   - the category breakdown comes from platform-metrics.js, which names only
 *     Engage's and the public library's categories and counts every team's
 *     own categories in one unnamed bucket;
 *   - the function holds DynamoDBReadPolicy and cognito-idp:ListUsers, and no
 *     kms: grant of any kind. tests/kms-grants-match-code.js derives that from
 *     the require graph, and this file requires no tenant-crypto.
 *
 * ── TWO KINDS OF NUMBER ────────────────────────────────────────────────────
 *
 * DERIVED ON READ, from data that already exists:
 *   accounts        Cognito ListUsers, paged, asking for `sub` only
 *   organisations   the ORGS index, by type
 *   question sets   COUNT of each library's set index (Engage, public, teams)
 *   stored reports  COUNT of every REPORTS index — saved PDFs still kept
 *   counted         Σ USAGE#<month>.sessionsRun across organisations: the
 *                   number each team's Plan & usage shows, by whatever rule
 *                   the plan meter (usage.js) counts a session
 *
 * RECORDED as it happens (platform-metrics.js), from deploy onwards, no
 * backfill: sessions created / started, questions served, sessions that
 * served one, answers, and the per-category counts.
 *
 * ── ONE UNREADABLE SOURCE COSTS ONE TILE ───────────────────────────────────
 *
 * Every source is read independently and a failure nulls only what depends on
 * it, listed in `unavailable` so the screen can say which number is missing
 * and why. A throttled ORGS query must not blank the recorded counters, and a
 * missing Cognito grant must not blank the table.
 *
 * ── COST ───────────────────────────────────────────────────────────────────
 *
 * Three small queries per organisation (sets COUNT, reports COUNT, USAGE#
 * counters), run eight organisations at a time. platform-orgs.js already
 * accepts one query per organisation for member counts on the same console;
 * this page is opened by a handful of staff, not on every host's page load.
 * If the estate outgrows that, the fix is counters kept by the same stream
 * consumer that keeps usage — not a Scan.
 */
const { QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { CognitoIdentityProviderClient, ListUsersCommand } = require('@aws-sdk/client-cognito-identity-provider');
const G = require('./shared/org-guards');
const tenant = require('../shared/tenant');
const { readRecordedMetrics } = require('../shared/platform-metrics');

/** Months listed, newest first. A year is what a staff screen can read. */
const MONTHS_SHOWN = 12;
/** Organisations counted at once. */
const CONCURRENCY = 8;
/** ListUsers pages before the count is reported as "at least". 60 a page. */
const MAX_USER_PAGES = 100;

let cognitoClient = null;
const cognito = () => {
  if (!cognitoClient) cognitoClient = new CognitoIdentityProviderClient({});
  return cognitoClient;
};

function requirePlatformAdmin(event) {
  if (!tenant.isPlatformAdmin(event)) return G.fail(403, 'This is an Engage staff screen.');
  return null;
}

/** Run `fn` over `items`, at most `limit` at a time, keeping order. */
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next;
      next += 1;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** Every page of a query. `input` must not carry ExclusiveStartKey. */
async function queryAll(input, onPage) {
  let ExclusiveStartKey;
  do {
    const page = await G.db.send(new QueryCommand({ TableName: G.tableName(), ...input, ExclusiveStartKey }));
    onPage(page || {});
    ExclusiveStartKey = page && page.LastEvaluatedKey;
  } while (ExclusiveStartKey);
}

/** How many rows under `pk` start with `skPrefix` — a number, never the rows. */
async function countRows(pk, skPrefix) {
  let total = 0;
  await queryAll({
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
    ExpressionAttributeValues: { ':pk': pk, ':sk': skPrefix },
    Select: 'COUNT',
  }, (page) => {
    total += Number.isFinite(page.Count) ? page.Count : ((page.Items || []).length);
  });
  return total;
}

/**
 * The ORGS index, as [{ orgId, type }] — the name it carries is dropped here.
 * ORG# rows only: the CODE#, INVOICE# and PLANREQ# rows sharing the partition
 * would each count as a team. tests/orgs-index-readers.js.
 */
async function listOrganisations() {
  const orgs = [];
  await queryAll({
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
    ExpressionAttributeValues: { ':pk': tenant.ORGS_INDEX_PK, ':sk': 'ORG#' },
  }, (page) => {
    for (const row of page.Items || []) {
      const orgId = G.clean(row.orgId) || G.clean(row.SK).replace(/^ORG#/, '');
      if (orgId) orgs.push({ orgId, type: G.clean(row.type) === 'personal' ? 'personal' : 'team' });
    }
  });
  return orgs;
}

/** One organisation's plan-meter counters: { '2026-09': 4, … }. */
async function meterFor(orgId) {
  const byPeriod = {};
  await queryAll({
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
    ExpressionAttributeValues: { ':pk': tenant.orgPk(orgId), ':sk': 'USAGE#' },
    ProjectionExpression: '#sk, #run',
    ExpressionAttributeNames: { '#sk': 'SK', '#run': 'sessionsRun' },
  }, (page) => {
    for (const row of page.Items || []) {
      const period = String(row.SK || '').replace(/^USAGE#/, '');
      if (!/^\d{4}-\d{2}$/.test(period)) continue;
      const n = Number(row.sessionsRun);
      byPeriod[period] = (byPeriod[period] || 0) + (Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0);
    }
  });
  return byPeriod;
}

/** Everything that hangs off the ORGS index, counted across the estate. */
async function readEstate() {
  const orgs = await listOrganisations();
  const [platformSets, publicSets, orglessReports] = await Promise.all([
    countRows(tenant.setsMetadataPk(tenant.PLATFORM), 'SET#'),
    countRows(tenant.setsMetadataPk(tenant.PUBLIC), 'SET#'),
    countRows(tenant.reportsIndexPk(''), 'REPORT#'),
  ]);
  const perOrg = await mapLimit(orgs, CONCURRENCY, async ({ orgId }) => {
    const [sets, reports, meter] = await Promise.all([
      countRows(tenant.setsMetadataPk(tenant.ORG, orgId), 'SET#'),
      countRows(tenant.reportsIndexPk(orgId), 'REPORT#'),
      meterFor(orgId),
    ]);
    return { sets, reports, meter };
  });

  const orgSets = perOrg.reduce((n, o) => n + o.sets, 0);
  const counted = {};
  for (const { meter } of perOrg) {
    for (const [period, n] of Object.entries(meter)) counted[period] = (counted[period] || 0) + n;
  }
  return {
    organisations: {
      teams: orgs.filter((o) => o.type === 'team').length,
      personal: orgs.filter((o) => o.type === 'personal').length,
    },
    questionSets: {
      platform: platformSets, public: publicSets, org: orgSets, total: platformSets + publicSets + orgSets,
    },
    storedReports: orglessReports + perOrg.reduce((n, o) => n + o.reports, 0),
    counted,
  };
}

/** Accounts in the user pool, every status. Asks for `sub` alone. */
async function countAccounts() {
  const UserPoolId = process.env.USER_POOL_ID;
  if (!UserPoolId) throw new Error('No USER_POOL_ID is configured for this function.');
  let count = 0;
  let PaginationToken;
  for (let pages = 0; pages < MAX_USER_PAGES; pages += 1) {
    const res = await cognito().send(new ListUsersCommand({
      UserPoolId, Limit: 60, AttributesToGet: ['sub'], ...(PaginationToken ? { PaginationToken } : {}),
    }));
    count += ((res && res.Users) || []).length;
    PaginationToken = res && res.PaginationToken;
    if (!PaginationToken) return { count, capped: false };
  }
  return { count, capped: true };
}

/** A failure, described for staff without echoing anything a customer wrote. */
const unavailableBecause = (part, error) => ({
  part,
  reason: `${(error && error.name) || 'Error'}: ${String((error && error.message) || 'could not be read').slice(0, 200)}`,
});

async function observe(event) {
  const refusal = requirePlatformAdmin(event);
  if (refusal) return refusal;

  const [estate, accounts, recorded] = await Promise.allSettled([
    readEstate(),
    countAccounts(),
    readRecordedMetrics({ db: G.db, tableName: G.tableName() }),
  ]);

  const unavailable = [];
  if (estate.status === 'rejected') {
    console.error('observability: the organisation index could not be read:', estate.reason);
    unavailable.push(unavailableBecause('organisations', estate.reason));
  }
  if (accounts.status === 'rejected') {
    console.error('observability: the user pool could not be counted:', accounts.reason);
    unavailable.push(unavailableBecause('accounts', accounts.reason));
  }
  if (recorded.status === 'rejected') {
    console.error('observability: the recorded counters could not be read:', recorded.reason);
    unavailable.push(unavailableBecause('recorded', recorded.reason));
  }

  const e = estate.status === 'fulfilled' ? estate.value : null;
  const r = recorded.status === 'fulfilled' ? recorded.value : { months: [], categories: [], countingSince: null };

  /* A month is listed when something happened in it: the meter counted a
     session, or the recorders wrote a row. Before the meter was wired every
     month's counter is 0, and a year of zeros would read as a year of nobody. */
  const recordedBy = new Map(r.months.map((m) => [m.period, m]));
  const periods = new Set(r.months.map((m) => m.period));
  if (e) for (const [period, n] of Object.entries(e.counted)) if (n > 0) periods.add(period);
  const months = [...periods].sort().reverse().slice(0, MONTHS_SHOWN).map((period) => {
    const m = recordedBy.get(period);
    return {
      period,
      counted: e ? (e.counted[period] || 0) : null,
      recorded: m ? {
        sessionsCreated: m.sessionsCreated,
        sessionsStarted: m.sessionsStarted,
        roundsServed: m.roundsServed,
        sessionsServed: m.sessionsServed,
        answersStored: m.answersStored,
        averageRounds: m.averageRounds,
      } : null,
    };
  });

  return G.json(200, {
    generatedAt: new Date().toISOString(),
    now: {
      accounts: accounts.status === 'fulfilled' ? accounts.value : null,
      organisations: e ? e.organisations : null,
      questionSets: e ? e.questionSets : null,
      storedReports: e ? e.storedReports : null,
    },
    months,
    categories: r.categories.map(({ label, library, rounds, answers }) => ({ label, library, rounds, answers })),
    countingSince: r.countingSince,
    unavailable,
  });
}

exports.handler = async (event) => {
  const method = event?.requestContext?.http?.method;
  if (method === 'OPTIONS') return G.handlePreflight();
  if (method === 'GET') {
    try {
      return await observe(event);
    } catch (error) {
      console.error('observability: unexpected failure:', error);
      return G.fail(500, 'The numbers could not be gathered.');
    }
  }
  return G.fail(404, 'Endpoint not found');
};
