import { useCallback, useEffect, useRef, useState } from 'react';

/** How long typing must pause before words are saved (IMPLEMENTATION-phase-2.md §4 Track C). */
export const SAVE_IDLE_MS = 600;
/** Back-off between retries of a save that did not land. The last step repeats. */
export const RETRY_MS = [1000, 2000, 4000, 8000, 15000];

/**
 * AUTOSAVE, ONE ANSWER AT A TIME — AND ONE SAVE AT A TIME PER PHONE.
 *
 * Every answer is written the moment it is given (`PUT …/survey/answers`, an
 * idempotent overwrite of one key), so a phone that dies at question five has
 * still counted for questions one to four. Four rules keep that honest:
 *
 * ONE SAVE IN FLIGHT FOR THE WHOLE PHONE. The server keeps one row per person
 * and every answer is a conditional write of THAT row, so two saves from one
 * phone — question 1 and question 2 on a slow connection — race each other for
 * the same lock, and the loser comes back `CONFLICT` after three tries. It
 * used to be one save per QUESTION, which is exactly two writers on one row.
 * Now later saves queue behind the one on the wire and go in order.
 *
 * THE LATEST VALUE PER QUESTION WINS. The queue holds one value per question,
 * overwritten in place: tapping 2, 3, 4 on a slow connection sends 2, holds
 * the rest, and when 2 lands sends 4 — never 3, and never an older value
 * landing after a newer one and quietly undoing it.
 *
 * WORDS WAIT FOR A PAUSE. A keystroke is not an answer; `change(…, {debounce})`
 * holds the words until `idleMs` without typing, and `flush(qid)` (leaving the
 * box, pressing Next) queues them at once.
 *
 * A SAVE THAT FAILS SAYS SO AND KEEPS TRYING. `retry` (no connection, 5xx and
 * 429 — the server's `BUSY` and `CONFLICT` among them — and a 409 that is not a
 * close) goes back in the queue with its value unless a newer one is waiting,
 * and the queue pauses on a back-off. `closed` (the server's `SURVEY_CLOSED`,
 * and only that) stops everything. Any other refusal is final for that value
 * and is reported, not retried forever.
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
      queue: new Map(),       // qid → the newest value ready to send, in order
      drafts: new Map(),      // qid → words still being typed
      timers: new Map(),      // qid → the typing pause
      inflight: null,         // { qid, value, done } — the ONE save on the wire
      retryTimer: null,       // the back-off before the queue moves again
      failures: 0,            // failed saves in a row, for the back-off
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
      else if (s.queue.size || s.drafts.size || s.inflight) next = 'saving';
      else if (states.includes('saved')) next = 'saved';
      setStatus((prev) => (prev.state === next && prev.error === error ? prev : { state: next, error }));
    };

    const clearTimer = (qid) => {
      clearTimeout(s.timers.get(qid));
      s.timers.delete(qid);
    };

    const stopEverything = () => {
      for (const t of s.timers.values()) clearTimeout(t);
      s.timers.clear();
      clearTimeout(s.retryTimer);
      s.retryTimer = null;
      s.drafts.clear();
      s.queue.clear();
    };

    /** Send the next queued answer — unless one is already on the wire, or the queue is backing off. */
    const pump = () => {
      if (s.closed || s.inflight || s.retryTimer || !s.queue.size) {
        publish();
        return;
      }
      const [qid, value] = s.queue.entries().next().value;
      s.queue.delete(qid);
      s.state.set(qid, 'saving');

      const done = Promise.resolve()
        .then(() => saveRef.current(qid, value))
        .catch((e) => ({ ok: false, retry: true, error: e?.message || 'The save failed.' }))
        .then((result) => {
          s.inflight = null;
          if (!s.mounted) return;
          const r = result || { ok: false, retry: true };

          if (r.ok) {
            s.failures = 0;
            s.errors.delete(qid);
            // A newer value for this question may be queued already; it is
            // still "saving" until that one lands too.
            s.state.set(qid, s.queue.has(qid) || s.drafts.has(qid) ? 'saving' : 'saved');
            pump();
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
            // A newer value given meanwhile is the one to retry with; else this one,
            // at the back of the queue so one stubborn answer cannot hold the rest.
            if (!s.queue.has(qid) && !s.drafts.has(qid)) s.queue.set(qid, value);
            s.state.set(qid, 'error');
            const steps = timingRef.current.retryMs;
            const wait = steps[Math.min(s.failures, steps.length - 1)];
            s.failures += 1;
            s.retryTimer = setTimeout(() => { s.retryTimer = null; pump(); }, wait);
            publish();
            return;
          }

          s.state.set(qid, 'rejected');
          s.errors.set(qid, r.error || 'That answer was not accepted.');
          pump();
        });

      s.inflight = { qid, value, done };
      publish();
    };

    /** Words that have paused (or been left) join the queue. */
    const promote = (qid) => {
      clearTimer(qid);
      if (s.drafts.has(qid)) {
        s.queue.set(qid, s.drafts.get(qid));
        s.drafts.delete(qid);
      }
      pump();
    };

    engine.current = {
      s,
      publish,
      change(qid, value, { debounce = false } = {}) {
        if (s.closed) return;
        clearTimer(qid);
        if (debounce) {
          // The words being typed supersede anything queued for this question.
          s.queue.delete(qid);
          s.drafts.set(qid, value);
          s.timers.set(qid, setTimeout(() => promote(qid), timingRef.current.idleMs));
          publish();
        } else {
          s.drafts.delete(qid);
          s.queue.set(qid, value);
          pump();
        }
      },
      flush(qid) {
        if (s.drafts.has(qid)) promote(qid);
      },
      /**
       * Before Send: everything typed goes in the queue, a back-off is cut
       * short (the person pressed a button — try now), and the queue drains
       * in order. It stops waiting at the first failure that would back off
       * again, and says so, rather than holding Send for a minute.
       */
      async flushAll() {
        for (const qid of [...s.drafts.keys()]) {
          clearTimer(qid);
          s.queue.set(qid, s.drafts.get(qid));
          s.drafts.delete(qid);
        }
        clearTimeout(s.retryTimer);
        s.retryTimer = null;
        pump();
        while (s.inflight && !s.retryTimer && !s.closed) {
          // eslint-disable-next-line no-await-in-loop
          await s.inflight.done;
        }
        const failed = [...s.state.values()].some((v) => v === 'error' || v === 'rejected');
        return { ok: !s.closed && !failed && s.queue.size === 0, closed: s.closed };
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
