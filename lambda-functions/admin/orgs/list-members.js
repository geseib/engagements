/**
 * GET /orgs/{orgId}/members — the Team screen, `03-team.html`.
 *
 * Returns TWO lists, not one, because the screen draws two and the design note
 * says why: an outstanding invitation and a joined member need different verbs
 * — Resend/Revoke against Make admin/Remove — and merging them into one table
 * with a greyed row makes both harder to act on.
 *
 * ── WHAT THE SCREEN NEEDS THAT THE ROWS DO NOT CARRY ───────────────────────
 *
 * `daysUntilExpiry`. The row stores `expiresAt`; the screen prints
 * "11 days ago · expires in 3". The arithmetic is done HERE rather than in the
 * browser so that every surface showing an invitation shows the same number —
 * and because a client clock that is three days out would otherwise quietly
 * offer a Resend on an invitation that is already dead.
 *
 * `canDemote` / `canRemove` on each member. THE LAST OWNER CANNOT BE DEMOTED OR
 * REMOVED, and 03-team.html renders that as an absence of buttons plus a reason
 * in the row ("You · the last owner") rather than as a disabled control — "a
 * dead button is a thing people click twice and then write in about". The flags
 * exist so the screen can make that absence without re-deriving the rule.
 *
 * THEY ARE NOT THE ENFORCEMENT. `change-member-role.js` and `remove-member.js`
 * each re-check the rule against the rows at the moment of the write. A hidden
 * button is not a permission: the request can be sent by hand, and by the time
 * it arrives another tab may have removed the other owner.
 *
 * ── MEMBERS ONLY, NOT ADMINS ───────────────────────────────────────────────
 *
 * Reading the roster is a member's business — the mockup's own copy is "3
 * people can host for Northwind Learning", which is orientation, not
 * administration. The verbs are what needs an admin, and each verb guards
 * itself.
 */

const G = require('./shared/org-guards');

async function listOrgMembers(event) {
  const orgId = G.clean(event?.pathParameters?.orgId);

  const auth = await G.authorizeOrg(event, orgId, 'member');
  if (auth.denied) return auth.denied;

  const [memberRows, inviteRows] = await Promise.all([
    G.listMembers(orgId),
    G.listInvites(orgId),
  ]);
  const now = Date.now();

  const ownerCount = G.ownersOf(memberRows).length;

  const members = memberRows.map((row) => {
    const m = G.publicMember(row);
    // The last owner is protected in both directions. `ownerCount <= 1` rather
    // than `=== 1` so that a partition somehow holding ZERO owners also refuses
    // to shed the row that might be one — the safe direction to round.
    const lastOwner = m.role === 'owner' && ownerCount <= 1;
    return {
      ...m,
      isLastOwner: lastOwner,
      canDemote: !lastOwner,
      canRemove: !lastOwner,
      // The reason, in the row. The screen prints it instead of a disabled
      // button; sending it from here keeps the wording in one place.
      lockReason: lastOwner ? 'the last owner' : null,
      you: m.userId === G.callerSub(event),
    };
  });

  // Owners first, then admins, then members; alphabetically within a role.
  // The order on 03-team.html, and it is the order that makes "who can I ask
  // about this?" answerable by looking at the top of the list.
  const RANK = { owner: 0, admin: 1, member: 2 };
  members.sort((a, b) => (RANK[a.role] ?? 9) - (RANK[b.role] ?? 9)
    || String(a.displayName || a.email).localeCompare(String(b.displayName || b.email)));

  // Expired invitations are RETURNED, flagged, not filtered out. They are the
  // only rows an admin can revoke, and DynamoDB's TTL sweep is allowed to take
  // up to 48 hours — dropping them here would leave a row nobody can see and
  // nobody can delete, and would silently block re-inviting that address.
  const invites = inviteRows
    .map((row) => G.publicInvite(row, now))
    .sort((a, b) => String(a.invitedAt).localeCompare(String(b.invitedAt)));

  return G.json(200, {
    orgId,
    members,
    invites,
    memberCount: members.length,
    outstandingInvites: invites.filter((i) => !i.expired).length,
    yourRole: G.publicMember(auth.membership).role,
  });
}

exports.handler = async (event) => {
  const method = event?.requestContext?.http?.method;

  // OPTIONS FIRST — a preflight carries no credentials and must not 403.
  if (method === 'OPTIONS') return G.handlePreflight();

  if (method === 'GET') return listOrgMembers(event);

  return G.fail(404, 'Endpoint not found');
};
