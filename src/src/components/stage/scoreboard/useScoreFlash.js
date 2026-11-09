import { useCallback, useEffect, useRef, useState } from 'react';
import { flashSkipKey } from '../../../config/scoreFlash';

/**
 * THE SCOREBOARD FLASH'S ONE TIMER (config/scoreFlash.js says what it is).
 *
 *   start({ ms, nextRound, go })  open the board, and after `ms` call `go` —
 *                                  the round's own advance (handleNextQuestion)
 *   skip()                        the host pressed on: `go` now
 *   cancel()                      someone else closed the board: stop, and
 *                                  do NOT advance
 *
 * WHY A SERVER CLOSE CANCELS RATHER THAN SKIPS. The board is the server's, so
 * it can close under the flash from elsewhere — and the commonest elsewhere
 * is next-question.js putting it away because the phone remote already
 * opened the round. Advancing then would skip a question in front of the
 * room. Only the host's own close on this page (Space, Escape, the board's X:
 * the caller routes those to skip) moves the room on.
 *
 * A clicker's → / PageDown / Enter skips too, heard in the capture phase so
 * the board's own ← / → paging never sees it.
 */
export default function useScoreFlash({ boardOpen = false, openBoard = () => {} } = {}) {
  const [flash, setFlash] = useState(null); // { ms, startedAt, nextRound }
  const goRef = useRef(null);
  const timerRef = useRef(null);
  const sawOpen = useRef(false);

  const stop = useCallback(() => {
    clearTimeout(timerRef.current);
    timerRef.current = null;
    sawOpen.current = false;
    const go = goRef.current;
    goRef.current = null;
    setFlash(null);
    return go;
  }, []);

  const skip = useCallback(() => {
    const go = stop();
    if (typeof go === 'function') go();
  }, [stop]);

  const cancel = useCallback(() => { stop(); }, [stop]);

  const start = useCallback(({ ms, nextRound = null, go }) => {
    stop();
    goRef.current = go;
    setFlash({ ms, startedAt: Date.now(), nextRound });
    openBoard();
    timerRef.current = setTimeout(skip, ms);
  }, [stop, skip, openBoard]);

  // Closed by someone else once it was up: stand down without advancing.
  useEffect(() => {
    if (!flash) return;
    if (boardOpen) { sawOpen.current = true; return; }
    if (sawOpen.current) cancel();
  }, [flash, boardOpen, cancel]);

  useEffect(() => {
    if (!flash) return undefined;
    const onKey = (event) => {
      if (!flashSkipKey(event)) return;
      event.preventDefault();
      if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
      skip();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [flash, skip]);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  return { flash, start, skip, cancel };
}
