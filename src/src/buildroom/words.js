/**
 * THE BUILD ROOM'S WORDS (docs/design/build-room-batch-2-3, B6): the one place
 * a button or list label is written. Every act has one word; a surface reads
 * it from here and never types the label again. tests/build-room-copy.js fails
 * the build when a retired word (RETIRED, below) comes back.
 *
 * Owner rulings 2026-10-08 that override the mockup:
 *   - A tie re-vote keeps "Vote again"; "Ask again" means edit and re-ask the
 *     whole question.
 *   - "Later" is a list, never a kind in "Claude gets it as" (Do now, Keep in
 *     mind, Ask Claude). The server's `later` kind stays accepted.
 */

export const W = Object.freeze({
  // Moving an ask on
  showResults: 'Show results',
  openVoting: 'Open voting',
  /** Send B to Claude · Send the top idea to Claude · Send 3.4 to Claude */
  send: (what) => `Send ${what} to Claude`,
  /** A spoken answer, or no single pick to name. */
  sendPlain: 'Send to Claude',
  sendTopIdea: 'Send the top idea to Claude',
  change: 'Change before sending',
  /** Opens the edit: the whole question is asked again. */
  askAgainEllipsis: 'Ask again…',
  /** A tie: a new vote between the tied options (owner ruling). */
  voteAgain: 'Vote again',
  // The wheel
  spin: 'Spin the wheel',
  spinAgain: 'Spin again',
  // Holding back: one list, Later
  recordOnly: 'Record only',
  saveLater: 'Save for later',
  later: 'Later',
  sendNow: 'Send to Claude now',
  remove: 'Remove',
  undo: 'Undo',
  askRoom: 'Ask the room',
  // The kinds ("Claude gets it as"): three, no Later
  doNow: 'Do now',
  keepInMind: 'Keep in mind',
  askClaude: 'Ask Claude',
  // The way out, the build
  mainMenu: 'Main menu',
  openBuild: 'Open the build',
  openBuildTab: 'Open the build in a new tab',
  /** "Press Space to show results" — muted words at the left of an action row. */
  spaceTo: (what) => `Press Space to ${what}`,
  ctrlEnterSends: 'Ctrl Enter sends',
  ctrlEnterTitle: 'Ctrl Enter, or Cmd Enter on a Mac, sends it',
  /** The confirmations that replace the hint after a press. */
  resultsUp: 'Results are up',
  votingOpen: 'Voting is open',
  votingAgain: 'The room is voting again',
  /** The line under the Settle board: exactly what Claude will be told. */
  told: (key, label, direction, note = '') => {
    const lead = key === 'ask' ? `Claude will be asked about: "${direction}"` : `Claude will be told, as ${label}: "${direction}"`;
    return note ? `${lead} With it, from the set: "${note}"` : lead;
  },
  /** A question whose set says Later: the press saves it, nothing goes to Claude. */
  toldLater: (direction, note = '') => `Goes on your Later list: "${direction}". Claude hears nothing until you send it.${note ? ` With it, from the set: "${note}"` : ''}`,
  savedLater: 'Saved for later',
  /** The steps still to come, as one line. */
  nextSteps: (names) => `Next: ${names.join(' \u00b7 ')}`,
  pickRoomChoice: "Pick the room's choice?",
  pick: (label) => `Pick ${label}`,
});

/** The three kinds the host may choose. `later` is accepted by the server only. */
export const KIND_WORDS = Object.freeze([W.doNow, W.keepInMind, W.askClaude]);

/**
 * Old words that must not appear as a label anywhere in src/src/buildroom.
 * `enforced` is switched on by the task that replaces the word; until then the
 * check in tests/build-room-copy.js skips it. `prefix` matches a label that
 * starts with the word ("Go with B"). `files` scopes a word to those basenames
 * (Dismiss stays legal in the error bar and the opening's draft).
 */
export const RETIRED = Object.freeze([
  // Enforced: replaced in Task 1 (wheel labels, Main menu, Send icon)
  { word: 'Spin', enforced: true },
  { word: 'Spin instead', enforced: true },
  { word: 'Spin the wheel instead', enforced: true },
  { word: 'Back to the main menu', enforced: true },
  // Task 2: the Host ask path and the Composer
  { word: 'Close and show results', enforced: true, task: 2 },
  { word: 'Show Results', enforced: true, task: 2 },
  { word: 'Go with', prefix: true, enforced: true, task: 2 },
  { word: 'Queue it', enforced: true, task: 2 },
  // Task 3: the Stage
  { word: 'Open the vote', enforced: true, task: 3 },
  { word: 'To Claude:', prefix: true, enforced: true, task: 3 },
  { word: 'Re-ask…', enforced: true, task: 3 },
  { word: 'Open the live build ↗', enforced: true, task: 3 },
  // The Stage dock's "Edit" is now W.change; Edit stays legal elsewhere (notes, the crew board).
  { word: 'Edit', files: ['buildScreens.js', 'BuildStageDecide.jsx'], enforced: true, task: 3 },
  // Task 4: one Later list
  { word: 'Park', prefix: true, enforced: false, task: 4 },
  { word: 'Parked', prefix: true, enforced: false, task: 4 },
  { word: 'Send now', enforced: false, task: 4 },
  { word: 'Dismiss', files: ['BuildLater.jsx'], enforced: false, task: 4 },
  { word: 'For Claude, later', prefix: true, enforced: false, task: 4 },
]);
