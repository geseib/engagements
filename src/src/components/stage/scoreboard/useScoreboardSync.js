import { useCallback, useRef, useState } from 'react';
import { CLOSED_SCOREBOARD, normaliseScoreboard, scoreboardRequest } from '../../../config/scoreboard';

/**
 * THE HOST PAGE'S COPY OF THE SERVER'S BOARD, and the one way it changes it.
 *
 * docs/superpowers/specs/2026-09-25-scoreboard-design.md §3. The page hears
 * about the board from its own POST's reply, the `scoreboardChanged` frame and
 * every `/state` refresh — and refreshes run on window focus, visibility,
 * reconnect and most phase frames. Applied blindly, a refresh issued just
 * before the host pressed S and landing just after shuts the board again; one
 * landing after Space reopens it.
 *
 * So every server copy carries `rev` (STATE.ScoreboardRev, counted up by an
 * atomic ADD on every write — lambda-functions/game/scoreboard-state.js), and:
 *
 *   applyServerBoard   applies a copy only when its rev is at least the one
 *                      held, and not at all while this page's own write is in
 *                      flight — that write's reply is the answer.
 *   publishScoreboard  optimistic (the room sees the press at once, rev
 *                      unchanged), then, when the LAST write in flight
 *                      settles, the highest-revision reply among them — so
 *                      two quick V presses end on the second whichever reply
 *                      lands first. If every write failed, the board goes
 *                      back to what the server last had.
 *   resetScoreboard    a new session: back to nothing, so its first read
 *                      applies whatever its revision.
 *
 * `fetchFn` is authFetch on the page: /scoreboard carries the Cognito
 * authorizer.
 */
function optimistic(current, body) {
  const next = { ...current };
  if (body.style) next.style = body.style;
  if (body.open === true && !current.open) Object.assign(next, { open: true, openedAt: null, page: 0 });
  if (body.open === false) next.open = false;
  return next;
}

export default function useScoreboardSync({ gameId, apiBase = '', fetchFn }) {
  const [scoreboard, setBoardState] = useState(CLOSED_SCOREBOARD);
  const boardRef = useRef(CLOSED_SCOREBOARD);
  const setBoard = useCallback((next) => {
    boardRef.current = next;
    setBoardState(next);
  }, []);
  // One flight per burst of writes: how many are out, the board before the
  // first, and the best reply so far. Replaced wholesale on a session reset,
  // so a write from the last session settling late cannot touch this one.
  const flight = useRef({ count: 0, before: null, best: null });

  const applyServerBoard = useCallback((copy) => {
    if (!copy || flight.current.count > 0) return;
    const next = normaliseScoreboard(copy);
    if (next.rev >= boardRef.current.rev) setBoard(next);
  }, [setBoard]);

  const resetScoreboard = useCallback((value) => {
    flight.current = { count: 0, before: null, best: null };
    setBoard(normaliseScoreboard(value));
  }, [setBoard]);

  const publishScoreboard = useCallback(async (change) => {
    const body = scoreboardRequest(change);
    if (!body || !gameId || typeof fetchFn !== 'function') return;
    const f = flight.current;
    if (f.count === 0) { f.before = boardRef.current; f.best = null; }
    f.count += 1;
    setBoard(optimistic(boardRef.current, body));

    let answer = null;
    try {
      const res = await fetchFn(`${apiBase}games/${gameId}/scoreboard`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data = await res.json();
      if (data && data.scoreboard) answer = normaliseScoreboard(data.scoreboard);
    } catch (error) {
      console.warn('⚠️ SCOREBOARD: the change did not reach the server:', error?.message);
    }

    if (flight.current !== f) return;           // the session changed under it
    if (answer && (!f.best || answer.rev > f.best.rev)) f.best = answer;
    f.count -= 1;
    if (f.count > 0) return;                    // a later press will answer
    if (f.best) {
      if (f.best.rev >= boardRef.current.rev) setBoard(f.best);
    } else if (f.before) {
      setBoard(f.before);
    }
  }, [gameId, apiBase, fetchFn, setBoard]);

  return { scoreboard, applyServerBoard, publishScoreboard, resetScoreboard };
}
