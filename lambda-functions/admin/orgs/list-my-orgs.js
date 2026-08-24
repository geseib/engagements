/**
 * GET /orgs — every organisation the caller belongs to.
 *
 * This is what fills the topbar switcher on `01-org-switcher.html`: an avatar,
 * a name and the caller's role in each. It is also how the front end knows
 * whether to draw a caret at all — RATIONALE.md section 3: a user in ONE
 * organisation gets the same chip with no menu, because a control whose menu
 * has one item teaches people to ignore the control.
 *
 * ── IT READS THE REVERSE PARTITION, NOT THE ORG ONES ───────────────────────
 *
 * `USER#{sub}` with `begins_with(SK, 'ORG#')` is one Query against one
 * partition. The alternative — scanning every ORG partition for a MEMBER row
 * with this sub — is a full table scan, on the request that renders the
 * chrome of every page. That is the entire reason the reverse row exists, and
 * why create/accept/remove all write it inside the same transaction as the
 * MEMBER row.
 *
 * ── AND THEN IT READS THE NAME FROM METADATA ANYWAY ────────────────────────
 *
 * The reverse row deliberately does NOT carry the organisation's name. It
 * could — one fewer read — and then renaming an organisation would leave every
 * member's switcher showing the old name until somebody wrote a backfill that
 * does not exist. So the name is fetched from the METADATA row, which is the
 * only place it is authoritative. Memberships per person are a handful (the
 * mockup shows three), so this is a handful of Gets, not a fan-out.
 *
 * A membership pointing at an organisation with no METADATA row is DROPPED,
 * not rendered blank: an unnamed entry in the switcher is unpickable and
 * unexplainable, and it would be the only visible trace of a half-deleted
 * tenant. It is logged instead.
 */

const G = require('./shared/org-guards');
const tenant = require('../shared/tenant');
const { ensurePersonalOrg } = require('./shared/personal-org');

async function listMyOrgs(event) {
  const sub = G.callerSub(event);
  // Fails closed: no identity in the authorizer context means no memberships,
  // never "all of them".
  if (!sub) return G.fail(403, 'Sign in to do this.');

  /*
    THIS IS WHERE AN APPROVED ACCOUNT GETS ITS HOME.

    There is no "belongs to no organisation" state after approval, and this
    request is where that invariant is established: GET /orgs is what draws the
    switcher, and the switcher is on every page of the console, so no screen
    can be reached before it has run. See shared/personal-org.js for why it is
    NOT in auth/post-confirmation.js — that trigger fires at email confirmation,
    which is before an administrator has approved anybody, and it would mint an
    organisation for every abandoned signup.

    It runs BEFORE the memberships are read, so the organisation it creates is
    in the list this call returns rather than appearing on the next refresh —
    a switcher that is empty once and populated a second later is indistinguish-
    able from a bug.

    It never throws and it is idempotent (a condition on the PROFILE row, not a
    check-then-write), so calling it on every page load is safe and calling it
    from two tabs at once produces one organisation.
  */
  await ensurePersonalOrg(event);

  // `tenant.orgPk('')` would throw on a blank id, so the prefix is the literal
  // 'ORG#' — the same string every reverse SK begins with. This is a PREFIX,
  // not a key: `userOrgSk` builds the whole thing.
  const memberships = await G.queryPartition(tenant.userPk(sub), 'ORG#');

  const orgs = [];
  for (const m of memberships) {
    const orgId = G.clean(m.orgId) || G.clean(m.SK).replace(/^ORG#/, '');
    if (!G.isOrgId(orgId)) continue;
    const meta = await G.getOrgMetadata(orgId);
    if (!meta) {
      console.warn(`list-my-orgs: membership ${m.SK} has no METADATA row; skipping`);
      continue;
    }
    orgs.push({
      ...G.publicOrg(meta),
      // The role comes from the MEMBERSHIP row, not from METADATA — METADATA
      // has no idea who is asking.
      yourRole: G.clean(m.role).toLowerCase(),
      joinedAt: m.joinedAt || null,
    });
  }

  // Alphabetical by name. Stable and boring on purpose: a switcher that
  // reorders itself between page loads makes people click the wrong team.
  orgs.sort((a, b) => String(a.name).localeCompare(String(b.name)));

  return G.json(200, {
    orgs,
    // The org the caller is currently acting for, so the switcher can mark it
    // without guessing. Empty when they have none — the first-run state.
    activeOrgId: tenant.callerOrgId(event),
  });
}

exports.handler = async (event) => {
  const method = event?.requestContext?.http?.method;

  // OPTIONS FIRST — a preflight carries no credentials and must not 403.
  if (method === 'OPTIONS') return G.handlePreflight();

  if (method === 'GET') return listMyOrgs(event);

  return G.fail(404, 'Endpoint not found');
};
