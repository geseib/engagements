/**
 * THE TWO-SURFACE SWITCH (docs/design/two-surface/PLAN.md D6).
 *
 * On by default only on dev (`window.ENV === 'development'`), and only for the
 * game types the Presentation covers (Call & Answer first; trivia and poll are
 * Phase 7). `?surfaces=two|classic` overrides it on any tier and is remembered
 * per browser, so the owner can try it on test without a deploy.
 *
 * `/present` itself is live on every tier; this decides only whether the host's
 * screens offer it.
 */
export const SURFACES_KEY = 'engage.surfaces';
export const TWO_SURFACE_TYPES = ['call-and-answer'];

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
  return env === 'development';
}

/** The page's own reading, for components. */
export function twoSurfacesHere(gameType) {
  if (typeof window === 'undefined') return false;
  let storage = null;
  try { storage = window.localStorage; } catch (e) { storage = null; }
  return twoSurfacesOn({ env: window.ENV, search: window.location && window.location.search, storage, gameType });
}

/** The Presentation's address for a session. */
export function presentHref(gameId) {
  return `/present?gameId=${encodeURIComponent(String(gameId || ''))}`;
}
