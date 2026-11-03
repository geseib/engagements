/**
 * IS THIS CALLER, AND THE ORGANISATION THEY ARE ACTING FOR, IN GOOD STANDING?
 *
 * THE ONE PLACE A SUSPENSION IS ENFORCED FOR SIGNED-IN CALLERS (#40, #43).
 *
 * Before this file, Suspend asked for a reason and audited it (5fc325d5) and
 * then nothing read the status: `platform-orgs.js` wrote `status: 'suspended'`
 * onto the org's METADATA and every member carried on hosting. A disabled
 * account fared slightly better only by accident — the old Disable also
 * stripped every Cognito group, so the group gate refused it — and that is why
 * "Reinstate" could only ever mean "give it a role again".
 *
 * Enforcing it in each handler would be the same check written a hundred
 * times, and the handler that forgets it does not fail loudly. The authorizer
 * already runs on every signed-in request and already reads both rows this
 * needs (the PROFILE row for `defaultOrgId`, the memberships for `orgId`), so
 * it is the choke point. This module is the DECISION, kept pure so every case
 * is a line in a test; `authorizer.js` does the reads and applies the answer.
 *
 * ── WHAT IS REFUSED ────────────────────────────────────────────────────────
 *
 *   ACCOUNT_SUSPENDED  the account's PROFILE row carries `suspended: true`
 *                      (admin/manage-users.js writes it on Suspend and removes
 *                      it on Reinstate). Every authorized route, staff routes
 *                      included: a suspended Engage admin is suspended.
 *   ORG_SUSPENDED      the organisation this request is ACTING FOR has
 *                      `status: 'suspended'` on its METADATA. Every authorized
 *                      route acting for it — host routes, sets, sessions,
 *                      reports, events, the org's own settings.
 *
 * ── WHAT IS NOT ────────────────────────────────────────────────────────────
 *
 *   - THE STANDING ROUTE, `GET /orgs`. It is how the console learns WHY it was
 *     refused: the authorizer admits it with `suspension` on the context and
 *     list-my-orgs.js answers with the code. Without one admitted route the
 *     only signal a suspended host could ever get is API Gateway's bare
 *     `{"message":"Forbidden"}` — an HTTP API simple-response authorizer cannot
 *     put a body on its refusal.
 *   - ENGAGE STAFF ON STAFF ROUTES. A route only `admins` may reach (the
 *     platform console: Organisations, Accounts, audit, billing) is not the
 *     suspended organisation's route, and Reinstate is one of them. Staff on a
 *     HOST route acting for a suspended org are refused like a member: being
 *     Engage staff is not membership (tenant.js says so for sessions too).
 *   - THE CALLER'S OTHER ORGANISATIONS. A host in a suspended team keeps their
 *     personal space and any other team. The suspended org is taken out of
 *     `orgIds`, so `tenant.callerMayDriveSession` cannot let them drive that
 *     team's sessions from another library either.
 *
 * ── A FAILED READ DOES NOT DENY ────────────────────────────────────────────
 *
 * Same rule, same reason, as the membership lookup in authorizer.js: this
 * function gates the whole API, and a DynamoDB blip must not become an outage.
 * A read that throws counts as "not suspended" and is logged. The account half
 * has a second lock regardless: Suspend also disables the Cognito account, so
 * no new token can be had once the current one runs out.
 */

const STANDING_ROUTE = 'GET orgs';

const CODES = Object.freeze({
  ACCOUNT: 'ACCOUNT_SUSPENDED',
  ORG: 'ORG_SUSPENDED',
});

function clean(v) {
  return typeof v === 'string' ? v.trim() : '';
}

/** Is this the one route a suspended caller is still admitted to? */
function isStandingRoute(method, path) {
  return `${method} ${path}` === STANDING_ROUTE;
}

/** A route only Engage staff may knock on (requiredGroupsForRoute answered ['admins']). */
function isStaffOnlyRoute(requiredGroups) {
  return Array.isArray(requiredGroups) && requiredGroups.length === 1 && requiredGroups[0] === 'admins';
}

/** True when a PROFILE row says the account is suspended. */
function profileSuspended(profile) {
  return Boolean(profile && (profile.suspended === true || profile.suspended === 'true'));
}

/** True when an org METADATA row says the organisation is suspended. */
function orgRowSuspended(meta) {
  return clean(meta && meta.status).toLowerCase() === 'suspended';
}

/**
 * The decision.
 *
 * @param {object} p
 * @param {boolean} p.accountSuspended  PROFILE.suspended
 * @param {Set<string>|string[]} p.suspendedOrgIds  the caller's member orgs that are suspended
 * @param {{orgId:string, role:string}|null} p.active  pickActiveOrg's answer over ALL memberships
 * @param {Array<{orgId:string}>} p.memberships
 * @param {string[]} p.groups
 * @param {string[]} p.requiredGroups
 * @param {string} p.method
 * @param {string} p.path
 * @returns {{ refuse: string, suspension: string, suspendedOrgId: string,
 *             orgId: string, orgRole: string, orgIds: string }}
 *   `refuse` is a code when the request must be denied, else ''. When it is
 *   admitted, `orgId/orgRole/orgIds` are what the context carries, and
 *   `suspension` is set only on the standing route.
 */
function decideStanding(p) {
  const suspendedSet = new Set(p.suspendedOrgIds || []);
  const memberships = Array.isArray(p.memberships) ? p.memberships : [];
  const usable = memberships
    .map((m) => clean(m && m.orgId))
    .filter((id) => id && !suspendedSet.has(id));
  const active = p.active || null;
  const standing = isStandingRoute(p.method, p.path);
  const staff = (p.groups || []).includes('admins') && isStaffOnlyRoute(p.requiredGroups);

  const admitted = {
    refuse: '',
    suspension: '',
    suspendedOrgId: '',
    orgId: active ? active.orgId : '',
    orgRole: active ? active.role : '',
    orgIds: usable.join(','),
  };

  if (p.accountSuspended) {
    if (!standing) return { ...admitted, refuse: CODES.ACCOUNT };
    // Admitted to say why, and to nothing else: no org to act for.
    return { ...admitted, suspension: CODES.ACCOUNT, orgId: '', orgRole: '', orgIds: '' };
  }

  if (active && suspendedSet.has(active.orgId)) {
    if (staff) {
      // Staff routes keep the context they had; the platform console must be
      // able to see and reinstate the very organisation that is suspended.
      return { ...admitted, orgIds: memberships.map((m) => clean(m && m.orgId)).filter(Boolean).join(',') };
    }
    if (standing) {
      return { ...admitted, suspension: CODES.ORG, suspendedOrgId: active.orgId, orgId: '', orgRole: '' };
    }
    return { ...admitted, refuse: CODES.ORG, suspendedOrgId: active.orgId };
  }

  return admitted;
}

module.exports = {
  CODES,
  STANDING_ROUTE,
  isStandingRoute,
  isStaffOnlyRoute,
  profileSuspended,
  orgRowSuspended,
  decideStanding,
};
