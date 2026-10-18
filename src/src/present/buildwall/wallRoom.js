/**
 * THE WALL READ AS THE ROOM'S SCREENS READ A ROOM (parity PLAN §2.5, §2.9a).
 *
 * The display components in buildroom/screens/ take a `room` in the shape the
 * host's read has (asks, currentAskId, log, ideas). The wall's read
 * (`GET build-play/wall`, build-store.js wallView) is an allowlist in another
 * shape: the open ask as `current`, every ask the room saw in `history.asks`,
 * only the used ideas, and the entries that carried them to Claude in
 * `history.sent`. This puts one into the other, adding nothing the wall read
 * did not carry. Pure: no React, no fetch.
 *
 * The wall folder is `present/buildwall/`, never `present/build/`: the repo's
 * .gitignore swallows every folder named `build/`.
 */

/** The room, in the screens' shape, from a wallView body. */
export function wallRoom(view) {
  const v = view || {};
  const h = v.history || {};
  const current = v.current || null;
  const asks = (h.asks || []).slice();
  if (current) {
    // The open ask carries live counts the history copy may not: it wins.
    const at = asks.findIndex((a) => a.askId === current.askId);
    if (at >= 0) asks[at] = current; else asks.push(current);
  }
  // As a phone's History reads it (buildScreens.js historyFromView): the
  // carrying entries come from `history.sent`, not the room's log.
  const log = (v.log || []).filter((l) => l.kind !== 'idea' && l.kind !== 'direction').concat(h.sent || []);
  return {
    gameId: v.gameId,
    title: v.title || '',
    goal: v.goal || '',
    state: v.state || null,
    playerCount: Number(v.playerCount) || 0,
    players: Array.isArray(v.players) ? v.players : [],
    // The meter lists names only where the wall read carries them (List names on).
    settings: { listNames: Array.isArray(v.players) && v.players.length > 0 },
    currentAskId: current ? current.askId : null,
    asks,
    log,
    ideas: h.ideas || [],
    ideaCounts: v.ideaCounts || null,
    images: v.images || [],
    outcome: v.outcome || null,
    doing: v.doing || null,
    agent: v.agent || {},
    shownPoint: v.shownPoint || null,
    run: v.run || null,
    lan: v.lan || null,
    opening: v.opening || null,
    brief: v.brief || null,
    wallComment: v.wallComment || null,
    crew: v.crew || { enabled: false },
    rev: Number(v.rev) || 0,
  };
}

/** What the server says the wall shows, with the defaults of build-store.js wallStateOf. */
export function wallState(view) {
  const w = (view && view.wall) || {};
  const one = (x, list) => (list.includes(x) ? x : list[0]);
  return {
    screen: one(w.screen, ['stage', 'build', 'history']),
    codes: one(w.codes, ['none', 'join', 'both']),
    profile: one(w.profile, ['room', 'tv', 'call', 'table']),
    rev: Number(w.rev) || 0,
  };
}

/** True when `next` is older than what is shown: its rev, then its wall rev, went back. */
export function isStale(shown, next) {
  if (!shown || !next) return false;
  const r0 = Number(shown.rev) || 0;
  const r1 = Number(next.rev) || 0;
  if (r1 !== r0) return r1 < r0;
  return wallState(next).rev < wallState(shown).rev;
}
