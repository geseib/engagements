/**
 * What the Host Remote should offer, and when.
 *
 * The remote is a STANDALONE controller, not a proxy. It calls the same HTTP
 * endpoints the host toolbar calls, so it keeps working when the projector
 * browser is closed, reloading, or asleep — the same deal players get. (The old
 * remote posted window messages into an open host page; if that page was gone,
 * every button was a no-op with no feedback. See HostRemote.jsx for the history.)
 *
 * All of the decision-making lives here, as pure functions over the
 * `GET /games/{id}/state?includeHostData=true` payload, because the two things
 * that make a remote dangerous are both decisions, not rendering:
 *
 *   1. offering the WRONG advance for the phase — "Start Voting" on a trivia
 *      round pushes the room into a phase that game type does not have;
 *   2. saying everyone has responded when they have not — the host advances and
 *      somebody's answer is thrown away in front of the room.
 *
 * Both are unit-tested in __tests__/hostRemote.test.js against every
 * (gameType x phase) pair.
 */

import { gameTypeMeta, normalizeGameType } from './gameTypes';

/* ------------------------------------------------------------------ phases */

/** Phases the server actually writes into the STATE record. */
export const PHASES = ['CREATED', 'STARTED', 'ASK', 'VOTE', 'RESULTS', 'ENDED'];

/**
 * Split a server state string into a phase and a round number.
 *
 * Accepts the stored spellings (`ASK#001`, `VOTE#001`, `RESULTS#001`,
 * `CREATED`, `STARTED`, `ENDED`) and the WebSocket message spelling `RESULT#001`
 * — PlayerPage already has to accept both (see its `applyGameState`), so the
 * remote must not be the one surface that disagrees.
 *
 * Anything else — null, undefined, `{}`, a half-loaded payload — comes back as
 * UNKNOWN rather than throwing. A remote that white-screens mid-session is
 * worse than a remote that says "waiting for the game".
 */
export function parseGamePhase(state) {
  const raw = typeof state === 'string' ? state.trim() : '';
  if (!raw) return { phase: 'UNKNOWN', round: null, raw: '' };

  const round = raw.match(/^(ASK|VOTE|RESULTS?)#(\d+)$/i);
  if (round) {
    const phase = round[1].toUpperCase() === 'RESULT' ? 'RESULTS' : round[1].toUpperCase();
    return { phase, round: parseInt(round[2], 10), raw };
  }

  const bare = raw.toUpperCase();
  if (bare === 'CREATED' || bare === 'STARTED' || bare === 'ENDED') {
    return { phase: bare, round: null, raw };
  }

  return { phase: 'UNKNOWN', round: null, raw };
}

/**
 * Does this game type run a VOTE phase between ASK and RESULTS *at runtime*?
 *
 * DIVERGENCE, deliberate: config/gameTypes.js lists wavelength's phases as
 * ['ASK', 'VOTE', 'RESULTS'], but GameHostPage.handleFinishQuestion sends BOTH
 * trivia and wavelength straight to results, and handleShowResults skips the
 * "have they all voted?" check for both. Wavelength renders a word cloud; there
 * is nothing to vote on.
 *
 * The remote drives the same transitions as the host toolbar, so it has to
 * follow the running code, not the config table — offering "Start Voting" on a
 * wavelength round would put the room into a phase the host screen never shows.
 * The config is what should change; until it does, the divergence is pinned by a
 * test so fixing one without the other cannot pass silently.
 */
/**
 * Kept as documentation of what the RUNNING code special-cases, and asserted
 * against the config below. It is no longer an override: `GAME_TYPES[].phases`
 * used to claim wavelength ran a vote phase (it never has) and that survey did
 * not (it does), so this list existed to correct the table. The table has since
 * been corrected, and having a second answer to "does this type vote?" is what
 * let the two drift apart unnoticed in the first place.
 */
export const TYPES_WITH_NO_VOTE_AT_RUNTIME = ['trivia', 'wavelength'];

export function runsVotePhase(gameType) {
  return gameTypeMeta(normalizeGameType(gameType)).phases.includes('VOTE');
}

/* ----------------------------------------------------------------- actions */

/**
 * The three transitions the remote can drive, in the vocabulary of the
 * endpoints that perform them.
 *
 * `confirmWhenIncomplete` marks the actions that throw away in-flight input if
 * fired early: leaving ASK abandons whoever is still typing, leaving VOTE
 * abandons whoever is still voting. Moving on from RESULTS discards nothing, so
 * it does not earn the extra tap — friction everywhere is friction nowhere.
 */
export const ACTIONS = {
  next: {
    id: 'next',
    label: 'Next Round',
    icon: 'ArrowRight',
    confirmWhenIncomplete: false,
  },
  vote: {
    id: 'vote',
    label: 'Start Voting',
    icon: 'ListChecks',
    confirmWhenIncomplete: true,
  },
  results: {
    id: 'results',
    label: 'Show Results',
    icon: 'ChartLineUp',
    confirmWhenIncomplete: true,
  },
  /**
   * RESULTS' second beat: the AI's read-back of the round.
   *
   * Same id, label and icon as the stage's own control
   * (config/hostControls.js:190-198) — deliberately, because they are one
   * button on two devices. The remote used to skip this beat entirely and
   * offer "Next Round" from RESULTS, so the phone and the projector disagreed
   * about how many beats a round's results have.
   *
   * Discards nothing, so it never earns the second tap.
   */
  fieldNotes: {
    id: 'field-notes',
    label: 'What We Heard',
    icon: 'Sparkle',
    confirmWhenIncomplete: false,
  },
};

// The beat vocabulary itself lives in config/hostControls.js (STAGE_BEATS),
// which owns the stage's phases and the FIELD_NOTES intent. Deliberately NOT
// redeclared here: this module's own history is a cautionary tale about
// carrying a second answer to a question another module already answers — see
// TYPES_WITH_NO_VOTE_AT_RUNTIME above, which drifted from the config table and
// had to be demoted to documentation.

/**
 * The one button that should be big and at the bottom of the screen.
 *
 * @param stageBeat which beat of RESULTS the SERVER says is showing, from
 *        `get-game-state`'s `stageBeat`. Only consulted inside RESULTS; a beat
 *        left over from a previous round must never rewrite the ASK or VOTE
 *        control, so the check lives inside the phase, not above the switch.
 *
 * @returns an ACTIONS entry with a phase-specific `label`, or null when there
 *          is nothing to advance to (the game has ended, or the state is not
 *          one we recognise — in which case we would rather show nothing than
 *          guess and fire the wrong transition).
 */
export function primaryAction(state, gameType, stageBeat) {
  const { phase } = parseGamePhase(state);

  switch (phase) {
    // No round has been dealt yet. `next-question` accepts CREATED and STARTED,
    // so the same endpoint that advances also opens.
    case 'CREATED':
    case 'STARTED':
      return { ...ACTIONS.next, label: 'Start First Round' };

    case 'ASK':
      return runsVotePhase(gameType) ? { ...ACTIONS.vote } : { ...ACTIONS.results };

    case 'VOTE':
      return { ...ACTIONS.results };

    // Two beats, in order: the tally, then the read-back, then out.
    //
    // Compared against the ONE value rather than tested for truthiness: the
    // server sends an explicit 'results' for a round nobody has moved, and a
    // truthy check would read that as "already past the read-back" and skip the
    // beat — which is the defect this whole path exists to fix.
    case 'RESULTS':
      return stageBeat === 'field-notes'
        ? { ...ACTIONS.next, label: `Next ${roundNounFor(gameType)}` }
        : { ...ACTIONS.fieldNotes };

    case 'ENDED':
    case 'UNKNOWN':
    default:
      return null;
  }
}

/** "Next Round" / "Next Question" / "Next Subject" — the game type's own noun. */
function roundNounFor(gameType) {
  return gameTypeMeta(gameType).roundNoun || 'Round';
}

/**
 * Abandoning the current round without resolving it.
 *
 * Kept OFF the primary control on purpose. It is the only action here that can
 * lose a round outright, and — unlike the ordinary advance — it is not
 * idempotent server-side: `action: 'skip'` bypasses next-question.js's
 * "already asking a question" guard, so two skips in flight really do consume
 * two questions and show one.
 */
export function skipAction(state) {
  const { phase } = parseGamePhase(state);
  if (phase !== 'ASK' && phase !== 'VOTE') return null;
  return {
    id: 'skip',
    label: 'Skip This Round',
    icon: 'SkipForward',
    destructive: true,
    confirmAlways: true,
  };
}

/**
 * Endpoint + body for an action id. Paths are relative to `window.API_BASE`,
 * which already carries its trailing slash.
 *
 * `round` is the CURRENT round number, as `state` reports it. start-vote and
 * get-results both address a specific round, so a remote that guessed the round
 * could resolve the wrong one; passing null for those is treated as "not ready"
 * rather than defaulting to 1.
 */
export function requestFor(actionId, { gameId, round } = {}) {
  if (!gameId) return null;

  switch (actionId) {
    case 'next':
      return { path: `games/${gameId}/next-question`, body: {} };

    case 'skip':
      return { path: `games/${gameId}/next-question`, body: { action: 'skip' } };

    case 'vote':
      if (!round) return null;
      return { path: `games/${gameId}/start-vote`, body: { questionNumber: round } };

    // Closing the round. This is the host-only half of the results handler:
    // POST /games/get-results stays public so players can READ a resolved
    // round, while the transition — the state write, the anonymity reveal, the
    // scoring, the broadcast — lives behind the Cognito authorizer on
    // /close-round. Matches GameHostPage.handleShowResults, and the remote is
    // behind ProtectedRoute so the host already holds a token.
    case 'results':
      if (!round) return null;
      return { path: `games/${gameId}/close-round`, body: { questionNumber: round } };

    // The stage beat. Round-addressed like the two above, and for the same
    // reason: the beat is written on ROUND#nnn, so guessing the round would set
    // it on a round that is not on screen — the phone would show the beat as
    // taken and the projector would never move.
    //
    // Behind the Cognito authorizer (template-clean.yaml), like close-round.
    case 'field-notes':
      if (!round) return null;
      return {
        path: `games/${gameId}/stage-beat`,
        body: { beat: 'field-notes', questionNumber: round },
      };

    default:
      return null;
  }
}

/* ---------------------------------------------------------------- progress */

/**
 * "Can I move on yet?" — answered from the server's own tally.
 *
 * get-game-state.js already computes this, and crucially it DEDUPLICATES
 * players by name before counting (one person who rejoined has several PLAYER#
 * rows; counting rows would set a target the room can never hit and the badge
 * would never go green). We read its numbers rather than recounting, so the
 * remote and the host screen can never disagree about whether the room is done.
 *
 * It only publishes `answerProgress` during ASK# and `votingProgress` during
 * VOTE#, so outside those phases there is genuinely nothing to wait for and
 * `kind` is null.
 *
 * `allIn` demands total > 0: an empty room is not "everyone has answered", it
 * is a room with nobody in it, and a green badge there would be a lie that
 * costs a round.
 */
export function roundProgress(stateResponse) {
  const payload = stateResponse && typeof stateResponse === 'object' ? stateResponse : {};
  const { phase } = parseGamePhase(payload.state);

  let source = null;
  let kind = null;
  let verb = '';

  if (phase === 'ASK' && isProgress(payload.answerProgress)) {
    source = payload.answerProgress;
    kind = 'answers';
    verb = 'answered';
  } else if (phase === 'VOTE' && isProgress(payload.votingProgress)) {
    source = payload.votingProgress;
    kind = 'votes';
    verb = 'voted';
  }

  if (!source) {
    return { kind: null, received: 0, total: 0, allIn: false, applicable: false, label: '' };
  }

  const total = countOf(source.totalPlayers);
  // Received can legitimately exceed total: the tally counts answer rows while
  // the target counts deduplicated players. Clamp for display so the room never
  // reads "15 of 14".
  const received = Math.min(countOf(kind === 'votes' ? source.votesReceived : source.answersReceived), total);
  const allIn = total > 0 && received >= total;

  return {
    kind,
    received,
    total,
    allIn,
    applicable: true,
    label: total > 0 ? `${received} of ${total} ${verb}` : `Nobody has ${verb} yet`,
  };
}

function isProgress(value) {
  return !!value && typeof value === 'object';
}

function countOf(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/**
 * Does firing the primary action right now need the deliberate second tap?
 *
 * Yes exactly when the action would discard responses that are still coming in.
 * When the room is done, one tap — the host is standing in front of people and
 * an extra tap on the expected beat reads as a broken button.
 */
export function needsConfirmation(action, progress) {
  if (!action) return false;
  if (action.confirmAlways) return true;
  if (!action.confirmWhenIncomplete) return false;
  if (!progress || !progress.applicable) return false;
  return !progress.allIn;
}

/* ---------------------------------------------------------- waiting list */

/**
 * Who the room is still waiting for, by name.
 *
 * The owner's ruling, verbatim: *"so they could call out 'hey George, we are
 * waiting on you'"*. The phone is the only surface allowed to name people —
 * `17-remote.html` prints the argument next to the list, and the remote prints
 * it too: **who has not acted yet is a different fact from who wrote what**.
 * `message.js:592-614` states the project's anonymity rule in exactly those
 * terms, and `get-players.js` never returns answer text, so this list is on the
 * allowed side of it.
 *
 * Reads `hasAnswered` / `hasVoted`, NOT `isReady`. get-players computes
 * `isReady` per phase — `hasAnswered` during ASK, `hasVoted` during VOTE, and
 * literally `true` for everyone during RESULTS — so a filter on it is right in
 * one phase by accident and wrong in the rest.
 *
 * `GET /games/{id}/players` was already being polled every six seconds and its
 * array thrown away for a single count. No new endpoint; just stop discarding.
 *
 * @returns { applicable, heading, verb, names } — `applicable: false` outside
 *          ASK/VOTE, where nobody is being waited for and get-players reports
 *          `hasVoted: false` for the whole room, which would otherwise render
 *          as "the entire room is holding us up" on the results screen.
 */
export function waitingOn(rosterResponse, state) {
  const { phase } = parseGamePhase(state);

  const field = phase === 'ASK' ? 'hasAnswered' : phase === 'VOTE' ? 'hasVoted' : null;
  if (!field) {
    return { applicable: false, heading: '', verb: '', names: [] };
  }

  const payload = rosterResponse && typeof rosterResponse === 'object' ? rosterResponse : {};
  const players = Array.isArray(payload.players) ? payload.players : [];

  const names = players
    // A row with no readiness block has not been seen to act, so it stays in
    // the list. Dropping it would quietly under-report who the room is waiting
    // for, which is the one thing this list must not do.
    .filter((player) => player && typeof player === 'object' && !player.readiness?.[field])
    .map((player) => player.playerName || player.PlayerName || '')
    // A row with no name cannot be called out, so it is not a chip.
    .filter(Boolean);

  return phase === 'ASK'
    ? { applicable: true, heading: 'Still to answer', verb: 'answered', names }
    : { applicable: true, heading: 'Still to vote', verb: 'voted', names };
}

/* ----------------------------------------------------------- field notes */

/**
 * The AI read-back, normalised for the phone.
 *
 * Reads the SERVER's names. `GET /games/{id}/ai-summary` returns
 * `summary` / `summaryText` / `discussionQuestions` / `nextSteps`;
 * GameHostPage renames `discussionQuestions` → `discussionTopics` on the way
 * into its own state (GameHostPage.jsx:775), and copying that name here would
 * read a field the endpoint has never emitted — a headline with nothing under
 * it, silently.
 *
 * `summary` is absent from the freshly generated response
 * (get-ai-summary.js:1113-1116) and present only on the cached read (:568), so
 * both are consulted. That difference bites in exactly the moment this is
 * used: the first time a round closes.
 *
 * `ready: false` covers the endpoint's 404 `{ status: 'not_ready' }`, which is
 * the normal state for the first second or two of RESULTS.
 */
export function fieldNotesFrom(summaryResponse) {
  const payload = summaryResponse && typeof summaryResponse === 'object' ? summaryResponse : {};

  const lead = textOf(payload.summary) || textOf(payload.summaryText);
  const topics = listOf(payload.discussionQuestions);
  const nextSteps = listOf(payload.nextSteps);

  return {
    ready: !!(lead || topics.length || nextSteps.length),
    lead,
    topics,
    nextSteps,
  };
}

function textOf(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * The parser's fallback paths can leave an unparsed section as a bare string
 * rather than a list, and a blank entry renders as an empty numbered row.
 */
function listOf(value) {
  if (!Array.isArray(value)) return [];
  return value.map(textOf).filter(Boolean);
}

/**
 * One line describing where the session is, for the status card.
 * Never throws, never renders "undefined".
 */
export function phaseSummary(stateResponse) {
  const payload = stateResponse && typeof stateResponse === 'object' ? stateResponse : {};
  const { phase, round } = parseGamePhase(payload.state);
  const gameType = payload.gameType || payload.gameMetadata?.gameType;
  const noun = roundNounFor(gameType);

  switch (phase) {
    case 'CREATED':
      return { phase, headline: 'Not started', detail: 'Players can join now' };
    case 'STARTED':
      return { phase, headline: 'Ready', detail: 'No round dealt yet' };
    case 'ASK':
      return { phase, headline: `${noun} ${round}`, detail: 'Collecting responses' };
    case 'VOTE':
      return { phase, headline: `${noun} ${round}`, detail: 'Voting' };
    case 'RESULTS':
      return { phase, headline: `${noun} ${round}`, detail: 'Showing results' };
    case 'ENDED':
      return { phase, headline: 'Session over', detail: 'All rounds played' };
    default:
      return { phase: 'UNKNOWN', headline: 'Waiting…', detail: 'No game state yet' };
  }
}
