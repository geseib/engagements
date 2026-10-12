/**
 * THE ROUND'S WORDS (docs/design/simplify-round/PRINCIPLES.md R6): the one
 * place a label, status line or participant line for a live round is written.
 * The host page's dock and the Host Remote both read their labels through
 * config/roundStep.js, which reads them from here, so the two surfaces cannot
 * spell one act two ways (R1). `buildroom/words.js` is the precedent.
 *
 * Rules (tested in __tests__/roundWords.test.js): sentence case, plain words,
 * no exclamation marks, no emoji, and "phone, laptop or tablet" whenever the
 * copy speaks about the room's devices.
 *
 * The round noun is the set's own (`roundNoun`: Lesson, Question, Subject),
 * then the game type's. It is lower-cased after a verb: "Next lesson".
 */

export const deviceWords = 'phone, laptop or tablet';

/** "Lesson" -> "lesson"; blank -> "round". */
export function nounOf(noun) {
  const text = String(noun ?? '').trim();
  return text ? text.toLowerCase() : 'round';
}

const plural = (n, one, many) => (Number(n) === 1 ? one : many);

const RW = Object.freeze({
  // ── Primaries and secondaries ─────────────────────────────────────────
  /** The lobby's primary. "Start round 1" / "Start lesson 1". */
  startFirst: (noun) => `Start ${nounOf(noun)} 1`,
  startVoting: 'Start voting',
  showResults: 'Show results',
  whatWeHeard: 'What we heard',
  nextPage: 'Next page',
  backPage: 'Back a page',
  nextRound: (noun) => `Next ${nounOf(noun)}`,
  skipRound: (noun) => `Skip this ${nounOf(noun)}`,
  /** RESULTS' secondary: the first response of N, in tally order. */
  showResponse: (i, n) => `Show response ${i} of ${n}`,
  nextResponse: 'Next response',
  nextPart: 'Next part',
  stopShowing: 'Stop showing',
  /** READ before Workie has written: the disabled primary and its hint. */
  showTheRead: 'Show the read',
  workieWriting: 'Workie is writing',
  requestFeedback: 'Request feedback',
  backToRead: 'Back to what we heard',
  openReport: 'Open session report',
  backToMenu: 'Back to menu',
  waitingForSession: 'Waiting for the session',

  // ── Hints on a disabled primary ───────────────────────────────────────
  chooseSetFirst: 'Choose a question set first',
  someoneMustJoin: 'At least one person has to join first',
  nobodyAnswered: 'Nobody has answered yet',

  // ── Arm texts: the first press of an early advance ────────────────────
  armVote: (n) => `${n} still answering. Press again to start voting.`,
  armResults: (n, kind = 'voting') => `${n} still ${kind === 'answering' ? 'answering' : 'voting'}. Press again to show results.`,
  armSkip: (noun) => `Press again to skip this ${nounOf(noun)}.`,

  // ── Status lines (the dock's left, the Remote's status card) ──────────
  pickSet: 'Choose a question set to begin',
  waitingToJoin: 'Waiting for players to join',
  ready: (n) => `${n} ${plural(n, 'player', 'players')} ready`,
  answered: (x, n) => (Number(x) >= Number(n) ? `All ${n} answered` : `${x} of ${n} answered`),
  voted: (x, n) => (Number(x) >= Number(n) ? `All ${n} voted` : `${x} of ${n} voted`),
  resultsOnScreen: 'Results are on screen',
  showingResponse: (i, n) => `Showing response ${i} of ${n}`,
  partOf: (p, n) => `Part ${p} of ${n}`,
  readingPage: (p, n) => `Reading page ${p} of ${n}`,
  pageOf: (p, n) => `Page ${p} of ${n}`,
  readOnScreen: 'Discussion prompt on screen',
  feedbackOpen: 'The room is commenting',
  allPlayed: 'All rounds played',

  // ── "Next on the screen": one line for what the primary puts up ───────
  nextLine: Object.freeze({
    LOBBY: 'The first question',
    ANSWERING: 'The answers, for voting',
    ANSWERING_NO_VOTE: 'The results',
    VOTING: 'The results',
    RESULTS: 'What we heard',
    RESPONSES_NEXT: 'The next response',
    RESPONSES_PART: 'The next part of this response',
    READ_PAGE: 'The next page of the read',
    READ_WAIT: 'The read, when Workie has written it',
    READ_LAST: 'The next question',
    FEEDBACK: 'The next question',
    ENDED: 'The session report',
    UNKNOWN: 'Nothing yet',
  }),

  // ── The room's devices and the wall ───────────────────────────────────
  answersOnDevices: (n) => `${n} ${plural(n, 'answer is', 'answers are')} on your ${deviceWords}.`,
  responseNameHidden: (i) => `Response ${i} · name hidden`,
  responseOf: (i, n) => `Response ${i} of ${n}`,
});

/**
 * The literal labels a surface must never type itself (R1, R6). The parity
 * test greps the host page, the dock and the Remote for each of these.
 * Only labels long enough to be unambiguous are listed.
 */
export function allRoundLabels() {
  return [
    RW.startVoting, RW.showResults, RW.whatWeHeard, RW.nextPage, RW.backPage,
    RW.nextResponse, RW.nextPart, RW.stopShowing, RW.showTheRead, RW.workieWriting,
    RW.requestFeedback, RW.backToRead, RW.openReport,
  ];
}

export default RW;
