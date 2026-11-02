/**
 * THE PARTICIPANT'S WORDS (experience plan PLAN.md §3.4 and §3.6, Phase 3 step 3a).
 *
 * One screen grammar on every participant type (Call & Answer, Trivia, Poll,
 * Wavelength, Survey, Build Room, an event's items): the bar says where you
 * are ("Round 3 · Answer"), one eyebrow, one heading at one size, one card,
 * the action in the dock. This file is the word half of that grammar. Audit C
 * (docs/design/experience-plan/audit/C-participant-phone.md §1.9) counted six
 * receipt headings, seven ways of saying "wait", three nouns for the thing a
 * participant joins, and two different end screens for a poll. Each of those
 * moments now has ONE sentence, here, and every screen reads it from here.
 *
 * Words only, no behaviour. Every value is a string or a function that returns
 * one. __tests__/playerWords.test.js holds the shapes and the banned-words
 * guard (src/src/testing/driftScan.js) reads this file like any other words
 * file, so nothing on PLAN §3.6's "not these" list may appear in it.
 */

/* ---------------------------------------------------------------- bar ---- */

/** The bar's step names: "Round 3 · Answer". */
export const STEP = Object.freeze({
  answer: 'Answer',
  vote: 'Vote',
  // Singular on purpose: a lone "Results" is the Reports word on §3.6's list.
  results: 'Result',
  question: 'Question',
});

/**
 * Where you are, for the bar: the round and the step, or whichever of the two
 * is known. `position` is "Round 3" / "Lesson 2" (the set's own noun).
 */
export function barWhere(position, step) {
  if (position && step) return `${position} · ${step}`;
  return position || step || IN_SESSION;
}

/** The bar when no round is on: the lobby, between rounds, loading. */
export const IN_SESSION = 'In the session';

/* --------------------------------------------------------------- join ---- */

export const JOIN = Object.freeze({
  /** The bar while joining. */
  ctx: 'Join the session',
  heading: 'Join the session.',
  lede: 'Type the four digits on the room’s screen.',
  /** The one join button, every join screen. */
  button: 'Join',
  codeLabel: 'Session code',
  codeHelp: 'Four digits. Not case-sensitive, because there are no letters.',
  codeFromLink: 'Read from the link you followed. Nothing to type.',
  nameLabel: 'Your name',
  namePlaceholder: 'Your Name',
  /**
   * THE FRIENDLY WRONG-CODE LINE. The server answers one 404 for a typo, an
   * ended session, a deleted one and an expired one ("Game not found"), and
   * cannot tell them apart, so this must not pretend to.
   */
  wrongCode: (code) => (code
    ? `Nothing is running under ${code}. Check the four digits on the room’s screen, or ask your host to read them out.`
    : 'Nothing is running under that code. Check the four digits on the room’s screen, or ask your host to read them out.'),
  privateHeading: 'This session is private.',
  privateLede: 'The host has an access code for it. Ask them, or read it off the room’s screen.',
  privateCtx: 'Private session',
});

/**
 * JOINED BEFORE THE HOST STARTED (audit C P8): not a dead end but a lobby
 * that joins by itself. The page holds the code and the name and tries again
 * every few seconds.
 */
export const EARLY = Object.freeze({
  eyebrow: (name) => (name ? `Holding your place as ${name}` : 'Holding your place'),
  heading: 'Waiting for the host.',
  lede: 'The host has not started this yet. This page joins you by itself the moment they do. You do not need to tap anything.',
  change: 'Change the code or name',
  itemLede: 'This item has not started yet. This page joins you by itself the moment the host starts it.',
});

/* ------------------------------------------------------------ waiting ---- */

/**
 * ONE WAY TO SAY WAIT. The eyebrow says why ("You're in as Sam", "The round
 * is closed", "Voting next"); the heading and the line are always these.
 */
export const WAIT = Object.freeze({
  heading: 'Waiting for the host.',
  line: 'This page changes on its own. You do not need to refresh it.',
  lobbyEyebrow: (name) => (name ? `You’re in as ${name}` : 'You’re in'),
  lobbyLede: 'The host will start the first round.',
  betweenEyebrow: 'The round is closed',
  betweenLede: 'The next round starts when the host is ready.',
  voteEyebrow: 'Voting next',
  voteLede: 'The responses are on their way. The ballot appears here when they are ready.',
  surveyLede: 'The survey opens when your host is ready.',
  eventLede: 'The next item starts when the host is ready.',
});

/* ----------------------------------------------------------- receipts ---- */

/** The eyebrow on every receipt. */
export const SENT = 'Sent';

/**
 * ONE RECEIPT HEADING, "Your <thing> is in." What the thing is, by type:
 * a trivia letter, a poll's answer and a call's response are each "answer";
 * Wavelength sends words; an artwork round sends a title; a ballot is votes;
 * a survey is answers.
 */
export const RECEIPT = Object.freeze({
  answer: 'Your answer is in.',
  title: 'Your title is in.',
  words: 'Your words are in.',
  votes: 'Your votes are in.',
  answers: 'Your answers are in.',
  idea: 'Your idea is in.',
  pick: 'Your pick is in.',
  rating: 'Your rating is in.',
  /** What the receipt card is called. */
  card: 'What you sent',
  ballotCard: 'Your ballot',
  locked: 'Locked for this round. If this page reloads, it comes back.',
  changeable: 'You can change them until your host closes the survey.',
});

/** Which receipt heading a game type's answer gets. */
export function receiptFor(gameType, { artwork = false } = {}) {
  if (gameType === 'wavelength') return RECEIPT.words;
  if (artwork) return RECEIPT.title;
  return RECEIPT.answer;
}

/* ------------------------------------------------------------ results ---- */

/** The results eyebrow on every type. */
export const RESULTS = Object.freeze({
  eyebrow: 'Your result',
});

/* -------------------------------------------------------------- ended ---- */

/**
 * ONE ENDED SCREEN (audit C P6). Score only where the format scores
 * (config/scoreboard.js `hasScoreboard`); "Thanks for taking part" wherever
 * nothing is scored, so a poll never reads "Thanks for playing" over a
 * "Final score 0".
 */
export const ENDED = Object.freeze({
  ctx: 'Session complete',
  itemCtx: 'Item finished',
  eyebrow: 'That’s a wrap',
  itemEyebrow: 'This item is finished',
  scored: (name) => (name ? `Thanks for playing, ${name}.` : 'Thanks for playing.'),
  unscored: (name) => (name ? `Thanks for taking part, ${name}.` : 'Thanks for taking part.'),
  finalScore: 'Final score',
  finalStanding: 'Final standing',
  closeLine: 'You can close this page. If your host shares what the room said, they will send the link themselves.',
  eventLine: 'Keep this page open: the next item starts here by itself.',
  /** "Up next" in an event. */
  next: 'Up next',
  agenda: 'Open the agenda',
  lookUp: 'The room’s summary, and what the host wants everyone to take away, is on the room’s screen.',
});

/* ----------------------------------------------------- the room's screen -- */

/**
 * THE LOOK-UP LINES, one per moment, all naming "the room's screen" (§3.6),
 * never the main screen, the big screen or the projector.
 */
export const LOOK_UP = Object.freeze({
  lobby: 'Everything the room shares, the questions, the results and the discussion, is on the room’s screen. This page is only ever your half.',
  between: 'The discussion is on the room’s screen. Join in: this is the part the session is for.',
  receiptTrivia: 'The room’s answers go up on the room’s screen when the round closes.',
  receiptWavelength: 'Nothing shows until everyone is in. When the round closes, the words the whole room shares light up on the room’s screen.',
  receiptPoll: 'Your answer is counted. Watch the room’s screen: the result fills in as the room answers, without names.',
  receiptCall: 'The host will bring every response up on the room’s screen when the round closes, without names.',
  receiptVotes: 'Who wrote what, and how the room ranked them, goes up on the room’s screen when voting closes.',
  resultsTrivia: (letter) => `How the whole room answered, and why${letter ? ` ${letter}` : ''}, is on the room’s screen.`,
  resultsWavelength: 'What the room shared, the cloud and the words more than one of you reached for, is on the room’s screen.',
  resultsPoll: 'The room’s result is on the room’s screen: how everyone answered, without names.',
  resultsCall: 'Names are on the room’s screen now, with the top responses and the discussion prompts. This page will not repeat them.',
  surveySent: 'When the survey closes, your host may put the results on the room’s screen.',
  surveyClosed: 'Your host may put the results on the room’s screen. Nobody’s name is shown there.',
});
