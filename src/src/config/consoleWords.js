/**
 * THE HOST CONSOLE'S WORDS (docs/superpowers/specs/2026-10-15-host-console-design.md).
 * Round-step labels stay in roundWords.js; these are the console's own.
 * Sentence case, plain, "phone, laptop or tablet".
 */
const CW = Object.freeze({
  queue: 'Round queue',
  people: 'People',
  // Workie's read on the console when it did not arrive (experience plan §4.2 row 5).
  readFailed: "Workie's read didn't arrive",
  readWriting: 'Workie is reading the responses…',
  retry: 'Retry',
  retrying: 'Trying again…',
  redo: 'Redo',
  // An asker's row in People (experience plan §3.6: the host's words for a move).
  needsYou: 'needs you',
  wantsName: 'Wants their name on a new device',
  late: 'Late & not reviewed',
  allRounds: 'Rounds and questions',
  // People's link to the whole list in the Session menu (experience plan p-1).
  allPeople: (n) => (Number(n) > 0 ? `All ${n}, and who left` : 'Everyone, and who left'),
  reviewLate: 'Review them',
  done: 'done',
  now: 'now',
  next: 'next',
  answered: 'answered',
  voted: 'voted',
  stillWriting: 'still writing',
  notYet: 'not yet',
  respondingTitle: 'Responses as they land',
  namesHidden: 'Names hidden',
  forYou: 'For you',
  theTask: 'The task',
  // The way out and the top bar's other words are config/hostWords.js (Phase 2a).
  theQuestion: 'The question',
  onTheWall: 'On the wall now',
  onTheWallShort: 'On the wall',
  // Voting on the overview: every answer is on the room's window (19 Oct 2026).
  allAnswers: 'All answers',
  pressToWall: 'Press a response to put it on the wall.',
  pressToWallOrQuestion: 'Press a response, or the question, to put it on the wall.',
  theBallot: 'The ballot, in the order the room sees it',
  votes: 'Votes',
  resultsTitle: 'The results',
  readTitle: 'Workie\'s read',
  readOnWall: 'The wall shows this page',
  upNext: 'Up next',
  nextOnWall: 'Next on the wall',
  showScoreboard: 'Show scoreboard',
  hideScoreboard: 'Hide scoreboard',
  noLate: 'Nothing is waiting.',
  reportSoFar: 'The report so far',
  nobodyYet: 'Nobody has joined yet.',
  commentsTitle: 'Comments as they land',
  noComments: 'No comments yet.',
  waitingForResponses: 'No responses yet.',
  points: (n) => (n === 1 ? '1 point' : `${n} points`),
});

export default CW;
