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
import { presentKeyStep } from './presentKeys';

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
 * @param {() => void} p.refetch    look again after a write
 * @returns {{ armed: boolean }}
 */
export default function usePresentControls({ gameId, snapshot, total, refetch }) {
  const [armed, setArmed] = useState(false);
  const lastRef = useRef(0);
  const busyRef = useRef(false);
  const live = useRef({ snapshot, total, refetch });
  live.current = { snapshot, total, refetch };

  // May this browser drive the session? Asked of the host's own door.
  useEffect(() => {
    if (!gameId) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const res = await authFetch(`${apiBase()}games/${gameId}/host-state`);
        if (!cancelled) setArmed(Boolean(res && res.ok));
      } catch (e) {
        if (!cancelled) setArmed(false);
      }
    })();
    return () => { cancelled = true; };
  }, [gameId]);

  const onKey = useCallback(async (event) => {
    const dir = keyDirection(event);
    if (!dir) return;
    event.preventDefault();
    const now = Date.now();
    if (now - lastRef.current < KEY_DEBOUNCE_MS || busyRef.current) return;
    lastRef.current = now;
    const { snapshot: snap, total: n, refetch: again } = live.current;
    const writes = presentKeyStep(snap, dir, { total: n });
    if (!writes.length) return;
    busyRef.current = true;
    try {
      await perform(gameId, snap, writes);
    } catch (e) {
      /* the wall keeps what it shows; the next press tries again */
    } finally {
      busyRef.current = false;
      if (again) again(true);
    }
  }, [gameId]);

  useEffect(() => {
    if (!armed) return undefined;
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [armed, onKey]);

  return { armed };
}
