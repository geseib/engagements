/**
 * WHICH SECTION OF THE CONSOLE YOU ARE IN, KEPT IN THE URL.
 *
 * `activeTab` was local state seeded with `'questionsets'`, and that one line
 * cost four things a console is expected to do:
 *
 *   - RELOAD puts you back on Question sets, whatever you were doing. The admin
 *     screens are where a reload is most likely — a 401 after a token expiry, a
 *     deploy landing mid-task, or simply refreshing to see whether a pending
 *     user showed up.
 *   - BACK leaves the console entirely. The browser has no record that you moved
 *     between five sections, so the only Back target is whatever preceded
 *     /admin. People press Back to undo a navigation; here it signs you out of
 *     the screen.
 *   - You cannot SEND anyone a section. "Approve them in Users" is a sentence,
 *     not a link.
 *   - The environment chip says which tier you are on, but a pasted URL does
 *     not say which SECTION, so the two halves of "look at this" cannot travel
 *     together.
 *
 * ── WHY A QUERY PARAM AND NOT A PATH SEGMENT ───────────────────────────────
 *
 * `App.jsx` routes on `window.location.pathname` with a `startsWith('/admin')`
 * test and no client-side navigation of any kind. A path segment would work for
 * routing — `/admin/users` still matches the prefix — but every change of
 * segment that went through `pushState` would leave the pathname router
 * describing a page it did not render, and any change that did NOT go through
 * pushState would be a full page load: a fresh bundle, a fresh Cognito session
 * probe, and every list re-fetched, to move between two tabs.
 *
 * A query param is invisible to that router by construction. `?section=users`
 * matches `startsWith('/admin')` exactly as `/admin` does, so the two schemes
 * cannot disagree.
 *
 * ── THE DEFAULT SECTION HAS NO PARAM ───────────────────────────────────────
 *
 * `/admin` and `/admin?section=questionsets` are the same place, and only the
 * first is written. A canonical URL for the landing state keeps Back from
 * accumulating a pair of history entries that render identically — press Back
 * once, get the same screen, press again, finally leave. That is the failure
 * people describe as "Back is broken".
 */

/** The query key. One constant so the reader and the writer cannot drift. */
export const SECTION_PARAM = 'section';

/**
 * The section a URL asks for, or the fallback.
 *
 * VALIDATED AGAINST THE REAL SECTION LIST rather than trusted. The value is
 * whatever a person last had in their address bar — a renamed section from a
 * bookmark, a truncated paste, a hand-typed guess. An unrecognised id must land
 * on the default; rendering nothing because a string did not match is how a
 * console shows a blank work area and looks broken.
 */
export function sectionFromSearch(search, validIds = [], fallback = '') {
  const params = new URLSearchParams(String(search || ''));
  const asked = params.get(SECTION_PARAM);
  return validIds.includes(asked) ? asked : fallback;
}

/**
 * The search string that names a section, with every other parameter kept.
 *
 * OTHER PARAMS SURVIVE, deliberately. Nothing else on /admin reads one today,
 * which is exactly why this is easy to get wrong now and expensive to discover
 * later: the first feature to add `?set=…` or a campaign parameter would find
 * it silently dropped on every section change.
 *
 * The default section is written as ABSENCE of the parameter — see the header.
 */
export function searchForSection(search, sectionId, defaultId = '') {
  const params = new URLSearchParams(String(search || ''));
  if (!sectionId || sectionId === defaultId) {
    params.delete(SECTION_PARAM);
  } else {
    params.set(SECTION_PARAM, sectionId);
  }
  const query = params.toString();
  return query ? `?${query}` : '';
}

/**
 * Is the address bar already saying this? Used to decide replace-vs-nothing on
 * mount, so arriving at a canonical URL adds no history entry at all.
 */
export function searchMatchesSection(search, sectionId, defaultId = '') {
  /*
    A STRING COMPARE IS ENOUGH, and I had this wrong first time round.

    The version before this normalised both sides into sorted key/value pairs,
    reasoning that '?a=1&section=users' and '?section=users&a=1' are the same
    URL and a string compare would rewrite history for whoever's parameters
    arrived in the other order. That cannot happen: `URLSearchParams.set`
    replaces a key IN PLACE, so rebuilding a search that already names this
    section reproduces the original byte for byte, whatever the order was. The
    mutation that swapped normalisation for `===` survived every test, which is
    how the redundancy was found — the assertion I had written to protect it was
    true of both versions.

    What remains different is exotic and benign: a hand-typed '?a=%41'
    re-encodes to '?a=A' and costs one replaceState on arrival, which is the
    canonicalisation this function exists to trigger anyway.
  */
  const current = String(search || '');
  return current === searchForSection(current, sectionId, defaultId);
}
