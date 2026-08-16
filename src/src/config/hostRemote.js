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
import { rosterRows } from './setupPanel';

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

/* ------------------------------------------------------ choosing a question */

const OPTION_KEYS = [
  ['optionA', 'OptionA'], ['optionB', 'OptionB'], ['optionC', 'OptionC'],
  ['optionD', 'OptionD'], ['optionE', 'OptionE'], ['optionF', 'OptionF'],
];
const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

function firstOf(source, ...names) {
  for (const name of names) {
    const value = source[name];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
}

/**
 * Which option the set says is right, as a 0-based index — or null.
 *
 * THREE SPELLINGS, because sets in the wild carry all three. CLAUDE.md mandates
 * `"OptionB"`; the builders have also written a bare letter, and
 * config/setupPanel.js records that sets record the option's own TEXT "as often
 * as they record it as OptionB" — that observation is the entire reason the
 * STAGE browser refuses to carry options at all.
 *
 * NULL, not a guess, when none of the three match. A wrong CORRECT flag on the
 * host's own phone is worse than no flag: the host reads it out.
 */
export function correctOptionIndex(question = {}) {
  const raw = firstOf(question, 'correctAnswer', 'CorrectAnswer');
  if (typeof raw !== 'string') return null;
  const answer = raw.trim();
  if (!answer) return null;

  const named = answer.match(/^option\s*([A-F])$/i);
  if (named) return LETTERS.indexOf(named[1].toUpperCase());

  if (/^[A-F]$/i.test(answer)) return LETTERS.indexOf(answer.toUpperCase());

  const needle = answer.toLowerCase();
  const byText = OPTION_KEYS.findIndex((names) => {
    const text = firstOf(question, ...names);
    return typeof text === 'string' && text.trim().toLowerCase() === needle;
  });
  return byText === -1 ? null : byText;
}

/**
 * One row of the PHONE's question browser.
 *
 * DELIBERATELY UNLIKE `browserRow` in config/setupPanel.js, which strips the
 * options. That asymmetry is the point of this surface: the stage browser is on
 * a screen the room can read over the host's shoulder, so it may only say what a
 * question is ABOUT. The phone is in the host's hand, so it says what the
 * question SAYS — the four options and which one is right. `17-remote.html`
 * prints the argument next to the list and this module prints it too.
 */
export function remoteQuestionRow(question = {}) {
  const correct = correctOptionIndex(question);

  const options = OPTION_KEYS
    .map((names, index) => {
      const text = firstOf(question, ...names);
      return typeof text === 'string' && text.trim()
        ? { letter: LETTERS[index], text: text.trim(), correct: index === correct }
        : null;
    })
    .filter(Boolean);

  return {
    id: firstOf(question, 'id', 'Id', 'questionId'),
    title: firstOf(question, 'title', 'Title') || '',
    detail: firstOf(
      question,
      'questionDetail', 'QuestionDetail', 'detail', 'Detail',
      'customInstructions', 'CustomInstructions',
    ) || '',
    category: firstOf(question, 'category', 'Category') || '',
    difficulty: firstOf(question, 'difficulty', 'Difficulty') || '',
    options,
    // The set claims an answer this row could not place. Said out loud rather
    // than silently dropped, because the host is about to read the options to a
    // room and needs to know the phone cannot help with this one.
    answerUnresolved: options.length > 0 && correct === null,
  };
}

/** Title search, the one filter `17-remote.html` draws. */
export function filterRemoteRows(rows = [], search = '') {
  const needle = String(search || '').trim().toLowerCase();
  if (!needle) return rows;
  return rows.filter((row) => (row.title || '').toLowerCase().includes(needle));
}

/**
 * "Ask this next" — the same two-action dance `GameHostPage.selectQuestion`
 * does, and for its reason: `next-question.js:473` refuses to advance out of
 * ASK#, so choosing a question mid-round has to say `skip_to_specific` or the
 * tap returns 200 and nothing moves.
 */
export function askNextRequest({ gameId, questionId, state } = {}) {
  if (!gameId || !questionId) return null;
  const { phase } = parseGamePhase(state);
  const mid = phase === 'ASK' || phase === 'VOTE';
  return {
    path: `games/${gameId}/next-question`,
    body: { questionId, action: mid ? 'skip_to_specific' : 'select_specific' },
  };
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

/* ------------------------------------------------- the session panel */

/**
 * The remote's three lists, named by the owner:
 *
 *   *"it would be nice if it had the same menu as the main screen with listing
 *    the players, the rounds, the questions. can this just be a mobile friendly
 *    version of the session tab?"*
 *
 * THE IDS ARE THE DESKTOP PANEL'S IDS, deliberately — `config/setupPanel.js`'s
 * `setupPanelTabs()` calls the rounds tab `history` and labels it `Rounds`, and
 * the two surfaces showing the same list under two internal names is how they
 * drift. Not a re-export of that function, because the two menus genuinely
 * differ in two ways that a shared list would have to encode as options:
 *
 *   SETTINGS IS ABSENT. Everything in the desktop's fourth tab already has a
 *   home on this phone — the join QR, the categories, the big-screen pad and
 *   Switch game are the round view's `Session` card, one tap away and visible
 *   without opening anything. A fourth tab would be a second door to controls
 *   the host is already looking at.
 *
 *   ROUNDS COMES SECOND, where the desktop puts Questions there. The owner's
 *   own order ("the players, the rounds, the questions") and the fact that this
 *   surface has a dedicated `Choose next question` button on the round view
 *   point the same way: Questions is the tab with another way in, so it is the
 *   one that can afford to be last.
 */
export function remotePanelTabs() {
  return [
    { id: 'players', label: 'Players' },
    { id: 'history', label: 'Rounds' },
    { id: 'questions', label: 'Questions' },
  ];
}

/**
 * EVERY PLAYER IN THE ROOM, for the phone's Players tab.
 *
 *   *"it no longer list the players that joined in the beginning"*
 *
 * The names have been in this component's memory since `pollRoster` stopped
 * throwing the array away (see HostRemote.jsx's KEEP THE ARRAY note), but the
 * only thing reading them was `waitingOn`, which is scoped to ASK and VOTE. In
 * the lobby — the phase the owner is describing — nothing on this phone has
 * ever printed a name; the status card counts the room and stops there.
 *
 * ROWS COME FROM `config/setupPanel.js:rosterRows`, THE DESKTOP SESSION TAB'S
 * OWN FUNCTION, and that reuse is the point of the request: "the same menu as
 * the main screen" has to mean the same rows, in the same order, with the same
 * ranks and the same per-round tick, or the two screens will disagree in front
 * of a room. All this does is adapt `GET /games/{id}/players` onto the shape
 * that function already takes — the desktop is fed by the host page's socket
 * state (`players`, `playersWhoAnswered`, `playersWhoVoted`), the phone by the
 * roster payload's `totalScore` and `readiness`.
 *
 * THE POLARITY IS THE DESKTOP'S, NOT THE STAGE'S, AND THE DIFFERENCE IS
 * DELIBERATE. `components/stage/RoomMeter.jsx` may never name who HAS answered
 * — a projector turns that into a participation league table, and
 * `USER-REVIEWS.md` rejected exactly that. This list does carry the tick, for
 * the same reason the desktop's does: the owner ruled on it there (*"the
 * anonymity is just for preventing people voting for an answer based on who
 * said it. thats it."*), and this surface is strictly more private than the one
 * he ruled it onto — a phone in one hand rather than a panel over the stage.
 * The one thing neither surface carries is what anybody WROTE, and `get-players`
 * does not return answer text at all.
 *
 * `kind` says which set the list is, in the markup rather than in the copy —
 * `RoomMeter`'s `data-list-kind` idiom, and for its reason: a list of joiners
 * under a waiting caption is an accusation, and a caption is not something a
 * test can hold on to.
 *
 *   'joined'   the lobby. Nobody is late to a round that has not started, so
 *              there is no tick and the heading is the lobby's own word.
 *   'everyone' a running session: the whole room, with each person's rank,
 *              score, and — inside ASK or VOTE — whether they have acted.
 */
export function rosterListing(rosterResponse, state) {
  const { phase } = parseGamePhase(state);
  // UNKNOWN counts as the lobby because it is what a state poll that has not
  // landed yet looks like, and the roster poll can land first. Nothing has been
  // asked of anyone in either case, which is exactly what 'joined' means; the
  // alternative would flash a tick column that has nothing to say.
  const lobby = phase === 'CREATED' || phase === 'STARTED' || phase === 'UNKNOWN';

  const payload = rosterResponse && typeof rosterResponse === 'object' ? rosterResponse : {};
  const players = Array.isArray(payload.players) ? payload.players : [];

  const people = players
    .filter((player) => player && typeof player === 'object')
    .map((player) => ({
      name: player.playerName || player.PlayerName || '',
      // `totalScore` is get-players' spelling; `score` is what the host page
      // keeps. Both are accepted so one adapter serves either payload.
      score: Number(player.totalScore ?? player.score) || 0,
      answered: !!player.readiness?.hasAnswered,
      voted: !!player.readiness?.hasVoted,
    }))
    // A row with no name cannot be listed, and `rosterRows` would print it as
    // "Unknown Player" — a ghost in the count the host cannot account for.
    .filter((player) => player.name);

  const rows = rosterRows({
    players: people.map(({ name, score }) => ({ name, score })),
    // `rosterRows` calls `.startsWith` on this, so a non-string state — a
    // half-loaded poll — must arrive as '' rather than as undefined.
    gameState: typeof state === 'string' ? state : '',
    playersWhoAnswered: people.filter((p) => p.answered).map((p) => p.name),
    playersWhoVoted: people.filter((p) => p.voted).map((p) => p.name),
  });

  return {
    kind: lobby ? 'joined' : 'everyone',
    heading: rosterHeading(rows.length, lobby),
    rows,
  };
}

/**
 * The line over the names.
 *
 * "Already joined" is `RoomMeter`'s lobby word, chosen there because it cannot
 * be read as a waiting list under any stress — and the same phrase on both
 * surfaces is one less thing for a host to translate mid-session. The count
 * rides with it because that is the number the status card was showing a moment
 * ago, and a list that disagrees with the count above it reads as broken.
 */
function rosterHeading(count, lobby) {
  if (count === 0) return 'Nobody has joined yet';
  const people = `${count} ${count === 1 ? 'player' : 'players'}`;
  return lobby ? `Already joined · ${people}` : people;
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
