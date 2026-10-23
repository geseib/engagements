import { useEffect, useState } from 'react';
import { authFetch, setActiveOrgId, getActiveOrgId } from '../auth/authFetch';

/**
 * THE ORGANISATIONS THIS ACCOUNT BELONGS TO, AND WHICH ONE IT IS ACTING FOR.
 *
 * Taken out of components/ActiveOrgSwitcher.jsx (its header says why the host
 * screen needs it) so the set chooser can name the team it is showing sets
 * for, and offer the switch, without a second copy of the reconcile rule.
 *
 * `orgs` is null until known, and stays null on a failed lookup: silent by
 * design, as the switcher has always been. `choose(orgId)` remembers the new
 * organisation and reloads the page, because every list on screen was fetched
 * for the previous one.
 */
export default function useActiveOrgs({ onSwitch } = {}) {
  const [orgs, setOrgs] = useState(null);
  const [activeOrgId, setActive] = useState(() => getActiveOrgId());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await authFetch(`${window.API_BASE || ''}orgs`);
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        const list = Array.isArray(data.orgs) ? data.orgs : [];
        setOrgs(list);

        /* Reconcile, exactly as the console does. A remembered id this account
           is no longer a member of must not be sent — the authorizer resolves
           an org you do not belong to to NO org, so the screen would act
           unscoped while naming a team. */
        const remembered = getActiveOrgId();
        const valid = list.some((o) => o.orgId === remembered);
        const next = valid
          ? remembered
          : (list.find((o) => o.type === 'personal') || list[0])?.orgId || '';
        if (next !== remembered) setActiveOrgId(next);
        setActive(next);
      } catch (err) {
        /* Silent by design. */
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const choose = (orgId) => {
    if (!orgId || orgId === activeOrgId) return;
    setActiveOrgId(orgId);
    if (onSwitch) onSwitch(orgId);
    /* A reload: the question sets, the session list and the quickstarts on
       this screen were all fetched for the previous organisation, and no
       single place owns them. Leaving one team's sets on screen under another
       team's name is the worst possible failure for a tenancy feature. */
    window.location.reload();
  };

  const active = (orgs || []).find((o) => o.orgId === activeOrgId) || null;
  return { orgs, activeOrgId, active, choose };
}
