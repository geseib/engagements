import React, { useState, useEffect, useRef } from 'react';
import webSocketClient from './WebSocketClient';
import Icon from './components/Icon';
import RankIcon, { rankLabel, VOTE_POSITIONS } from './components/RankIcon';
import { gameTypeMeta } from './config/gameTypes';
import { resolveInstruction, resolveRoundNoun } from './config/instructions';
import { displayLabelFor, ownAnswerIndex } from './config/anonymity';
import {
  participationUrl, participationFrom, nextParticipation,
} from './utils/playerParticipation';
import JoinNameCollision, { JoinNameCollisionActions } from './components/JoinNameCollision';
import AnswerSpotlight from './components/AnswerSpotlight';
import HelpButton from './components/HelpButton';
import { getClientId, classifyJoinFailure } from './components/joinResult';
import './components/PlayerSurface.css';

const API_BASE = window.API_BASE;

/**
 * THE LOOK-UP CUE — the same sentence shape, in the same position, in every
 * WATCH and REST state.
 *
 * RATIONALE §2.2. The stage may never name a person, and taking that rule
 * seriously hands you the whole split: anything person-specific belongs on the
 * phone, anything room-wide belongs on the stage, and neither repeats the
 * other. This is where the phone says which is which. It replaces
 * "Check the main screen for detailed results and AI insights!", which appeared
 * in exactly one branch and read as an apology for a missing feature.
 *
 * OPEN-QUESTIONS §1 IS THE ASSUMPTION THIS RESTS ON, and it is the single
 * biggest unknown in the design: there is no signal anywhere in the payload for
 * "this participant is remote and cannot see a shared screen", and no way to
 * infer one. The stated assumption is that everyone can see one, and that the
 * cue degrades to a harmless sentence for anybody who cannot. That assumption
 * is honoured here rather than answered.
 */
const LookUpCue = ({ children }) => (
  <div className="plr-lookup">
    <svg
      width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
    >
      <path d="M12 20V5" /><path d="M6 11l6-6 6 6" /><path d="M4 3h16" />
    </svg>
    <div>{children}</div>
  </div>
);

/**
 * THE SHELL: bar, stage, dock. Three regions, and the dock is OUTSIDE the
 * scrolling region rather than pinned over it.
 *
 * That is what makes "scrolling to read is fine, scrolling to act is not"
 * (RATIONALE §5.2) structural rather than editorial: the primary action cannot
 * be pushed below the fold because it is not in the thing that scrolls. It is
 * also not `position: fixed`, which on iOS Safari interacts badly with the
 * collapsing URL bar and with the soft keyboard.
 *
 * `dock` IS OMITTED, NOT DISABLED, IN REST AND WATCH (§2.2). If there is
 * nothing to do there must be nothing that looks pressable, and a design that
 * renders a greyed bar has already lost that argument. Declared at module scope
 * so React keeps one element identity across renders — a component defined
 * inside PlayerPage would remount its whole subtree on every keystroke and take
 * the focused textarea with it.
 */
export const PlayerShell = ({
  phase, volume, ctx, category, who, online = true, banner,
  centre = false, dock = null, after = null, children,
}) => (
  <div className="plr" data-theme="dark" data-phase={phase} data-volume={volume}>
    {banner}
    <header className="plr-bar">
      <div className="plr-strip" />
      <div className="plr-line">
        <span className="plr-ctx">{ctx}</span>
        {category && <span className="plr-cat">{category}</span>}
        <span className="plr-spacer" />
        {who && (
          <span className="plr-who">
            <span className={`plr-dot${online ? '' : ' plr-dot--off'}`} />
            {who}
          </span>
        )}
        {/*
          THE PLAYER'S ONLY WAY INTO THE DOCUMENTATION WRITTEN FOR THEM.

          `HelpButton` was mounted in exactly one file — `AdminPage.jsx` — while
          the help system's contents advertised four player guides. The audience
          with the least context and the smallest screen had a documentation set
          and no door into it from anywhere in the product.

          IN THE BAR, NOT THE DOCK. The dock is the primary action and is
          omitted entirely when there is nothing to do (see the note on
          `dock` above); help has to be reachable in precisely those states —
          "that name is taken" is a dock-less screen, and it is the single most
          likely moment for a player to want an explanation.

          It renders inside `.plr` so the modal is in the dusk scope rather
          than beside it, for the same reason `after` is: a dialog rendered as
          a sibling of this shell resolves none of the --plr-* tokens.
        */}
        <HelpButton
          section="player"
          variant="inline"
          size="small"
          tooltip="Help"
          className="plr-helpbtn"
        />
      </div>
    </header>
    <main className={`plr-stage${centre ? ' plr-stage--centre' : ''}`}>
      {children}
    </main>
    {dock && <footer className="plr-dock">{dock}</footer>}
    {/* OVERLAYS, INSIDE THE SCOPE RATHER THAN BESIDE IT.
        A dialog rendered as a sibling of this shell is outside `.plr`, so it
        inherits the data-theme="light" that public/index.html puts on <html>
        and resolves none of the --plr-* tokens — which is how the spotlight
        came to open a white card with 1.96:1 buttons over a dusk ballot. It is
        NOT part of `children`: children land in `.plr-stage`, the scrolling
        region, and a dialog does not belong inside the thing it covers. */}
    {after}
  </div>
);

// Utility function to calculate proper rankings with tie handling
const calculatePlayerRankings = (players) => {
  // Sort players by score (descending)
  const sortedPlayers = [...players].sort((a, b) => (b.score || 0) - (a.score || 0));
  
  let currentRank = 1;
  const rankedPlayers = [];
  
  for (let i = 0; i < sortedPlayers.length; i++) {
    const player = sortedPlayers[i];
    const playerScore = player.score || 0;
    
    // If this isn't the first player and score is different from previous, 
    // update rank to current position + 1
    if (i > 0 && playerScore !== (sortedPlayers[i - 1].score || 0)) {
      currentRank = i + 1;
    }
    
    rankedPlayers.push({
      ...player,
      rank: currentRank
    });
  }
  
  return rankedPlayers;
};

// Helper function to get instruction text.
// The game type used to be hardcoded to 'call-and-answer', so poll and survey
// never saw their own default — pass the real type.
const getPlayerInstructionText = (customInstruction, currentQuestion, gameType) =>
  resolveInstruction(currentQuestion, customInstruction, gameType);

/**
 * WHICH RANK CURRENTLY HOLDS THIS ANSWER — the one rule both ballots read.
 *
 * `votes` is a single object, `{ first, second, third }`, holding BALLOT INDICES
 * AS STRINGS (the `<option value>` a select hands back). The quick ballot and
 * the detailed ballot are that one object rendered twice, and this is the
 * question each of them asks of it. It used to be asked twice, differently: the
 * detailed view had a private `getVotePosition`, and the quick view re-derived
 * it inline with `Object.values(votes).includes(...)` — which answers "is it
 * ranked?" but not "where?", and so could not annotate anything or agree with
 * the other view about it.
 *
 * `String(answerIndex)` because callers hold the index as a number (the map
 * index) while `votes` holds it as a string. `0 === '0'` is false, and that
 * mismatch would silently mean "answer 0 is never ranked anywhere".
 *
 * No "and the slot is not empty" guard, though an empty slot holds '' and every
 * caller passes a real ballot index: `String(idx)` is never '', so such a guard
 * can never change an answer. It was written, a mutation removing it survived
 * the whole suite, and it was deleted rather than covered — an unreachable
 * clause reads as a protection that is not there.
 */
const RANK_SLOTS = ['first', 'second', 'third'];

export const rankHolding = (votes, answerIndex) =>
  RANK_SLOTS.find((slot) => votes[slot] === String(answerIndex)) || null;

// Which round the player is on. The payload spells this three different ways
// depending on which endpoint answered (get-question sends lessonNumber +
// questionNumber + id, get-game-state sends id, and the results-reconstruction
// fallback sends none of them), so fall back to the phase string last.
const roundNumberOf = (question, gameState) => {
  const candidates = [question?.lessonNumber, question?.questionNumber, question?.id];
  for (const candidate of candidates) {
    const n = parseInt(candidate, 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  const fromState = parseInt(String(gameState || '').split('#')[1], 10);
  return Number.isFinite(fromState) && fromState > 0 ? fromState : null;
};

function PlayerPage() {
  const [gameId, setGameId] = useState('');
  
  // Helper function to check if game is in waiting state
  const isWaitingState = (state) => {
    if (!state) return true; // Default to waiting state if no state
    return state === 'CREATED' || state === 'STARTED' || 
           (!state.startsWith('ASK#') && !state.startsWith('VOTE#') && !state.startsWith('RESULTS#'));
  };
  const [playerName, setPlayerName] = useState('');
  const [nameInput, setNameInput] = useState('');
  const [accessCodeInput, setAccessCodeInput] = useState('');
  const [needsAccessCode, setNeedsAccessCode] = useState(false);
  const [joined, setJoined] = useState(false);
  const [currentQuestion, setCurrentQuestion] = useState(null);
  const [answerInput, setAnswerInput] = useState('');
  // The text the player actually submitted, kept after answerInput clears, so
  // the anonymous ballot can find this player's own row by content — the only
  // handle left once the author fields are redacted (see ownAnswerIndex).
  const [mySubmittedAnswer, setMySubmittedAnswer] = useState('');
  const [hasAnswered, setHasAnswered] = useState(false);
  const [gameState, setGameState] = useState('CREATED'); // CREATED, STARTED, ASK#001, VOTE#001, RESULTS#001
  const [gameType, setGameType] = useState('call-and-answer'); // 'call-and-answer' or 'trivia'
  const [selectedTriviaAnswer, setSelectedTriviaAnswer] = useState(null); // For trivia: stores selected option letter
  const [wavelengthWords, setWavelengthWords] = useState(Array(10).fill('')); // For wavelength: stores 10 words
  const [answers, setAnswers] = useState([]);
  const [votes, setVotes] = useState({ first: '', second: '', third: '' });
  const [hasVoted, setHasVoted] = useState(false);
  /*
    `hasVoted`, readable from inside an async resync.

    `loadVotingData` has to know what the screen currently believes in order to
    decide whether an unreadable server answer may lower the flag — and it runs
    inside `checkGameState`, which the resume effect captured long ago, so the
    `hasVoted` binding in that closure is frozen at join time. Reading the state
    variable there is exactly the mistake that made the ballot-clearing check
    fire on every resync (voteRoundRef's comment has that story).

    Mirrored in an effect rather than written at each call site: there are five
    writers, and a ref that one of them forgets to update is worse than a ref
    that lags by a render. The lag is immaterial here — it is only consulted
    when the server had no opinion AND the round did not change, and in that
    case the value has not moved either.
  */
  const hasVotedRef = useRef(false);
  useEffect(() => { hasVotedRef.current = hasVoted; }, [hasVoted]);
  /*
    THE COMPOSER HAS FOCUS, WHICH IS THE ONLY PROXY FOR "THE KEYBOARD IS UP"
    that any browser reliably offers.

    This used to open `mobile-input-overlay`: a full-screen textarea that
    covered the question, so a player composing an answer could not see what
    they were answering — and it carried three submit affordances at once. It
    now drives the one reduction in the design instead (RATIONALE §5.3): the
    question folds to three lines and pins itself above the composer, WITH a
    control that opens it again. A reduction the reader can undo is a fold, not
    a deletion; silent clipping is as forbidden here as it is on the stage.
  */
  const [isAnswerInputFocused, setIsAnswerInputFocused] = useState(false);
  const [showFullQuestion, setShowFullQuestion] = useState(false);
  const [gameIdFromUrl, setGameIdFromUrl] = useState(false);
  /*
    Has the player asked to type a code over the one the link supplied?

    SEPARATE FROM `gameIdFromUrl` ON PURPOSE. That flag records a fact about how
    this page was opened and stays true for the life of it — `handleJoinGame`
    and the reconnection logic both read it. Unlocking is a different thing: a
    choice the player made afterwards. Folding the two together by flipping
    `gameIdFromUrl` to false would rewrite history to say the code was typed,
    which is not what happened and is not what those other readers are asking.
  */
  const [codeUnlocked, setCodeUnlocked] = useState(false);
  const codeInputRef = useRef(null);
  const [lastVoteInteraction, setLastVoteInteraction] = useState(0);
  const [isUserVoting, setIsUserVoting] = useState(false);
  const [rejoinedPlayer, setRejoinedPlayer] = useState(false);
  const [rejoinPrompt, setRejoinPrompt] = useState(null); // { gameId, name } | null
  // A join the server refused because the name is already answering in this
  // session: { kind: 'name-taken' | 'name-unverified', playerName, message }.
  const [joinCollision, setJoinCollision] = useState(null);
  /* In flight, so the ask and the take-over cannot be double-tapped into two
     requests — the second of which would spend a grant the first already had. */
  const [handoverBusy, setHandoverBusy] = useState(false);
  /*
    WHY THE JOIN REFUSAL IS STATE AND NOT AN `alert()`.

    Five of the eleven alert() calls in this file were on the join path. A
    native alert on a phone is a modal system dialog that looks like a browser
    error: it cannot be styled, it cannot be associated with the field it refers
    to, and it gave ONE undifferentiated message for a wrong code, an ended
    session, a full session and a network failure — four failures with four
    different remedies (INVENTORY §2).

    It is amber rather than red, which is unusual for an error and is argued in
    RATIONALE §4.2: red on this surface means destructive, only, and the
    alternative is inventing a sixth colour for the one screen a participant
    sees before they have any context at all.
  */
  const [joinError, setJoinError] = useState(null);
  const [votingMode, setVotingMode] = useState('quick'); // 'quick' or 'detailed'
  /*
    Which response is being read in full, or null. An index into `answers`.

    On a phone the ballot is the screen most in need of this: the whole point of
    a ranked vote is comparing responses, and a card clipped to fit three of its
    siblings above the fold cannot be compared with anything.
  */
  const [spotlightIndex, setSpotlightIndex] = useState(null);
  const [playerScore, setPlayerScore] = useState(0);
  const [playerRanking, setPlayerRanking] = useState(null);
  const [playerScoreInfo, setPlayerScoreInfo] = useState(null);
  const [allPlayers, setAllPlayers] = useState([]);
  const [customInstruction, setCustomInstruction] = useState(null);
  const [setRoundNoun, setSetRoundNoun] = useState(null); // per-set override, e.g. "Lesson"
  // What the host typed into Event Details at setup. Stored by create-game.js
  // as `Details` and returned to participants by get-game.js as
  // `engagementInfo` — and until this existed, read by nothing at all, which
  // made the setup field's own help text ("shown to participants when they
  // join") false for the whole life of the field.
  const [engagementInfo, setEngagementInfo] = useState('');
  // Which question the on-screen draft belongs to. A ref, not state: it is
  // read and claimed inside async fetches that would otherwise close over a
  // stale value, and changing it must never itself cause a render.
  const draftQuestionKeyRef = useRef(null);
  // Which VOTE round the ballot on screen belongs to. A ref for the same reason
  // as the one above, and its absence is what un-voted people: the check that
  // cleared the ballot compared `gameState` against the server's, from inside
  // `checkGameState` — a function the resume effect captures once, with the
  // deps `[gameId, playerName, joined, useWebSocket]`. `gameState` is not among
  // them, so that closure keeps whatever the phase was when the player JOINED,
  // and the comparison was true on every single resync. Returning to the tab
  // during voting therefore cleared the ballot every time, before the "have you
  // already voted" check downstream had said anything at all.
  const voteRoundRef = useRef(null);
  const [results, setResults] = useState(null);

  // WebSocket state
  const [wsConnected, setWsConnected] = useState(false);
  const [useWebSocket, setUseWebSocket] = useState(true); // Always use WebSocket

  // A3: monotonic phase guard — prevents a slow GET /state from clobbering a
  // newer phase delivered via WebSocket (or vice versa). Accepts both the WS
  // message spellings (RESULT#/END) and the server state spellings (RESULTS#/ENDED).
  const lastRankRef = useRef(-1);
  const stateRank = (s) => {
    if (!s) return -1;
    if (s === 'ENDED' || s === 'END') return Number.MAX_SAFE_INTEGER;
    const m = s.match(/^(ASK|VOTE|RESULTS?)#(\d+)/);   // accepts RESULT# and RESULTS#
    if (!m) return -1;                                  // CREATED/STARTED never overwrite a live phase
    const phase = { ASK: 0, VOTE: 1, RESULT: 2, RESULTS: 2 }[m[1]];
    return parseInt(m[2], 10) * 10 + phase;
  };
  const applyGameState = (next) => {
    const r = stateRank(next);
    if (r < lastRankRef.current) {
      console.log(`⏮️ PLAYER: ignoring stale ${next}`);
      return false;
    }
    lastRankRef.current = r;
    setGameState(next);
    return true;
  };

  /*
    THE RESIZE LISTENER IS GONE WITH THE OVERLAY IT SERVED.

    `isDesktop` existed for one purpose: to decide whether focusing the composer
    should open the full-screen `mobile-input-overlay`. The overlay is cut, so
    the width probe has nothing left to decide. Layout that depends on width is
    a media query in `components/PlayerSurface.css`, where it belongs — a
    JavaScript breakpoint and a CSS breakpoint are two sources of truth for one
    fact, and they drift.
  */

  useEffect(() => {
    // 🔗 PLAYER: Get game ID from URL params (optional)
    const urlParams = new URLSearchParams(window.location.search);
    const gameIdFromUrl = urlParams.get('gameId');
    
    if (gameIdFromUrl) {
      console.log(`🎯 PLAYER: Found game ID in URL: ${gameIdFromUrl}`);
      setGameId(gameIdFromUrl);
      setGameIdFromUrl(true);

      // 👤 PLAYER: Check for automatic reconnection
      const nameFromUrl = urlParams.get('name') || '';
      const savedName = localStorage.getItem(`playerName_${gameIdFromUrl}`);
      
      console.log(`🔍 PLAYER: Checking reconnection - URL name: "${nameFromUrl}", Saved name: "${savedName}"`);
      
      if (nameFromUrl) {
        // Name in URL - try to auto-join
        console.log(`🚀 PLAYER: Attempting auto-join with name from URL: ${nameFromUrl}`);
        setNameInput(nameFromUrl);
        
        if (savedName === nameFromUrl) {
          // Previously joined this game with this name — confirm before rejoining
          // instead of silently auto-joining (B2).
          console.log(`✅ PLAYER: Saved name matches — staging rejoin prompt`);
          setRejoinPrompt({ gameId: gameIdFromUrl, name: nameFromUrl });
        } else {
          // Try to join automatically
          console.log(`🔄 PLAYER: Auto-joining with URL name (not previously saved)`);
          attemptAutoJoin(gameIdFromUrl, nameFromUrl);
        }
      } else if (savedName) {
        // No name in URL but we have saved name - pre-fill the form and offer rejoin (B2)
        console.log(`💾 PLAYER: Pre-filling form with saved name: ${savedName}`);
        setNameInput(savedName);
        setRejoinPrompt({ gameId: gameIdFromUrl, name: savedName });
      }
    } else {
      console.log(`🔗 PLAYER: No game ID in URL - showing manual join form`);
      // No game ID in URL - player will need to enter it manually
    }
  }, []);

  /**
   * The one place a join is actually attempted.
   *
   * Every entry point — the form, the auto-join from a shared URL, the access
   * code retry, and the rejoin prompt — goes through here. It used to be three
   * near-copies plus, in the rejoin case, no request at all: `handleRejoinConfirm`
   * set `joined = true` and stopped, so a player who tapped "Rejoin" believed
   * they were back in a session the server had never heard them return to —
   * no player row touched, no host notification, no state fetched. Every
   * caller now shares one request and one interpretation of the answer.
   *
   * `clientId` is what lets the server tell a returning player from a namesake
   * (see components/joinResult.js). `claimExisting` is only ever true when the
   * person has said so out loud.
   */
  const performJoin = async (gid, name, { accessCode = null, claimExisting = false } = {}) => {
    const trimmed = String(name || '').trim();
    const clientId = getClientId(gid);

    let response;
    try {
      response = await fetch(`${API_BASE}games/${gid}/players`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          playerName: trimmed,
          accessCode,
          clientId,
          claimExisting
        }),
      });
    } catch (error) {
      console.error('PLAYER: join request failed:', error);
      return {
        ok: false,
        failure: {
          kind: 'network',
          message: 'Network error. Please check your connection and try again.'
        }
      };
    }

    let data = null;
    try {
      data = await response.json();
    } catch (parseError) {
      // A non-JSON body (an HTML error page from the edge, say) is still a
      // result — classify it on status alone rather than throwing.
    }

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        failure: classifyJoinFailure(response.status, data)
      };
    }

    return { ok: true, data: data || {} };
  };

  /** Everything that must be true once the server has actually let us in. */
  const enterSession = (gid, name, data) => {
    setPlayerName(name);
    setJoined(true);
    setJoinCollision(null);
    setRejoinPrompt(null);
    localStorage.setItem(`playerName_${gid}`, name);

    if (data.isReconnection || data.rejoined) {
      setRejoinedPlayer(true);
      console.log(`🔄 PLAYER: Server confirmed this is a reconnection`);
      // Vote/answer restoration happens in checkGameState below.
    }

    setTimeout(() => checkGameState(gid, name), 100);
  };

  /**
   * Turn a refusal into the screen that explains it.
   *
   * `quiet` is for the unattended auto-join off a shared URL: a name collision
   * still has to be shown (the player is about to be told they are in a
   * session they are not in), but "the host hasn't started yet" must not
   * ambush someone with a modal the instant the page loads — that case falls
   * through to the join form, as it always has.
   */
  const applyJoinFailure = (failure, name, { quiet = false } = {}) => {
    if (failure.kind === 'access-code') {
      console.log(`🔐 PLAYER: Game requires access code - showing access code input`);
      setNeedsAccessCode(true);
      setPlayerName(name);
      return;
    }

    if (failure.kind === 'name-taken' || failure.kind === 'name-unverified') {
      setJoinCollision({
        kind: failure.kind,
        playerName: failure.playerName || name,
        message: failure.message,
        // A FRESH refusal starts the handover flow over. Carrying a stale
        // `asked` across a new join attempt would offer "Take over the name"
        // to somebody who has not asked anybody anything — the two-step is the
        // guard, so it must not survive the screen being re-entered.
        handoverStage: 'idle'
      });
      return;
    }

    // On the join form rather than in a system dialog. `quiet` still means
    // quiet: an unattended auto-join off a shared URL must not ambush somebody
    // with "the host hasn't started yet" the instant the page loads.
    if (!quiet) setJoinError(failure.message);
  };

  // 🔄 Attempt to automatically join the game
  const attemptAutoJoin = async (gameId, name, accessCode = null) => {
    console.log(`🔄 PLAYER: Auto-joining game ${gameId} as ${name}`);
    const trimmed = String(name || '').trim();
    const result = await performJoin(gameId, trimmed, { accessCode });

    if (!result.ok) {
      console.log(`❌ PLAYER: Auto-join refused (${result.failure.kind})`);
      setNameInput(trimmed);
      applyJoinFailure(result.failure, trimmed, { quiet: true });
      return;
    }

    console.log(`✅ PLAYER: Auto-join successful`, result.data);
    enterSession(gameId, trimmed, result.data);

    // Update URL to include name if not already there
    const url = new URL(window.location);
    url.searchParams.set('name', trimmed);
    window.history.replaceState(null, '', url);
  };

  // REMOVED: Partial vote system - not needed with simplified flow

  // REMOVED: HTTP polling - WebSocket handles all state updates

  // Monitor WebSocket mode changes from admin panel
  useEffect(() => {
    const checkWebSocketMode = () => {
      const adminSetting = localStorage.getItem('admin_websocket_mode');
      const windowSetting = window.WEBSOCKET_MODE;

      // Default to true if no setting exists (first time users)
      const adminMode = adminSetting !== null ? adminSetting === 'true' : true;
      const windowMode = windowSetting !== undefined ? windowSetting : true;
      const currentMode = adminMode && windowMode;

      if (currentMode !== useWebSocket) {
        console.log(`🔌 PLAYER: WebSocket mode changed: ${currentMode ? 'ENABLED' : 'DISABLED'}`);
        console.log(`🔍 PLAYER: Settings - admin: ${adminSetting}, window: ${windowSetting}, final: ${currentMode}`);
        setUseWebSocket(currentMode);
        window.WEBSOCKET_MODE = currentMode;
      }
    };

    const modeInterval = setInterval(checkWebSocketMode, 1000);
    return () => clearInterval(modeInterval);
  }, [useWebSocket]);

  /**
   * The host's session brief, fetched once the participant is in.
   *
   * `role=player` explicitly, though it no longer buys secrecy: the host view
   * of this endpoint DID return the private-game access code, and no longer
   * does — `role` is a query parameter on a public route, so it was never a
   * check, and the field is deleted rather than gated (get-game.js:71-92,
   * pinned by tests/get-game-access-code.js). The role is still sent because
   * the host branch carries setup fields a participant has no use for.
   *
   * Every failure is swallowed. The brief is a nicety; being in the room is
   * not, and a 404 or a flaky network must never take the lobby down with it.
   */
  useEffect(() => {
    if (!joined || !gameId) return undefined;
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch(`${API_BASE}games/${gameId}?role=player`);
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && typeof data.engagementInfo === 'string') {
          setEngagementInfo(data.engagementInfo);
        }
      } catch (error) {
        console.warn('PLAYER: session details unavailable:', error.message);
      }
    })();

    return () => { cancelled = true; };
  }, [joined, gameId]);

  // WebSocket connection effect - only runs when WebSocket is enabled and player has joined
  useEffect(() => {
    if (!gameId || !playerName || !joined || !useWebSocket) return;

    console.log(`🔌 PLAYER: Starting WebSocket connection for game ${gameId} as ${playerName}`);

    // Set up WebSocket connection status callback
    webSocketClient.onConnectionStatusChange(setWsConnected);

    // A2: reconcile authoritative phase on every successful reconnect. Any
    // ASK#→VOTE#→RESULTS# transition that fired while offline is caught here.
    webSocketClient.onReconnected(() => {
      console.log('🔁 PLAYER: WS reconnected — reconciling state');
      checkGameState();
    });

    // Initial state handler for reconnection/late joining
    webSocketClient.onMessage('initialStateSync', (data) => {
      console.log('🔌 PLAYER: Received initial state sync notification:', data);
      // Fetch current game state from API
      checkGameState();
    });

    // Game state change handlers
    webSocketClient.onMessage('gameStateChanged', (data) => {
      console.log('🔌 Player received game state change notification:', data);
      // Fetch current game state from API
      checkGameState();
    });

    webSocketClient.onMessage('questionStarted', (data) => {
      console.log('🔌 Player received question started notification:', data);
      // Parse the state message to extract question number
      const stateMessage = data.state; // e.g., "GAME#9402 ASK#001"
      if (stateMessage && stateMessage.includes('ASK#')) {
        const questionNumber = stateMessage.split('ASK#')[1]; // Extract "001"
        console.log(`🎯 Player calling get_question for question ${questionNumber}`);
        // Update game state first, then fetch question (guarded against stale races)
        if (applyGameState(`ASK#${questionNumber}`)) {
          fetchCurrentQuestion(questionNumber);
        }
      } else {
        console.log('⚠️ Player received questionStarted without valid state format');
      }
    });

    webSocketClient.onMessage('votingStarted', (data) => {
      console.log('🔌 Player received voting started notification:', data);
      // Parse the state message to extract question number
      const stateMessage = data.state; // e.g., "GAME#9402 VOTE#001"
      if (stateMessage && stateMessage.includes('VOTE#')) {
        const questionNumber = stateMessage.split('VOTE#')[1]; // Extract "001"
        console.log(`🗳️ Player calling voting for question ${questionNumber}`);
        // Update game state first, then fetch voting data (guarded against stale races)
        if (applyGameState(`VOTE#${questionNumber}`)) {
          // Clear previous votes when starting new voting round
          setVotes({ first: '', second: '', third: '' });
          setHasVoted(false);
          console.log('🔄 Cleared previous votes for new voting round');
          checkGameState();
        }
      } else {
        console.log('⚠️ Player received votingStarted without valid state format');
        // Fallback to checkGameState
        checkGameState();
      }
    });

    webSocketClient.onMessage('playerAnswered', (data) => {
      console.log('🔌 Player received player answered notification:', data);
      // This notification comes when any player submits an answer
      // We don't need to do anything special here for players
    });

    webSocketClient.onMessage('playerVoted', (data) => {
      console.log('🔌 Player received player voted notification:', data);
      // This notification comes when any player submits votes
      // We don't need to do anything special here for players
    });

    webSocketClient.onMessage('aiSummaryReady', (data) => {
      console.log('🔌 Player received AI Summary ready:', data);
      // Players might want to know when AI summary is ready to discuss
      // We don't currently show AI summaries to players, but this is available
    });

    // Parity with host: players don't render summaries, so just log the failure.
    webSocketClient.onMessage('aiSummaryError', (data) => {
      console.warn('🔌 Player received AI Summary error:', data);
    });

    // Results ready handler for trivia and call-and-answer
    webSocketClient.onMessage('hostMessage', (data) => {
      if (data.messageType && data.messageType.startsWith('RESULT#')) {
        console.log('🔌 Player received results ready notification (hostMessage):', data);
        const questionNumber = data.questionNumber;
        if (questionNumber) {
          console.log(`🎯 PLAYER: Results ready for question ${questionNumber}, fetching results...`);
          checkGameState(); // This will fetch the current game state and show results
        }
      }
    });

    // Direct resultsReady handler for proper WebSocket routing
    webSocketClient.onMessage('resultsReady', (data) => {
      console.log('🔌 Player received results ready notification (resultsReady):', data);
      const questionNumber = data.questionId || data.questionNumber;
      if (questionNumber) {
        console.log(`🎯 PLAYER: Results ready for question ${questionNumber}, updating state to RESULTS#${questionNumber}`);
        // Update local state to show results screen immediately (guarded against stale races)
        if (applyGameState(`RESULTS#${String(questionNumber).padStart(3, '0')}`)) {
          // Then fetch the actual results data
          checkGameState();
        }
      }
    });

    /*
      GAME ENDED — a state, not a modal.

      This used to raise a dismissible "Game Complete!" dialog whose primary
      action was Download Report, hitting the ADMIN endpoint
      `admin/reports/{gameId}` — an authenticated admin route offered to an
      unauthenticated member of the public, which usually 404s and then explains
      itself in an italic aside. Dismiss it and `isWaitingState('ENDED')` is
      true, so the player was left permanently on "Waiting for the game to
      start…" for a session that had finished (INVENTORY §7.2).

      `applyGameState('ENDED')` ranks above everything and already ran; all that
      was missing was a branch for it BEFORE `isWaitingState`, which used to
      swallow it. OPEN-QUESTIONS §7 is the assumption behind cutting the
      download rather than fixing it: participants get nothing here, and the
      host shares a link if they publish one. A participant-scoped endpoint
      would be a different design.
    */
    webSocketClient.onMessage('gameEnded', (data) => {
      console.log('🔌 Player received game ended notification:', data);
      applyGameState('ENDED');
    });

    // Connect as player - WebSocket is required
    console.log('🔌 PLAYER: Connecting WebSocket for real-time updates');
    webSocketClient.connect(gameId, playerName, false);

    // Do a single explicit initial state check (onReconnected covers every
    // subsequent reopen; it does NOT fire on the first open).
    console.log('🔌 PLAYER: WebSocket connecting, doing initial state check');
    checkGameState();

    return () => {
      console.log(`🔌 PLAYER: Disconnecting WebSocket for game ${gameId}`);
      webSocketClient.disconnect();
      webSocketClient.onConnectionStatusChange(null);
      webSocketClient.onReconnected(null);
      webSocketClient.offMessage('initialStateSync');
      webSocketClient.offMessage('gameStateChanged');
      webSocketClient.offMessage('questionStarted');
      webSocketClient.offMessage('votingStarted');
      webSocketClient.offMessage('playerAnswered');
      webSocketClient.offMessage('playerVoted');
      webSocketClient.offMessage('aiSummaryReady');
      webSocketClient.offMessage('aiSummaryError');
      webSocketClient.offMessage('hostMessage');
      webSocketClient.offMessage('resultsReady');
      webSocketClient.offMessage('gameEnded');
    };
  }, [gameId, playerName, joined, useWebSocket]);

  // A2: resume handler — covers half-open sockets (phone lock) and backgrounded
  // mobile tabs. ensureConnected() reconnects a dead socket; checkGameState()
  // reconciles the phase. checkGameState is idempotent so concurrent events converge.
  useEffect(() => {
    if (!gameId || !playerName || !joined || !useWebSocket) return;
    const resync = () => { webSocketClient.ensureConnected(); checkGameState(); };
    const onVisible = () => { if (document.visibilityState === 'visible') resync(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', resync);
    window.addEventListener('focus', resync);
    window.addEventListener('pageshow', resync);   // iOS Safari bfcache restore
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', resync);
      window.removeEventListener('focus', resync);
      window.removeEventListener('pageshow', resync);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId, playerName, joined, useWebSocket]);

  // Note: Removed auto-save localStorage functionality - now using server-side partial votes

  // Show rejoin notification
  useEffect(() => {
    if (rejoinedPlayer) {
      const timer = setTimeout(() => setRejoinedPlayer(false), 5000);
      return () => clearTimeout(timer);
    }
  }, [rejoinedPlayer]);

  // The set's instruction and round noun now ARRIVE WITH THE QUESTION, so this
  // reads a payload instead of making a request.
  //
  // It used to call `loadQuestionSetMeta`, which fetched the whole of
  // `GET /question-sets` — every set in the environment — and `.find()`ed the
  // one this game was playing, in order to read these two strings. That handed
  // every anonymous participant the entire library. `get-question.js` now
  // projects `setCustomInstruction` and `setRoundNoun` from the SETS row it
  // was already reading to resolve the partition, so the two values cost a
  // participant nothing and reveal nothing about any other set.
  //
  // GUARDED ON `setId`, not called unconditionally, and that is deliberate:
  // the RESULTS path can rebuild `currentQuestion` from get-results, which
  // carries no set fields at all (see get-question.js:44). Clearing the
  // instruction there would blank a prompt the room is still looking at, so a
  // payload that knows nothing about the set leaves both values alone —
  // exactly what the old `if (setId)` guard at the call site achieved.
  const applyQuestionSetInstruction = (questionData) => {
    const setId = questionData?.setId || questionData?.questionSetId;
    if (!setId) return;
    setCustomInstruction(questionData.setCustomInstruction ?? null);
    setSetRoundNoun(questionData.setRoundNoun ?? null);
  };

  const fetchPlayerRanking = async (gameIdOverride = null, playerNameOverride = null) => {
    const currentGameId = gameIdOverride || gameId;
    const currentPlayerName = playerNameOverride || playerName;
    
    if (!currentGameId || !currentPlayerName) {
      console.log('⏭️ PLAYER: Skipping fetchPlayerRanking - no gameId or playerName yet');
      return;
    }
    
    try {
      console.log('📊 PLAYER: Fetching player ranking data...');
      const playersRes = await fetch(`${API_BASE}games/${currentGameId}/players`);
      if (playersRes.ok) {
        const playersData = await playersRes.json();
        const players = playersData.players || [];
        setAllPlayers(players);
        
        // Find current player and calculate ranking with proper tie handling
        const currentPlayer = players.find(p => p.name === currentPlayerName);
        if (currentPlayer) {
          setPlayerScore(currentPlayer.score || 0);
          
          // Calculate proper rankings with tie handling
          const rankedPlayers = calculatePlayerRankings(players);
          const playerWithRank = rankedPlayers.find(p => p.name === currentPlayerName);
          const totalPlayers = players.length;
          
          if (playerWithRank) {
            setPlayerRanking({ rank: playerWithRank.rank, total: totalPlayers });
            console.log(`📊 PLAYER: ${currentPlayerName} rank ${playerWithRank.rank}/${totalPlayers} with ${currentPlayer.score || 0} points`);
          }
        } else {
          console.warn(`📊 PLAYER: Player ${currentPlayerName} not found in players list:`, players.map(p => p.name));
        }
      }
    } catch (error) {
      console.error('Error fetching player ranking:', error);
    }
  };

  /**
   * Has this player already answered the question that is currently open?
   *
   * Ask the endpoint that actually knows. This used to call
   * `/answers?player=…&question=…` and read `answerData.hasAnswer` — but
   * get-answers.js accepts only `role` and `questionId` (get-answers.js:12),
   * and no handler anywhere has ever emitted `hasAnswer`. The expression was
   * `undefined || false`, so this reported "you have not answered" to every
   * player on every call, forever. During ASK# that endpoint cannot answer the
   * question in principle: the player branch returns a bare count and
   * deliberately no names.
   *
   * `/state` does carry it, as `answerProgress.answererIds`
   * (get-game-state.js:398-402) — the exact counterpart of the
   * `votingProgress.votersIds` list checkPlayerVote reads below.
   *
   * Returns `null`, not `false`, when the roster is unavailable (off-phase
   * payload, bad response, network error). "I could not find out" and "you
   * did not answer" are different facts, and collapsing them is what lets a
   * single flaky refresh throw away a submitted answer.
   */
  const checkPlayerAnswer = async (gameId, playerName) => {
    /*
      THIS USED TO READ THE HOST'S ROSTER LIST, from `GET /state` with no player
      identity on it — so the server answered as if a host had asked, and the
      list it dug through (`answerProgress.answererIds`) only exists while the
      state is `ASK#`. Any resync after the round moved on found nothing and had
      to report "I could not find out". utils/playerParticipation.js has the
      full account; the short version is that `/state/{playerName}` reads this
      player's own answer row directly and keeps answering across phases.
    */
    try {
      const stateRes = await fetch(participationUrl(API_BASE, gameId, playerName));
      if (!stateRes.ok) return null;

      const { answered } = participationFrom(await stateRes.json());
      console.log(`📝 PLAYER: Answer check for ${playerName}: ${answered === null ? 'unknown' : answered ? 'already answered' : 'not answered yet'}`);
      return answered;
    } catch (error) {
      console.error('Error checking player answer:', error);
      return null;
    }
  };

  // Fetch current question using get_question API (same as host)
  const fetchCurrentQuestion = async (questionNumber) => {
    if (!gameId) {
      console.log('⏭️ PLAYER: Skipping fetchCurrentQuestion - no gameId');
      return;
    }
    
    try {
      console.log(`🎯 PLAYER: Fetching question ${questionNumber} for game ${gameId}`);
      const questionRes = await fetch(`${API_BASE}games/${gameId}/question?role=player`);
      
      if (!questionRes.ok) {
        console.error('❌ Failed to fetch question:', questionRes.status);
        return;
      }
      
      const questionData = await questionRes.json();
      console.log('✅ PLAYER: Received question data:', questionData);
      console.log('🔍 PLAYER: Question data keys:', Object.keys(questionData));
      console.log('🔍 PLAYER: Question title:', questionData.title);
      console.log('🔍 PLAYER: Current gameState when setting question:', gameState);
      
      if (questionData.title) {
        // Set the question data - question data is at top level, not nested
        setCurrentQuestion(questionData);
        console.log('✅ PLAYER: currentQuestion state updated with:', questionData);

        // Is this a different question, or the same one being re-read?
        //
        // This function runs far more often than the game advances: every
        // visibilitychange, focus, online and pageshow goes through the resync
        // effect, and so does every WS reconnect, gameStateChanged and
        // initialStateSync. Treating each of those as "a question arrived"
        // is what erased a tapped trivia option — and any typed text — between
        // the tap and Submit.
        //
        // Claimed before the await so a second refresh racing this one sees
        // the question as already processed and leaves the draft alone.
        const questionKey = String(
          questionData.questionNumber ?? questionData.id ?? questionNumber ?? ''
        );
        const isNewQuestion = questionKey !== draftQuestionKeyRef.current;
        draftQuestionKeyRef.current = questionKey;

        const hasAnswered = await checkPlayerAnswer(gameId, playerName);

        // The server is the authority when it has an opinion. When it does
        // not, only a genuinely new question may lower the flag — a refresh
        // that learned nothing must not un-answer someone. The rule is now
        // `nextParticipation` so the vote path below is held to the same one.
        setHasAnswered((current) => nextParticipation({
          current, server: hasAnswered, isNewQuestion,
        }));

        // Reset the draft for a new question only.
        if (isNewQuestion && hasAnswered !== true) {
          setAnswerInput('');
          setSelectedTriviaAnswer('');
          setMySubmittedAnswer('');
        }

        // The set's instruction and round noun ride on this same payload —
        // no second request, and nothing about any other set.
        applyQuestionSetInstruction(questionData);
        
        console.log(`🎯 PLAYER: Question ${questionNumber} loaded, hasAnswered: ${hasAnswered}`);
      } else {
        console.log('⚠️ PLAYER: No question data received');
      }
    } catch (error) {
      console.error('❌ PLAYER: Error fetching question:', error);
    }
  };

  const checkGameState = async (gameIdOverride = null, playerNameOverride = null) => {
    const currentGameId = gameIdOverride || gameId;
    const currentPlayerName = playerNameOverride || playerName;
    
    if (!currentGameId || !currentPlayerName) {
      console.log('⏭️ PLAYER: Skipping checkGameState - no gameId or playerName yet');
      return;
    }
    
    try {
      // Get game state from the database
      const stateRes = await fetch(`${API_BASE}games/${currentGameId}/state`);
      const stateJson = await stateRes.json();
      console.log('🔍 PLAYER: Raw state API response:', stateJson);
      const serverGameState = stateJson.state || 'CREATED';
      const serverGameType = stateJson.gameType || 'call-and-answer';
      
      // Update game type if changed
      if (serverGameType !== gameType) {
        setGameType(serverGameType);
      }
      
      console.log(`🔄 PLAYER: Game state is ${serverGameState}`);

      // Set the game state through the monotonic guard (A3). If this HTTP
      // response is stale relative to a newer WS-delivered phase, skip it and
      // all its follow-up loads so we never flash backward.
      if (!applyGameState(serverGameState)) {
        console.log('⏮️ PLAYER: checkGameState result is stale — skipping follow-up loads');
        return;
      }

      // Handle different game states
      if (serverGameState.startsWith('ASK#')) {
        // Extract question number from ASK#001 format
        const questionNumber = serverGameState.split('#')[1];
        console.log(`🎯 PLAYER: ASK state detected, question ${questionNumber}`);
        
        // Use the new fetchCurrentQuestion function (same as WebSocket flow)
        await fetchCurrentQuestion(questionNumber);
        
      } else if (serverGameState.startsWith('VOTE#')) {
        // Extract question number from VOTE#001 format
        const questionNumber = serverGameState.split('#')[1];
        console.log(`🗳️ PLAYER: VOTE state detected, question ${questionNumber}`);
        
        // Clear the ballot only when the ROUND actually changed — see
        // voteRoundRef. Comparing phases here read a `gameState` frozen at join
        // time, so this fired on every resync and wiped a cast vote.
        // Claimed before the await below, matching fetchCurrentQuestion.
        const isNewVoteRound = questionNumber !== voteRoundRef.current;
        voteRoundRef.current = questionNumber;
        if (isNewVoteRound) {
          setVotes({ first: '', second: '', third: '' });
          setHasVoted(false);
          console.log(`🔄 Cleared previous votes for new voting round ${questionNumber}`);
        }
        
        // Load voting data for this question
        await loadVotingData(questionNumber, isNewVoteRound);
        
      } else if (serverGameState.startsWith('RESULTS#')) {
        // Extract question number from RESULTS#001 format
        const questionNumber = serverGameState.split('#')[1];
        console.log(`🏆 PLAYER: RESULTS state detected, question ${questionNumber}`);
        
        // Load results data for this question
        await loadResultsData(questionNumber);
        
      } else {
        // CREATED, STARTED, or other states (gameState already set via applyGameState)
        console.log(`⏳ PLAYER: Game in ${serverGameState} state`);
        setCurrentQuestion(null);
        setAnswers([]);
        setHasAnswered(false);
        setHasVoted(false);
        setMySubmittedAnswer('');
      }
      
    } catch (error) {
      console.error('❌ PLAYER: Error checking game state:', error);
    }
  };
  
  // Load voting data for the current question
  const loadVotingData = async (questionNumber, isNewVoteRound = false) => {
    if (!gameId || !playerName) {
      console.log('⏭️ PLAYER: Skipping loadVotingData - no gameId or playerName');
      return;
    }

    try {
      console.log(`🗳️ PLAYER: Loading voting data for question ${questionNumber} in game ${gameId}`);

      // First, check if player has already voted by checking game state.
      // `setHasVoted(hasAlreadyVoted)` stood here and assigned the raw result,
      // which is how a check that answered `false` for "I could not find out"
      // reached the screen as "you have not voted". Same rule as the answer
      // path now: the server wins when it has an opinion, and only a new round
      // may lower the flag without one.
      const votedOnServer = await checkPlayerVote(gameId, playerName, questionNumber);
      const hasAlreadyVoted = nextParticipation({
        current: hasVotedRef.current,
        server: votedOnServer,
        isNewQuestion: isNewVoteRound,
      });
      setHasVoted(hasAlreadyVoted);

      if (hasAlreadyVoted) {
        console.log(`✅ PLAYER: Already voted on question ${questionNumber} - showing vote submitted screen`);
        // Just need to load question data for display
        const stateRes = await fetch(`${API_BASE}games/${gameId}/state`);
        const stateData = await stateRes.json();
        
        if (stateData.currentQuestionData) {
          setCurrentQuestion(stateData.currentQuestionData);
        }
        return; // Don't need to load answers if already voted
      }
      
      // Player hasn't voted yet - load question and answers
      console.log(`📋 PLAYER: Not voted yet - loading question and answers`);
      
      // Get question data from game state
      const stateRes = await fetch(`${API_BASE}games/${gameId}/state`);
      const stateData = await stateRes.json();
      
      if (stateData.currentQuestionData) {
        setCurrentQuestion(stateData.currentQuestionData);
        console.log(`✅ PLAYER: Question data loaded: ${stateData.currentQuestionData.title}`);
      } else {
        /*
          THE LATE ARRIVAL, AND THE ONLY REASON THE BALLOT CAN NAME ITS QUESTION.

          `/state` carries `currentQuestionData` only sometimes. A player who
          joins at round three goes CREATED → VOTE#003 without ever passing
          through ASK, so `currentQuestion` is null and there is nothing to
          render above the ballot — which is INVENTORY §5's MISSING row: six
          answers to a question nobody showed them. `/question?role=player`
          answers it and is already deployed; this is one extra GET on the one
          path that has no question in hand.
        */
        console.log('📋 PLAYER: No question in the state payload — fetching it for the ballot');
        await fetchCurrentQuestion(questionNumber);
      }

      // Get answers for voting
      const paddedQuestionNumber = String(questionNumber).padStart(3, '0');
      const answersRes = await fetch(`${API_BASE}games/${gameId}/answers?role=player&questionId=${paddedQuestionNumber}`);
      const answersJson = await answersRes.json();
      
      if (answersJson.answers && answersJson.answers.length > 0) {
        setAnswers(answersJson.answers);
        console.log(`✅ PLAYER: Loaded ${answersJson.answers.length} answers for voting`);
      } else {
        console.log(`⚠️ PLAYER: No answers found for voting on question ${questionNumber}`);
      }
    } catch (error) {
      console.error('❌ PLAYER: Error loading voting data:', error);
    }
  };
  
  // Load results data for the current question
  const loadResultsData = async (questionNumber) => {
    if (!gameId) {
      console.log('⏭️ PLAYER: Skipping loadResultsData - no gameId');
      return;
    }
    
    try {
      console.log(`🏆 PLAYER: Loading results data for question ${questionNumber} in game ${gameId}`);
      
      // Try to get the current question data, but don't block results if it fails
      try {
        const questionRes = await fetch(`${API_BASE}games/${gameId}/question?role=player`);
        if (questionRes.ok) {
          const questionData = await questionRes.json();
          if (questionData.title) {
            setCurrentQuestion(questionData);
          }
        } else {
          console.log(`ℹ️ PLAYER: Question endpoint not available (${questionRes.status}), proceeding with results only`);
        }
      } catch (questionError) {
        console.log(`ℹ️ PLAYER: Could not fetch question data:`, questionError.message);
      }
      
      // Get results for this question (independent of question data)
      const resultsRes = await fetch(`${API_BASE}games/get-results`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          gameId: gameId,
          questionNumber: questionNumber 
        })
      });
      const resultsJson = await resultsRes.json();
      
      // Handle both trivia and call-and-answer result formats
      if (resultsJson.voteTallies || resultsJson.answers) {
        setResults(resultsJson);
        
        // Try to reconstruct question data from results if we don't have it (works for both trivia and call-and-answer)
        if (!currentQuestion && resultsJson) {
          console.log(`🔍 PLAYER: Question data missing, checking if results contain question info`);
          if (resultsJson.question || resultsJson.questionTitle || resultsJson.questionDetail || resultsJson.correctAnswer || resultsJson.optionA) {
            
            // For trivia games, if correctAnswer is missing, try to determine it from player answers
            let correctAnswer = resultsJson.correctAnswer;
            if (!correctAnswer && resultsJson.gameType === 'trivia' && resultsJson.answers) {
              const correctPlayerAnswer = resultsJson.answers.find(answer => answer.isCorrect);
              if (correctPlayerAnswer) {
                correctAnswer = correctPlayerAnswer.answer;
                console.log(`🔧 PLAYER: Determined correct answer from player data: ${correctAnswer}`);
              }
            }
            
            const reconstructedQuestion = {
              title: resultsJson.question || resultsJson.questionTitle || resultsJson.questionDetail || 'Question',
              questionDetail: resultsJson.questionDetail || resultsJson.question || resultsJson.questionTitle,
              correctAnswer: correctAnswer,
              optionA: resultsJson.optionA,
              optionB: resultsJson.optionB,
              optionC: resultsJson.optionC,
              optionD: resultsJson.optionD,
              optionE: resultsJson.optionE,
              optionF: resultsJson.optionF
            };
            setCurrentQuestion(reconstructedQuestion);
            console.log(`🔧 PLAYER: Reconstructed question data from results:`, reconstructedQuestion);
          }
        }
        
        if (resultsJson.gameType === 'trivia') {
          console.log(`✅ PLAYER: Trivia results data loaded, answers:`, resultsJson.answers?.length || 0);
          console.log(`🔍 PLAYER: Full trivia results data:`, resultsJson);
          
          // For trivia, populate answers state with the trivia results answers
          if (resultsJson.answers) {
            setAnswers(resultsJson.answers.map(answer => ({
              name: answer.playerName, // Convert to expected format for UI
              player: answer.playerName,
              playerName: answer.playerName,
              answer: answer.answer,
              isCorrect: answer.isCorrect,
              points: answer.pointsEarned || 0,
              basePoints: answer.basePoints || 0,
              speedBonus: answer.speedBonus || 0,
              responseTimeMs: answer.responseTimeMs || 0
            })));
            console.log(`📊 PLAYER: Set answers state with trivia results for highlighting`);
          }
        } else {
          console.log(`✅ PLAYER: Call-and-answer results data loaded, voteTallies:`, Object.keys(resultsJson.voteTallies || {}).length);
        }
        
        // Get player rankings and score information for RESULTS display
        await loadPlayerScoreInfo(resultsJson);
      } else {
        console.log(`⚠️ PLAYER: No results data found for question ${questionNumber}`, resultsJson);
        
        // Still load player score info even if no results for this question
        await loadPlayerScoreInfo();
      }
      
    } catch (error) {
      console.error('❌ PLAYER: Error loading results data:', error);
    }
  };

  // Load player score info including ranking and total score
  const loadPlayerScoreInfo = async (currentResults = null) => {
    if (!gameId || !playerName) {
      console.log('⏭️ PLAYER: Skipping loadPlayerScoreInfo - no gameId or playerName');
      return;
    }
    
    try {
      console.log(`📊 PLAYER: Loading player score info for ${playerName} in game ${gameId}`);
      
      // Get all players with current scores and rankings
      const playersRes = await fetch(`${API_BASE}games/${gameId}/players`);
      const playersData = await playersRes.json();
      
      if (playersData.players) {
        // Sort players by total score (descending) to determine rankings
        const rankedPlayers = playersData.players.sort((a, b) => b.totalScore - a.totalScore);
        
        // Find current player in the rankings
        const currentPlayerIndex = rankedPlayers.findIndex(p => p.playerName === playerName);
        
        if (currentPlayerIndex !== -1) {
          const currentPlayer = rankedPlayers[currentPlayerIndex];
          
          // Calculate ranking with proper tie handling
          let rank = 1;
          for (let i = 0; i < currentPlayerIndex; i++) {
            if (rankedPlayers[i].totalScore > currentPlayer.totalScore) {
              rank = i + 2; // +2 because we want 1-based indexing and account for ties
              break;
            }
          }
          
          // Alternative simpler ranking: currentPlayerIndex + 1 (since array is sorted)
          // But using above logic for proper tie handling
          if (currentPlayerIndex === 0) {
            rank = 1; // First in sorted array = 1st place
          } else {
            // Check if tied with previous player
            if (rankedPlayers[currentPlayerIndex - 1].totalScore === currentPlayer.totalScore) {
              // Find the rank of the first player with this score
              for (let i = 0; i < currentPlayerIndex; i++) {
                if (rankedPlayers[i].totalScore === currentPlayer.totalScore) {
                  rank = i + 1;
                  break;
                }
              }
            } else {
              rank = currentPlayerIndex + 1; // Normal ranking
            }
          }
          
          // Get round score from current results (use parameter if provided, otherwise state)
          let roundScore = 0;
          const resultsToUse = currentResults || results;
          
          // Handle both trivia and call-and-answer result formats for round score
          if (resultsToUse) {
            if (resultsToUse.gameType === 'trivia' && resultsToUse.answers) {
              // Trivia format: find player in answers array
              const playerResult = resultsToUse.answers.find(answer => 
                answer.playerName === playerName
              );
              if (playerResult) {
                roundScore = playerResult.pointsEarned || 0;
                console.log(`📊 PLAYER: Found trivia round score for ${playerName}: ${roundScore}`);
              } else {
                console.log(`📊 PLAYER: No trivia round score found for ${playerName} in answers`);
              }
            } else if (resultsToUse.voteTallies) {
              // Call-and-answer format: find player in voteTallies
              const playerResult = Object.values(resultsToUse.voteTallies).find(tally => 
                tally.playerName === playerName
              );
              if (playerResult) {
                roundScore = playerResult.totalScore || 0;
                console.log(`📊 PLAYER: Found call-and-answer round score for ${playerName}: ${roundScore}`);
              } else {
                console.log(`📊 PLAYER: No call-and-answer round score found for ${playerName} in voteTallies`);
              }
            } else {
              console.log(`📊 PLAYER: No recognized results format for round score calculation`);
            }
          } else {
            console.log(`📊 PLAYER: No results data available for round score calculation`);
          }
          
          const scoreInfo = {
            playerName: currentPlayer.playerName,
            totalScore: currentPlayer.totalScore,
            roundScore: roundScore,
            rank: rank,
            totalPlayers: rankedPlayers.length,
            rankDisplay: rankLabel(rank)
          };
          
          setPlayerScoreInfo(scoreInfo);
          console.log(`📊 PLAYER: Score info loaded:`, scoreInfo);
        } else {
          console.log(`⚠️ PLAYER: Could not find ${playerName} in player rankings`);
        }
      }
    } catch (error) {
      console.error('❌ PLAYER: Error loading player score info:', error);
    }
  };
  
  /**
   * Has this player already voted this round? `null` when it could not be
   * established — see utils/playerParticipation.js.
   *
   * THE THREE `return false`s THIS REPLACES ARE THE BUG. A non-OK response, a
   * payload without the list, and a thrown request each reported a confident
   * "has not voted", and the caller assigned that straight into state — so every
   * unreadable resync actively un-voted the player and put the ballot back in
   * front of somebody who had already cast it. The answer path above had
   * documented that exact hazard and returned `null` for it; this one was never
   * brought into line. Both go through one helper now so they cannot diverge
   * again.
   *
   * The old comment block ("we don't have the playerId ... let's use a more
   * direct approach") was working around something that was not true:
   * `/games/{gameId}/state/{playerName}` existed the whole time, and the player
   * name IS the id — votes are stored at `QUESTION#{nnn}#VOTE#{playerName}`.
   */
  const checkPlayerVote = async (gameId, playerName, questionNumber) => {
    try {
      const stateRes = await fetch(participationUrl(API_BASE, gameId, playerName));
      if (!stateRes.ok) return null;

      const { voted } = participationFrom(await stateRes.json());
      console.log(`🗳️ PLAYER: Vote check for ${playerName}: ${voted === null ? 'unknown' : voted ? 'already voted' : 'not voted yet'}`);
      return voted;
    } catch (error) {
      console.error('Error checking player vote:', error);
      return null;
    }
  };

  /**
   * IS THE SESSION CODE FIELD READ-ONLY RIGHT NOW?
   *
   * Derived rather than stored, so the two things it depends on cannot disagree
   * with each other or with the help text beside the field. A code that was
   * typed was never locked; a code that arrived in a link is locked until the
   * player says otherwise.
   */
  const codeLocked = gameIdFromUrl && !codeUnlocked;

  /**
   * Let the player type over the code the link supplied.
   *
   * Selects rather than clears — see the note at the control. `select()` is
   * guarded because jsdom implements it on HTMLInputElement but a future test
   * double need not, and a help affordance must never be the thing that throws.
   */
  const unlockCode = () => {
    setCodeUnlocked(true);
    setJoinError('');
    // After the re-render that removes `readOnly`: focusing a read-only input
    // works but selecting inside one does not, on iOS in particular.
    setTimeout(() => {
      const el = codeInputRef.current;
      if (!el) return;
      el.focus();
      if (typeof el.select === 'function') el.select();
    }, 0);
  };

  const handleJoinGame = async (e) => {
    e.preventDefault();
    if (!nameInput.trim() || !gameId) return;

    setJoinError(null);
    const trimmed = nameInput.trim();
    const result = await performJoin(gameId, trimmed, {
      accessCode: accessCodeInput.trim() || null
    });

    if (!result.ok) {
      console.log(`❌ PLAYER: Join refused (${result.failure.kind})`);
      applyJoinFailure(result.failure, trimmed);
      return;
    }

    console.log('✅ PLAYER: Manual join success:', result.data);
    enterSession(gameId, trimmed, result.data);

    // Update URL to include both gameId and name for easy sharing/reconnection
    const url = new URL(window.location);
    url.searchParams.set('gameId', gameId);
    url.searchParams.set('name', trimmed);
    window.history.replaceState(null, '', url);
    console.log(`🔗 PLAYER: Updated URL for reconnection: ${url.search}`);
  };

  // Handle access code submission
  const handleAccessCodeSubmit = async (e) => {
    e.preventDefault();
    if (!accessCodeInput.trim()) return;

    setJoinError(null);
    const trimmed = nameInput.trim();
    const result = await performJoin(gameId, trimmed, {
      accessCode: accessCodeInput.trim()
    });

    if (!result.ok) {
      applyJoinFailure(result.failure, trimmed);
      return;
    }

    console.log('✅ PLAYER: Access code join success:', result.data);
    setNeedsAccessCode(false);
    enterSession(gameId, trimmed, result.data);
  };

  const handleSubmitAnswer = async (e, triviaAnswer = null) => {
    if (e) e.preventDefault();
    
    console.log(`🎯 PLAYER: handleSubmitAnswer called - gameType: ${gameType}, triviaAnswer: ${triviaAnswer}, hasAnswered: ${hasAnswered}`);
    
    // For trivia, use the provided answer; for wavelength, use words array; for call-and-answer, use the text input
    let answer;
    if (gameType === 'trivia') {
      answer = triviaAnswer;
    } else if (gameType === 'wavelength') {
      // Filter out empty words and join with commas
      answer = wavelengthWords.filter(word => word.trim()).join(',');
    } else {
      answer = answerInput.trim();
    }
    
    if (!answer || !currentQuestion) {
      console.log(`❌ PLAYER: Submit blocked - answer: ${answer}, currentQuestion: ${!!currentQuestion}`);
      return;
    }
    
    if (hasAnswered) {
      console.log(`❌ PLAYER: Submit blocked - already answered`);
      return;
    }

    try {
      // Use WebSocket to submit answer (following the ANSWER# pattern)
      let questionNumber = currentQuestion.questionNumber || currentQuestion.id;
      
      // Fallback: extract from game state if question number is not available
      if (!questionNumber && gameState && gameState.startsWith('ASK#')) {
        questionNumber = gameState.split('#')[1]; // Extract from "ASK#001"
      }
      
      const messageType = `ANSWER#${questionNumber}`;
      
      console.log(`🎯 PLAYER: Submitting answer via WebSocket - messageType: ${messageType}`);
      console.log(`🎯 PLAYER: DEBUG currentQuestion object:`, currentQuestion);
      console.log(`🎯 PLAYER: DEBUG questionNumber extracted: ${questionNumber}, gameState: ${gameState}`);
      console.log(`🎯 PLAYER: DEBUG answer: ${answer}, answerType: ${gameType === 'trivia' ? 'trivia' : gameType === 'wavelength' ? 'wavelength' : 'text'}`);
      
      // Send answer via WebSocket
      webSocketClient.sendCleanMessage(messageType, {
        answer: answer,
        answerType: gameType === 'trivia' ? 'trivia' : gameType === 'wavelength' ? 'wavelength' : 'text'
      });
      
      setHasAnswered(true);
      setMySubmittedAnswer(answer);
      setAnswerInput('');
      setSelectedTriviaAnswer('');
      setWavelengthWords(Array(10).fill(''));
      
      console.log(`✅ PLAYER: Answer submitted successfully`);
    } catch (e) {
      console.error('handleSubmitAnswer error', e);
      alert('Failed to submit answer. Please try again.');
    }
  };

  const handleVoteChange = (position, answerIndex) => {
    if (hasVoted) return;

    // Track user interaction to prevent polling interference
    setLastVoteInteraction(Date.now());
    setIsUserVoting(true);
    
    // Clear user voting flag after a longer delay to prevent state resets
    setTimeout(() => setIsUserVoting(false), 3000);

    /*
      THE KICK-OUT, which is the whole of ranked voting: one answer holds at
      most one rank, so picking it somewhere new vacates wherever it was.

      `picked` is normalised to a string because the two ballots hand this in
      differently — a select gives `e.target.value` (already a string), the
      detailed cards give the map index (a number) — and `votes` is compared by
      identity. An index arriving as a number would match nothing and leave a
      duplicate behind.

      TWO THINGS THIS DELIBERATELY DOES NOT SPECIAL-CASE, because a clause no
      test can kill is a clause nobody can trust:

        CLEARING. Picking "Pick player..." makes `picked` the empty string, so
        the sweep matches only ranks that are ALREADY empty and writes '' over
        ''. A guard around it would be unreachable.

        THE RANK BEING SET. The sweep may blank `position` itself, and the
        assignment on the next line puts the value straight back. `pos !==
        position` here would likewise never change an outcome — it was written,
        and a mutation removing it survived the whole suite, which is how it was
        caught.

      The equality test IS load-bearing: drop it and every pick wipes the ballot.
    */
    const picked = answerIndex === null || answerIndex === undefined
      ? ''
      : String(answerIndex);

    const newVotes = { ...votes };

    Object.keys(newVotes).forEach(pos => {
      if (newVotes[pos] === picked) {
        newVotes[pos] = '';
      }
    });

    newVotes[position] = picked;
    setVotes(newVotes);
    
    // Save partial vote to server immediately after vote change
    if (currentQuestion?.id) {
      // Vote changes are stored in component state only
    }
    
    // Enhanced logging with mobile detection
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    console.log(`🗳️ Vote updated on ${isMobile ? 'MOBILE' : 'DESKTOP'}:`, newVotes, 'at', new Date().toLocaleTimeString());
    if (isMobile) {
      console.log('📱 Mobile voting debug:', {
        position,
        answerIndex,
        votes: newVotes,
        touchEvents: 'ontouchstart' in window,
        viewport: `${window.innerWidth}x${window.innerHeight}`
      });
    }
  };

  const handleSubmitVotes = async () => {
    if (hasVoted) return;
    
    const eligibleAnswers = answers;
    const requiredRanks = Math.min(3, eligibleAnswers.length);
    
    // Count non-empty votes
    const filledVotes = Object.values(votes).filter(v => v !== '').length;
    
    if (filledVotes < requiredRanks) {
      alert(`Please select answers for all ${requiredRanks} positions.`);
      return;
    }

    // Convert to backend format: { [answerIndex]: rank }
    const backendVotes = {};
    if (votes.first !== '') backendVotes[parseInt(votes.first)] = 1;
    if (votes.second !== '') backendVotes[parseInt(votes.second)] = 2;
    if (votes.third !== '') backendVotes[parseInt(votes.third)] = 3;
    
    // Validate that we have vote data
    if (Object.keys(backendVotes).length === 0) {
      console.error('🚨 PLAYER: No votes to submit!', { votes, backendVotes });
      alert('No votes selected. Please select your rankings first.');
      return;
    }

    try {
      // Get current question number from game state
      const stateRes = await fetch(`${API_BASE}games/${gameId}/state`);
      const stateJson = await stateRes.json();
      const currentQuestionNumber = stateJson.currentQuestion;

      if (!currentQuestionNumber) {
        alert('Unable to determine current question. Please try again.');
        return;
      }

      console.log(`🗳️ PLAYER: Submitting votes via HTTP API for question ${currentQuestionNumber}`);
      console.log(`🗳️ PLAYER: Vote data being sent:`, {
        playerName: playerName,
        questionNumber: currentQuestionNumber,
        votes: backendVotes
      });
      
      // Send vote via HTTP API (following design doc architecture)
      const voteRes = await fetch(`${API_BASE}games/${gameId}/votes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          playerName: playerName,
          questionNumber: currentQuestionNumber,
          votes: backendVotes
        })
      });
      
      if (!voteRes.ok) {
        const errorData = await voteRes.json();
        
        // Check if voting has closed
        if (errorData.error === 'Invalid game state for voting' && errorData.currentState && errorData.currentState.startsWith('RESULTS#')) {
          console.log('⏰ PLAYER: Voting has closed, transitioning to results');
          alert('Voting has closed. Moving to results...');
          
          // Update state to results
          setGameState(errorData.currentState);
          setHasVoted(true); // Prevent further vote attempts
          
          // Fetch current game state and results, including player score info
          await checkGameState();
          
          // Load player score information for the results display
          await loadPlayerScoreInfo();
          return;
        }
        
        throw new Error(errorData.error || 'Failed to submit vote');
      }
      
      setHasVoted(true);
      
      // Vote submitted successfully
      
      console.log(`✅ PLAYER: Vote submitted successfully`);
    } catch (e) {
      console.error('handleSubmitVotes error', e);
      alert(e.message || 'Failed to submit votes. Please try again.');
    }
  };

  /*
    `checkAndDownloadReport` AND `closeGameEndModal` ARE GONE with the dialog
    that was their only call site. The download aimed an unauthenticated
    participant at `admin/reports/{gameId}`, an admin route, and handled its
    usual 404 with an italic apology. OPEN-QUESTIONS §7 records the assumption:
    if participants should get a summary it needs a participant-scoped endpoint,
    which is a product decision rather than a design one.
  */

  // B2: rejoin prompt handlers
  //
  // This used to flip `joined = true` and nothing else — no request, so the
  // server never learned the player was back. The player saw a session; the
  // session did not see the player. A rejoin is a join, and it can fail for
  // all the ordinary reasons (the host ended it, the row expired, the name is
  // now someone else's), so it goes through the same path and the same
  // failure handling as any other join.
  //
  // `claimExisting: true` is the person's own answer to "is this you?". The
  // prompt only appears when this browser's localStorage says it joined this
  // session under this name, and it only matters for rows created before
  // client ids existed — a row already stamped with a different id is refused
  // regardless of what is claimed here.
  const handleRejoinConfirm = async () => {
    if (!rejoinPrompt) return;
    const { gameId: gid, name } = rejoinPrompt;
    console.log(`✅ PLAYER: Rejoining game ${gid} as ${name}`);

    const result = await performJoin(gid, name, { claimExisting: true });

    if (!result.ok) {
      console.log(`❌ PLAYER: Rejoin refused (${result.failure.kind})`);
      // Fall back to the join form with the name filled in, so whatever went
      // wrong is something the player can act on.
      setGameId(gid);
      setNameInput(name);
      setRejoinPrompt(null);
      applyJoinFailure(result.failure, name);
      return;
    }

    lastRankRef.current = -1; // fresh phase tracking for this session
    // Restore the player's place (checkPlayerAnswer/checkPlayerVote guards
    // prevent re-answering/re-voting).
    enterSession(gid, name, result.data);
  };

  /**
   * "Yes, that Chris is me." Only reachable from the NAME_UNVERIFIED screen —
   * a row the server cannot attribute, because it was created before client
   * ids existed. A row that *is* attributed refuses this outright, server
   * side, so the button cannot be used to take someone else's place.
   */
  const handleCollisionRejoin = async () => {
    if (!joinCollision) return;
    const name = joinCollision.playerName;
    const result = await performJoin(gameId, name, { claimExisting: true });

    if (!result.ok) {
      applyJoinFailure(result.failure, name);
      return;
    }
    enterSession(gameId, name, result.data);
  };

  /** "No, I'm a different Chris." Back to the form with the name cleared. */
  const handleCollisionRename = () => {
    setJoinCollision(null);
    setNameInput('');
    setPlayerName('');
  };

  /**
   * "Ask the host to let me take this name."
   *
   * The escape hatch from NAME_TAKEN, and it deliberately does not take
   * anything: it records the ask and pings the host's Players tab. The host
   * decides, because the host is the only party who can tell "Chris on a new
   * laptop" from "a second Chris" — owner: *"they need the choice though
   * because they may have just mistakenly picked the same name."*
   *
   * The route carries no authorizer, and must not: the caller is by definition
   * somebody who is NOT in the session.
   */
  const handleRequestHandover = async () => {
    if (!joinCollision) return;
    const name = joinCollision.playerName;
    setHandoverBusy(true);
    try {
      await fetch(`${API_BASE}games/${gameId}/players/${encodeURIComponent(name)}/handover-request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: getClientId(gameId), accessCode: accessCodeInput.trim() || null }),
      });
    } catch (error) {
      // A failed ask is not a dead end — the host can unlock without being
      // asked through the app at all, which is the commoner case in a real
      // room. So advance to `asked` either way and let the person try.
      console.error('PLAYER: handover request failed:', error);
    }
    setHandoverBusy(false);
    setJoinCollision((current) => (current ? { ...current, handoverStage: 'asked' } : current));
  };

  /**
   * "The host said go ahead."
   *
   * A retry of the join carrying `claimExisting`. NOT a takeover: the server
   * refuses it outright unless the host has opened a one-shot grant on this
   * name, and spends the grant in a conditional write so two people racing one
   * grant cannot both get in (join-game.js's `handover` branch).
   *
   * A refusal is not an error screen — it is "not yet", which is the only
   * reading a person on a blocked screen can act on.
   */
  const handleTakeOverName = async () => {
    if (!joinCollision) return;
    const name = joinCollision.playerName;
    setHandoverBusy(true);
    const result = await performJoin(gameId, name, {
      accessCode: accessCodeInput.trim() || null,
      claimExisting: true,
    });
    setHandoverBusy(false);

    if (result.ok) {
      enterSession(gameId, name, result.data);
      return;
    }

    if (result.failure.kind === 'name-taken' || result.failure.kind === 'name-unverified') {
      setJoinCollision((current) => (current ? { ...current, handoverStage: 'refused' } : current));
      return;
    }
    applyJoinFailure(result.failure, name);
  };

  const handleRejoinDecline = () => {
    if (!rejoinPrompt) return;
    console.log(`🙅 PLAYER: Declining rejoin — joining as someone else`);
    localStorage.removeItem(`playerName_${rejoinPrompt.gameId}`);
    setNameInput('');
    setPlayerName('');
    setRejoinPrompt(null);
  };

  /*
    THE CARD BALLOT — one card per response, the number, the text, and the rank
    buttons in the row itself.

    NOTHING HERE REORDERS, FILTERS, SORTS OR REINDEXES (RATIONALE §6.2).
    `Response N` is 1-based, absolute, in array order, and matches
    `displayLabelFor` in config/anonymity.js exactly. Vote indices map to array
    position, so a reorder between VOTE and RESULTS would already be
    misattributing votes; stable numbers across the whole ballot are what let a
    host say "six and eleven" and be understood by forty people at once. Every
    alternative — sorting by length so short answers are not skipped, floating
    your own to the bottom, hiding duplicates — breaks the room's shared
    reference.

    THE SUBMIT IS NOT IN HERE. It lives in the dock, outside the scrolling
    region, so the primary action cannot be scrolled off a long ballot — and so
    that both ballots offer exactly one of it.

    NO GESTURES (§8.4). Drag-to-rank is the obvious "nicer" ballot and it is
    wrong here: undiscoverable, two-handed in practice, it fights the scroll
    container it lives in, and it is unusable with a screen reader or a switch
    device. Three buttons are boring and work for everybody.
  */
  const DetailedVotingMode = ({ answers, votes, onVoteChange, requiredVotes, mySubmittedAnswer }) => {
    const handleVoteClick = (answerIndex, position) => {
      // Track interaction to prevent polling interference
      setLastVoteInteraction(Date.now());
      setIsUserVoting(true);
      setTimeout(() => setIsUserVoting(false), 3000);

      // Pressing the rank this answer already holds takes it off the ballot;
      // pressing any other rank MOVES it there, and handleVoteChange vacates
      // the old one. Same `rankHolding` the badge and the quick options read.
      if (rankHolding(votes, answerIndex) === position) {
        onVoteChange(position, ''); // Remove vote
      } else {
        onVoteChange(position, answerIndex); // Assign vote (clears it from wherever it was)
      }
    };

    const ownIdx = ownAnswerIndex(answers, mySubmittedAnswer);

    return (
      <div className="plr-ballot">
        {answers.map((answer, idx) => {
          // The SAME rule the quick ballot's options read. This was a private
          // `getVotePosition` here and an inline `Object.values(votes)
          // .includes(...)` over there — two answers to one question, which is
          // how the two ballots came to disagree about what a pick means.
          const currentPosition = rankHolding(votes, idx);
          const isOwn = idx === ownIdx;

          return (
            <article key={idx} className={`plr-resp${isOwn ? ' plr-resp--own' : ''}`}>
              <div className="plr-rhead">
                <span className="plr-rid">{displayLabelFor(answer, idx)}</span>
                {/* YOUR OWN ROW IS MARKED AND REMAINS RANKABLE.
                    `ownAnswerIndex` matches on submitted text, which is correct
                    and is not a leak. Whether a player SHOULD be able to rank
                    themselves is a product question, not a design one:
                    OPEN-QUESTIONS §2 leaves it rankable because
                    `requiredRanks = min(3, answers.length)` counts your own row,
                    so in a room of three the submit becomes unreachable the
                    moment self-voting is blocked. */}
                {isOwn && <span className="plr-flag plr-flag--mine">Yours</span>}
              </div>

              {/* THE TEXT OPENS; THE RANK BUTTONS DO NOT.
                  A click handler on the whole card would fire behind every one
                  of the three rank buttons, so ranking an answer would also
                  open a dialog over the ballot the player is filling in. This
                  is a ballot, not a results wall: reading is the secondary
                  gesture. */}
              <div
                className="plr-rtxt plr-rtxt--clamp"
                role="button"
                tabIndex={0}
                aria-label="Read this response in full"
                onClick={() => setSpotlightIndex(idx)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setSpotlightIndex(idx);
                  }
                }}
              >
                {answer.answer}
              </div>
              {/* A REDUCTION WITH NO RECOVERY IS A DELETION. The clamp above is
                  five lines of CSS; this is the control that undoes it, and it
                  is muted and underlined rather than amber, because expanding a
                  response is not the task — ranking it is. */}
              <button
                type="button"
                className="plr-more"
                onClick={() => setSpotlightIndex(idx)}
              >
                Show all ↓
              </button>

              <div className="plr-ranks">
                {['first', 'second', 'third'].slice(0, requiredVotes).map(position => {
                  const isSelected = currentPosition === position;
                  const rank = VOTE_POSITIONS[position];

                  return (
                    <button
                      key={position}
                      type="button"
                      className="plr-rk"
                      onClick={() => handleVoteClick(idx, position)}
                      aria-pressed={isSelected}
                      aria-label={`Vote this answer ${rankLabel(rank)}`}
                      title={rankLabel(rank)}
                    >
                      <RankIcon rank={rank} size={18} />{' '}
                      {rankLabel(rank)}
                    </button>
                  );
                })}
              </div>
            </article>
          );
        })}
      </div>
    );
  };

  /*
    THE BALLOT SLOT BAR, in the dock. `Response N` again — never a truncation of
    the response text, which would be a second, shorter, differently-worded
    statement of a row the player can already see.
  */
  const BallotSlots = ({ votes, answers, requiredVotes }) => (
    <div className="plr-slots" aria-label="Your ballot so far">
      {['first', 'second', 'third'].slice(0, requiredVotes).map((position) => {
        const picked = votes[position];
        const idx = picked === '' ? null : parseInt(picked, 10);
        const filled = idx !== null && Number.isFinite(idx) && answers[idx];
        return (
          <div key={position} className={`plr-slot${filled ? ' plr-slot--filled' : ''}`}>
            <span className="plr-sk">{rankLabel(VOTE_POSITIONS[position])}</span>
            <span className="plr-sv">
              {filled ? displayLabelFor(answers[idx], idx) : '—'}
            </span>
          </div>
        );
      })}
    </div>
  );

  // The name is already answering in this session. Shown ahead of everything
  // else on the join side: it is the only screen that tells the second Chris
  // they are the second Chris, and it used to not exist — the server merged
  // them into the first Chris and said "Reconnected".
  if (!joined && joinCollision) {
    return (
      <PlayerShell
        phase="join"
        volume="act"
        ctx="Join a session"
        /* The refusal's two ways out belong in the dock, exactly as the rejoin
           prompt's do twenty lines below. They rendered inside `.plr-stage`
           until now, which is the one screen on this surface where a player is
           already stuck being the one screen that asked them to scroll to get
           unstuck. */
        dock={(
          <JoinNameCollisionActions
            kind={joinCollision.kind}
            playerName={joinCollision.playerName}
            /* ONE STAGE, READ BY BOTH HALVES. The note in the stage and the
               label in the dock describe the same step, so they come from the
               same value rather than from two conditions that can drift. */
            handoverStage={joinCollision.handoverStage || 'idle'}
            busy={handoverBusy}
            onRejoinAnyway={handleCollisionRejoin}
            onUseAnotherName={handleCollisionRename}
            onRequestHandover={handleRequestHandover}
            onTakeOver={handleTakeOverName}
          />
        )}
      >
        <JoinNameCollision
          kind={joinCollision.kind}
          playerName={joinCollision.playerName}
          message={joinCollision.message}
          handoverStage={joinCollision.handoverStage || 'idle'}
        />
      </PlayerShell>
    );
  }

  /*
    Rejoin prompt (B2) — shown before the join screen when a saved identity is
    detected, replacing the previous silent auto-join.

    ACT, INCLUDING THE DEAD ENDS. The volume model begins at join-success
    (RATIONALE §10.1): before a player is in a session there is no stage to
    compete with, no room looking up, and no shared surface — the phone IS the
    entire product. That boundary was not stated until the design's own audit
    failed a WATCH screen for having a button on it, three times, once per
    device profile, and the failure was right.
  */
  if (!joined && rejoinPrompt) {
    return (
      <PlayerShell
        phase="join"
        volume="act"
        ctx="Welcome back"
        dock={(
          <>
            <button type="button" className="plr-btn" onClick={handleRejoinConfirm}>
              Rejoin as {rejoinPrompt.name}
            </button>
            <button type="button" className="plr-btn plr-btn--ghost" onClick={handleRejoinDecline}>
              Join as someone else
            </button>
          </>
        )}
      >
        <h1 className="plr-h1">Welcome back.</h1>
        <p className="plr-lede plr-muted">
          This phone joined session <strong>{rejoinPrompt.gameId}</strong> as{' '}
          <strong>{rejoinPrompt.name}</strong>. Rejoining brings your answers and your score
          back with you.
        </p>
      </PlayerShell>
    );
  }

  // Join screen.
  //
  // The parallax hero is gone from both this screen and the joined one: three
  // cross-origin .webp layers, loading="eager", at the top of the DOM, above
  // the question, on the smallest screen and the slowest connection in the
  // building. The player knows what app they are in — they scanned its QR code.
  if (!joined) {
    if (needsAccessCode) {
      return (
        <PlayerShell
          phase="join"
          volume="act"
          ctx="Private session"
          dock={(
            <>
              <button type="submit" form="plr-access-form" className="plr-btn">
                Join Game
              </button>
              <button
                type="button"
                className="plr-btn plr-btn--ghost"
                onClick={() => {
                  setNeedsAccessCode(false);
                  setAccessCodeInput('');
                  setJoinError(null);
                  // The name is NOT cleared. Declining a private session used to
                  // throw away a name that had already been typed and accepted,
                  // which is a deletion offered as a way back (INVENTORY §2).
                }}
              >
                Back
              </button>
            </>
          )}
        >
          <h1 className="plr-h1 plr-h1--primary">This session is private.</h1>
          <p className="plr-lede plr-muted">
            The host has an access code for it. Ask them, or read it off the main screen.
          </p>
          <form id="plr-access-form" onSubmit={handleAccessCodeSubmit}>
            <div className="plr-field">
              <label className="plr-lab" htmlFor="plr-access">Access code</label>
              <input
                id="plr-access"
                type="text"
                value={accessCodeInput}
                onChange={(e) => setAccessCodeInput(e.target.value)}
                placeholder="Enter Access Code"
                className={`plr-inp${joinError ? ' plr-inp--bad' : ''}`}
                required
              />
              {joinError && (
                <p className="plr-err" role="alert">
                  <Icon name="WarningCircle" weight="bold" size={16} />
                  {joinError}
                </p>
              )}
            </div>
            {/* Enables implicit submission from the field itself. The reachable
                submit is in the dock, where a thumb can get to it. */}
            <input type="submit" hidden aria-hidden="true" tabIndex={-1} />
          </form>
        </PlayerShell>
      );
    }

    return (
      <PlayerShell
        phase="join"
        volume="act"
        ctx="Join a session"
        dock={(
          <>
            <button type="submit" form="plr-join-form" className="plr-btn">
              Join Game
            </button>
            <p className="plr-note plr-note--after">
              No account, nothing to install. Keep this page open — the same code and name
              will bring you back.
            </p>
          </>
        )}
      >
        <h1 className="plr-h1">Join the session.</h1>
        <p className="plr-lede plr-muted">Type the four digits on the main screen.</p>

        <form id="plr-join-form" onSubmit={handleJoinGame}>
          <div className="plr-field">
            <label className="plr-lab" htmlFor="plr-code">Session code</label>
            <input
              id="plr-code"
              type="text"
              value={gameId}
              onChange={(e) => setGameId(e.target.value)}
              placeholder="Game ID"
              className={`plr-inp plr-inp--code${joinError ? ' plr-inp--bad' : ''}`}
              inputMode="numeric"
              autoComplete="one-time-code"
              aria-describedby="plr-code-help"
              required
              readOnly={codeLocked}
              ref={codeInputRef}
            />
            <p className="plr-help" id="plr-code-help">
              {codeLocked
                ? 'Read from the link you followed. Nothing to type.'
                : 'Four digits. Not case-sensitive, because there are no letters.'}
            </p>
            {/*
              THE WAY OUT OF A CODE THAT IS NO LONGER THE RIGHT ONE.

              A code that arrived in a link was read-only with "Nothing to
              type", and there was no way to change it at all. That is fine
              right up until the code is wrong: the host started a different
              session, the link was yesterday's, someone forwarded the wrong
              message. The player could scan a new QR or follow a new link, but
              if all they had was four digits read off the screen — which is the
              commonest way a room fixes this — the field refused them and the
              only remaining move was editing the URL by hand.

              UNLOCK RATHER THAN NAVIGATE. "Go back to the page where you type
              one in" is not a different page — it is this form with the field
              unlocked, and getting there would mean rewriting the URL first or
              the param would just re-lock it on the next render. So this
              unlocks in place. Nothing else has to change: handleJoinGame
              already rewrites `?gameId=` on a successful manual join, so the
              link is correct again afterwards without touching that path.

              IT SELECTS RATHER THAN CLEARS. Wiping the field would be a
              reduction with no recovery — one stray tap and the code that DID
              arrive in the link is gone. Selected text is replaced by the first
              keystroke, which costs the same on a phone, and is still there if
              the tap was a mistake.

              It is not rendered once unlocked: a control whose whole job is
              already done reads as a second, subtly different action.
            */}
            {codeLocked && (
              <button
                type="button"
                className="plr-linkish"
                onClick={unlockCode}
              >
                Use a different code
              </button>
            )}
          </div>

          <div className="plr-field">
            <label className="plr-lab" htmlFor="plr-name">Your name</label>
            <input
              id="plr-name"
              type="text"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              placeholder="Your Name"
              className="plr-inp"
              aria-describedby="plr-name-help"
              required
            />
            {/* CONSENT AT THE MOMENT THE NAME IS TYPED, not at the ballot
                (RATIONALE §6.3). Telling somebody at the ballot that their
                answer was unattributed is telling them after they wrote it. */}
            <p className="plr-help" id="plr-name-help">
              Used for the scoreboard and to get you back in if you lose this page. On rounds
              where the room votes, your name is <b>not</b> shown next to your answer until
              voting closes.
            </p>
          </div>

          {/* AMBER, NOT RED, and it names what to do rather than what went
              wrong (§4.2). Four failures used to share one alert() with one
              undifferentiated sentence; the server still returns a single error
              string for wrong code / ended / full, which RATIONALE §11.8 names
              as the smallest backend fix worth making. */}
          {joinError && (
            <p className="plr-err" role="alert">
              <Icon name="WarningCircle" weight="bold" size={16} />
              {joinError}
            </p>
          )}

          <input type="submit" hidden aria-hidden="true" tabIndex={-1} />
        </form>
      </PlayerShell>
    );
  }

  // Which ballot row (if any) is this player's own submission — computed once
  // per render so both voting modes below mark the same row.
  const ownAnswerIdx = ownAnswerIndex(answers, mySubmittedAnswer);

  /* ======================================================================
     THE JOINED SURFACE.

     One shell, one set of chrome values, and exactly one of the branches
     below fills it. Written as an assignment rather than a tree of `&&`
     because the VOLUME (RATIONALE §2.2) is a property of the whole screen —
     ACT gets a dock and the one amber idea, REST and WATCH get neither — and
     a design where three branches each decide that independently is a design
     where the fourth one forgets.
     ====================================================================== */

  const roundNo = roundNumberOf(currentQuestion, gameState);
  const roundNoun = resolveRoundNoun(currentQuestion, gameType, setRoundNoun);
  const position = roundNo !== null ? `${roundNoun} ${roundNo}` : null;
  const category = currentQuestion?.field || currentQuestion?.category || null;
  const requiredVotes = Math.min(3, answers.length);
  const filledVotes = Object.values(votes).filter((v) => v !== '').length;
  const instruction = getPlayerInstructionText(customInstruction, currentQuestion, gameType);

  /*
    THE OFFLINE BANNER replaces a status chip whose click handler was
    `window.location.reload()` — offered as the remedy for a bad connection to a
    player who may be mid-sentence in a textarea whose contents live in React
    state and nowhere else. The one moment that control was most likely to be
    pressed was the one moment it destroyed work, and its own tooltip invited
    it: "Live connection is healthy — tap to reload".

    THE COPY IS NOT THE COPY THE DESIGN ASKS FOR, DELIBERATELY. RATIONALE §7
    writes "Your text is safe on this phone and will send as soon as you are
    back", and then says the sentence must not ship before the localStorage
    draft that makes it true (§11.7). That draft does not exist yet, so the
    banner says only what is currently true. A reassurance the software cannot
    keep is worse than no banner.

    Amber, never red: being offline is not destructive.
  */
  const offlineBanner = !wsConnected ? (
    <div className="plr-banner" role="status">
      <Icon name="WifiSlash" weight="bold" size={16} />
      <div>
        <b>Offline.</b> Reconnecting. This page catches up on its own when the connection
        comes back — you do not need to refresh it, and refreshing would lose anything you
        have typed but not sent.
      </div>
    </div>
  ) : null;

  let phase = 'quiet';
  let volume = 'rest';
  let ctx = position || 'In the session';
  let barCategory = null;
  let centre = false;
  let dock = null;
  let body = null;

  /* ---------------------------------------------------------------- ENDED --
     BEFORE `isWaitingState`, which used to swallow it: `isWaitingState` is
     true for anything that is not ASK#/VOTE#/RESULTS#, so a finished session
     rendered "✅ You're in! / Waiting for the game to start… / ● Ready to
     play" and left the player there permanently (INVENTORY §7.2). */
  if (gameState === 'ENDED') {
    volume = 'watch';
    ctx = 'Session complete';
    centre = true;
    body = (
      <>
        <p className="plr-lab">That&apos;s a wrap</p>
        <h1 className="plr-h1">Thanks for playing, {playerName}.</h1>

        <hr className="plr-sep" />
        <div className="plr-stat">
          <span className="plr-k">Final score</span>
          <span className="plr-v">{playerScoreInfo?.totalScore ?? playerScore}</span>
        </div>
        {playerScoreInfo?.rankDisplay && (
          <div className="plr-stat">
            <span className="plr-k">Final standing</span>
            <span className="plr-v">
              {playerScoreInfo.rankDisplay} of {playerScoreInfo.totalPlayers}
            </span>
          </div>
        )}

        <LookUpCue>
          The room summary — the top responses, and what the host wants everyone to take
          away — is on the main screen.
        </LookUpCue>
        <p className="plr-help" style={{ marginTop: '18px' }}>
          You can close this page. If your host publishes a session summary, they will share
          the link themselves.
        </p>
      </>
    );

  /* ------------------------------------------------------------------ ASK -- */
  } else if (gameState.startsWith('ASK#') && currentQuestion) {
    barCategory = category;
    ctx = position || 'This round';

    /* THE QUESTION, BY GAME TYPE. Poll and survey used to fall into an `else`
       that rendered `title` only, so a poll question's `detail` — the
       background context that makes it answerable — was never shown to a
       single player. Two of five shipped game types had no ASK design at all
       (INVENTORY §4). */
    const isArtwork = gameType === 'call-and-answer' && !!currentQuestion.image;
    const headline = isArtwork
      ? (currentQuestion.title || currentQuestion.question)
      : gameType === 'call-and-answer'
        // `|| title` is the fallback the shipped chain lacked: a call-and-answer
        // question carrying only a `title` rendered an empty prompt and pushed
        // the real one into a "subtitle" beneath it.
        ? (currentQuestion.detail || currentQuestion.question || currentQuestion.title)
        : (currentQuestion.title || currentQuestion.question);
    // Compared against the RESOLVED headline rather than against `detail ||
    // question`, so it can never restate the line directly above it.
    const subtitle = gameType === 'call-and-answer'
      && currentQuestion.title
      && currentQuestion.title !== headline
      && currentQuestion.title.length < 100
      ? currentQuestion.title
      : null;
    const detail = isArtwork
      ? currentQuestion.detail
      : gameType === 'call-and-answer'
        ? null
        : gameType === 'trivia'
          ? currentQuestion.questionDetail
          : gameType === 'wavelength'
            ? null
            : currentQuestion.detail;           // poll and survey — the missing branch

    /* THE ONE REDUCTION, AND IT IS REVERSIBLE (§5.3). With a soft keyboard up
       there are roughly 430 usable pixels; a nine-line question and a composer
       cannot both have them. Focus is the trigger because no browser reliably
       reports the keyboard's height. The control that undoes it is rendered
       with it, always — a fold, not a deletion. */
    const folded = isAnswerInputFocused && !showFullQuestion;

    const questionBlock = (
      <>
        {subtitle && !folded && <p className="plr-lab">{subtitle}</p>}
        <p className={`plr-q${folded ? ' plr-q--fold' : ''}`}>{headline}</p>
        {folded ? (
          <button
            type="button"
            className="plr-more"
            onClick={() => setShowFullQuestion(true)}
          >
            Show the whole question ↓
          </button>
        ) : (
          <>
            {isArtwork && (
              <img
                src={currentQuestion.image}
                alt={currentQuestion.title || 'Artwork'}
                className="plr-artwork"
                onError={(e) => { e.currentTarget.style.display = 'none'; }}
              />
            )}
            {/* No wavelength branch here, deliberately. The wavelength
                `detail` (like the deleted Topic line) described the subject —
                and any words about its meaning seed the very answers the game
                exists to compare. The term is the headline; the words form's
                own copy says what to do (the owner, off the AI Jargon set). */}
            {detail && <p className="plr-detail plr-muted">{detail}</p>}
          </>
        )}
      </>
    );

    /* THE RESOLVED INSTRUCTION. The host stage cut this on the grounds that
       "every player already has it on their own phone at arm's length", which
       is exactly what makes it load-bearing here. It is stated ONCE, as
       content — never again as placeholder text, which vanishes on the first
       keystroke, i.e. is present exactly while it is not needed. */
    const taskBlock = instruction ? (
      <div className="plr-task">
        <p className="plr-lab">Your task</p>
        <p>{instruction}</p>
      </div>
    ) : null;

    if (!hasAnswered) {
      volume = 'act';
      phase = 'ask';

      if (gameType === 'trivia') {
        const keys = ['optionA', 'optionB', 'optionC', 'optionD', 'optionE', 'optionF']
          .filter((key) => currentQuestion[key]);
        body = (
          <>
            {questionBlock}
            {taskBlock}
            {/* WAS `<div className="category-item trivia-option" onClick=...>` —
                the admin category picker's class, on a div with no role, no
                tabIndex and no aria-checked: not reachable by keyboard and not
                announced as selectable. */}
            <div className="plr-opts" role="radiogroup" aria-label="Answer options">
              {keys.map((key, index) => {
                const optionLetter = String.fromCharCode(65 + index);
                const isSelected = selectedTriviaAnswer === optionLetter;
                return (
                  <button
                    key={key}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    /* `trivia-option` and `active` are gone. They were the last
                       two globals left on this surface and BOTH were already
                       dead paint: styles.css:6839 records that `.trivia-option`
                       lost its rules ("now using .category-item styling"), and
                       the only surviving selectors need `.category-item`
                       alongside it, which this element has never had. What
                       actually paints a chosen option is
                       `.plr-opt[aria-checked="true"]` — the same attribute a
                       screen reader announces, so the visual state and the
                       announced state cannot drift apart. */
                    className="plr-opt"
                    onClick={() => setSelectedTriviaAnswer(optionLetter)}
                  >
                    <span className="plr-k">{optionLetter}</span>
                    <span>{currentQuestion[key]}</span>
                  </button>
                );
              })}
            </div>
          </>
        );
        dock = (
          <>
            <p className="plr-note">
              {selectedTriviaAnswer
                ? `${selectedTriviaAnswer} selected. You can change it until you submit.`
                : 'Choose an answer. You can change it until you submit.'}
            </p>
            <button
              type="button"
              className="plr-btn"
              onClick={() => handleSubmitAnswer(null, selectedTriviaAnswer)}
              disabled={!selectedTriviaAnswer}
            >
              Submit Answer
            </button>
          </>
        );
      } else if (gameType === 'wavelength') {
        const wordCount = wavelengthWords.filter((w) => w.trim()).length;
        body = (
          <>
            {questionBlock}
            {taskBlock}
            {/* WHAT THE ROUND IS FOR, stated before the form (convergence spec
                §5): a word only counts when everyone who answers says it, so
                the winning move is the OBVIOUS word, not the cleverest one.
                Without this line the ten blank fields read as a brainstorm,
                which is the opposite game. */}
            <p className="plr-detail plr-muted">
              Aim for ten. A word counts only when everyone says it — go for
              the words the rest of the room will think of too, not the
              cleverest one.
            </p>
            {/* TEN STACKED INPUTS, EACH WITH A `Word N` LABEL *AND* A `Word N`
                PLACEHOLDER — twenty strings for ten values, ~900px of form on a
                375px phone. The labels stay (a placeholder is not a label) and
                the duplicate placeholder goes. */}
            <div className="plr-words-form">
              {wavelengthWords.map((word, index) => (
                <div key={index} className="plr-field">
                  <label className="plr-lab" htmlFor={`plr-word-${index}`}>
                    Word {index + 1}
                  </label>
                  <input
                    id={`plr-word-${index}`}
                    type="text"
                    value={word}
                    onChange={(e) => {
                      const newWords = [...wavelengthWords];
                      newWords[index] = e.target.value;
                      setWavelengthWords(newWords);
                    }}
                    className="plr-inp"
                    maxLength="50"
                  />
                </div>
              ))}
            </div>
          </>
        );
        dock = (
          <>
            <p className="plr-note">
              {/* Ten asked for, fewer accepted — nobody gets stuck in front of
                  a room because they ran dry at six (spec §2.1). */}
              {wordCount} of 10 added. Fewer is fine — submit when you run dry.
            </p>
            <button
              type="button"
              className="plr-btn"
              onClick={handleSubmitAnswer}
              disabled={wordCount === 0}
            >
              Submit Words ({wordCount}/10)
            </button>
          </>
        );
      } else {
        /* CALL-AND-ANSWER, POLL, SURVEY, ARTWORK.

           `mobile-input-overlay` is gone: a full-screen textarea that covered
           the question, so a player composing an answer could not see what they
           were answering — carrying THREE submit affordances at once (an
           airplane icon, a button inside its form, and the form beneath it once
           dismissed). The question folds instead. */
        body = (
          <>
            {questionBlock}
            {taskBlock}
            <form id="plr-answer-form" onSubmit={handleSubmitAnswer}>
              <label className="plr-lab" htmlFor="plr-answer">Your response</label>
              <textarea
                id="plr-answer"
                value={answerInput}
                onChange={(e) => setAnswerInput(e.target.value)}
                onFocus={() => setIsAnswerInputFocused(true)}
                onBlur={() => setIsAnswerInputFocused(false)}
                className="plr-inp plr-inp--area"
                aria-describedby="plr-answer-help"
                required
                spellCheck={true}
                autoComplete="on"
                autoCorrect="on"
                autoCapitalize="sentences"
              />
              <p className="plr-count">{answerInput.trim().length} characters</p>
              {/* CONSENT NEXT TO THE THING BEING WRITTEN (§6.3). The word
                  "anonymous" does not appear anywhere on this surface: a room of
                  twelve where somebody writes in their own voice about their own
                  team is not anonymous in any cryptographic sense, and saying so
                  would be a promise the software cannot keep. */}
              <p className="plr-help" id="plr-answer-help">
                The room will see this response and vote on it. Your name is not attached to
                it until voting closes.
              </p>
              <input type="submit" hidden aria-hidden="true" tabIndex={-1} />
            </form>
          </>
        );
        dock = (
          <button type="submit" form="plr-answer-form" className="plr-btn" disabled={!answerInput.trim()}>
            Submit Answer
          </button>
        );
      }
    } else {
      /* THE RECEIPT (§6.5). `handleSubmitAnswer` clears `answerInput`,
         `selectedTriviaAnswer` and `wavelengthWords` on send, so the only
         surviving record of what a player wrote was `mySubmittedAnswer` — which
         existed solely to find their own ballot row and was never displayed. A
         player who can see what they wrote can follow along when the host reads
         response four aloud. A player who cannot is guessing, and somebody
         guessing whether the room is discussing their idea is not participating
         in the discussion. */
      volume = 'rest';
      const submittedLetter = gameType === 'trivia' ? mySubmittedAnswer : null;
      const submittedOption = submittedLetter
        ? currentQuestion[`option${submittedLetter}`]
        : null;
      const submittedWords = gameType === 'wavelength' && mySubmittedAnswer
        ? mySubmittedAnswer.split(',').map((w) => w.trim()).filter(Boolean)
        : null;

      body = (
        <>
          <p className="plr-lab plr-lab--good">Submitted</p>
          <h1 className="plr-h1 plr-h1--primary">
            {gameType === 'trivia' ? 'Answer Submitted!'
              : gameType === 'wavelength' ? 'Words Submitted!'
                : gameType === 'poll' ? 'Response Submitted!'
                  : currentQuestion?.image ? 'Title Submitted!' : 'Application Submitted!'}
          </h1>

          {submittedWords ? (
            <div className="plr-chips">
              {submittedWords.map((word, i) => (
                <span key={i} className="plr-chip">{word}</span>
              ))}
            </div>
          ) : (submittedLetter || mySubmittedAnswer) ? (
            <div className="plr-card plr-card--good">
              <p className="plr-lab">What you sent</p>
              <p className="plr-quote">
                {submittedLetter
                  ? `${submittedLetter}. ${submittedOption || ''}`.trim()
                  : mySubmittedAnswer}
              </p>
            </div>
          ) : null}

          <p className="plr-help">
            This is locked for the round. If this page reloads, it comes back.
          </p>

          <LookUpCue>
            {gameType === 'trivia'
              ? 'The room’s answers go up on the main screen when the round closes.'
              : gameType === 'wavelength'
                /* Nothing is revealed until everyone is in — a player watching
                   words accumulate would change what they wrote (spec §5). */
                ? 'Nothing shows until everyone is in. When the round closes, the words the whole room shares light up on the main screen.'
                : 'The host will bring every response up on the main screen when the round closes, without names.'}
          </LookUpCue>
        </>
      );
    }

  /* ----------------------------------------------------------------- VOTE -- */
  } else if (gameState.startsWith('VOTE#')) {
    ctx = position ? `Voting · ${position}` : 'Voting';

    if (hasVoted) {
      /* `|| hasVoted` IS THE OTHER HALF OF THE TAB-SWITCH REPORT, and it used
         to be a blank page rather than a reset one. `answers.length > 0` alone
         is right for the BALLOT — there is nothing to rank until the responses
         are in — and wrong for the confirmation underneath it, because
         `loadVotingData` returns early once it learns this player has already
         voted and never loads the answers on that path. */
      volume = 'rest';
      const ranked = ['first', 'second', 'third']
        .map((slot) => ({ slot, idx: votes[slot] === '' ? null : parseInt(votes[slot], 10) }))
        .filter(({ idx }) => idx !== null && Number.isFinite(idx) && answers[idx]);

      body = (
        <>
          <p className="plr-lab plr-lab--good">Submitted</p>
          <h1 className="plr-h1 plr-h1--primary">Votes Submitted!</h1>

          {ranked.length > 0 && (
            <div className="plr-card plr-card--good">
              <p className="plr-lab">Your ballot</p>
              {ranked.map(({ slot, idx }) => (
                <div key={slot} className="plr-stat">
                  <span className="plr-k">{rankLabel(VOTE_POSITIONS[slot])}</span>
                  <span className="plr-v">{displayLabelFor(answers[idx], idx)}</span>
                </div>
              ))}
            </div>
          )}

          <p className="plr-help">
            This is locked for the round. If this page reloads, it comes back.
          </p>
          <LookUpCue>
            Who wrote what, and how the room ranked them, goes up on the main screen when
            voting closes.
          </LookUpCue>
        </>
      );
    } else if (answers.length > 0) {
      volume = 'act';
      phase = 'vote';

      /* THE QUESTION BEING VOTED ON, WHICH THIS SCREEN HAS NEVER RENDERED.
         `currentQuestion` is loaded and simply never used in this branch, so a
         player who joined at round three — or who has been discussing something
         else for two minutes — ranks six answers to a question the phone will
         not show them (INVENTORY §5). */
      const votedQuestion = currentQuestion?.image
        ? (currentQuestion.title || currentQuestion.question)
        : (currentQuestion?.detail || currentQuestion?.title || currentQuestion?.question);

      body = (
        <>
          <h1 className="plr-h1 plr-h1--primary">
            Rank your top {requiredVotes === 1 ? 'one' : requiredVotes === 2 ? 'two' : 'three'}.
          </h1>
          {votedQuestion && <p className="plr-detail plr-muted">{votedQuestion}</p>}
          {currentQuestion?.image && (
            <img
              src={currentQuestion.image}
              alt={currentQuestion.title || 'Artwork'}
              className="plr-artwork"
              onError={(e) => { e.currentTarget.style.display = 'none'; }}
            />
          )}

          {/* THE ROOM-FACING SENTENCE, VERBATIM, ABOVE THE BALLOT, EVERY TIME,
              NOT DISMISSIBLE — and the qualifier is not a footnote (§6.3). It
              is the difference between a true statement and an overclaim, and
              the product has to be able to say the true one out loud. Before
              this, rows were labelled `Response 1…N` and nothing anywhere said
              why, which reads as a bug or as the app having lost the names. */}
          <p className="plr-anon">
            <b>Nobody sees who wrote what — the host included — until voting closes.</b>{' '}
            This hides names, not identities.
          </p>

          {/* TWO BALLOTS SURVIVE, WHICH IS A DEPARTURE FROM RATIONALE §6.1.
              §6.1 deletes Quick Vote outright; `__tests__/voteSwitching.test.jsx`
              (commit a4bd7127, today) pins the fix that made a vote switchable
              at all and drives the quick ballot's three selects with user-event.
              Deleting the mode deletes the regression test for a defect the
              owner reported this morning, so both are restyled instead. See the
              report. */}
          <div className="plr-modes" role="group" aria-label="How to rank">
            <button
              type="button"
              className="plr-mode"
              aria-pressed={votingMode === 'quick'}
              onClick={() => setVotingMode('quick')}
            >
              Quick Vote
            </button>
            <button
              type="button"
              className="plr-mode"
              aria-pressed={votingMode === 'detailed'}
              onClick={() => setVotingMode('detailed')}
            >
              Detailed Vote
            </button>
          </div>

          {votingMode === 'quick' ? (
            <div className="plr-quick">
              {['first', 'second', 'third'].slice(0, requiredVotes).map((slot) => (
                <div key={slot} className="plr-vpos">
                  <label className="plr-lab" htmlFor={`plr-rank-${slot}`}>
                    <RankIcon rank={VOTE_POSITIONS[slot]} size={18} />{' '}
                    {rankLabel(VOTE_POSITIONS[slot])}
                  </label>
                  <select
                    id={`plr-rank-${slot}`}
                    value={votes[slot]}
                    onChange={(e) => handleVoteChange(slot, e.target.value)}
                    className="plr-select"
                  >
                    <option value="">Choose a response…</option>
                    {answers.map((answer, idx) => {
                      /*
                        NOTHING IS DISABLED HERE, AND THAT IS THE FIX.

                          "the quick view method does not allow for you to
                           switch votes ... i like how the detailed voted kicks
                           out the choice anywhere else when you pick it, make
                           that work for the quick vote."

                        This option used to carry `disabled={isSelected &&
                        !isCurrentSelection}`, so an answer already ranked in
                        another slot could not be picked here. The kick-out in
                        `handleVoteChange` has always existed, but a browser will
                        not let you choose a disabled option, so on this ballot
                        it was unreachable code.

                        THE LOST AFFORDANCE IS REPLACED, NOT DROPPED. `disabled`
                        was also the only signal that an answer was spoken for,
                        and a select gives no styling to lean on, so the option
                        says WHERE it currently sits — text which IS the
                        accessible name, so it is announced rather than merely
                        seen.
                      */
                      const heldRank = rankHolding(votes, idx);
                      const isCurrentSelection = heldRank === slot;
                      const isOwn = idx === ownAnswerIdx;

                      /* THE NUMBER COMES FIRST because it is the handle a
                         facilitator reads aloud — on the shipped ballot it was
                         invisible until the wheel was open. 20 characters
                         (roughly three words of something somebody spent a
                         minute writing) is now 72, with the remainder in the
                         card ballot rather than in a `title` a phone cannot
                         show. */
                      const truncated = answer.answer.length > 72
                        ? `${answer.answer.substring(0, 72)}…`
                        : answer.answer;

                      return (
                        <option key={idx} value={idx} title={answer.answer}>
                          {displayLabelFor(answer, idx)}{isOwn ? ' (Yours)' : ''} — “{truncated}”
                          {heldRank && !isCurrentSelection
                            ? ` — currently ${rankLabel(VOTE_POSITIONS[heldRank])}`
                            : ''}
                        </option>
                      );
                    })}
                  </select>
                </div>
              ))}
            </div>
          ) : (
            <DetailedVotingMode
              answers={answers}
              votes={votes}
              onVoteChange={handleVoteChange}
              requiredVotes={requiredVotes}
              mySubmittedAnswer={mySubmittedAnswer}
            />
          )}
        </>
      );

      dock = (
        <>
          <BallotSlots votes={votes} answers={answers} requiredVotes={requiredVotes} />
          {/* THE VALIDATION IS ON THE BUTTON, NOT IN AN alert(). "Please select
              answers for all 3 positions." was a modal system dialog standing in
              for a form that could simply say what is missing. */}
          <button
            type="button"
            className="plr-btn"
            onClick={handleSubmitVotes}
            disabled={filledVotes < requiredVotes}
          >
            {filledVotes < requiredVotes
              ? `Pick ${requiredVotes - filledVotes} more to submit`
              : 'Submit Votes'}
          </button>
        </>
      );
    } else {
      volume = 'rest';
      body = (
        <>
          <p className="plr-lab">Voting</p>
          <h1 className="plr-h1 plr-h1--primary">The responses are coming up.</h1>
          <p className="plr-lede plr-muted">
            This page will change on its own when the ballot is ready — you do not need to
            refresh it.
          </p>
        </>
      );
    }

  /* -------------------------------------------------------------- RESULTS -- */
  } else if (gameState.startsWith('RESULTS#')) {
    volume = 'watch';
    ctx = position ? `${position} · Results` : 'Results';

    /* THE PERSONAL HALF ONLY. The stage may never name a person, so the
       distribution of answers, the word cloud, the winning responses, the AI
       prompts and the leaderboard are room-wide and live there; which option
       YOU picked, what YOUR response earned and where YOU stand are
       person-specific and the stage cannot show them without breaking its own
       rule (§2.2). Neither surface is a smaller copy of the other. */
    const standing = playerScoreInfo?.rankDisplay
      ? `${playerScoreInfo.rankDisplay} of ${playerScoreInfo.totalPlayers}`
      : null;

    const scoreRows = (
      <>
        <hr className="plr-sep" />
        {/* `playerScoreInfo?.roundScore > 0` used to hide this line entirely
            when the round scored nothing, so the most common case for a wrong
            answer was silence where the explanation should be. It states +0. */}
        <div className="plr-stat">
          <span className="plr-k">This round</span>
          <span className="plr-v">+{playerScoreInfo?.roundScore ?? 0}</span>
        </div>
        <div className="plr-stat">
          <span className="plr-k">Total</span>
          <span className="plr-v">{playerScoreInfo?.totalScore ?? playerScore}</span>
        </div>
        {standing && (
          <div className="plr-stat">
            <span className="plr-k">Standing</span>
            <span className="plr-v">{standing}</span>
          </div>
        )}
      </>
    );

    if (gameType === 'trivia') {
      const keys = ['optionA', 'optionB', 'optionC', 'optionD', 'optionE', 'optionF']
        .filter((key) => currentQuestion?.[key]);

      /* THE FIVE-SPELLING CORRECT-ANSWER MATCH survives unchanged in substance:
         the payload's `correctAnswer` may be "OptionA", "A", the option text, or
         an array of any of those. That is a data problem wearing a UI costume
         and it is not this change's to fix — but the 13 console.log lines it
         emitted PER OPTION PER RENDER are gone. */
      const isCorrectKey = (key, index) => {
        const optionLetter = String.fromCharCode(65 + index);
        const optionId = `Option${optionLetter}`;
        const raw = currentQuestion?.correctAnswer;
        const candidates = (Array.isArray(raw) ? raw : [raw]).filter((a) => a != null);
        return candidates.some((correctAns) => {
          if (!correctAns) return false;
          if (correctAns === optionId
            || correctAns === optionLetter
            || correctAns === currentQuestion?.[key]) return true;
          if (typeof correctAns === 'string' && correctAns.startsWith('Option')) {
            const letter = correctAns.replace('Option', '');
            if (`option${letter}` === key || letter === optionLetter) return true;
          }
          if (typeof correctAns === 'string' && correctAns.length === 1 && /[A-F]/.test(correctAns)) {
            if (`option${correctAns}` === key || correctAns === optionLetter) return true;
          }
          return false;
        });
      };

      const playerAnswer = answers.find((answer) => (
        answer.name === playerName || answer.playerName === playerName || answer.player === playerName
      ));
      const playerAnswerValue = playerAnswer?.answer ?? mySubmittedAnswer;

      const rows = keys.map((key, index) => {
        const optionLetter = String.fromCharCode(65 + index);
        const optionId = `Option${optionLetter}`;
        return {
          key,
          letter: optionLetter,
          text: currentQuestion[key],
          correct: isCorrectKey(key, index),
          mine: playerAnswerValue === optionLetter
            || playerAnswerValue === optionId
            || playerAnswerValue === currentQuestion[key],
        };
      });

      const mine = rows.find((r) => r.mine);
      const correct = rows.find((r) => r.correct);
      const gotIt = !!(mine && mine.correct);

      /* TWO ROWS, NOT SIX. Re-rendering every option is more than "did I get it
         right" needs, and the whole distribution is the room's result — it is on
         the main screen. */
      const shown = [];
      if (mine && !gotIt) shown.push({ ...mine, flag: 'Your answer' });
      if (correct) shown.push({ ...correct, flag: gotIt ? 'Correct · yours' : 'Correct' });

      body = (
        <>
          <p className="plr-lab">You answered</p>
          <h1 className="plr-h1 plr-h1--primary">
            {mine ? `${mine.letter}. ` : ''}
            {mine ? (gotIt ? 'Correct.' : 'Not this time.') : 'No answer recorded.'}
          </h1>

          {/* A WRONG ANSWER IS NOT RED (§4.2). Red means destructive, only. The
              shipped screen used --danger plus a 16px ✗, which is a semantic
              error AND colour doing the work alone. The wrong row is muted and
              carries the WORDS "Your answer"; the correct row carries a 2px
              --success rule and the WORD "Correct". */}
          {shown.map((row) => (
            <div
              key={row.key}
              className={`plr-row${row.correct ? ' plr-row--correct' : ''}${row.mine && !row.correct ? ' plr-row--mine' : ''}`}
            >
              <span className="plr-k">{row.letter}</span>
              <span>{row.text}</span>
              <span className="plr-tail">
                <span className={`plr-flag${row.correct ? ' plr-flag--ok' : ''}`}>{row.flag}</span>
              </span>
            </div>
          ))}

          {scoreRows}
          <LookUpCue>
            How the whole room answered, and why{correct ? ` ${correct.letter}` : ''}, is on
            the main screen.
          </LookUpCue>
        </>
      );

    } else if (gameType === 'wavelength') {
      const playerAnswer = answers.find((answer) => (
        answer.name === playerName || answer.playerName === playerName || answer.player === playerName
      ));
      const words = (playerAnswer?.answer || mySubmittedAnswer || '')
        .split(',').map((w) => w.trim()).filter(Boolean);

      /* THE COMMON-WORDS LIST AND THE STATS BLOCK ARE CUT. The first is the
         word cloud re-derived on the phone, in a list, while the cloud itself is
         on the projector; the second is session telemetry rendered to
         participants. One small dataset was stated three ways on the smallest
         screen in the building. */
      body = (
        <>
          <p className="plr-lab">Your words</p>
          <h1 className="plr-h1 plr-h1--primary">
            {words.length ? `You sent ${words.length}.` : 'No words recorded.'}
          </h1>
          {words.length > 0 && (
            <div className="plr-words">
              {words.map((word, i) => <span key={i} className="plr-word">{word}</span>)}
            </div>
          )}
          {scoreRows}
          <LookUpCue>
            What the room shared — the cloud, and the words more than one of you reached
            for — is on the main screen.
          </LookUpCue>
        </>
      );

    } else {
      /* CALL-AND-ANSWER, POLL, SURVEY.

         WHICH NUMBERED RESPONSE WAS YOURS is the payoff of the entire anonymity
         feature and the phone did not mention it: the player saw a rank and a
         score and never learned which row was theirs. The number is the same one
         the ballot used, which is safe because vote indices map to array
         position — a reorder between VOTE and RESULTS would already be
         misattributing votes (§11.9).

         OPEN-QUESTIONS §3: a poll still shows a score, because that is what the
         code does. If a poll should not be scored, its results screen loses
         three of its four rows and needs a different personal payoff, which is
         a new design rather than a change here. */
      const myRow = ownAnswerIdx !== null && ownAnswerIdx !== undefined && answers[ownAnswerIdx]
        ? answers[ownAnswerIdx]
        : null;

      body = (
        <>
          <p className="plr-lab">Yours was</p>
          <h1 className="plr-h1">
            {myRow ? displayLabelFor(myRow, ownAnswerIdx) : 'Your response'}
          </h1>
          {(mySubmittedAnswer || myRow?.answer) && (
            <div className="plr-card">
              <p className="plr-quote">{mySubmittedAnswer || myRow.answer}</p>
            </div>
          )}
          {scoreRows}
          <LookUpCue>
            Names are on the main screen now. The top responses and the discussion prompts
            are up there too — <b>this page will not repeat them</b>.
          </LookUpCue>
        </>
      );
    }

  /* --------------------------------------------- LOBBY / BETWEEN ROUNDS -- */
  } else {
    volume = 'rest';
    centre = true;

    /* `lastRankRef.current > 0` ALREADY DISTINGUISHES "a round has happened"
       from "nothing has happened", with no new fetch (§11.2). Without it the
       longest and most valuable part of a session — the discussion between
       rounds — told every participant the game had not started. */
    const betweenRounds = lastRankRef.current > 0;

    body = betweenRounds ? (
      <>
        <p className="plr-lab">The round is closed</p>
        <h1 className="plr-h1 plr-h1--primary">Nothing to do here.</h1>
        <p className="plr-lede plr-muted">
          The next round starts when the host is ready. This page will change on its own —
          you do not need to refresh it.
        </p>
        {(playerScoreInfo || playerScore > 0) && (
          <>
            <hr className="plr-sep" />
            <div className="plr-stat">
              <span className="plr-k">Your total</span>
              <span className="plr-v">{playerScoreInfo?.totalScore ?? playerScore}</span>
            </div>
            {playerScoreInfo?.rankDisplay && (
              <div className="plr-stat">
                <span className="plr-k">Standing</span>
                <span className="plr-v">
                  {playerScoreInfo.rankDisplay} of {playerScoreInfo.totalPlayers}
                </span>
              </div>
            )}
          </>
        )}
        <LookUpCue>
          The discussion is on the main screen. <b>Join in</b> — this is the part the
          session is actually for.
        </LookUpCue>
      </>
    ) : (
      <>
        <p className="plr-lab">You&apos;re in</p>
        <h1 className="plr-h1 plr-h1--primary">Joined as {playerName}.</h1>
        {/* ONE STATEMENT OF "NOTHING IS HAPPENING", NOT THREE. The lobby said it
            as a heading, as a paragraph AND as an animated status pill — and the
            only moving element on the screen was the one that meant "do
            nothing", in the peripheral vision of a room that is supposed to be
            listening to somebody. */}
        <p className="plr-lede plr-muted">
          Waiting for the game to start. The host will begin the first round.
        </p>

        {engagementInfo.trim() && (
          <div className="plr-card">
            <p className="plr-lab">About this session</p>
            <p className="plr-quote">{engagementInfo}</p>
          </div>
        )}

        <div className="plr-card">
          <p className="plr-lab">If you lose this page</p>
          <p className="plr-quote">
            Go back to the join screen, enter <b>{gameId}</b> and the same name. Your
            answers and your score come back with you.
          </p>
        </div>

        <LookUpCue>
          Everything the room shares — the questions, the results, the discussion — is on
          the main screen. This page is only ever <b>your</b> half.
        </LookUpCue>
      </>
    );
  }

  return (
    <PlayerShell
      phase={phase}
      volume={volume}
      ctx={ctx}
      category={barCategory}
      who={playerName}
      online={wsConnected}
      banner={offlineBanner}
      centre={centre}
      dock={dock}
      /* Reading one response in full.

         MOUNTED ONCE, ONCE PER PAGE rather than once per view — `answers` is
         page state and the same list is on screen during VOTE and during
         RESULTS, so one mount serves both phases and there is one piece of
         open/closed state rather than two that can disagree.

         IT USED TO BE A SIBLING OF THE SHELL, which put it outside `.plr` and
         therefore outside both the dusk theme and every --plr-* token: a white
         card with #F6A94C-on-white Previous/Next buttons at 1.96:1, opening
         over a dusk ballot. `after` renders it inside the scope and after the
         dock, so `surfaceClassName` below has tokens to reach for.

         `surfaceClassName` RE-TINTS RATHER THAN FORKS. The dialog is the host's
         and `PastRound` uses it too; §10 of PlayerSurface.css re-points the
         handful of values styles.css hardcodes, the way `.qsets--onlight` does
         for the other polarity, so neither of the other two callers moves.

         `displayLabelFor`, not `stageLabelFor`: on a player's own device the
         row decides. The server has already redacted what this player may not
         see, and there is no projector here for a session setting to protect. */
      after={(
        <AnswerSpotlight
          answers={answers}
          index={spotlightIndex}
          onIndex={setSpotlightIndex}
          onClose={() => setSpotlightIndex(null)}
          labelFor={displayLabelFor}
          title="Response"
          surfaceClassName="plr-spot"
        />
      )}
    >
      {body}
    </PlayerShell>
  );
}

export default PlayerPage;
