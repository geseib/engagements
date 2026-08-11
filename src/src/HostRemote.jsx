import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { QRCodeCanvas as QRCode } from 'qrcode.react';
import './HostRemote.css';
import Icon from './components/Icon';
import RemoteQuestionBrowser from './components/RemoteQuestionBrowser';
import RemoteCategoryList from './components/RemoteCategoryList';
import { authFetch } from './auth/authFetch';
import { categoryRows } from './config/setupPanel';
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
  const [connected, setConnected] = useState(false);

  const [busyAction, setBusyAction] = useState(null);
  const [armedAction, setArmedAction] = useState(null);
  const [cooling, setCooling] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [joinOpen, setJoinOpen] = useState(false);
  const [screenOpen, setScreenOpen] = useState(false);
  const [hostWindow, setHostWindow] = useState(null);

  // 17-remote.html's second phone, and the Categories disclosure under Session.
  const [browsing, setBrowsing] = useState(false);
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
        const res = await fetch(`${apiBase()}question-sets/${setId}/categories`);
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
      // authFetch, not fetch: closing a round is now an authenticated route
      // (games/{id}/close-round), because it ends the room's anonymity and
      // moves everyone's screen. The other actions sit on public routes and
      // simply ignore the header. This page is behind ProtectedRoute, so the
      // host is signed in and the token is there to attach.
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
   * Plain fetch, not authFetch: `next-question` is a public route and
   * GameHostPage.selectQuestion calls it the same way. Only /close-round,
   * /stage-beat and /reveal-authors carry the authorizer.
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
      const res = await fetch(`${apiBase()}${request.path}`, {
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
      setBrowsing(false);
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
      const res = await fetch(`${apiBase()}games/${gameId}/toggle-category`, {
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
      <div className="hr hr--entry">
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

  // The second phone in 17-remote.html — a whole screen, not a sheet over the
  // round. Choosing is a task with its own dock ("Back to the round"), and the
  // status card behind it is exactly what the host is NOT looking at while they
  // read four options.
  if (browsing) {
    return (
      <RemoteQuestionBrowser
        gameId={gameId}
        setId={setId}
        unaskedCount={unaskedCount}
        connected={connected}
        busy={!!busyAction || cooling}
        onAsk={askSpecific}
        onClose={() => setBrowsing(false)}
      />
    );
  }

  return (
    <div className="hr">
      <header className="hr-bar">
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

            `Expand on stage` is the host page's `setLessonExpanded(true)`,
            which is pure client state on the projector with no server
            representation and no REMOTE_COMMAND case to reach it. It needs one
            line in GameHostPage.jsx, which this change may not touch. */}
        <section className="hr-card" aria-label="This round">
          <h2 className="hr-card-heading">This round</h2>
          <div className="hr-grid">
            <button
              className="hr-btn hr-btn--ghost"
              type="button"
              disabled={!setId}
              onClick={() => setBrowsing(true)}
            >
              <Icon name="MagnifyingGlass" weight="bold" size={18} color="currentColor" />
              Choose next question
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
              <Icon name="UsersThree" weight="bold" size={18} color="currentColor" />
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
              <Icon name="ArrowsClockwise" weight="bold" size={18} color="currentColor" />
              Switch game
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
