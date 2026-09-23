import { useCallback, useEffect, useRef, useState } from 'react';

/** How long typing must pause before words are saved (IMPLEMENTATION-phase-2.md §4 Track C). */
export const SAVE_IDLE_MS = 600;
/** Back-off between retries of a save that did not land. The last step repeats. */
export const RETRY_MS = [1000, 2000, 4000, 8000, 15000];

/**
 * AUTOSAVE, ONE ANSWER AT A TIME.
 *
 * Every answer is written the moment it is given (`PUT …/survey/answers`, an
 * idempotent overwrite of one key), so a phone that dies at question five has
 * still counted for questions one to four. Three rules keep that honest:
 *
 * ONE SAVE IN FLIGHT PER QUESTION, AND THE LATEST VALUE WINS. Tapping 2, 3, 4
 * on a slow connection sends 2, holds the rest, and when 2 lands sends 4 —
 * never 3, and never two writes racing for the same key where the older one
 * could land second and quietly undo the newer.
 *
 * WORDS WAIT FOR A PAUSE. A keystroke is not an answer; `change(…, {debounce})`
 * saves after `idleMs` without typing, and `flush(qid)` (leaving the box,
 * pressing Next) saves at once.
 *
 * A SAVE THAT FAILS SAYS SO AND KEEPS TRYING. No connection, 5xx and 429 retry
 * on a back-off with the newest value; 409 means the survey closed, and stops
 * everything; any other refusal is final for that value and is reported, not
 * retried forever.
 *
 * `status` is the one line the dock prints: 'idle' (nothing saved yet),
 * 'saving', 'saved', 'error' ("Not saved – retrying") or 'rejected' ("Not
 * saved", with `error`). Everything else lives in a ref: saves resolve after
 * renders, and the queue must never be read through a stale closure.
 */
export default function useSurveyAutosave({ save, onClosed, idleMs = SAVE_IDLE_MS, retryMs = RETRY_MS }) {
  const saveRef = useRef(save);
  const onClosedRef = useRef(onClosed);
  const timingRef = useRef({ idleMs, retryMs });
  useEffect(() => {
    saveRef.current = save;
    onClosedRef.current = onClosed;
    timingRef.current = { idleMs, retryMs };
  });

  const [status, setStatus] = useState({ state: 'idle', error: null });

  const engine = useRef(null);
  if (!engine.current) {
    const s = {
      pending: new Map(),     // qid → the newest value not yet sent
      timers: new Map(),      // qid → the typing pause
      retries: new Map(),     // qid → the next retry
      inflight: new Map(),    // qid → the save on the wire
      attempts: new Map(),    // qid → failed attempts in a row
      state: new Map(),       // qid → 'saving' | 'saved' | 'error' | 'rejected'
      errors: new Map(),      // qid → the refusal, in words
      closed: false,
      mounted: true,
    };

    const publish = () => {
      if (!s.mounted) return;
      const states = [...s.state.values()];
      let next = 'idle';
      let error = null;
      if (states.includes('rejected')) {
        next = 'rejected';
        error = [...s.state.entries()].filter(([, v]) => v === 'rejected').map(([q]) => s.errors.get(q))[0] || null;
      } else if (states.includes('error')) next = 'error';
      else if (s.pending.size || s.inflight.size) next = 'saving';
      else if (states.includes('saved')) next = 'saved';
      setStatus((prev) => (prev.state === next && prev.error === error ? prev : { state: next, error }));
    };

    const clearTimer = (map, qid) => {
      clearTimeout(map.get(qid));
      map.delete(qid);
    };

    const stopEverything = () => {
      for (const t of s.timers.values()) clearTimeout(t);
      for (const t of s.retries.values()) clearTimeout(t);
      s.timers.clear();
      s.retries.clear();
      s.pending.clear();
    };

    const kick = (qid) => {
      clearTimer(s.timers, qid);
      clearTimer(s.retries, qid);
      if (s.closed || s.inflight.has(qid) || !s.pending.has(qid)) {
        publish();
        return;
      }
      const value = s.pending.get(qid);
      s.pending.delete(qid);
      s.state.set(qid, 'saving');

      const done = Promise.resolve()
        .then(() => saveRef.current(qid, value))
        .catch((e) => ({ ok: false, retry: true, error: e?.message || 'The save failed.' }))
        .then((result) => {
          s.inflight.delete(qid);
          if (!s.mounted) return;
          const r = result || { ok: false, retry: true };

          if (r.ok) {
            s.attempts.delete(qid);
            s.errors.delete(qid);
            s.state.set(qid, 'saved');
            if (s.pending.has(qid)) kick(qid);
            else publish();
            return;
          }

          if (r.closed) {
            s.closed = true;
            stopEverything();
            publish();
            if (onClosedRef.current) onClosedRef.current();
            return;
          }

          if (r.retry) {
            // A newer value typed meanwhile is the one to retry with.
            if (!s.pending.has(qid)) s.pending.set(qid, value);
            const n = s.attempts.get(qid) || 0;
            s.attempts.set(qid, n + 1);
            s.state.set(qid, 'error');
            const steps = timingRef.current.retryMs;
            s.retries.set(qid, setTimeout(() => kick(qid), steps[Math.min(n, steps.length - 1)]));
            publish();
            return;
          }

          s.state.set(qid, 'rejected');
          s.errors.set(qid, r.error || 'That answer was not accepted.');
          if (s.pending.has(qid)) kick(qid);
          else publish();
        });

      s.inflight.set(qid, done);
      publish();
    };

    engine.current = {
      s,
      publish,
      change(qid, value, { debounce = false } = {}) {
        if (s.closed) return;
        s.pending.set(qid, value);
        clearTimer(s.timers, qid);
        if (debounce) {
          s.timers.set(qid, setTimeout(() => kick(qid), timingRef.current.idleMs));
          publish();
        } else {
          kick(qid);
        }
      },
      flush(qid) {
        if (s.timers.has(qid)) kick(qid);
      },
      async flushAll() {
        for (const qid of [...s.pending.keys()]) kick(qid);
        while (s.inflight.size) {
          // eslint-disable-next-line no-await-in-loop
          await Promise.allSettled([...s.inflight.values()]);
        }
        const failed = [...s.state.values()].some((v) => v === 'error' || v === 'rejected');
        return { ok: !s.closed && !failed && s.pending.size === 0, closed: s.closed };
      },
      stop() {
        s.mounted = false;
        stopEverything();
      },
    };
  }

  useEffect(() => {
    const e = engine.current;
    e.s.mounted = true;
    return () => e.stop();
  }, []);

  const change = useCallback((qid, value, opts) => engine.current.change(qid, value, opts), []);
  const flush = useCallback((qid) => engine.current.flush(qid), []);
  const flushAll = useCallback(() => engine.current.flushAll(), []);

  return { status: status.state, error: status.error, change, flush, flushAll };
}
