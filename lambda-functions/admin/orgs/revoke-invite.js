/**
 * DELETE /orgs/{orgId}/invites/{token} — take an invitation back.
 *
 * Org admins only. Revoking IS the deletion of the row: `accept-invite.js`
 * looks the row up and refuses when it is gone, so there is no separate
 * "revoked" flag to keep in step with anything. A tombstone would be a second
 * state that accept has to remember to check, and the first refactor that
 * forgets it re-opens the link.
 *
 * ── THE TOKEN IN THE PATH MUST NAME THE ORG IN THE PATH ────────────────────
 *
 * The token carries its own orgId (org-guards.js explains why), so a request
 * can arrive naming organisation A in the path and an organisation-B token.
 * Deleting on the path's orgId alone would build a key that does not exist and
 * answer "done" while B's invitation stayed live; deleting on the TOKEN's orgId
 * alone would let an admin of A revoke B's invitations. Both are checked and
 * they must agree.
 */

const { DeleteCommand } = require('@aws-sdk/lib-dynamodb');

const tenant = require('../shared/tenant');
const G = require('./shared/org-guards');

async function revokeInvite(event) {
  const orgId = G.clean(event?.pathParameters?.orgId);

  const auth = await G.authorizeOrg(event, orgId, 'admin');
  if (auth.denied) return auth.denied;

  const token = G.clean(event?.pathParameters?.token);
  const parsed = G.parseInviteToken(token);
  if (!parsed) return G.fail(404, 'That invitation does not exist.');
  if (parsed.orgId !== orgId) {
    // Not 403 — the caller is a legitimate admin, the token simply is not
    // theirs to revoke, and saying "does not exist" refuses to confirm that
    // the token is real for somebody else.
    return G.fail(404, 'That invitation does not exist.');
  }

  try {
    await G.db.send(new DeleteCommand({
      TableName: G.tableName(),
      Key: { PK: tenant.orgPk(orgId), SK: G.inviteSk(token) },
      // Present so a revoke of something already gone is reported as such
      // rather than as a success. Two admins clicking Revoke on the same row
      // should not both be told they did it — the list they are looking at is
      // stale and they should refresh.
      ConditionExpression: 'attribute_exists(SK)',
    }));
  } catch (error) {
    if (error.name === 'ConditionalCheckFailedException') {
      return G.fail(404, 'That invitation is already gone. Refresh the list.');
    }
    console.error('revoke-invite failed:', error);
    return G.fail(500, `Could not revoke that invitation: ${error.message}`);
  }

  return G.json(200, { orgId, token, revoked: true });
}

exports.handler = async (event) => {
  const method = event?.requestContext?.http?.method;

  // OPTIONS FIRST — a preflight carries no credentials and must not 403.
  if (method === 'OPTIONS') return G.handlePreflight();

  if (method === 'DELETE') return revokeInvite(event);

  return G.fail(404, 'Endpoint not found');
};
