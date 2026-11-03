/**
 * A BALLOT THE PHONE HAS NOT MANAGED TO SEND YET (experience plan 3d; audit C
 * P9: "votes are not held offline, unlike answers").
 *
 * The same idea as utils/pendingAnswer.js, for the ballot. A vote is an HTTP
 * POST rather than a socket frame, so "could not send" is a request that never
 * got an answer (the phone is offline, or the network dropped it), not a
 * `false` from the socket. The ballot is kept here until it can go, mirrored in
 * sessionStorage so a reload keeps it, keyed by session and player.
 *
 * A ballot only ever counts in the round it was cast for, and unlike an answer
 * there is no "late" for it: a vote that arrives after voting closed cannot be
 * kept apart from the result the way a late answer is, because the result IS
 * the votes. So `pendingVoteVerdict` says one of three things:
 *
 *   'send'  its round is still voting: deliver it.
 *   'wait'  the state is older than the ballot or says nothing yet.
 *   'drop'  voting on its round has closed (results, a later round, the end):
 *           tell the participant it did not count, never resend it.
 *
 * Every storage call is wrapped: a private window makes sessionStorage throw,
 * and the ballot must still work in memory then.
 */
import { roundOf } from './pendingAnswer';

const KEY_PREFIX = 'engage.pendingVote';

export const pendingVoteKey = (gameId, playerName) =>
  `${KEY_PREFIX}:${gameId}:${playerName}`;

export function pendingVoteVerdict(pending, state) {
  if (!pending || !Number.isFinite(pending.round)) return 'drop';
  const s = String(state || '');
  if (s === 'ENDED' || s === 'END') return 'drop';
  const n = roundOf(s);
  if (n === null) return 'wait';
  if (n > pending.round) return 'drop';
  if (n < pending.round) return 'wait';
  if (s.startsWith('VOTE#')) return 'send';
  if (s.startsWith('ASK#')) return 'wait';
  return 'drop';      // RESULTS of its own round: voting has closed
}

export function savePendingVote(pending) {
  if (!pending?.gameId || !pending?.playerName) return;
  try {
    sessionStorage.setItem(pendingVoteKey(pending.gameId, pending.playerName), JSON.stringify(pending));
  } catch (_) { /* storage unavailable: the in-memory copy still sends */ }
}

export function loadPendingVote(gameId, playerName) {
  if (!gameId || !playerName) return null;
  try {
    const raw = sessionStorage.getItem(pendingVoteKey(gameId, playerName));
    if (!raw) return null;
    const p = JSON.parse(raw);
    const usable = p
      && p.gameId === gameId
      && p.playerName === playerName
      && Number.isFinite(p.round)
      && p.votes && typeof p.votes === 'object'
      && Object.keys(p.votes).length > 0;
    return usable ? p : null;
  } catch (_) {
    return null;
  }
}

export function clearPendingVote(gameId, playerName) {
  if (!gameId || !playerName) return;
  try {
    sessionStorage.removeItem(pendingVoteKey(gameId, playerName));
  } catch (_) { /* nothing to clear */ }
}

/**
 * Is this failure the network's (hold the ballot and retry) rather than the
 * server's (say so)? A fetch that rejects never reached a server; a 502/503/504
 * is a gateway that could not reach one. Anything else the server answered.
 */
export function isOfflineFailure(error, status) {
  if (status === 502 || status === 503 || status === 504) return true;
  if (status) return false;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  return Boolean(error) && (error.name === 'TypeError' || /network|failed to fetch|load failed/i.test(String(error.message || '')));
}
