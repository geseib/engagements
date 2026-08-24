/**
 * DELETE /orgs/{orgId}/members/{sub} — take somebody out of an organisation.
 *
 * "Remove" on `03-team.html`. Org admins only.
 *
 * ── THE SAME LAST-OWNER RULE, FOR THE SAME REASON ──────────────────────────
 *
 * The last owner cannot be removed any more than they can be demoted. An
 * organisation with no owner cannot be administered and cannot be repaired from
 * inside the product, and unlike a demotion this one also strips the person of
 * their own tenant. The count is taken from the MEMBER rows at the moment of
 * the write, not from what the screen believed when it drew the button.
 *
 * ── TWO ROWS DIE TOGETHER ──────────────────────────────────────────────────
 *
 * MEMBER#{sub} and USER#{sub}/ORG#{orgId} are the same fact stored twice. Delete
 * only the MEMBER row and the person vanishes from the Team screen while
 * `auth/authorizer.js` — which reads the USER partition — still hands them a
 * context for the organisation they were just removed from. That is not a
 * cosmetic inconsistency; it is a removal that did not remove anything.
 *
 * Delete only the reverse row and the mirror image happens: they are locked out
 * but still listed, still counted against seats, and cannot be removed again
 * because the screen's Remove button now fails on a missing reverse row.
 *
 * So both go in one TransactWriteItems, each guarded with `attribute_exists`,
 * and the whole thing either happens or does not.
 *
 * ── A PERSONAL ORGANISATION IS NOT LEAVABLE AT ALL ─────────────────────────
 *
 * The home organisation every approved account is given cannot be left or
 * emptied — see the block in removeMember, and org-guards.js for what makes an
 * organisation personal. Note that it never becomes personal again after a
 * second member joins, so "leave the team you were invited into" keeps working
 * for everybody including its owner.
 *
 * ── AND THE DEFAULT ORG IS CLEANED UP AFTERWARDS, NOT INSIDE ───────────────
 *
 * If this was the person's `defaultOrgId`, that pointer now names a place they
 * cannot enter, and the next sign-in lands on an organisation they have no
 * membership in — which reads as "all my sets disappeared", the exact support
 * thread `09-first-run.html` was written to avoid.
 *
 * It is cleared in a SEPARATE, best-effort write with its own condition, and
 * not folded into the transaction above. A conditional Update inside a
 * transaction FAILS THE WHOLE TRANSACTION when its condition is false, so
 * "clear it only if it points here" would abort every removal of somebody whose
 * default is a different organisation — that is, almost all of them. Outside,
 * the condition failing simply means there was nothing to clean.
 */

const { TransactWriteCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');

const tenant = require('../shared/tenant');
const G = require('./shared/org-guards');

async function removeMember(event) {
  const orgId = G.clean(event?.pathParameters?.orgId);

  const auth = await G.authorizeOrg(event, orgId, 'admin');
  if (auth.denied) return auth.denied;

  const targetSub = G.clean(event?.pathParameters?.sub);
  if (!targetSub) return G.fail(400, 'Which member?');

  /*
    A PERSONAL ORGANISATION CANNOT BE LEFT, AND ITS ONE MEMBER CANNOT BE
    REMOVED — because that member is its only member, and removing them would
    leave the person's own sessions and question sets in a tenant nobody can
    enter, with no route back and no repair job that would notice.

    It is the account's home. The operation that removes it is deleting the
    ACCOUNT (manage-users.js), which is a different screen with a different
    confirmation, and this refusal exists to send the reader there rather than
    letting them arrive at the same destination by a door with no warning on it.

    Refused HERE and not by hiding the button: 03-team.html draws from a list
    that may be seconds old, and the route is reachable with curl. The
    last-owner rule below would in fact catch this case today, but it would say
    "make somebody else an owner first" — advice that leads to inviting a
    stranger into your private library in order to escape it.
  */
  const personal = G.personalOrgRefusal(auth.org, 'leave');
  if (personal) return personal;

  const members = await G.listMembers(orgId);
  const target = members.find((m) => G.clean(m.userId) === targetSub
    || G.clean(m.SK) === G.memberSk(targetSub));
  if (!target) {
    // Idempotent-ish, but honest: say the list is stale rather than reporting
    // a removal that did not happen.
    return G.fail(404, 'That person is not a member of this organisation.');
  }

  const targetRole = G.clean(target.role).toLowerCase();
  const callerRole = G.clean(auth.membership.role).toLowerCase();

  // Only an owner may remove an owner — the same asymmetry change-member-role.js
  // applies, and for the same reason: otherwise one admin can evict the person
  // who invited them and take the tenant.
  if (targetRole === 'owner' && callerRole !== 'owner') {
    return G.fail(403, 'Only an owner can remove an owner.');
  }

  // THE RULE.
  if (targetRole === 'owner' && G.ownersOf(members).length <= 1) {
    return G.fail(409,
      'This is the last owner. Make somebody else an owner first, or the organisation would have nobody who can administer it.');
  }

  try {
    await G.db.send(new TransactWriteCommand({
      TransactItems: [
        {
          Delete: {
            TableName: G.tableName(),
            Key: { PK: tenant.orgPk(orgId), SK: G.memberSk(targetSub) },
            ConditionExpression: 'attribute_exists(SK)',
          },
        },
        {
          Delete: {
            TableName: G.tableName(),
            Key: { PK: tenant.userPk(targetSub), SK: G.userOrgSk(orgId) },
            // NOT conditional. The reverse row is the one that can already be
            // missing — a membership written before this code existed, or a
            // half-applied earlier removal — and refusing to finish the job
            // because the second half is already done would leave the MEMBER
            // row permanently unremovable.
          },
        },
      ],
    }));
  } catch (error) {
    if (error.name === 'TransactionCanceledException') {
      return G.fail(409, 'That membership changed while you were looking at it. Refresh the list.');
    }
    console.error('remove-member transaction failed:', error);
    return G.fail(500, `Could not remove that person: ${error.message}`);
  }

  // Best effort, outside the transaction — see the header for why it cannot be
  // inside one.
  try {
    await G.db.send(new UpdateCommand({
      TableName: G.tableName(),
      Key: { PK: tenant.userPk(targetSub), SK: 'PROFILE' },
      UpdateExpression: 'REMOVE defaultOrgId',
      ConditionExpression: 'defaultOrgId = :orgId',
      ExpressionAttributeValues: { ':orgId': orgId },
    }));
  } catch (error) {
    if (error.name !== 'ConditionalCheckFailedException') {
      console.warn('remove-member: could not clear defaultOrgId:', error.message);
    }
  }

  return G.json(200, {
    orgId,
    userId: targetSub,
    removed: true,
    previousRole: targetRole,
  });
}

exports.handler = async (event) => {
  const method = event?.requestContext?.http?.method;

  // OPTIONS FIRST — a preflight carries no credentials and must not 403.
  if (method === 'OPTIONS') return G.handlePreflight();

  if (method === 'DELETE') return removeMember(event);

  return G.fail(404, 'Endpoint not found');
};
