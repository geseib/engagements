/**
 * GET /platform/stats — Engage staff open ONE team, ONE account or ONE set
 * (docs/design/usage-stats/SPEC.md §9; mockups B2–B4). Dispatched from
 * platform-orgs.js, the function that already writes staff audit entries.
 *
 *   ?org=<orgId>[&from&to]       one team: months by type, kept sessions,
 *                                members, its sets (by ref, never by id)
 *   ?user=<sub>[&from&to]        one account, in every team it hosts for
 *   ?set=<scope>:<org>:<id|ref>  one set: every version and the total
 *                                (an org set by its 8-hex ref)
 *   ?library=platform|public     a library's sets, by use (names plaintext:
 *                                Engage's and published content only)
 *
 * TWO CHECKS. authorizer.js names the route ['admins'], and this handler
 * re-asks `tenant.isPlatformAdmin` — the PLATFORM group, never an org role.
 *
 * LOGGED FIRST (owner, 2026-10-04 and 2026-10-11, SPEC §13 Q3). Opening one
 * team, one of its sets, or one account writes `recordAudit` (action
 * `stats.viewed`, role platform-admin) BEFORE a row is read, and refuses with
 * 503 if the entry cannot be written. No reason is asked: these are numbers,
 * not content. A library's totals are not logged.
 *
 * COUNTS, NEVER CONTENT. Every row read here holds ids and numbers
 * (platform-metrics.js), names come from the ORGS index, MEMBER rows and the
 * plaintext platform/public SETS index only, and a team set's id is replaced
 * by `staffSetRef` before it leaves. This file and the view module require no
 * tenant-crypto (tests/usage-stats-routes.js).
 */
const { QueryCommand, GetCommand } = require('@aws-sdk/lib-dynamodb');
const G = require('./shared/org-guards');
const tenant = require('../shared/tenant');
const M = require('../shared/platform-metrics');
const V = require('../shared/usage-stats-view');
const { recordAudit, actorFromEvent } = require('../shared/audit-log');

const opts = () => ({ db: G.db, tableName: G.tableName() });

/** Write the audit entry, or answer the refusal. null when it was written. */
async function logged(event, { orgId, target, detail }) {
  try {
    await recordAudit(G.db, {
      orgId: orgId || '',
      action: 'stats.viewed',
      actor: actorFromEvent(event, 'platform-admin'),
      target,
      detail,
    });
    return null;
  } catch (e) {
    console.error('platform-stats: refused, the audit entry could not be written:', e);
    return G.fail(503, 'Nothing was shown: this visit could not be recorded in the audit log. Try again.');
  }
}

/** The name staff already see on Organisations, from the ORGS index row. */
async function orgSummary(orgId) {
  const res = await G.db.send(new GetCommand({
    TableName: G.tableName(),
    Key: { PK: tenant.ORGS_INDEX_PK, SK: tenant.orgPk(orgId) },
  }));
  const row = (res && res.Item) || {};
  return {
    orgId,
    name: G.clean(row.name),
    plan: G.clean(row.plan) || 'free',
    type: G.clean(row.type) || 'team',
    createdAt: row.createdAt || null,
  };
}

async function oneTeam(event, orgId, range) {
  if (!G.isOrgId(orgId)) return G.fail(400, 'That is not an organisation id.');
  const refusal = await logged(event, { orgId, target: { type: 'org', id: orgId }, detail: { from: range.from, to: range.to } });
  if (refusal) return refusal;
  const o = opts();
  const [summary, team, members, setRows] = await Promise.all([
    orgSummary(orgId),
    V.teamMonths(orgId, range, o),
    G.listMembers(orgId).then((rows) => V.memberRows(orgId, rows.map(G.publicMember), range, o)),
    M.readSetStats({ scope: tenant.ORG, orgId }, o),
  ]);
  return G.json(200, {
    org: summary,
    from: range.from,
    to: range.to,
    countingSince: team.countingSince,
    months: team.months,
    members,
    sets: V.sealSetIds(orgId, V.groupSets(setRows)),
  });
}

/** Display name and email for an account, from its MEMBER row in a team it is in. */
async function accountName(sub, orgIds) {
  for (const orgId of orgIds) {
    if (!orgId) continue;
    const row = await G.getMembership(orgId, sub);
    if (row) return { displayName: G.clean(row.displayName), email: G.clean(row.email) };
  }
  return { displayName: '', email: '' };
}

async function oneAccount(event, sub, range) {
  if (!/^[\w-]{1,128}$/.test(sub)) return G.fail(400, 'That is not an account id.');
  const refusal = await logged(event, { orgId: '', target: { type: 'user', id: sub }, detail: { from: range.from, to: range.to } });
  if (refusal) return refusal;
  const { rows } = await M.readScopeStats('account', sub, range, opts());
  const orgIds = [...new Set(rows.map((r) => r.orgId || ''))];
  const periods = V.periodsBetween(range.from, range.to).reverse();
  const [teams, name] = await Promise.all([
    Promise.all(orgIds.map(async (orgId) => (orgId
      ? orgSummary(orgId)
      : { orgId: '', name: '', plan: '', type: 'none' }))),
    accountName(sub, orgIds),
  ]);
  const months = periods.map((period) => ({
    period,
    teams: orgIds.map((orgId) => {
      const mine = rows.filter((r) => r.period === period && (r.orgId || '') === orgId);
      const m = V.monthOf(mine, period);
      return { orgId, byType: m.byType, totals: m.totals, events: m.events, gauge: m.gauge };
    }),
  }));
  return G.json(200, {
    account: { userId: sub, ...name },
    teams,
    from: range.from,
    to: range.to,
    months,
  });
}

/** A platform or public set's name, plaintext by design. Never an org set's. */
async function sharedSetName(scope, setId) {
  const res = await G.db.send(new GetCommand({
    TableName: G.tableName(),
    Key: { PK: tenant.setsMetadataPk(scope), SK: `SET#${setId}` },
    ProjectionExpression: '#n, #t, #a',
    ExpressionAttributeNames: { '#n': 'name', '#t': 'engagementType', '#a': 'activeVersion' },
  }));
  const row = (res && res.Item) || {};
  return {
    name: typeof row.name === 'string' ? row.name : '',
    engagementType: G.clean(row.engagementType),
    activeVersion: Number.isFinite(Number(row.activeVersion)) ? Number(row.activeVersion) : null,
  };
}

async function oneSet(event, spec) {
  const [scope, orgId = '', id = ''] = String(spec).split(':');
  if (![tenant.PLATFORM, tenant.PUBLIC, tenant.ORG].includes(scope)) return G.fail(400, 'set must look like platform::<id>, public::<id> or org:<orgId>:<ref>.');
  const ref = G.clean(id);
  if (!ref) return G.fail(400, 'Which set?');
  if (scope === tenant.ORG) {
    if (!G.isOrgId(orgId)) return G.fail(400, 'That is not an organisation id.');
    if (!/^[0-9a-f]{8}$/.test(ref)) return G.fail(400, 'A team set is opened by its ref.');
    const refusal = await logged(event, { orgId, target: { type: 'org', id: orgId }, detail: { set: ref } });
    if (refusal) return refusal;
    // The team's set rows, matched by ref: the id itself never leaves.
    const rows = await M.readSetStats({ scope, orgId }, opts());
    const found = V.sealSetIds(orgId, V.groupSets(rows)).find((s) => s.ref === ref);
    if (!found) return G.fail(404, 'No numbers for that set.');
    return G.json(200, { set: { scope, orgId, ...found, name: '', engagementType: '', activeVersion: null }, org: await orgSummary(orgId) });
  }
  const rows = await M.readSetStats({ scope, setId: ref }, opts());
  const [grouped] = V.groupSets(rows.filter((r) => r.setId === ref));
  const meta = await sharedSetName(scope, ref);
  return G.json(200, {
    set: {
      scope, orgId: '', setId: ref, ...meta,
      versions: grouped ? grouped.versions : [],
      total: grouped ? grouped.total : { sessions: 0, questions: 0, copies: 0, downloads: 0, lastAt: null },
    },
  });
}

async function oneLibrary(scope) {
  if (![tenant.PLATFORM, tenant.PUBLIC].includes(scope)) return G.fail(400, 'library must be platform or public.');
  const sets = V.groupSets(await M.readSetStats({ scope }, opts()));
  // Names from the library's own index, one paged Query, projected.
  const names = new Map();
  let ExclusiveStartKey;
  do {
    const page = await G.db.send(new QueryCommand({
      TableName: G.tableName(),
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: { ':pk': tenant.setsMetadataPk(scope), ':sk': 'SET#' },
      ProjectionExpression: '#sk, #n',
      ExpressionAttributeNames: { '#sk': 'SK', '#n': 'name' },
      ExclusiveStartKey,
    }));
    for (const row of (page && page.Items) || []) {
      names.set(String(row.SK || '').replace(/^SET#/, ''), typeof row.name === 'string' ? row.name : '');
    }
    ExclusiveStartKey = page && page.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return G.json(200, { library: scope, sets: sets.map((s) => ({ ...s, name: names.get(s.setId) || '' })) });
}

async function platformStats(event) {
  if (!tenant.isPlatformAdmin(event)) return G.fail(403, 'This is an Engage staff screen.');
  const q = event?.queryStringParameters || {};
  try {
    if (q.set) return await oneSet(event, q.set);
    if (q.library) return await oneLibrary(G.clean(q.library));
    const range = V.parseRange(q, new Date());
    if (range.error) return G.fail(400, range.error);
    if (q.org) return await oneTeam(event, G.clean(q.org), range);
    if (q.user) return await oneAccount(event, G.clean(q.user), range);
    return G.fail(400, 'Say which: ?org=, ?user=, ?set= or ?library=.');
  } catch (e) {
    console.error('platform-stats: failed:', e);
    return G.fail(500, 'The numbers could not be gathered.');
  }
}

module.exports = { platformStats };
