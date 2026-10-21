/**
 * WHICH LIBRARY — the person's own words for where work is saved.
 *
 * The owner, 2026-10-21: "there should be clear understanding if im saving
 * this under my account, a team, or engage (if im an admin). public sets for
 * now are created after saved in the personal or team accounts."
 *
 * A LIBRARY is what the console's switcher calls a scope, keyed exactly as the
 * `X-Engage-Org` header is (auth/authFetch.js): an org id for Your space or a
 * team, `~platform` for Engage. Writing into one is done by SENDING THAT
 * HEADER — the server's `canManageScope` decides from it, so a library this
 * person may not write to is refused by the API whatever this module offered.
 *
 * Public is never a destination: a set becomes public by being published from
 * Your space or a team once it is saved (the publish step and its check).
 */
import { useEffect, useState } from 'react';
import { authFetch, getActiveOrgId, PLATFORM_MODE_HEADER } from '../auth/authFetch';
import { useOptionalAuth } from '../auth/AuthContext';

export const ENGAGE_KEY = PLATFORM_MODE_HEADER;

const apiBase = () => (typeof window !== 'undefined' && window.API_BASE) || '';

/** `{ key, label, kind: 'personal'|'team'|'engage' }`, in switcher order. */
export function librariesFrom(orgs = [], isStaff = false) {
  const list = [];
  const personal = (orgs || []).filter((o) => o && o.type === 'personal');
  const teams = (orgs || []).filter((o) => o && o.type !== 'personal');
  personal.forEach((o) => list.push({ key: o.orgId, label: 'Your space', kind: 'personal' }));
  teams.forEach((o) => list.push({ key: o.orgId, label: o.name || 'Team', kind: 'team' }));
  if (isStaff) list.push({ key: ENGAGE_KEY, label: 'Engage', kind: 'engage' });
  return list;
}

/** The words for one library key, from a list built by `librariesFrom`. */
export function libraryLabel(key, libraries = []) {
  if (!key || key === ENGAGE_KEY) return key === ENGAGE_KEY ? 'Engage' : 'your library';
  const found = (libraries || []).find((l) => l.key === key);
  return found ? found.label : 'this library';
}

/** A draft's or a notification's library key, from its scope and org. */
export function libraryKeyOf({ scope, orgId } = {}) {
  if (orgId) return orgId;
  return scope === 'platform' || !scope ? ENGAGE_KEY : '';
}

/**
 * THE DEFAULT DESTINATION: the library the console is standing in (owner,
 * 2026-10-21 — Engage in the Engage console, the person's own space
 * otherwise; a team when they are working in that team). Falls back to Your
 * space when the active one is not among the writable ones.
 */
export function defaultLibraryKey(libraries = [], activeKey = getActiveOrgId()) {
  if (activeKey && libraries.some((l) => l.key === activeKey)) return activeKey;
  const personal = libraries.find((l) => l.kind === 'personal');
  return (personal || libraries[0] || {}).key || '';
}

/* One read of GET /orgs per page, shared by every caller. */
let cached = null;
export function fetchOrgs() {
  if (!cached) {
    cached = (async () => {
      try {
        const res = await authFetch(`${apiBase()}orgs`);
        if (!res.ok) return [];
        const data = await res.json();
        return Array.isArray(data.orgs) ? data.orgs : [];
      } catch (error) {
        return [];
      }
    })();
  }
  return cached;
}
/** For tests. */
export function forgetOrgs() { cached = null; }

/**
 * The libraries this person may write into. A page that already holds them
 * hands them in (`libraries`); otherwise GET /orgs is read once per page.
 * `skip` reads nothing — an addition to a set needs no list. Engage is offered
 * to Engage staff only (the `admins` group), and the server refuses it to
 * anybody else whatever this offered.
 */
export function useLibraries({ libraries = null, skip = false } = {}) {
  const auth = useOptionalAuth();
  const groups = (auth && auth.currentUser && auth.currentUser.groups) || [];
  const staff = Array.isArray(groups) && groups.includes('admins');
  const [fetched, setFetched] = useState(null);
  const need = !libraries && !skip;
  useEffect(() => {
    if (!need) return undefined;
    let live = true;
    fetchOrgs().then((list) => { if (live) setFetched(list); });
    return () => { live = false; };
  }, [need]);
  if (libraries) return { libraries, loaded: true };
  return { libraries: librariesFrom(fetched || [], staff), loaded: Boolean(fetched) };
}
