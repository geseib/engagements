import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { QRCodeCanvas as QRCode } from 'qrcode.react';
import './HostRemote.css';
import Icon from './components/Icon';
import RemoteSessionPanel from './components/RemoteSessionPanel';
import RemoteCategoryList from './components/RemoteCategoryList';
import RemoteFocusPanel from './components/RemoteFocusPanel';
import { authFetch } from './auth/authFetch';
import { categoryRows } from './config/setupPanel';
import { focusRequest, sameFocus, NO_FOCUS } from './config/stageFocus';
import {
  primaryAction,
  skipAction,
  requestFor,
  askNextRequest,
  roundProgress,
  needsConfirmation,
  phaseSummary,
  waitingOn,
  fieldNotesFrom,
} from './config/hostRemote';

/**
 * The host's phone.
 *
 * ARCHITECTURE — this is a STANDALONE controller, not a proxy.
 *
 * The previous remote worked entirely by `postMessage` into an open host page:
 * it opened /host in a popup, kept the window handle, and posted NEXT_QUESTION /
 * START_VOTING / SHOW_RESULTS at it. Three things were wrong with that, in
 * increasing order of severity:
 *
 *   1. it read fields the API does not emit (`gameState.currentState`,
 *      `gameState.eventTitle`, `gameState.currentQuestionData`,
 *      `gameState.playerCount`) so the whole status block rendered blank/0;
 *   2. it polled `GET /games/{id}`, which carries no player count and no
 *      answer/vote progress — the one thing a host actually needs in order to
 *      know whether it is safe to advance;
 *   3. it was dead whenever the host page was closed, reloading, or on another
 *      device, and it failed SILENTLY — the receiving switch called bare
 *      identifiers that had never been declared, and `typeof x === 'function'`
 *      on an undeclared name is 'undefined', not a throw.
 *
 * The owner's framing was "control this session just like players can play
 * remotely on their phone", and players are standalone: their phones talk to the
 * API, with nothing else open. So this does the same. Every advance is an HTTP
 * call to the exact endpoint the host toolbar calls, and the room follows over
 * the WebSocket broadcasts those endpoints already emit (`questionStarted`,
 * `votingStarted`, and — newly — `gameStateChanged` from get-results, which
 * previously announced nothing at all).
 *
 * The host page therefore becomes an optional DISPLAY. Close it and the session
 * still runs; open it and it follows, because GameHostPage already re-syncs on
 * each of those messages.
 *
 * WHY NOT A WEBSOCKET HERE. Pushing beats polling, and the plumbing exists —
 * but `lambda-functions/websocket/connect.js` deletes every existing HOST
 * connection whenever a new one arrives with `isHost=true`. A remote connecting
 * as host would evict the projector's socket; the projector's heartbeat would
 * reconnect and evict the remote; repeat. Connecting as a player instead would
 * put a phantom in the roster's connection list. So the remote polls — one
 * device, two requests every couple of seconds — and the eviction bug is
 * reported rather than worked around.
 *
 * WHAT STILL NEEDS THE OPEN PAGE: scroll and big-screen are pure display
 * concerns with no server representation, so they keep the postMessage path and
 * are shown as unavailable until this remote has opened the page itself (a
 * window handle cannot be obtained for a page someone else opened).
 */

const STATE_POLL_MS = 2000;
const ROSTER_POLL_MS = 6000;

/**
 * How often to re-ask for the AI read-back while it is on screen but not
 * written yet.
 *
 * The host page is told over the WebSocket (`aiSummaryReady`); this page holds
 * no socket, so it asks again. Only while the beat is actually showing — the
 * endpoint 404s on a cache miss, and asking every two seconds from the moment
 * results open would be a request per poll for a screen nobody opened.
 */
const AI_POLL_MS = 4000;

/** How long an armed confirmation stays armed before it relaxes again. */
const ARM_TIMEOUT_MS = 5000;

/**
 * Dead time after a successful advance.
 *
 * next-question.js is idempotent for a SEQUENTIAL double-tap — the second call
 * sees ASK#nnn and returns "already asking a question" without advancing — but
 * that guard reads state that the first call may not have written yet. Two taps
 * inside one round trip can both pass it, select two different questions, and
 * show one. The cooldown makes the window unreachable by thumb.
 */
const COOLDOWN_MS = 1200;

const apiBase = () => window.API_BASE || '';

function HostRemote() {
  const [gameId, setGameId] = useState('');
  const [gameIdDraft, setGameIdDraft] = useState('');
  const [snapshot, setSnapshot] = useState(null);
  const [roster, setRoster] = useState(null);
  const [aiSummary, setAiSummary] = useState(null);
  /*
    THE ROUND'S RESPONSES, so the host can pick one to put on the wall.

    `/state?includeHostData=true` carries answer PROGRESS — how many have come
    in, and who has not answered — but never the text, so this is a second
    fetch. It is deliberately not folded into the state poll: the text is only
    needed while the focus panel is open, and pulling every response every two
    seconds for a panel nobody opened is a request per poll for nothing.
  */
  const [focusAnswers, setFocusAnswers] = useState([]);
  const [focusOpen, setFocusOpen] = useState(false);
  const [focusBusy, setFocusBusy] = useState(false);
  const [connected, setConnected] = useState(false);

  const [busyAction, setBusyAction] = useState(null);
  const [armedAction, setArmedAction] = useState(null);
  const [cooling, setCooling] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [joinOpen, setJoinOpen] = useState(false);
  const [screenOpen, setScreenOpen] = useState(false);
  const [hostWindow, setHostWindow] = useState(null);

  /**
   * WHICH LIST IS OPEN, or null for the round view.
   *
   *   *"it would be nice if it had the same menu as the main screen with
   *    listing the players, the rounds, the questions."*
   *
   * One piece of state for all three, because they are one place: opening the
   * panel on Players and switching to Questions must not be two navigations,
   * and the way back must be the same control whichever list you ended up on.
   * It replaces the old `browsing` boolean, which could only ever say
   * "questions" — see RemoteSessionPanel for where that screen's bar and dock
   * went, and why.
   */
  const [panelTab, setPanelTab] = useState(null);
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [categories, setCategories] = useState([]);
  const [togglingCategory, setTogglingCategory] = useState(false);

  // A poll must never stack on a slow reply, and a reply for a game the host has
  // since left must never repaint the new one.
  const inFlightRef = useRef(false);
  const activeGameRef = useRef('');
  const armTimerRef = useRef(null);
  const coolTimerRef = useRef(null);

  useEffect(() => { activeGameRef.current = gameId; }, [gameId]);

  useEffect(() => () => {
    clearTimeout(armTimerRef.current);
    clearTimeout(coolTimerRef.current);
  }, []);

  // Flashes clear themselves. A stale "Join link copied" still sitting there two
  // rounds later trains the host to ignore the one place errors appear.
  useEffect(() => {
    if (!error && !notice) return undefined;
    const timer = setTimeout(() => { setError(''); setNotice(''); }, 5000);
    return () => clearTimeout(timer);
  }, [error, notice]);

  // Game id from ?gameId=, so the host page's "open remote" link lands ready.
  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get('gameId');
    if (fromUrl) setGameId(fromUrl.trim().toUpperCase());
  }, []);

  /* ------------------------------------------------------------ polling */

  const pollState = useCallback(async (id) => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      // `/state?includeHostData=true` — NOT `/games/{id}`, which the old remote
      // polled. This is the only endpoint that carries answer/vote progress, and
      // it computes that progress with the same player deduplication the roster
      // uses, so the remote and the host screen cannot disagree about whether
      // the room is finished.
      const res = await fetch(`${apiBase()}games/${id}/state?includeHostData=true`);
      if (activeGameRef.current !== id) return;
      if (!res.ok) { setConnected(false); return; }
      setSnapshot(await res.json());
      setConnected(true);
    } catch {
      if (activeGameRef.current === id) setConnected(false);
    } finally {
      inFlightRef.current = false;
    }
  }, []);

  // KEEP THE ARRAY. This used to reduce the whole roster to
  // `data.stats.totalPlayers` and throw away every name — while the one thing a
  // facilitator actually needs mid-round is who has NOT acted yet, so they can
  // say "hey George, we are waiting on you". That is a different fact from who
  // wrote what, and get-players never returns answer text; see waitingOn().
  const pollRoster = useCallback(async (id) => {
    try {
      const res = await fetch(`${apiBase()}games/${id}/players`);
      if (!res.ok || activeGameRef.current !== id) return;
      setRoster(await res.json());
    } catch {
      /* roster is a nicety; the status card does not depend on it */
    }
  }, []);

  useEffect(() => {
    if (!gameId) return undefined;
    setSnapshot(null);
    setRoster(null);

    pollState(gameId);
    pollRoster(gameId);
    const stateTimer = setInterval(() => pollState(gameId), STATE_POLL_MS);
    const rosterTimer = setInterval(() => pollRoster(gameId), ROSTER_POLL_MS);
    return () => { clearInterval(stateTimer); clearInterval(rosterTimer); };
  }, [gameId, pollState, pollRoster]);

  /* ------------------------------------------------- derived, all pure */

  const gameType = snapshot?.gameType || snapshot?.gameMetadata?.gameType;
  const summary = useMemo(() => phaseSummary(snapshot), [snapshot]);
  const progress = useMemo(() => roundProgress(snapshot), [snapshot]);
  // `stageBeat` comes from the SERVER (get-game-state), so the phone follows
  // the projector as well as driving it. Without passing it here the two-step
  // in primaryAction is dead code: the phone would offer "What We Heard"
  // forever and never advance.
  const stageBeat = snapshot?.stageBeat;
  /*
    WHAT THE ROOM IS LOOKING AT CLOSELY, from the SERVER — the same deal
    `stageBeat` above has, for the same reason. This phone holds no WebSocket,
    so `get-game-state`'s projection is the only way a spotlight opened on the
    projector reaches it, and without following it the phone would offer "Show
    the room" for a response the room is already reading.
  */
  const stageFocus = snapshot?.stageFocus || NO_FOCUS;
  const action = useMemo(
    () => primaryAction(snapshot?.state, gameType, stageBeat),
    [snapshot, gameType, stageBeat]
  );
  const skip = useMemo(() => skipAction(snapshot?.state), [snapshot]);
  const round = snapshot?.currentQuestion || null;
  const title = snapshot?.gameMetadata?.title || '';
  const setId = snapshot?.gameMetadata?.questionSetId || '';

  // How many questions the game can still reach, straight from the server's own
  // per-category tally. The client has no other honest source: `usedQuestionIds`
  // on the host page is a list of the rounds THAT TAB watched go by, so a phone
  // that joined at round four would report the first three as unasked.
  const unaskedCount = typeof snapshot?.categoryCounts?.totalRemaining === 'number'
    ? snapshot.categoryCounts.totalRemaining
    : null;

  // categoryRows() from config/setupPanel.js — the one decode of the bitmask,
  // shared with the stage panel rather than written a second time here.
  const catRows = useMemo(() => categoryRows({
    categories,
    categoryCounts: snapshot?.categoryCounts || null,
    categoryBitmasks: snapshot?.categoryState || null,
    activeCategoryIds: new Set(snapshot?.gameMetadata?.selectedCategories || []),
  }), [categories, snapshot]);
  const categoriesLive = catRows.length > 0 && catRows[0].live;

  // The count the status card shows outside ASK/VOTE. Same number as before —
  // it is now derived from the roster rather than being the only thing kept.
  const rosterCount = roster
    ? (roster.stats?.totalPlayers ?? roster.players?.length ?? null)
    : null;

  const waiting = useMemo(() => waitingOn(roster, snapshot?.state), [roster, snapshot]);
  const notes = useMemo(() => fieldNotesFrom(aiSummary), [aiSummary]);

  /** Is the room reading the AI's read-back right now? */
  const onFieldNotes = summary.phase === 'RESULTS' && stageBeat === 'field-notes';

  /* ------------------------------------------------------- the read-back */

  // A new round's summary is a different document. Dropping the old one is what
  // stops round 4's phone showing round 3's paragraph for a few seconds.
  useEffect(() => { setAiSummary(null); }, [gameId, round]);

  useEffect(() => {
    if (!gameId || !onFieldNotes || notes.ready) return undefined;

    let cancelled = false;
    const load = async () => {
      try {
        // Public route, no authorizer (template-clean.yaml:744) — a plain
        // fetch. 404 is the endpoint's honest "not written yet", not an error.
        const res = await fetch(`${apiBase()}games/${gameId}/ai-summary`);
        if (cancelled || !res.ok || activeGameRef.current !== gameId) return;
        setAiSummary(await res.json());
      } catch {
        /* the beat is still on screen; the next tick asks again */
      }
    };

    load();
    const timer = setInterval(load, AI_POLL_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, [gameId, onFieldNotes, notes.ready]);

  /* ----------------------------------------------------------- the focus */

  // A new round's responses are different rows. Dropping the old list is what
  // stops round 4's phone offering round 3's answers to put on the wall — and
  // the index it would send addresses round 4, so the room would get a
  // different response from the one the host tapped.
  useEffect(() => { setFocusAnswers([]); }, [gameId, round]);

  /*
    Only while the panel is open, and only once there is a round to have
    responses. Same discipline as the read-back poll above: this is the second
    request the phone makes per tick, and a panel nobody opened should cost
    nothing.
  */
  useEffect(() => {
    if (!gameId || !focusOpen || !round) return undefined;

    let cancelled = false;
    const load = async () => {
      try {
        // Public route, plain fetch — the same URL GameHostPage uses.
        // `role=host` is what returns the text rather than the redacted
        // player view.
        const padded = String(round).padStart(3, '0');
        const res = await fetch(`${apiBase()}games/${gameId}/answers?role=host&questionId=${padded}`);
        if (cancelled || !res.ok || activeGameRef.current !== gameId) return;
        const payload = await res.json();
        setFocusAnswers(Array.isArray(payload.answers) ? payload.answers : []);
      } catch {
        /* the panel keeps what it has; the next tick asks again */
      }
    };

    load();
    const timer = setInterval(load, AI_POLL_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, [gameId, focusOpen, round]);

  /**
   * Put something on the room's screen — or take it off.
   *
   * `focusRequest` builds the body and refuses when there is no round to
   * address, so a tap from the lobby costs no request rather than writing a
   * ROUND#000 row nothing will ever read.
   *
   * A press that changes nothing sends nothing. The phone is stale by
   * construction — two seconds of poll — so a host who taps a row that is
   * already showing has simply tapped what they can see, and the far end is
   * idempotent anyway; the saving is a request, and more importantly a
   * needless repaint of the room.
   *
   * `authFetch`: /stage-focus carries the Cognito authorizer, like
   * /stage-beat and /close-round. This one puts ONE NAMED PERSON'S RESPONSE
   * full-screen on a wall, which is why it is not a public route.
   */
  const setStageFocus = useCallback(async (next) => {
    if (!gameId || focusBusy) return;
    if (sameFocus(next, stageFocus)) return;

    const body = focusRequest({ ...next, state: snapshot?.state });
    if (!body) return;

    setFocusBusy(true);
    try {
      const res = await authFetch(`${apiBase()}games/${gameId}/stage-focus`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        setError(payload.error || 'Could not change what the room is seeing.');
        return;
      }
      // Re-read rather than patching locally. The state poll is the phone's
      // only source of truth about the focus, and an optimistic edit that a
      // failed write left lying is exactly what this avoids — the same reason
      // toggleCategory re-polls instead of setting the row itself.
      await pollState(gameId);
    } catch {
      setError('No connection. Check signal and try again.');
    } finally {
      setFocusBusy(false);
    }
  }, [gameId, focusBusy, stageFocus, snapshot, pollState]);

  /* ------------------------------------------------------------ categories */

  // The NAMES only. Enablement and remaining counts come from the state poll
  // that is already running, so this is one request per session and not a third
  // timer. Ordered as the set stores them, which is what makes the row index a
  // bitmask position — see categoryRows().
  useEffect(() => {
    if (!setId) { setCategories([]); return undefined; }

    let cancelled = false;
    (async () => {
      try {
        // authFetch: this route now carries the Cognito authorizer. The remote
        // is a signed-in host surface, so the token is available here.
        const res = await authFetch(`${apiBase()}question-sets/${setId}/categories`);
        if (cancelled || !res.ok) return;
        const data = await res.json();
        if (!cancelled) setCategories(Array.isArray(data.categories) ? data.categories : []);
      } catch {
        /* the Categories disclosure says "no categories" rather than throwing */
      }
    })();

    return () => { cancelled = true; };
  }, [setId]);

  const confirmNeeded = needsConfirmation(action, progress);
  const primaryArmed = armedAction === 'primary';
  const blocked = !!busyAction || cooling || !snapshot;

  /* ------------------------------------------------------------ actions */

  const disarm = useCallback(() => {
    clearTimeout(armTimerRef.current);
    setArmedAction(null);
  }, []);

  const arm = useCallback((which) => {
    setArmedAction(which);
    clearTimeout(armTimerRef.current);
    armTimerRef.current = setTimeout(() => setArmedAction(null), ARM_TIMEOUT_MS);
  }, []);

  const fire = useCallback(async (actionId) => {
    const request = requestFor(actionId, { gameId, round });
    if (!request) {
      // Only reachable when the round number has not loaded yet. Guessing it
      // would resolve or vote on the wrong round.
      setError('Still reading the session — try again in a second.');
      return;
    }

    disarm();
    setError('');
    setNotice('');
    setBusyAction(actionId);

    try {
      // authFetch, not fetch. EVERY action dispatched here is now an
      // authenticated route — next-question, start-vote and close-round all
      // drive somebody's live session, and a four-digit code is not a secret:
      // it is on the projector and typed by everyone in the room. This page is
      // behind ProtectedRoute, so the host is signed in and the token is there.
      //
      // The path is built by config/hostRemote.js, so no route name appears in
      // this file. That is why tests/session-control-routes-authorization.js
      // checks both `request.path` dispatch sites by shape rather than by
      // grepping for the routes.
      const res = await authFetch(`${apiBase()}${request.path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request.body),
      });
      const payload = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(payload.message || payload.error || `That did not go through (${res.status}).`);
        return;
      }

      // next-question answers "already asking a question" with a 200 when the
      // guard refuses a duplicate advance. Surfacing it is the honest thing: the
      // host pressed a button and the round did not change.
      if (payload.message === 'Already asking a question') {
        setNotice('Already on this round.');
      } else if (payload.gameEnded) {
        setNotice('That was the last round.');
      }

      await pollState(gameId);

      setCooling(true);
      clearTimeout(coolTimerRef.current);
      coolTimerRef.current = setTimeout(() => setCooling(false), COOLDOWN_MS);
    } catch {
      setError('No connection. Check signal and try again.');
    } finally {
      setBusyAction(null);
    }
  }, [gameId, round, disarm, pollState]);

  const onPrimary = useCallback(() => {
    if (!action || blocked) return;
    // Arm-then-fire, applied EXACTLY where a mis-tap costs something: leaving
    // ASK or VOTE before the room has finished discards whoever is still
    // typing or voting. When everyone is in — and on the RESULTS beat, which
    // discards nothing — it is one tap, because a button that fights the host
    // on the expected beat reads as broken in front of a room.
    if (confirmNeeded && !primaryArmed) { arm('primary'); return; }
    fire(action.id);
  }, [action, blocked, confirmNeeded, primaryArmed, arm, fire]);

  const onSkip = useCallback(() => {
    if (!skip || blocked) return;
    if (armedAction !== 'skip') { arm('skip'); return; }
    fire('skip');
  }, [skip, blocked, armedAction, arm, fire]);

  /**
   * "Ask this next" from the phone's browser.
   *
   * Goes through the same POST-then-repoll-then-cool path every other advance
   * uses, because it IS an advance — mid-round it skips the round on screen —
   * and the cooldown is what stops a double-tap consuming two questions.
   *
   * authFetch, like every other dispatch here. `next-question` USED to be a
   * public route — this comment used to say so, and say that only
   * /close-round, /stage-beat and /reveal-authors were authenticated. That is
   * no longer true: an unauthenticated next-question let anyone holding the
   * join code advance the round out from under the host.
   *
   * GameHostPage.selectQuestion calls the same route the same way, and moved
   * in the same change — the two must not diverge.
   */
  const askSpecific = useCallback(async (row) => {
    const request = askNextRequest({ gameId, questionId: row?.id, state: snapshot?.state });
    if (!request) {
      setError('Still reading the session — try again in a second.');
      return;
    }

    setError('');
    setNotice('');
    setBusyAction('ask');

    try {
      const res = await authFetch(`${apiBase()}${request.path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request.body),
      });
      const payload = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(payload.error || payload.message || `That did not go through (${res.status}).`);
        return;
      }

      await pollState(gameId);
      // Back to the round, the way the stage panel closes itself before the
      // question lands: the host chose, and the next thing they need is the
      // progress meter, not the list they just left.
      setPanelTab(null);
      setNotice(row.title ? `Now asking: ${row.title}` : 'Question selected.');

      setCooling(true);
      clearTimeout(coolTimerRef.current);
      coolTimerRef.current = setTimeout(() => setCooling(false), COOLDOWN_MS);
    } catch {
      setError('No connection. Check signal and try again.');
    } finally {
      setBusyAction(null);
    }
  }, [gameId, snapshot, pollState]);

  /**
   * Turn a category on or off mid-session — the same endpoint and the same
   * argument order `GameHostPage.toggleCategoryDuringGame` uses. `position` is
   * 1-based and sent as a string because that is what toggle-category.js reads;
   * getting that seam wrong toggles the neighbouring category.
   */
  const toggleCategory = useCallback(async (row) => {
    if (!gameId || togglingCategory || !row?.live) return;
    setTogglingCategory(true);
    try {
      const res = await authFetch(`${apiBase()}games/${gameId}/toggle-category`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          categoryId: String(row.position),
          categoryName: row.name,
          enabled: !row.enabled,
        }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        setError(payload.error || `Could not change ${row.name}.`);
        return;
      }
      // The masks live on the state payload the remote already polls, so the
      // row repaints from the server rather than from an optimistic local edit
      // that a failed write would leave lying.
      await pollState(gameId);
    } catch {
      setError('No connection. Check signal and try again.');
    } finally {
      setTogglingCategory(false);
    }
  }, [gameId, togglingCategory, pollState]);

  /* -------------------------------------------- display-only, needs page */

  const sendToHostPage = (command) => {
    if (hostWindow && !hostWindow.closed) {
      hostWindow.postMessage({ type: 'REMOTE_COMMAND', command, gameId }, window.location.origin);
    } else {
      setHostWindow(null);
      setError('The big screen is not open from this remote.');
    }
  };

  const openHostPage = () => {
    const opened = window.open(
      `${window.location.origin}/host?gameId=${gameId}`, '_blank', 'width=1200,height=800'
    );
    setHostWindow(opened);
  };

  const displayLinked = !!hostWindow && !hostWindow.closed;
  const playerJoinUrl = `${window.location.origin}/play?gameId=${gameId}`;

  /* --------------------------------------------------------------- view */

  if (!gameId) {
    return (
      <div className="hr hr--entry" data-theme="dark">
        <div className="hr-entry-card">
          <Icon name="DeviceMobile" weight="duotone" size={40} color="var(--primary)" />
          <h1>Host Remote</h1>
          <p>Enter the session code shown on the big screen.</p>
          <form
            onSubmit={(e) => { e.preventDefault(); setGameId(gameIdDraft.trim().toUpperCase()); }}
          >
            <input
              className="hr-code-input"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              aria-label="Session code"
              placeholder="0000"
              value={gameIdDraft}
              onChange={(e) => setGameIdDraft(e.target.value.toUpperCase())}
            />
            <button className="hr-btn hr-btn--primary" type="submit" disabled={!gameIdDraft.trim()}>
              Connect
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    /*
      THE REMOTE HAS BEEN PAINTING PAPER, and nothing said so.

      `public/index.html:2` is `<html lang="en" data-theme="light">`, and
      `styles.css:58-66` re-points `--bg`, `--surface`, `--surface-2`, `--text`
      and `--muted` under that selector. `:root` IS `html`, so the paper block
      wins on specificity and every token this stylesheet reads resolved to the
      LIGHT value — a cream #FBF7F1 field with navy text — on a surface whose
      own header comment says it is held "in a dim room, glancing down between
      sentences". Two things were quietly wrong beyond the glare: `#1B2942` is
      hard-coded as the label on the amber buttons because it is the DUSK
      surface colour, and `var(--success-text, var(--success))` in the question
      browser fell back to `--success` #4FB286, which is 2.65:1 on white — the
      CORRECT flag, the one fact that surface exists to carry.

      `[data-theme="dark"]` (styles.css:69-76) is the mechanism for exactly
      this: a container opting back into dusk under a paper ancestor. Same
      one-line fix `PlayerPage.jsx:69` carries, for the same defect —
      `docs/design/AUDIT.md` citation 5.
    */
    <div className="hr" data-theme="dark">
      <header className="hr-bar">
        {/* THE WAY BACK, AND IT IS NOT IN THE DOCK.

            The question browser used to be a whole screen whose dock said "Back
            to the round" — which meant that for as long as the host was reading
            four options, the advance was gone. Three lists would have made that
            trade three times as often, so getting back lives up here in the
            sticky bar, where it cannot scroll away either, and the dock below
            goes on carrying the one control that moves the session. */}
        {panelTab && (
          <button
            className="hr-back"
            type="button"
            aria-label="Back to the round"
            onClick={() => setPanelTab(null)}
          >
            <Icon name="ArrowLeft" weight="bold" size={20} color="currentColor" />
          </button>
        )}
        <div className="hr-bar-id">
          <span className="hr-bar-code">{gameId}</span>
          {title && <span className="hr-bar-title">{title}</span>}
        </div>
        <span className={`hr-live ${connected ? 'is-live' : 'is-down'}`}>
          <Icon
            name={connected ? 'Broadcast' : 'WifiSlash'}
            weight="fill"
            size={14}
            color="currentColor"
          />
          <span className="hr-live-word">{connected ? 'Live' : 'Offline'}</span>
        </span>
      </header>

      <main className="hr-body">
        {panelTab ? (
          /* THE THREE LISTS. Rendered INSIDE the body rather than instead of
             the whole screen, which is what keeps the bar above and the dock
             below on the page — see RemoteSessionPanel for the argument. */
          <RemoteSessionPanel
            gameId={gameId}
            setId={setId}
            initialTab={panelTab}
            roster={roster}
            state={snapshot?.state}
            round={round}
            unaskedCount={unaskedCount}
            busy={!!busyAction || cooling}
            onAsk={askSpecific}
          />
        ) : (
          <>
            <section className="hr-status" aria-live="polite">
              <p className="hr-status-kicker">{summary.detail}</p>
              <h1 className="hr-status-phase">{summary.headline}</h1>

              {progress.applicable ? (
                <div className={`hr-progress ${progress.allIn ? 'is-complete' : ''}`}>
                  <div
                    className="hr-meter"
                    role="progressbar"
                    aria-valuenow={progress.received}
                    aria-valuemin={0}
                    aria-valuemax={progress.total}
                    aria-label={progress.label}
                  >
                    <span
                      className="hr-meter-fill"
                      style={{ width: `${progress.total ? (progress.received / progress.total) * 100 : 0}%` }}
                    />
                  </div>
                  {/* The number, not a spinner. "12 of 14 answered" is what tells a
                      host standing in front of a room whether to move on. */}
                  <p className="hr-progress-count">{progress.label}</p>
                  {progress.allIn && (
                    <p className="hr-allin">
                      <Icon name="CheckCircle" weight="fill" size={18} color="var(--success)" />
                      Everyone is in
                    </p>
                  )}
                </div>
              ) : (
                <p className="hr-roster">
                  <Icon name="UsersThree" weight="bold" size={18} color="var(--muted)" />
                  {rosterCount === null ? 'Counting the room…'
                    : `${rosterCount} ${rosterCount === 1 ? 'player' : 'players'} in the room`}
                </p>
              )}
            </section>

            {/* WHO THE ROOM IS WAITING FOR — 17-remote.html's `Still to vote`
                block, names and all.

                This is the one surface allowed to name people, and the note below
                is the argument for why, printed where the person holding the phone
                can read it rather than buried in a spec. Kept out of the list once
                everybody is in: an empty heading is noise. */}
            {waiting.applicable && waiting.names.length > 0 && (
              <section className="hr-wait" role="group" aria-label={waiting.heading}>
                <h2 className="hr-wait-heading">{waiting.heading}</h2>
                <div className="hr-wait-names">
                  {waiting.names.map((name) => (
                    <span className="hr-wait-name" key={name}>{name}</span>
                  ))}
                </div>
                <p className="hr-wait-private">
                  <b>Private</b> Who has not acted yet is a different fact from who wrote what.
                  This list is safe to hold during an anonymous round; authorship is not, so it is
                  not here either — the server has not sent it to anyone.
                </p>
              </section>
            )}

            {/* WHAT WE HEARD — 09-field-notes.html, reflowed to one phone column.
                The eyebrow, the lead, the numbered points, and the line that says
                where the rest of it lives. */}
            {onFieldNotes && (
              <section className="hr-notes" aria-label="What we heard">
                <p className="hr-notes-kicker">What we heard</p>
                {!notes.ready ? (
                  <p className="hr-notes-waiting">Workie is reading the responses…</p>
                ) : (
                  <>
                    {notes.lead && <p className="hr-notes-lead">{notes.lead}</p>}
                    {(notes.topics.length > 0 || notes.nextSteps.length > 0) && (
                      <ol className="hr-notes-list">
                        {notes.topics.map((topic, idx) => (
                          <li key={`t${idx}`}><b>{idx + 1}</b><span>{topic}</span></li>
                        ))}
                        {notes.nextSteps.map((step, idx) => (
                          <li key={`n${idx}`}><b>→</b><span>{step}</span></li>
                        ))}
                      </ol>
                    )}
                    <p className="hr-notes-foot">
                      Full notes, next steps and every response are in the session report.
                    </p>
                  </>
                )}
              </section>
            )}

            {error && (
              <p className="hr-flash hr-flash--error" role="alert">
                <Icon name="Warning" weight="fill" size={18} color="currentColor" />
                {error}
              </p>
            )}
            {notice && !error && (
              <p className="hr-flash hr-flash--notice" role="status">
                <Icon name="Info" weight="fill" size={18} color="currentColor" />
                {notice}
              </p>
            )}

            {/* THIS ROUND — 17-remote.html's first card of controls.
                Two things the mockup draws are not here, and both absences are
                deliberate:

                `Timer 2:00`. There is no timer anywhere in this product — no
                countdown in any handler, no duration on any round record, nothing
                for a phone button to start or stop. Drawing one is a feature
                request, not a control to wire, and a button that does nothing is
                worse on this surface than on any other.

                `Expand on stage` USED TO BE the second absence, and its note
                here read: "pure client state on the projector with no server
                representation and no REMOTE_COMMAND case to reach it." That is
                now false. `POST /games/{id}/stage-focus` gives the focus a
                durable per-round representation and a broadcast, exactly as
                stage-beat.js did for the RESULTS beat, and `Show the room`
                below is the control. It enlarges the question AND any single
                response, which is what the owner asked for. */}
            <section className="hr-card" aria-label="This round">
              <h2 className="hr-card-heading">This round</h2>
              <div className="hr-grid">
                <button
                  className="hr-btn hr-btn--ghost"
                  type="button"
                  disabled={!setId}
                  onClick={() => setPanelTab('questions')}
                >
                  <Icon name="MagnifyingGlass" weight="bold" size={18} color="currentColor" />
                  Choose next question
                </button>

                {/* THE ROOM'S SCREEN, FROM THE HOST'S HAND.

                    Disabled outside a round rather than hidden: unlike Skip —
                    which can lose a round and is therefore absent where it
                    would mean nothing — this one is the control a host reaches
                    for while walking away from the laptop, and a button that
                    disappears between rounds is one they have to re-find every
                    time. `round` is null in LOBBY and after the session ends,
                    which is exactly when there is nothing to enlarge. */}
                <button
                  className="hr-btn hr-btn--ghost"
                  type="button"
                  aria-expanded={focusOpen}
                  disabled={!round}
                  onClick={() => setFocusOpen((open) => !open)}
                >
                  <Icon name="ArrowsOut" weight="bold" size={18} color="currentColor" />
                  Show on the big screen
                </button>

                {/* Skip keeps its own confirmation. It is the only control here
                    that can lose a round outright — and unlike an ordinary advance
                    it is NOT idempotent server-side: `action: 'skip'` bypasses the
                    "already asking a question" guard in next-question.js.

                    Rendered only while there IS a round to abandon (ASK / VOTE);
                    skipAction() returns null everywhere else, and a permanently
                    greyed button on the results screen would be a control that
                    never means anything. */}
                {skip && (
                  <button
                    className={`hr-btn hr-btn--danger ${armedAction === 'skip' ? 'is-armed' : ''}`}
                    type="button"
                    disabled={blocked}
                    onClick={onSkip}
                  >
                    <Icon name="SkipForward" weight="bold" size={18} color="currentColor" />
                    {armedAction === 'skip' ? 'Tap again to skip' : 'Skip round'}
                  </button>
                )}
              </div>

              {focusOpen && (
                <div className="hr-card-panel">
                  <RemoteFocusPanel
                    focus={stageFocus}
                    answers={focusAnswers}
                    questionTitle={snapshot?.currentQuestionData?.title
                      || snapshot?.currentQuestionData?.question || ''}
                    busy={focusBusy}
                    onFocus={setStageFocus}
                    /*
                      THE ROOM CAN SEE THIS PHONE'S DECISION, so the phone must
                      not name someone the stage is deliberately not naming.
                      The host taps a row here and that response goes on a wall
                      — under whichever label the stage would give it. Passing a
                      plain player name would let an anonymous round be
                      de-anonymised by the act of enlarging one answer.

                      The gate is the SERVER's: `get-game-state` redacts
                      `playerName` out of the rows for a hidden round
                      (message.js does the same on the socket), so an absent
                      name here is already the answer rather than something
                      this component decides. Positional labelling is the
                      fallback, which is what the stage falls back to too.
                    */
                    labelFor={(answer, index) => answer.playerName || `Response ${index + 1}`}
                  />
                </div>
              )}
            </section>

            {/* SESSION — 17-remote.html's second card.

                `Session report` is absent, and for a different reason than the
                timer: the report DOES exist. `POST games/{id}/report` returns it and
                the stage's ENDED primary opens it — but the thing that renders it,
                `GameReport`, is declared inside GameHostPage.jsx and not exported,
                so there is nothing here to reuse. Reaching it needs a change to a
                file outside this one.

                `Big screen` is not in the mockup and stays anyway. The scroll and
                full-screen controls are shipped and working, and a mockup that did
                not draw them is not an instruction to delete them. */}
            <section className="hr-card" aria-label="Session">
              <h2 className="hr-card-heading">Session</h2>
              <div className="hr-grid">
                {/* THE WAY IN TO THE THREE LISTS.

                    First in the card, because it is the only control here that
                    answers a question the host has DURING a round — who is in
                    the room, what have we already asked — rather than one that
                    changes a setting. `Choose next question` above opens the
                    same panel on its third tab; two doors into one place, each
                    named for what the host came for, is the shape the desktop
                    already has (its dock button and its per-category
                    magnifier). */}
                <button
                  className="hr-btn hr-btn--ghost"
                  type="button"
                  onClick={() => setPanelTab('players')}
                >
                  <Icon name="UsersThree" weight="bold" size={18} color="currentColor" />
                  Players &amp; rounds
                </button>

                <button
                  className="hr-btn hr-btn--ghost"
                  type="button"
                  aria-expanded={categoriesOpen}
                  disabled={!setId}
                  onClick={() => setCategoriesOpen((open) => !open)}
                >
                  <Icon name="Folder" weight="bold" size={18} color="currentColor" />
                  Categories
                </button>

                <button
                  className="hr-btn hr-btn--ghost"
                  type="button"
                  aria-expanded={joinOpen}
                  onClick={() => setJoinOpen((open) => !open)}
                >
                  {/* LinkSimple, not UsersThree: `Players & rounds` above now
                      owns that glyph, and two buttons in one grid wearing the
                      same icon is the fastest way to make a dim-room glance
                      land on the wrong one. `LinkSimple` rather than a QR
                      glyph because `components/Icon.jsx` maps a fixed set and
                      an unmapped name falls back to `Circle` SILENTLY — adding
                      to that map is a change to a shared file this work does
                      not own, and the panel behind this button is a link as
                      much as a code. */}
                  <Icon name="LinkSimple" weight="bold" size={18} color="currentColor" />
                  Join code
                </button>

                <button
                  className="hr-btn hr-btn--ghost"
                  type="button"
                  aria-expanded={screenOpen}
                  onClick={() => setScreenOpen((open) => !open)}
                >
                  <Icon name="Monitor" weight="bold" size={18} color="currentColor" />
                  Big screen
                </button>

                <button
                  className="hr-btn hr-btn--ghost"
                  type="button"
                  onClick={() => { setGameId(''); setGameIdDraft(''); setSnapshot(null); }}
                >
                  {/* House, not ArrowsClockwise: this goes back to the code
                      entry screen, which is the remote's menu. A cycle glyph
                      reads as "reload this session". */}
                  <Icon name="House" weight="bold" size={18} color="currentColor" />
                  Back to Menu
                </button>
              </div>

              {categoriesOpen && (
                <div className="hr-card-panel">
                  <RemoteCategoryList
                    rows={catRows}
                    live={categoriesLive}
                    busy={togglingCategory}
                    onToggle={toggleCategory}
                  />
                </div>
              )}

              {joinOpen && (
                <div className="hr-join">
                  <div className="hr-qr"><QRCode value={playerJoinUrl} size={168} level="M" includeMargin /></div>
                  <code className="hr-join-url">{playerJoinUrl}</code>
                  <button
                    className="hr-btn hr-btn--ghost"
                    type="button"
                    onClick={() => {
                      navigator.clipboard?.writeText(playerJoinUrl)
                        .then(() => setNotice('Join link copied.'))
                        .catch(() => setError('Could not copy the link.'));
                    }}
                  >
                    <Icon name="ClipboardText" weight="bold" size={18} color="currentColor" />Copy link
                  </button>
                </div>
              )}

              {screenOpen && (
                <div className="hr-card-panel">
                  {displayLinked ? (
                    <div className="hr-grid">
                      <button className="hr-btn hr-btn--ghost" type="button" onClick={() => sendToHostPage('SCROLL_TO_TOP')}>
                        <Icon name="ArrowUp" weight="bold" size={18} color="currentColor" />Top
                      </button>
                      <button className="hr-btn hr-btn--ghost" type="button" onClick={() => sendToHostPage('SCROLL_TO_RESULTS')}>
                        <Icon name="ChartBar" weight="bold" size={18} color="currentColor" />Results
                      </button>
                      <button className="hr-btn hr-btn--ghost" type="button" onClick={() => sendToHostPage('SCROLL_TO_BOTTOM')}>
                        <Icon name="ArrowDown" weight="bold" size={18} color="currentColor" />Bottom
                      </button>
                      <button className="hr-btn hr-btn--ghost" type="button" onClick={() => sendToHostPage('TOGGLE_BIG_SCREEN')}>
                        <Icon name="Monitor" weight="bold" size={18} color="currentColor" />Full screen
                      </button>
                    </div>
                  ) : (
                    <>
                      <button className="hr-btn hr-btn--ghost" type="button" onClick={openHostPage}>
                        <Icon name="Monitor" weight="bold" size={18} color="currentColor" />
                        Open the big screen
                      </button>
                      {/* Honest about the limit rather than showing dead buttons:
                          scrolling and full-screen are display-only, they have no
                          server representation, and a window handle cannot be
                          obtained for a page this remote did not open. The round
                          controls above need none of this. */}
                      <p className="hr-hint">
                        Scroll and full-screen only reach a big screen opened from this remote.
                        Moving the session forward works either way.
                      </p>
                    </>
                  )}
                </div>
              )}
            </section>
          </>
        )}
      </main>

      {/* The one control that matters, pinned in the thumb arc. */}
      <div className="hr-dock">
        {action ? (
          <>
            {primaryArmed && (
              <p className="hr-dock-warn" role="status">
                {progress.applicable && !progress.allIn
                  ? `${progress.total - progress.received} still ${progress.kind === 'votes' ? 'voting' : 'answering'}`
                  : 'Confirm to continue'}
              </p>
            )}
            <button
              className={`hr-primary ${primaryArmed ? 'is-armed' : ''}`}
              type="button"
              disabled={blocked}
              onClick={onPrimary}
              onBlur={disarm}
            >
              <Icon
                name={primaryArmed ? 'Warning' : action.icon}
                weight="bold"
                size={24}
                color="currentColor"
              />
              <span className="hr-primary-label">
                {busyAction ? 'Working…' : primaryArmed ? 'Tap again to confirm' : action.label}
              </span>
            </button>
          </>
        ) : (
          <p className="hr-dock-idle">
            {summary.phase === 'ENDED' ? 'Session complete' : 'Waiting for the session…'}
          </p>
        )}
      </div>
    </div>
  );
}

export default HostRemote;
