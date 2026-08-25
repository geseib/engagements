/**
 * GET /orgs/{orgId} — one organisation, for its own members.
 *
 * Members only, and "member" means BOTH of the checks in
 * `org-guards.authorizeOrg`: the caller is acting for this organisation AND
 * still has a row in it. Being Engage staff is not a way in — 08-privacy.html
 * promises "we cannot do it quietly", and a staff bypass on a plain GET is
 * exactly the quiet reading that promise rules out.
 *
 * The counts come back with the record because every screen that shows an
 * organisation also shows them (the nav's "Members 2" on 03-team.html), and a
 * second round trip for two integers is a second chance to render a stale one.
 */

const G = require('./shared/org-guards');

async function getOrg(event) {
  const orgId = G.clean(event?.pathParameters?.orgId);

  const auth = await G.authorizeOrg(event, orgId, 'member');
  if (auth.denied) return auth.denied;

  const [members, invites] = await Promise.all([
    G.listMembers(orgId),
    G.listInvites(orgId),
  ]);
  const now = Date.now();

  return G.json(200, {
    org: G.publicOrg(auth.org),
    // The caller's OWN role, so the screen can decide which verbs to draw
    // without a second request. It is a convenience, never a permission: every
    // destructive route re-derives it server-side.
    yourRole: G.publicMember(auth.membership).role,
    memberCount: members.length,
    // Outstanding means NOT YET EXPIRED. Counting a dead invitation would
    // print "Two invitations are outstanding" over a list showing one.
    outstandingInvites: invites.filter((i) => !G.isExpired(i, now)).length,
  });
}

exports.handler = async (event) => {
  const method = event?.requestContext?.http?.method;

  // OPTIONS FIRST — a preflight carries no credentials and must not 403.
  if (method === 'OPTIONS') return G.handlePreflight();

  if (method === 'GET') return getOrg(event);

  return G.fail(404, 'Endpoint not found');
};
