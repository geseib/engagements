/**
 * THE HOST'S WORDS FOR THE LIVE-SESSION FRAME (docs/design/experience-plan/PLAN.md
 * §3.2, §3.6; owner, 1 Nov 2026: "go with the recommendations").
 *
 * One file for the top bar's slots and for leaving or ending, so every surface
 * that draws them says the same thing. The banned-words guard
 * (testing/driftScan.js) reads this file: none of the replaced labels in §3.6's
 * right-hand column may appear here.
 *
 * The top bar's slots, in order, left to right (PLAN §3.2 "What never moves"):
 *   main-menu · name · join · room-screen · connection (only when broken) ·
 *   needs-you (the bell) · help (?) · session-menu
 */
export const TOP_SLOTS = Object.freeze([
  'main-menu', 'name', 'join', 'room-screen', 'connection', 'needs-you', 'help', 'session-menu',
]);

const HW = Object.freeze({
  // Leave this screen; the session keeps running (§3.6). Always top left.
  mainMenu: 'Main menu',
  mainMenuHint: 'Back to the start screen. This session keeps running, and Rejoin brings you back to it.',
  // Stop it for everyone (§3.6). The Session menu's foot, confirmed.
  endSession: 'End session',
  endSessionHint: 'Stops the session on every device in the room.',
  // The one place for set-once settings (§3.6). Always top right, labelled.
  sessionMenu: 'Session menu',
  closeSessionMenu: 'Close the Session menu',
  // Help, beside the Session menu (§2 principle 2).
  help: 'Help and feedback',
  // The bell's name in a live session (§4.3).
  needsYou: 'Needs you',
  // The one join toggle (§3.6): the code on the room's screen, or not.
  join: 'Join',
  showJoinCode: 'Show join code',
  hideJoinCode: 'Hide join code',
  joinShowHint: 'Show the join code on the room\'s screen',
  joinHideHint: 'Take the join code off the room\'s screen',
  // The room's screen status (§3.6: the room's window on two screens).
  roomsWindow: 'Room\'s window',
  roomSeesThisScreen: 'The room sees this screen',
  roomSeesThisScreenHint: 'One screen: this laptop is the room\'s screen. Names and private details stay on your phone, or behind Show on this screen.',
  // In an event, up one level (§3.6): the Session menu's Agenda item on the stage.
  agendaHint: 'Back to the event\'s agenda. The phones stay where they are.',
  // The connection, drawn only when it is broken (PLAN §4.2 row 7).
  notHearing: 'Not hearing the room',
  reconnecting: 'Reconnecting',
  people: 'People',
  agenda: 'Agenda',
});

/*
  THE SESSION MENU'S OWN WORDS (§3.2; dev QA 2 Nov): its sections are named
  in config/setupPanel.js setupPanelTabs; these are the lines inside them.
*/
export const SESSION_MENU_WORDS = Object.freeze({
  // People's link to the whole list (experience plan p-1), and that view's heading.
  allPeople: (n) => (Number(n) > 0 ? `All ${n}, and who left` : 'Everyone, and who left'),
  endNote: 'Ending stops the session on every phone, laptop or tablet in the room, now. The report keeps everything said so far.',
  endLobbyNote: 'Nothing has been played yet. Ending closes the session for anyone who has joined, and the code stops working.',
  ended: 'This session has ended. Its report is on the main button.',
  leaveHeading: 'Leave without ending',
  closeSurvey: 'Close survey',
  closeNote: 'Closing stops every phone mid-answer and freezes the counts. It cannot be reopened. The two-minute warning tells everyone first.',
  surveyNotOpen: 'The survey is not open yet, so there is nothing to close.',
  surveyClosed: 'The survey is closed. Its results are on the main button.',
  afterClose: 'After it closes',
  endSurveyNote: 'The survey is closed. Ending finishes the session for everyone.',
  endSurveyFirst: 'Close the survey first (Close survey, above); then you can end the session here.',
});

export default HW;
