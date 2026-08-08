/**
 * What the host can do RIGHT NOW, for every (game type × phase) pair.
 *
 * The bug this module exists to kill: the host's advance control lived inline,
 * four separate times, at the *bottom* of whatever the round happened to
 * render — after a 250px decorative hero, after the player grid, after a long
 * question or a full results list. Measured on a 1280×800 laptop the "Next
 * Question" button sat 2845px down the document: the host had to scroll ~2000px
 * to move a live room forward. Scrolling to READ is fine. Scrolling to ACT is
 * not.
 *
 * So the *decision* ("which single action advances this round, is it allowed
 * yet, and what should the room's progress line say") lives here as pure data,
 * and exactly one piece of chrome renders it — components/HostActionBar.jsx.
 * Adding a phase or a game type means adding it here, and
 * `__tests__/hostControls.test.js` fails if any pair stops yielding exactly one
 * primary action, so "this type has no way forward" cannot ship quietly.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️  The runtime phase graph deliberately DISAGREES with `GAME_TYPES[].phases`
 * in config/gameTypes.js. That table says wavelength runs ASK→VOTE→RESULTS and
 * survey runs ASK→RESULTS. `GameHostPage.handleFinishQuestion()` does the
 * opposite for both: it special-cases `trivia` and `wavelength` to skip voting,
 * and everything else (call-and-answer, poll, **survey**) goes through
 * start-vote. `hasVotePhase()` is currently only read by a test, so nothing
 * enforces the table — which is exactly why a "one size fits all" control bar
 * built from `phases` would have been wrong for two of the five types.
 *
 * This module encodes what the host code ACTUALLY does. Reconciling the two is
 * a separate change (it touches gameTypes.js and the survey/wavelength backend
 * flows); until then `hostRunsVotePhase()` is the single honest answer.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { normalizeGameType } from './gameTypes';
import { statusTone } from '../utils/statusTone';

/** Host-facing phases, in the order a round moves through them. */
export const HOST_PHASES = ['LOBBY', 'ASK', 'VOTE', 'RESULTS'];

/**
 * Types whose ASK jumps straight to RESULTS.
 * Mirrors the `currentGameType === 'trivia' || currentGameType === 'wavelength'`
 * branch in handleFinishQuestion() / handleShowResults().
 */
const TYPES_THAT_SKIP_VOTE = new Set(['trivia', 'wavelength']);

/** Does the host code open a VOTE phase for this type? */
export function hostRunsVotePhase(type) {
  return !TYPES_THAT_SKIP_VOTE.has(normalizeGameType(type));
}

/** The phases a round of this type actually passes through, in order. */
export function hostPhaseSequence(type) {
  return hostRunsVotePhase(type)
    ? ['LOBBY', 'ASK', 'VOTE', 'RESULTS']
    : ['LOBBY', 'ASK', 'RESULTS'];
}

/**
 * Map a raw game state (`CREATED`, `STARTED`, `ASK#003`, `VOTE#003`,
 * `RESULTS#003`, `voting`, …) onto a host phase.
 *
 * Anything that is not an explicit ASK/VOTE/RESULTS marker is the lobby — the
 * same rule as GameHostPage's `isWaitingState()`, kept here so the bar and the
 * page can never disagree about which phase is on screen.
 */
export function phaseOfGameState(gameState) {
  const state = String(gameState ?? '');
  if (state.startsWith('ASK#')) return 'ASK';
  if (state.startsWith('VOTE#')) return 'VOTE';
  if (state.startsWith('RESULTS#')) return 'RESULTS';
  return 'LOBBY';
}

/**
 * Actions the bar can ask the page to run. The page owns the handlers; this
 * module only ever names one.
 */
export const HOST_INTENTS = {
  START: 'start',      // handleNextQuestion(false) — first round of the game
  FINISH: 'finish',    // handleFinishQuestion()   — close answering
  REVEAL: 'reveal',    // handleShowResults()      — close voting
  NEXT: 'next',        // handleNextQuestion(false)
  SKIP: 'skip',        // handleNextQuestion(true) — abandon this round
};

function primaryFor(phase, { runsVote, roundNoun, playerCount, answerCount, hasQuestionSet }) {
  switch (phase) {
    case 'LOBBY': {
      let hint = '';
      if (!hasQuestionSet) hint = 'Choose a question set in Game Info first';
      else if (playerCount === 0) hint = 'At least one player has to join first';
      return {
        id: 'start',
        label: `Start First ${roundNoun}`,
        icon: 'PlayCircle',
        intent: HOST_INTENTS.START,
        disabled: !hasQuestionSet || playerCount === 0,
        hint,
      };
    }
    case 'ASK':
      return runsVote
        ? {
            id: 'open-vote',
            label: 'Start Voting',
            icon: 'ListChecks',
            intent: HOST_INTENTS.FINISH,
            disabled: answerCount === 0,
            hint: answerCount === 0 ? 'Nobody has answered yet' : '',
          }
        : {
            id: 'reveal-from-ask',
            label: 'Show Results',
            icon: 'ChartBar',
            intent: HOST_INTENTS.FINISH,
            disabled: answerCount === 0,
            hint: answerCount === 0 ? 'Nobody has answered yet' : '',
          };
    case 'VOTE':
      // Reached legitimately by call-and-answer / poll / survey. A no-vote type
      // should never land here, but if bad data puts it here the host still
      // gets a way out rather than a dead screen.
      return {
        id: 'reveal',
        label: 'Show Results',
        icon: 'ChartBar',
        intent: HOST_INTENTS.REVEAL,
        disabled: false,
        hint: '',
      };
    case 'RESULTS':
    default:
      return {
        id: 'next',
        label: `Next ${roundNoun}`,
        icon: 'ArrowRight',
        intent: HOST_INTENTS.NEXT,
        disabled: false,
        hint: '',
      };
  }
}

function statusTextFor(phase, { playerCount, answeredCount, votedCount, hasQuestionSet }) {
  switch (phase) {
    case 'LOBBY':
      if (!hasQuestionSet) return 'Please select a question set to begin';
      if (playerCount === 0) return 'Waiting for players to join…';
      return `${playerCount} player${playerCount === 1 ? '' : 's'} ready`;
    case 'ASK':
      if (playerCount === 0) return 'Waiting for players to join…';
      return answeredCount >= playerCount
        ? `All ${playerCount} answered`
        : `${answeredCount} of ${playerCount} answered…`;
    case 'VOTE':
      if (playerCount === 0) return 'Waiting for players to join…';
      return votedCount >= playerCount
        ? `All ${playerCount} voted`
        : `${votedCount} of ${playerCount} voted…`;
    case 'RESULTS':
    default:
      return 'Results are on screen';
  }
}

/**
 * The complete control descriptor for the current moment.
 *
 * Always returns exactly one `primary`. `secondary` is at most one action and
 * only exists where abandoning the round is meaningful (mid-answer).
 *
 * @returns {{phase: string, primary: object, secondary: object|null,
 *            status: {text: string, tone: string}}}
 */
export function hostControlsFor({
  gameType,
  phase,
  roundNoun = 'Question',
  playerCount = 0,
  answeredCount = 0,
  votedCount = 0,
  answerCount = 0,
  hasQuestionSet = true,
} = {}) {
  const resolvedPhase = HOST_PHASES.includes(phase) ? phase : 'LOBBY';
  const runsVote = hostRunsVotePhase(gameType);
  const noun = String(roundNoun || 'Question').trim() || 'Question';

  const primary = primaryFor(resolvedPhase, {
    runsVote, roundNoun: noun, playerCount, answerCount, hasQuestionSet,
  });

  // One escape hatch, in the one phase where the host may want to abandon a
  // round that is not going anywhere. Everywhere else a second button would
  // just be another thing to aim at while a room watches.
  const secondary = resolvedPhase === 'ASK'
    ? { id: 'skip', label: `Skip ${noun}`, icon: 'SkipForward', intent: HOST_INTENTS.SKIP, disabled: false, hint: '' }
    : null;

  const text = statusTextFor(resolvedPhase, {
    playerCount, answeredCount, votedCount, hasQuestionSet,
  });

  return {
    phase: resolvedPhase,
    primary,
    secondary,
    status: { text, tone: statusTone(text) },
  };
}

export default hostControlsFor;
