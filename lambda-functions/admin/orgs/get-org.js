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
const { readAudit } = require('../shared/audit-log');

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

/**
 * GET /orgs/{orgId}/audit — this organisation's audit log (shared/audit-log.js):
 * who changed what here, newest first, one page at a time.
 *
 * An OWNER or ADMIN of the organisation, acting for it — the same two checks
 * as above, at 'admin'. For a personal space that is its one owner, so a
 * person sees what was done to their own account. A plain member is refused:
 * the log carries billing and moderation decisions, which are powers, not
 * information (consoleSections.js keeps Data & privacy from members too).
 *
 * No staff bypass, for the reason in this file's header. Engage staff read an
 * organisation's log from the platform side (GET /platform/audit?orgId=),
 * behind the staff-only authorizer rule.
 */
async function getAudit(event) {
  const orgId = G.clean(event?.pathParameters?.orgId);
  const auth = await G.authorizeOrg(event, orgId, 'admin');
  if (auth.denied) return auth.denied;
  const q = event?.queryStringParameters || {};
  try {
    const page = await readAudit(G.db, { orgId, limit: q.limit, cursor: q.cursor });
    return G.json(200, { orgId, ...page });
  } catch (e) {
    if (e && e.statusCode === 400) return G.fail(400, e.message);
    console.error('get-org: audit read failed:', e);
    return G.fail(500, 'The audit log could not be read.');
  }
}

const isAuditPath = (event) => /\/audit$/.test(String(event?.rawPath || event?.routeKey || ''));

exports.handler = async (event) => {
  const method = event?.requestContext?.http?.method;

  // OPTIONS FIRST — a preflight carries no credentials and must not 403.
  if (method === 'OPTIONS') return G.handlePreflight();

  if (method === 'GET' && isAuditPath(event)) return getAudit(event);
  if (method === 'GET') return getOrg(event);

  return G.fail(404, 'Endpoint not found');
};
