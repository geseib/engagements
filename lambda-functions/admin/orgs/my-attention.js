/**
 * GET /me/attention — how many things wait on the caller, in each place they work.
 *
 * The console's scope tabs (components/ScopeTabs.jsx) carry a number on every
 * tab, so a team owner with three people waiting in ANOTHER team sees it
 * without opening that team (docs/design/admin-landing, open question 2,
 * owner 2026-10-11: yes, counts only).
 *
 * COUNTS ONLY. No names, no titles, no rows: the tab says "3", the Overview of
 * that scope (which runs the scope's own, already-authorised routes) shows
 * what the three are. So this never decrypts anything, and a team's content
 * never leaves through it.
 *
 * WHAT IS COUNTED is what the Overview calls "people" and "stuck" — somebody
 * waiting on you, or something of yours that cannot go ahead. "For your
 * information" boxes (a plan request in flight, reports nearing deletion, a
 * staff read of your content) are shown on the Overview but not counted: a
 * number on a tab is a request to come and act.
 *
 *   per organisation the caller belongs to
 *     owner/admin   members awaiting hosting approval (joined by this team's
 *                   invitation, accept-invite.js)
 *                   invitations running out (2 days or fewer) or already expired
 *                   the free plan's session cap reached (personal, or any
 *                   capped plan)
 *     any role      the team's sets the check sent back (share.status flagged)
 *   invites         invitations addressed to the caller's own verified email
 *   ~platform       staff only: accounts awaiting approval (Cognito `pending`,
 *                   enabled), plan requests waiting, sets waiting in Moderation
 *
 * A part that cannot be read is left out and named in `unavailable`, never
 * counted as zero and never allowed to fail the whole answer.
 *
 * Mounted on the existing OrgsListFunction (list-my-orgs.js dispatches here):
 * no new Lambda.
 */
const { ListUsersInGroupCommand, CognitoIdentityProviderClient } = require('@aws-sdk/client-cognito-identity-provider');
const { QueryCommand } = require('@aws-sdk/lib-dynamodb');

const tenant = require('../shared/tenant');
const G = require('./shared/org-guards');
const { readUsage, periodOf } = require('../shared/usage');
const { planFor } = require('../shared/pricing');
const { listQueue } = require('../shared/moderation-queue');

/** Invitations this close to running out are shown (and counted). */
const RUNNING_OUT_DAYS = 2;
const ADMIN_ROLES = ['owner', 'admin'];

let cognitoClient = null;
function cognito() {
  if (!cognitoClient) cognitoClient = new CognitoIdentityProviderClient({ region: process.env.AWS_REGION || 'us-east-1' });
  return cognitoClient;
}
/** For tests. */
function setCognito(client) { cognitoClient = client; }

/** Every row of a query, page after page (a one-call Query stops at 1 MB). */
async function queryAll(input) {
  const items = [];
  let ExclusiveStartKey;
  do {
    const res = await G.db.send(new QueryCommand({ ...input, ExclusiveStartKey }));
    items.push(...((res && res.Items) || []));
    ExclusiveStartKey = res && res.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
}

async function flaggedSets(orgId) {
  const rows = await G.queryPartition(tenant.setsMetadataPk(tenant.ORG, orgId), 'SET#');
  return rows.filter((r) => r && r.share && r.share.status === 'flagged').length;
}

/** The two halves of "people", kept apart for the inbox (my-notifications.js). */
async function teamPeopleParts(orgId, nowMs, org) {
  const [members, invites] = await Promise.all([G.listMembers(orgId), G.listInvites(orgId)]);
  // A Free team cannot approve, so its waiting invitees are not its to act on.
  const awaiting = G.canApproveHosting(org)
    ? members.filter((m) => m.awaitingHostApproval === true && m.joinedByInvite === true).length
    : 0;
  const runningOut = invites.map((row) => G.publicInvite(row, nowMs))
    .filter((i) => i.expired || (typeof i.daysUntilExpiry === 'number' && i.daysUntilExpiry <= RUNNING_OUT_DAYS))
    .length;
  return { awaiting, runningOut };
}

async function teamPeople(orgId, nowMs, org) {
  const { awaiting, runningOut } = await teamPeopleParts(orgId, nowMs, org);
  return awaiting + runningOut;
}

async function capReached(orgId, org, now) {
  const plan = planFor(org || {});
  if (plan.metersOverage === true || !Number.isFinite(plan.includedSessions)) return 0;
  const usage = await readUsage(orgId, periodOf(now), { db: G.db, now });
  return usage.sessionsRun >= plan.includedSessions ? 1 : 0;
}

async function countOrg(orgId, role, now, unavailable) {
  const org = await G.getOrgMetadata(orgId);
  if (!org) return null;
  const isAdmin = ADMIN_ROLES.includes(role);
  const parts = [flaggedSets(orgId).catch(() => { unavailable.push({ orgId, part: 'sets' }); return 0; })];
  if (isAdmin) {
    parts.push(teamPeople(orgId, now.getTime(), org).catch(() => { unavailable.push({ orgId, part: 'members' }); return 0; }));
    parts.push(capReached(orgId, org, now).catch(() => { unavailable.push({ orgId, part: 'usage' }); return 0; }));
  }
  const counts = await Promise.all(parts);
  return counts.reduce((a, b) => a + b, 0);
}

async function pendingAccounts() {
  const pool = process.env.USER_POOL_ID;
  if (!pool) throw new Error('USER_POOL_ID is not set');
  let n = 0;
  let NextToken;
  do {
    const res = await cognito().send(new ListUsersInGroupCommand({
      UserPoolId: pool, GroupName: 'pending', Limit: 60, NextToken,
    }));
    n += ((res && res.Users) || []).filter((u) => u.Enabled !== false).length;
    NextToken = res && res.NextToken;
  } while (NextToken);
  return n;
}

async function planRequestsWaiting() {
  const rows = await queryAll({
    TableName: G.tableName(),
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
    ExpressionAttributeValues: { ':pk': tenant.ORGS_INDEX_PK, ':sk': 'PLANREQ#requested#' },
  });
  return rows.length;
}

async function platformCount(unavailable) {
  const parts = await Promise.all([
    pendingAccounts().catch((e) => { unavailable.push({ orgId: '~platform', part: 'accounts', reason: e.message }); return 0; }),
    planRequestsWaiting().catch(() => { unavailable.push({ orgId: '~platform', part: 'planrequests' }); return 0; }),
    listQueue(G.db, G.tableName()).then((rows) => rows.length)
      .catch(() => { unavailable.push({ orgId: '~platform', part: 'moderation' }); return 0; }),
  ]);
  return parts.reduce((a, b) => a + b, 0);
}

async function myAttention(event, { now = new Date() } = {}) {
  const sub = G.callerSub(event);
  if (!sub) return G.fail(403, 'Sign in to do this.');

  const unavailable = [];
  const scopes = {};

  const memberships = await G.queryPartition(tenant.userPk(sub), 'ORG#');
  await Promise.all(memberships.map(async (m) => {
    const orgId = G.clean(m.orgId) || G.clean(m.SK).replace(/^ORG#/, '');
    if (!G.isOrgId(orgId)) return;
    try {
      const n = await countOrg(orgId, G.clean(m.role).toLowerCase(), now, unavailable);
      if (n !== null) scopes[orgId] = n;
    } catch (error) {
      unavailable.push({ orgId, part: 'organisation' });
    }
  }));

  /* Staff only, by the GROUP: the count is about Engage's queues, which every
     platform route already refuses to anybody outside `admins`. */
  if (tenant.isPlatformAdmin(event)) {
    scopes['~platform'] = await platformCount(unavailable);
  }

  let invites = 0;
  const email = G.callerVerifiedEmail(event);
  if (email) {
    try { invites = (await G.listInvitesFor(email, now.getTime())).length; } catch (error) {
      unavailable.push({ orgId: '', part: 'invites' });
    }
  }

  return G.json(200, { scopes, invites, unavailable });
}

const isAttentionRoute = (event) => /\/me\/attention$/.test(String(event?.requestContext?.http?.path || event?.rawPath || ''));

module.exports = {
  myAttention, isAttentionRoute, setCognito, RUNNING_OUT_DAYS,
  // For the inbox, which says WHAT waits rather than how many.
  flaggedSets, teamPeopleParts, capReached, pendingAccounts, planRequestsWaiting, ADMIN_ROLES,
};
