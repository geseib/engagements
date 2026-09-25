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
 *                      held. While this page's own write is in flight it is
 *                      held back rather than applied — the optimistic board
 *                      stays up — and the newest one held is kept.
 *   publishScoreboard  optimistic (the room sees the press at once, rev
 *                      unchanged), then, when the LAST write in flight
 *                      settles, the highest revision among its replies AND
 *                      the copies held back meanwhile — so two quick V
 *                      presses end on the second whichever reply lands
 *                      first, and a V pressed just as the next question
 *                      closes the board (next-question.js, one rev later)
 *                      ends closed. With no reply and nothing newer held,
 *                      the board goes back to what the server last had.
 *                      A write gives up after SCOREBOARD_WRITE_TIMEOUT_MS,
 *                      so one that hangs cannot hold server copies back.
 *   resetScoreboard    a new session: back to nothing, so its first read
 *                      applies whatever its revision.
 *
 * `fetchFn` is authFetch on the page: /scoreboard carries the Cognito
 * authorizer.
 */
/**
 * How long one write may stay out. While any is, server copies wait for it;
 * a POST that hangs — a dropped connection the browser has not noticed yet —
 * would keep them waiting until the browser gave up on its own, which can be
 * minutes. So the request is aborted and settles as a failed write. If it did
 * reach the server after all, its frame carries a higher rev and applies.
 */
export const SCOREBOARD_WRITE_TIMEOUT_MS = 8000;

/** The newer of two copies; the first on a tie (a reply and its own frame). */
const newer = (a, b) => (b && (!a || b.rev > a.rev) ? b : a);

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
  // first, the best reply so far, and the newest server copy that arrived
  // meanwhile. Replaced wholesale on a session reset, so a write from the
  // last session settling late cannot touch this one.
  const flight = useRef({ count: 0, before: null, best: null, seen: null });

  const applyServerBoard = useCallback((copy) => {
    if (!copy) return;
    const next = normaliseScoreboard(copy);
    const f = flight.current;
    if (f.count > 0) { f.seen = newer(f.seen, next); return; }
    if (next.rev >= boardRef.current.rev) setBoard(next);
  }, [setBoard]);

  const resetScoreboard = useCallback((value) => {
    flight.current = { count: 0, before: null, best: null, seen: null };
    setBoard(normaliseScoreboard(value));
  }, [setBoard]);

  const publishScoreboard = useCallback(async (change) => {
    const body = scoreboardRequest(change);
    if (!body || !gameId || typeof fetchFn !== 'function') return;
    const f = flight.current;
    if (f.count === 0) { f.before = boardRef.current; f.best = null; f.seen = null; }
    f.count += 1;
    setBoard(optimistic(boardRef.current, body));

    // Raced as well as aborted: the abort frees the connection, the race is
    // what guarantees this write settles even if the fetch ignores the signal.
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    let timer = null;
    const giveUp = new Promise((resolve, reject) => {
      timer = setTimeout(() => {
        if (controller) controller.abort();
        reject(new Error(`no answer in ${SCOREBOARD_WRITE_TIMEOUT_MS} ms`));
      }, SCOREBOARD_WRITE_TIMEOUT_MS);
    });

    let answer = null;
    try {
      const res = await Promise.race([fetchFn(`${apiBase}games/${gameId}/scoreboard`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        ...(controller ? { signal: controller.signal } : {}),
      }), giveUp]);
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data = await Promise.race([res.json(), giveUp]);
      if (data && data.scoreboard) answer = normaliseScoreboard(data.scoreboard);
    } catch (error) {
      console.warn('⚠️ SCOREBOARD: the change did not reach the server:', error?.message);
    } finally {
      clearTimeout(timer);
    }

    if (flight.current !== f) return;           // the session changed under it
    if (answer) f.best = newer(f.best, answer);
    f.count -= 1;
    if (f.count > 0) return;                    // a later press will answer
    const latest = newer(f.best, f.seen);
    if (latest && latest.rev >= boardRef.current.rev) {
      setBoard(latest);
    } else if (!f.best && f.before) {
      setBoard(f.before);
    }
  }, [gameId, apiBase, fetchFn, setBoard]);

  return { scoreboard, applyServerBoard, publishScoreboard, resetScoreboard };
}
