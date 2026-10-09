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
  /** The Later list: what each item is, and what it tells the host. */
  ideaTag: 'Idea from the room',
  directionTag: 'Direction for Claude',
  laterNote: 'Claude has not heard these',
  laterEmpty: 'Nothing saved for later. Save for later puts a room idea or a direction here.',
  putToVote: (n) => `Put ${n} to a vote`,
  putToAVote: 'Put to a vote',
  ctrlEnterVote: 'Ctrl Enter puts them to a vote',
  finishAsk: 'Finish the open question first',
  nothingFound: (kind, subject) => (kind === 'ideas'
    ? `Ideas found nothing to suggest on "${subject}".`
    : `Research found nothing it could source on "${subject}".`),
  hide: 'Hide',
  opensNewTab: 'opens in a new tab',
  voteAtMost: (n) => `A vote takes at most ${n}`,
  requestsLabel: 'Requests',
  groupResearch: (s) => `Research: ${s}`,
  groupIdeas: (s) => `Ideas: ${s}`,
  fromStep: (a) => `From step: ${a}`,
  fromClaude: 'From Claude',
  fromResearch: "From Claude's research",
  claudeOf: (name) => `${name}'s Claude`,
  fromBuilderClaude: (name) => `From ${name}'s Claude`,
  forAbout: (a) => ` for ${a}`,
  sourceSite: (site) => `Source: ${site}`,
  tickPoint: (t) => `Tick: ${t}`,
  tickAll: (h) => `Tick all: ${h}`,
  takeDownClose: 'Closing this window keeps the point up.',
  roomSentIdeas: (n) => `The room sent ${n} ideas about this point:`,
  pointNotes: Object.freeze({
    shown: 'On the Stage', voting: 'In the vote', queued: 'Highlighted', sent: 'Sent to Claude', later: 'Saved for later',
  }),
  laterHeld: 'Later \u00b7 not sent',
  // The kinds ("Claude gets it as"): three, no Later
  doNow: 'Do now',
  keepInMind: 'Keep in mind',
  askClaude: 'Ask Claude',
  // The Session panel (docs/design/build-room-sidebar; the same words as the other engagements' Players tab)
  players: 'Players',
  settings: 'Settings',
  unlockName: 'Unlock name',
  letThemTakeIt: 'Let them take it',
  lockAgain: 'Lock again',
  bringBack: 'Bring back',
  seeInPlayers: 'See in Players',
  /** The nameless cue on the screens the room sees. */
  askingToTake: (n) => `${n} asking to take a name`,
  nPeopleAsking: (n) => `${n} people are asking to take a name`,
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
  // Talking points (docs/design/build-room-talking-points): the Points tab beside Later
  points: 'Points',
  pointsNew: (n) => `${n} new`,
  roomSeesNone: 'The room sees none of these',
  research: 'Research…',
  ideasAsk: 'Ideas…',
  researchTitle: 'Research',
  ideasTitle: 'Ideas',
  researchLabel: 'What should Claude look up?',
  ideasLabel: 'Ideas about what?',
  researchNote: 'Claude hands this to a helper and keeps building. Three to six findings come back to Points, each with the pages it came from. The room sees nothing until you show it.',
  ideasNote: 'Four to eight ideas for where to go next, tied to what the room has built and decided. The room sees nothing until you show it.',
  claudeAway: 'Claude is not connected. Claude will start when it reconnects.',
  sendToClaudeNow: 'Send to Claude',
  close: 'Close',
  cancel: 'Cancel',
  researching: (subject, who = 'Claude') => `${who} is researching: ${subject}`,
  findingIdeas: (subject, who = 'Claude') => `${who} is finding ideas: ${subject}`,
  requestWaits: (kind, subject) => `${kind === 'ideas' ? 'Ideas' : 'Research'} waits: ${subject}. Claude will start when it reconnects.`,
  pointsFull: (n) => `${n} is the most. Remove or save some first.`,
  pointsEmpty: 'No points yet. Research… asks Claude to look something up on the web and bring back findings with their sources. Ideas… asks for where the build could go next. Claude may add one to three talking points of its own as it finishes a step. Nothing here reaches the Stage until you show it.',
  showOnStage: 'Show on Stage',
  oneAtATime: 'One point at a time on the Stage',
  sendThese: (n) => `Send these ${n} to Claude`,
  tickRange: 'Tick 2 to 8',
  clear: 'Clear',
  ticked: (n) => `${n} ticked`,
  moreOf: (n, noun) => `${n} more ${noun}`,
  fewer: 'Show fewer',
  tagTalk: 'Talking point',
  tagFinding: 'Finding',
  tagIdea: 'Idea',
  // The point on the Stage
  talkItOver: 'Talk it over',
  takeItDown: 'Take it down',
  pointUp: 'A point is up for the room',
  pointUpNote: 'The Stage goes back to Claude building when you take it down',
  talkPrompt: 'Talk it over with the people near you. Send an idea about it from your laptop, tablet or phone.',
  ideasOnThis: 'Ideas on this',
  notNow: 'Not now',
  putIdeasToVote: (n) => `Put the ${n} ideas to a vote?`,
  takingDown: 'Taking the point down',
  takeDownEither: 'Either way the point comes down and the Stage goes back to Claude building.',
  // The vote from points (T5), the highlight (T6), the run list (T7), the builder (T8)
  voteQuestion: 'The question',
  voteDefaultPrompt: 'Which should Claude take on next?',
  voteOptionsHead: 'The options, as people will see them',
  voteOptionsNote: 'Options never say who posted them on the Stage or on anyone\'s laptop, tablet or phone. Sources stay with the host.',
  picksEach: 'Picks per person',
  ctrlEnterOpens: 'Ctrl Enter opens voting',
  picksRule: '1 to 5. Each pick counts as one vote.',
  fewerPicks: 'One fewer pick',
  morePicks: 'One more pick',
  closeAskOpenVote: (n) => `Close ask ${n} and open the vote`,
  moveForward: 'Move forward',
  nHighlighted: (n) => `${n} highlighted`,
  roomVotedPicks: (voted, here, picks) => `The room voted ${voted} of ${here} · ${picks} ${picks === 1 ? 'pick' : 'picks'}`,
  highlightNote: 'The top 3 by votes are highlighted. Click a row to change that. Claude will be told the highlighted ones, in this order.',
  highlightTie: (labels, count) => `A tie at the cut: ${labels.join(' and ')}, ${count} each. Both are highlighted. Clear one, or keep both.`,
  highlightNone: 'Nothing is highlighted. Click a row to highlight it.',
  highlightRow: (text) => `Highlight: ${text}`,
  saveRest: 'Save the rest for later',
  workInTurn: 'Work through in turn',
  workNeedsTwo: 'Highlight at least 2 to work through in turn',
  runRefused: 'Finish or stop the current list first',
  savedForLater: (n) => `Saved ${n} for later`,
  nextMoves: 'Next: the run list, or one direction to Claude',
  votesCount: (n) => `${n} ${n === 1 ? 'vote' : 'votes'}`,
  movedForwardDone: 'Moved forward',
  closeThisVote: 'Close this vote',
  workingThrough: 'Working through',
  runStarted: (a, n) => `${a} of ${n} started`,
  runDoneOf: (a, n) => `${a} of ${n} done`,
  runLabel: 'The run list',
  runStateDone: 'Done',
  runStateOn: 'Claude is on it',
  runStateNext: 'Next',
  runStateSkipped: 'Skipped, to Later',
  claudeIsOnItem: (k) => `Claude is working on ${k}. Next waits until Claude reports it done.`,
  claudeFinishedItem: (k) => `Claude finished ${k}`,
  claudeLastItem: (k) => `Claude is working on ${k}, the last one.`,
  nextItem: (k, text) => `Next: ${k} · "${String(text).length > 24 ? `${String(text).slice(0, 24).trimEnd()}…` : text}"`,
  nextShort: (k) => `Next: ${k}`,
  nextWaits: (k) => `Next waits until Claude reports ${k} done`,
  sending: 'Sending\u2026',
  reorderItem: (t) => `Reorder ${t} (arrow keys)`,
  skipItem: (k) => `Skip ${k}`,
  stop: 'Stop',
  reorderNote: 'Drag the grip, or focus it and use the arrow keys, to reorder. Skipped items go to Later.',
  claudeSaid: (note) => `Claude: "${note}"`,
  listFinished: (n) => `Worked through all ${n}`,
  listStopped: (done, n) => `Stopped after ${done} of ${n}. The rest are in Later.`,
  hideList: 'Hide',
  confirmEarly: (k, j) => `Claude hasn't finished ${k}. Send ${j} anyway?`,
  confirmEarlyBody: (text, k, j) => `Claude is still on "${text}". If you send ${j} now, Claude gets it next and ${k} may be left half done.`,
  waitForClaude: 'Wait for Claude',
  sendAnyway: (j) => `Send ${j} anyway`,
  roomChose: (n) => `${n} the room chose`,
  claudeIsOnOf: (k, n) => `Claude is on ${k} / ${n}`,
  claudeFinishedOf: (k, n) => `Claude finished ${k} / ${n}`,
  claudeIsWorking: (k, n) => `Claude is working on ${k} of ${n}`,
  claudeWorkingText: (k, n, text) => `Claude is working on ${k} of ${n}: ${text}`,
  runWatch: 'The room chose these. Watch the big screen; the build updates as each one is done.',
  spaceSend: (k) => `Press Space to send ${k}`,
  // The room's side of a point on the Stage
  talkSend: 'Send idea',
  talkIdeaLabel: 'Your idea about this',
  talkIdeaSent: 'Sent to the host, about this point.',
  talkHelp: 'The host sees your name and decides what to pass to Claude.',
  // A builder's lane
  lanePointsNote: 'For your task. Your Claude does it in a helper and keeps building.',
  researchFor: (t) => `Research for ${t}`,
  ideasFor: (t) => `Ideas for ${t}`,
  forYourTask: 'your task',
  yourPoints: 'Your points',
  yourPointsNote: 'the host chooses what the room sees',
  yourPointsNone: 'Nothing yet. Research… and Ideas… send your Claude to look.',
  laneResearching: (s) => `Your Claude is researching: ${s}`,
  laneFindingIdeas: (s) => `Your Claude is finding ideas: ${s}`,
  laneWaits: 'Your Claude will start when it reconnects.',
  mineStatus: Object.freeze({
    new: 'With the host', shown: 'Shown to the room', voting: "In the room's vote", queued: 'Chosen by the room', sent: 'Sent to Claude', later: 'Saved for later',
  }),
  sendRequest: 'Send',
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
  { word: 'Park', prefix: true, enforced: true, task: 4 },
  { word: 'Parked', prefix: true, enforced: true, task: 4 },
  { word: 'Send now', enforced: true, task: 4 },
  { word: 'Dismiss', files: ['BuildLater.jsx'], enforced: true, task: 4 },
  { word: 'For Claude, later', prefix: true, enforced: true, task: 4 },
]);
