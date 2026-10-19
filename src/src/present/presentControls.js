/**
 * KEYS AND A CLICKER ON THE PRESENTATION (two-surface PLAN 2.11, D7; owner,
 * 2026-10-13).
 *
 * When the Presentation window has focus, Space / → / ↓ / PageDown step
 * forward and ← / ↑ / PageUp step back through what is on the wall
 * (present/presentKeys.js decides what that means). A clicker sends
 * PageDown/PageUp or the arrows, so it works too. During voting ↑ ↓ page
 * (a long answer's parts) or do nothing, as the one-screen laptop's ↑ ↓ page
 * its ballot; → ← step the answers (presentKeys.js, `vertical`).
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
import { authFetch, getAuthToken } from '../auth/authFetch';
import { remoteStep, requestFor } from '../config/hostRemote';
import { presentKeyStep } from './presentKeys';
import { joinShown, joinRequest } from '../config/stageFocus';

/**
 * THE ROUND'S OWN NEXT STEP FROM THE WALL (owner, 2026-10-13: "when
 * presenting i still need ability to ... move things forward"). When there is
 * nothing left on the wall to step through, Forward runs the same primary the
 * Remote and the host's dock show (roundStep, through the Remote's reading of
 * the host door). It always asks first, on the wall, in one card: "Next:
 * Start voting" with ← Back and → Start voting (owner, same day: "perhaps with
 * a safety ask? modal pops up"). Only these ids; the rest stay with the host's
 * own screens.
 */
export const WALL_PRIMARIES = ['start', 'next', 'open-vote', 'vote', 'reveal', 'reveal-from-ask', 'results', 'field-notes', 'notes-page'];
export const CONFIRM_MS = 8000;
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

/** ↑ or ↓: the vertical keys, which page rather than step during voting. */
export const isVerticalKey = (event) => Boolean(event) && (event.key === 'ArrowUp' || event.key === 'ArrowDown');

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
    } else if (w.kind === 'join') {
      // The QR side panel alone: no focus in the body, so the server keeps the
      // focus as it is (stage-focus.js; config/stageFocus.js joinRequest).
      path = 'stage-focus';
      body = joinRequest({ join: w.join, state: snapshot && snapshot.state });
      if (!body) return false;
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
 * WHY THE CONTROLS ARE OFF, said on the wall rather than silently (the owner
 * pressed keys and nothing happened). From the host's door for this session:
 *   'host'       200: this browser may drive the session
 *   'signed-out' no sign-in on this browser (no token, or a 401)
 *   'not-host'   signed in, but not as someone who may drive it (403/404)
 *   'offline'    the check itself failed; it is tried again
 */
export const ACCESS_NOTES = {
  checking: 'Checking that this browser may run the session.',
  'signed-out': 'The keys work here once this browser is signed in as the host. Sign in on this browser, then reload this window.',
  'not-host': 'This browser is signed in, but not as a host of this session, so the keys do nothing here.',
  offline: 'Cannot reach the session to check. Trying again.',
};

async function checkAccess(gameId) {
  try {
    const token = await getAuthToken();
    if (!token) return { access: 'signed-out', json: null };
    const res = await authFetch(`${apiBase()}games/${gameId}/host-state`);
    if (res && res.ok) return { access: 'host', json: await res.json().catch(() => null) };
    if (res && res.status === 401) return { access: 'signed-out', json: null };
    if (res && (res.status === 403 || res.status === 404)) return { access: 'not-host', json: null };
    return { access: 'offline', json: null };
  } catch (e) {
    return { access: 'offline', json: null };
  }
}

/**
 * @param {object} p
 * @param {string} p.gameId
 * @param {object|null} p.snapshot  the wall's last /state
 * @param {number} p.total          how many responses the round has
 * @param {boolean} p.overview      every answer fits on the voting overview (presentModel)
 * @param {boolean} p.notesReady    Workie's read has arrived on the wall
 * @param {(force?: boolean) => void} p.refetch  look again after a write
 */
export default function usePresentControls({ gameId, snapshot, total, overview = false, notesReady = true, refetch }) {
  const [access, setAccess] = useState('checking');
  const [hostState, setHostState] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [strip, setStrip] = useState(false);
  const lastRef = useRef(0);
  const busyRef = useRef(false);
  const stripTimer = useRef(null);
  const confirmTimer = useRef(null);
  const live = useRef({});

  const step = hostState ? remoteStep(hostState, {
    playerCount: Number(snapshot && snapshot.roomCounts && snapshot.roomCounts.joined) || 0,
    answerCount: total,
    notesReady,
    hasQuestionSet: true,
  }) : null;
  live.current = { snapshot, total, overview, refetch, step, access, confirm };

  const recheck = useCallback(async () => {
    if (!gameId) return 'signed-out';
    const { access: a, json } = await checkAccess(gameId);
    setAccess(a);
    if (json) setHostState(json);
    return a;
  }, [gameId]);

  // Asked of the host's door now and every few seconds: the door also
  // carries the progress the next step needs.
  useEffect(() => {
    if (!gameId) return undefined;
    recheck();
    const timer = setInterval(recheck, HOST_POLL_MS);
    return () => clearInterval(timer);
  }, [gameId, recheck]);

  const showStrip = useCallback(() => {
    setStrip(true);
    clearTimeout(stripTimer.current);
    stripTimer.current = setTimeout(() => setStrip(false), STRIP_MS);
  }, []);

  const after = useCallback(() => {
    const again = live.current.refetch;
    if (again) again(true);
  }, []);

  const closeConfirm = useCallback(() => {
    clearTimeout(confirmTimer.current);
    setConfirm(null);
  }, []);

  /** Ask before the round moves: the card on the wall. */
  const askPrimary = useCallback(() => {
    const st = live.current.step;
    const primary = st && st.primary;
    if (!primary || primary.disabled || !WALL_PRIMARIES.includes(primary.id)) {
      showStrip();
      return;
    }
    setConfirm({ id: primary.id, label: primary.label, note: primary.arm && primary.arm.text ? primary.arm.text.replace(/ Press again to [^.]*\./, '') : '' });
    clearTimeout(confirmTimer.current);
    confirmTimer.current = setTimeout(() => setConfirm(null), CONFIRM_MS);
  }, [showStrip]);

  const runConfirmed = useCallback(async () => {
    const pending = live.current.confirm;
    closeConfirm();
    if (!pending) return;
    const snap = live.current.snapshot;
    const request = requestFor(pending.id, { gameId, round: roundOf(snap && snap.state) });
    if (!request) return;
    try {
      if (request.before) {
        const first = await authFetch(`${apiBase()}${request.before.path}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request.before.body),
        });
        if (!first || !first.ok) return;
      }
      await authFetch(`${apiBase()}${request.path}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request.body),
      });
    } finally {
      after();
    }
  }, [gameId, closeConfirm, after]);

  const move = useCallback(async (dir, { vertical = false } = {}) => {
    const now = Date.now();
    if (now - lastRef.current < KEY_DEBOUNCE_MS || busyRef.current) return;
    lastRef.current = now;
    if (live.current.confirm) {
      if (dir === 'forward') await runConfirmed();
      else closeConfirm();
      return;
    }
    let a = live.current.access;
    if (a !== 'host') a = await recheck();
    if (a !== 'host') { showStrip(); return; }
    const { snapshot: snap, total: n, overview: fits } = live.current;
    const writes = presentKeyStep(snap, dir, { total: n, overview: Boolean(fits), vertical });
    if (!writes.length) {
      // A page key with nothing to page does nothing: it never asks for the round's next step.
      if (dir === 'forward' && !(vertical && /^VOTE#/.test(String((snap && snap.state) || '')))) askPrimary();
      return;
    }
    busyRef.current = true;
    try {
      await perform(gameId, snap, writes);
    } catch (e) {
      /* the wall keeps what it shows; the next press tries again */
    } finally {
      busyRef.current = false;
      after();
    }
  }, [gameId, recheck, showStrip, askPrimary, runConfirmed, closeConfirm, after]);

  // THE QR SIDE PANEL (owner, 18 Oct 2026): J shows it beside the moment and
  // takes it down again, {join: !current}; the focus is left as it is.
  const qrShown = joinShown(snapshot && snapshot.stageFocus);
  const toggleJoin = useCallback(async () => {
    let a = live.current.access;
    if (a !== 'host') a = await recheck();
    if (a !== 'host') { showStrip(); return; }
    const snap = live.current.snapshot;
    const shown = joinShown(snap && snap.stageFocus);
    try {
      await perform(gameId, snap, [{ kind: 'join', join: !shown }]);
    } finally {
      after();
    }
  }, [gameId, recheck, showStrip, after]);

  const onKey = useCallback((event) => {
    if (!event || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === 'j' || event.key === 'J') {
      event.preventDefault();
      toggleJoin();
      return;
    }
    if (live.current.confirm && (event.key === 'Enter' || event.key === 'Escape')) {
      event.preventDefault();
      if (event.key === 'Enter') runConfirmed(); else closeConfirm();
      return;
    }
    const dir = keyDirection(event);
    if (!dir) return;
    event.preventDefault();
    move(dir, { vertical: isVerticalKey(event) });
  }, [move, toggleJoin, runConfirmed, closeConfirm]);

  // Keys are always heard, so a press while the controls are off says why.
  useEffect(() => {
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousemove', showStrip);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousemove', showStrip);
      clearTimeout(stripTimer.current);
      clearTimeout(confirmTimer.current);
    };
  }, [onKey, showStrip]);

  return {
    access,
    armed: access === 'host',
    note: access === 'host' ? '' : ACCESS_NOTES[access] || '',
    step,
    confirm,
    strip: strip && !confirm,
    forward: () => move('forward'),
    back: () => move('back'),
    confirmGo: runConfirmed,
    confirmCancel: closeConfirm,
    toggleJoin,
    joinShown: qrShown,
  };
}
