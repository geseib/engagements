/**
 * THE PRESENTATION'S ONE SOURCE: THE SERVER (two-surface PLAN 2.8, D3).
 *
 * Reads only public routes, each already readable by anyone holding the code:
 *   GET  games/{id}/state?view=room            always
 *   GET  games/{id}/answers?questionNumber&view=room   during VOTE, when a
 *                                              response is on the wall
 *   POST games/get-results {gameId, questionNumber}    at RESULTS, for the
 *                                              round the room is on (the
 *                                              public route only reports)
 *   GET  games/{id}/ai-summary?questionId     on Workie's read
 *
 * FRAMES ARE REFETCH SIGNALS ONLY. Every frame's payload is ignored; it only
 * says "look again", debounced 400 ms so a burst of answers is one read. The
 * socket connects as a VIEWER (connect.js): no name, never host, its own tab id.
 * A reconnect, coming back online and the tab becoming visible all refetch.
 * Polls every 3 s while the room is answering or voting (progress frames are
 * host-only), every 10 s otherwise.
 *
 * Holds nothing but the last snapshot and the last reads. A reply overtaken by
 * a newer request is dropped, so a slow answer cannot walk the wall back.
 *
 * This module never imports the signed-in fetch: the wall is unauthenticated
 * (presentImports.test.js).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import webSocketClient from '../WebSocketClient';
import { startPresentStatus } from './presentStatusReporter';

// The window's own report (PRESENT_STATUS) is shared with the Build Room wall.
export { presentStatusPayload, FIRST_REPORT_EVERY_MS, FIRST_REPORT_TRIES } from './presentStatusReporter';

export const REFETCH_DEBOUNCE_MS = 400;
export const POLL_LIVE_MS = 3000;
export const POLL_IDLE_MS = 10000;

/** Every frame that can change what the wall shows. */
export const FOLLOW_FRAMES = [
  'gameStateChanged', 'initialStateSync', 'questionStarted', 'votingStarted', 'resultsReady',
  'gameEnded', 'playerJoined', 'playerAnswered', 'playerVoted', 'stageBeatChanged',
  'stageFocusChanged', 'stageProfileChanged', 'scoreboardChanged', 'aiSummaryReady',
  'commentFeatured', 'authorsRevealed', 'playerRemoved', 'followUpChanged',
];

const VIEWER_KEY = 'engage.presentViewerId';

/** One id per tab, kept across a reload of that tab. */
export function viewerIdForTab(storage) {
  try {
    const kept = storage && storage.getItem(VIEWER_KEY);
    if (kept && /^[A-Za-z0-9_-]{8,64}$/.test(kept)) return kept;
  } catch (e) { /* private mode: a fresh id each load */ }
  let id = '';
  try {
    id = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : '';
  } catch (e) { id = ''; }
  if (!id) id = `v-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  try { if (storage) storage.setItem(VIEWER_KEY, id); } catch (e) { /* ignore */ }
  return id;
}

const apiBase = () => (typeof window !== 'undefined' && window.API_BASE) || '';
const roundOf = (state) => {
  const m = /^(ASK|VOTE|RESULTS)#(\d+)$/.exec(String(state || ''));
  return m ? { phase: m[1], padded: m[2].padStart(3, '0') } : null;
};

async function readJson(res) {
  try { return await res.json(); } catch (e) { return null; }
}

export default function usePresentation(gameId) {
  const [snapshot, setSnapshot] = useState(null);
  const [reads, setReads] = useState({ answers: null, results: null, summary: null, comments: null, ask: null });
  const seqRef = useRef(0);
  const appliedRef = useRef(0);
  const debounceRef = useRef(null);
  const snapshotRef = useRef(null);
  const readsKeyRef = useRef({ answers: null, results: null, summary: null, comments: null, ask: null });

  /** The reads the moment needs, each fetched once per round unless a frame says otherwise. */
  const refreshReads = useCallback(async (snap, force) => {
    const round = roundOf(snap && snap.state);
    const base = apiBase();
    const next = {};
    const focus = (snap && snap.stageFocus) || {};
    // Voting shows the responses from the start, so the read is due all of VOTE.
    if (round && round.phase === 'VOTE') {
      const key = `${round.padded}`;
      if (force || readsKeyRef.current.answers !== key) {
        try {
          const res = await fetch(`${base}games/${gameId}/answers?questionNumber=${round.padded}&view=room`);
          if (res.ok) {
            const body = await readJson(res);
            next.answers = Array.isArray(body && body.answers) ? body.answers : [];
            readsKeyRef.current.answers = key;
          }
        } catch (e) { /* the next poll tries again */ }
      }
    }
    if (round && round.phase === 'RESULTS') {
      const key = round.padded;
      if (force || readsKeyRef.current.results !== key) {
        try {
          const res = await fetch(`${base}games/get-results`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ gameId: String(gameId), questionNumber: round.padded }),
          });
          if (res.ok) {
            next.results = await readJson(res);
            readsKeyRef.current.results = key;
          }
        } catch (e) { /* the next poll tries again */ }
      }
      // A QUESTION FOR THE ROOM (the `ask` beat): the public read, which carries
      // counts and picked ideas only. `followUpChanged` forces it.
      if (snap.stageBeat === 'ask') {
        try {
          const res = await fetch(`${base}games/${gameId}/followup-play/live`);
          if (res.ok) {
            const body = await readJson(res);
            next.ask = body && body.ask ? body.ask : null;
          }
        } catch (e) { /* the next poll tries again */ }
      }
      // THE FEEDBACK ROUND'S FEATURED COMMENT (owner, 2026-10-13): the host
      // puts one up on the laptop or the Remote; the wall shows it too.
      // `commentFeatured` forces this read.
      if (snap.stageBeat === 'feedback' && (force || readsKeyRef.current.comments !== key)) {
        try {
          const res = await fetch(`${base}games/${gameId}/comments?questionNumber=${encodeURIComponent(round.padded)}`);
          if (res.ok) {
            const body = await readJson(res);
            next.comments = Array.isArray(body && body.comments) ? body.comments : [];
            readsKeyRef.current.comments = key;
          }
        } catch (e) { /* the next poll tries again */ }
      }
      if (snap.stageBeat === 'field-notes' && (force || readsKeyRef.current.summary !== key)) {
        try {
          const res = await fetch(`${base}games/${gameId}/ai-summary?questionId=${encodeURIComponent(round.padded)}`);
          if (res.ok) {
            next.summary = await readJson(res);
            readsKeyRef.current.summary = key;
          }
          // 404: Workie has not written yet; aiSummaryReady or the poll brings it.
        } catch (e) { /* the next poll tries again */ }
      }
    }
    if (Object.keys(next).length) setReads((cur) => ({ ...cur, ...next }));
  }, [gameId]);

  const refetch = useCallback(async (force = false) => {
    if (!gameId) return;
    seqRef.current += 1;
    const seq = seqRef.current;
    let snap = null;
    try {
      const res = await fetch(`${apiBase()}games/${gameId}/state?view=room`);
      if (res.status === 404) snap = { notFound: true };
      else if (res.ok) snap = await readJson(res);
      else return;
    } catch (e) {
      return; // offline: the next poll, `online` or a reconnect tries again
    }
    if (!snap || seq < appliedRef.current) return; // overtaken
    appliedRef.current = seq;
    const prevRound = roundOf(snapshotRef.current && snapshotRef.current.state);
    const nowRound = roundOf(snap.state);
    if (!prevRound || !nowRound || prevRound.padded !== nowRound.padded) {
      readsKeyRef.current = { answers: null, results: null, summary: null, comments: null, ask: null };
      setReads({ answers: null, results: null, summary: null, comments: null, ask: null });
    }
    snapshotRef.current = snap;
    setSnapshot(snap);
    if (!snap.notFound) await refreshReads(snap, force);
  }, [gameId, refreshReads]);

  const schedule = useCallback((force = false) => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { refetch(force); }, REFETCH_DEBOUNCE_MS);
  }, [refetch]);

  // First read, and the viewer socket.
  useEffect(() => {
    if (!gameId) return undefined;
    refetch(true);
    let storage = null;
    try { storage = window.sessionStorage; } catch (e) { storage = null; }
    const viewerId = viewerIdForTab(storage);
    webSocketClient.connect(gameId, null, false, { viewerId });
    FOLLOW_FRAMES.forEach((type) => webSocketClient.onMessage(type, () => schedule(true)));
    const status = startPresentStatus(webSocketClient);
    webSocketClient.onReconnected(() => { schedule(true); status.report(); });
    return () => {
      clearTimeout(debounceRef.current);
      status.stop();
      FOLLOW_FRAMES.forEach((type) => webSocketClient.offMessage(type));
      webSocketClient.onReconnected(null);
      webSocketClient.disconnect();
    };
  }, [gameId, refetch, schedule]);

  // Online again, or visible again: look, and reconnect a socket that gave up.
  useEffect(() => {
    if (!gameId) return undefined;
    const wake = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      if (webSocketClient.isConnected && !webSocketClient.isConnected()) {
        let storage = null;
        try { storage = window.sessionStorage; } catch (e) { storage = null; }
        webSocketClient.connect(gameId, null, false, { viewerId: viewerIdForTab(storage) });
      }
      schedule(true);
    };
    window.addEventListener('online', wake);
    document.addEventListener('visibilitychange', wake);
    return () => {
      window.removeEventListener('online', wake);
      document.removeEventListener('visibilitychange', wake);
    };
  }, [gameId, schedule]);

  // The poll: fast while the room is acting, slow otherwise.
  const live = Boolean(snapshot && /^(ASK|VOTE)#/.test(String(snapshot.state || '')));
  const waitingForRead = Boolean(snapshot && snapshot.stageBeat === 'field-notes' && !reads.summary);
  const gone = Boolean(snapshot && snapshot.notFound);
  useEffect(() => {
    if (!gameId || gone) return undefined;
    const every = live || waitingForRead ? POLL_LIVE_MS : POLL_IDLE_MS;
    const timer = setInterval(() => { refetch(waitingForRead); }, every);
    return () => clearInterval(timer);
  }, [gameId, live, waitingForRead, refetch, gone]);

  return { snapshot, reads, refetch };
}
