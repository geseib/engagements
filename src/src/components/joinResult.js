/**
 * The join request's identity material, and what to do when a join is refused.
 *
 * Two Chrises in one room used to merge silently: the server keyed players by
 * `PLAYER#{playerName}` and treated any second arrival under an existing name
 * as a reconnection. Nothing in the join request could tell "Chris came back"
 * from "a different Chris walked in" — the request carried a name and, for
 * private sessions, an access code, and that was all. There is no session
 * token here (players are deliberately unauthenticated) and no connection id
 * (the player's WebSocket opens only after the join succeeds).
 *
 * So the client supplies the missing material: a random id, minted once per
 * session-per-browser and kept in localStorage. It is not an account and it
 * proves nothing about a person — it only answers "is this the same browser
 * that first claimed this name in this session?", which is exactly the
 * question the server could not previously ask.
 */

/** Deliberately per-game: an id shared across sessions would be a tracking handle. */
export const clientIdStorageKey = (gameId) => `playerClient_${gameId}`;

const mintId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // jsdom and older Safari have no randomUUID. Uniqueness within one session's
  // roster is all that is required of this value.
  return `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
};

/**
 * The stable id for this browser in this session, minted on first use.
 *
 * `storage` is injectable so this is testable and so a browser with storage
 * disabled degrades instead of throwing: with no storage the caller gets null
 * and the server falls back to its legacy behaviour rather than refusing a
 * join outright.
 */
export function getClientId(gameId, storage) {
  const store = storage === undefined
    ? (typeof localStorage !== 'undefined' ? localStorage : null)
    : storage;
  if (!store || !gameId) return null;

  const key = clientIdStorageKey(gameId);
  try {
    const existing = store.getItem(key);
    if (existing) return existing;
    const minted = mintId();
    store.setItem(key, minted);
    return minted;
  } catch (error) {
    // Private-mode Safari throws on setItem. Joining still has to work.
    return null;
  }
}

/**
 * What kind of refusal was that?
 *
 * The server's `code` is the contract; the HTTP status alone is not enough
 * (409 covers both collision shapes, and they need different screens — one
 * offers a way back in, the other must not).
 */
export function classifyJoinFailure(status, data) {
  const payload = data || {};

  if (payload.code === 'NAME_TAKEN' || payload.code === 'NAME_UNVERIFIED') {
    return {
      kind: payload.code === 'NAME_TAKEN' ? 'name-taken' : 'name-unverified',
      playerName: payload.playerName || '',
      message: payload.message || 'That name is already in use in this session.'
    };
  }

  // Pre-existing contract, matched on the exact string the server sends.
  if (payload.error === 'Access code required') {
    return { kind: 'access-code', message: payload.message || '' };
  }

  if (status === 404) {
    return {
      kind: 'not-found',
      message: payload.message || payload.error
        || 'No session with that code. Check the main screen and try again.'
    };
  }

  if (status === 403 && payload.error === 'Game not started') {
    return { kind: 'not-started', message: payload.message || payload.error };
  }

  return {
    kind: 'error',
    message: payload.message || payload.error
      || 'Could not join the session. Please try again.'
  };
}
