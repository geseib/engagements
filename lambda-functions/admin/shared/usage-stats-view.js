/**
 * THE USAGE STATS, SHAPED FOR A SCREEN — docs/design/usage-stats/SPEC.md §9.
 *
 * Read-only. Turns the counter, gauge and set rows platform-metrics.js keeps
 * into what the team's Activity page and the staff screens show. Shared by
 * GET /orgs/{orgId}/stats (get-usage.js, a team's owners and admins) and
 * GET /platform/stats (orgs/platform-stats.js, Engage staff).
 *
 * WHAT THIS CANNOT DO, BY CONSTRUCTION. It requires no tenant-crypto and so
 * cannot decrypt anything (tests/usage-stats-routes.js pins it). The rows it
 * reads hold ids and numbers; the team's set NAMES are joined in the browser
 * from the set list the console already holds, decrypted for the member, and
 * staff never see a team set's id at all — `staffSetRef` stands in for it
 * (owner, 2026-10-11, SPEC §13 Q14: a team set's id is its slug, and a slug
 * can echo the title the team typed).
 *
 * Every read is a key Query on one partition. Nothing here Scans.
 */
const crypto = require('crypto');
const { QueryCommand } = require('@aws-sdk/lib-dynamodb');
const M = require('./platform-metrics');
const { orgPk } = require('./tenant');

/** Months one request may span. A two-year view is the most a screen reads. */
const MAX_MONTHS = 24;
const PERIOD_RE = /^\d{4}-\d{2}$/;

/** `yyyy-mm` plus `n` months (n may be negative), in UTC. */
function addMonths(period, n) {
  const [y, m] = String(period).split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Every period from `from` to `to`, inclusive, oldest first. */
function periodsBetween(from, to) {
  const out = [];
  for (let p = from; p <= to && out.length <= MAX_MONTHS; p = addMonths(p, 1)) out.push(p);
  return out;
}

/**
 * The range a request asked for, checked. Defaults: `to` this month, `from`
 * five months before it (the screen's "last six months").
 * @returns {{from, to}|{error}}
 */
function parseRange(query = {}, now = new Date()) {
  const q = query || {};
  const to = String(q.to || q.month || '').trim() || M.periodOf(now);
  if (!PERIOD_RE.test(to)) return { error: 'to must look like 2026-10' };
  const from = String(q.from || '').trim() || addMonths(to, -5);
  if (!PERIOD_RE.test(from)) return { error: 'from must look like 2026-05' };
  if (from > to) return { error: 'from must not be after to' };
  if (periodsBetween(from, to).length > MAX_MONTHS) return { error: `ask for ${MAX_MONTHS} months at most` };
  return { from, to };
}

/** Counters as the screens read them: the seven numbers, integers. */
const blank = () => M.countersOf({});

/** Sum a gauge's `existing` map. */
const keptOf = (existing) => Object.values(existing || {}).reduce((n, v) => n + (Number(v) || 0), 0);

/**
 * One month of one scope: by type (event row kept apart), the sum over the
 * types, and the gauge if one was written.
 */
function monthOf(rows, period) {
  const byType = {};
  let events = null;
  let gauge = null;
  for (const r of rows) {
    if (r.period !== period) continue;
    if (r.kind === 'gauge') {
      gauge = { existing: r.existing, setsHeld: r.setsHeld, kept: keptOf(r.existing), snapshotAt: r.snapshotAt, ...(r.teams !== undefined ? { teams: r.teams } : {}) };
      continue;
    }
    if (r.type === M.EVENT_TYPE) { events = r.counters; continue; }
    byType[r.type] = r.counters;
  }
  const typeRows = Object.entries(byType).map(([type, counters]) => ({ kind: 'type', type, counters }));
  return {
    period,
    recorded: typeRows.length > 0 || Boolean(events),
    byType,
    totals: M.sumCounters(typeRows),
    events: events || blank(),
    gauge,
  };
}

/** The plan meter's months (USAGE#), for the months before counting began. */
async function planMonths(db, tableName, orgId) {
  const out = {};
  let ExclusiveStartKey;
  do {
    const page = await db.send(new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: { ':pk': orgPk(orgId), ':sk': 'USAGE#' },
      ExclusiveStartKey,
    }));
    for (const item of (page && page.Items) || []) {
      const period = String(item.SK || '').replace(/^USAGE#/, '');
      if (!PERIOD_RE.test(period)) continue;
      const int = (v) => (Number.isFinite(Number(v)) ? Math.max(0, Math.trunc(Number(v))) : 0);
      out[period] = { sessionsRun: int(item.sessionsRun), setsPeak: Math.max(int(item.setsPeak), int(item.setsCurrent)) };
    }
    ExclusiveStartKey = page && page.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return out;
}

/**
 * A team's months, newest first. A month with no recorded rows carries the
 * plan's counted sessions (`plan`), labelled on the screen "from your plan";
 * a recorded month carries `plan` too, for reference, and never mixes it in.
 */
async function teamMonths(orgId, { from, to }, opts) {
  const { rows, firstRecordedAt } = await M.readScopeStats('team', orgId, { from, to }, opts);
  const plan = await planMonths(opts.db, opts.tableName, orgId);
  const months = periodsBetween(from, to).reverse().map((period) => ({
    ...monthOf(rows, period),
    plan: plan[period] || null,
  }));
  return { months, countingSince: firstRecordedAt };
}

/** One account's rows for one team, by month: totals (events left out) and the gauge. */
function accountMonthsForOrg(rows, orgId, periods) {
  const out = {};
  for (const period of periods) {
    const mine = rows.filter((r) => r.period === period && (r.orgId || '') === (orgId || ''));
    const m = monthOf(mine, period);
    out[period] = {
      totals: m.totals,
      setsHeld: m.gauge ? m.gauge.setsHeld : null,
      kept: m.gauge ? m.gauge.kept : null,
    };
  }
  return out;
}

/**
 * Each member's numbers for this team, one Query of each member's own
 * partition (their rows carry the team in the key — SPEC §6.1).
 */
async function memberRows(orgId, members, { from, to }, opts) {
  const periods = periodsBetween(from, to).reverse();
  const out = [];
  for (const m of members) {
    const { rows } = await M.readScopeStats('account', m.userId, { from, to }, opts);
    out.push({ ...m, months: accountMonthsForOrg(rows, orgId, periods) });
  }
  return out;
}

/** Group set rows by set: every version, newest first, and the total. */
function groupSets(rows) {
  const bySet = new Map();
  for (const r of rows) {
    if (!bySet.has(r.setId)) bySet.set(r.setId, []);
    bySet.get(r.setId).push(r);
  }
  return [...bySet.entries()].map(([setId, versions]) => {
    versions.sort((a, b) => b.version - a.version);
    const total = { sessions: 0, questions: 0, copies: 0, downloads: 0, lastAt: null };
    for (const v of versions) {
      for (const k of ['sessions', 'questions', 'copies', 'downloads']) total[k] += v[k];
      if (v.lastAt && (!total.lastAt || v.lastAt > total.lastAt)) total.lastAt = v.lastAt;
    }
    return {
      setId,
      versions: versions.map(({ version, sessions, questions, copies, downloads, lastAt }) => ({
        version, sessions, questions, copies, downloads, lastAt,
      })),
      total,
    };
  }).sort((a, b) => (b.total.sessions - a.total.sessions) || (b.total.questions - a.total.questions) || a.setId.localeCompare(b.setId));
}

/**
 * What staff see INSTEAD of a team set's id: "Team set" plus the first 8 hex
 * of a SHA-256 of `<org>:<id>`. Stable, so a link can carry it; one-way, so a
 * slug that echoes a sealed title never reaches a staff screen.
 */
function staffSetRef(orgId, setId) {
  return crypto.createHash('sha256').update(`${orgId}:${setId}`).digest('hex').slice(0, 8);
}

/** A team's sets as staff see them: the id replaced by its ref. */
function sealSetIds(orgId, sets) {
  return sets.map(({ setId, ...rest }) => ({ ref: staffSetRef(orgId, setId), ...rest }));
}

module.exports = {
  MAX_MONTHS,
  addMonths,
  periodsBetween,
  parseRange,
  monthOf,
  keptOf,
  planMonths,
  teamMonths,
  accountMonthsForOrg,
  memberRows,
  groupSets,
  staffSetRef,
  sealSetIds,
};
