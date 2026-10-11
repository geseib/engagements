/**
 * POST /orgs/{orgId}/members/{sub}/approve — a team lets somebody it invited host.
 *
 * The owner, 2026-10-11: "if the account is a team it's a 'paid' account; it's
 * their responsibility." Until now only Engage staff moved an account from
 * `pending` to `hosts` (manage-users.js changeUserState), so a team owner could
 * see that a person they invited could not host and do nothing about it.
 *
 * WHAT LIMITS IT, each one checked here and never trusted from the screen:
 *
 *   1. The caller is an owner or admin OF THIS TEAM (authorizeOrg 'admin':
 *      the active-org context and the MEMBER row both).
 *   2. The person is a member of THIS TEAM who joined through its invitation
 *      while still pending: the MEMBER row carries `joinedByInvite` and
 *      `awaitingHostApproval` (accept-invite.js). A team cannot approve
 *      somebody who signed up on their own, or who joined another team.
 *   3. The account, read live from Cognito, is enabled and in `pending`. An
 *      account Engage has rejected is DISABLED, and a team must never undo
 *      that: refused, and the stale flag is cleared so the box goes.
 *   4. The audit entry is written FIRST, into the team's own log, and a
 *      failure to write it refuses the change (owner, 2026-10-04: every staff
 *      and delete action is recorded before it happens; the same rule here).
 *
 * Engage can still reject: staff's Accounts screen lists the person as a host
 * and Reject disables the account, exactly as before.
 *
 * Mounted on the existing UserManagementFunction (it already holds the Cognito
 * permissions and the audit log's kms:Decrypt), routed BEFORE that handler's
 * staff-only gate because the caller here is a customer, not Engage.
 */
const {
  ListUsersCommand,
  AdminListGroupsForUserCommand,
  AdminAddUserToGroupCommand,
  AdminRemoveUserFromGroupCommand,
} = require('@aws-sdk/client-cognito-identity-provider');
const { UpdateCommand } = require('@aws-sdk/lib-dynamodb');

const tenant = require('../shared/tenant');
const G = require('./shared/org-guards');
const { recordAudit, markAuditOutcome, actorFromEvent, auditRoleForOrgRole } = require('../shared/audit-log');

const ROUTE_RE = /\/orgs\/[^/]+\/members\/[^/]+\/approve$/;

/** Is this request the team approval route? */
function isApproveRoute(event) {
  const path = String(event?.requestContext?.http?.path || event?.rawPath || '');
  return ROUTE_RE.test(path);
}

/** The Cognito account whose sub this is, or null. Subs never contain a quote. */
async function accountBySub(cognito, userPoolId, sub) {
  if (!/^[A-Za-z0-9_-]+$/.test(sub)) return null;
  const res = await cognito.send(new ListUsersCommand({
    UserPoolId: userPoolId,
    Filter: `sub = "${sub}"`,
    Limit: 1,
  }));
  const user = (res.Users || [])[0];
  return user || null;
}

/** Take the queue flag off one membership. Never fatal. */
async function clearFlag(orgId, sub, extra = {}) {
  const sets = Object.keys(extra).map((k) => `${k} = :${k}`);
  await G.db.send(new UpdateCommand({
    TableName: G.tableName(),
    Key: { PK: tenant.orgPk(orgId), SK: G.memberSk(sub) },
    UpdateExpression: `${sets.length ? `SET ${sets.join(', ')} ` : ''}REMOVE awaitingHostApproval`,
    ...(sets.length ? {
      ExpressionAttributeValues: Object.fromEntries(Object.entries(extra).map(([k, v]) => [`:${k}`, v])),
    } : {}),
    ConditionExpression: 'attribute_exists(PK)',
  }));
}

async function approveMember(event, { cognito, userPoolId }) {
  const orgId = G.clean(event?.pathParameters?.orgId);
  const sub = G.clean(event?.pathParameters?.sub);

  const auth = await G.authorizeOrg(event, orgId, 'admin');
  if (auth.denied) return auth.denied;

  const member = await G.getMembership(orgId, sub);
  if (!member) return G.fail(404, 'That person is not a member of this team.');
  if (member.joinedByInvite !== true) {
    return G.fail(403, 'Only Engage can approve this person: they did not join through this team’s invitation.');
  }
  if (member.awaitingHostApproval !== true) {
    return G.json(200, { approved: true, already: true, member: G.publicMember(member) });
  }

  const user = await accountBySub(cognito, userPoolId, sub);
  if (!user) return G.fail(404, 'That account no longer exists.');
  if (user.Enabled === false) {
    try { await clearFlag(orgId, sub); } catch (error) { console.warn('approve-member: could not clear a stale flag:', error.message); }
    return G.fail(409, 'Engage has turned this account off, so it cannot be approved here.');
  }
  const groupsRes = await cognito.send(new AdminListGroupsForUserCommand({
    UserPoolId: userPoolId, Username: user.Username,
  }));
  const groups = (groupsRes.Groups || []).map((g) => g.GroupName);
  if (groups.includes('hosts') || groups.includes('admins')) {
    // Engage got there first. Nothing to change but the queue.
    try { await clearFlag(orgId, sub); } catch (error) { console.warn('approve-member: could not clear a stale flag:', error.message); }
    return G.json(200, { approved: true, already: true, member: G.publicMember({ ...member, awaitingHostApproval: false }) });
  }

  const role = G.clean(auth.membership && auth.membership.role).toLowerCase();
  let auditRef;
  try {
    auditRef = await recordAudit(G.db, {
      orgId,
      action: 'member.approve-hosting',
      actor: actorFromEvent(event, auditRoleForOrgRole(role)),
      target: { type: 'user', id: sub, title: member.email || member.displayName || sub },
      detail: { from: 'pending', to: 'hosts' },
    });
  } catch (error) {
    console.error('approve-member refused: the audit entry could not be written:', error);
    return G.fail(503, 'Nothing was changed: the approval could not be recorded in the team’s log. Try again.');
  }

  try {
    if (groups.includes('pending')) {
      await cognito.send(new AdminRemoveUserFromGroupCommand({
        UserPoolId: userPoolId, Username: user.Username, GroupName: 'pending',
      }));
    }
    await cognito.send(new AdminAddUserToGroupCommand({
      UserPoolId: userPoolId, Username: user.Username, GroupName: 'hosts',
    }));
  } catch (error) {
    await markAuditOutcome(G.db, auditRef, 'failed');
    console.error('approve-member: Cognito refused the move:', error);
    return G.fail(500, 'The approval could not be saved. Nothing else changed; try again.');
  }

  const now = new Date().toISOString();
  try {
    await clearFlag(orgId, sub, { hostApprovedAt: now, hostApprovedBy: G.callerSub(event) });
  } catch (error) {
    // They CAN host now; only the queue row lags, and the next approve clears it.
    console.warn('approve-member: approved, but the queue flag stayed:', error.message);
  }
  return G.json(200, {
    approved: true,
    already: false,
    member: G.publicMember({ ...member, awaitingHostApproval: false }),
  });
}

/**
 * Take `awaitingHostApproval` off every membership of this account. Called by
 * manage-users.js when Engage moves an account out of `pending` (approve,
 * make admin, reject), so a team's box never offers to approve somebody Engage
 * already decided about. Best effort: a failure leaves a box the approve route
 * then clears on its own checks.
 */
async function clearAwaitingEverywhere(sub) {
  const clean = G.clean(sub);
  if (!clean) return 0;
  const memberships = await G.queryPartition(tenant.userPk(clean), 'ORG#');
  let cleared = 0;
  for (const m of memberships) {
    const orgId = G.clean(m.orgId) || G.clean(m.SK).replace(/^ORG#/, '');
    if (!G.isOrgId(orgId)) continue;
    try {
      await G.db.send(new UpdateCommand({
        TableName: G.tableName(),
        Key: { PK: tenant.orgPk(orgId), SK: G.memberSk(clean) },
        UpdateExpression: 'REMOVE awaitingHostApproval',
        ConditionExpression: 'attribute_exists(awaitingHostApproval)',
      }));
      cleared += 1;
    } catch (error) {
      if (error.name !== 'ConditionalCheckFailedException') {
        console.warn(`clearAwaitingEverywhere: ${orgId}:`, error.message);
      }
    }
  }
  return cleared;
}

module.exports = { approveMember, isApproveRoute, clearAwaitingEverywhere, accountBySub };
