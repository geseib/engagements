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
  /** RESULTS, ideas first (owner, 16 Oct 2026): the heading over the tally. */
  whatTheRoomBacked: 'What the room backed',
  /** The small credit under an idea: "8 points", then " — Ada" when the round shows names. */
  backedCredit: (points, name) => `${points === 1 ? '1 point' : `${points} points`}${name ? ` — ${name}` : ''}`,
  nextPage: 'Next page',
  backPage: 'Back a page',
  nextRound: (noun) => `Next ${nounOf(noun)}`,
  /** "Start round 3" (owner, 14 Oct: it names the round; matches the lobby's "Start round 1"). */
  startRound: (noun, n) => `Start ${nounOf(noun)} ${n}`,
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
  // ASK THE ROOM (docs/design/followup-icons).
  cancelQuestion: 'Cancel the question',
  askAnother: 'Ask another question',
  /** Opens the composer (session flow v3 §4.3); sends nothing. */
  askTheRoom: 'Ask the room',
  lastPage: 'Last page',
  /** The in-place second press past Workie's unsent questions (§4.3, Q8). */
  armUnasked: (n) => `${n} ${Number(n) === 1 ? 'question' : 'questions'} not asked yet. Press again to move on.`,
  /** The armed button's own label: "Start round 3 anyway". */
  anyway: (label) => `${label} anyway`,
  asksReady: (n) => `${n} ${n === 1 ? 'ask' : 'asks'} ready`,
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
    READ_ASK: 'A question for the room, or the next round',
    FEEDBACK: 'The next question',
    ROOM_QUESTION: 'The room\'s answer',
    ROOM_RESULTS: 'The next question',
    ENDED: 'The session report',
    UNKNOWN: 'Nothing yet',
  }),

  // ── The workflow strip (session flow v3 §4.6) ─────────────────────────
  // The host's screens only: never the wall, never a participant's device.
  stepSetup: 'Setup',
  stepAnswer: 'Answer',
  stepVote: 'Vote',
  stepAsk: 'Ask',
  stepFinish: 'Finish',
  stepResults: 'Results',
  stepFeedback: 'Feedback',
  stepLive: 'Live',
  stepViewing: 'Viewing',
  /** "Round 2 of 6"; the set's noun, capitalised as a heading. */
  stripRound: (noun, n, of) => {
    const word = nounOf(noun);
    const head = `${word.charAt(0).toUpperCase()}${word.slice(1)} ${n}`;
    return Number(of) > 0 ? `${head} of ${of}` : head;
  },
  readyCount: (n) => `${n} ready`,
  /** The Remote's short form: "R2 of 6". */
  stripRoundShort: (n, of) => (Number(of) > 0 ? `R${n} of ${of}` : `R${n}`),
  yourPartLabel: 'Your part now',
  showSteps: 'Show the steps',
  /**
   * "Your part now": one line per moment, ending with the main button's own
   * label (passed in as `a`, so the line and the button can never disagree).
   */
  yourPart: Object.freeze({
    LOBBY: (a) => `Choose where the room watches, then ${a} when people have joined.`,
    ANSWERING: (a) => `Let the room answer, then ${a}.`,
    VOTING: (a) => `Let the room vote, then ${a}.`,
    VOTE_RESPONSES: (a) => `Let the room vote, then ${a}.`,
    RESULTS: (a) => `The results are up. Talk them through, then ${a}.`,
    RESPONSES: (a) => `Walk the room through the responses. ${a} moves on.`,
    READ_WAIT: () => 'Workie is writing. The read appears when it is ready.',
    READ_PAGE: (a) => `Read with the room. ${a} turns the page.`,
    READ_LAST: (a) => `The read is done. Talk it through, then ${a}.`,
    READ_ASK: (a) => `The read is done. ${a}, or start the next round.`,
    FEEDBACK: (a) => `The room is commenting. Then ${a}.`,
    ROOM_QUESTION: (a) => `The room is answering. Then ${a}.`,
    ROOM_RESULTS: (a) => `Pick the ideas to show. Then ${a}, or ask another question.`,
    ENDED: (a) => `The session is over. ${a}.`,
  }),
  /** What each step is, for hover on the laptop and a long press on the Remote. */
  stepExplain: Object.freeze({
    setup: 'Where the room watches, who has joined, and the session settings.',
    answer: 'Everyone answers the question on their phone, laptop or tablet.',
    vote: 'Everyone ranks the responses. Names stay hidden while they vote.',
    heard: 'The results, then the read Workie writes of what the room said, page by page.',
    ask: 'Optional. Ask the room a question: ideas, a choice or a rating.',
    finish: 'End the session and open its report.',
  }),
  /** The bar above a step the host is looking at; the room does not move. */
  viewingBar: (step, where) => `Viewing ${step} · the room is still on ${where}`,
  viewingWhere: (round, step) => `${round}, ${step}`,
  backToRoom: 'Back to the room',
  viewingNothingMoves: 'Nothing you do here moves the room.',
  /** What a viewed step shows (owner, 14 Oct: looking only, never acting). */
  view: Object.freeze({
    sessionName: 'Session name',
    roomScreen: 'Room screen',
    questionSet: 'Question set',
    joined: 'People joined',
    fromNextRound: 'From the next round',
    appliesNow: 'Applies now',
    heldFor: (n) => `Waiting for round ${n}`,
    twoScreens: (presenting) => (presenting ? 'Two screens · the room\'s window is open' : 'Two screens · the room\'s window is not open yet'),
    oneScreen: 'One screen · the room sees this laptop',
    settingsScope: 'Settings apply from the next round. The live question, its answers and its ballots never change from the settings.',
    allSettings: 'All settings',
    answeredOf: (x, n) => `${x} of ${n} answered this round.`,
    votedOf: (x, n) => `${x} of ${n} voted this round.`,
    heardDone: 'The results and the read are done for this round.',
    comesLater: 'This step has not happened yet in this round.',
    roundsPlayed: (n) => `${n} ${n === 1 ? 'round' : 'rounds'} played so far.`,
    reportFromSession: 'The report so far opens from the session panel. Finishing the session is its own step there.',
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
    RW.requestFeedback, RW.backToRead, RW.openReport, RW.cancelQuestion, RW.askAnother,
    RW.askTheRoom,
  ];
}

export default RW;
