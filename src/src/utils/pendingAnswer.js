/**
 * AN ANSWER THE PHONE HAS NOT MANAGED TO SEND YET.
 *
 * Found in the 2026-09-29 two-event drive (finding #1, High): an answer
 * submitted while the socket was down was silently lost. `handleSubmitAnswer`
 * ignored `sendCleanMessage`'s `false` and showed "Application Submitted!" and
 * "This is locked for the round. If this page reloads, it comes back" — while
 * the server held `answers: []`. After a reload the box was empty again.
 *
 * The answer is now kept here until the socket can take it. It lives in
 * `sessionStorage` so a reload of the tab keeps it (a reload is the first
 * thing a player does when a phone looks stuck), keyed by session and player
 * so a second name on the same phone never inherits somebody else's answer.
 *
 * It is only ever sent into the round it was written for. `pendingVerdict`
 * compares the round the answer belongs to against a game state and says one
 * of three things:
 *
 *   'send'  the same round is still asking — deliver it.
 *   'drop'  the room has moved past that round (voting, results, a later
 *           question, the end) — an answer arriving now would land in a round
 *           the host has already closed, so it is discarded, never resent.
 *   'wait'  the state is older than the answer or says nothing (CREATED on a
 *           page that has not synced yet) — keep it and ask again later.
 *
 * Every storage call is wrapped: a private window or blocked site data makes
 * sessionStorage throw, and the answer must still work in memory then.
 */

const KEY_PREFIX = 'engage.pendingAnswer';

export const pendingAnswerKey = (gameId, playerName) =>
  `${KEY_PREFIX}:${gameId}:${playerName}`;

/** The round number an `ASK#nnn` / `VOTE#nnn` / `RESULTS#nnn` state is in, or null. */
export function roundOf(state) {
  const m = String(state || '').match(/^(?:ASK|VOTE|RESULTS?)#(\d+)/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) ? n : null;
}

export function pendingVerdict(pending, state) {
  if (!pending || !Number.isFinite(pending.round)) return 'drop';
  const s = String(state || '');
  if (s === 'ENDED' || s === 'END') return 'drop';
  const n = roundOf(s);
  if (n === null) return 'wait';
  if (n > pending.round) return 'drop';
  if (n < pending.round) return 'wait';
  return s.startsWith('ASK#') ? 'send' : 'drop';
}

export function savePendingAnswer(pending) {
  if (!pending?.gameId || !pending?.playerName) return;
  try {
    sessionStorage.setItem(
      pendingAnswerKey(pending.gameId, pending.playerName),
      JSON.stringify(pending)
    );
  } catch (_) { /* storage unavailable: the in-memory copy still sends */ }
}

export function loadPendingAnswer(gameId, playerName) {
  if (!gameId || !playerName) return null;
  try {
    const raw = sessionStorage.getItem(pendingAnswerKey(gameId, playerName));
    if (!raw) return null;
    const p = JSON.parse(raw);
    const usable = p
      && p.gameId === gameId
      && p.playerName === playerName
      && Number.isFinite(p.round)
      && typeof p.messageType === 'string'
      // A typed poll's answer can be a number or an array, not only text.
      && p.answer !== null && p.answer !== undefined && p.answer !== '';
    return usable ? p : null;
  } catch (_) {
    return null;
  }
}

export function clearPendingAnswer(gameId, playerName) {
  if (!gameId || !playerName) return;
  try {
    sessionStorage.removeItem(pendingAnswerKey(gameId, playerName));
  } catch (_) { /* nothing to clear */ }
}
