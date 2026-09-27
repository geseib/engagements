import { authFetch, getActiveOrgId } from '../auth/authFetch';
import { adminApiUrl } from './adminApi';
import pricing from '../../../lambda-functions/game/pricing';

const { planFor, upgradePlanFor } = pricing;

/**
 * MAY THIS HOST MAKE AN EVENT HERE? — for the host's own screens, which have
 * no console around them to have read GET /orgs already.
 *
 * The owner, 27 Sep 2026: "there is still no way to create an agenda for the
 * host. only the admin". An event could be made only from the console's
 * Events section; the host's main screen listed events to open and nothing
 * else. Any member of a space on a paid plan may make one (create-event.js),
 * so the host's screen asks the same two questions the console does:
 *
 *   - is Events switched on for this tier (GET /orgs `features.events`), and
 *   - is the organisation the host is acting for on a plan that runs events
 *     (pricing.js `allowsEvents` — Standard or Organisation, never Free)?
 *
 * The acting organisation is the one authFetch sends (`getActiveOrgId`),
 * else the person's own space, else the first they belong to — the order the
 * console reconciles a remembered choice in.
 *
 * Never throws: a list that cannot be read is "not switched on", which draws
 * nothing, exactly as the Events block already did for a failed GET /events.
 *
 * @returns {Promise<{ enabled: boolean, canCreate: boolean, offerPlanName: string }>}
 */
export async function readEventsAccess() {
  const none = { enabled: false, canCreate: false, offerPlanName: '' };
  try {
    const res = await authFetch(adminApiUrl('orgs'));
    if (!res.ok) return none;
    const data = await res.json();
    const enabled = Boolean(data && data.features && data.features.events === true);
    const orgs = Array.isArray(data && data.orgs) ? data.orgs : [];
    const wanted = getActiveOrgId();
    const org = orgs.find((o) => o.orgId === wanted)
      || orgs.find((o) => o.type === 'personal')
      || orgs[0]
      || null;
    if (!enabled || !org) return { ...none, enabled };
    return {
      enabled,
      canCreate: planFor(org).allowsEvents === true,
      offerPlanName: upgradePlanFor(org).name,
    };
  } catch {
    return none;
  }
}

export default readEventsAccess;
