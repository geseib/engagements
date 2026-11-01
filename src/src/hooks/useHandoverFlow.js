import { useCallback, useEffect, useRef, useState } from 'react';
import { HANDOVER_TIMING, handoverWaitView, timingFromReply } from '../config/handoverWait';

/**
 * "THAT'S ME: USE MY NAME ON THIS DEVICE" — the participant's half of moving a
 * name, from the ask to the live screen (experience plan §4.4 steps 2–7).
 *
 * What it replaced: a button that recorded the ask and then said "Asked the
 * host" WHETHER OR NOT THE ASK ARRIVED, followed by a second button, "Take
 * over the name", that the person had to keep pressing until the host had
 * unlocked it. The phone never learnt the answer; the flow depended on the
 * host saying "go ahead" out loud (audit C §3.2–3.4).
 *
 * Now:
 *
 *   idle       nothing asked yet
 *   asking     the ask is in flight
 *   askFailed  the ask did not arrive; the screen says so and offers Try again
 *   waiting    the ask arrived. The join is retried quietly every few seconds
 *              with `claimExisting`, so the moment the host says yes the next
 *              retry spends the grant and the phone is in. NO NEW ROUTE: the
 *              join already answers "granted", "not yet" and "not now".
 *   granted    in. "You're in as Sam" holds for a moment, then `onIn`.
 *   declined   the host said Not now (the join's `handoverRefused`). Retrying
 *              stops; Ask again returns after a pause.
 *   lapsed     no answer within the lapse (ten minutes). Retrying stops; the
 *              host's item disappears at the same moment, because both read
 *              the same stamp (handover.js requestState).
 *
 * The retry stops on every way out: a grant, a refusal, a lapse, a refusal of
 * another kind (the session ended — handed to `onStop`), and `reset()` (the
 * person picked another name). A network blip or a 5xx keeps waiting: it says
 * nothing about the host's answer.
 *
 * `ask()` resolves `{ ok, ...serverReply }`; `claim()` resolves PlayerPage's
 * performJoin result. Both are read through a ref, so the newest closures are
 * always the ones called (the access code, the name).
 */
export default function useHandoverFlow({
  ask, claim, onIn, onStop, timing: baseTiming = HANDOVER_TIMING, clock = Date.now,
}) {
  const [flow, setFlow] = useState({ stage: 'idle', askedAt: null, declinedAt: null, error: null, timing: baseTiming });
  const [now, setNow] = useState(() => clock());
  const callbacks = useRef({});
  callbacks.current = { ask, claim, onIn, onStop, clock };
  const generation = useRef(0);

  const reset = useCallback(() => {
    generation.current += 1;
    setFlow({ stage: 'idle', askedAt: null, declinedAt: null, error: null, timing: baseTiming });
  }, [baseTiming]);

  /*
    NOT NOW, HEARD OUTSIDE THE RETRY (dev QA 1 Nov). The host's answer also
    reaches a FRESH join — a reload, the rejoin prompt, the form — as
    `handoverRefused`. That used to reset the flow to idle, so the phone said
    "The host said not now" in the lede over the first-ask buttons and never
    offered Ask again. It now lands on the same declined screen the retry
    reaches, with the same thirty-second pause.
  */
  const declined = useCallback(() => {
    generation.current += 1;
    const at = callbacks.current.clock();
    setNow(at);
    setFlow((f) => ({ ...f, stage: 'declined', declinedAt: at, error: null }));
  }, []);

  const requestHandover = useCallback(async () => {
    const mine = ++generation.current;
    setFlow((f) => ({ ...f, stage: 'asking', error: null }));
    let reply = null;
    try {
      reply = await callbacks.current.ask();
    } catch (error) {
      reply = { ok: false };
    }
    if (generation.current !== mine) return;
    if (!reply || !reply.ok) {
      setFlow((f) => ({
        ...f,
        stage: 'askFailed',
        error: (reply && reply.message) || 'Your request did not reach the host.',
      }));
      return;
    }
    const at = callbacks.current.clock();
    setNow(at);
    setFlow({ stage: 'waiting', askedAt: at, declinedAt: null, error: null, timing: timingFromReply(reply, baseTiming) });
  }, [baseTiming]);

  // The clock the screen reads ("Asked 0:20 ago", Ask again, the lapse).
  const ticking = flow.stage === 'waiting' || flow.stage === 'declined';
  useEffect(() => {
    if (!ticking) return undefined;
    const id = setInterval(() => setNow(callbacks.current.clock()), 1000);
    return () => clearInterval(id);
  }, [ticking]);

  /*
    ASK AGAIN ARRIVES ON TIME (dev QA 1 Nov: after Not now it never came
    back). The one-second tick alone decided when the button appeared, and a
    browser is free to slow or drop an interval on a page it considers idle.
    So the moment Ask again is due is also scheduled on its own, and a page
    coming back into view reads the clock at once.
  */
  useEffect(() => {
    if (!ticking) return undefined;
    const due = flow.stage === 'declined'
      ? (flow.declinedAt || 0) + flow.timing.askAgainAfterDeclineMs
      : (flow.askedAt || 0) + flow.timing.askAgainAfterMs;
    const wait = due - callbacks.current.clock();
    const refresh = () => setNow(callbacks.current.clock());
    const id = wait > 0 ? setTimeout(refresh, wait + 1) : null;
    const onVisible = () => { if (typeof document === 'undefined' || document.visibilityState !== 'hidden') refresh(); };
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible);
    if (typeof window !== 'undefined') window.addEventListener('focus', onVisible);
    return () => {
      if (id) clearTimeout(id);
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible);
      if (typeof window !== 'undefined') window.removeEventListener('focus', onVisible);
    };
  }, [ticking, flow.stage, flow.askedAt, flow.declinedAt, flow.timing]);

  const view = handoverWaitView({ ...flow, now, timing: flow.timing });

  // THE LAPSE. Read off the same clock the screen shows, so the words and the
  // stop happen in one render.
  useEffect(() => {
    if (flow.stage === 'waiting' && view.lapsed) {
      generation.current += 1;
      setFlow((f) => ({ ...f, stage: 'lapsed' }));
    }
  }, [flow.stage, view.lapsed]);

  // THE QUIET RETRY. One claim in flight at a time; every outcome but "not
  // yet" ends the loop.
  useEffect(() => {
    if (flow.stage !== 'waiting') return undefined;
    const mine = generation.current;
    let timer = null;
    let cancelled = false;

    const attempt = async () => {
      let result;
      try {
        result = await callbacks.current.claim();
      } catch (error) {
        result = { ok: false, failure: { kind: 'network' } };
      }
      if (cancelled || generation.current !== mine) return;

      if (result && result.ok) {
        generation.current += 1;
        const granted = generation.current;
        setFlow((f) => ({ ...f, stage: 'granted' }));
        const data = result.data;
        setTimeout(() => {
          if (generation.current === granted) callbacks.current.onIn(data);
        }, flow.timing.grantedHoldMs);
        return;
      }
      const failure = (result && result.failure) || { kind: 'network' };
      if (failure.kind === 'name-taken' || failure.kind === 'name-unverified') {
        if (failure.handoverRefused) {
          generation.current += 1;
          setNow(callbacks.current.clock());
          setFlow((f) => ({ ...f, stage: 'declined', declinedAt: callbacks.current.clock() }));
          return;
        }
      } else if (failure.kind !== 'network' && failure.kind !== 'error') {
        // The session is gone, or now wants a code: not a "not yet".
        generation.current += 1;
        setFlow((f) => ({ ...f, stage: 'idle' }));
        if (callbacks.current.onStop) callbacks.current.onStop(failure);
        return;
      }
      timer = setTimeout(attempt, flow.timing.retryEveryMs);
    };

    timer = setTimeout(attempt, flow.timing.retryEveryMs);
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [flow.stage, flow.askedAt, flow.timing]);

  return {
    stage: flow.stage,
    error: flow.error,
    agoMs: view.agoMs,
    canAskAgain: view.canAskAgain,
    requestHandover,
    reset,
    declined,
  };
}
