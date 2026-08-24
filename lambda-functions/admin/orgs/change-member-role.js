/**
 * PUT /orgs/{orgId}/members/{sub}/role — change what somebody may do here.
 *
 * "Make admin" / "Make member" on `03-team.html`. Org admins only.
 *
 * ── THE LAST OWNER CANNOT BE DEMOTED ───────────────────────────────────────
 *
 * The mockup renders this as an ABSENCE — no button, and a reason in the row
 * ("You · the last owner") rather than a disabled control, because "a dead
 * button is a thing people click twice and then write in about".
 *
 * THIS HANDLER MUST REFUSE IT ANYWAY, and the reason is not paranoia about
 * hand-written requests (though the request can be hand-written). It is that
 * the screen decided from a list it fetched, and between that fetch and this
 * write another admin in another tab may have removed the other owner. The only
 * moment the count means anything is the moment of the write, and this is it.
 *
 * What the rule protects: an organisation whose owners all become members is
 * unadministrable and cannot be repaired from inside the product — nobody can
 * promote anybody, because promoting requires the role nobody has left.
 *
 * ── AND ONLY AN OWNER MAY TOUCH AN OWNER ───────────────────────────────────
 *
 * An extra restriction beyond "org admin only", chosen in the safe direction:
 * an admin may promote and demote members and admins, but GRANTING `owner`, or
 * changing an owner's role at all, requires the caller to be an owner. Without
 * it a single admin can promote themselves to owner and then demote the real
 * owner — a complete takeover of a tenant by somebody who was invited to help
 * run it. The mockup never draws an admin acting on an owner, so nothing on
 * screen loses a verb.
 */

const { TransactWriteCommand } = require('@aws-sdk/lib-dynamodb');

const tenant = require('../shared/tenant');
const G = require('./shared/org-guards');

async function changeMemberRole(event) {
  const orgId = G.clean(event?.pathParameters?.orgId);

  const auth = await G.authorizeOrg(event, orgId, 'admin');
  if (auth.denied) return auth.denied;

  const targetSub = G.clean(event?.pathParameters?.sub);
  if (!targetSub) return G.fail(400, 'Which member?');

  const body = G.parseBody(event);
  if (!body) return G.fail(400, 'That request body is not JSON.');

  const role = G.clean(body.role).toLowerCase();
  if (!tenant.ORG_ROLES.includes(role)) {
    // Refused, never defaulted. A typo'd role quietly becoming `member` is a
    // silent demotion; quietly becoming `admin` is a silent promotion. Both
    // are worse than a 400.
    return G.fail(400, `Role must be one of: ${tenant.ORG_ROLES.join(', ')}.`);
  }

  const members = await G.listMembers(orgId);
  const target = members.find((m) => G.clean(m.userId) === targetSub
    || G.clean(m.SK) === G.memberSk(targetSub));
  if (!target) return G.fail(404, 'That person is not a member of this organisation.');

  const currentRole = G.clean(target.role).toLowerCase();
  const callerRole = G.clean(auth.membership.role).toLowerCase();

  if (currentRole === role) {
    // Idempotent. Two clicks, or a stale screen re-asserting what is already
    // true, is not an error.
    return G.json(200, { member: G.publicMember({ ...target, role }), changed: false });
  }

  // Ownership is owners' business — see the header.
  if ((currentRole === 'owner' || role === 'owner') && callerRole !== 'owner') {
    return G.fail(403, 'Only an owner can change who owns this organisation.');
  }

  // THE RULE. Counted from the rows, here, at the moment of the write.
  const owners = G.ownersOf(members);
  if (currentRole === 'owner' && role !== 'owner' && owners.length <= 1) {
    return G.fail(409,
      'This is the last owner. Make somebody else an owner first, or the organisation would have nobody who can administer it.');
  }

  const now = new Date().toISOString();

  try {
    await G.db.send(new TransactWriteCommand({
      TransactItems: [
        {
          Update: {
            TableName: G.tableName(),
            Key: { PK: tenant.orgPk(orgId), SK: G.memberSk(targetSub) },
            UpdateExpression: 'SET #r = :role, roleChangedAt = :now',
            ExpressionAttributeNames: { '#r': 'role' },
            ExpressionAttributeValues: { ':role': role, ':now': now },
            // An Update CREATES the row when it is absent. Without this
            // condition a request naming somebody who was removed a second ago
            // would resurrect them as a member with no email and no joinedAt.
            ConditionExpression: 'attribute_exists(SK)',
          },
        },
        {
          // THE REVERSE ROW MOVES IN THE SAME TRANSACTION, and it is the one
          // that actually matters: `auth/authorizer.js` reads USER#{sub} to
          // build the caller's context, so a MEMBER row updated alone changes
          // what the Team screen SAYS about somebody without changing what
          // they can DO. The two disagreeing is undetectable from either side.
          Update: {
            TableName: G.tableName(),
            Key: { PK: tenant.userPk(targetSub), SK: G.userOrgSk(orgId) },
            UpdateExpression: 'SET #r = :role, roleChangedAt = :now',
            ExpressionAttributeNames: { '#r': 'role' },
            ExpressionAttributeValues: { ':role': role, ':now': now },
            ConditionExpression: 'attribute_exists(SK)',
          },
        },
      ],
    }));
  } catch (error) {
    if (error.name === 'TransactionCanceledException') {
      return G.fail(409, 'That membership changed while you were looking at it. Refresh the list.');
    }
    console.error('change-member-role transaction failed:', error);
    return G.fail(500, `Could not change that role: ${error.message}`);
  }

  return G.json(200, {
    member: G.publicMember({ ...target, role }),
    changed: true,
    previousRole: currentRole,
  });
}

exports.handler = async (event) => {
  const method = event?.requestContext?.http?.method;

  // OPTIONS FIRST — a preflight carries no credentials and must not 403.
  if (method === 'OPTIONS') return G.handlePreflight();

  if (method === 'PUT') return changeMemberRole(event);

  return G.fail(404, 'Endpoint not found');
};
