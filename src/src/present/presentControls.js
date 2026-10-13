/**
 * KEYS AND A CLICKER ON THE PRESENTATION (two-surface PLAN 2.11, D7; owner,
 * 2026-10-13).
 *
 * When the Presentation window has focus, Space / → / ↓ / PageDown step
 * forward and ← / ↑ / PageUp step back through what is on the wall
 * (present/presentKeys.js decides what that means). A clicker sends
 * PageDown/PageUp or the arrows, so it works too.
 *
 * ONLY FOR A HOST WHO MAY DRIVE THIS SESSION. The wall itself is public; the
 * writes here go to /stage-focus and /stage-beat, which carry the Cognito
 * authorizer and `callerMayDriveSession`. So keys are armed only after this
 * browser has read the host's door for the session (200); unsigned, or signed
 * in as someone else, the keys do nothing. This is the ONE file under
 * present/ that may use the signed-in fetch (presentStage.test.jsx holds it).
 *
 * 250 ms per key, so a clicker's double pulse is one press. Keys never act
 * while a text field has focus or with a modifier held (that is the browser's).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { authFetch } from '../auth/authFetch';
import { remoteStep, requestFor, needsConfirmation } from '../config/hostRemote';
import { presentKeyStep } from './presentKeys';

/**
 * THE ROUND'S OWN NEXT STEP FROM THE WALL (owner, 2026-10-13: "when
 * presenting i still need ability to ... move things forward"). When there is
 * nothing left on the wall to step through, Forward runs the same primary the
 * Remote and the host's dock show (roundStep, through the Remote's reading of
 * the host door), with the same two-press rule for an early advance. Only
 * these ids; the rest stay with the host's own screens.
 */
export const WALL_PRIMARIES = ['start', 'next', 'open-vote', 'vote', 'reveal', 'reveal-from-ask', 'results', 'field-notes', 'notes-page'];
export const ARM_MS = 5000;
export const HOST_POLL_MS = 3000;
export const STRIP_MS = 3000;

export const KEY_DEBOUNCE_MS = 250;
const FORWARD = new Set(['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Spacebar']);
const BACK = new Set(['ArrowLeft', 'ArrowUp', 'PageUp']);
const TYPING = { INPUT: true, TEXTAREA: true, SELECT: true };

/** 'forward', 'back' or null for a key event. */
export function keyDirection(event) {
  if (!event || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return null;
  const t = event.target;
  if (t && ((t.tagName && TYPING[t.tagName]) || t.isContentEditable)) return null;
  if (FORWARD.has(event.key)) return 'forward';
  if (BACK.has(event.key)) return 'back';
  return null;
}

const apiBase = () => (typeof window !== 'undefined' && window.API_BASE) || '';
const roundOf = (state) => {
  const m = /^(ASK|VOTE|RESULTS)#(\d+)$/.exec(String(state || ''));
  return m ? Number(m[2]) : null;
};

/** Perform the writes, in order; stop at the first refusal. */
async function perform(gameId, snapshot, writes) {
  const questionNumber = roundOf(snapshot && snapshot.state);
  if (!questionNumber) return false;
  for (const w of writes) {
    let path;
    let body;
    if (w.kind === 'focus') {
      path = 'stage-focus';
      body = {
        focus: w.focus,
        index: w.focus === 'answer' ? w.index : null,
        ...(w.focus === 'answer' && w.part !== undefined ? { part: w.part } : {}),
        ...(w.focus === 'answer' && w.parts !== undefined ? { parts: w.parts } : {}),
        questionNumber,
      };
    } else if (w.kind === 'beat') {
      path = 'stage-beat';
      body = { beat: w.beat, questionNumber };
    } else if (w.kind === 'page') {
      path = 'stage-beat';
      body = { step: w.step, questionNumber };
    } else {
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    const res = await authFetch(`${apiBase()}games/${gameId}/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res || !res.ok) return false;
  }
  return true;
}

/**
 * @param {object} p
 * @param {string} p.gameId
 * @param {object|null} p.snapshot  the wall's last /state
 * @param {number} p.total          how many responses the round has
 * @param {boolean} p.notesReady    Workie's read has arrived on the wall
 * @param {(force?: boolean) => void} p.refetch  look again after a write
 * @returns {{ armed: boolean, step: object|null, arming: string, strip: boolean,
 *             forward: () => void, back: () => void, toggleJoin: () => void, joinShown: boolean }}
 */
export default function usePresentControls({ gameId, snapshot, total, notesReady = true, refetch }) {
  const [armed, setArmed] = useState(false);
  const [hostState, setHostState] = useState(null);
  const [arming, setArming] = useState('');
  const [strip, setStrip] = useState(false);
  const lastRef = useRef(0);
  const busyRef = useRef(false);
  const armRef = useRef(null);
  const stripTimer = useRef(null);
  const live = useRef({});

  const step = hostState ? remoteStep(hostState, {
    playerCount: Number(snapshot && snapshot.roomCounts && snapshot.roomCounts.joined) || 0,
    answerCount: total,
    notesReady,
    hasQuestionSet: true,
  }) : null;
  live.current = { snapshot, total, refetch, step };

  // May this browser drive the session? Asked of the host's door, and asked
  // again every few seconds: the door also carries the progress the step needs.
  useEffect(() => {
    if (!gameId) return undefined;
    let cancelled = false;
    const read = async () => {
      try {
        const res = await authFetch(`${apiBase()}games/${gameId}/host-state`);
        if (cancelled) return;
        if (res && res.ok) {
          setArmed(true);
          const json = await res.json().catch(() => null);
          if (!cancelled && json) setHostState(json);
        } else {
          setArmed(false);
        }
      } catch (e) {
        if (!cancelled) setArmed(false);
      }
    };
    read();
    const timer = setInterval(read, HOST_POLL_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, [gameId]);

  const after = useCallback(() => {
    const again = live.current.refetch;
    if (again) again(true);
  }, []);

  const runPrimary = useCallback(async () => {
    const { snapshot: snap, step: st } = live.current;
    const primary = st && st.primary;
    if (!primary || primary.disabled || !WALL_PRIMARIES.includes(primary.id)) return;
    if (needsConfirmation(primary) && armRef.current !== primary.id) {
      armRef.current = primary.id;
      setArming(primary.arm && primary.arm.text ? primary.arm.text : 'Press again to go on.');
      setTimeout(() => { if (armRef.current === primary.id) { armRef.current = null; setArming(''); } }, ARM_MS);
      return;
    }
    armRef.current = null;
    setArming('');
    const round = roundOf(snap && snap.state);
    const request = requestFor(primary.id, { gameId, round });
    if (!request) return;
    if (request.before) {
      const first = await authFetch(`${apiBase()}${request.before.path}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request.before.body),
      });
      if (!first || !first.ok) return;
    }
    await authFetch(`${apiBase()}${request.path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request.body),
    });
  }, [gameId]);

  const move = useCallback(async (dir) => {
    const now = Date.now();
    if (now - lastRef.current < KEY_DEBOUNCE_MS || busyRef.current) return;
    lastRef.current = now;
    const { snapshot: snap, total: n } = live.current;
    const writes = presentKeyStep(snap, dir, { total: n });
    busyRef.current = true;
    try {
      if (writes.length) await perform(gameId, snap, writes);
      else if (dir === 'forward') await runPrimary();
    } catch (e) {
      /* the wall keeps what it shows; the next press tries again */
    } finally {
      busyRef.current = false;
      after();
    }
  }, [gameId, runPrimary, after]);

  const joinShown = Boolean(snapshot && snapshot.stageFocus && snapshot.stageFocus.focus === 'join');
  const toggleJoin = useCallback(async () => {
    const snap = live.current.snapshot;
    const shown = Boolean(snap && snap.stageFocus && snap.stageFocus.focus === 'join');
    try {
      await perform(gameId, snap, [{ kind: 'focus', focus: shown ? 'none' : 'join' }]);
    } finally {
      after();
    }
  }, [gameId, after]);

  const onKey = useCallback((event) => {
    if (!event) return;
    if ((event.key === 'j' || event.key === 'J') && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      toggleJoin();
      return;
    }
    const dir = keyDirection(event);
    if (!dir) return;
    event.preventDefault();
    move(dir);
  }, [move, toggleJoin]);

  useEffect(() => {
    if (!armed) return undefined;
    window.addEventListener('keydown', onKey);
    const show = () => {
      setStrip(true);
      clearTimeout(stripTimer.current);
      stripTimer.current = setTimeout(() => setStrip(false), STRIP_MS);
    };
    window.addEventListener('mousemove', show);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousemove', show);
      clearTimeout(stripTimer.current);
    };
  }, [armed, onKey]);

  return {
    armed,
    step,
    arming,
    strip: armed && (strip || Boolean(arming)),
    forward: () => move('forward'),
    back: () => move('back'),
    toggleJoin,
    joinShown,
  };
}
