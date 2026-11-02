/**
 * THE TWO-SURFACE SWITCH (docs/design/two-surface/PLAN.md D6).
 *
 * The browser's own choice, and only for the types the room's window covers.
 * NO TIER DEFAULT (session-start F6; experience plan 2b, owner 1 Nov 2026):
 * until this browser has chosen, it is one screen here and Setup's step 1
 * asks "Where will the room watch?" on every tier. It used to default to two
 * screens on dev only, which is why dev and test felt like two products.
 * `?surfaces=two|classic` still sets it on any tier and is remembered per
 * browser, for testing.
 *
 * `/present` itself is live on every tier; this decides only whether the host's
 * screens offer it.
 */
export const SURFACES_KEY = 'engage.surfaces';
/*
  'build' since 19 Oct 2026 (parity PLAN §2.7, B9): the Build Room asks
  "Where will the room watch?" and stores the same choice. Who reads this:
    twoSurfacesOn / twoSurfacesHere   GameHostPage and HostRemote, neither of
                                      which ever holds a Build Room session (it
                                      lives at /build, BuildRoomPage); HostRemote
                                      also refuses 'build' itself, since its
                                      PRESENT link has no wall key
    QuickstartMenu                    Quick start offers no Build Room sets
    SessionSetupPanel, GameHostPage   the round types' Settings and Setup
  The Build Room reads the stored choice through config/roomScreen.js, and its
  room's window through presentHref(…, { type: 'build', k }).
*/
export const TWO_SURFACE_TYPES = ['call-and-answer', 'build'];

function overrideFrom(search) {
  try {
    const v = new URLSearchParams(search || '').get('surfaces');
    return v === 'two' || v === 'classic' ? v : null;
  } catch (e) {
    return null;
  }
}

export function twoSurfacesOn({ env, search, storage, gameType } = {}) {
  if (!TWO_SURFACE_TYPES.includes(gameType || 'call-and-answer')) return false;
  const asked = overrideFrom(search);
  if (asked) {
    try { if (storage) storage.setItem(SURFACES_KEY, asked); } catch (e) { /* private mode: this visit only */ }
    return asked === 'two';
  }
  let stored = null;
  try { stored = storage ? storage.getItem(SURFACES_KEY) : null; } catch (e) { stored = null; }
  if (stored === 'two') return true;
  if (stored === 'classic') return false;
  // `env` is accepted and ignored: no tier picks for the host (F6).
  return false;
}

/**
 * ONE PAGE, ONE CHOICE (review #38, test 5b908b65): the host page decides from
 * the choice it holds (read once when it opens, changed only by a choice made
 * on it), never by re-reading storage on every render. Storage is shared by
 * every tab in this browser (another host tab, a Build Room, a link carrying
 * `?surfaces=`), so re-reading it flipped a page set to One screen back to the
 * console on the next session update with nobody choosing.
 */
export function twoSurfacesFor(choice, { gameType, env } = {}) {
  if (!TWO_SURFACE_TYPES.includes(gameType || 'call-and-answer')) return false;
  if (choice === 'two') return true;
  if (choice === 'classic') return false;
  // No choice yet: one screen while Setup asks (F6), whatever the tier.
  return false;
}

/** The page's own reading, for components. */
export function twoSurfacesHere(gameType) {
  if (typeof window === 'undefined') return false;
  let storage = null;
  try { storage = window.localStorage; } catch (e) { storage = null; }
  return twoSurfacesOn({ env: window.ENV, search: window.location && window.location.search, storage, gameType });
}

/**
 * The room's window for a session: the Presentation, or with
 * `{ type: 'build', k }` the Build Room wall (parity PLAN §2.4), which needs
 * the session's wall key. One URL family, so RoomWindowLink, the shared
 * window name, `placed=1` and click-to-fill apply to both.
 */
export function presentHref(gameId, { type = '', k = '' } = {}) {
  const base = `/present?gameId=${encodeURIComponent(String(gameId || ''))}`;
  if (type !== 'build') return base;
  return `${base}&type=build&k=${encodeURIComponent(String(k || ''))}`;
}
