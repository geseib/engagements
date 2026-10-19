/**
 * WHERE WILL THE ROOM WATCH? (session flow v3 §4.7; owner, 14 Oct: "maybe this
 * a help me pick button or such ... a great part of the setup when you first
 * launch the session"). The lobby's first question for a Call & Answer
 * session, and "Help me pick": three plain questions, one recommendation.
 *
 * The choice is the switch config/surfaces.js already reads (SURFACES_KEY:
 * 'two' | 'classic'), stored per browser. Words follow the round words' rules:
 * sentence case, plain, "phone, laptop or tablet".
 */
import { SURFACES_KEY } from './surfaces';
import { FILL_ONCE } from './presentStatus';

export const ROOM_WORDS = Object.freeze({
  heading: 'Where will the room watch?',
  twoTitle: 'Two screens',
  twoBody: 'The room watches a second window on the projector or TV. This laptop stays yours: Workie\'s notes, the icons beside points and late items stay private.',
  oneTitle: 'One screen',
  oneBody: 'The projector shows this laptop. Quick to set up, but the room sees everything on it. Your phone\'s Remote can hold the private notes.',
  openPresent: 'Open the room\'s window',
  useTwo: 'Use two screens',
  useOne: 'Use one screen',
  chosen: 'Chosen',
  keepChoice: 'Keep this choice',
  helpMePick: 'Help me pick',
  remembers: 'This browser remembers your choice. Change it any time in Setup.',
  backToChoices: 'Back to the two choices',
  helpHeading: 'Help me pick',
  q1: 'Is this laptop connected to the projector or TV?',
  q1Yes: 'Yes, by cable or wirelessly',
  q1No: 'Not yet',
  q2: 'Does the projector show its own picture, or a copy of your laptop\'s screen?',
  q2Own: 'Its own (extended)',
  q2Copy: 'A copy (mirrored)',
  q2Unsure: 'Not sure',
  q3: 'Should Workie\'s notes and suggestions stay private to you?',
  q3Yes: 'Yes',
  q3No: 'It doesn\'t matter',
  nothingChanges: 'Nothing changes until you choose.',
  answeredOf: (n, of) => `${n} of ${of} answered`,
});

/**
 * The recommendation for the answers so far, or null until there is enough
 * to say. `{ choice: 'two' | 'classic', lead, detail }`.
 *   connected: 'yes' | 'no'; picture: 'own' | 'copy' | 'unsure'; private: 'yes' | 'no'
 * Question 3 only changes the wording (§4.7). `type` 'build' words the
 * one-screen advice for a Build Room, which has no Remote.
 */
export function recommendRoomScreen({ connected, picture, private: keepPrivate } = {}, type = '') {
  if (connected === 'no') {
    return { choice: 'classic', lead: 'One screen for now.', detail: type === 'build' ? 'Switch in Session, Settings, Screens once the projector is plugged in.' : 'Switch in Setup once the projector is plugged in.' };
  }
  if (connected !== 'yes' || !picture) return null;
  if (picture === 'own') {
    return {
      choice: 'two',
      lead: 'We recommend two screens.',
      detail: 'Open the room\'s window, drag it onto the projector and make it full screen. When the room can see the join code, you are ready.',
    };
  }
  if (picture === 'unsure') {
    return {
      choice: 'two',
      lead: 'Try two screens.',
      detail: 'Open the room\'s window. If it will not move onto the projector, choose one screen.',
    };
  }
  return keepPrivate === 'no'
    ? { choice: 'classic', lead: 'One screen is the simpler choice.', detail: 'The projector already shows this laptop.' }
    : { choice: 'classic', lead: 'We recommend one screen.', detail: type === 'build' ? 'Stay on Host while you read what waits for you; the room sees the screens you switch to.' : 'To keep Workie\'s notes private, open the Remote on your phone.' };
}

/** The stored choice: 'two', 'classic', or null when this browser has not chosen. */
export function storedRoomScreen(storage) {
  try {
    const v = storage ? storage.getItem(SURFACES_KEY) : null;
    return v === 'two' || v === 'classic' ? v : null;
  } catch (e) {
    return null;
  }
}

/** Store the choice. Returns false when storage refused (private mode). */
export function storeRoomScreen(storage, choice) {
  if (choice !== 'two' && choice !== 'classic') return false;
  try {
    storage.setItem(SURFACES_KEY, choice);
    return true;
  } catch (e) {
    return false;
  }
}

/*
  THE SCREENS GROUP (owner, 16 Oct: "there doesnt seem to be a way when
  clicking on the setup button to change screen mode"; the mockup
  docs/design/settings-consolidation, tab 1). The same choice as the lobby's,
  offered in Settings and in Setup in the loop. "Room screen size" was
  "Display profile": it sizes whatever the room watches, on one screen or two.
*/
export const SCREEN_WORDS = Object.freeze({
  group: 'Screens',
  where: 'Where the room watches',
  whereHintTwo: 'Two screens gives you the console on this laptop',
  whereHintOne: 'The projector shows this laptop',
  one: 'One screen',
  two: 'Two screens',
  window: 'Room\'s window',
  open: 'Open ↗',
  size: 'Room screen size',
  sizeHint: 'How big the room\'s screen draws everything',
  // Quick start (owner, 18 Oct 2026: it "doesnt let you know what screen mode
  // its in or allow you to pick", and two screens opened no window).
  quickTwoPlaces: 'The room\'s window opens on your other display as the session starts. Click it once to fill the screen.',
  quickTwoBeside: 'The room\'s window opens as the session starts. Drag it onto the projector and press F.',
  quickOne: 'The projector shows this laptop.',
  quickUnchosen: 'Not chosen yet. Pick one, or the lobby will ask.',
  quickBlocked: 'The browser blocked the room\'s window. Open it from Room\'s window ↗ at the top.',
  // ONE LAPTOP, NO SECOND DISPLAY (owner, 19 Oct 2026, item 4): a tab of this
  // browser, opened as a placed window is (placed=1), so its first click fills
  // the screen; then share that tab on the call, or press F on a mirrored projector.
  openTab: 'Open as a tab',
  openTabHint: 'Opens the room\'s window in a tab of this browser. Share that tab, or click it once to fill the screen.',
  noSecondDisplay: 'No second display? Open it in a tab and share that tab, or press F.',
  fillOnce: FILL_ONCE,
});

/*
  THE BUILD ROOM ASKS THE SAME QUESTION (parity PLAN §2.7, B9; owner, 19 Oct
  2026). The same chooser, the same stored choice; only the words that name
  what stays private change, because a Build Room has no Workie and no Remote.
*/
const BUILD_ROOM_WORDS = Object.freeze({
  twoBody: 'The room watches a second window on the projector or TV. This laptop stays on Host: Claude\'s questions, the room\'s ideas and what waits for you stay private.',
  oneBody: 'The projector shows this laptop. Quick to set up, but the room sees the Stage, Build and History you switch to.',
  q3: 'Should Claude\'s questions and the room\'s ideas stay private to you?',
  remembers: 'This browser remembers your choice. Change it any time in Session, Settings, Screens.',
});
const BUILD_SCREEN_WORDS = Object.freeze({
  whereHintTwo: 'This laptop stays where it is; 2, 3 and 4 change the room\'s window',
  whereHintOne: 'The projector shows this laptop',
});

/** The chooser's words for a game type: Call & Answer's, with the Build Room's own where they differ. */
export function roomWordsFor(type) {
  return type === 'build' ? Object.freeze({ ...ROOM_WORDS, ...BUILD_ROOM_WORDS }) : ROOM_WORDS;
}

/** The Screens group's words for a game type. */
export function screenWordsFor(type) {
  return type === 'build' ? Object.freeze({ ...SCREEN_WORDS, ...BUILD_SCREEN_WORDS }) : SCREEN_WORDS;
}
