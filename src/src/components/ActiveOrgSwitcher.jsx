import React, { useEffect, useState } from 'react';
import OrgSwitcher from './OrgSwitcher';
import { authFetch, setActiveOrgId, getActiveOrgId } from '../auth/authFetch';

/**
 * THE ORG SWITCHER, ON THE SCREEN A HOST ACTUALLY WORKS FROM.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 *
 * The switcher lived only in the admin console, so the host screen — the one
 * you land on, the one you start a session from — said nothing at all about
 * which organisation you were in. That matters more here than in the console,
 * because THE QUESTION SETS ARE SCOPED BY IT: `GET /question-sets` returns your
 * org's sets plus Engage's shared library, chosen by the `X-Engage-Org` header
 * this switcher writes. A host in two teams was picking from one of them with
 * nothing on screen saying which, and no way to change it without going into
 * the console and back out.
 *
 * Reported directly: "How does a host know or switch teams on the main screen
 * and see the right question sets."
 *
 * ── NO PLATFORM MODE HERE ──────────────────────────────────────────────────
 *
 * Engage's platform console has no sessions and no question sets — it is
 * organisations, moderation and accounts. Offering "Act as · Engage" on the
 * screen whose only verb is "start an engagement" would be offering a place
 * where nothing on this screen can be done. Staff switch to it in the console,
 * where it means something.
 *
 * ── IT DRAWS NOTHING UNTIL IT KNOWS ────────────────────────────────────────
 *
 * No flash of a wrong name, and no error banner across somebody's home screen
 * if the lookup fails: an unlabelled screen is the state this was in yesterday,
 * and it is a better failure than a red box over the button they came to press.
 *
 * ── `onSwitch`, FOR A CALLER THAT CANNOT WAIT FOR THE RELOAD ─────────────────
 *
 * `choose()` below reloads the whole page, which is how every other mount of
 * this component gets its recheck: a fresh load re-fetches everything for the
 * new organisation. `HostRemote.jsx`'s access gate (Task 6) needs the same
 * recheck one step earlier — jsdom's `Location` cannot be replaced, so a
 * reload never actually happens under test, and in production the reload
 * itself IS the recheck. `onSwitch(orgId)` fires right before the reload, so a
 * caller that keeps its own state in sync with "which organisation" — as the
 * access gate does — gets a chance to act on the new value immediately rather
 * than depending on a navigation this environment cannot observe. Optional,
 * and every existing mount omits it.
 */
export default function ActiveOrgSwitcher({ onSwitch } = {}) {
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
        /* Silent by design — see the header. */
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (!orgs || !orgs.length) return null;

  const choose = (orgId) => {
    if (!orgId || orgId === activeOrgId) return;
    setActiveOrgId(orgId);
    if (onSwitch) onSwitch(orgId);
    /* A reload, for the same reason the console reloads: the question sets,
       the session list and the quickstarts on this screen have all been
       fetched for the previous organisation, and no single place owns them.
       Leaving one team's sets on screen under another team's name is the worst
       possible failure for a tenancy feature. */
    window.location.reload();
  };

  return (
    <OrgSwitcher
      organisations={orgs}
      activeOrgId={activeOrgId}
      onSelect={choose}
    />
  );
}
